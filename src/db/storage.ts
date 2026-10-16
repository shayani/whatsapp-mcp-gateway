import fs from 'node:fs';
import path from 'node:path';
import { getDatabase } from './index.js';
import { getLinkedJids } from './contacts.js';
import { config } from '../config.js';

export interface StorageSummary {
  totalMediaBytes: number;
  totalMediaFiles: number;
  databaseBytes: number;
  walBytes: number;
  totalMessages: number;
  totalContactsWithData: number;
  cachedAt: number;
}

export interface ChatStorageInfo {
  jid: string;
  displayName: string;
  isGroup: boolean;
  messageCount: number;
  mediaCount: number;
  mediaBytes: number;
  lastMessageTimestamp: number;
}

export interface CleanStorageOptions {
  target: 'all' | 'groups_only' | string; // 'all', 'groups_only' ou JID específico do contato/grupo
  mode: 'media_only' | 'all'; // 'media_only' (apenas arquivos físicos do disco) ou 'all' (mensagens + mídias)
  olderThanDays?: number; // 0 para todas, ou número de dias (ex: 7, 30, 60, 90)
}

export interface CleanStorageResult {
  deletedFilesCount: number;
  freedMediaBytes: number;
  deletedMessagesCount: number;
  vacuumExecuted: boolean;
  newDbSizeBytes: number;
}

