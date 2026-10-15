import React, { useState, useMemo } from 'react';
import { Users, User, Search, Ban, CheckCircle2 } from 'lucide-react';
import type { Contact } from '../../api';
import { getContactDisplay } from '../../utils/contactUtils';

interface ChatListProps {
  chats: Contact[];
  selectedChatJid: string | null;
  onSelectChat: (chat: Contact) => void;
  onSearchChange: (search: string) => void;
}

export const ChatListVariantB: React.FC<ChatListProps> = ({
  chats,
  selectedChatJid,
  onSelectChat,
  onSearchChange
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'collecting' | 'ignored'>('all');

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

  const counts = useMemo(() => {
    const total = chats.length;
    const ignored = chats.filter((c) => Boolean(c.is_ignored)).length;
    const collecting = total - ignored;
    return { total, collecting, ignored };
  }, [chats]);

  const filteredChats = useMemo(() => {
    if (filterTab === 'collecting') {
      return chats.filter((c) => !c.is_ignored);
    }
    if (filterTab === 'ignored') {
      return chats.filter((c) => Boolean(c.is_ignored));
    }
    return chats;
  }, [chats, filterTab]);

  return (
    <aside className="w-80 flex-shrink-0 border-r border-gray-800 bg-gray-900/50 flex flex-col h-full">
      {/* Busca e Abas de Filtro */}
      <div className="p-3 border-b border-gray-800 bg-gray-900/70 space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar nome ou telefone..."
            value={searchTerm}
            onChange={handleSearch}
            className="w-full bg-gray-800 text-xs rounded-lg pl-9 pr-3 py-2 text-gray-200 placeholder-gray-500 border border-gray-700/60 focus:outline-none focus:border-emerald-500 transition"
          />
        </div>

        {/* Abas Rápidas: Todos / Coletando / Pausados */}
        <div className="flex items-center gap-1 bg-gray-950/60 p-1 rounded-lg border border-gray-800/80 text-[11px]">
          <button
            type="button"
            onClick={() => setFilterTab('all')}
            className={`flex-1 py-1 rounded text-center transition font-medium ${
              filterTab === 'all'
                ? 'bg-gray-800 text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Todos ({counts.total})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('collecting')}
            className={`flex-1 py-1 rounded text-center transition font-medium ${
              filterTab === 'collecting'
                ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/50'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Ativos ({counts.collecting})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('ignored')}
            className={`flex-1 py-1 rounded text-center transition font-medium ${
              filterTab === 'ignored'
                ? 'bg-rose-950 text-rose-300 border border-rose-800/50'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Pausados ({counts.ignored})
          </button>
        </div>
      </div>

      {/* Lista com Badges Explícitas */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-800/50">
        {filteredChats.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-xs">
            {filterTab === 'ignored'
              ? 'Nenhum contato pausado no momento.'
              : 'Nenhuma conversa encontrada.'}
          </div>
        ) : (
          filteredChats.map((chat) => {
            const isSelected = selectedChatJid === chat.jid;
            const isIgnored = Boolean(chat.is_ignored);
            const { title, subtitle } = getContactDisplay(chat);

            return (
              <div
                key={chat.jid}
                onClick={() => onSelectChat(chat)}
                className={`p-3 flex items-start gap-3 cursor-pointer transition select-none ${
                  isSelected
                    ? 'bg-gray-800/90 border-l-4 border-emerald-500'
                    : 'hover:bg-gray-800/50'
                } ${isIgnored ? 'bg-gray-950/30' : ''}`}
              >
                {/* Avatar */}
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    chat.is_group
                      ? 'bg-indigo-950/60 text-indigo-400 border border-indigo-700/50'
                      : 'bg-emerald-950/60 text-emerald-400 border border-emerald-700/50'
                  }`}
                >
                  {chat.is_group ? <Users className="w-4 h-4" /> : <User className="w-4 h-4" />}
                </div>

                {/* Conteúdo */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <h3 className="text-xs font-semibold text-gray-200 truncate">
                      {title}
                    </h3>
                    <span className="text-[10px] text-gray-500 flex-shrink-0">
                      {formatTimestamp(chat.last_message_timestamp)}
                    </span>
                  </div>

                  {/* Subtítulo & Status Badge */}
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <span className="text-[11px] text-gray-400 truncate">
                      {subtitle || (chat.is_group ? 'Grupo' : '')}
                    </span>

                    {/* Badge Clara de Coleta */}
                    {isIgnored ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-950/70 text-rose-300 border border-rose-800/60 flex items-center gap-1 flex-shrink-0">
                        <Ban className="w-2.5 h-2.5" /> Pausado
                      </span>
                    ) : (
                      <span className="text-[10px] text-emerald-400/80 flex items-center gap-1 flex-shrink-0">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      </span>
                    )}
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
