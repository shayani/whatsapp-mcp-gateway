import React, { useState } from 'react';
import { Users, User, Search, CheckCircle2, Ban } from 'lucide-react';
import type { Contact } from '../api';

interface ChatListProps {
  chats: Contact[];
  selectedChatJid: string | null;
  onSelectChat: (chat: Contact) => void;
  onToggleIgnore: (jid: string, newIgnoredState: boolean) => void;
  onSearchChange: (search: string) => void;
}

export const ChatList: React.FC<ChatListProps> = ({
  chats,
  selectedChatJid,
  onSelectChat,
  onToggleIgnore,
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
    <aside className="w-96 flex-shrink-0 border-r border-gray-800 bg-gray-900/50 flex flex-col h-full">
      {/* Busca de Contatos */}
      <div className="p-3 border-b border-gray-800">
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Filtrar contatos ou grupos..."
            value={searchTerm}
            onChange={handleSearch}
            className="w-full bg-gray-800 text-sm rounded-lg pl-9 pr-4 py-2 text-gray-200 placeholder-gray-500 border border-gray-700/60 focus:outline-none focus:border-emerald-500 transition"
          />
        </div>
      </div>

      {/* Lista de Contatos */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-800/60">
        {chats.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">
            Nenhuma conversa encontrada.
          </div>
        ) : (
          chats.map((chat) => {
            const isSelected = selectedChatJid === chat.jid;
            const isIgnored = Boolean(chat.is_ignored);
            const displayName = chat.name || chat.notify_name || chat.jid.split('@')[0];

            return (
              <div
                key={chat.jid}
                onClick={() => onSelectChat(chat)}
                className={`p-3.5 flex items-start gap-3 cursor-pointer transition hover:bg-gray-800/60 ${
                  isSelected ? 'bg-gray-800/90 border-l-4 border-emerald-500' : ''
                }`}
              >
                {/* Ícone de Usuário ou Grupo */}
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    chat.is_group
                      ? 'bg-indigo-900/40 text-indigo-400 border border-indigo-700/50'
                      : 'bg-emerald-900/40 text-emerald-400 border border-emerald-700/50'
                  }`}
                >
                  {chat.is_group ? <Users className="w-5 h-5" /> : <User className="w-5 h-5" />}
                </div>

                {/* Dados da Conversa */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <h3 className="text-sm font-medium text-gray-200 truncate">
                      {displayName}
                    </h3>
                    <span className="text-[11px] text-gray-500 flex-shrink-0">
                      {formatTimestamp(chat.last_message_timestamp)}
                    </span>
                  </div>

                  <p className="text-xs text-gray-400 truncate font-mono">
                    {chat.jid}
                  </p>

                  {/* Switch Coletar / Ignorar */}
                  <div className="mt-2 flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
                    <span className="text-[11px] text-gray-400 flex items-center gap-1">
                      {isIgnored ? (
                        <span className="text-rose-400 flex items-center gap-1">
                          <Ban className="w-3 h-3" /> Ignorado
                        </span>
                      ) : (
                        <span className="text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Coletando
                        </span>
                      )}
                    </span>

                    <button
                      type="button"
                      title={isIgnored ? 'Clique para coletar mensagens deste contato' : 'Clique para ignorar mensagens deste contato'}
                      onClick={() => onToggleIgnore(chat.jid, !isIgnored)}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        isIgnored ? 'bg-gray-700' : 'bg-emerald-600'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          isIgnored ? 'translate-x-0' : 'translate-x-4'
                        }`}
                      />
                    </button>
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
