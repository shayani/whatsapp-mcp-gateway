import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-gateway-pdf-test-'));
process.env.DATA_DIR = tempDir;

const { getDatabase } = await import('../src/db/index.js');
const { upsertContact } = await import('../src/db/contacts.js');
const { insertMessage, searchMessages } = await import('../src/db/messages.js');
const { insertAttachment, getAttachment } = await import('../src/db/attachments.js');
const { setSetting, setPdfTranscriptionEnabled, isPdfTranscriptionEnabled } = await import('../src/db/settings.js');
const { config } = await import('../src/config.js');
const {
  isPdfAttachment,
  buildPdfSummaryPrompt,
  extractPdfContentForSummary
} = await import('../src/transcription/pdf.js');
const { transcriptionQueue } = await import('../src/transcription/queue.js');
const { createServer } = await import('../src/server/app.js');

function createTextPdf(fileName: string, textLines: string[]): string {
  const dir = path.join(tempDir, 'media', 'pdf-chat');
  fs.mkdirSync(dir, { recursive: true });
  const psPath = path.join(dir, `${fileName}.ps`);
  const pdfPath = path.join(dir, fileName);

  const psBody = [
    '%!PS-Adobe-3.0',
    '/Helvetica findfont 14 scalefont setfont',
    ...textLines.map((line, idx) => `72 ${720 - idx * 24} moveto (${line.replace(/[()\\]/g, '\\$&')}) show`),
    'showpage'
  ].join('\n');

  fs.writeFileSync(psPath, psBody, 'utf-8');
  execFileSync('gs', ['-q', '-dBATCH', '-dNOPAUSE', '-sDEVICE=pdfwrite', `-sOutputFile=${pdfPath}`, psPath]);
  fs.unlinkSync(psPath);
  return pdfPath;
}

