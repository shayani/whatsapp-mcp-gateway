import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.js';
import { getDatabase } from '../db/index.js';

async function runStdio(): Promise<void> {
  // Garante que o banco está aberto
  getDatabase();

  const server = createMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error('[MCP] Servidor MCP WhatsApp rodando em modo stdio.');
}

runStdio().catch((err) => {
  console.error('[MCP] Erro fatal no modo stdio:', err);
  process.exit(1);
});
