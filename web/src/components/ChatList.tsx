import React, { useState } from 'react';
import { Users, User, Search, Pause, Zap } from 'lucide-react';
import type { Contact } from '../api';
import { getContactDisplay } from '../utils/contactUtils';

interface ChatListProps {
  chats: Contact[];
  selectedChatJid: string | null;
  onSelectChat: (chat: Contact) => void;
  onSearchChange: (search: string) => void;
}

export const ChatList: React.FC<ChatListProps> = ({
  chats,
  selectedChatJid,
  onSelectChat,
  onSearchChange
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchTerm(val);
    onSearchChange(val);
  };

  const formatTimestamp = (ts: number) => {
    if (!ts) return '';
    const date = new Date(ts * 1000);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
  };

  return (
    <aside className="w-72 flex-shrink-0 border-r border-gray-800 bg-gray-900/40 flex flex-col h-full">
      {/* Busca compacta */}
      <div className="p-2.5 border-b border-gray-800/80 bg-gray-900/60">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Filtrar conversas..."
            value={searchTerm}
            onChange={handleSearch}
            className="w-full bg-gray-800/90 text-xs rounded-lg pl-8 pr-3 py-1.5 text-gray-200 placeholder-gray-500 border border-gray-700/50 focus:outline-none focus:border-emerald-500 transition"
          />
        </div>
      </div>

      {/* Lista de Contatos Compacta */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-800/40">
        {chats.length === 0 ? (
          <div className="p-6 text-center text-gray-500 text-xs">
            Nenhuma conversa encontrada.
          </div>
        ) : (
          chats.map((chat) => {
            const isSelected = selectedChatJid === chat.jid;
            const isIgnored = Boolean(chat.is_ignored);
            const { title } = getContactDisplay(chat);

            return (
              <div
                key={chat.jid}
                onClick={() => onSelectChat(chat)}
                title={isIgnored ? `${title} (Coleta Pausada)` : `${title} (Coleta Ativa)`}
                className={`px-3 py-2.5 flex items-center gap-2.5 cursor-pointer transition select-none ${
                  isSelected
                    ? 'bg-emerald-950/40 border-l-2 border-emerald-500 text-white'
                    : 'hover:bg-gray-800/50 text-gray-300'
                } ${isIgnored ? 'opacity-70' : ''}`}
              >
                {/* Avatar Compacto com Ponto Indicador de Coleta */}
                <div className="relative flex-shrink-0">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      chat.is_group
                        ? 'bg-indigo-950/60 text-indigo-300 border border-indigo-800/50'
                        : 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/50'
                    }`}
                  >
                    {chat.is_group ? <Users className="w-4 h-4" /> : <User className="w-4 h-4" />}
                  </div>

                  {/* Indicador de Status da Coleta */}
                  {isIgnored ? (
                    <span
                      title="Coleta pausada"
                      className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-rose-500 rounded-full border-2 border-gray-950 flex items-center justify-center text-[8px] text-white"
                    >
                      <Pause className="w-1.5 h-1.5 fill-current" />
                    </span>
                  ) : (
                    <span
                      title="Coleta ativa"
                      className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-gray-950"
                    />
                  )}
                </div>

                {/* Nome e Data */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-medium truncate flex items-center gap-1">
                      <span className="truncate">{title}</span>
                      {chat.is_group ? (
                        <span className="text-[9px] text-indigo-400 bg-indigo-950/70 px-1 rounded flex-shrink-0 border border-indigo-800/40">
                          Grupo
                        </span>
                      ) : null}
                      {chat.allow_send && !chat.is_group ? (
                        <span
                          title="Envio pelo Hermes autorizado"
                          className="text-[9px] text-amber-300 bg-amber-950/80 px-1 py-0.2 rounded flex-shrink-0 border border-amber-800/50 flex items-center gap-0.5"
                        >
                          <Zap className="w-2.5 h-2.5 text-amber-400 fill-current" />
                          Hermes
                        </span>
                      ) : null}
                    </span>
                    <span className="text-[10px] text-gray-500 flex-shrink-0">
                      {formatTimestamp(chat.last_message_timestamp)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
