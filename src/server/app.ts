import fs from 'node:fs';
import path from 'node:path';
import fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { authRoutes } from './routes/auth.js';
import { apiRoutes } from './routes/api.js';
import { mcpRoutes } from './routes/mcp.js';

export async function createServer(): Promise<FastifyInstance> {
  const app = fastify({
    logger: false
  });

  await app.register(cors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  });

  // Registra as rotas de API, Auth e MCP
  await app.register(authRoutes);
  await app.register(apiRoutes);
  await app.register(mcpRoutes);

  // Localiza os arquivos estáticos do frontend (produção ou desenvolvimento)
  const candidateDirs = [
    path.resolve(process.cwd(), 'web-dist'),
    path.resolve(process.cwd(), 'web/dist'),
    path.resolve(import.meta.dirname, '../../web-dist'),
    path.resolve(import.meta.dirname, '../../web/dist')
  ];

  const staticDir = candidateDirs.find((dir) => fs.existsSync(dir));

  if (staticDir) {
    console.log(`[HTTP] Servindo Dashboard Web de: ${staticDir}`);
    await app.register(fastifyStatic, {
      root: staticDir,
      prefix: '/'
    });

    // Fallback para SPA (Single Page Application)
    app.setNotFoundHandler((req, reply) => {
      const url = req.raw.url || '';
      if (
        url.startsWith('/api') ||
        url.startsWith('/sse') ||
        url.startsWith('/messages') ||
        url.startsWith('/mcp')
      ) {
        reply.code(404).send({ error: 'Endpoint não encontrado' });
      } else {
        reply.sendFile('index.html');
      }
    });
  } else {
    // Se o frontend ainda não foi compilado, exibe uma mensagem informativa na raiz
    app.get('/', async (_req, reply) => {
      reply.type('text/html').send(`
        <html>
          <body style="font-family: sans-serif; background: #111827; color: white; display: flex; align-items: center; justify-content: center; height: 100vh;">
            <div style="text-align: center; max-width: 500px; padding: 20px;">
              <h2>WhatsApp Gateway MCP Ativo</h2>
              <p>O servidor está rodando. O frontend web será compilado com <code>npm run build</code>.</p>
              <p><a href="/auth" style="color: #10b981;">Acessar tela de pareamento / QR Code</a></p>
            </div>
          </body>
        </html>
      `);
    });
  }

  return app;
}
