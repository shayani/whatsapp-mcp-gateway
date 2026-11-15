import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-gateway-img-test-'));
process.env.DATA_DIR = tempDir;

const { getDatabase } = await import('../src/db/index.js');
const { upsertContact } = await import('../src/db/contacts.js');
const { insertMessage, searchMessages } = await import('../src/db/messages.js');
const { insertAttachment, getAttachment } = await import('../src/db/attachments.js');
const { setSetting, setImageTranscriptionEnabled, isImageTranscriptionEnabled } = await import('../src/db/settings.js');
const { config } = await import('../src/config.js');
const {
  isAudioMimetype,
  isTranscribableImage,
  buildImageTranscriptionPrompt,
  prepareImageForVision,
  MAX_VISION_IMAGE_BYTES
} = await import('../src/transcription/image.js');
const { transcriptionQueue } = await import('../src/transcription/queue.js');
const { createServer } = await import('../src/server/app.js');

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function createTempImageFile(name: string, buffer: Buffer): string {
  const dir = path.join(tempDir, 'media', 'test-chat');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

test.after(() => {
  transcriptionQueue.resetProviders();
  try {
    getDatabase().close();
  } catch {}
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});

test('Classificação de mídias: áudio, imagem, documento image/* e exclusão de figurinhas/SVG', () => {
  assert.equal(isAudioMimetype('audio/ogg; codecs=opus'), true);
  assert.equal(isAudioMimetype('image/jpeg'), false);

  assert.equal(isTranscribableImage('image/jpeg', 'image'), true);
  assert.equal(isTranscribableImage('image/png', 'document'), true);
  assert.equal(isTranscribableImage('image/webp', 'image'), true);
  assert.equal(isTranscribableImage('image/webp', 'sticker'), false);
  assert.equal(isTranscribableImage('image/svg+xml', 'document'), false);
  assert.equal(isTranscribableImage('application/pdf', 'document'), false);
});

test('Prompt B1 de imagem inclui instrução objetiva e legenda opcional como contexto', () => {
  const withoutCaption = buildImageTranscriptionPrompt('pt');
  assert.match(withoutCaption, /1 a 3 frases/);
  assert.doesNotMatch(withoutCaption, /Contexto da legenda/);

  const withCaption = buildImageTranscriptionPrompt('pt', 'Comprovante do aluguel');
  assert.match(withCaption, /Contexto da legenda enviada junto com a imagem: "Comprovante do aluguel"/);

  const englishPrompt = buildImageTranscriptionPrompt('en', 'Receipt');
  assert.match(englishPrompt, /1 to 3 short and objective sentences/);
  assert.match(englishPrompt, /"Receipt"/);
});

test('prepareImageForVision mantém imagens pequenas intactas e redimensiona imagens grandes via ffmpeg', async () => {
  const smallPath = createTempImageFile('small.png', Buffer.from(TINY_PNG_BASE64, 'base64'));
  const smallPrepared = await prepareImageForVision(smallPath, 'image/png');
  assert.equal(smallPrepared.resized, false);
  assert.equal(smallPrepared.mimetype, 'image/png');
  assert.equal(smallPrepared.base64, TINY_PNG_BASE64);

  // Gera PNG ruidoso > MAX_VISION_IMAGE_BYTES com ffmpeg para validar compressão temporária
  const bigPngPath = path.join(tempDir, 'media', 'test-chat', 'big.png');
  execFileSync('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'nullsrc=s=1800x1800,geq=random(1)*255:128:128',
    '-frames:v',
    '1',
    bigPngPath
  ], { stdio: 'ignore' });
  const originalSize = fs.statSync(bigPngPath).size;
  assert.ok(originalSize > MAX_VISION_IMAGE_BYTES, `PNG gerado deve exceder limite (${originalSize})`);

  const bigPrepared = await prepareImageForVision(bigPngPath, 'image/png');
  assert.equal(bigPrepared.resized, true);
  assert.equal(bigPrepared.mimetype, 'image/jpeg');
  assert.ok(Buffer.from(bigPrepared.base64, 'base64').length <= MAX_VISION_IMAGE_BYTES);
  assert.equal(fs.statSync(bigPngPath).size, originalSize, 'Arquivo original em disco deve permanecer intocado');
});

