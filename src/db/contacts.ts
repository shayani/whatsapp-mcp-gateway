import { getDatabase } from './index.js';

export interface Contact {
  jid: string;
  name: string | null;
  notify_name: string | null;
  is_group: number;
  is_ignored: number;
  allow_send?: number;
  unread_count: number;
  last_message_timestamp: number;
  linked_phone?: string | null;
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
        allow_send = COALESCE(?, allow_send),
        unread_count = COALESCE(?, unread_count),
        last_message_timestamp = MAX(last_message_timestamp, ?),
        updated_at = CURRENT_TIMESTAMP
      WHERE jid = ?
    `).run(
      contact.name ?? null,
      contact.notify_name ?? null,
      contact.allow_send ?? null,
      contact.unread_count ?? null,
      contact.last_message_timestamp ?? existing.last_message_timestamp,
      contact.jid
    );
  } else {
    db.prepare(`
      INSERT INTO contacts (
        jid, name, notify_name, is_group, is_ignored, allow_send, unread_count, last_message_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      contact.jid,
      contact.name ?? null,
      contact.notify_name ?? null,
      isGroup,
      contact.is_ignored ?? 0,
      contact.allow_send ?? 0,
      contact.unread_count ?? 0,
      contact.last_message_timestamp ?? 0
    );
  }

  // Se houver timestamp atualizado, propaga para todos os JIDs vinculados
  if (contact.last_message_timestamp && contact.last_message_timestamp > 0) {
    const linked = getLinkedJids(contact.jid);
    if (linked.length > 1) {
      const placeholders = linked.map(() => '?').join(', ');
      db.prepare(`
        UPDATE contacts SET
          last_message_timestamp = MAX(last_message_timestamp, ?),
          updated_at = CURRENT_TIMESTAMP
        WHERE jid IN (${placeholders})
      `).run(contact.last_message_timestamp, ...linked);
    }
  }
}

export function getContact(jid: string): Contact | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM contacts WHERE jid = ?').get(jid) as Contact | undefined;
}

export function toggleIgnoreContact(jid: string, isIgnored: boolean): void {
  const db = getDatabase();
  const linked = getLinkedJids(jid);
  const placeholders = linked.map(() => '?').join(', ');

  const existing = getContact(jid);
  if (!existing) {
    upsertContact({ jid, is_ignored: isIgnored ? 1 : 0 });
  }

  db.prepare(`UPDATE contacts SET is_ignored = ?, updated_at = CURRENT_TIMESTAMP WHERE jid IN (${placeholders})`)
    .run(isIgnored ? 1 : 0, ...linked);
}

export function toggleAllowSendContact(jid: string, allowSend: boolean): void {
  const db = getDatabase();
  const linked = getLinkedJids(jid);
  const placeholders = linked.map(() => '?').join(', ');

  const existing = getContact(jid);
  if (!existing) {
    upsertContact({ jid, allow_send: allowSend ? 1 : 0 });
  }

  db.prepare(`UPDATE contacts SET allow_send = ?, updated_at = CURRENT_TIMESTAMP WHERE jid IN (${placeholders})`)
    .run(allowSend ? 1 : 0, ...linked);
}

export function isSendAllowedForContact(jid: string): boolean {
  const db = getDatabase();
  // Busca o contato e também qualquer JID vinculado (ex: LID <-> telefone)
  const linked = getLinkedJids(jid);
  const placeholders = linked.map(() => '?').join(', ');
  const row = db.prepare(`SELECT MAX(allow_send) as allowed FROM contacts WHERE jid IN (${placeholders})`).get(...linked) as
    | { allowed: number | null }
    | undefined;
  return Boolean(row?.allowed);
}

