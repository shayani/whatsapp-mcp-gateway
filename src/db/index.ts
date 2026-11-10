import Database from 'better-sqlite3';
import path from 'node:path';
import { config } from '../config.js';

let dbInstance: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = path.join(config.dbDir, 'whatsapp.db');
  dbInstance = new Database(dbPath);

  // Otimizações de concorrência e integridade
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('synchronous = NORMAL');
  dbInstance.pragma('busy_timeout = 5000');
  dbInstance.pragma('foreign_keys = ON');

  // Função personalizada para busca insensível a acentuação
  dbInstance.function('unaccent', (str) =>
    typeof str === 'string' ? str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() : ''
  );

  initSchema(dbInstance);

  return dbInstance;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    -- Tabela de Configurações Dinâmicas (ex: Chave Groq via Web UI)
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Contatos e Grupos
    CREATE TABLE IF NOT EXISTS contacts (
      jid TEXT PRIMARY KEY,
      name TEXT,
      notify_name TEXT,
      is_group BOOLEAN DEFAULT 0,
      is_ignored BOOLEAN DEFAULT 0,
      allow_send BOOLEAN DEFAULT 0,
      unread_count INTEGER DEFAULT 0,
      last_message_timestamp INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Links entre identificadores alternativos (ex: @lid <-> @s.whatsapp.net do mesmo contato)
    CREATE TABLE IF NOT EXISTS jid_links (
      jid1 TEXT NOT NULL,
      jid2 TEXT NOT NULL,
      PRIMARY KEY (jid1, jid2)
    );
    CREATE INDEX IF NOT EXISTS idx_jid_links_jid1 ON jid_links(jid1);

    -- Mensagens
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_jid TEXT NOT NULL,
      sender_jid TEXT NOT NULL,
      from_me BOOLEAN NOT NULL,
      timestamp INTEGER NOT NULL,
      message_type TEXT NOT NULL, -- 'text', 'audio', 'image', 'video', 'document', 'sticker', 'other'
      content TEXT,
      raw_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(chat_jid) REFERENCES contacts(jid) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat_timestamp ON messages(chat_jid, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);

    -- Anexos e Mídias
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT,
      mimetype TEXT NOT NULL,
      file_size INTEGER,
      sha256 TEXT,
      transcription_text TEXT,
      transcription_status TEXT DEFAULT 'none', -- 'none', 'pending', 'completed', 'failed', 'skipped'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON attachments(message_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_transcription_status ON attachments(transcription_status);

    -- Tabela Virtual Full-Text Search (FTS5)
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      message_id UNINDEXED,
      chat_jid UNINDEXED,
      content,
      transcription_text,
      tokenize = 'unicode61'
    );
  `);

  // Migrações incrementais
  try {
    db.exec('ALTER TABLE contacts ADD COLUMN allow_send BOOLEAN DEFAULT 0;');
  } catch {
    // Coluna já existe
  }

  // Sincronização entre JIDs vinculados (ex: LID <-> Telefone)
  try {
    // 0. Garante que qualquer JID em jid_links exista na tabela contacts
    db.prepare(`
      INSERT OR IGNORE INTO contacts (jid, is_group)
      SELECT DISTINCT jl.jid1, CASE WHEN jl.jid1 LIKE '%@g.us' THEN 1 ELSE 0 END
      FROM jid_links jl
      WHERE NOT EXISTS (SELECT 1 FROM contacts c WHERE c.jid = jl.jid1)
    `).run();

    db.prepare(`
      INSERT OR IGNORE INTO contacts (jid, is_group)
      SELECT DISTINCT jl.jid2, CASE WHEN jl.jid2 LIKE '%@g.us' THEN 1 ELSE 0 END
      FROM jid_links jl
      WHERE NOT EXISTS (SELECT 1 FROM contacts c WHERE c.jid = jl.jid2)
    `).run();

    // 1. last_message_timestamp: garante que ambos os JIDs tenham o timestamp mais recente
    db.prepare(`
      UPDATE contacts
      SET last_message_timestamp = (
        SELECT MAX(c2.last_message_timestamp)
        FROM jid_links jl
        JOIN contacts c2 ON c2.jid = jl.jid2
        WHERE jl.jid1 = contacts.jid
      )
      WHERE EXISTS (
        SELECT 1
        FROM jid_links jl
        JOIN contacts c2 ON c2.jid = jl.jid2
        WHERE jl.jid1 = contacts.jid AND c2.last_message_timestamp > contacts.last_message_timestamp
      )
    `).run();

    // 2. Nomes e notify_names: propaga nomes faltantes entre JIDs vinculados
    db.prepare(`
      UPDATE contacts
      SET
        name = COALESCE(name, (
          SELECT c2.name
          FROM jid_links jl
          JOIN contacts c2 ON c2.jid = jl.jid2
          WHERE jl.jid1 = contacts.jid AND c2.name IS NOT NULL
          LIMIT 1
        )),
        notify_name = COALESCE(notify_name, (
          SELECT c2.notify_name
          FROM jid_links jl
          JOIN contacts c2 ON c2.jid = jl.jid2
          WHERE jl.jid1 = contacts.jid AND c2.notify_name IS NOT NULL
          LIMIT 1
        ))
      WHERE EXISTS (
        SELECT 1
        FROM jid_links jl
        JOIN contacts c2 ON c2.jid = jl.jid2
        WHERE jl.jid1 = contacts.jid AND (
          (contacts.name IS NULL AND c2.name IS NOT NULL) OR
          (contacts.notify_name IS NULL AND c2.notify_name IS NOT NULL)
        )
      )
    `).run();

    // 3. Flags allow_send e is_ignored entre vinculados
    db.prepare(`
      UPDATE contacts
      SET
        allow_send = (
          SELECT MAX(c2.allow_send)
          FROM jid_links jl
          JOIN contacts c2 ON c2.jid = jl.jid2
          WHERE jl.jid1 = contacts.jid
        ),
        is_ignored = (
          SELECT MAX(c2.is_ignored)
          FROM jid_links jl
          JOIN contacts c2 ON c2.jid = jl.jid2
          WHERE jl.jid1 = contacts.jid
        )
      WHERE EXISTS (
        SELECT 1
        FROM jid_links jl
        JOIN contacts c2 ON c2.jid = jl.jid2
        WHERE jl.jid1 = contacts.jid AND (
          c2.allow_send > contacts.allow_send OR
          c2.is_ignored > contacts.is_ignored
        )
      )
    `).run();
  } catch (err) {
    console.warn('[DB] Erro ao sincronizar JIDs vinculados:', err);
  }
}

