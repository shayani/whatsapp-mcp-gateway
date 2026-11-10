import { useI18n } from '../i18n';
import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import {
  Mic,
  FileText,
  Image as ImageIcon,
  Video,
  Maximize2,
  ExternalLink,
  Download,
  X,
  Bot,
  HardDrive,
  ArrowLeft
} from 'lucide-react';
import { getAttachmentUrl, type Contact, type Message } from '../api';
import { getContactDisplay } from '../utils/contactUtils';

interface MessageViewProps {
  chat: Contact | null;
  messages: Message[];
  isLoading: boolean;
  onToggleIgnore: (jid: string, newIgnoredState: boolean) => void;
  onToggleAllowSend: (jid: string, newAllowSendState: boolean) => void;
  onOpenStorage?: (jid: string) => void;
  onBack?: () => void;
}

export const MessageView: React.FC<MessageViewProps> = ({
  chat,
  messages,
  isLoading,
  onToggleIgnore,
  onToggleAllowSend,
  onOpenStorage,
  onBack
}) => {
  const { t, locale } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeChatJidRef = useRef<string | null>(null);
  const isFirstLoadForChatRef = useRef<boolean>(true);

  const [selectedImage, setSelectedImage] = useState<{
    url: string;
    fileName: string;
    fileSize?: number | null;
    caption?: string | null;
  } | null>(null);

  // Quando o contato selecionado mudar, marca para ir direto ao fim instantaneamente
  if (activeChatJidRef.current !== chat?.jid) {
    activeChatJidRef.current = chat?.jid || null;
    isFirstLoadForChatRef.current = true;
  }

  // Rola instantaneamente para as últimas mensagens antes do paint do navegador (sem animação incômoda)
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (isFirstLoadForChatRef.current) {
      container.scrollTop = container.scrollHeight;
      if (messages.length > 0) {
        isFirstLoadForChatRef.current = false;
      }
      return;
    }

    // Se for atualização periódica no mesmo chat, só rola se o usuário já estiver no final
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
    if (isNearBottom) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, chat?.jid]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedImage(null);
      }
    };
    if (selectedImage) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedImage]);

  if (!chat) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-gray-500 bg-gray-950">
        <div className="w-16 h-16 rounded-full bg-gray-900 flex items-center justify-center mb-4 text-gray-600">
          💬
        </div>
        <h3 className="text-lg font-medium text-gray-300 mb-1">{t("No chat selected")}</h3>
        <p className="text-sm max-w-sm">
          {t("Select a contact or group in the sidebar to view collected messages and audio transcriptions.")}
        </p>
      </div>
    );
  }

  const isIgnored = Boolean(chat.is_ignored);
  const contactInfo = getContactDisplay(chat, t);

  const formatMessageTime = (ts: number) => {
    return new Date(ts * 1000).toLocaleString(locale, {
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
    if (!senderJid || senderJid === chatJid || senderJid.endsWith('@lid')) {
      return null;
    }
    const raw = senderJid.split('@')[0];
    if (raw.includes('-')) {
      return null;
    }
    if (/^55\d{10,11}$/.test(raw)) {
      const ddd = raw.substring(2, 4);
      const rest = raw.substring(4);
      if (rest.length === 9) {
        return `+55 (${ddd}) ${rest.substring(0, 5)}-${rest.substring(5)}`;
      }
      return `+55 (${ddd}) ${rest.substring(0, 4)}-${rest.substring(4)}`;
    }
    if (/^\d{8,15}$/.test(raw)) {
      return `+${raw}`;
    }
    return raw;
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-950 relative">
      {/* Cabeçalho da Conversa */}
      <header className="px-3 sm:px-6 py-2.5 sm:py-3.5 border-b border-gray-800 bg-gray-900/60 flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 flex-1">
          {/* Botão Voltar no Mobile */}
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="md:hidden p-1.5 -ml-1 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition flex-shrink-0"
              title={t("Back to chats")}
              aria-label={t("Back to chats")}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}

          <div className="min-w-0 flex-1">
            <h2 className="text-sm sm:text-base font-semibold text-gray-100 flex items-center gap-1.5 sm:gap-2">
              <span className="truncate">{contactInfo.title}</span>
              {contactInfo.isNewsletter ? (
                <span className="text-[10px] sm:text-[11px] font-normal px-1.5 sm:px-2 py-0.5 rounded-full bg-amber-900/50 text-amber-300 border border-amber-700/50 flex-shrink-0">
                  {t("Channel")}
                </span>
              ) : chat.is_group ? (
                <span className="text-[10px] sm:text-[11px] font-normal px-1.5 sm:px-2 py-0.5 rounded-full bg-indigo-900/50 text-indigo-300 border border-indigo-700/50 flex-shrink-0">
                  {t("Group")}
                </span>
              ) : null}
            </h2>
            {contactInfo.subtitle ? (
              <p className="text-xs text-gray-400 mt-0.5 truncate">{contactInfo.subtitle}</p>
            ) : null}
          </div>
        </div>

        {/* Botões de Ação no Topo da Conversa: Armazenamento, Envio pelo Agente e Coleta */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 flex-shrink-0">
          {/* Botão de Armazenamento da Conversa */}
          {onOpenStorage && (
            <button
              type="button"
              onClick={() => onOpenStorage(chat.jid)}
              className="inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-medium border border-gray-700/80 bg-gray-900/90 text-gray-300 hover:text-white hover:border-gray-500 transition shadow-sm"
              title={t("Manage and clean up storage for this chat")}
            >
              <HardDrive className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
              <span className="hidden sm:inline">{t("Storage")}</span>
            </button>
          )}

          {/* Botão de Ligar/Desligar Envio pelo Agente Hermes (apenas conversas privadas e não canais) */}
          {!chat.is_group && !contactInfo.isNewsletter && (
            <button
              type="button"
              onClick={() => onToggleAllowSend(chat.jid, !Boolean(chat.allow_send))}
              className={`inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-medium border transition shadow-sm ${
                chat.allow_send
                  ? 'bg-amber-950/80 text-amber-300 border-amber-700/60 hover:bg-amber-900/60'
                  : 'bg-gray-900/90 text-gray-400 border-gray-700/80 hover:border-gray-500'
              }`}
              title={chat.allow_send ? t("Agent sending enabled for this contact") : t("Agent sending blocked for this contact")}
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${chat.allow_send ? 'bg-amber-400 animate-pulse' : 'bg-gray-600'}`} />
              <span className="hidden sm:inline">
                {chat.allow_send ? t("Agent sending: Enabled") : t("Agent sending: Blocked")}
              </span>
              <span className={`w-6 sm:w-7 h-3.5 sm:h-4 flex items-center rounded-full p-0.5 transition ${chat.allow_send ? 'bg-amber-500 justify-end' : 'bg-gray-700 justify-start'}`}>
                <span className="w-2.5 sm:w-3 h-2.5 sm:h-3 rounded-full bg-white shadow-sm" />
              </span>
            </button>
          )}

          {/* Botão de Ligar/Desligar Coleta */}
          <button
            type="button"
            onClick={() => onToggleIgnore(chat.jid, !isIgnored)}
            className={`inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 rounded-full text-xs font-medium border transition shadow-sm ${
              isIgnored
                ? 'bg-gray-900/90 text-gray-400 border-gray-700/80 hover:border-gray-500'
                : 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60 hover:bg-emerald-900/60'
            }`}
            title={isIgnored ? t("Collection paused") : t("Collection active")}
          >
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isIgnored ? 'bg-rose-500' : 'bg-emerald-400 animate-pulse'}`} />
            <span className="hidden sm:inline">
              {isIgnored ? t("Collection Paused") : t("Collection Active")}
            </span>
            <span className={`w-6 sm:w-7 h-3.5 sm:h-4 flex items-center rounded-full p-0.5 transition ${isIgnored ? 'bg-gray-700 justify-start' : 'bg-emerald-500 justify-end'}`}>
              <span className="w-2.5 sm:w-3 h-2.5 sm:h-3 rounded-full bg-white shadow-sm" />
            </span>
          </button>
        </div>
      </header>

      {/* Lista de Mensagens */}
      <div ref={containerRef} className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-3 sm:space-y-4">
        {isLoading ? (
          <div className="flex justify-center items-center h-32 text-gray-500 text-sm">
            {t("Loading messages...")}
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-12 text-gray-500 text-sm">
            {t("No messages recorded for this chat.")}
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = Boolean(msg.from_me);
            const isSentByHermes = Boolean(
              isMe && (
                (msg as any).source === 'mcp_hermes' ||
                (msg.raw_json && msg.raw_json.includes('"source":"mcp_hermes"'))
              )
            );
            const senderDisplay = !isMe && Boolean(chat.is_group)
              ? formatSenderName(msg.sender_name, msg.sender_jid, chat.jid)
              : null;

            const imageAttachments = msg.attachments?.filter((att) => att.mimetype.startsWith('image/')) || [];
            const nonImageAttachments = msg.attachments?.filter((att) => !att.mimetype.startsWith('image/')) || [];
            const hasImages = imageAttachments.length > 0;
            const isImageMsgWithoutAtt = msg.message_type === 'image' && !hasImages;

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[88%] sm:max-w-xl md:max-w-2xl rounded-2xl p-3 sm:p-4 shadow-sm ${
                    isMe
                      ? 'bg-emerald-950/60 border border-emerald-800/40 text-emerald-50'
                      : 'bg-gray-900 border border-gray-800 text-gray-100'
                  }`}
                >
                  {/* Selo de envio por agentes */}
                  {isSentByHermes && (
                    <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-950/80 text-amber-300 border border-amber-800/60 mb-1.5">
                      <Bot className="w-3 h-3 text-amber-400" />
                      <span>{t("Sent by agents")}</span>
                    </div>
                  )}

                  {/* Remetente em grupos */}
                  {senderDisplay && (
                    <div className="text-xs font-semibold text-emerald-400 mb-1.5">
                      {senderDisplay}
                    </div>
                  )}

                  {/* Anexos de Imagens / Thumbnails */}
                  {hasImages && (
                    <div className="space-y-2 mb-2">
                      {imageAttachments.map((att) => {
                        const isCleaned = !att.file_path || att.file_path.trim().length === 0;
                        if (isCleaned) {
                          return (
                            <div key={att.id} className="flex items-center gap-2 text-xs text-gray-400 bg-gray-950/70 p-2.5 rounded-xl border border-gray-800/80 mb-2">
                              <ImageIcon className="w-4 h-4 text-gray-500" />
                              <span className="italic">{t("Image removed to save space")}</span>
                            </div>
                          );
                        }

                        const isSticker = msg.message_type === 'sticker' || (att.mimetype === 'image/webp' && msg.message_type === 'sticker');

                        if (isSticker) {
                          return (
                            <div key={att.id} className="py-1">
                              <img
                                src={getAttachmentUrl(att.id)}
                                alt={att.file_name || t("Sticker")}
                                loading="lazy"
                                className="w-28 h-28 object-contain cursor-pointer hover:scale-105 transition-transform drop-shadow"
                                onClick={() => setSelectedImage({
                                  url: getAttachmentUrl(att.id),
                                  fileName: att.file_name || t("Sticker"),
                                  fileSize: att.file_size,
                                  caption: null
                                })}
                              />
                            </div>
                          );
                        }

                        return (
                          <div
                            key={att.id}
                            className="relative group overflow-hidden rounded-xl border border-gray-800/80 bg-black/40 max-w-full sm:max-w-sm cursor-pointer shadow-sm"
                            onClick={() => setSelectedImage({
                              url: getAttachmentUrl(att.id),
                              fileName: att.file_name || t("Image"),
                              fileSize: att.file_size,
                              caption: msg.content
                            })}
                          >
                            <img
                              src={getAttachmentUrl(att.id)}
                              alt={att.file_name || t("Image")}
                              loading="lazy"
                              className="max-h-72 w-full object-contain rounded-xl transition duration-200 group-hover:brightness-105"
                            />
                            <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-end p-2 pointer-events-none">
                              <span className="flex items-center gap-1.5 text-[11px] font-medium bg-gray-900/85 text-gray-200 px-2 py-1 rounded-md backdrop-blur-sm border border-gray-700/50 shadow">
                                <Maximize2 className="w-3 h-3 text-emerald-400" />
                                {t("Enlarge")}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Fallback se a imagem ainda estiver sendo baixada */}
                  {isImageMsgWithoutAtt && (
                    <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-950/60 p-2.5 rounded-xl border border-gray-800/80 mb-2">
                      <ImageIcon className="w-4 h-4 text-gray-500 animate-pulse" />
                      <span>{t("Loading image...")}</span>
                    </div>
                  )}

                  {/* Texto principal da mensagem / Legenda */}
                  {msg.content && (
                    <p className="text-sm leading-relaxed whitespace-pre-wrap select-text mb-2">
                      {msg.content}
                    </p>
                  )}

                  {/* Outros Anexos (Áudio, Vídeo, Documentos) */}
                  {nonImageAttachments.length > 0 && (
                    <div className="space-y-2 mt-2 pt-2 border-t border-gray-800/60">
                      {nonImageAttachments.map((att) => {
                        const isAudio = att.mimetype.startsWith('audio/') || att.mimetype.includes('ogg');
                        const isVideo = att.mimetype.startsWith('video/');
                        const isCleaned = !att.file_path || att.file_path.trim().length === 0;

                        if (isAudio) {
                          return (
                            <div
                              key={att.id}
                              className="bg-gray-950/80 rounded-xl p-3 border border-indigo-500/30 space-y-2"
                            >
                              <div className="flex items-center gap-2 text-xs font-semibold text-indigo-400">
                                <Mic className="w-4 h-4" />
                                {t("Voice Message / Audio")}
                                {att.transcription_status === 'completed' && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-300 font-normal ml-auto">
                                    {t("Transcription Complete")}
                                  </span>
                                )}
                                {att.transcription_status === 'pending' && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-300 font-normal ml-auto animate-pulse">
                                    {t("Transcribing...")}
                                  </span>
                                )}
                                {att.transcription_status === 'failed' && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-900/60 text-rose-300 font-normal ml-auto">
                                    {t("Failed")}
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
                                    ? t("Waiting for Whisper processing...")
                                    : t("No transcription available.")}
                                </p>
                              )}

                              {isCleaned ? (
                                <div className="flex items-center gap-1.5 text-[11px] text-gray-500 italic pt-1">
                                  <FileText className="w-3.5 h-3.5 text-gray-600" />
                                  <span>{t("Original audio removed to save space")}</span>
                                </div>
                              ) : (
                                <audio
                                  controls
                                  preload="none"
                                  src={getAttachmentUrl(att.id)}
                                  className="w-full h-8 mt-1 rounded opacity-90 hover:opacity-100"
                                />
                              )}
                            </div>
                          );
                        }

                        if (isVideo) {
                          if (isCleaned) {
                            return (
                              <div key={att.id} className="flex items-center gap-2 bg-gray-950/60 p-2.5 rounded-xl border border-gray-800 text-xs text-gray-400 my-1.5">
                                <Video className="w-4 h-4 text-gray-500" />
                                <span className="truncate">{att.file_name || t("Video")}</span>
                                <span className="text-[11px] text-gray-500 ml-auto italic">{t("Video removed")}</span>
                              </div>
                            );
                          }

                          return (
                            <div key={att.id} className="overflow-hidden rounded-xl border border-gray-800 bg-black/60 max-w-full sm:max-w-sm my-1.5">
                              <video
                                controls
                                preload="metadata"
                                src={getAttachmentUrl(att.id)}
                                className="max-h-72 w-full rounded-xl"
                              />
                              {att.file_name && (
                                <div className="p-2 text-[11px] text-gray-400 truncate">
                                  {att.file_name}
                                </div>
                              )}
                            </div>
                          );
                        }

                        if (isCleaned) {
                          return (
                            <div key={att.id} className="flex items-center gap-2 bg-gray-950/60 p-2.5 rounded-xl border border-gray-800 text-xs text-gray-400 my-1.5">
                              <FileText className="w-4 h-4 text-gray-500" />
                              <span className="truncate font-medium">{att.file_name || t("Document")}</span>
                              <span className="text-[11px] text-gray-500 ml-auto italic">{t("File removed")}</span>
                            </div>
                          );
                        }

                        return (
                          <a
                            key={att.id}
                            href={getAttachmentUrl(att.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 bg-gray-950/50 hover:bg-gray-800/60 p-2.5 rounded-lg border border-gray-800 text-xs text-gray-300 transition group"
                          >
                            <FileText className="w-4 h-4 text-amber-400 group-hover:text-amber-300" />
                            <span className="truncate font-medium">{att.file_name || t("Attachment")}</span>
                            <span className="text-[11px] text-gray-500 ml-auto group-hover:text-gray-300 flex items-center gap-1">
                              {att.file_size ? `${Math.round(att.file_size / 1024)} KB` : ''}
                              <Download className="w-3 h-3 ml-1 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </span>
                          </a>
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

      {/* Modal / Lightbox de Imagem */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col justify-between p-2 sm:p-4"
          onClick={() => setSelectedImage(null)}
        >
          {/* Barra Superior */}
          <div
            className="flex items-center justify-between px-3 sm:px-4 py-2 bg-gray-900/80 rounded-xl border border-gray-800 backdrop-blur-sm text-gray-200 shadow-lg gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
              <ImageIcon className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <div className="truncate">
                <p className="text-xs font-semibold text-gray-100 truncate">
                  {selectedImage.fileName}
                </p>
                {selectedImage.fileSize ? (
                  <p className="text-[10px] text-gray-400">
                    {Math.round(selectedImage.fileSize / 1024)} KB
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
              <a
                href={selectedImage.url}
                target="_blank"
                rel="noopener noreferrer"
                title={t("Open original image in a new tab")}
                className="p-1.5 sm:p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
              <a
                href={selectedImage.url}
                download={selectedImage.fileName}
                title={t("Download image")}
                className="p-1.5 sm:p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition"
              >
                <Download className="w-4 h-4" />
              </a>
              <button
                onClick={() => setSelectedImage(null)}
                title={t("Close (Esc)")}
                className="p-1.5 sm:p-2 rounded-lg bg-gray-800 hover:bg-rose-900/60 text-gray-300 hover:text-rose-200 transition ml-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Imagem Central */}
          <div className="flex-1 flex items-center justify-center p-2 min-h-0 overflow-hidden">
            <img
              src={selectedImage.url}
              alt={selectedImage.fileName}
              className="max-h-[82vh] max-w-[95vw] sm:max-w-[92vw] object-contain rounded-lg shadow-2xl select-none"
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          {/* Legenda inferior se houver */}
          {selectedImage.caption ? (
            <div
              className="mx-auto max-w-xl text-center px-3 py-1.5 sm:px-4 sm:py-2 bg-gray-900/90 rounded-xl border border-gray-800 text-xs text-gray-200 backdrop-blur-sm shadow truncate"
              onClick={(e) => e.stopPropagation()}
            >
              {selectedImage.caption}
            </div>
          ) : (
            <div />
          )}
        </div>
      )}
    </div>
  );
};

