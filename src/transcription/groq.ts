import fs from 'node:fs';
import { Groq } from 'groq-sdk';
import { getEffectiveGroqApiKey } from '../db/settings.js';
import { loadYamlConfig } from '../config.js';
import { buildImageTranscriptionPrompt, prepareImageForVision } from './image.js';
import { buildPdfSummaryPrompt, extractPdfContentForSummary } from './pdf.js';
import { withTransientRetry } from './retry.js';

export async function transcribeWithGroq(filePath: string): Promise<string> {
  const apiKey = getEffectiveGroqApiKey();
  if (!apiKey) {
    throw new Error('Chave da API Groq não configurada.');
  }

  const groq = new Groq({ apiKey });
  const yamlConfig = loadYamlConfig();

  const fileStream = fs.createReadStream(filePath);

  const transcription = await groq.audio.transcriptions.create({
    file: fileStream,
    model: yamlConfig.transcription.model || 'whisper-large-v3-turbo',
    language: yamlConfig.transcription.language || 'pt',
    response_format: 'verbose_json'
  });

  return transcription.text.trim();
}

export async function transcribeImageWithGroq(
  filePath: string,
  mimetype: string,
  caption?: string | null
): Promise<string> {
  const apiKey = getEffectiveGroqApiKey();
  if (!apiKey) {
    throw new Error('Chave da API Groq não configurada.');
  }

  const groq = new Groq({ apiKey });
  const yamlConfig = loadYamlConfig();
  const imageCfg = yamlConfig.image_transcription;

  const prepared = await prepareImageForVision(filePath, mimetype);
  const prompt = buildImageTranscriptionPrompt(imageCfg.language || yamlConfig.transcription.language || 'pt', caption);

  const completion = await withTransientRetry(() =>
    groq.chat.completions.create({
      model: imageCfg.model || 'qwen/qwen3.8-27b',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${prepared.mimetype};base64,${prepared.base64}`
              }
            }
          ]
        }
      ],
      temperature: 0.2,
      max_tokens: 400
    })
  );

  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) {
    throw new Error('Modelo de visão Groq retornou resposta vazia.');
  }

  return text;
}

export async function summarizePdfWithGroq(
  filePath: string,
  fileName?: string | null,
  caption?: string | null
): Promise<string> {
  const apiKey = getEffectiveGroqApiKey();
  if (!apiKey) {
    throw new Error('Chave da API Groq não configurada.');
  }

  const groq = new Groq({ apiKey });
  const yamlConfig = loadYamlConfig();
  const pdfCfg = yamlConfig.pdf_transcription;

  const extracted = await extractPdfContentForSummary(
    filePath,
    pdfCfg.max_pages_for_vision,
    pdfCfg.max_text_chars
  );
  const prompt = buildPdfSummaryPrompt(pdfCfg.language || yamlConfig.transcription.language || 'pt', {
    fileName,
    caption,
    mode: extracted.mode
  });

  const userContent =
    extracted.mode === 'text'
      ? `${prompt}\n\nConteúdo extraído do PDF${extracted.truncated ? ' (trecho inicial)' : ''}:\n${extracted.text}`
      : [
          { type: 'text' as const, text: prompt },
          ...extracted.images.map((img) => ({
            type: 'image_url' as const,
            image_url: { url: `data:${img.mimetype};base64,${img.base64}` }
          }))
        ];

  const completion = await withTransientRetry(() =>
    groq.chat.completions.create({
      model: pdfCfg.model || 'qwen/qwen3.8-27b',
      messages: [{ role: 'user', content: userContent }],
      temperature: 0.2,
      max_tokens: 400
    })
  );

  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) {
    throw new Error('Modelo Groq retornou resumo vazio para o PDF.');
  }

  return text;
}
