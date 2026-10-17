import React, { useState, useEffect } from 'react';
import { X, QrCode, CheckCircle2, RotateCw } from 'lucide-react';
import { requestReconnect, type AuthStatus } from '../api';

interface QrModalProps {
  isOpen: boolean;
  authStatus: AuthStatus;
  onClose: () => void;
  onRefreshStatus?: () => void;
}

export const QrModal: React.FC<QrModalProps> = ({
  isOpen,
  authStatus,
  onClose,
  onRefreshStatus
}) => {
  const [isRequesting, setIsRequesting] = useState(false);

  // Quando o modal abre, se não estiver conectado e não tiver QR Code, solicita reconexão/novo QR
  useEffect(() => {
    if (!isOpen) return;

    if (authStatus.status !== 'connected' && !authStatus.qrCodeDataUrl) {
      requestReconnect(true).then(() => {
        if (onRefreshStatus) onRefreshStatus();
      });
    }

    // Polling frequente (2s) enquanto o modal estiver aberto para exibir o QR code assim que gerado
    const interval = setInterval(() => {
      if (onRefreshStatus) {
        onRefreshStatus();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isOpen, authStatus.status, authStatus.qrCodeDataUrl, onRefreshStatus]);

  if (!isOpen) return null;

  const handleManualReconnect = async () => {
    setIsRequesting(true);
    try {
      await requestReconnect(true);
      if (onRefreshStatus) {
        await onRefreshStatus();
      }
    } catch (err) {
      console.error('Erro ao solicitar novo QR Code:', err);
    } finally {
      setTimeout(() => setIsRequesting(false), 1500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl text-center">
        <div className="flex items-center justify-between pb-3 border-b border-gray-800 mb-4">
          <div className="flex items-center gap-2 text-white font-semibold text-sm">
            <QrCode className="w-4 h-4 text-emerald-400" />
            Conexão WhatsApp
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {authStatus.status === 'connected' ? (
          <div className="py-6">
            <div className="w-14 h-14 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-base font-semibold text-emerald-400 mb-1">Conectado com Sucesso</h3>
            <p className="text-xs text-gray-300">
              Sessão ativa como: <span className="font-semibold text-white">{authStatus.userName || authStatus.userJid}</span>
            </p>
          </div>
        ) : (
          <div>
            <p className="text-xs text-gray-400 mb-4">
              Abra o WhatsApp no celular &gt; Aparelhos conectados &gt; Conectar aparelho.
            </p>
            <div className="bg-white p-3 rounded-xl inline-block mx-auto mb-3 shadow-inner">
              {authStatus.qrCodeDataUrl ? (
                <img src={authStatus.qrCodeDataUrl} alt="QR Code WhatsApp" className="w-56 h-56 mx-auto" />
              ) : (
                <div className="w-56 h-56 flex flex-col items-center justify-center text-gray-500 text-xs">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-500 mb-2"></div>
                  Aguardando geração do QR Code...
                </div>
              )}
            </div>

            <div className="mt-2">
              <button
                type="button"
                onClick={handleManualReconnect}
                disabled={isRequesting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 transition disabled:opacity-50"
              >
                <RotateCw className={`w-3 h-3 ${isRequesting ? 'animate-spin' : ''}`} />
                <span>{isRequesting ? 'Gerando...' : 'Gerar Novo QR Code'}</span>
              </button>
            </div>

            <p className="text-[11px] text-gray-500 mt-3">
              O QR Code atualiza dinamicamente a cada 20 segundos.
            </p>
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-gray-800">
          <button
            onClick={onClose}
            className="w-full py-2 bg-gray-800 hover:bg-gray-700 text-xs font-medium text-gray-200 rounded-lg transition"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