export function linkJids(jid1: string, jid2: string): void {
  if (!jid1 || !jid2 || jid1 === jid2) return;
  const db = getDatabase();
  const stmt = db.prepare('INSERT OR IGNORE INTO jid_links (jid1, jid2) VALUES (?, ?)');

  // Garante que ambos os JIDs existam na tabela contacts
  const c1 = getContact(jid1);
  const c2 = getContact(jid2);

  if (!c1) {
    upsertContact({
      jid: jid1,
      name: c2?.name ?? null,
      notify_name: c2?.notify_name ?? null,
      is_group: jid1.endsWith('@g.us') ? 1 : 0,
      is_ignored: c2?.is_ignored ?? 0,
      allow_send: c2?.allow_send ?? 0,
      last_message_timestamp: c2?.last_message_timestamp ?? 0
    });
  }

  if (!c2) {
    upsertContact({
      jid: jid2,
      name: c1?.name ?? null,
      notify_name: c1?.notify_name ?? null,
      is_group: jid2.endsWith('@g.us') ? 1 : 0,
      is_ignored: c1?.is_ignored ?? 0,
      allow_send: c1?.allow_send ?? 0,
      last_message_timestamp: c1?.last_message_timestamp ?? 0
    });
  }

  // Sincroniza timestamp, flags e nomes entre ambos
  const syncStmt = db.prepare(`
    UPDATE contacts
    SET
      last_message_timestamp = (
        SELECT MAX(c.last_message_timestamp)
        FROM contacts c
        WHERE c.jid IN (?, ?)
      ),
      is_ignored = (
        SELECT MAX(c.is_ignored)
        FROM contacts c
        WHERE c.jid IN (?, ?)
      ),
      allow_send = (
        SELECT MAX(c.allow_send)
        FROM contacts c
        WHERE c.jid IN (?, ?)
      ),
      name = COALESCE(name, (
        SELECT c.name
        FROM contacts c
        WHERE c.jid IN (?, ?) AND c.name IS NOT NULL
        LIMIT 1
      )),
      notify_name = COALESCE(notify_name, (
        SELECT c.notify_name
        FROM contacts c
        WHERE c.jid IN (?, ?) AND c.notify_name IS NOT NULL
        LIMIT 1
      )),
      updated_at = CURRENT_TIMESTAMP
    WHERE jid IN (?, ?)
  `);

  db.transaction(() => {
    stmt.run(jid1, jid2);
    stmt.run(jid2, jid1);
    syncStmt.run(jid1, jid2, jid1, jid2, jid1, jid2, jid1, jid2, jid1, jid2, jid1, jid2);
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

function normalizeSearchWord(word: string): string[] {
  const clean = word
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  if (!clean) return [];

  // Tratamento de sinônimos comuns: junior / jr
  if (clean === 'junior' || clean === 'jr') {
    return ['%jr%', '%junior%'];
  }
  return [`%${clean}%`];
}

export function listContacts(search?: string, limit = 50, offset = 0): Contact[] {
  const db = getDatabase();
  const selectClause = `
    SELECT contacts.*,
      (
        SELECT jl.jid2
        FROM jid_links jl
        WHERE jl.jid1 = contacts.jid AND jl.jid2 LIKE '%@s.whatsapp.net'
        LIMIT 1
      ) AS linked_phone
    FROM contacts
  `;

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
    const words = search.trim().split(/\s+/).filter(Boolean);
    const wordClauses: string[] = [];
    const wordParams: string[] = [];

    for (const w of words) {
      const patterns = normalizeSearchWord(w);
      if (patterns.length === 0) continue;

      const subClauses: string[] = [];
      for (const p of patterns) {
        subClauses.push(`(
          unaccent(COALESCE(contacts.name, '')) LIKE ?
          OR unaccent(COALESCE(contacts.notify_name, '')) LIKE ?
          OR contacts.jid LIKE ?
          OR EXISTS (
            SELECT 1 FROM jid_links jl
            JOIN contacts cl ON cl.jid = jl.jid2
            WHERE jl.jid1 = contacts.jid AND (
              unaccent(COALESCE(cl.name, '')) LIKE ?
              OR unaccent(COALESCE(cl.notify_name, '')) LIKE ?
              OR cl.jid LIKE ?
            )
          )
        )`);
        wordParams.push(p, p, p, p, p, p);
      }
      wordClauses.push(`(${subClauses.join(' OR ')})`);
    }

    if (wordClauses.length > 0) {
      return db.prepare(`
        ${selectClause}
        WHERE (${deduplicateClause})
          AND ${wordClauses.join(' AND ')}
        ORDER BY last_message_timestamp DESC, updated_at DESC
        LIMIT ? OFFSET ?
      `).all(...wordParams, limit, offset) as Contact[];
    }
  }

  return db.prepare(`
    ${selectClause}
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
