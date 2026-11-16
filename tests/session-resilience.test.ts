import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { proto } from '@whiskeysockets/baileys';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-gateway-resilience-test-'));
process.env.DATA_DIR = tempDir;

const { getDatabase } = await import('../src/db/index.js');
const { upsertContact, toggleAllowSendContact } = await import('../src/db/contacts.js');
const { insertMessage } = await import('../src/db/messages.js');
const { useAtomicMultiFileAuthState } = await import('../src/whatsapp/authState.js');
const { acquireInstanceLock, InstanceLockError } = await import('../src/whatsapp/instanceLock.js');
const { RecentSentMessageCache, resolveBaileysMessage } = await import('../src/whatsapp/messageStore.js');
const { computeReconnectDelay, whatsappService } = await import('../src/whatsapp/connection.js');

test.after(() => {
  whatsappService.stop();
  try {
    getDatabase().close();
  } catch {}
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});

test('useAtomicMultiFileAuthState grava creds e chaves atomicamente sob concorrência', async () => {
  const authDir = path.join(tempDir, 'auth-atomic-test');
  const { state, saveCreds } = await useAtomicMultiFileAuthState(authDir);

  assert.ok(state.creds.registrationId, 'creds iniciais devem ser geradas');

  // Dispara múltiplas gravações concorrentes no mesmo arquivo
  await Promise.all([
    saveCreds(),
    saveCreds(),
    state.keys.set({
      session: {
        '5511999999999.0': new Uint8Array([1, 2, 3, 4]) as any
      },
      'pre-key': {
        '1': { public: Buffer.from([5, 6]), private: Buffer.from([7, 8]) } as any
      }
    })
  ]);

  const files = fs.readdirSync(authDir);
  assert.ok(files.includes('creds.json'));
  assert.ok(files.includes('session-5511999999999.0.json'));
  assert.ok(files.includes('pre-key-1.json'));
  assert.equal(
    files.some((f) => f.includes('.tmp-')),
    false,
    'Não deve restar arquivo temporário após gravação atômica'
  );

  // Recarrega do disco e verifica integridade + tratamento de arquivo corrompido
  fs.writeFileSync(path.join(authDir, 'session-corrupt.0.json'), '{broken-json', 'utf-8');
  const reloaded = await useAtomicMultiFileAuthState(authDir);
  assert.equal(reloaded.state.creds.registrationId, state.creds.registrationId);

  const loadedKeys = await reloaded.state.keys.get('session', ['5511999999999.0', 'corrupt.0']);
  assert.ok(loadedKeys['5511999999999.0']);
  assert.equal(loadedKeys['corrupt.0'], null);
});

test('acquireInstanceLock impede segunda instância ativa e recupera lock obsoleto', () => {
  const lockDir = path.join(tempDir, 'lock-test');
  const lock1 = acquireInstanceLock(lockDir, { staleMs: 5000, heartbeatMs: 60_000 });
  assert.ok(fs.existsSync(lock1.lockPath));

  // Simula outro processo vivo em outro host/container com heartbeat recente
  const activeOtherPath = path.join(tempDir, 'lock-other-active');
  fs.mkdirSync(activeOtherPath, { recursive: true });
  fs.writeFileSync(
    path.join(activeOtherPath, 'gateway.lock'),
    JSON.stringify({
      pid: 99999,
      hostname: 'other-container-id',
      instanceId: 'other-id',
      startedAt: Date.now(),
      updatedAt: Date.now()
    })
  );
  assert.throws(
    () => acquireInstanceLock(activeOtherPath, { staleMs: 30_000 }),
    InstanceLockError
  );

  // Simula lock obsoleto de processo morto no mesmo host
  const stalePidPath = path.join(tempDir, 'lock-stale-pid');
  fs.mkdirSync(stalePidPath, { recursive: true });
  fs.writeFileSync(
    path.join(stalePidPath, 'gateway.lock'),
    JSON.stringify({
      pid: 999_999,
      hostname: os.hostname(),
      instanceId: 'dead-id',
      startedAt: Date.now() - 60_000,
      updatedAt: Date.now() - 60_000
    })
  );
  const recovered = acquireInstanceLock(stalePidPath);
  assert.ok(fs.existsSync(recovered.lockPath));
  recovered.release();
  assert.equal(fs.existsSync(recovered.lockPath), false);

  lock1.release();
  assert.equal(fs.existsSync(lock1.lockPath), false);
});

