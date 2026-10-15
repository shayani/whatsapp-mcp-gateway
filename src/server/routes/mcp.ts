import type { FastifyPluginAsync } from 'fastify';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from '../../mcp/server.js';
import { config } from '../../config.js';

// Mapa de sessões ativas do MCP SSE Legado
const activeSseTransports = new Map<string, SSEServerTransport>();

export const mcpRoutes: FastifyPluginAsync = async (fastify) => {
  // Middleware de autorização para o MCP
  const checkMcpAuth = (authHeader?: string): boolean => {
    if (!config.mcpApiKey) return true; // Se não configurado, acesso livre na rede/localhost
    if (!authHeader) return false;
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    return token === config.mcpApiKey;
  };

  // 1. Transporte Streamable HTTP (usado por Hermes e clientes MCP modernos)
  const handleStreamablePost = async (req: any, reply: any) => {
    if (!checkMcpAuth(req.headers.authorization)) {
      reply.code(401).send({ error: 'Não autorizado. Token MCP inválido ou ausente.' });
      return;
    }

    const server = createMcpServer();
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined // Modo stateless: permite conexões simultâneas de múltiplos agentes sem conflito de sessão
      });

      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);

      reply.raw.on('close', () => {
        transport.close();
        server.close();
      });
    } catch (error) {
      console.error('[MCP Streamable] Erro na requisição:', error);
      if (!reply.raw.headersSent) {
        reply.code(500).send({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null
        });
      }
    }
  };

  fastify.post('/mcp', handleStreamablePost);
  fastify.post('/sse', handleStreamablePost);

  // 2. Endpoint SSE Legado (GET /sse: usado por Claude Desktop)
  fastify.get('/sse', async (req, reply) => {
    if (!checkMcpAuth(req.headers.authorization)) {
      reply.code(401).send({ error: 'Não autorizado. Token MCP inválido ou ausente.' });
      return;
    }

    // Configura headers SSE
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');

    const mcpServer = createMcpServer();
    const transport = new SSEServerTransport('/messages', reply.raw);

    const sessionId = transport.sessionId;
    activeSseTransports.set(sessionId, transport);

    reply.raw.on('close', () => {
      activeSseTransports.delete(sessionId);
    });

    await mcpServer.connect(transport);
  });

  // 3. Endpoint para envio de mensagens JSON-RPC em conexões SSE Legadas
  fastify.post('/messages', async (req, reply) => {
    const sessionId = (req.query as { sessionId?: string })?.sessionId;

    let transport: SSEServerTransport | undefined;

    if (sessionId) {
      transport = activeSseTransports.get(sessionId);
    } else if (activeSseTransports.size === 1) {
      transport = activeSseTransports.values().next().value;
    }

    if (!transport) {
      reply.code(404).send({ error: 'Sessão MCP não encontrada.' });
      return;
    }

    await transport.handlePostMessage(req.raw, reply.raw, req.body);
  });
};
