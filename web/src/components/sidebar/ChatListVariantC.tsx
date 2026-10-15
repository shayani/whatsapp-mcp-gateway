import React, { useState } from 'react';
import { Users, User, Search, EyeOff, Radio } from 'lucide-react';
import type { Contact } from '../../api';
import { getContactDisplay } from '../../utils/contactUtils';

interface ChatListProps {
  chats: Contact[];
  selectedChatJid: string | null;
  onSelectChat: (chat: Contact) => void;
  onSearchChange: (search: string) => void;
}

export const ChatListVariantC: React.FC<ChatListProps> = ({
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
    <aside className="w-76 flex-shrink-0 border-r border-gray-800 bg-gray-950 flex flex-col h-full">
      {/* Busca */}
      <div className="p-3 border-b border-gray-800/80 bg-gray-900/30">
        <div className="relative">
          <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Filtrar..."
            value={searchTerm}
            onChange={handleSearch}
            className="w-full bg-gray-900 text-xs rounded-md pl-9 pr-3 py-2 text-gray-200 placeholder-gray-500 border border-gray-800 focus:outline-none focus:border-emerald-500/80 transition"
          />
        </div>
      </div>

      {/* Lista com Barra Lateral de Coleta */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-900">
        {chats.length === 0 ? (
          <div className="p-6 text-center text-gray-500 text-xs">
            Nenhuma conversa encontrada.
          </div>
        ) : (
          chats.map((chat) => {
            const isSelected = selectedChatJid === chat.jid;
            const isIgnored = Boolean(chat.is_ignored);
            const { title, subtitle } = getContactDisplay(chat);

            return (
              <div
                key={chat.jid}
                onClick={() => onSelectChat(chat)}
                className={`p-3 flex items-center gap-3 cursor-pointer transition select-none ${
                  // Borda lateral colorida indicando estado de coleta
                  isIgnored
                    ? 'border-l-[3px] border-rose-500/70 bg-gray-950/80 opacity-60'
                    : 'border-l-[3px] border-emerald-500/90 bg-gray-950 hover:bg-gray-900/50'
                } ${isSelected ? '!bg-gray-900 !border-l-4 !border-emerald-400' : ''}`}
              >
                {/* Avatar */}
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    chat.is_group
                      ? 'bg-indigo-950/70 text-indigo-400 border border-indigo-800/50'
                      : 'bg-emerald-950/70 text-emerald-400 border border-emerald-800/50'
                  }`}
                >
                  {chat.is_group ? <Users className="w-4 h-4" /> : <User className="w-4 h-4" />}
                </div>

                {/* Nome e Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-gray-200 truncate">
                      {title}
                    </span>
                    <span className="text-[10px] text-gray-500 flex-shrink-0">
                      {formatTimestamp(chat.last_message_timestamp)}
                    </span>
                  </div>

                  {subtitle ? (
                    <div className="text-[11px] text-gray-400 truncate mt-0.5">
                      {subtitle}
                    </div>
                  ) : null}
                </div>

                {/* Ícone de Estado de Coleta na Borda Direita */}
                <div className="flex-shrink-0 flex items-center">
                  {isIgnored ? (
                    <span title="Coleta pausada" className="text-rose-400/90 p-1">
                      <EyeOff className="w-3.5 h-3.5" />
                    </span>
                  ) : (
                    <span title="Coletando em tempo real" className="text-emerald-400/90 p-1">
                      <Radio className="w-3 h-3 animate-pulse" />
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