test('resolveBaileysMessage recupera mensagens enviadas, recebidas com Buffer e fallback de texto', async () => {
  const chatJid = '5583999112233@s.whatsapp.net';
  upsertContact({ jid: chatJid, name: 'Contato Teste' });

  // 1. Formato de envio do gateway ({ source, key, message })
  insertMessage({
    id: 'out_msg_1',
    chat_jid: chatJid,
    sender_jid: '5583900000000@s.whatsapp.net',
    from_me: 1,
    timestamp: 1700000001,
    message_type: 'text',
    content: 'Olá do gateway',
    raw_json: JSON.stringify({
      source: 'mcp_hermes',
      key: { remoteJid: chatJid, fromMe: true, id: 'out_msg_1' },
      message: { conversation: 'Olá do gateway' }
    })
  });

  const resolvedOut = await resolveBaileysMessage({ remoteJid: chatJid, fromMe: true, id: 'out_msg_1' });
  assert.equal(resolvedOut?.conversation, 'Olá do gateway');

  // 2. Formato de mensagem recebida com Buffer serializado
  insertMessage({
    id: 'in_img_1',
    chat_jid: chatJid,
    sender_jid: chatJid,
    from_me: 0,
    timestamp: 1700000002,
    message_type: 'image',
    content: 'Foto',
    raw_json: JSON.stringify({
      imageMessage: {
        mimetype: 'image/jpeg',
        caption: 'Foto',
        mediaKey: Buffer.from([10, 20, 30, 40])
      }
    })
  });

  const resolvedImg = await resolveBaileysMessage({ remoteJid: chatJid, fromMe: false, id: 'in_img_1' });
  assert.equal(resolvedImg?.imageMessage?.caption, 'Foto');
  assert.ok(resolvedImg?.imageMessage?.mediaKey);
  assert.equal(resolvedImg?.imageMessage?.mediaKey?.length, 4);

  // 3. Fallback quando raw_json está corrompido
  insertMessage({
    id: 'fallback_txt_1',
    chat_jid: chatJid,
    sender_jid: chatJid,
    from_me: 1,
    timestamp: 1700000003,
    message_type: 'text',
    content: 'Texto fallback',
    raw_json: '{corrupt'
  });

  const resolvedFallback = await resolveBaileysMessage({ remoteJid: chatJid, fromMe: true, id: 'fallback_txt_1' });
  assert.equal(resolvedFallback?.conversation, 'Texto fallback');

  // 4. Cache em memória respeita limite e responde imediatamente
  const cache = new RecentSentMessageCache(2);
  cache.set('c1', proto.Message.fromObject({ conversation: 'um' }));
  cache.set('c2', proto.Message.fromObject({ conversation: 'dois' }));
  cache.set('c3', proto.Message.fromObject({ conversation: 'tres' }));
  assert.equal(cache.get('c1'), undefined);
  assert.equal((await resolveBaileysMessage({ id: 'c3' }, cache))?.conversation, 'tres');
});

test('computeReconnectDelay aplica backoff exponencial com teto e jitter', () => {
  assert.equal(computeReconnectDelay(1, { jitterRatio: 0 }), 3000);
  assert.equal(computeReconnectDelay(2, { jitterRatio: 0 }), 6000);
  assert.equal(computeReconnectDelay(3, { jitterRatio: 0 }), 12000);
  assert.equal(computeReconnectDelay(4, { jitterRatio: 0 }), 24000);
  assert.equal(computeReconnectDelay(10, { jitterRatio: 0 }), 120_000);

  // Jitter de ±20% no attempt 1 (base 3000ms): entre 2400ms e 3600ms
  assert.equal(computeReconnectDelay(1, { jitterRatio: 0.2, randomValue: 0 }), 2400);
  assert.equal(computeReconnectDelay(1, { jitterRatio: 0.2, randomValue: 1 }), 3600);
});

test('sendMessage popula cache para retry receipt e persiste proto message no banco', async () => {
  const targetJid = '5583999223344@s.whatsapp.net';
  toggleAllowSendContact(targetJid, true);

  (whatsappService as any).state = { status: 'connected' };
  (whatsappService as any).sock = {
    user: { id: '5583988887777:1@s.whatsapp.net' },
    sendMessage: async (_jid: string, content: any) => ({
      key: { remoteJid: targetJid, fromMe: true, id: 'sent_retry_1' },
      message: { extendedTextMessage: { text: content.text } }
    })
  };

  const res = await whatsappService.sendMessage(targetJid, 'Mensagem com retry habilitado');
  assert.equal(res.messageId, 'sent_retry_1');

  const cachedMsg = await resolveBaileysMessage(
    { remoteJid: targetJid, fromMe: true, id: 'sent_retry_1' },
    (whatsappService as any).recentSentMessages
  );
  assert.equal(cachedMsg?.extendedTextMessage?.text, 'Mensagem com retry habilitado');
});
