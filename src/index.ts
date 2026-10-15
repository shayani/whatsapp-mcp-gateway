import { config } from './config.js';
import { getDatabase } from './db/index.js';
import { transcriptionQueue } from './transcription/queue.js';
import { whatsappService } from './whatsapp/connection.js';
import { createServer } from './server/app.js';

async function main(): Promise<void> {
  console.log('====================================================');
  console.log('         WhatsApp Gateway & MCP Server              ');
  console.log('====================================================');
  console.log(`[Config] Porta: ${config.port}`);
  console.log(`[Config] Diretório de Dados: ${config.dataDir}`);
  console.log(`[Config] Somente-Leitura (Read-Only): ${config.readOnly}`);

  // 1. Inicializa o banco de dados SQLite (WAL mode + migrações)
  try {
    getDatabase();
    console.log('✅ [SQLite] Banco de dados inicializado em modo WAL com FTS5.');
  } catch (err) {
    console.error('❌ [SQLite] Erro ao inicializar banco de dados:', err);
    process.exit(1);
  }

  // 2. Inicia o worker da fila de transcrição assíncrona
  transcriptionQueue.start();
  console.log('✅ [Transcrição] Fila assíncrona iniciada.');

  // 3. Inicia o servidor HTTP (Web UI + MCP SSE)
  const app = await createServer();
  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`✅ [HTTP] Servidor rodando em: http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
    console.log(`   - Dashboard Web: http://localhost:${config.port}/`);
    console.log(`   - Pareamento QR: http://localhost:${config.port}/auth`);
    console.log(`   - MCP SSE Endpoint: http://localhost:${config.port}/sse`);
  } catch (err) {
    console.error('❌ [HTTP] Erro ao subir servidor HTTP:', err);
    process.exit(1);
  }

  // 4. Inicia a conexão com o WhatsApp via Baileys
  console.log('🔄 [WhatsApp] Conectando ao Baileys...');
  whatsappService.start().catch((err) => {
    console.error('❌ [WhatsApp] Falha ao iniciar Baileys:', err);
  });

  // Tratamento de encerramento suave (Graceful Shutdown)
  const shutdown = async (signal: string) => {
    console.log(`\n[Shutdown] Recebido sinal ${signal}. Encerrando graciosamente...`);
    transcriptionQueue.stop();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
