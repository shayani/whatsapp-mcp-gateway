import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareImageForVision, type PreparedVisionImage } from './image.js';

const execFileAsync = promisify(execFile);

export const MIN_EXTRACTABLE_PDF_CHARS = 80;

export type PdfSummaryContent =
  | { mode: 'text'; text: string; truncated: boolean }
  | { mode: 'images'; images: PreparedVisionImage[] };

export function isPdfAttachment(mimetype: string, fileName?: string | null): boolean {
  const clean = (mimetype || '').split(';')[0].trim().toLowerCase();
  if (clean === 'application/pdf') return true;
  if (clean === 'application/octet-stream' && fileName?.toLowerCase().endsWith('.pdf')) {
    return true;
  }
  return false;
}

export async function extractPdfText(filePath: string): Promise<string> {
  const { stdout } = await execFileAsync('pdftotext', ['-enc', 'UTF-8', filePath, '-'], {
    maxBuffer: 10 * 1024 * 1024
  });
  return stdout
    .replace(/\u000c/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractPdfContentForSummary(
  filePath: string,
  maxPages = 3,
  maxTextChars = 16000
): Promise<PdfSummaryContent> {
  let extractedText = '';
  try {
    extractedText = await extractPdfText(filePath);
  } catch {
    extractedText = '';
  }

  const meaningfulLength = extractedText.replace(/\s+/g, '').length;
  if (meaningfulLength >= MIN_EXTRACTABLE_PDF_CHARS) {
    return {
      mode: 'text',
      text: extractedText.slice(0, maxTextChars),
      truncated: extractedText.length > maxTextChars
    };
  }

  // Fallback para PDFs escaneados / gerados como imagem (ex: comprovantes pdfmake)
  const tempDir = path.join(os.tmpdir(), `wa-pdf-${crypto.randomUUID()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    const outPrefix = path.join(tempDir, 'page');
    await execFileAsync('pdftoppm', [
      '-png',
      '-r',
      '150',
      '-f',
      '1',
      '-l',
      String(Math.max(1, maxPages)),
      filePath,
      outPrefix
    ]);

    const pageFiles = fs
      .readdirSync(tempDir)
      .filter((f) => f.endsWith('.png'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (pageFiles.length > 0) {
      const images: PreparedVisionImage[] = [];
      for (const pageFile of pageFiles) {
        const prepared = await prepareImageForVision(path.join(tempDir, pageFile), 'image/png');
        images.push(prepared);
      }
      return { mode: 'images', images };
    }
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignora erro na limpeza do diretório temporário
    }
  }

  if (meaningfulLength > 0) {
    return {
      mode: 'text',
      text: extractedText.slice(0, maxTextChars),
      truncated: extractedText.length > maxTextChars
    };
  }

  throw new Error('PDF não possui texto extraível nem páginas renderizáveis.');
}

export function buildPdfSummaryPrompt(
  language: string,
  options: { fileName?: string | null; caption?: string | null; mode?: 'text' | 'images' } = {}
): string {
  const normalizedLang = (language || 'pt').trim().toLowerCase();
  const trimmedFileName = options.fileName?.trim();
  const trimmedCaption = options.caption?.trim();
  const isSameCaptionAndName =
    Boolean(trimmedCaption && trimmedFileName) &&
    (trimmedCaption === trimmedFileName || trimmedFileName?.startsWith(`${trimmedCaption}.`));

  if (normalizedLang === 'en') {
    const parts = [
      'Summarize in English, in 1 to 3 short and objective sentences, what this PDF document is about.',
      'Highlight key details (such as document type, amounts, dates, or parties involved) concisely.',
      'Do not invent information not present in the document and reply only with the direct summary, without prefixes like "Summary:" or quotes.'
    ];
    if (trimmedFileName) {
      parts.push(`File name: "${trimmedFileName}".`);
    }
    if (trimmedCaption && !isSameCaptionAndName) {
      parts.push(`Context from the caption sent with the document: "${trimmedCaption}".`);
    }
    return parts.join(' ');
  }

  const targetLang = normalizedLang === 'es' ? 'espanhol' : 'português';
  const parts = [
    `Resuma em ${targetLang}, em 1 a 3 frases curtas e objetivas, sobre o que se trata este documento PDF.`,
    'Destaque as informações-chave (como tipo de documento, valores, datas ou partes envolvidas) de forma direta.',
    'Não invente informações que não estejam no documento e responda apenas com o resumo direto, sem prefixos como "Resumo:" ou aspas.'
  ];
  if (trimmedFileName) {
    parts.push(`Nome do arquivo: "${trimmedFileName}".`);
  }
  if (trimmedCaption && !isSameCaptionAndName) {
    parts.push(`Contexto da legenda enviada junto com o documento: "${trimmedCaption}".`);
  }
  return parts.join(' ');
}
