import fs from 'node:fs';
import { Groq } from 'groq-sdk';
import { getEffectiveGroqApiKey } from '../db/settings.js';
import { loadYamlConfig } from '../config.js';

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
