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

    updateContactStmt.run(msg.timestamp, msg.chat_jid);
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
  beforeTimestamp?: number
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

  query += ' ORDER BY m.timestamp DESC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(query).all(...params) as Message[];

  // Inverte para retornar em ordem cronológica ascendente
  const messagesChronological = rows.reverse();

  return messagesChronological.map((m) => ({
    ...m,
    attachments: getAttachmentsByMessageId(m.id)
  }));
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
    sql += ' AND f.chat_jid = ?';
    params.push(chatJid);
  }

  sql += ' ORDER BY m.timestamp DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  try {
    return db.prepare(sql).all(...params) as SearchResultItem[];
  } catch (err) {
    // Fallback para LIKE case-insensitive caso a sintaxe FTS falhe em palavras pontuais
    console.warn('Fallback para LIKE na busca:', err);
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
      ${chatJid ? 'AND m.chat_jid = ?' : ''}
      ORDER BY m.timestamp DESC
      LIMIT ? OFFSET ?
    `;
    const likeTerm = `%${sanitized}%`;
    const likeParams = [likeTerm, likeTerm];
    if (chatJid) likeParams.push(chatJid);
    likeParams.push(String(limit), String(offset));
    return db.prepare(likeSql).all(...likeParams) as SearchResultItem[];
  }
}
