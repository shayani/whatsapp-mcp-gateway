import fs from 'node:fs';
import { getPendingAudioTranscriptions, updateTranscription, type Attachment } from '../db/attachments.js';
import { getEffectiveGroqApiKey } from '../db/settings.js';
import { config } from '../config.js';
import { transcribeWithGroq } from './groq.js';
import { transcribeWithOpenAI } from './openai.js';

class TranscriptionQueue {
  private isProcessing = false;
  private intervalId: NodeJS.Timeout | null = null;

  public start(): void {
    if (this.intervalId) return;

    // Processa pendentes imediatamente e verifica a cada 30s
    this.processPending();
    this.intervalId = setInterval(() => {
      this.processPending();
    }, 30000);
  }

  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  public notifyNewAudio(): void {
    setImmediate(() => this.processPending());
  }

  public async processPending(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const pendingList = getPendingAudioTranscriptions(5);

      for (const item of pendingList) {
        await this.processItem(item);
      }
    } catch (err) {
      console.error('Erro na fila de transcrição de áudio:', err);
    } finally {
      this.isProcessing = false;
    }
  }

  private async processItem(item: Attachment): Promise<void> {
    if (!fs.existsSync(item.file_path)) {
      console.warn(`Arquivo de áudio não encontrado para transcrição: ${item.file_path}`);
      updateTranscription(item.id, '[Arquivo de áudio ausente no disco]', 'failed');
      return;
    }

    const groqKey = getEffectiveGroqApiKey();
    const openaiKey = config.openaiApiKey;

    if (!groqKey && !openaiKey) {
      // Nenhuma chave configurada ainda: não falha permanentemente, marca como skipped
      // Se o usuário configurar a chave depois pela web UI, ele pode reprocessar
      return;
    }

    try {
      let transcribedText = '';

      if (groqKey) {
        transcribedText = await transcribeWithGroq(item.file_path);
      } else if (openaiKey) {
        transcribedText = await transcribeWithOpenAI(item.file_path);
      }

      console.log(`[Transcrição Concluída] Msg ${item.message_id}: "${transcribedText.slice(0, 60)}..."`);
      updateTranscription(item.id, transcribedText, 'completed');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`Falha ao transcrever áudio ${item.id}:`, errorMessage);
      updateTranscription(item.id, `[Falha na transcrição: ${errorMessage}]`, 'failed');
    }
  }
}

export const transcriptionQueue = new TranscriptionQueue();