// Cache em memória para não sobrecarregar com re-consultas frequentes
let summaryCache: StorageSummary | null = null;
let chatsCache: { data: ChatStorageInfo[]; cachedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

export function invalidateStorageCache(): void {
  summaryCache = null;
  chatsCache = null;
}

export function resolveAttachmentPath(filePath: string): string | null {
  if (!filePath || filePath.trim().length === 0) {
    return null;
  }
  if (fs.existsSync(filePath)) {
    return filePath;
  }
  const parts = filePath.split(path.sep);
  const mediaIdx = parts.lastIndexOf('media');
  if (mediaIdx !== -1 && mediaIdx < parts.length - 1) {
    const rel = parts.slice(mediaIdx + 1).join(path.sep);
    const candidate = path.join(config.mediaDir, rel);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function getStorageSummary(forceRefresh = false): StorageSummary {
  const now = Date.now();
  if (!forceRefresh && summaryCache && now - summaryCache.cachedAt < CACHE_TTL_MS) {
    return summaryCache;
  }

  const db = getDatabase();

  const mediaStats = db.prepare(`
    SELECT 
      COUNT(*) AS total_attachments,
      COALESCE(SUM(file_size), 0) AS total_media_bytes
    FROM attachments
    WHERE file_path != '' AND file_path IS NOT NULL
  `).get() as { total_attachments: number; total_media_bytes: number };

  const msgStats = db.prepare(`
    SELECT COUNT(*) AS total_messages FROM messages
  `).get() as { total_messages: number };

  const contactsStats = db.prepare(`
    SELECT COUNT(DISTINCT chat_jid) AS total_contacts FROM messages
  `).get() as { total_contacts: number };

  const dbPath = path.join(config.dbDir, 'whatsapp.db');
  const walPath = path.join(config.dbDir, 'whatsapp.db-wal');

  let databaseBytes = 0;
  let walBytes = 0;

  try {
    if (fs.existsSync(dbPath)) {
      databaseBytes = fs.statSync(dbPath).size;
    }
    if (fs.existsSync(walPath)) {
      walBytes = fs.statSync(walPath).size;
    }
  } catch (err) {
    console.warn('Erro ao obter tamanho dos arquivos do banco SQLite:', err);
  }

  summaryCache = {
    totalMediaBytes: mediaStats.total_media_bytes,
    totalMediaFiles: mediaStats.total_attachments,
    databaseBytes,
    walBytes,
    totalMessages: msgStats.total_messages,
    totalContactsWithData: contactsStats.total_contacts,
    cachedAt: now
  };

  return summaryCache;
}

export function getStorageByChat(
  limit = 100,
  search?: string,
  forceRefresh = false
): ChatStorageInfo[] {
  const now = Date.now();

  // Se não houver busca, podemos usar o cache de chats
  if (!search && !forceRefresh && chatsCache && now - chatsCache.cachedAt < CACHE_TTL_MS) {
    return chatsCache.data.slice(0, limit);
  }

  const db = getDatabase();

  const deduplicateClause = `
    NOT EXISTS (
      SELECT 1 FROM jid_links jl
      JOIN contacts c2 ON c2.jid = jl.jid2
      WHERE jl.jid1 = c.jid AND (
        c2.last_message_timestamp > c.last_message_timestamp
        OR (c2.last_message_timestamp = c.last_message_timestamp AND c.jid LIKE '%@lid')
      )
    )
  `;

  let searchFilter = '';
  const params: (string | number)[] = [];

  if (search && search.trim().length > 0) {
    const term = `%${search.trim()}%`;
    searchFilter = `
      AND (
        unaccent(COALESCE(c.name, '')) LIKE unaccent(?)
        OR unaccent(COALESCE(c.notify_name, '')) LIKE unaccent(?)
        OR c.jid LIKE ?
      )
    `;
    params.push(term, term, term);
  }

  const query = `
    WITH canonical_contacts AS (
      SELECT c.jid, COALESCE(c.name, c.notify_name, c.jid) as display_name, c.is_group, c.last_message_timestamp
      FROM contacts c
      WHERE ${deduplicateClause} ${searchFilter}
    ),
    contact_all_jids AS (
      SELECT cc.jid as primary_jid, cc.jid as target_jid FROM canonical_contacts cc
      UNION
      SELECT cc.jid as primary_jid, jl.jid2 as target_jid
      FROM canonical_contacts cc
      JOIN jid_links jl ON jl.jid1 = cc.jid
    )
    SELECT 
      cc.jid,
      cc.display_name AS displayName,
      cc.is_group AS isGroup,
      cc.last_message_timestamp AS lastMessageTimestamp,
      COUNT(DISTINCT m.id) AS messageCount,
      COUNT(DISTINCT CASE WHEN a.file_path != '' AND a.file_path IS NOT NULL THEN a.id END) AS mediaCount,
      COALESCE(SUM(CASE WHEN a.file_path != '' AND a.file_path IS NOT NULL THEN a.file_size ELSE 0 END), 0) AS mediaBytes
    FROM canonical_contacts cc
    JOIN contact_all_jids caj ON caj.primary_jid = cc.jid
    JOIN messages m ON m.chat_jid = caj.target_jid
    LEFT JOIN attachments a ON a.message_id = m.id
    GROUP BY cc.jid
    HAVING mediaBytes > 0 OR messageCount > 0
    ORDER BY mediaBytes DESC, messageCount DESC
    LIMIT ?
  `;

  params.push(limit);

interface RawChatStorageRow {
  jid: string;
  displayName: string;
  isGroup: number;
  lastMessageTimestamp: number;
  messageCount: number;
  mediaCount: number;
  mediaBytes: number;
}

  const results = db.prepare(query).all(...params) as RawChatStorageRow[];
  const formatted: ChatStorageInfo[] = results.map((r) => ({
    ...r,
    isGroup: Boolean(r.isGroup)
  }));

  if (!search) {
    chatsCache = {
      data: formatted,
      cachedAt: now
    };
  }

  return formatted;
}

export function getChatStorageDetails(jid: string): { messageCount: number; mediaCount: number; mediaBytes: number } {
  const db = getDatabase();
  const linked = getLinkedJids(jid);
  const placeholders = linked.map(() => '?').join(',');

  const row = db.prepare(`
    SELECT
      COUNT(DISTINCT m.id) AS messageCount,
      COUNT(DISTINCT CASE WHEN a.file_path != '' AND a.file_path IS NOT NULL THEN a.id END) AS mediaCount,
      COALESCE(SUM(CASE WHEN a.file_path != '' AND a.file_path IS NOT NULL THEN a.file_size ELSE 0 END), 0) AS mediaBytes
    FROM messages m
    LEFT JOIN attachments a ON a.message_id = m.id
    WHERE m.chat_jid IN (${placeholders})
  `).get(...linked) as { messageCount: number; mediaCount: number; mediaBytes: number } | undefined;

  return {
    messageCount: row?.messageCount || 0,
    mediaCount: row?.mediaCount || 0,
    mediaBytes: row?.mediaBytes || 0
  };
}

export function cleanStorage(options: CleanStorageOptions): CleanStorageResult {
  const db = getDatabase();

  let cutoffTimestamp: number | null = null;
  if (options.olderThanDays && options.olderThanDays > 0) {
    cutoffTimestamp = Math.floor(Date.now() / 1000) - (options.olderThanDays * 86400);
  }

  // 1. Identifica os chats alvo
  let targetFilter = '1=1';
  const targetParams: (string | number)[] = [];

  if (options.target === 'groups_only') {
    targetFilter = "m.chat_jid LIKE '%@g.us'";
  } else if (options.target !== 'all') {
    const linked = getLinkedJids(options.target);
    const placeholders = linked.map(() => '?').join(',');
    targetFilter = `m.chat_jid IN (${placeholders})`;
    targetParams.push(...linked);
  }

  // 2. Busca os anexos elegíveis para exclusão física
  let attQuery = `
    SELECT a.id, a.file_path, a.file_size
    FROM attachments a
    JOIN messages m ON m.id = a.message_id
    WHERE (a.file_path != '' AND a.file_path IS NOT NULL)
      AND (${targetFilter})
  `;
  const attQueryParams = [...targetParams];

  if (cutoffTimestamp !== null) {
    attQuery += ' AND m.timestamp <= ?';
    attQueryParams.push(cutoffTimestamp);
  }

  const attachmentsToDelete = db.prepare(attQuery).all(...attQueryParams) as {
    id: string;
    file_path: string;
    file_size: number | null;
  }[];

  let freedMediaBytes = 0;
  let deletedFilesCount = 0;

  // 3. Exclui os arquivos físicos do disco
  for (const att of attachmentsToDelete) {
    const resolved = resolveAttachmentPath(att.file_path);
    if (resolved && fs.existsSync(resolved)) {
      try {
        fs.unlinkSync(resolved);
        deletedFilesCount++;
        freedMediaBytes += att.file_size || 0;

        // Tenta remover diretório do chat se estiver vazio
        const parentDir = path.dirname(resolved);
        try {
          if (fs.readdirSync(parentDir).length === 0) {
            fs.rmdirSync(parentDir);
          }
        } catch {
          // Diretório não vazio ou erro irrelevante
        }
      } catch (err) {
        console.warn(`Erro ao excluir arquivo físico ${resolved}:`, err);
      }
    } else {
      // Arquivo já não existia fisicamente, mas ainda estava registrado com tamanho
      freedMediaBytes += att.file_size || 0;
      deletedFilesCount++;
    }
  }

  let deletedMessagesCount = 0;

  if (options.mode === 'media_only') {
    // Atualiza os registros no banco para marcar a mídia física como apagada
    if (attachmentsToDelete.length > 0) {
      const updateStmt = db.prepare('UPDATE attachments SET file_path = ?, file_size = 0 WHERE id = ?');
      const updateBatch = db.transaction((items: { id: string }[]) => {
        for (const item of items) {
          updateStmt.run('', item.id);
        }
      });
      updateBatch(attachmentsToDelete);
    }
  } else if (options.mode === 'all') {
    // Exclui mensagens e mídias
    let msgQuery = `
      SELECT id FROM messages
      WHERE (${targetFilter.replace(/m\./g, '')})
    `;
    const msgParams = [...targetParams];

    if (cutoffTimestamp !== null) {
      msgQuery += ' AND timestamp <= ?';
      msgParams.push(cutoffTimestamp);
    }

    const messagesToDelete = db.prepare(msgQuery).all(...msgParams) as { id: string }[];
    deletedMessagesCount = messagesToDelete.length;

    if (deletedMessagesCount > 0) {
      const deleteFtsStmt = db.prepare('DELETE FROM messages_fts WHERE message_id = ?');
      const deleteMsgStmt = db.prepare('DELETE FROM messages WHERE id = ?');

      const deleteTx = db.transaction((msgs: { id: string }[]) => {
        for (const m of msgs) {
          deleteFtsStmt.run(m.id);
          deleteMsgStmt.run(m.id);
        }
      });

      deleteTx(messagesToDelete);

      // Limpa anexos órfãos que possam ter sobrado caso o cascade não tenha pego
      if (attachmentsToDelete.length > 0) {
        const deleteAttStmt = db.prepare('DELETE FROM attachments WHERE id = ?');
        const deleteAttTx = db.transaction((atts: { id: string }[]) => {
          for (const a of atts) {
            deleteAttStmt.run(a.id);
          }
        });
        deleteAttTx(attachmentsToDelete);
      }

      // Executa VACUUM automaticamente para recuperar espaço físico do SQLite no disco
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
        db.exec('VACUUM');
      } catch (err) {
        console.error('Erro ao executar VACUUM automático:', err);
      }
    }
  }

  // Invalida o cache
  invalidateStorageCache();

  // Obtém novo tamanho do banco no disco
  const dbPath = path.join(config.dbDir, 'whatsapp.db');
  let newDbSizeBytes = 0;
  try {
    if (fs.existsSync(dbPath)) {
      newDbSizeBytes = fs.statSync(dbPath).size;
    }
  } catch {
    // ignora
  }

  return {
    deletedFilesCount,
    freedMediaBytes,
    deletedMessagesCount,
    vacuumExecuted: options.mode === 'all',
    newDbSizeBytes
  };
}
