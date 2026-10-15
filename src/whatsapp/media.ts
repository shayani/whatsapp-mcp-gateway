import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pino from 'pino';
import { downloadMediaMessage, type WAMessage } from '@whiskeysockets/baileys';
import { config } from '../config.js';
import { insertAttachment } from '../db/attachments.js';
import { transcriptionQueue } from '../transcription/queue.js';

const mediaLogger = pino({ level: 'silent' });

function getExtensionFromMime(mime: string): string {
  const cleanMime = mime.split(';')[0].trim().toLowerCase();
  switch (cleanMime) {
    case 'audio/ogg':
    case 'audio/ogg; codecs=opus':
      return 'ogg';
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'video/mp4':
      return 'mp4';
    case 'application/pdf':
      return 'pdf';
    default:
      return 'bin';
  }
}

export async function handleMediaDownload(
  msg: WAMessage,
  messageId: string,
  chatJid: string,
  mimetype: string,
  fileName?: string
): Promise<void> {
  try {
    const ext = getExtensionFromMime(mimetype);
    const chatMediaDir = path.join(config.mediaDir, chatJid.replace(/[^a-zA-Z0-9@._-]/g, '_'));

    if (!fs.existsSync(chatMediaDir)) {
      fs.mkdirSync(chatMediaDir, { recursive: true });
    }

    const safeFilename = `${messageId}.${ext}`;
    const targetFilePath = path.join(chatMediaDir, safeFilename);

    // Se o arquivo já foi baixado anteriormente, não baixa novamente
    if (fs.existsSync(targetFilePath)) {
      return;
    }

    // Baixa o buffer descriptografado via Baileys
    const buffer = await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        logger: mediaLogger,
        reuploadRequest: () => Promise.resolve(null as any)
      }
    );

    if (!buffer || buffer.length === 0) {
      return;
    }

    fs.writeFileSync(targetFilePath, buffer);

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const isAudio = mimetype.startsWith('audio/') || mimetype.includes('ogg');

    const attachmentId = `att_${messageId}`;

    insertAttachment({
      id: attachmentId,
      message_id: messageId,
      file_path: targetFilePath,
      file_name: fileName || safeFilename,
      mimetype,
      file_size: buffer.length,
      sha256,
      transcription_text: null,
      transcription_status: isAudio ? 'pending' : 'none'
    });

    if (isAudio) {
      transcriptionQueue.notifyNewAudio();
    }
  } catch (err) {
    console.error(`Erro ao baixar anexo da mensagem ${messageId}:`, err);
  }
}
