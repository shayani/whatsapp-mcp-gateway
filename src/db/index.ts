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
      unread_count INTEGER DEFAULT 0,
      last_message_timestamp INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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
}
