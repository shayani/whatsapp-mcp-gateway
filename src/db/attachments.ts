import { getDatabase } from './index.js';

export interface Attachment {
  id: string;
  message_id: string;
  file_path: string;
  file_name: string | null;
  mimetype: string;
  file_size: number | null;
  sha256: string | null;
  transcription_text: string | null;
  transcription_status: 'none' | 'pending' | 'completed' | 'failed' | 'skipped';
  created_at?: string;
}

export function insertAttachment(att: Attachment): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO attachments (
      id, message_id, file_path, file_name, mimetype, file_size, sha256, transcription_text, transcription_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    att.id,
    att.message_id,
    att.file_path,
    att.file_name ?? null,
    att.mimetype,
    att.file_size ?? null,
    att.sha256 ?? null,
    att.transcription_text ?? null,
    att.transcription_status ?? 'none'
  );
}

export function getAttachment(id: string): Attachment | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as Attachment | undefined;
}

export function getAttachmentsByMessageId(messageId: string): Attachment[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM attachments WHERE message_id = ?').all(messageId) as Attachment[];
}

export function updateTranscription(
  id: string,
  transcriptionText: string,
  status: 'completed' | 'failed' | 'skipped'
): void {
  const db = getDatabase();

  const updateStmt = db.prepare(`
    UPDATE attachments
    SET transcription_text = ?, transcription_status = ?
    WHERE id = ?
  `);

  const tx = db.transaction(() => {
    updateStmt.run(transcriptionText, status, id);

    // Atualiza o índice FTS5 com a nova transcrição
    const att = getAttachment(id);
    if (att && status === 'completed') {
      const msg = db.prepare('SELECT chat_jid, content FROM messages WHERE id = ?').get(att.message_id) as
        | { chat_jid: string; content: string | null }
        | undefined;

      if (msg) {
        // Remove entrada anterior do FTS e insere a atualizada
        db.prepare('DELETE FROM messages_fts WHERE message_id = ?').run(att.message_id);
        db.prepare(`
          INSERT INTO messages_fts (message_id, chat_jid, content, transcription_text)
          VALUES (?, ?, ?, ?)
        `).run(att.message_id, msg.chat_jid, msg.content ?? '', transcriptionText);
      }
    }
  });

  tx();
}

export function getPendingAudioTranscriptions(limit = 10): Attachment[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM attachments
    WHERE transcription_status = 'pending'
    ORDER BY created_at ASC
    LIMIT ?
  `).all(limit) as Attachment[];
}
