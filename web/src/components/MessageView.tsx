import React, { useEffect, useRef } from 'react';
import { Mic, FileText, Image as ImageIcon, Video, Ban, CheckCircle2, File } from 'lucide-react';
import type { Contact, Message } from '../api';
import { getContactDisplay } from '../utils/contactUtils';
import type { VariantType } from './PrototypeSwitcher';

interface MessageViewProps {
  chat: Contact | null;
  messages: Message[];
  isLoading: boolean;
  onToggleIgnore: (jid: string, newIgnoredState: boolean) => void;
  variant?: VariantType;
}

export const MessageView: React.FC<MessageViewProps> = ({
  chat,
  messages,
  isLoading,
  onToggleIgnore,
  variant = 'A'
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!chat) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-gray-500 bg-gray-950">
        <div className="w-16 h-16 rounded-full bg-gray-900 flex items-center justify-center mb-4 text-gray-600">
          💬
        </div>
        <h3 className="text-lg font-medium text-gray-300 mb-1">Nenhuma conversa selecionada</h3>
        <p className="text-sm max-w-sm">
          Selecione um contato ou grupo na barra lateral para visualizar as mensagens coletadas e as transcrições de áudio.
        </p>
      </div>
    );
  }

  const isIgnored = Boolean(chat.is_ignored);
  const contactInfo = getContactDisplay(chat);

  const formatMessageTime = (ts: number) => {
    return new Date(ts * 1000).toLocaleString([], {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatSenderName = (senderName?: string | null, senderJid?: string, chatJid?: string): string | null => {
    if (senderName && senderName.trim().length > 0) {
      return senderName;
    }
    if (!senderJid || senderJid === chatJid) {
      return null;
    }
    const raw = senderJid.split('@')[0];
    // Se for formato antigo de criação de grupo (ex: 558396086969-1588007266), não é um remetente válido
    if (raw.includes('-')) {
      return null;
    }
    // Formatação de telefone brasileiro (ex: 558399826157 ou 5583988261570)
    if (/^55\d{10,11}$/.test(raw)) {
      const ddd = raw.substring(2, 4);
      const rest = raw.substring(4);
      if (rest.length === 9) {
        return `+55 (${ddd}) ${rest.substring(0, 5)}-${rest.substring(5)}`;
      }
      return `+55 (${ddd}) ${rest.substring(0, 4)}-${rest.substring(4)}`;
    }
    // Outros telefones puramente numéricos
    if (/^\d{8,15}$/.test(raw)) {
      return `+${raw}`;
    }
    return raw;
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-950">
      {/* Cabeçalho da Conversa */}
      <header className="px-6 py-3.5 border-b border-gray-800 bg-gray-900/60 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-100 flex items-center gap-2">
            {contactInfo.title}
            {chat.is_group ? (
              <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-indigo-900/50 text-indigo-300 border border-indigo-700/50">
                Grupo
              </span>
            ) : null}
          </h2>
          {contactInfo.subtitle ? (
            <p className="text-xs text-gray-400 mt-0.5">{contactInfo.subtitle}</p>
          ) : null}
        </div>

        {/* Botão de Ligar/Desligar Coleta no Topo da Conversa */}
        <div className="flex items-center">
          {variant === 'A' && (
            <button
              type="button"
              onClick={() => onToggleIgnore(chat.jid, !isIgnored)}
              className={`inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full text-xs font-medium border transition shadow-sm ${
                isIgnored
                  ? 'bg-gray-900/90 text-gray-400 border-gray-700/80 hover:border-gray-500'
                  : 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60 hover:bg-emerald-900/60'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${isIgnored ? 'bg-rose-500' : 'bg-emerald-400 animate-pulse'}`} />
              <span>{isIgnored ? 'Coleta Pausada' : 'Coleta Ativa'}</span>
              <span className={`w-7 h-4 flex items-center rounded-full p-0.5 transition ${isIgnored ? 'bg-gray-700 justify-start' : 'bg-emerald-500 justify-end'}`}>
                <span className="w-3 h-3 rounded-full bg-white shadow-sm" />
              </span>
            </button>
          )}

          {variant === 'B' && (
            <button
              type="button"
              onClick={() => onToggleIgnore(chat.jid, !isIgnored)}
              className={`flex items-center gap-2.5 px-3.5 py-1.5 rounded-xl text-xs font-medium border transition shadow-sm ${
                isIgnored
                  ? 'bg-rose-950/40 text-rose-300 border-rose-800/60 hover:bg-rose-900/40'
                  : 'bg-emerald-950/50 text-emerald-300 border-emerald-800/60 hover:bg-emerald-900/50'
              }`}
            >
              {isIgnored ? <Ban className="w-4 h-4 text-rose-400" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
              <div className="text-left">
                <div className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Coleta de Mensagens</div>
                <div className="font-semibold">{isIgnored ? 'Pausada (Clique para Ativar)' : 'Ativa (Clique para Pausar)'}</div>
              </div>
            </button>
          )}

          {variant === 'C' && (
            <div className="flex items-center gap-3 bg-gray-900/70 px-3.5 py-1.5 rounded-xl border border-gray-800">
              <div className="text-right">
                <span className="text-xs font-semibold text-gray-200 block">
                  {isIgnored ? 'Coleta Desativada' : 'Coleta em Tempo Real'}
                </span>
                <span className="text-[10px] text-gray-500 block">
                  {isIgnored ? 'Mensagens não estão sendo salvas' : 'Gravando mensagens e áudios'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onToggleIgnore(chat.jid, !isIgnored)}
                className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  isIgnored ? 'bg-gray-700' : 'bg-emerald-500'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition duration-200 ease-in-out ${
                    isIgnored ? 'translate-x-0' : 'translate-x-5'
                  }`}
                />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Lista de Mensagens */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {isLoading ? (
          <div className="flex justify-center items-center h-32 text-gray-500 text-sm">
            Carregando mensagens...
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-12 text-gray-500 text-sm">
            Nenhuma mensagem registrada para esta conversa.
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = Boolean(msg.from_me);
            const senderDisplay = !isMe && Boolean(chat.is_group)
              ? formatSenderName(msg.sender_name, msg.sender_jid, chat.jid)
              : null;
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-2xl rounded-2xl p-4 shadow-sm ${
                    isMe
                      ? 'bg-emerald-950/60 border border-emerald-800/40 text-emerald-50'
                      : 'bg-gray-900 border border-gray-800 text-gray-100'
                  }`}
                >
                  {/* Remetente em grupos */}
                  {senderDisplay && (
                    <div className="text-xs font-semibold text-emerald-400 mb-1">
                      {senderDisplay}
                    </div>
                  )}

                  {/* Texto principal da mensagem */}
                  {msg.content && (
                    <p className="text-sm leading-relaxed whitespace-pre-wrap select-text mb-2">
                      {msg.content}
                    </p>
                  )}

                  {/* Anexos e Transcrições de Áudio */}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="space-y-2 mt-2 pt-2 border-t border-gray-800/60">
                      {msg.attachments.map((att) => {
                        const isAudio = att.mimetype.startsWith('audio/') || att.mimetype.includes('ogg');
                        const isImage = att.mimetype.startsWith('image/');
                        const isVideo = att.mimetype.startsWith('video/');

                        if (isAudio) {
                          return (
                            <div
                              key={att.id}
                              className="bg-gray-950/80 rounded-xl p-3 border border-indigo-500/30"
                            >
                              <div className="flex items-center gap-2 text-xs font-semibold text-indigo-400 mb-2">
                                <Mic className="w-4 h-4" />
                                Mensagem de Voz / Áudio
                                {att.transcription_status === 'completed' && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-300 font-normal ml-auto">
                                    Transcrição Concluída
                                  </span>
                                )}
                                {att.transcription_status === 'pending' && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-300 font-normal ml-auto animate-pulse">
                                    Transcrevendo...
                                  </span>
                                )}
                                {att.transcription_status === 'failed' && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-900/60 text-rose-300 font-normal ml-auto">
                                    Falha
                                  </span>
                                )}
                              </div>

                              {att.transcription_text ? (
                                <blockquote className="text-sm italic text-gray-200 bg-gray-900/90 p-2.5 rounded-lg border-l-2 border-indigo-500">
                                  "{att.transcription_text}"
                                </blockquote>
                              ) : (
                                <p className="text-xs text-gray-500 italic">
                                  {att.transcription_status === 'pending'
                                    ? 'Aguardando processamento do Whisper...'
                                    : 'Sem transcrição disponível.'}
                                </p>
                              )}
                            </div>
                          );
                        }

                        return (
                          <div
                            key={att.id}
                            className="flex items-center gap-3 bg-gray-950/50 p-2.5 rounded-lg border border-gray-800 text-xs text-gray-300"
                          >
                            {isImage && <ImageIcon className="w-4 h-4 text-sky-400" />}
                            {isVideo && <Video className="w-4 h-4 text-purple-400" />}
                            {!isImage && !isVideo && <FileText className="w-4 h-4 text-amber-400" />}
                            <span className="truncate font-medium">{att.file_name || 'Anexo'}</span>
                            <span className="text-[11px] text-gray-500 ml-auto">
                              {att.file_size ? `${Math.round(att.file_size / 1024)} KB` : ''}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Horário */}
                  <div className="flex justify-end mt-1.5">
                    <span className="text-[10px] text-gray-400 select-none">
                      {formatMessageTime(msg.timestamp)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
