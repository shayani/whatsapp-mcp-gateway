import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WAMessage,
  type WASocket,
  type ConnectionState
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import { config, loadYamlConfig } from '../config.js';
import { upsertContact } from '../db/contacts.js';
import { insertMessage } from '../db/messages.js';
import { messageFilter } from './filter.js';
import { handleMediaDownload } from './media.js';

export interface WhatsAppServiceState {
  status: 'disconnected' | 'connecting' | 'connected';
  qrCodeRaw: string | null;
  qrCodeDataUrl: string | null;
  userJid: string | null;
  userName: string | null;
}

class WhatsAppService {
  public sock: WASocket | null = null;
  public state: WhatsAppServiceState = {
    status: 'disconnected',
    qrCodeRaw: null,
    qrCodeDataUrl: null,
    userJid: null,
    userName: null
  };

  private isStarting = false;

  public async start(): Promise<void> {
    if (this.isStarting || this.state.status === 'connected') {
      return;
    }
    this.isStarting = true;

    try {
      const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
      const { version, isLatest } = await fetchLatestBaileysVersion();
      console.log(`[WhatsApp] Usando Baileys v${version.join('.')} (última versão: ${isLatest})`);

      const logger = pino({ level: config.logLevel === 'debug' ? 'debug' : 'silent' });

      this.sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false, // Nós mesmos imprimimos abaixo para controle fino
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        generateHighQualityLinkPreview: false,
        syncFullHistory: true,
        shouldSyncHistoryMessage: () => true
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.state.qrCodeRaw = qr;
          try {
            this.state.qrCodeDataUrl = await QRCode.toDataURL(qr, { width: 360, margin: 2 });
          } catch (e) {
            console.error('Erro ao gerar DataURL do QR Code:', e);
          }

          console.log('\n================ ESCANEIE O QR CODE DO WHATSAPP ================');
          qrcodeTerminal.generate(qr, { small: true });
          console.log(`Ou acesse pelo navegador em: http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}/auth\n`);
        }

        if (connection === 'close') {
          this.state.status = 'disconnected';
          this.state.qrCodeRaw = null;
          this.state.qrCodeDataUrl = null;

          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          console.log(`[WhatsApp] Conexão encerrada (código: ${statusCode}). Reconectar: ${shouldReconnect}`);

          if (shouldReconnect) {
            this.isStarting = false;
            setTimeout(() => this.start(), 3000);
          }
        } else if (connection === 'open') {
          this.state.status = 'connected';
          this.state.qrCodeRaw = null;
          this.state.qrCodeDataUrl = null;
          this.state.userJid = this.sock?.user?.id || null;
          this.state.userName = this.sock?.user?.name || null;

          console.log(`✅ [WhatsApp] Conectado com sucesso como: ${this.state.userName || this.state.userJid}`);
        } else if (connection === 'connecting') {
          this.state.status = 'connecting';
        }
      });

      // Contatos sincronizados
      this.sock.ev.on('contacts.upsert', (contacts) => {
        for (const contact of contacts) {
          upsertContact({
            jid: contact.id,
            name: contact.name || null,
            notify_name: contact.notify || null,
            is_group: contact.id.endsWith('@g.us') ? 1 : 0
          });
        }
      });

      this.sock.ev.on('contacts.update', (updates) => {
        for (const update of updates) {
          if (update.id) {
            upsertContact({
              jid: update.id,
              name: update.name || null,
              notify_name: update.notify || null
            });
          }
        }
      });

      // Histórico inicial enviado pelo WhatsApp
      this.sock.ev.on('messaging-history.set', async ({ messages: histMessages, chats, contacts }) => {
        console.log(`[WhatsApp] Recebidos ${histMessages?.length || 0} mensagens e ${chats?.length || 0} conversas no sync de histórico.`);

        if (contacts) {
          for (const c of contacts) {
            upsertContact({
              jid: c.id,
              name: c.name || null,
              notify_name: c.notify || null,
              is_group: c.id.endsWith('@g.us') ? 1 : 0
            });
          }
        }

        if (chats) {
          for (const c of chats) {
            upsertContact({
              jid: c.id,
              name: c.name || null,
              unread_count: c.unreadCount || 0,
              is_group: c.id.endsWith('@g.us') ? 1 : 0,
              last_message_timestamp: typeof c.conversationTimestamp === 'number'
                ? c.conversationTimestamp
                : (c.conversationTimestamp as any)?.low || 0
            });
          }
        }

        const yamlConfig = loadYamlConfig();
        const historyDays = yamlConfig.sync?.media_sync_days || 7;
        const cutoffTimestamp = Math.floor(Date.now() / 1000) - historyDays * 86400;

        let importedCount = 0;
        if (histMessages) {
          for (const msg of histMessages) {
            const timestamp = typeof msg.messageTimestamp === 'number'
              ? msg.messageTimestamp
              : (msg.messageTimestamp as any)?.low || 0;

            // Filtro de 7 dias: importa somente mensagens da última semana
            if (timestamp >= cutoffTimestamp) {
              await this.processIncomingMessage(msg, cutoffTimestamp);
              importedCount++;
            }
          }
        }
        console.log(`[WhatsApp] Importadas ${importedCount} mensagens recentes da última semana.`);
      });

      this.sock.ev.on('chats.upsert', (newChats) => {
        for (const c of newChats) {
          upsertContact({
            jid: c.id,
            name: c.name || null,
            unread_count: c.unreadCount || 0,
            is_group: c.id.endsWith('@g.us') ? 1 : 0
          });
        }
      });

      // Novas mensagens em tempo real
      this.sock.ev.on('messages.upsert', async ({ messages: newMessages, type }) => {
        for (const msg of newMessages) {
          await this.processIncomingMessage(msg);
        }
      });
    } catch (err) {
      console.error('[WhatsApp] Erro fatal ao iniciar serviço Baileys:', err);
    } finally {
      this.isStarting = false;
    }
  }

  private async processIncomingMessage(msg: WAMessage, mediaCutoffTimestamp?: number): Promise<void> {
    const key = msg.key;
    if (!key || !key.remoteJid) return;

    const chatJid = key.remoteJid;
    const senderJid = key.participant || chatJid;
    const fromMe = key.fromMe ? 1 : 0;
    const timestamp = typeof msg.messageTimestamp === 'number'
      ? msg.messageTimestamp
      : (msg.messageTimestamp as any)?.low || Math.floor(Date.now() / 1000);

    // 1. Filtro na borda: ignora antes de persistir ou processar mídia
    if (!messageFilter.shouldCollectMessage(chatJid, senderJid)) {
      return;
    }

    // 2. Garante que o contato existe no banco
    upsertContact({
      jid: chatJid,
      notify_name: msg.pushName || null,
      last_message_timestamp: timestamp,
      is_group: chatJid.endsWith('@g.us') ? 1 : 0
    });

    // 3. Extrai conteúdo textual e tipo da mensagem
    const m = msg.message;
    if (!m) return;

    let messageType: 'text' | 'audio' | 'image' | 'video' | 'document' | 'sticker' | 'other' = 'text';
    let content: string | null = null;
    let mediaObject: any = null;
    let mimetype = '';
    let fileName: string | undefined = undefined;

    if (m.conversation) {
      messageType = 'text';
      content = m.conversation;
    } else if (m.extendedTextMessage?.text) {
      messageType = 'text';
      content = m.extendedTextMessage.text;
    } else if (m.audioMessage) {
      messageType = 'audio';
      mediaObject = m.audioMessage;
      mimetype = m.audioMessage.mimetype || 'audio/ogg; codecs=opus';
    } else if (m.imageMessage) {
      messageType = 'image';
      content = m.imageMessage.caption || null;
      mediaObject = m.imageMessage;
      mimetype = m.imageMessage.mimetype || 'image/jpeg';
    } else if (m.videoMessage) {
      messageType = 'video';
      content = m.videoMessage.caption || null;
      mediaObject = m.videoMessage;
      mimetype = m.videoMessage.mimetype || 'video/mp4';
    } else if (m.documentMessage) {
      messageType = 'document';
      content = m.documentMessage.caption || m.documentMessage.title || null;
      fileName = m.documentMessage.fileName || undefined;
      mediaObject = m.documentMessage;
      mimetype = m.documentMessage.mimetype || 'application/octet-stream';
    } else if (m.stickerMessage) {
      messageType = 'sticker';
      mediaObject = m.stickerMessage;
      mimetype = 'image/webp';
    }

    const messageId = key.id || `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Salva a mensagem no banco SQLite
    insertMessage({
      id: messageId,
      chat_jid: chatJid,
      sender_jid: senderJid,
      from_me: fromMe,
      timestamp,
      message_type: messageType,
      content,
      raw_json: JSON.stringify(m)
    });

    // 4. Se houver mídia e respeitar a janela de tempo de retenção, agenda download
    if (mediaObject) {
      const shouldDownloadMedia = mediaCutoffTimestamp ? timestamp >= mediaCutoffTimestamp : true;
      if (shouldDownloadMedia) {
        handleMediaDownload(msg, messageId, chatJid, mimetype, fileName).catch((e) => {
          console.error(`Falha no download da mídia ${messageId}:`, e);
        });
      }
    }
  }
}

export const whatsappService = new WhatsAppService();
