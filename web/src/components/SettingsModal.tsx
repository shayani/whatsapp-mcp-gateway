import { useI18n } from '../i18n';
import React, { useState, useEffect } from 'react';
import { X, Key, Check, AlertCircle, Image as ImageIcon, FileText } from 'lucide-react';
import { saveSettings } from '../api';

interface SettingsModalProps {
  isOpen: boolean;
  hasGroqKey: boolean;
  hasOpenAiKey?: boolean;
  groqKeyMasked: string | null;
  imageTranscriptionEnabled?: boolean;
  pdfTranscriptionEnabled?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  hasGroqKey,
  hasOpenAiKey = false,
  groqKeyMasked,
  imageTranscriptionEnabled = true,
  pdfTranscriptionEnabled = true,
  onClose,
  onSaved
}) => {
  const { t } = useI18n();
  const [keyInput, setKeyInput] = useState('');
  const [imageEnabled, setImageEnabled] = useState(imageTranscriptionEnabled);
  const [pdfEnabled, setPdfEnabled] = useState(pdfTranscriptionEnabled);
  const [isSaving, setIsSaving] = useState(false);
  const [isTogglingImage, setIsTogglingImage] = useState(false);
  const [isTogglingPdf, setIsTogglingPdf] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setImageEnabled(imageTranscriptionEnabled);
    setPdfEnabled(pdfTranscriptionEnabled);
  }, [imageTranscriptionEnabled, pdfTranscriptionEnabled, isOpen]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim()) return;

    setIsSaving(true);
    setStatusMsg(null);

    try {
      const ok = await saveSettings({ groq_api_key: keyInput.trim() });
      if (ok) {
        setStatusMsg({ type: 'success', text: t("Groq API key saved successfully!") });
        setKeyInput('');
        onSaved();
      } else {
        setStatusMsg({ type: 'error', text: t("Failed to save the key.") });
      }
    } catch (err) {
      setStatusMsg({ type: 'error', text: t("Could not connect to the server.") });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleImageTranscription = async () => {
    const nextValue = !imageEnabled;
    setIsTogglingImage(true);
    setStatusMsg(null);

    try {
      const ok = await saveSettings({ image_transcription_enabled: nextValue });
      if (ok) {
        setImageEnabled(nextValue);
        setStatusMsg({
          type: 'success',
          text: nextValue
            ? t("Automatic image transcription enabled.")
            : t("Automatic image transcription paused.")
        });
        onSaved();
      } else {
        setStatusMsg({ type: 'error', text: t("Failed to save settings.") });
      }
    } catch {
      setStatusMsg({ type: 'error', text: t("Could not connect to the server.") });
    } finally {
      setIsTogglingImage(false);
    }
  };

  const handleTogglePdfTranscription = async () => {
    const nextValue = !pdfEnabled;
    setIsTogglingPdf(true);
    setStatusMsg(null);

    try {
      const ok = await saveSettings({ pdf_transcription_enabled: nextValue });
      if (ok) {
        setPdfEnabled(nextValue);
        setStatusMsg({
          type: 'success',
          text: nextValue
            ? t("Automatic PDF summary enabled.")
            : t("Automatic PDF summary paused.")
        });
        onSaved();
      } else {
        setStatusMsg({ type: 'error', text: t("Failed to save settings.") });
      }
    } catch {
      setStatusMsg({ type: 'error', text: t("Could not connect to the server.") });
    } finally {
      setIsTogglingPdf(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-md w-full p-4 sm:p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-3 sm:pb-4 border-b border-gray-800">
          <div className="flex items-center gap-2 text-white font-semibold text-base sm:text-lg">
            <Key className="w-5 h-5 text-emerald-400" />
            {t("Transcription Settings (Groq)")}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-300 mb-1">
              {t("Groq API Key (Whisper & Vision)")}
            </label>
            <input
              type="password"
              placeholder="gsk_..."
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-emerald-500"
            />
            <p className="text-[11px] text-gray-400 mt-1">
              {t("Used for fast, automatic transcription of incoming voice messages, images, and PDFs.")}
            </p>
          </div>

          <div className="bg-gray-950/60 p-3 rounded-lg border border-gray-800 text-xs flex items-center justify-between">
            <span className="text-gray-400">{t("Current status:")}</span>
            {hasGroqKey ? (
              <span className="text-emerald-400 font-medium flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> {t("Active (")}{groqKeyMasked})
              </span>
            ) : hasOpenAiKey ? (
              <span className="text-sky-400 font-medium flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> {t("OpenAI fallback active")}
              </span>
            ) : (
              <span className="text-amber-400 font-medium flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> {t("Not configured")}
              </span>
            )}
          </div>

          <div className="bg-gray-950/60 p-3 rounded-lg border border-gray-800 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-medium text-gray-200">
                <ImageIcon className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span>{t("Automatic image transcription")}</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {t("Generates a short description for received and sent photos (ignores stickers).")}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={imageEnabled}
              disabled={isTogglingImage}
              onClick={handleToggleImageTranscription}
              className={`w-10 h-5 flex items-center rounded-full p-0.5 transition flex-shrink-0 disabled:opacity-50 ${
                imageEnabled ? 'bg-emerald-500 justify-end' : 'bg-gray-700 justify-start'
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-white shadow-sm" />
            </button>
          </div>

          <div className="bg-gray-950/60 p-3 rounded-lg border border-gray-800 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-medium text-gray-200">
                <FileText className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                <span>{t("Automatic PDF summary")}</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {t("Generates a short summary for received and sent PDF documents.")}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={pdfEnabled}
              disabled={isTogglingPdf}
              onClick={handleTogglePdfTranscription}
              className={`w-10 h-5 flex items-center rounded-full p-0.5 transition flex-shrink-0 disabled:opacity-50 ${
                pdfEnabled ? 'bg-emerald-500 justify-end' : 'bg-gray-700 justify-start'
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-white shadow-sm" />
            </button>
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
              {t("Cancel")}
            </button>
            <button
              type="submit"
              disabled={isSaving || !keyInput.trim()}
              className="px-4 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg disabled:opacity-50 transition"
            >
              {isSaving ? t("Saving...") : t("Save Key")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
