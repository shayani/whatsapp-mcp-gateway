import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  normalizeMessageContent,
  extractMessageContent,
  jidNormalizedUser,
  type WAMessage,
  type WASocket,
  type ConnectionState
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import { config, loadYamlConfig } from '../config.js';
import { upsertContact, getContact, linkJids, isSendAllowedForContact } from '../db/contacts.js';
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
          const name = contact.name || (contact as any).verifiedName || contact.notify || null;
          upsertContact({
            jid: contact.id,
            name,
            notify_name: contact.notify || null,
            is_group: contact.id.endsWith('@g.us') ? 1 : 0
          });
          // Se tiver lid e jid associados, garante sincronização para ambos
          if (contact.lid && contact.lid !== contact.id) {
            linkJids(contact.id, contact.lid);
            upsertContact({
              jid: contact.lid,
              name,
              notify_name: contact.notify || null,
              is_group: 0
            });
          }
          if (contact.jid && contact.jid !== contact.id) {
            linkJids(contact.id, contact.jid);
            upsertContact({
              jid: contact.jid,
              name,
              notify_name: contact.notify || null,
              is_group: 0
            });
          }
        }
      });

      this.sock.ev.on('contacts.update', (updates) => {
        for (const update of updates) {
          if (update.id) {
            const name = update.name || (update as any).verifiedName || update.notify || null;
            upsertContact({
              jid: update.id,
              name,
              notify_name: update.notify || null
            });
            if (update.lid && update.lid !== update.id) {
              linkJids(update.id, update.lid);
              upsertContact({
                jid: update.lid,
                name,
                notify_name: update.notify || null
              });
            }
          }
        }
      });

      // Histórico inicial enviado pelo WhatsApp
      this.sock.ev.on('messaging-history.set', async ({ messages: histMessages, chats, contacts }) => {
        console.log(`[WhatsApp] Recebidos ${histMessages?.length || 0} mensagens e ${chats?.length || 0} conversas no sync de histórico.`);

        if (contacts) {
          for (const c of contacts) {
            const name = c.name || (c as any).verifiedName || c.notify || null;
            upsertContact({
              jid: c.id,
              name,
              notify_name: c.notify || null,
              is_group: c.id.endsWith('@g.us') ? 1 : 0
            });
            if (c.lid && c.lid !== c.id) {
              linkJids(c.id, c.lid);
              upsertContact({
                jid: c.lid,
                name,
                notify_name: c.notify || null,
                is_group: 0
              });
            }
            if (c.jid && c.jid !== c.id) {
              linkJids(c.id, c.jid);
              upsertContact({
                jid: c.jid,
                name,
                notify_name: c.notify || null,
                is_group: 0
              });
            }
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

      // Associação explícita enviada pelo WhatsApp entre LID e JID telefônico
      this.sock.ev.on('chats.phoneNumberShare', ({ lid, jid }) => {
        if (lid && jid) {
          linkJids(jid, lid);
          const contact = getContact(jid);
          if (contact?.name) {
            upsertContact({
              jid: lid,
              name: contact.name,
              notify_name: contact.notify_name
            });
          }
        }
      });

      // Novas mensagens em tempo real
      this.sock.ev.on('messages.upsert', async ({ messages: newMessages, type }) => {
        for (const msg of newMessages) {
          await this.processIncomingMessage(msg);
        }
      });

      // Mensagens atualizadas (ex: descriptografadas após retry, editadas, etc.)
      this.sock.ev.on('messages.update', async (updates) => {
        for (const { key, update } of updates) {
          if (update.message) {
            await this.processIncomingMessage({
              key,
              ...update
            } as WAMessage);
          }
        }
      });
    } catch (err) {
      console.error('[WhatsApp] Erro fatal ao iniciar serviço Baileys:', err);
    } finally {
      this.isStarting = false;
    }
  }

  public async syncGroupMetadata(groupJid: string): Promise<void> {
    if (!this.sock || !groupJid.endsWith('@g.us')) return;
    try {
      const metadata = await this.sock.groupMetadata(groupJid);
      if (metadata?.participants) {
        for (const p of metadata.participants) {
          const participantJid = p.jid ? jidNormalizedUser(p.jid) : (p.id ? jidNormalizedUser(p.id) : null);
          const lid = p.lid ? jidNormalizedUser(p.lid) : null;

          if (participantJid) {
            upsertContact({
              jid: participantJid,
              is_group: 0
            });
          }

          if (lid) {
            upsertContact({
              jid: lid,
              is_group: 0
            });
          }

          if (participantJid && lid && participantJid !== lid) {
            linkJids(participantJid, lid);
            const phoneContact = getContact(participantJid);
            if (phoneContact?.name) {
              upsertContact({
                jid: lid,
                name: phoneContact.name,
                notify_name: phoneContact.notify_name
              });
            }
          }
        }
      }
    } catch (e) {
      console.warn(`[WhatsApp] Não foi possível carregar metadados do grupo ${groupJid}:`, e);
    }
  }

  private async processIncomingMessage(msg: WAMessage, mediaCutoffTimestamp?: number): Promise<void> {
    const key = msg.key;
    if (!key || !key.remoteJid) return;

    const chatJid = key.remoteJid;
    const isGroup = chatJid.endsWith('@g.us');
    const fromMe = key.fromMe ? 1 : 0;

    const rawSender = msg.participant || key.participant || (key as any).participantPn || (key as any).senderPn;
    const senderJid = (isGroup && !fromMe && rawSender)
      ? jidNormalizedUser(rawSender)
      : (fromMe ? (this.sock?.user?.id ? jidNormalizedUser(this.sock.user.id) : chatJid) : chatJid);

    const timestamp = typeof msg.messageTimestamp === 'number'
      ? msg.messageTimestamp
      : (msg.messageTimestamp as any)?.low || Math.floor(Date.now() / 1000);

    // 1. Filtro na borda: ignora antes de persistir ou processar mídia
    if (!messageFilter.shouldCollectMessage(chatJid, senderJid)) {
      return;
    }

    // Se a mensagem contiver o telefone associado no key (senderPn / participantPn), vincula ao chatJid
    const phoneJid = (key as any).senderPn || (key as any).participantPn;
    if (phoneJid && chatJid.endsWith('@lid')) {
      linkJids(chatJid, phoneJid);
      const phoneContact = getContact(phoneJid);
      if (phoneContact?.name) {
        upsertContact({
          jid: chatJid,
          name: phoneContact.name,
          notify_name: phoneContact.notify_name
        });
      }
    }

    const m = msg.message;
    if (!m) {
      // Se a mensagem chegou como ciphertext / falha de chave, solicita reenvio automático ao remetente
      if ((msg as any).messageStubType === 2 && this.sock?.requestPlaceholderResend) {
        this.sock.requestPlaceholderResend(key).catch((e) => {
          console.error(`[WhatsApp] Falha ao solicitar reenvio para ${key.id}:`, e);
        });
      }
      return;
    }

    // 2. Extrai tipo, conteúdo e mídia
    const details = extractMessageDetails(m);
    if (details.isProtocol) {
      return;
    }

    // 3. Garante que o contato/grupo existe no banco
    // IMPORTANTE: Só atualiza notify_name do chat se a mensagem foi recebida do contato (!fromMe) e não for grupo
    // Se fromMe=true, msg.pushName é o nome do próprio usuário e não do contato remoto
    const remoteNotifyName = (!fromMe && !isGroup) ? (msg.pushName || null) : null;

    upsertContact({
      jid: chatJid,
      notify_name: remoteNotifyName,
      last_message_timestamp: timestamp,
      is_group: isGroup ? 1 : 0
    });

    // Se for mensagem de grupo e não for enviada por mim, registra/atualiza o participante
    if (isGroup && !fromMe && senderJid && senderJid !== chatJid) {
      upsertContact({
        jid: senderJid,
        notify_name: msg.pushName || null,
        is_group: 0
      });

      const participantPn = (key as any).participantPn || (key as any).senderPn;
      if (participantPn && senderJid.endsWith('@lid')) {
        linkJids(senderJid, participantPn);
        const phoneContact = getContact(participantPn);
        if (phoneContact?.name) {
          upsertContact({
            jid: senderJid,
            name: phoneContact.name,
            notify_name: phoneContact.notify_name
          });
        }
      }
    }

    const messageId = key.id || `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Salva a mensagem no banco SQLite
    insertMessage({
      id: messageId,
      chat_jid: chatJid,
      sender_jid: senderJid,
      from_me: fromMe,
      timestamp,
      message_type: details.messageType,
      content: details.content,
      raw_json: JSON.stringify(m)
    });

    // 4. Se houver mídia e respeitar a janela de tempo de retenção, agenda download
    if (details.mediaObject) {
      const shouldDownloadMedia = mediaCutoffTimestamp ? timestamp >= mediaCutoffTimestamp : true;
      if (shouldDownloadMedia) {
        handleMediaDownload(msg, messageId, chatJid, details.mimetype, details.fileName).catch((e) => {
          console.error(`Falha no download da mídia ${messageId}:`, e);
        });
      }
    }
  }

  private recentSends = new Map<string, number[]>();

  public async sendMessage(
    recipient: string,
    text: string,
    source = 'mcp_hermes'
  ): Promise<{ success: boolean; messageId: string; targetJid: string; timestamp: number }> {
    if (!this.sock || this.state.status !== 'connected') {
      throw new Error('WhatsApp não está conectado no momento. Não é possível enviar a mensagem.');
    }

    if (!text || text.trim().length === 0) {
      throw new Error('O texto da mensagem não pode ser vazio.');
    }

    // 1. Normalização do destinatário
    let targetJid = recipient.trim();

    // Se for grupo, bloqueia sumariamente conforme decisão Q1
    if (targetJid.endsWith('@g.us')) {
      throw new Error('Envio para grupos (@g.us) está estritamente bloqueado por política de segurança.');
    }

    // Se for apenas número com ou sem '+', formata para @s.whatsapp.net
    if (!targetJid.includes('@')) {
      const cleanNumber = targetJid.replace(/\D/g, '');
      if (cleanNumber.length < 8) {
        throw new Error(`Número de telefone inválido: ${recipient}`);
      }
      targetJid = `${cleanNumber}@s.whatsapp.net`;
    }

    // 2. Verifica se o contato tem autorização de envio habilitada pelo usuário
    const allowed = isSendAllowedForContact(targetJid);
    if (!allowed) {
      throw new Error(
        `Envio bloqueado: O contato ${targetJid} não possui autorização de envio habilitada pelo usuário no painel.`
      );
    }

    // 3. Circuit Breaker / Rate Limiting (máx 5 msgs a cada 10 min, mínimo 3s entre envios)
    const now = Date.now();
    const tenMinutesAgo = now - 10 * 60 * 1000;
    const history = (this.recentSends.get(targetJid) || []).filter((t) => t > tenMinutesAgo);

    if (history.length > 0) {
      const lastSend = history[history.length - 1];
      if (now - lastSend < 3000) {
        throw new Error(
          `Cooldown ativo: Aguarde pelo menos 3 segundos entre mensagens para ${targetJid}.`
        );
      }
    }

    if (history.length >= 5) {
      throw new Error(
        `Circuit Breaker: Limite de envio excedido para ${targetJid} (máximo de 5 mensagens a cada 10 minutos).`
      );
    }

    // 4. Envia a mensagem via Baileys
    const sent = await this.sock.sendMessage(targetJid, { text });
    const messageId = sent?.key?.id || `msg_out_${now}_${Math.random().toString(36).substring(7)}`;
    const timestamp = Math.floor(now / 1000);

    // Registra o timestamp para rate limiting
    history.push(now);
    this.recentSends.set(targetJid, history);

    // 5. Registra no banco SQLite com auditoria de origem (source: 'mcp_hermes')
    const myJid = this.sock.user?.id ? jidNormalizedUser(this.sock.user.id) : targetJid;
    insertMessage({
      id: messageId,
      chat_jid: targetJid,
      sender_jid: myJid,
      from_me: 1,
      timestamp,
      message_type: 'text',
      content: text,
      raw_json: JSON.stringify({
        source,
        key: sent?.key,
        message: { conversation: text }
      })
    });

    upsertContact({
      jid: targetJid,
      last_message_timestamp: timestamp,
      is_group: 0
    });

    return {
      success: true,
      messageId,
      targetJid,
      timestamp
    };
  }
}

export function extractMessageDetails(m: any): {
  messageType: 'text' | 'audio' | 'image' | 'video' | 'document' | 'sticker' | 'other';
  content: string | null;
  mediaObject: any;
  mimetype: string;
  fileName?: string;
  isProtocol: boolean;
} {
  if (!m) {
    return { messageType: 'other', content: null, mediaObject: null, mimetype: '', isProtocol: false };
  }

  // 1. Mensagens internas de protocolo (sincronização, revocação, etc.) não devem ser salvas como chat
  if (m.protocolMessage) {
    return { messageType: 'other', content: null, mediaObject: null, mimetype: '', isProtocol: true };
  }

  const normalized = normalizeMessageContent(m) || m;
  const extracted = extractMessageContent(normalized) || normalized;

  let messageType: 'text' | 'audio' | 'image' | 'video' | 'document' | 'sticker' | 'other' = 'text';
  let content: string | null = null;
  let mediaObject: any = null;
  let mimetype = '';
  let fileName: string | undefined = undefined;

  if (extracted.conversation) {
    messageType = 'text';
    content = extracted.conversation;
  } else if (extracted.extendedTextMessage?.text) {
    messageType = 'text';
    content = extracted.extendedTextMessage.text;
  } else if (extracted.audioMessage) {
    messageType = 'audio';
    mediaObject = extracted.audioMessage;
    mimetype = extracted.audioMessage.mimetype || 'audio/ogg; codecs=opus';
  } else if (extracted.imageMessage) {
    messageType = 'image';
    content = extracted.imageMessage.caption || null;
    mediaObject = extracted.imageMessage;
    mimetype = extracted.imageMessage.mimetype || 'image/jpeg';
  } else if (extracted.videoMessage) {
    messageType = 'video';
    content = extracted.videoMessage.caption || null;
    mediaObject = extracted.videoMessage;
    mimetype = extracted.videoMessage.mimetype || 'video/mp4';
  } else if (extracted.documentMessage) {
    messageType = 'document';
    content = extracted.documentMessage.caption || extracted.documentMessage.title || null;
    fileName = extracted.documentMessage.fileName || undefined;
    mediaObject = extracted.documentMessage;
    mimetype = extracted.documentMessage.mimetype || 'application/octet-stream';
  } else if (extracted.stickerMessage) {
    messageType = 'sticker';
    mediaObject = extracted.stickerMessage;
    mimetype = 'image/webp';
  }

  // 2. Extração para templates de empresas, botões interativos, respostas de botões, listas e contatos
  if (!content) {
    const tm = m.templateMessage || normalized.templateMessage;
    if (tm?.hydratedFourRowTemplate?.hydratedContentText) {
      content = tm.hydratedFourRowTemplate.hydratedContentText;
    } else if (tm?.hydratedTemplate?.hydratedContentText) {
      content = tm.hydratedTemplate.hydratedContentText;
    } else if (tm?.fourRowTemplate?.contentText) {
      content = tm.fourRowTemplate.contentText;
    } else if (tm?.interactiveMessageTemplate?.body?.text) {
      content = tm.interactiveMessageTemplate.body.text;
    }

    const bm = m.buttonsMessage || normalized.buttonsMessage;
    if (!content && bm?.contentText) {
      content = bm.contentText;
    }

    const brm = m.buttonsResponseMessage || normalized.buttonsResponseMessage;
    if (!content && brm?.selectedDisplayText) {
      content = brm.selectedDisplayText;
    }

    const im = m.interactiveMessage || normalized.interactiveMessage;
    if (!content && im?.body?.text) {
      content = im.body.text;
    }

    const irm = m.interactiveResponseMessage || normalized.interactiveResponseMessage;
    if (!content && irm?.body?.text) {
      content = irm.body.text;
    }

    const lm = m.listMessage || normalized.listMessage;
    if (!content && (lm?.description || lm?.title)) {
      content = [lm.title, lm.description].filter(Boolean).join('\n');
    }

    const lrm = m.listResponseMessage || normalized.listResponseMessage;
    if (!content && (lrm?.title || lrm?.singleSelectReply?.selectedRowId)) {
      content = lrm.title || lrm.singleSelectReply?.selectedRowId || null;
    }

    if (!content && m.contactMessage?.displayName) {
      content = `[Contato: ${m.contactMessage.displayName}]`;
    }

    if (!content && m.contactsArrayMessage?.displayName) {
      content = `[Contatos: ${m.contactsArrayMessage.displayName}]`;
    }

    if (!content && (m.locationMessage?.name || m.locationMessage?.address)) {
      content = `[Localização: ${[m.locationMessage.name, m.locationMessage.address].filter(Boolean).join(' - ')}]`;
    }

    if (!content && m.liveLocationMessage) {
      content = `[Localização em tempo real: ${m.liveLocationMessage.caption || ''}]`.trim();
    }
  }

  return { messageType, content, mediaObject, mimetype, fileName, isProtocol: false };
}

export const whatsappService = new WhatsAppService();
