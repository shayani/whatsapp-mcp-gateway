import React, { useEffect, useRef } from 'react';
import { Mic, FileText, Image as ImageIcon, Video, Ban, CheckCircle2, File } from 'lucide-react';
import type { Contact, Message } from '../api';

interface MessageViewProps {
  chat: Contact | null;
  messages: Message[];
  isLoading: boolean;
  onToggleIgnore: (jid: string, newIgnoredState: boolean) => void;
}

export const MessageView: React.FC<MessageViewProps> = ({
  chat,
  messages,
  isLoading,
  onToggleIgnore
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
  const displayName = chat.name || chat.notify_name || chat.jid.split('@')[0];

  const formatMessageTime = (ts: number) => {
    return new Date(ts * 1000).toLocaleString([], {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-950">
      {/* Cabeçalho da Conversa */}
      <header className="px-6 py-3.5 border-b border-gray-800 bg-gray-900/60 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-100 flex items-center gap-2">
            {displayName}
            {chat.is_group ? (
              <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-indigo-900/50 text-indigo-300 border border-indigo-700/50">
                Grupo
              </span>
            ) : null}
          </h2>
          <p className="text-xs text-gray-400 font-mono">{chat.jid}</p>
        </div>

        {/* Toggle no topo */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">
            {isIgnored ? (
              <span className="text-rose-400 flex items-center gap-1 font-medium">
                <Ban className="w-4 h-4" /> Mensagens Ignoradas
              </span>
            ) : (
              <span className="text-emerald-400 flex items-center gap-1 font-medium">
                <CheckCircle2 className="w-4 h-4" /> Coleta Ativa
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => onToggleIgnore(chat.jid, !isIgnored)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              isIgnored
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                : 'bg-rose-900/40 hover:bg-rose-900/60 text-rose-300 border border-rose-700/50'
            }`}
          >
            {isIgnored ? 'Reativar Coleta' : 'Ignorar Contato'}
          </button>
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
                  {!isMe && Boolean(chat.is_group) && (
                    <div className="text-xs font-semibold text-emerald-400 mb-1 font-mono">
                      {msg.sender_jid.split('@')[0]}
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
