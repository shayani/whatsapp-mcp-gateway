import React from 'react';
import { Search, X, MessageSquare, Mic } from 'lucide-react';
import type { SearchResult } from '../api';

interface GlobalSearchProps {
  results: SearchResult[];
  query: string;
  isSearching: boolean;
  onClose: () => void;
  onSelectResult: (chatJid: string) => void;
}

export const GlobalSearch: React.FC<GlobalSearchProps> = ({
  results,
  query,
  isSearching,
  onClose,
  onSelectResult
}) => {
  const formatTimestamp = (ts: number) => {
    return new Date(ts * 1000).toLocaleString([], {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-950 overflow-hidden">
      {/* Barra de título da busca */}
      <div className="p-4 border-b border-gray-800 bg-gray-900/40 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-gray-300">
          <Search className="w-4 h-4 text-emerald-400" />
          <span>
            Resultados de busca para: <strong className="text-white">"{query}"</strong>
          </span>
          <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full ml-2">
            {results.length} encontrados
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Lista de Resultados */}
      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {isSearching ? (
          <div className="text-center py-12 text-gray-500 text-sm">Buscando mensagens...</div>
        ) : results.length === 0 ? (
          <div className="text-center py-12 text-gray-500 text-sm">
            Nenhuma mensagem ou transcrição encontrada para o termo informado.
          </div>
        ) : (
          results.map((res) => (
            <div
              key={res.message_id}
              onClick={() => onSelectResult(res.chat_jid)}
              className="bg-gray-900 border border-gray-800 hover:border-emerald-500/50 p-4 rounded-xl cursor-pointer transition"
            >
              <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
                <span className="font-semibold text-emerald-400 font-mono">{res.chat_jid}</span>
                <span>{formatTimestamp(res.timestamp)}</span>
              </div>

              {res.content && (
                <p className="text-sm text-gray-200 mb-2 flex items-start gap-2">
                  <MessageSquare className="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5" />
                  <span>{res.content}</span>
                </p>
              )}

              {res.transcription_text && (
                <div className="text-sm italic text-indigo-300 bg-indigo-950/40 p-2.5 rounded-lg border-l-2 border-indigo-500 flex items-start gap-2">
                  <Mic className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
                  <span>"{res.transcription_text}"</span>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