test('Fila de transcrição processa imagens recebidas/enviadas com legenda, indexa no FTS5 e respeita fallback OpenAI', async () => {
  const chatJid = '5583999990001@s.whatsapp.net';
  upsertContact({ jid: chatJid, name: 'Maria Foto', is_group: 0, is_ignored: 0 });

  const imgPath1 = createTempImageFile('photo1.png', Buffer.from(TINY_PNG_BASE64, 'base64'));
  const imgPath2 = createTempImageFile('photo2.png', Buffer.from(TINY_PNG_BASE64, 'base64'));
  const stickerPath = createTempImageFile('sticker1.webp', Buffer.from(TINY_PNG_BASE64, 'base64'));

  insertMessage({
    id: 'msg_img_received',
    chat_jid: chatJid,
    sender_jid: chatJid,
    from_me: 0,
    timestamp: 1792400000,
    message_type: 'image',
    content: 'Olha a nota fiscal'
  });
  insertAttachment({
    id: 'att_msg_img_received',
    message_id: 'msg_img_received',
    file_path: imgPath1,
    file_name: 'photo1.png',
    mimetype: 'image/png',
    file_size: 68,
    sha256: 'hash1',
    transcription_text: null,
    transcription_status: 'pending'
  });

  insertMessage({
    id: 'msg_img_sent',
    chat_jid: chatJid,
    sender_jid: chatJid,
    from_me: 1,
    timestamp: 1792400010,
    message_type: 'document',
    content: null
  });
  insertAttachment({
    id: 'att_msg_img_sent',
    message_id: 'msg_img_sent',
    file_path: imgPath2,
    file_name: 'photo2.png',
    mimetype: 'image/png',
    file_size: 68,
    sha256: 'hash2',
    transcription_text: null,
    transcription_status: 'pending'
  });

  insertMessage({
    id: 'msg_sticker',
    chat_jid: chatJid,
    sender_jid: chatJid,
    from_me: 0,
    timestamp: 1792400020,
    message_type: 'sticker',
    content: null
  });
  insertAttachment({
    id: 'att_msg_sticker',
    message_id: 'msg_sticker',
    file_path: stickerPath,
    file_name: 'sticker1.webp',
    mimetype: 'image/webp',
    file_size: 68,
    sha256: 'hash3',
    transcription_text: null,
    transcription_status: 'none'
  });

  const groqCalls: Array<{ filePath: string; mimetype: string; caption?: string | null }> = [];
  const openaiCalls: Array<{ filePath: string; mimetype: string; caption?: string | null }> = [];

  transcriptionQueue.setProviders({
    transcribeImageWithGroq: async (filePath, mimetype, caption) => {
      groqCalls.push({ filePath, mimetype, caption });
      return caption
        ? `Comprovante bancário PIX de R$ 150,00 enviado (${caption}).`
        : 'Foto enviada sem legenda mostrando uma paisagem urbana.';
    },
    transcribeImageWithOpenAI: async (filePath, mimetype, caption) => {
      openaiCalls.push({ filePath, mimetype, caption });
      return 'Foto de um gráfico financeiro com metas trimestrais.';
    }
  });

  setSetting('groq_api_key', 'gsk_test_key');
  setImageTranscriptionEnabled(true);
  await transcriptionQueue.processPending();

  assert.equal(groqCalls.length, 2);
  assert.equal(groqCalls[0].caption, 'Olha a nota fiscal');
  assert.equal(groqCalls[1].caption, null);

  const att1 = getAttachment('att_msg_img_received');
  assert.equal(att1?.transcription_status, 'completed');
  assert.match(att1?.transcription_text || '', /Comprovante bancário PIX/);

  // Busca FTS5 encontra a mensagem pelo texto transcrito da imagem
  const ftsHits = searchMessages('PIX', chatJid);
  assert.equal(ftsHits.length, 1);
  assert.equal(ftsHits[0].message_id, 'msg_img_received');

  // Figurinha não pode ser transcrita nem sob demanda
  await assert.rejects(
    () => transcriptionQueue.transcribeAttachmentNow('att_msg_sticker'),
    /não suportado/
  );

  // Fallback para OpenAI quando apenas OPENAI_API_KEY está configurada
  setSetting('groq_api_key', '');
  const prevOpenAiKey = config.openaiApiKey;
  config.openaiApiKey = 'sk-test-openai';
  try {
    const updated = await transcriptionQueue.transcribeAttachmentNow('att_msg_img_sent', { force: true });
    assert.equal(openaiCalls.length, 1);
    assert.equal(updated.transcription_status, 'completed');
    assert.match(updated.transcription_text || '', /gráfico financeiro/);
  } finally {
    config.openaiApiKey = prevOpenAiKey;
  }
});

test('Toggle independente e endpoint sob demanda POST /api/ui/attachments/:id/transcribe', async () => {
  const chatJid = '5583999990002@s.whatsapp.net';
  upsertContact({ jid: chatJid, name: 'João Toggle', is_group: 0, is_ignored: 0 });
  const imgPath = createTempImageFile('manual.png', Buffer.from(TINY_PNG_BASE64, 'base64'));

  insertMessage({
    id: 'msg_img_manual',
    chat_jid: chatJid,
    sender_jid: chatJid,
    from_me: 0,
    timestamp: 1792400100,
    message_type: 'image',
    content: null
  });
  insertAttachment({
    id: 'att_msg_img_manual',
    message_id: 'msg_img_manual',
    file_path: imgPath,
    file_name: 'manual.png',
    mimetype: 'image/png',
    file_size: 68,
    sha256: 'hash_manual',
    transcription_text: null,
    transcription_status: 'none'
  });

  setSetting('groq_api_key', 'gsk_test_manual');
  transcriptionQueue.setProviders({
    transcribeImageWithGroq: async () => 'Foto de um quadro branco com anotações de arquitetura.'
  });

  const app = await createServer();
  try {
    // Desativa transcrição automática via API de settings
    const toggleRes = await app.inject({
      method: 'POST',
      url: '/api/ui/settings',
      payload: { image_transcription_enabled: false }
    });
    assert.equal(toggleRes.statusCode, 200);
    assert.equal(isImageTranscriptionEnabled(), false);

    const settingsRes = await app.inject({ method: 'GET', url: '/api/ui/settings' });
    assert.equal(settingsRes.statusCode, 200);
    const settingsJson = settingsRes.json();
    assert.equal(settingsJson.imageTranscriptionEnabled, false);
    assert.equal(settingsJson.hasGroqKey, true);

    // Mesmo com o automático desligado, o botão sob demanda funciona
    const transcribeRes = await app.inject({
      method: 'POST',
      url: '/api/ui/attachments/att_msg_img_manual/transcribe'
    });
    assert.equal(transcribeRes.statusCode, 200);
    const body = transcribeRes.json();
    assert.equal(body.success, true);
    assert.equal(body.attachment.transcription_status, 'completed');
    assert.match(body.attachment.transcription_text, /quadro branco/);
  } finally {
    await app.close();
  }
});
