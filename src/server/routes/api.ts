import fs from 'node:fs';
import path from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { listContacts, toggleIgnoreContact, updateContactName, toggleAllowSendContact } from '../../db/contacts.js';
import { listChatMessages, searchMessages } from '../../db/messages.js';
import { getAttachment } from '../../db/attachments.js';
import { setSetting, getEffectiveGroqApiKey } from '../../db/settings.js';
import { messageFilter } from '../../whatsapp/filter.js';
import { transcriptionQueue } from '../../transcription/queue.js';
import { config } from '../../config.js';
import { whatsappService } from '../../whatsapp/connection.js';

import {
  getStorageSummary,
  getStorageByChat,
  getChatStorageDetails,
  cleanStorage,
  resolveAttachmentPath
} from '../../db/storage.js';

export const apiRoutes: FastifyPluginAsync = async (fastify) => {
  // Middleware de proteção básica se DASHBOARD_PASSWORD estiver configurado
  fastify.addHook('preHandler', async (req, reply) => {
    if (!config.dashboardPassword) return;

    // Ignora rotas de auth, sse e anexos públicos (para <img>, <audio>, etc.)
    if (
      req.url.startsWith('/api/auth') ||
      req.url.startsWith('/sse') ||
      req.url.startsWith('/messages') ||
      req.url.startsWith('/api/ui/attachments')
    ) {
      return;
    }

    const authHeader = req.headers.authorization;
    const cookieHeader = req.headers['x-dashboard-password'];

    let providedPassword = '';
    if (authHeader && authHeader.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.replace('Basic ', ''), 'base64').toString('utf-8');
      providedPassword = decoded.split(':')[1] || decoded;
    } else if (typeof cookieHeader === 'string') {
      providedPassword = cookieHeader;
    }

    if (providedPassword !== config.dashboardPassword) {
      reply.header('WWW-Authenticate', 'Basic realm="WhatsApp Gateway Dashboard"');
      return reply.code(401).send({ error: 'Acesso não autorizado. Informe a senha do dashboard.' });
    }
  });

  // 1. Listar conversas / contatos com filtros
  fastify.get('/api/ui/chats', async (req) => {
    const querySchema = z.object({
      search: z.string().optional(),
      limit: z.coerce.number().optional().default(100),
      offset: z.coerce.number().optional().default(0)
    });

    const parsed = querySchema.parse(req.query);
    const chats = listContacts(parsed.search, parsed.limit, parsed.offset);
    return { chats };
  });

  // 2. Alternar status de coleta (is_ignored)
  fastify.post('/api/ui/chats/toggle-ignore', async (req) => {
    const bodySchema = z.object({
      jid: z.string(),
      is_ignored: z.boolean()
    });

    const { jid, is_ignored } = bodySchema.parse(req.body);

    toggleIgnoreContact(jid, is_ignored);
    messageFilter.setJidIgnoredInMemory(jid, is_ignored);

    return { success: true, jid, is_ignored };
  });

  // 2.1 Atualizar nome amigável do contato
  fastify.post('/api/ui/chats/update-name', async (req) => {
    const bodySchema = z.object({
      jid: z.string(),
      name: z.string().min(1)
    });

    const { jid, name } = bodySchema.parse(req.body);
    updateContactName(jid, name.trim());
    return { success: true, jid, name: name.trim() };
  });

  // 2.2 Alternar status de envio pelo agente Hermes (allow_send)
  fastify.post('/api/ui/chats/toggle-send', async (req, reply) => {
    const bodySchema = z.object({
      jid: z.string(),
      allow_send: z.boolean()
    });

    const { jid, allow_send } = bodySchema.parse(req.body);

    if (jid.endsWith('@g.us') && allow_send) {
      return reply.code(400).send({ success: false, error: 'Envio para grupos não é permitido.' });
    }

    toggleAllowSendContact(jid, allow_send);
    return { success: true, jid, allow_send };
  });

  // 3. Listar mensagens de uma conversa específica
  fastify.get('/api/ui/chats/:jid/messages', async (req) => {
    const paramsSchema = z.object({ jid: z.string() });
    const querySchema = z.object({
      limit: z.coerce.number().optional().default(50),
      before: z.coerce.number().optional()
    });

    const { jid } = paramsSchema.parse(req.params);
    const { limit, before } = querySchema.parse(req.query);

    if (jid.endsWith('@g.us')) {
      whatsappService.syncGroupMetadata(jid).catch(() => {});
    }

    const messages = listChatMessages(jid, limit, before);
    return { messages };
  });

  // 4. Busca global FTS5
  fastify.get('/api/ui/search', async (req) => {
    const querySchema = z.object({
      q: z.string().min(1),
      chat_jid: z.string().optional(),
      limit: z.coerce.number().optional().default(30)
    });

    const { q, chat_jid, limit } = querySchema.parse(req.query);
    const results = searchMessages(q, chat_jid, limit);
    return { results };
  });

  // 5. Configurações (ex: Chave Groq)
  fastify.get('/api/ui/settings', async () => {
    const effectiveGroqKey = getEffectiveGroqApiKey();
    return {
      hasGroqKey: Boolean(effectiveGroqKey),
      groqKeyMasked: effectiveGroqKey
        ? `${effectiveGroqKey.slice(0, 4)}...${effectiveGroqKey.slice(-4)}`
        : null,
      readOnly: config.readOnly
    };
  });

  fastify.post('/api/ui/settings', async (req) => {
    const bodySchema = z.object({
      groq_api_key: z.string().optional()
    });

    const { groq_api_key } = bodySchema.parse(req.body);

    if (groq_api_key !== undefined) {
      setSetting('groq_api_key', groq_api_key.trim());
      // Notifica a fila para processar pendentes imediatamente com a nova chave
      transcriptionQueue.notifyNewAudio();
    }

    return { success: true };
  });

  // 6. Servir anexo / mídia (imagens, áudio, vídeos, documentos)
  fastify.get('/api/ui/attachments/:id', async (req, reply) => {
    const paramsSchema = z.object({ id: z.string() });
    const { id } = paramsSchema.parse(req.params);

    const att = getAttachment(id);
    if (!att) {
      return reply.code(404).send({ error: 'Anexo não encontrado' });
    }

    const resolvedPath = resolveAttachmentPath(att.file_path);
    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      return reply.code(404).send({ error: 'Arquivo do anexo não encontrado no disco' });
    }

    const stat = fs.statSync(resolvedPath);
    const mime = att.mimetype || 'application/octet-stream';
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunksize = end - start + 1;

      reply.code(206);
      reply.header('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      reply.header('Accept-Ranges', 'bytes');
      reply.header('Content-Length', chunksize);
      reply.header('Content-Type', mime);
      return reply.send(fs.createReadStream(resolvedPath, { start, end }));
    }

    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Type', mime);
    reply.header('Content-Length', stat.size);
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(att.file_name || att.id)}"`);

    return reply.send(fs.createReadStream(resolvedPath));
  });

  // 7. Estatísticas de Armazenamento (Resumo Geral)
  fastify.get('/api/ui/storage/summary', async (req) => {
    const querySchema = z.object({
      refresh: z.preprocess((val) => val === 'true' || val === true, z.boolean()).optional()
    });
    const { refresh } = querySchema.parse(req.query);
    const summary = getStorageSummary(Boolean(refresh));
    return { summary };
  });

  // 7.1 Estatísticas de Armazenamento por Conversa (Ranking das mais pesadas)
  fastify.get('/api/ui/storage/chats', async (req) => {
    const querySchema = z.object({
      limit: z.coerce.number().optional().default(100),
      search: z.string().optional(),
      refresh: z.preprocess((val) => val === 'true' || val === true, z.boolean()).optional()
    });
    const { limit, search, refresh } = querySchema.parse(req.query);
    const chats = getStorageByChat(limit, search, Boolean(refresh));
    return { chats };
  });

  // 7.2 Detalhes de Armazenamento de um Contato / Chat Específico
  fastify.get('/api/ui/storage/chats/:jid', async (req) => {
    const paramsSchema = z.object({ jid: z.string() });
    const { jid } = paramsSchema.parse(req.params);
    const details = getChatStorageDetails(jid);
    return { details };
  });

  // 7.3 Executar Limpeza de Armazenamento (Apenas Mídias ou Mídias + Conversas)
  fastify.post('/api/ui/storage/clean', async (req) => {
    const bodySchema = z.object({
      target: z.string().min(1),
      mode: z.enum(['media_only', 'all']),
      olderThanDays: z.coerce.number().optional().default(0)
    });

    const parsed = bodySchema.parse(req.body);
    const result = cleanStorage(parsed);
    return { success: true, result };
  });
};