function createImageOnlyPdf(fileName: string): string {
  const dir = path.join(tempDir, 'media', 'pdf-chat');
  fs.mkdirSync(dir, { recursive: true });
  const psPath = path.join(dir, `${fileName}.ps`);
  const pdfPath = path.join(dir, fileName);

  // Gera página somente com imagem raster desenhada via PostScript (sem texto extraível)
  const hexPixels = 'FF000000FF000000FF000000FF00'.repeat(16);
  const psBody = [
    '%!PS-Adobe-3.0',
    'gsave',
    '72 500 translate',
    '200 200 scale',
    '8 8 8 [8 0 0 -8 0 8]',
    `{ <${hexPixels.slice(0, 128)}> }`,
    'image',
    'grestore',
    'showpage'
  ].join('\n');

  fs.writeFileSync(psPath, psBody, 'utf-8');
  execFileSync('gs', ['-q', '-dBATCH', '-dNOPAUSE', '-sDEVICE=pdfwrite', `-sOutputFile=${pdfPath}`, psPath]);
  fs.unlinkSync(psPath);
  return pdfPath;
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

test('Classificação de PDF e geração de prompt B1 com deduplicação de nome/legenda', () => {
  assert.equal(isPdfAttachment('application/pdf'), true);
  assert.equal(isPdfAttachment('application/octet-stream', 'fatura_11_2026.pdf'), true);
  assert.equal(isPdfAttachment('application/octet-stream', 'planilha.xlsx'), false);
  assert.equal(isPdfAttachment('image/jpeg', 'foto.jpg'), false);

  const deduped = buildPdfSummaryPrompt('pt', {
    fileName: 'fatura_11_2026.pdf',
    caption: 'fatura_11_2026'
  });
  assert.match(deduped, /Nome do arquivo: "fatura_11_2026\.pdf"/);
  assert.doesNotMatch(deduped, /Contexto da legenda/);

  const withDistinctCaption = buildPdfSummaryPrompt('pt', {
    fileName: 'doc.pdf',
    caption: 'Conta de energia de novembro'
  });
  assert.match(withDistinctCaption, /Contexto da legenda enviada junto com o documento: "Conta de energia de novembro"/);
});

test('extractPdfContentForSummary extrai texto quando selecionável e renderiza imagem via pdftoppm quando escaneado', async () => {
  const textPdf = createTextPdf('fatura.pdf', [
    'ENERGISA PARAIBA DISTRIBUIDORA DE ENERGIA S/A',
    'Fatura de energia eletrica referente a novembro de 2026 no valor total de R$ 193,47.',
    'Consumidor: Iara Machado - Consumo: 1023 kWh.'
  ]);
  const textExtracted = await extractPdfContentForSummary(textPdf);
  assert.equal(textExtracted.mode, 'text');
  if (textExtracted.mode === 'text') {
    assert.match(textExtracted.text, /ENERGISA PARAIBA/);
    assert.match(textExtracted.text, /193,47/);
  }

  const imagePdf = createImageOnlyPdf('comprovante.pdf');
  const imageExtracted = await extractPdfContentForSummary(imagePdf, 3);
  assert.equal(imageExtracted.mode, 'images');
  if (imageExtracted.mode === 'images') {
    assert.equal(imageExtracted.images.length, 1);
    assert.ok(imageExtracted.images[0].base64.length > 50);
  }
});

test('Fila resume PDFs recebidos e enviados, indexa no FTS5, suporta fallback OpenAI e toggle independente', async () => {
  const chatJid = '558399833997@s.whatsapp.net';
  upsertContact({ jid: chatJid, name: 'Iara Machado', is_group: 0, is_ignored: 0 });

  const pdfReceived = createTextPdf('fatura_11_2026.pdf', [
    'Conta de energia eletrica de novembro de 2026 valor total R$ 193,47 para Iara Machado.'
  ]);
  const pdfSent = createImageOnlyPdf('comprovante_enviado.pdf');

  insertMessage({
    id: 'msg_pdf_rx',
    chat_jid: chatJid,
    sender_jid: chatJid,
    from_me: 0,
    timestamp: 1794766150,
    message_type: 'document',
    content: null
  });
  insertAttachment({
    id: 'att_msg_pdf_rx',
    message_id: 'msg_pdf_rx',
    file_path: pdfReceived,
    file_name: 'fatura_11_2026.pdf',
    mimetype: 'application/pdf',
    file_size: fs.statSync(pdfReceived).size,
    sha256: 'pdf_hash_1',
    transcription_text: null,
    transcription_status: 'pending'
  });

  insertMessage({
    id: 'msg_pdf_tx',
    chat_jid: chatJid,
    sender_jid: chatJid,
    from_me: 1,
    timestamp: 1794766200,
    message_type: 'document',
    content: 'Segue comprovante'
  });
  insertAttachment({
    id: 'att_msg_pdf_tx',
    message_id: 'msg_pdf_tx',
    file_path: pdfSent,
    file_name: 'comprovante_enviado.pdf',
    mimetype: 'application/pdf',
    file_size: fs.statSync(pdfSent).size,
    sha256: 'pdf_hash_2',
    transcription_text: null,
    transcription_status: 'pending'
  });

  const groqPdfCalls: Array<{ fileName?: string | null; caption?: string | null }> = [];
  const openaiPdfCalls: Array<{ fileName?: string | null; caption?: string | null }> = [];

  transcriptionQueue.setProviders({
    summarizePdfWithGroq: async (_filePath, fileName, caption) => {
      groqPdfCalls.push({ fileName, caption });
      return fileName === 'fatura_11_2026.pdf'
        ? 'Fatura de energia elétrica Energisa de novembro de 2026 no valor de R$ 193,47.'
        : 'Comprovante em PDF enviado.';
    },
    summarizePdfWithOpenAI: async (_filePath, fileName, caption) => {
      openaiPdfCalls.push({ fileName, caption });
      return 'Comprovante de pagamento bancário enviado em PDF.';
    }
  });

  setSetting('groq_api_key', 'gsk_pdf_test');
  setPdfTranscriptionEnabled(true);
  await transcriptionQueue.processPending();

  assert.equal(groqPdfCalls.length, 2);
  assert.equal(groqPdfCalls[0].fileName, 'fatura_11_2026.pdf');
  assert.equal(groqPdfCalls[1].caption, 'Segue comprovante');

  const attRx = getAttachment('att_msg_pdf_rx');
  assert.equal(attRx?.transcription_status, 'completed');
  assert.match(attRx?.transcription_text || '', /Energisa/);

  // Busca FTS5 encontra o PDF pelo resumo salvo
  const hits = searchMessages('Energisa', chatJid);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].message_id, 'msg_pdf_rx');

  // Toggle desativado pula novos PDFs automáticos, mas endpoint sob demanda funciona com fallback OpenAI
  setSetting('groq_api_key', '');
  const prevOpenAiKey = config.openaiApiKey;
  config.openaiApiKey = 'sk-test-pdf-openai';
  const app = await createServer();
  try {
    const toggleRes = await app.inject({
      method: 'POST',
      url: '/api/ui/settings',
      payload: { pdf_transcription_enabled: false }
    });
    assert.equal(toggleRes.statusCode, 200);
    assert.equal(isPdfTranscriptionEnabled(), false);

    const manualRes = await app.inject({
      method: 'POST',
      url: '/api/ui/attachments/att_msg_pdf_tx/transcribe'
    });
    assert.equal(manualRes.statusCode, 200);
    const body = manualRes.json();
    assert.equal(body.success, true);
    assert.equal(openaiPdfCalls.length, 1);
    assert.match(body.attachment.transcription_text, /Comprovante de pagamento/);
  } finally {
    config.openaiApiKey = prevOpenAiKey;
    await app.close();
  }
});
