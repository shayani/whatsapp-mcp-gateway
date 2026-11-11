import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from '../src/App';
import { I18nProvider, translate, normalizeLanguage } from '../src/i18n';
import { ptBR } from '../src/translations';
import { SettingsModal } from '../src/components/SettingsModal';
import { StorageModal } from '../src/components/StorageModal';
import { QrModal } from '../src/components/QrModal';
import { MessageView } from '../src/components/MessageView';
import { ChatList } from '../src/components/ChatList';

function render(node: React.ReactNode, saved: string | null = null) {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => saved } });
  return renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>);
}
const noop = () => {};

test('defaults to English and offers exactly two languages', () => {
  const html = render(<App />);
  assert.match(html, /No chat selected/);
  assert.match(html, /value="en"[^>]*selected/);
  assert.equal((html.match(/<option /g) || []).length, 2);
  assert.match(html, /🇺🇸/);
  assert.match(html, /🇧🇷/);
  assert.doesNotMatch(html, />English<\/option>/);
  assert.doesNotMatch(html, />Português \(Brasil\)<\/option>/);
});

test('restores Brazilian Portuguese; unsupported saved values fall back to English', () => {
  assert.match(render(<App />, 'pt-BR'), /Nenhuma conversa selecionada/);
  for (const value of ['fr', 'pt', '', 'en-GB']) {
    assert.equal(normalizeLanguage(value), 'en');
    assert.match(render(<App />, value), /No chat selected/);
  }
});

test('unavailable browser storage does not prevent rendering', () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
  assert.match(renderToStaticMarkup(<I18nProvider><App /></I18nProvider>), /No chat selected/);
});

test('settings, storage, and QR views render in both languages', () => {
  const views = [
    [<SettingsModal isOpen hasGroqKey={false} groqKeyMasked={null} onClose={noop} onSaved={noop} />, 'Save Key', 'Salvar Chave'],
    [<StorageModal isOpen onClose={noop} />, 'Storage Management', 'Gerenciamento de Armazenamento'],
    [<QrModal isOpen onClose={noop} authStatus={{status: 'connecting', qrCodeDataUrl: null, userJid: null, userName: null}} />, 'Generate New QR Code', 'Gerar Novo QR Code'],
  ] as const;
  for (const [view, en, pt] of views) {
    assert.ok(render(view).includes(en));
    assert.ok(render(view, 'pt-BR').includes(pt));
  }
});

test('message content and contact names stay unchanged across languages', () => {
  const chat = { jid: '123@s.whatsapp.net', name: 'Grupo sem nome', notify_name: null, is_group: 0, is_ignored: 0, unread_count: 0, last_message_timestamp: 0 };
  const message = { id: '1', chat_jid: chat.jid, sender_jid: chat.jid, from_me: 0, timestamp: 1700000000, message_type: 'text', content: 'Nenhuma conversa selecionada', attachments: [] };
  for (const language of ['en', 'pt-BR']) {
    const html = render(<MessageView chat={chat} messages={[message]} isLoading={false} onToggleIgnore={noop} onToggleAllowSend={noop} />, language);
    assert.ok(html.includes(chat.name));
    assert.ok(html.includes(message.content));
  }
});

test('group chat renders agent sending toggle in MessageView and lightning icon in ChatList', () => {
  const groupChat = {
    jid: '1203630248234@g.us',
    name: 'Grupo de Testes',
    notify_name: null,
    is_group: 1,
    is_ignored: 0,
    allow_send: 1,
    unread_count: 0,
    last_message_timestamp: 1700000000
  };

  // 1. MessageView exibe botão de envio de agente com tooltip específico de grupo
  const ptView = render(
    <MessageView chat={groupChat} messages={[]} isLoading={false} onToggleIgnore={noop} onToggleAllowSend={noop} />,
    'pt-BR'
  );
  assert.ok(ptView.includes('Envio por agentes liberado para este grupo'));
  assert.ok(ptView.includes('Envio por agentes: Ativo'));

  const enView = render(
    <MessageView chat={groupChat} messages={[]} isLoading={false} onToggleIgnore={noop} onToggleAllowSend={noop} />,
    'en'
  );
  assert.ok(enView.includes('Agent sending enabled for this group'));
  assert.ok(enView.includes('Agent sending: Enabled'));

  // 2. ChatList exibe o ícone de raio (Zap) para o grupo quando allow_send = 1
  const listHtml = render(
    <ChatList chats={[groupChat]} selectedChatJid={null} onSelectChat={noop} onSearchChange={noop} />,
    'pt-BR'
  );
  assert.ok(listHtml.includes('Grupo'), 'Deve conter a badge de Grupo');
  assert.ok(listHtml.includes('Envio por agentes autorizado'), 'Deve conter o tooltip do ícone de raio');
});

test('every translation preserves interpolation variables', () => {
  for (const [key, value] of Object.entries(ptBR)) {
    assert.ok(value.trim());
    assert.deepEqual((key.match(/\{\w+\}/g) || []).sort(), (value.match(/\{\w+\}/g) || []).sort());
  }
  assert.equal(translate('pt-BR', '{count} files saved', {count: 2}), '2 arquivos salvos');
  assert.equal(translate('en', '{count} files saved', {count: 2}), '2 files saved');
});
