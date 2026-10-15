import fs from 'node:fs';
import OpenAI from 'openai';
import { config, loadYamlConfig } from '../config.js';

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
