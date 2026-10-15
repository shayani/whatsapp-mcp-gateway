import { getDatabase } from './index.js';

export interface Contact {
  jid: string;
  name: string | null;
  notify_name: string | null;
  is_group: number;
  is_ignored: number;
  unread_count: number;
  last_message_timestamp: number;
  created_at?: string;
  updated_at?: string;
}

export function upsertContact(contact: Partial<Contact> & { jid: string }): void {
  const db = getDatabase();
  const existing = db.prepare('SELECT * FROM contacts WHERE jid = ?').get(contact.jid) as Contact | undefined;

  const isGroup = contact.jid.endsWith('@g.us') ? 1 : 0;

  if (existing) {
    db.prepare(`
      UPDATE contacts SET
        name = COALESCE(?, name),
        notify_name = COALESCE(?, notify_name),
        unread_count = COALESCE(?, unread_count),
        last_message_timestamp = MAX(last_message_timestamp, ?),
        updated_at = CURRENT_TIMESTAMP
      WHERE jid = ?
    `).run(
      contact.name ?? null,
      contact.notify_name ?? null,
      contact.unread_count ?? null,
      contact.last_message_timestamp ?? existing.last_message_timestamp,
      contact.jid
    );
  } else {
    db.prepare(`
      INSERT INTO contacts (
        jid, name, notify_name, is_group, is_ignored, unread_count, last_message_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      contact.jid,
      contact.name ?? null,
      contact.notify_name ?? null,
      isGroup,
      contact.is_ignored ?? 0,
      contact.unread_count ?? 0,
      contact.last_message_timestamp ?? 0
    );
  }
}

export function getContact(jid: string): Contact | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM contacts WHERE jid = ?').get(jid) as Contact | undefined;
}

export function toggleIgnoreContact(jid: string, isIgnored: boolean): void {
  const db = getDatabase();
  // Se o contato ainda não estiver no banco, cria-o antes de setar is_ignored
  const existing = getContact(jid);
  if (!existing) {
    upsertContact({ jid, is_ignored: isIgnored ? 1 : 0 });
  } else {
    db.prepare('UPDATE contacts SET is_ignored = ?, updated_at = CURRENT_TIMESTAMP WHERE jid = ?')
      .run(isIgnored ? 1 : 0, jid);
  }
}

export function linkJids(jid1: string, jid2: string): void {
  if (!jid1 || !jid2 || jid1 === jid2) return;
  const db = getDatabase();
  const stmt = db.prepare('INSERT OR IGNORE INTO jid_links (jid1, jid2) VALUES (?, ?)');
  db.transaction(() => {
    stmt.run(jid1, jid2);
    stmt.run(jid2, jid1);
  })();
}

export function getLinkedJids(jid: string): string[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT jid2 FROM jid_links WHERE jid1 = ?').all(jid) as { jid2: string }[];
  return [jid, ...rows.map((r) => r.jid2)];
}

export function updateContactName(jid: string, name: string): void {
  const db = getDatabase();
  db.prepare('UPDATE contacts SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE jid = ?')
    .run(name, jid);
}

export function listContacts(search?: string, limit = 50, offset = 0): Contact[] {
  const db = getDatabase();
  // Filtro de desduplicação: se houver jid_links, só exibe o JID que tiver a mensagem mais recente
  const deduplicateClause = `
    NOT EXISTS (
      SELECT 1 FROM jid_links jl
      JOIN contacts c2 ON c2.jid = jl.jid2
      WHERE jl.jid1 = contacts.jid AND (
        c2.last_message_timestamp > contacts.last_message_timestamp
        OR (c2.last_message_timestamp = contacts.last_message_timestamp AND contacts.jid LIKE '%@lid')
      )
    )
  `;

  if (search && search.trim().length > 0) {
    const term = `%${search.trim()}%`;
    return db.prepare(`
      SELECT * FROM contacts
      WHERE (${deduplicateClause})
        AND (
          unaccent(COALESCE(name, '')) LIKE unaccent(?)
          OR unaccent(COALESCE(notify_name, '')) LIKE unaccent(?)
          OR jid LIKE ?
        )
      ORDER BY last_message_timestamp DESC, updated_at DESC
      LIMIT ? OFFSET ?
    `).all(term, term, term, limit, offset) as Contact[];
  }

  return db.prepare(`
    SELECT * FROM contacts
    WHERE ${deduplicateClause}
    ORDER BY last_message_timestamp DESC, updated_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as Contact[];
}

export function getIgnoredJidsSet(): Set<string> {
  const db = getDatabase();
  const rows = db.prepare('SELECT jid FROM contacts WHERE is_ignored = 1').all() as { jid: string }[];
  return new Set(rows.map((r) => r.jid));
}
