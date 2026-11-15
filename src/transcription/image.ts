import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const MAX_VISION_IMAGE_BYTES = 2_800_000; // ~3.73 MB em base64 (abaixo do limite de 4 MB)
const DIRECT_VISION_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export function normalizeImageMime(mimetype: string): string {
  const clean = mimetype.split(';')[0].trim().toLowerCase();
  if (clean === 'image/jpg') return 'image/jpeg';
  return clean;
}

export function isAudioMimetype(mimetype: string): boolean {
  const clean = mimetype.split(';')[0].trim().toLowerCase();
  return clean.startsWith('audio/') || clean.includes('ogg');
}

export function isTranscribableImage(mimetype: string, messageType?: string | null): boolean {
  if (messageType === 'sticker') return false;
  const clean = normalizeImageMime(mimetype);
  return clean.startsWith('image/') && clean !== 'image/svg+xml';
}

export function buildImageTranscriptionPrompt(language: string, caption?: string | null): string {
  const normalizedLang = (language || 'pt').trim().toLowerCase();
  const trimmedCaption = caption?.trim();

  if (normalizedLang === 'en') {
    const parts = [
      'Describe in English, in 1 to 3 short and objective sentences, what this image is about.',
      'If there is relevant visible text (such as in screenshots, receipts, notices, or documents), summarize the key details concisely without transcribing long blocks word for word.',
      'Do not invent details that are not visible and reply only with the direct description, without prefixes like "Description:" or quotes.'
    ];
    if (trimmedCaption) {
      parts.push(`Context from the caption sent with the image: "${trimmedCaption}".`);
    }
    return parts.join(' ');
  }

  const targetLang = normalizedLang === 'es' ? 'espanhol' : 'português';
  const parts = [
    `Descreva em ${targetLang}, em 1 a 3 frases curtas e objetivas, sobre o que se trata esta imagem.`,
    'Se houver texto relevante visível (como em prints, comprovantes, avisos ou documentos), resuma as informações principais de forma direta sem transcrever blocos longos palavra por palavra.',
    'Não invente informações que não estejam visíveis e responda apenas com a descrição direta, sem prefixos como "Descrição:" ou aspas.'
  ];
  if (trimmedCaption) {
    parts.push(`Contexto da legenda enviada junto com a imagem: "${trimmedCaption}".`);
  }
  return parts.join(' ');
}

export interface PreparedVisionImage {
  base64: string;
  mimetype: string;
  resized: boolean;
}

async function transcodeToJpeg(
  inputPath: string,
  outputPath: string,
  maxDimension: number,
  quality: number
): Promise<Buffer> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    inputPath,
    '-frames:v',
    '1',
    '-vf',
    `scale='min(${maxDimension},iw)':'min(${maxDimension},ih)':force_original_aspect_ratio=decrease`,
    '-q:v',
    String(quality),
    outputPath
  ]);
  return fs.readFileSync(outputPath);
}

/**
 * Prepara uma imagem para envio em data URL base64 para APIs de visão.
 * Se ultrapassar MAX_VISION_IMAGE_BYTES ou usar formato não suportado diretamente,
 * gera uma cópia JPEG temporária redimensionada via ffmpeg sem alterar o arquivo original.
 */
export async function prepareImageForVision(
  filePath: string,
  mimetype: string
): Promise<PreparedVisionImage> {
  const normalizedMime = normalizeImageMime(mimetype);
  const stat = fs.statSync(filePath);

  if (stat.size <= MAX_VISION_IMAGE_BYTES && DIRECT_VISION_MIMES.has(normalizedMime)) {
    const buffer = fs.readFileSync(filePath);
    return {
      base64: buffer.toString('base64'),
      mimetype: normalizedMime,
      resized: false
    };
  }

  const tempPath = path.join(os.tmpdir(), `wa-vision-${crypto.randomUUID()}.jpg`);
  try {
    let buffer = await transcodeToJpeg(filePath, tempPath, 1600, 4);
    if (buffer.length > MAX_VISION_IMAGE_BYTES) {
      buffer = await transcodeToJpeg(filePath, tempPath, 1024, 7);
    }
    if (buffer.length > MAX_VISION_IMAGE_BYTES) {
      throw new Error('Imagem continua acima do limite máximo suportado após compressão.');
    }

    return {
      base64: buffer.toString('base64'),
      mimetype: 'image/jpeg',
      resized: true
    };
  } finally {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // Ignora falha na limpeza do arquivo temporário
    }
  }
}
