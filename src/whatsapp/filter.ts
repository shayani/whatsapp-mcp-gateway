import { loadYamlConfig } from '../config.js';
import { getIgnoredJidsSet } from '../db/contacts.js';

class MessageFilterService {
  private ignoredJidsCache: Set<string> = new Set();
  private lastCacheUpdate = 0;
  private readonly CACHE_TTL_MS = 2000; // Recarrega o cache a cada 2s ou sob demanda

  constructor() {
    this.refreshCache();
  }

  public refreshCache(): void {
    try {
      this.ignoredJidsCache = getIgnoredJidsSet();
      this.lastCacheUpdate = Date.now();
    } catch {
      // Ignora erro se DB ainda não inicializado
    }
  }

  public setJidIgnoredInMemory(jid: string, isIgnored: boolean): void {
    if (isIgnored) {
      this.ignoredJidsCache.add(jid);
    } else {
      this.ignoredJidsCache.delete(jid);
    }
  }

  public shouldCollectMessage(chatJid: string, senderJid?: string): boolean {
    if (Date.now() - this.lastCacheUpdate > this.CACHE_TTL_MS) {
      this.refreshCache();
    }

    const yamlConfig = loadYamlConfig();
    const filters = yamlConfig.filters;

    // 1. Status / Stories do WhatsApp
    if (chatJid === 'status@broadcast' || chatJid.includes('@broadcast')) {
      if (filters.ignore_broadcast_status) {
        return false;
      }
    }

    // 2. Toggles definidos na Interface Web / SQLite
    if (this.ignoredJidsCache.has(chatJid)) {
      return false;
    }
    if (senderJid && this.ignoredJidsCache.has(senderJid)) {
      return false;
    }

    // 3. Denylist do YAML
    if (filters.denylist_jids && filters.denylist_jids.includes(chatJid)) {
      return false;
    }
    if (senderJid && filters.denylist_jids && filters.denylist_jids.includes(senderJid)) {
      return false;
    }

    // 4. Se houver Allowlist definida, aceita apenas o que estiver nela
    if (filters.allowlist_jids && filters.allowlist_jids.length > 0) {
      const inAllowlist = filters.allowlist_jids.includes(chatJid) ||
        (senderJid ? filters.allowlist_jids.includes(senderJid) : false);
      if (!inAllowlist) {
        return false;
      }
    }

    // 5. Ignorar grupos por padrão
    const isGroup = chatJid.endsWith('@g.us');
    if (isGroup && filters.ignore_groups_by_default) {
      // Só aceita se estiver explicitamente na allowlist
      if (!filters.allowlist_jids || !filters.allowlist_jids.includes(chatJid)) {
        return false;
      }
    }

    return true;
  }
}

export const messageFilter = new MessageFilterService();
