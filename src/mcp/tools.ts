import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { listContacts, getContact } from '../db/contacts.js';
import { listChatMessages, listMessages, searchMessages, getMessage } from '../db/messages.js';
import { getAttachment, getAttachmentsByMessageId } from '../db/attachments.js';
import { whatsappService } from '../whatsapp/connection.js';

export function registerMcpTools(server: McpServer): void {
  // Tool 1: list_chats
  server.tool(
    'list_chats',
    'Lista conversas recentes do WhatsApp com identificador (JID), nome, última interação e status de coleta.',
    {
      limit: z.number().optional().default(20).describe('Quantidade máxima de conversas a retornar (padrão: 20)'),
      offset: z.number().optional().default(0).describe('Offset para paginação'),
      search: z.string().optional().describe('Filtro de busca por nome ou número do contato')
    },
    async ({ limit, offset, search }) => {
      const contacts = listContacts(search, limit, offset);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              contacts.map((c) => ({
                jid: c.jid,
                name: c.name || c.notify_name || 'Desconhecido',
                is_group: Boolean(c.is_group),
                is_ignored: Boolean(c.is_ignored),
                unread_count: c.unread_count,
                last_interaction: c.last_message_timestamp
                  ? new Date(c.last_message_timestamp * 1000).toISOString()
                  : null
              })),
              null,
              2
            )
          }
        ]
      };
    }
  );

  // Tool 2: get_chat_history
  server.tool(
    'get_chat_history',
    'Obtém o histórico de mensagens de um contato ou grupo específico, incluindo transcrições de áudio e anexos. Por padrão retorna em ordem decrescente (as mais recentes primeiro).',
    {
      chat_jid: z.string().describe('JID do contato ou grupo (ex: 5511999999999@s.whatsapp.net ou ...@g.us)'),
      limit: z.number().optional().default(50).describe('Quantidade de mensagens a retornar (padrão: 50)'),
      before_timestamp: z.number().optional().describe('Timestamp UNIX final para paginação retrógrada (apenas mensagens anteriores a este timestamp)'),
      since_timestamp: z.number().optional().describe('Timestamp UNIX inicial (apenas mensagens iguais ou posteriores a este timestamp)'),
      order: z.enum(['desc', 'asc']).optional().default('desc').describe('Ordem das mensagens: "desc" (mais recentes primeiro, padrão) ou "asc" (mais antigas primeiro/cronológica)')
    },
    async ({ chat_jid, limit, before_timestamp, since_timestamp, order }) => {
      const messages = listChatMessages(chat_jid, limit, before_timestamp, since_timestamp, order);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              messages.map((m) => ({
                id: m.id,
                sender: m.sender_jid,
                sender_name: m.sender_name || null,
                from_me: Boolean(m.from_me),
                type: m.message_type,
                text: m.content,
                timestamp: new Date(m.timestamp * 1000).toISOString(),
                attachments: m.attachments.map((a) => ({
                  id: a.id,
                  type: a.mimetype,
                  file_name: a.file_name,
                  file_path: a.file_path,
                  transcription: a.transcription_text,
                  transcription_status: a.transcription_status
                }))
              })),
              null,
              2
            )
          }
        ]
      };
    }
  );

  // Tool 3: list_messages
  server.tool(
    'list_messages',
    'Busca e filtra mensagens de WhatsApp em todas as conversas ou em uma conversa específica por data ou intervalo de timestamp, com paginação. Ideal para resumos diários ("todas as mensagens de ontem/hoje"), triagem de mensagens recebidas ou busca temporal. Use limit: 0 para retornar todas as mensagens sem limite de paginação.',
    {
      date: z.string().optional().describe('Data no formato YYYY-MM-DD para buscar todas as mensagens desse dia civil (padrão no fuso America/Recife, ex: "2026-10-19")'),
      timezone: z.string().optional().default('America/Recife').describe('Fuso horário IANA para interpretação do parâmetro date (padrão: "America/Recife")'),
      chat_jid: z.string().optional().describe('JID opcional para filtrar por conversa específica (ex: 5511999999999@s.whatsapp.net ou ...@g.us)'),
      since_timestamp: z.number().optional().describe('Timestamp UNIX inicial (inclusive) para filtrar mensagens a partir deste instante'),
      until_timestamp: z.number().optional().describe('Timestamp UNIX final (inclusive) para filtrar mensagens até este instante'),
      incoming_only: z.boolean().optional().default(false).describe('Se true, retorna apenas mensagens recebidas de outras pessoas (from_me=false)'),
      limit: z.number().min(0).optional().default(50).describe('Quantidade máxima de mensagens a retornar (padrão: 50). Use 0 para retornar TODAS as mensagens sem limite.'),
      offset: z.number().optional().default(0).describe('Offset para paginação (padrão: 0)'),
      order: z.enum(['desc', 'asc']).optional().default('desc').describe('Ordem das mensagens: "desc" (mais recentes primeiro, padrão) ou "asc" (mais antigas primeiro)'),
      include_transcriptions: z.boolean().optional().default(true).describe('Se false, omite o texto completo de transcrições de áudio nos anexos para reduzir tamanho do payload')
    },
    async ({ date, timezone, chat_jid, since_timestamp, until_timestamp, incoming_only, limit, offset, order, include_transcriptions }) => {
      const result = listMessages({
        chatJid: chat_jid,
        date,
        timezone,
        sinceTimestamp: since_timestamp,
        untilTimestamp: until_timestamp,
        incomingOnly: incoming_only,
        limit,
        offset,
        order
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              total: result.total,
              returned: result.returned,
              has_more: result.has_more,
              next_offset: result.next_offset,
              ...(result.info ? { info: result.info } : {}),
              messages: result.messages.map((m) => ({
                id: m.id,
                chat_jid: m.chat_jid,
                chat_name: m.chat_name,
                sender: m.sender_jid,
                sender_name: m.sender_name || null,
                from_me: Boolean(m.from_me),
                type: m.message_type,
                text: m.content,
                timestamp: new Date(m.timestamp * 1000).toISOString(),
                attachments: m.attachments.map((a) => {
                  const att: Record<string, unknown> = {
                    id: a.id,
                    type: a.mimetype,
                    file_name: a.file_name,
                    file_path: a.file_path,
                    transcription_status: a.transcription_status
                  };
                  if (include_transcriptions) {
                    att.transcription = a.transcription_text;
                  }
                  return att;
                })
              }))
            })
          }
        ]
      };
    }
  );

  // Tool 4: search_messages
  server.tool(
    'search_messages',
    'Realiza busca textual rápida (Full-Text Search) por palavras-chave ou termos nas mensagens e transcrições de áudio. Para buscar mensagens por data ou período, utilize a ferramenta list_messages.',
    {
      query: z.string().describe('Termo ou frase a ser pesquisada'),
      chat_jid: z.string().optional().describe('JID opcional para restringir a busca a uma conversa específica'),
      limit: z.number().optional().default(20).describe('Limite máximo de resultados (padrão: 20)')
    },
    async ({ query, chat_jid, limit }) => {
      const results = searchMessages(query, chat_jid, limit);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              results.map((r) => ({
                message_id: r.message_id,
                chat_jid: r.chat_jid,
                sender: r.sender_jid,
                from_me: Boolean(r.from_me),
                type: r.message_type,
                timestamp: new Date(r.timestamp * 1000).toISOString(),
                content: r.content,
                transcription: r.transcription_text
              })),
              null,
              2
            )
          }
        ]
      };
    }
  );

  // Tool 5: get_attachment_info
  server.tool(
    'get_attachment_info',
    'Consulta os detalhes, caminho local em disco e texto transcrito de um anexo específico ou de uma mensagem.',
    {
      attachment_id: z.string().optional().describe('ID do anexo (ex: att_...)'),
      message_id: z.string().optional().describe('ID da mensagem associada')
    },
    async ({ attachment_id, message_id }) => {
      if (attachment_id) {
        const att = getAttachment(attachment_id);
        if (!att) {
          return { content: [{ type: 'text', text: `Anexo ${attachment_id} não encontrado.` }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify(att, null, 2) }] };
      }

      if (message_id) {
        const attachments = getAttachmentsByMessageId(message_id);
        return { content: [{ type: 'text', text: JSON.stringify(attachments, null, 2) }] };
      }

      return {
        content: [{ type: 'text', text: 'Você deve fornecer attachment_id ou message_id.' }]
      };
    }
  );

  // Tool 6: get_contact_info
  server.tool(
    'get_contact_info',
    'Retorna detalhes de cadastro, nome e status de coleta de um contato ou grupo.',
    {
      jid: z.string().describe('JID do contato ou grupo')
    },
    async ({ jid }) => {
      const contact = getContact(jid);
      if (!contact) {
        return { content: [{ type: 'text', text: `Contato com JID ${jid} não encontrado no banco.` }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(contact, null, 2) }] };
    }
  );

  // Tool 7: send_message
  server.tool(
    'send_message',
    'Envia uma mensagem de texto pelo WhatsApp para um contato previamente autorizado pelo usuário no painel.',
    {
      recipient: z
        .string()
        .describe(
          'Número de telefone convencional (ex: "+5583998261570" ou "5583998261570") ou JID do contato ("...@s.whatsapp.net"). Grupos não são permitidos.'
        ),
      message: z
        .string()
        .min(1)
        .describe('Texto da mensagem a ser enviada (suporta quebras de linha e emojis)')
    },
    async ({ recipient, message }) => {
      try {
        const result = await whatsappService.sendMessage(recipient, message, 'mcp_hermes');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  message_id: result.messageId,
                  recipient: result.targetJid,
                  text: message,
                  timestamp: new Date(result.timestamp * 1000).toISOString()
                },
                null,
                2
              )
            }
          ]
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  error: err.message || 'Falha ao enviar mensagem.'
                },
                null,
                2
              )
            }
          ],
          isError: true
        };
      }
    }
  );
}

