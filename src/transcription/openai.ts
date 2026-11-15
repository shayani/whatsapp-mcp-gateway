import fs from 'node:fs';
import OpenAI from 'openai';
import { config, loadYamlConfig } from '../config.js';
import { buildImageTranscriptionPrompt, prepareImageForVision } from './image.js';

export async function transcribeWithOpenAI(filePath: string): Promise<string> {
  const apiKey = config.openaiApiKey;
  if (!apiKey) {
    throw new Error('Chave da API OpenAI não configurada.');
  }

  const openai = new OpenAI({ apiKey });
  const yamlConfig = loadYamlConfig();

  const fileStream = fs.createReadStream(filePath);

  const response = await openai.audio.transcriptions.create({
    file: fileStream,
    model: 'whisper-1',
    language: yamlConfig.transcription.language || 'pt'
  });

  return response.text.trim();
}

export async function transcribeImageWithOpenAI(
  filePath: string,
  mimetype: string,
  caption?: string | null
): Promise<string> {
  const apiKey = config.openaiApiKey;
  if (!apiKey) {
    throw new Error('Chave da API OpenAI não configurada.');
  }

  const openai = new OpenAI({ apiKey });
  const yamlConfig = loadYamlConfig();
  const imageCfg = yamlConfig.image_transcription;

  const prepared = await prepareImageForVision(filePath, mimetype);
  const prompt = buildImageTranscriptionPrompt(imageCfg.language || yamlConfig.transcription.language || 'pt', caption);

  const completion = await openai.chat.completions.create({
    model: imageCfg.openai_model || 'gpt-4o-mini',
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
    throw new Error('Modelo de visão OpenAI retornou resposta vazia.');
  }

  return text;
}
