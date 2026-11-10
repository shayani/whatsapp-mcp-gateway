import { getDatabase } from './index.js';
import { getAttachmentsByMessageId, type Attachment } from './attachments.js';
import { getLinkedJids } from './contacts.js';

export interface Message {
  id: string;
  chat_jid: string;
  sender_jid: string;
  sender_name?: string | null;
  from_me: number;
  timestamp: number;
  message_type: 'text' | 'audio' | 'image' | 'video' | 'document' | 'sticker' | 'other';
  content: string | null;
  raw_json?: string | null;
  created_at?: string;
}

export interface MessageWithAttachments extends Message {
  attachments: Attachment[];
}

export function insertMessage(msg: Message): void {
  const db = getDatabase();

  const insertMsgStmt = db.prepare(`
    INSERT OR REPLACE INTO messages (
      id, chat_jid, sender_jid, from_me, timestamp, message_type, content, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertFtsStmt = db.prepare(`
    INSERT INTO messages_fts (message_id, chat_jid, content, transcription_text)
    VALUES (?, ?, ?, '')
  `);

  const updateContactStmt = db.prepare(`
    UPDATE contacts SET
      last_message_timestamp = MAX(last_message_timestamp, ?),
      updated_at = CURRENT_TIMESTAMP
    WHERE jid = ?
  `);

  const tx = db.transaction(() => {
    insertMsgStmt.run(
      msg.id,
      msg.chat_jid,
      msg.sender_jid,
      msg.from_me,
      msg.timestamp,
      msg.message_type,
      msg.content ?? null,
      msg.raw_json ?? null
    );

    // Remove qualquer versão antiga do FTS caso seja replace
    db.prepare('DELETE FROM messages_fts WHERE message_id = ?').run(msg.id);

    if (msg.content && msg.content.trim().length > 0) {
      insertFtsStmt.run(msg.id, msg.chat_jid, msg.content);
    }

    const linkedJids = getLinkedJids(msg.chat_jid);
    for (const jid of linkedJids) {
      updateContactStmt.run(msg.timestamp, jid);
    }
  });

  tx();
}

export function getMessage(id: string): MessageWithAttachments | undefined {
  const db = getDatabase();
  const query = `
    SELECT
      m.*,
      CASE
        WHEN m.sender_jid = m.chat_jid THEN NULL
        ELSE COALESCE(
          (SELECT COALESCE(c.name, c.notify_name) FROM contacts c WHERE c.jid = m.sender_jid LIMIT 1),
          (SELECT COALESCE(cl.name, cl.notify_name) FROM jid_links jl JOIN contacts cl ON cl.jid = jl.jid2 WHERE jl.jid1 = m.sender_jid AND (cl.name IS NOT NULL OR cl.notify_name IS NOT NULL) LIMIT 1),
          NULL
        )
      END AS sender_name
    FROM messages m
    WHERE m.id = ?
  `;
  const msg = db.prepare(query).get(id) as Message | undefined;
  if (!msg) return undefined;

  return {
    ...msg,
    attachments: getAttachmentsByMessageId(msg.id)
  };
}

export function listChatMessages(
  chatJid: string,
  limit = 50,
  beforeTimestamp?: number,
  sinceTimestamp?: number,
  order: 'asc' | 'desc' = 'asc'
): MessageWithAttachments[] {
  const db = getDatabase();

  const linked = getLinkedJids(chatJid);
  const placeholders = linked.map(() => '?').join(', ');
  let query = `
    SELECT
      m.*,
      CASE
        WHEN m.sender_jid = m.chat_jid THEN NULL
        ELSE COALESCE(
          (SELECT COALESCE(c.name, c.notify_name) FROM contacts c WHERE c.jid = m.sender_jid LIMIT 1),
          (SELECT COALESCE(cl.name, cl.notify_name) FROM jid_links jl JOIN contacts cl ON cl.jid = jl.jid2 WHERE jl.jid1 = m.sender_jid AND (cl.name IS NOT NULL OR cl.notify_name IS NOT NULL) LIMIT 1),
          NULL
        )
      END AS sender_name
    FROM messages m
    WHERE m.chat_jid IN (${placeholders})
  `;
  const params: (string | number)[] = [...linked];

  if (beforeTimestamp) {
    query += ' AND m.timestamp < ?';
    params.push(beforeTimestamp);
  }

  if (sinceTimestamp) {
    query += ' AND m.timestamp >= ?';
    params.push(sinceTimestamp);
  }

  query += ' ORDER BY m.timestamp DESC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(query).all(...params) as Message[];

  // Se order for 'asc', inverte para retornar em ordem cronológica ascendente
  const resultRows = order === 'asc' ? rows.reverse() : rows;

  return resultRows.map((m) => ({
    ...m,
    attachments: getAttachmentsByMessageId(m.id)
  }));
}

/**
 * Retorna os limites [start, end) em segundos UNIX para um dia civil (YYYY-MM-DD)
 * em um determinado fuso horário IANA (padrão: America/Recife).
 * Trata variações de DST de forma precisa via Intl.DateTimeFormat.
 */
export function getDayBoundsInTimezone(dateStr: string, timeZone = 'America/Recife'): { start: number; end: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) {
    throw new Error(`Formato de data inválido: "${dateStr}". Use YYYY-MM-DD.`);
  }
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  const checkDate = new Date(Date.UTC(year, month - 1, day));
  if (
    checkDate.getUTCFullYear() !== year ||
    checkDate.getUTCMonth() !== month - 1 ||
    checkDate.getUTCDate() !== day
  ) {
    throw new Error(`Data inexistente no calendário: "${dateStr}".`);
  }

  function getUtcEpoch(y: number, m: number, d: number, h = 0, min = 0, s = 0): number {
    const utcGuess = Date.UTC(y, m - 1, d, h, min, s);
    let dtf: Intl.DateTimeFormat;
    try {
      dtf = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
      });
    } catch {
      throw new Error(`Fuso horário inválido: "${timeZone}". Forneça um identificador IANA válido (ex: "America/Recife").`);
    }

    const parts = dtf.formatToParts(new Date(utcGuess));
    const p: Record<string, number> = {};
    for (const part of parts) {
      if (part.type !== 'literal') {
        p[part.type] = parseInt(part.value, 10);
      }
    }
    const localMsFromGuess = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const offsetMs = localMsFromGuess - utcGuess;

    let resolvedUtcMs = Date.UTC(y, m - 1, d, h, min, s) - offsetMs;
    const checkParts = dtf.formatToParts(new Date(resolvedUtcMs));
    const cp: Record<string, number> = {};
    for (const part of checkParts) {
      if (part.type !== 'literal') {
        cp[part.type] = parseInt(part.value, 10);
      }
    }
    const checkLocalMs = Date.UTC(cp.year, cp.month - 1, cp.day, cp.hour, cp.minute, cp.second);
    const checkOffsetMs = checkLocalMs - resolvedUtcMs;
    if (checkOffsetMs !== offsetMs) {
      resolvedUtcMs = Date.UTC(y, m - 1, d, h, min, s) - checkOffsetMs;
    }

    return Math.floor(resolvedUtcMs / 1000);
  }

  const start = getUtcEpoch(year, month, day, 0, 0, 0);
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1));
  const end = getUtcEpoch(nextDate.getUTCFullYear(), nextDate.getUTCMonth() + 1, nextDate.getUTCDate(), 0, 0, 0);
  return { start, end };
}

export interface ListMessagesOptions {
  chatJid?: string;
  date?: string; // Formato YYYY-MM-DD no fuso horário configurado (padrão: America/Recife)
  timezone?: string; // Fuso horário IANA (padrão: America/Recife)
  sinceTimestamp?: number;
  untilTimestamp?: number;
  incomingOnly?: boolean;
  limit?: number; // 0 para sem limite, > 0 para quantidade específica (padrão: 50)
  offset?: number;
  order?: 'asc' | 'desc';
}

export interface MessageListItem extends MessageWithAttachments {
  chat_name: string;
}

export interface ListMessagesResult {
  messages: MessageListItem[];
  total: number;
  returned: number;
  has_more: boolean;
  next_offset: number | null;
  info?: string;
}

export function listMessages(options: ListMessagesOptions = {}): ListMessagesResult {
  const db = getDatabase();
  const {
    chatJid,
    date,
    timezone = 'America/Recife',
    sinceTimestamp,
    untilTimestamp,
    incomingOnly = false,
    limit = 50,
    offset = 0,
    order = 'desc'
  } = options;

  const whereClauses: string[] = [];
  const whereParams: (string | number)[] = [];

  if (chatJid) {
    const linked = getLinkedJids(chatJid);
    const placeholders = linked.map(() => '?').join(', ');
    whereClauses.push(`m.chat_jid IN (${placeholders})`);
    whereParams.push(...linked);
  }

  if (date) {
    const { start, end } = getDayBoundsInTimezone(date, timezone);
    whereClauses.push('m.timestamp >= ?');
    whereParams.push(start);
    whereClauses.push('m.timestamp < ?');
    whereParams.push(end);
  }

  if (sinceTimestamp !== undefined) {
    whereClauses.push('m.timestamp >= ?');
    whereParams.push(sinceTimestamp);
  }

  if (untilTimestamp !== undefined) {
    whereClauses.push('m.timestamp <= ?');
    whereParams.push(untilTimestamp);
  }

  if (incomingOnly) {
    whereClauses.push('m.from_me = 0');
  }

  const whereSql = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(' AND ')}` : '';

  // 1. Contagem total de mensagens correspondentes aos filtros
  const countSql = `SELECT COUNT(*) as total FROM messages m${whereSql}`;
  const countRow = db.prepare(countSql).get(...whereParams) as { total: number } | undefined;
  const total = countRow ? countRow.total : 0;

  // 2. Consulta dos dados paginados (limit: 0 significa sem limite)
  const isUnlimited = limit === 0;
  const safeLimit = isUnlimited ? -1 : Math.max(1, limit);
  const safeOffset = Math.max(0, offset);
  const sortDirection = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const selectSql = `
    SELECT
      m.*,
      COALESCE(c.name, c.notify_name, m.chat_jid) as chat_name,
      CASE
        WHEN m.sender_jid = m.chat_jid THEN NULL
        ELSE COALESCE(
          (SELECT COALESCE(sc.name, sc.notify_name) FROM contacts sc WHERE sc.jid = m.sender_jid LIMIT 1),
          (SELECT COALESCE(cl.name, cl.notify_name) FROM jid_links jl JOIN contacts cl ON cl.jid = jl.jid2 WHERE jl.jid1 = m.sender_jid AND (cl.name IS NOT NULL OR cl.notify_name IS NOT NULL) LIMIT 1),
          NULL
        )
      END AS sender_name
    FROM messages m
    LEFT JOIN contacts c ON c.jid = m.chat_jid
    ${whereSql}
    ORDER BY m.timestamp ${sortDirection}, m.id ${sortDirection}
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(selectSql).all(...whereParams, safeLimit, safeOffset) as (Message & { chat_name: string })[];

  const messages: MessageListItem[] = rows.map((m) => ({
    ...m,
    chat_name: m.chat_name || m.chat_jid,
    attachments: getAttachmentsByMessageId(m.id)
  }));

  const returned = messages.length;
  const has_more = !isUnlimited && safeOffset + returned < total;
  const next_offset = has_more ? safeOffset + returned : null;

  let info: string | undefined;
  if (has_more && next_offset !== null) {
    const remaining = total - (safeOffset + returned);
    const pageSize = limit > 0 ? limit : 50;
    info = `Existem mais mensagens que não foram retornadas nesta chamada (${remaining} restantes). Para obter as próximas mensagens, passe offset: ${next_offset} (com limit: ${pageSize}). Para retornar todas as mensagens sem paginação de uma só vez, passe limit: 0.`;
  }

  return {
    messages,
    total,
    returned,
    has_more,
    next_offset,
    ...(info ? { info } : {})
  };
}

export interface SearchResultItem {
  message_id: string;
  chat_jid: string;
  content: string | null;
  transcription_text: string | null;
  timestamp: number;
  sender_jid: string;
  sender_name?: string | null;
  from_me: number;
  message_type: string;
}

export function searchMessages(
  query: string,
  chatJid?: string,
  limit = 20,
  offset = 0
): SearchResultItem[] {
  const db = getDatabase();

  // Escapa caracteres especiais do FTS5
  const sanitized = query.replace(/['"*]/g, ' ').trim();
  if (!sanitized) return [];

  // Constrói termo de busca FTS (prefix search)
  const ftsQuery = sanitized.split(/\s+/).map((word) => `"${word}"*`).join(' AND ');

  let sql = `
    SELECT
      f.message_id,
      f.chat_jid,
      f.content,
      f.transcription_text,
      m.timestamp,
      m.sender_jid,
      CASE
        WHEN m.sender_jid = m.chat_jid THEN NULL
        ELSE COALESCE(
          (SELECT COALESCE(c.name, c.notify_name) FROM contacts c WHERE c.jid = m.sender_jid LIMIT 1),
          (SELECT COALESCE(cl.name, cl.notify_name) FROM jid_links jl JOIN contacts cl ON cl.jid = jl.jid2 WHERE jl.jid1 = m.sender_jid AND (cl.name IS NOT NULL OR cl.notify_name IS NOT NULL) LIMIT 1),
          NULL
        )
      END AS sender_name,
      m.from_me,
      m.message_type
    FROM messages_fts f
    JOIN messages m ON m.id = f.message_id
    WHERE messages_fts MATCH ?
  `;

  const params: (string | number)[] = [ftsQuery];

  if (chatJid) {
    const linked = getLinkedJids(chatJid);
    const placeholders = linked.map(() => '?').join(', ');
    sql += ` AND f.chat_jid IN (${placeholders})`;
    params.push(...linked);
  }

  sql += ' ORDER BY m.timestamp DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  try {
    return db.prepare(sql).all(...params) as SearchResultItem[];
  } catch (err) {
    // Fallback para LIKE case-insensitive caso a sintaxe FTS falhe em palavras pontuais
    console.warn('Fallback para LIKE na busca:', err);
    const likeTerm = `%${sanitized}%`;
    let chatClause = '';
    const likeParams: (string | number)[] = [likeTerm, likeTerm];
    if (chatJid) {
      const linked = getLinkedJids(chatJid);
      const placeholders = linked.map(() => '?').join(', ');
      chatClause = `AND m.chat_jid IN (${placeholders})`;
      likeParams.push(...linked);
    }
    likeParams.push(limit, offset);

    const likeSql = `
      SELECT
        m.id as message_id,
        m.chat_jid,
        m.content,
        a.transcription_text,
        m.timestamp,
        m.sender_jid,
        CASE
          WHEN m.sender_jid = m.chat_jid THEN NULL
          ELSE COALESCE(
            (SELECT COALESCE(c.name, c.notify_name) FROM contacts c WHERE c.jid = m.sender_jid LIMIT 1),
            (SELECT COALESCE(cl.name, cl.notify_name) FROM jid_links jl JOIN contacts cl ON cl.jid = jl.jid2 WHERE jl.jid1 = m.sender_jid AND (cl.name IS NOT NULL OR cl.notify_name IS NOT NULL) LIMIT 1),
            NULL
          )
        END AS sender_name,
        m.from_me,
        m.message_type
      FROM messages m
      LEFT JOIN attachments a ON a.message_id = m.id
      WHERE (m.content LIKE ? OR a.transcription_text LIKE ?)
      ${chatClause}
      ORDER BY m.timestamp DESC
      LIMIT ? OFFSET ?
    `;
    return db.prepare(likeSql).all(...likeParams) as SearchResultItem[];
  }
}
