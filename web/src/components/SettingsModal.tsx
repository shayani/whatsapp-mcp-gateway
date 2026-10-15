import React, { useState } from 'react';
import { X, Key, Check, AlertCircle } from 'lucide-react';
import { saveGroqKey } from '../api';

interface SettingsModalProps {
  isOpen: boolean;
  hasGroqKey: boolean;
  groqKeyMasked: string | null;
  onClose: () => void;
  onSaved: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  hasGroqKey,
  groqKeyMasked,
  onClose,
  onSaved
}) => {
  const [keyInput, setKeyInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim()) return;

    setIsSaving(true);
    setStatusMsg(null);

    try {
      const ok = await saveGroqKey(keyInput.trim());
      if (ok) {
        setStatusMsg({ type: 'success', text: 'Chave da API Groq salva com sucesso!' });
        setKeyInput('');
        onSaved();
      } else {
        setStatusMsg({ type: 'error', text: 'Falha ao salvar chave.' });
      }
    } catch (err) {
      setStatusMsg({ type: 'error', text: 'Erro ao conectar ao servidor.' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-gray-800">
          <div className="flex items-center gap-2 text-white font-semibold text-lg">
            <Key className="w-5 h-5 text-emerald-400" />
            Configurações do Whisper (Groq)
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-300 mb-1">
              Chave da API Groq (Whisper)
            </label>
            <input
              type="password"
              placeholder="gsk_..."
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-emerald-500"
            />
            <p className="text-[11px] text-gray-400 mt-1">
              Utilizada para transcrição automática ultra-rápida de mensagens de voz recebidas.
            </p>
          </div>

          <div className="bg-gray-950/60 p-3 rounded-lg border border-gray-800 text-xs flex items-center justify-between">
            <span className="text-gray-400">Status atual:</span>
            {hasGroqKey ? (
              <span className="text-emerald-400 font-medium flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Ativa ({groqKeyMasked})
              </span>
            ) : (
              <span className="text-amber-400 font-medium flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> Não configurada
              </span>
            )}
          </div>

          {statusMsg && (
            <div
              className={`p-3 rounded-lg text-xs ${
                statusMsg.type === 'success'
                  ? 'bg-emerald-950/80 border border-emerald-800 text-emerald-300'
                  : 'bg-rose-950/80 border border-rose-800 text-rose-300'
              }`}
            >
              {statusMsg.text}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-gray-400 hover:text-white transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving || !keyInput.trim()}
              className="px-4 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg disabled:opacity-50 transition"
            >
              {isSaving ? 'Salvando...' : 'Salvar Chave'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
