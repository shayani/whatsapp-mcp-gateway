import { proto, type WAMessageKey } from '@whiskeysockets/baileys';
import { getMessage as getDbMessage, type Message } from '../db/messages.js';

const MAX_RECENT_MESSAGES = 256;

/**
 * Cache limitado em memória das últimas mensagens enviadas pelo gateway,
 * garantindo resposta imediata para retry receipts antes mesmo de qualquer consulta extra.
 */
export class RecentSentMessageCache {
  private cache = new Map<string, proto.IMessage>();

  constructor(private readonly maxEntries = MAX_RECENT_MESSAGES) {}

  set(id: string, message: proto.IMessage): void {
    if (!id || !message) return;
    if (this.cache.has(id)) {
      this.cache.delete(id);
    }
    this.cache.set(id, message);
    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
  }

  get(id: string): proto.IMessage | undefined {
    return this.cache.get(id);
  }

  clear(): void {
    this.cache.clear();
  }
}

export function reviveJsonBuffers(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(reviveJsonBuffers);
  }
  const obj = value as Record<string, unknown>;
  if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
    return Buffer.from(obj.data as number[]);
  }
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = reviveJsonBuffers(v);
  }
  return result;
}

/**
 * Reconstrói um `proto.IMessage` a partir do registro persistido no SQLite.
 * Trata os dois formatos existentes em `raw_json`:
 * - mensagens enviadas pelo gateway: `{ source, key, message }`
 * - mensagens recebidas/sincronizadas: objeto `proto.IMessage` diretamente
 */
export function extractProtoMessageFromRow(
  row: Pick<Message, 'message_type' | 'content' | 'raw_json'> | undefined
): proto.IMessage | undefined {
  if (!row) return undefined;

  if (row.raw_json) {
    try {
      const parsed = JSON.parse(row.raw_json) as Record<string, unknown> | null;
      if (parsed && typeof parsed === 'object') {
        const candidate =
          parsed.message && typeof parsed.message === 'object'
            ? (parsed.message as Record<string, unknown>)
            : parsed;

        const revived = reviveJsonBuffers(candidate) as Record<string, unknown>;
        if (Object.keys(revived).length > 0) {
          return proto.Message.fromObject(revived);
        }
      }
    } catch {
      // Fallback abaixo se raw_json estiver inválido
    }
  }

  if (row.message_type === 'text' && row.content) {
    return proto.Message.fromObject({ conversation: row.content });
  }

  return undefined;
}

/**
 * Callback `getMessage` usado pelo Baileys ao responder `retry receipt`
 * quando o celular do usuário ou o destinatário falha ao decifrar uma mensagem.
 */
export async function resolveBaileysMessage(
  key: WAMessageKey,
  recentCache?: RecentSentMessageCache
): Promise<proto.IMessage | undefined> {
  const id = key?.id;
  if (!id) return undefined;

  try {
    const cached = recentCache?.get(id);
    if (cached) {
      return cached;
    }

    const row = getDbMessage(id);
    return extractProtoMessageFromRow(row);
  } catch (err) {
    console.warn(`[WhatsApp] Erro ao recuperar mensagem ${id} para retry receipt:`, err);
    return undefined;
  }
}
