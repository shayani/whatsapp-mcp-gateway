import fs from 'node:fs';
import { Groq } from 'groq-sdk';
import { getEffectiveGroqApiKey } from '../db/settings.js';
import { loadYamlConfig } from '../config.js';
import { buildImageTranscriptionPrompt, prepareImageForVision } from './image.js';

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

  const completion = await groq.chat.completions.create({
    model: imageCfg.model || 'meta-llama/llama-4-scout-17b-16e-instruct',
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
    max_tokens: 300
  });

  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) {
    throw new Error('Modelo de visão Groq retornou resposta vazia.');
  }

  return text;
}
