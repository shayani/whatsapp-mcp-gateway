import fs from 'node:fs';
import {
  getAttachment,
  getAttachmentWithContext,
  getPendingTranscriptions,
  setAttachmentTranscriptionStatus,
  updateTranscription,
  type Attachment,
  type PendingTranscriptionItem
} from '../db/attachments.js';
import { resolveAttachmentPath } from '../db/storage.js';
import { getEffectiveGroqApiKey, isImageTranscriptionEnabled } from '../db/settings.js';
import { config, loadYamlConfig } from '../config.js';
import { transcribeImageWithGroq, transcribeWithGroq } from './groq.js';
import { transcribeImageWithOpenAI, transcribeWithOpenAI } from './openai.js';
import { isAudioMimetype, isTranscribableImage } from './image.js';

export interface TranscriptionProviders {
  transcribeAudioWithGroq: (filePath: string) => Promise<string>;
  transcribeAudioWithOpenAI: (filePath: string) => Promise<string>;
  transcribeImageWithGroq: (filePath: string, mimetype: string, caption?: string | null) => Promise<string>;
  transcribeImageWithOpenAI: (filePath: string, mimetype: string, caption?: string | null) => Promise<string>;
}

const DEFAULT_PROVIDERS: TranscriptionProviders = {
  transcribeAudioWithGroq: transcribeWithGroq,
  transcribeAudioWithOpenAI: transcribeWithOpenAI,
  transcribeImageWithGroq,
  transcribeImageWithOpenAI
};

export class TranscriptionQueue {
  private isProcessing = false;
  private intervalId: NodeJS.Timeout | null = null;
  private processingIds = new Set<string>();
  private providers: TranscriptionProviders = { ...DEFAULT_PROVIDERS };

  public setProviders(overrides: Partial<TranscriptionProviders>): void {
    this.providers = { ...DEFAULT_PROVIDERS, ...overrides };
  }

  public resetProviders(): void {
    this.providers = { ...DEFAULT_PROVIDERS };
  }

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

  public notifyNewMedia(): void {
    setImmediate(() => this.processPending());
  }

  public notifyNewAudio(): void {
    this.notifyNewMedia();
  }

  public async processPending(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const pendingList = getPendingTranscriptions(5);

      for (const item of pendingList) {
        if (this.processingIds.has(item.id)) continue;
        await this.processItem(item);
      }
    } catch (err) {
      console.error('Erro na fila de transcrição de mídia:', err);
    } finally {
      this.isProcessing = false;
    }
  }

  public async transcribeAttachmentNow(
    attachmentId: string,
    options: { force?: boolean } = {}
  ): Promise<Attachment> {
    const item = getAttachmentWithContext(attachmentId);
    if (!item) {
      throw new Error('Anexo não encontrado.');
    }

    const isAudio = isAudioMimetype(item.mimetype);
    const isImage = isTranscribableImage(item.mimetype, item.message_type);
    if (!isAudio && !isImage) {
      throw new Error('Tipo de anexo não suportado para transcrição.');
    }

    const resolvedPath = resolveAttachmentPath(item.file_path);
    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      throw new Error('Arquivo do anexo não encontrado no disco.');
    }

    const groqKey = getEffectiveGroqApiKey();
    const openaiKey = config.openaiApiKey;
    if (!groqKey && !openaiKey) {
      throw new Error('Nenhuma chave de API (Groq ou OpenAI) configurada para transcrição.');
    }

    if (this.processingIds.has(item.id)) {
      throw new Error('Este anexo já está em processamento.');
    }

    setAttachmentTranscriptionStatus(item.id, 'pending');
    await this.processItem({ ...item, file_path: resolvedPath }, { force: options.force ?? true });

    return getAttachment(item.id) || item;
  }

  private resolveExistingPath(filePath: string): string | null {
    const resolved = resolveAttachmentPath(filePath) || filePath;
    if (!resolved || !fs.existsSync(resolved)) {
      return null;
    }
    return resolved;
  }

  private async transcribeAudioItem(resolvedPath: string, groqKey?: string, openaiKey?: string): Promise<string> {
    if (groqKey) {
      return this.providers.transcribeAudioWithGroq(resolvedPath);
    }
    if (openaiKey) {
      return this.providers.transcribeAudioWithOpenAI(resolvedPath);
    }
    throw new Error('Nenhuma chave de API configurada.');
  }

  private async transcribeImageItem(
    resolvedPath: string,
    item: PendingTranscriptionItem,
    groqKey?: string,
    openaiKey?: string
  ): Promise<string> {
    const preferred = loadYamlConfig().image_transcription.provider?.toLowerCase();
    if (preferred === 'openai' && openaiKey) {
      return this.providers.transcribeImageWithOpenAI(resolvedPath, item.mimetype, item.message_content);
    }
    if (groqKey) {
      return this.providers.transcribeImageWithGroq(resolvedPath, item.mimetype, item.message_content);
    }
    if (openaiKey) {
      return this.providers.transcribeImageWithOpenAI(resolvedPath, item.mimetype, item.message_content);
    }
    throw new Error('Nenhuma chave de API configurada.');
  }

  private async processItem(item: PendingTranscriptionItem, options: { force?: boolean } = {}): Promise<void> {
    this.processingIds.add(item.id);
    try {
      const isAudio = isAudioMimetype(item.mimetype);
      const isImage = isTranscribableImage(item.mimetype, item.message_type);

      if (!isAudio && !isImage) {
        updateTranscription(item.id, '', 'skipped');
        return;
      }

      if (isImage && !options.force && !isImageTranscriptionEnabled()) {
        setAttachmentTranscriptionStatus(item.id, 'skipped');
        return;
      }

      const resolvedPath = this.resolveExistingPath(item.file_path);
      if (!resolvedPath) {
        console.warn(`Arquivo de mídia não encontrado para transcrição: ${item.file_path}`);
        const missingLabel = isImage
          ? '[Arquivo de imagem ausente no disco]'
          : '[Arquivo de áudio ausente no disco]';
        updateTranscription(item.id, missingLabel, 'failed');
        return;
      }

      const groqKey = getEffectiveGroqApiKey();
      const openaiKey = config.openaiApiKey;

      if (!groqKey && !openaiKey) {
        // Nenhuma chave configurada ainda: mantém pendente para reprocessamento ao configurar na UI
        return;
      }

      const transcribedText = isImage
        ? await this.transcribeImageItem(resolvedPath, item, groqKey, openaiKey)
        : await this.transcribeAudioItem(resolvedPath, groqKey, openaiKey);

      console.log(`[Transcrição Concluída] Msg ${item.message_id} (${isImage ? 'imagem' : 'áudio'}): "${transcribedText.slice(0, 60)}..."`);
      updateTranscription(item.id, transcribedText, 'completed');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`Falha ao transcrever mídia ${item.id}:`, errorMessage);
      updateTranscription(item.id, `[Falha na transcrição: ${errorMessage}]`, 'failed');
    } finally {
      this.processingIds.delete(item.id);
    }
  }
}

export const transcriptionQueue = new TranscriptionQueue();
