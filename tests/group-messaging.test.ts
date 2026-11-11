import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-gateway-group-test-'));
process.env.DATA_DIR = tempDir;

const { getDatabase } = await import('../src/db/index.js');
const {
  upsertContact,
  getContact,
  toggleAllowSendContact,
  isSendAllowedForContact
} = await import('../src/db/contacts.js');
const { whatsappService } = await import('../src/whatsapp/connection.js');
const { getMessage } = await import('../src/db/messages.js');

test.after(() => {
  try {
    const db = getDatabase();
    db.close();
  } catch {}
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});

test('Toggle allow_send para grupos no SQLite', () => {
  const groupJid = '1203630248234@g.us';

  // Inicialmente o grupo não está cadastrado
  assert.equal(isSendAllowedForContact(groupJid), false);

  // Ativa envio para o grupo
  toggleAllowSendContact(groupJid, true);
  const contact = getContact(groupJid);
  assert.ok(contact, 'O grupo deve ser inserido em contacts');
  assert.equal(contact?.is_group, 1, 'is_group deve ser 1');
  assert.equal(contact?.allow_send, 1, 'allow_send deve ser 1');
  assert.equal(isSendAllowedForContact(groupJid), true);

  // Desativa envio para o grupo
  toggleAllowSendContact(groupJid, false);
  const updatedContact = getContact(groupJid);
  assert.equal(updatedContact?.allow_send, 0);
  assert.equal(isSendAllowedForContact(groupJid), false);
});

test('Validações de envio para canais (@newsletter) e grupos (@g.us)', async () => {
  const groupJid = '1203630449999@g.us';
  const newsletterJid = '1203631987654@newsletter';
  const contactJid = '5583999991234@s.whatsapp.net';

  // Mock sock conectado
  let lastSentMessage: { jid: string; content: any } | null = null;
  (whatsappService as any).state = { status: 'connected' };
  (whatsappService as any).sock = {
    user: { id: '5583988887777:1@s.whatsapp.net' },
    sendMessage: async (jid: string, content: any) => {
      lastSentMessage = { jid, content };
      return { key: { id: `test_msg_${Date.now()}` } };
    }
  };

  // 1. Newsletter deve ser rejeitada sumariamente
  await assert.rejects(
    () => whatsappService.sendMessage(newsletterJid, 'Teste em canal'),
    /Envio para canais ou transmissões não é permitido/
  );

  // 2. Grupo não autorizado deve falhar com mensagem explícita
  await assert.rejects(
    () => whatsappService.sendMessage(groupJid, 'Teste em grupo bloqueado'),
    /Envio bloqueado: O grupo 1203630449999@g.us não possui autorização/
  );

  // 3. Contato não autorizado deve falhar com mensagem explícita de contato
  await assert.rejects(
    () => whatsappService.sendMessage(contactJid, 'Teste contato bloqueado'),
    /Envio bloqueado: O contato 5583999991234@s.whatsapp.net não possui autorização/
  );

  // 4. Grupo autorizado deve enviar com sucesso
  toggleAllowSendContact(groupJid, true);
  const result = await whatsappService.sendMessage(groupJid, 'Olá grupo autorizado!');
  assert.equal(result.success, true);
  assert.equal(result.targetJid, groupJid);
  assert.equal(lastSentMessage?.jid, groupJid);
  assert.equal(lastSentMessage?.content.text, 'Olá grupo autorizado!');

  // Mensagem deve ser persistida no banco local com chat_jid do grupo e from_me = 1
  const saved = getMessage(result.messageId);
  assert.ok(saved, 'Mensagem deve estar salva no banco');
  assert.equal(saved?.chat_jid, groupJid);
  assert.equal(saved?.from_me, 1);
  assert.equal(saved?.content, 'Olá grupo autorizado!');

  // 5. Cooldown de 3 segundos deve disparar se tentar enviar imediatamente para o mesmo grupo
  await assert.rejects(
    () => whatsappService.sendMessage(groupJid, 'Mensagem rápida sem cooldown'),
    /Cooldown ativo: Aguarde pelo menos 3 segundos/
  );
});
