import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { listContacts, toggleIgnoreContact, updateContactName } from '../../db/contacts.js';
import { listChatMessages, searchMessages } from '../../db/messages.js';
import { setSetting, getEffectiveGroqApiKey } from '../../db/settings.js';
import { messageFilter } from '../../whatsapp/filter.js';
import { transcriptionQueue } from '../../transcription/queue.js';
import { config } from '../../config.js';

export const apiRoutes: FastifyPluginAsync = async (fastify) => {
  // Middleware de proteção básica se DASHBOARD_PASSWORD estiver configurado
  fastify.addHook('preHandler', async (req, reply) => {
    if (!config.dashboardPassword) return;

    // Ignora rotas de auth e sse
    if (req.url.startsWith('/api/auth') || req.url.startsWith('/sse') || req.url.startsWith('/messages')) {
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

  // 3. Listar mensagens de uma conversa específica
  fastify.get('/api/ui/chats/:jid/messages', async (req) => {
    const paramsSchema = z.object({ jid: z.string() });
    const querySchema = z.object({
      limit: z.coerce.number().optional().default(50),
      before: z.coerce.number().optional()
    });

    const { jid } = paramsSchema.parse(req.params);
    const { limit, before } = querySchema.parse(req.query);

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
};
