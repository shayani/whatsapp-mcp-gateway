import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-gateway-linked-test-'));
process.env.DATA_DIR = tempDir;

const { getDatabase } = await import('../src/db/index.js');
const {
  upsertContact,
  getContact,
  linkJids,
  listContacts,
  toggleIgnoreContact,
  toggleAllowSendContact
} = await import('../src/db/contacts.js');
const { insertMessage, listChatMessages } = await import('../src/db/messages.js');

test.after(() => {
  try {
    const db = getDatabase();
    db.close();
  } catch {}
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});

test('Sincronização de timestamp e preferência de JID telefônico sobre LID', () => {
  const phoneJid = '5521983361111@s.whatsapp.net';
  const lidJid = '52355785568286@lid';

  upsertContact({
    jid: phoneJid,
    name: 'Fernando Maia',
    last_message_timestamp: 1000
  });

  upsertContact({
    jid: lidJid,
    name: 'Fernando Maia Jr.',
    notify_name: 'Fernando Maia Jr.',
    last_message_timestamp: 1000
  });

  linkJids(phoneJid, lidJid);

  // Inserir mensagem recebida no LID
  insertMessage({
    id: 'msg_test_lid_1',
    chat_jid: lidJid,
    sender_jid: lidJid,
    from_me: 0,
    timestamp: 2500,
    message_type: 'text',
    content: 'Kara, saluton! Ĉu vi havas novaĵojn pri la kurso KaPe?'
  });

  // Ambos os contatos devem ter o timestamp sincronizado
  const updatedLid = getContact(lidJid);
  const updatedPhone = getContact(phoneJid);

  assert.equal(updatedLid?.last_message_timestamp, 2500, 'LID deve ter timestamp atualizado para 2500');
  assert.equal(updatedPhone?.last_message_timestamp, 2500, 'Telefone vinculado deve ter timestamp atualizado para 2500');

  // listContacts deve desduplicar e exibir o telefone (não o LID)
  const contacts = listContacts();
  const phoneEntry = contacts.find((c) => c.jid === phoneJid);
  const lidEntry = contacts.find((c) => c.jid === lidJid);

  assert.ok(phoneEntry, 'O contato telefônico deve aparecer na lista de chats');
  assert.equal(lidEntry, undefined, 'O LID deve ser ocultado na desduplicação quando timestamps são iguais');

  // listChatMessages para o telefone deve retornar a mensagem enviada no LID
  const msgs = listChatMessages(phoneJid);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].content, 'Kara, saluton! Ĉu vi havas novaĵojn pri la kurso KaPe?');
});

test('Busca flexível: sinônimos Júnior/Jr. e busca multicampos/multitermos', () => {
  const phoneJid = '5521983361111@s.whatsapp.net';

  // Busca por "Fernando Maia Júnior" (com Júnior por extenso)
  const res1 = listContacts('Fernando Maia Júnior');
  assert.equal(res1.length, 1, 'Deve encontrar contato buscando por Júnior por extenso');
  assert.equal(res1[0].jid, phoneJid);

  // Busca por "Fernando Maia Jr."
  const res2 = listContacts('Fernando Maia Jr.');
  assert.equal(res2.length, 1, 'Deve encontrar contato buscando por Jr.');
  assert.equal(res2[0].jid, phoneJid);

  // Busca por "Fernando Júnior"
  const res3 = listContacts('Fernando Júnior');
  assert.equal(res3.length, 1, 'Deve encontrar contato buscando por Fernando Júnior');
  assert.equal(res3[0].jid, phoneJid);

  // Busca por ordem inversa "Maia Fernando"
  const res4 = listContacts('Maia Fernando');
  assert.equal(res4.length, 1, 'Deve encontrar contato buscando com termos em ordem inversa');
  assert.equal(res4[0].jid, phoneJid);

  // Busca por partes do número de telefone
  const res5 = listContacts('983361111');
  assert.equal(res5.length, 1, 'Deve encontrar contato buscando pelo número de telefone');
  assert.equal(res5[0].jid, phoneJid);
});

test('Sincronização de toggles (is_ignored e allow_send) entre JIDs vinculados', () => {
  const phoneJid = '5521983361111@s.whatsapp.net';
  const lidJid = '52355785568286@lid';

  // Toggle ignore no telefone
  toggleIgnoreContact(phoneJid, true);
  assert.equal(getContact(phoneJid)?.is_ignored, 1);
  assert.equal(getContact(lidJid)?.is_ignored, 1, 'LID vinculado também deve ser marcado como ignorado');

  toggleIgnoreContact(phoneJid, false);
  assert.equal(getContact(phoneJid)?.is_ignored, 0);
  assert.equal(getContact(lidJid)?.is_ignored, 0);

  // Toggle allow send no telefone
  toggleAllowSendContact(phoneJid, true);
  assert.equal(getContact(phoneJid)?.allow_send, 1);
  assert.equal(getContact(lidJid)?.allow_send, 1, 'LID vinculado também deve ter allow_send ativado');
});

test('linkJids insere automaticamente o JID faltante na tabela contacts e listContacts retorna linked_phone', () => {
  const onlyLidJid = '99999888887777@lid';
  const newPhoneJid = '5583999990000@s.whatsapp.net';

  // Cadastra apenas o LID com mensagem recente
  upsertContact({
    jid: onlyLidJid,
    last_message_timestamp: 5000,
    is_ignored: 1,
    allow_send: 1
  });

  assert.equal(getContact(newPhoneJid), undefined, 'O telefone ainda não existe em contacts');

  // Vincula o LID ao telefone que ainda não estava cadastrado
  linkJids(onlyLidJid, newPhoneJid);

  // O telefone deve ter sido criado herdando os atributos do LID vinculado
  const createdPhone = getContact(newPhoneJid);
  assert.ok(createdPhone, 'O telefone deve ter sido inserido em contacts');
  assert.equal(createdPhone?.last_message_timestamp, 5000);
  assert.equal(createdPhone?.is_ignored, 1);
  assert.equal(createdPhone?.allow_send, 1);

  // listContacts deve desduplicar retornando o telefone com linked_phone ou ele próprio
  const contacts = listContacts();
  const phoneEntry = contacts.find((c) => c.jid === newPhoneJid);
  const lidEntry = contacts.find((c) => c.jid === onlyLidJid);

  assert.ok(phoneEntry, 'O telefone deve ser retornado por listContacts');
  assert.equal(lidEntry, undefined, 'O LID deve ser ocultado em favor do telefone');
});

