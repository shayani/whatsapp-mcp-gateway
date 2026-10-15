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

export function updateContactName(jid: string, name: string): void {
  const db = getDatabase();
  db.prepare('UPDATE contacts SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE jid = ?')
    .run(name, jid);
}

export function listContacts(search?: string, limit = 50, offset = 0): Contact[] {
  const db = getDatabase();
  if (search && search.trim().length > 0) {
    const term = `%${search.trim()}%`;
    return db.prepare(`
      SELECT * FROM contacts
      WHERE unaccent(COALESCE(name, '')) LIKE unaccent(?)
         OR unaccent(COALESCE(notify_name, '')) LIKE unaccent(?)
         OR jid LIKE ?
      ORDER BY last_message_timestamp DESC, updated_at DESC
      LIMIT ? OFFSET ?
    `).all(term, term, term, limit, offset) as Contact[];
  }

  return db.prepare(`
    SELECT * FROM contacts
    ORDER BY last_message_timestamp DESC, updated_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as Contact[];
}

export function getIgnoredJidsSet(): Set<string> {
  const db = getDatabase();
  const rows = db.prepare('SELECT jid FROM contacts WHERE is_ignored = 1').all() as { jid: string }[];
  return new Set(rows.map((r) => r.jid));
}
