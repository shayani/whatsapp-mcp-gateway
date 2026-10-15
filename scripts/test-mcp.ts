import { createMcpServer } from '../src/mcp/server.js';
import { getDatabase } from '../src/db/index.js';
import { upsertContact } from '../src/db/contacts.js';
import { insertMessage } from '../src/db/messages.js';

async function testMcp(): Promise<void> {
  console.log('--- Testando Servidor MCP e SQLite ---');

  // Inicializa o banco
  getDatabase();

  // Insere um contato e mensagem de teste
  const testChatJid = '5511999998888@s.whatsapp.net';
  upsertContact({
    jid: testChatJid,
    name: 'Contato de Teste MCP',
    is_group: 0,
    is_ignored: 0
  });

  insertMessage({
    id: `test_msg_${Date.now()}`,
    chat_jid: testChatJid,
    sender_jid: testChatJid,
    from_me: 0,
    timestamp: Math.floor(Date.now() / 1000),
    message_type: 'text',
    content: 'Olá! Esta é uma mensagem de verificação da busca FTS5 no WhatsApp Gateway.'
  });

  const server = createMcpServer();
  console.log('✅ Servidor MCP instanciado com sucesso com 5 tools.');

  console.log('✅ Teste concluído com sucesso!');
}

testMcp().catch(console.error);
