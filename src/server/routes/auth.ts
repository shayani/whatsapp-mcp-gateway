import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { whatsappService } from '../../whatsapp/connection.js';

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/auth/status', async () => {
    // Se o serviço estiver parado sem estar conectado nem com QR gerado, auto-inicia
    if (whatsappService.state.status === 'disconnected' && !whatsappService.isStarting && !whatsappService.state.qrCodeDataUrl) {
      whatsappService.start().catch((err) => {
        console.error('[WhatsApp] Erro ao auto-iniciar via /api/auth/status:', err);
      });
    }

    return {
      status: whatsappService.state.status,
      qrCodeDataUrl: whatsappService.state.qrCodeDataUrl,
      userJid: whatsappService.state.userJid,
      userName: whatsappService.state.userName
    };
  });

  fastify.post('/api/auth/reconnect', async (req) => {
    const bodySchema = z.object({
      forceClean: z.boolean().optional().default(true)
    }).optional();

    const parsed = bodySchema ? bodySchema.parse(req.body) : { forceClean: true };
    const forceClean = parsed?.forceClean ?? true;

    console.log(`[WhatsApp] Requisição manual de reconexão recebida (forceClean: ${forceClean})`);

    whatsappService.restart(forceClean).catch((err) => {
      console.error('[WhatsApp] Erro ao reiniciar serviço via /api/auth/reconnect:', err);
    });

    return { success: true, message: 'Reconexão iniciada. Um novo QR Code está sendo gerado.' };
  });

  fastify.get('/auth', async (_req, reply) => {
    reply.type('text/html; charset=utf-8');

    const state = whatsappService.state;

    if (state.status === 'connected') {
      return reply.send(`
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
          <meta charset="UTF-8">
          <title>WhatsApp Conectado</title>
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-900 text-white flex flex-col items-center justify-center min-h-screen p-4">
          <div class="bg-gray-800 p-8 rounded-2xl shadow-xl max-w-md w-full text-center border border-emerald-500/30">
            <div class="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">
              ✓
            </div>
            <h1 class="text-2xl font-bold mb-2 text-emerald-400">WhatsApp Conectado!</h1>
            <p class="text-gray-300 text-sm mb-4">Sessão ativa como: <span class="font-semibold text-white">${state.userName || state.userJid}</span></p>
            <a href="/" class="inline-block bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-6 py-2.5 rounded-lg transition">
              Abrir Dashboard de Mensagens
            </a>
          </div>
        </body>
        </html>
      `);
    }

    return reply.send(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <title>Conectar WhatsApp — Escanear QR Code</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-gray-900 text-white flex flex-col items-center justify-center min-h-screen p-4">
        <div class="bg-gray-800 p-8 rounded-2xl shadow-xl max-w-md w-full text-center border border-gray-700">
          <h1 class="text-2xl font-bold mb-2">Conectar ao WhatsApp</h1>
          <p class="text-gray-400 text-sm mb-6">Abra o WhatsApp no seu celular > Aparelhos conectados > Conectar um aparelho.</p>

          <div id="qr-container" class="bg-white p-4 rounded-xl inline-block mx-auto mb-4">
            ${
              state.qrCodeDataUrl
                ? `<img src="${state.qrCodeDataUrl}" alt="QR Code WhatsApp" class="w-64 h-64 mx-auto" />`
                : `<div class="w-64 h-64 flex flex-col items-center justify-center text-gray-500 text-sm">
                     <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500 mb-2"></div>
                     Aguardando geração do QR Code...
                   </div>`
            }
          </div>

          <div class="mt-2">
            <button id="btn-reconnect" onclick="triggerReconnect()" class="text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 px-4 py-2 rounded-lg transition inline-flex items-center gap-1.5 cursor-pointer">
              <span>🔄 Gerar Novo QR Code</span>
            </button>
          </div>

          <p class="text-xs text-gray-500 mt-4">O QR Code atualiza automaticamente a cada 20 segundos.</p>
        </div>

        <script>
          async function triggerReconnect() {
            const btn = document.getElementById('btn-reconnect');
            if (btn) btn.innerText = 'Solicitando novo QR...';
            try {
              await fetch('/api/auth/reconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ forceClean: true }) });
            } catch (e) {}
            setTimeout(() => { if (btn) btn.innerText = '🔄 Gerar Novo QR Code'; }, 2000);
          }

          // Polling para recarregar se o status mudar
          setInterval(async () => {
            try {
              const res = await fetch('/api/auth/status');
              const data = await res.json();
              if (data.status === 'connected') {
                window.location.reload();
              } else if (data.qrCodeDataUrl) {
                const img = document.querySelector('#qr-container img');
                if (img) {
                  if (img.src !== data.qrCodeDataUrl) img.src = data.qrCodeDataUrl;
                } else {
                  document.querySelector('#qr-container').innerHTML = '<img src="' + data.qrCodeDataUrl + '" alt="QR Code" class="w-64 h-64 mx-auto" />';
                }
              }
            } catch (e) {}
          }, 2000);
        </script>
      </body>
      </html>
    `);
  });
};
