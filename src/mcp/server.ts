import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMcpTools } from './tools.js';

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'whatsapp-gateway',
    version: '1.0.0'
  });

  registerMcpTools(server);

  return server;
}
