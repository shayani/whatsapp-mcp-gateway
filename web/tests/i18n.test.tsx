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

test('image transcription renders in MessageView (completed, cleaned, and sticker excluded) and toggle in SettingsModal', () => {
  const chat = {
    jid: '5583999991111@s.whatsapp.net',
    name: 'Contato Imagem',
    notify_name: null,
    is_group: 0,
    is_ignored: 0,
    unread_count: 0,
    last_message_timestamp: 1700000000
  };
  const messages = [
    {
      id: 'm_img_done',
      chat_jid: chat.jid,
      sender_jid: chat.jid,
      from_me: 0,
      timestamp: 1700000001,
      message_type: 'image',
      content: null,
      attachments: [
        {
          id: 'att_done',
          message_id: 'm_img_done',
          file_path: '/tmp/foto.jpg',
          file_name: 'foto.jpg',
          mimetype: 'image/jpeg',
          file_size: 1024,
          transcription_text: 'Nota fiscal de supermercado no valor de R$ 85,00.',
          transcription_status: 'completed' as const
        }
      ]
    },
    {
      id: 'm_img_cleaned',
      chat_jid: chat.jid,
      sender_jid: chat.jid,
      from_me: 0,
      timestamp: 1700000002,
      message_type: 'image',
      content: null,
      attachments: [
        {
          id: 'att_cleaned',
          message_id: 'm_img_cleaned',
          file_path: '',
          file_name: 'antiga.jpg',
          mimetype: 'image/jpeg',
          file_size: 1024,
          transcription_text: 'Descrição preservada após limpeza.',
          transcription_status: 'completed' as const
        }
      ]
    },
    {
      id: 'm_img_none',
      chat_jid: chat.jid,
      sender_jid: chat.jid,
      from_me: 0,
      timestamp: 1700000003,
      message_type: 'image',
      content: null,
      attachments: [
        {
          id: 'att_none',
          message_id: 'm_img_none',
          file_path: '/tmp/pendente.jpg',
          file_name: 'pendente.jpg',
          mimetype: 'image/jpeg',
          file_size: 1024,
          transcription_text: null,
          transcription_status: 'none' as const
        }
      ]
    },
    {
      id: 'm_sticker',
      chat_jid: chat.jid,
      sender_jid: chat.jid,
      from_me: 0,
      timestamp: 1700000004,
      message_type: 'sticker',
      content: null,
      attachments: [
        {
          id: 'att_sticker',
          message_id: 'm_sticker',
          file_path: '/tmp/fig.webp',
          file_name: 'fig.webp',
          mimetype: 'image/webp',
          file_size: 512,
          transcription_text: null,
          transcription_status: 'none' as const
        }
      ]
    }
  ];

  const ptHtml = render(
    <MessageView chat={chat} messages={messages} isLoading={false} onToggleIgnore={noop} onToggleAllowSend={noop} />,
    'pt-BR'
  );
  assert.ok(ptHtml.includes('Descrição da imagem'));
  assert.ok(ptHtml.includes('Nota fiscal de supermercado no valor de R$ 85,00.'));
  assert.ok(ptHtml.includes('Descrição preservada após limpeza.'));
  assert.ok(ptHtml.includes('Transcrever imagem'));
  // Apenas 1 botão "Transcrever imagem" (m_img_none); figurinha (m_sticker) não exibe botão
  assert.equal((ptHtml.match(/Transcrever imagem/g) || []).length, 1);

  const enSettings = render(
    <SettingsModal isOpen hasGroqKey={false} groqKeyMasked={null} imageTranscriptionEnabled={true} onClose={noop} onSaved={noop} />,
    'en'
  );
  assert.ok(enSettings.includes('Automatic image transcription'));
  const ptSettings = render(
    <SettingsModal isOpen hasGroqKey={false} groqKeyMasked={null} imageTranscriptionEnabled={false} pdfTranscriptionEnabled={false} onClose={noop} onSaved={noop} />,
    'pt-BR'
  );
  assert.ok(ptSettings.includes('Transcrição automática de imagens'));
  assert.ok(ptSettings.includes('Resumo automático de PDFs'));
});

test('PDF summary renders in MessageView (completed, cleaned, and on-demand button)', () => {
  const chat = {
    jid: '49241816850664@lid',
    name: 'Iara Machado',
    notify_name: null,
    is_group: 0,
    is_ignored: 0,
    unread_count: 0,
    last_message_timestamp: 1700000000
  };
  const messages = [
    {
      id: 'm_pdf_done',
      chat_jid: chat.jid,
      sender_jid: chat.jid,
      from_me: 0,
      timestamp: 1700000001,
      message_type: 'document',
      content: null,
      attachments: [
        {
          id: 'att_pdf_done',
          message_id: 'm_pdf_done',
          file_path: '/tmp/fatura.pdf',
          file_name: 'fatura_11_2026.pdf',
          mimetype: 'application/pdf',
          file_size: 2022084,
          transcription_text: 'Nota fiscal de energia elétrica da Energisa no valor de R$ 193,47.',
          transcription_status: 'completed' as const
        }
      ]
    },
    {
      id: 'm_pdf_cleaned',
      chat_jid: chat.jid,
      sender_jid: chat.jid,
      from_me: 0,
      timestamp: 1700000002,
      message_type: 'document',
      content: null,
      attachments: [
        {
          id: 'att_pdf_cleaned',
          message_id: 'm_pdf_cleaned',
          file_path: '',
          file_name: 'antigo.pdf',
          mimetype: 'application/pdf',
          file_size: 50000,
          transcription_text: 'Resumo preservado do PDF removido.',
          transcription_status: 'completed' as const
        }
      ]
    },
    {
      id: 'm_pdf_none',
      chat_jid: chat.jid,
      sender_jid: chat.jid,
      from_me: 0,
      timestamp: 1700000003,
      message_type: 'document',
      content: null,
      attachments: [
        {
          id: 'att_pdf_none',
          message_id: 'm_pdf_none',
          file_path: '/tmp/comprovante.pdf',
          file_name: 'comprovante.pdf',
          mimetype: 'application/pdf',
          file_size: 89148,
          transcription_text: null,
          transcription_status: 'none' as const
        }
      ]
    }
  ];

  const ptHtml = render(
    <MessageView chat={chat} messages={messages} isLoading={false} onToggleIgnore={noop} onToggleAllowSend={noop} />,
    'pt-BR'
  );
  assert.ok(ptHtml.includes('Resumo do PDF'));
  assert.ok(ptHtml.includes('Nota fiscal de energia elétrica da Energisa no valor de R$ 193,47.'));
  assert.ok(ptHtml.includes('Resumo preservado do PDF removido.'));
  assert.ok(ptHtml.includes('Resumir PDF'));
});
