import { useI18n } from '../i18n';
import React, { useState, useEffect, useCallback } from 'react';
import {
  HardDrive,
  Database,
  Trash2,
  RotateCw,
  Search,
  Users,
  User,
  AlertTriangle,
  CheckCircle2,
  X,
  Sparkles,
  FileAudio,
  ShieldCheck,
  Smartphone
} from 'lucide-react';
import {
  fetchStorageSummary,
  fetchStorageChats,
  cleanStorage,
  type StorageSummary,
  type ChatStorageInfo,
  type CleanStorageResult
} from '../api';

interface StorageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStorageCleaned?: () => void;
  initialSearch?: string;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export const StorageModal: React.FC<StorageModalProps> = ({
  isOpen,
  onClose,
  onStorageCleaned,
  initialSearch = ''
}) => {
  const { t, locale } = useI18n();
  const [summary, setSummary] = useState<StorageSummary | null>(null);
  const [chats, setChats] = useState<ChatStorageInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [filterType, setFilterType] = useState<'all' | 'groups' | 'contacts'>('all');

  // Modal de Confirmação de Limpeza
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    target: string;
    targetTitle: string;
    mode: 'media_only' | 'all';
    olderThanDays: number;
    estimatedMediaBytes?: number;
    estimatedMediaCount?: number;
    estimatedMessageCount?: number;
  } | null>(null);

  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanFeedback, setCleanFeedback] = useState<{
    success: boolean;
    message: string;
    result?: CleanStorageResult;
  } | null>(null);

  // Carrega dados de armazenamento
  const loadData = useCallback(async (refresh = false) => {
    setIsLoading(true);
    setCleanFeedback(null);
    try {
      const [sum, chatList] = await Promise.all([
        fetchStorageSummary(refresh),
        fetchStorageChats(undefined, refresh, 200)
      ]);
      setSummary(sum);
      setChats(chatList);
    } catch (err) {
      console.error('Erro ao carregar dados de armazenamento:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setSearchTerm(initialSearch || '');
      loadData(false);
    }
  }, [isOpen, initialSearch, loadData]);

  if (!isOpen) return null;

  // Filtragem da lista
  const filteredChats = chats.filter((c) => {
    if (filterType === 'groups' && !c.isGroup) return false;
    if (filterType === 'contacts' && c.isGroup) return false;
    if (searchTerm.trim().length > 0) {
      const term = searchTerm.toLowerCase();
      return (
        c.displayName.toLowerCase().includes(term) ||
        c.jid.toLowerCase().includes(term)
      );
    }
    return true;
  });

  const maxMediaBytes = chats.length > 0 ? Math.max(...chats.map((c) => c.mediaBytes), 1) : 1;

  // Disparar diálogo de confirmação
  const promptClean = (
    target: string,
    targetTitle: string,
    mode: 'media_only' | 'all',
    olderThanDays: number,
    estimatedMediaBytes?: number,
    estimatedMediaCount?: number,
    estimatedMessageCount?: number
  ) => {
    setConfirmDialog({
      isOpen: true,
      target,
      targetTitle,
      mode,
      olderThanDays,
      estimatedMediaBytes,
      estimatedMediaCount,
      estimatedMessageCount
    });
  };

  const executeClean = async () => {
    if (!confirmDialog) return;
    setIsCleaning(true);
    setCleanFeedback(null);

    try {
      const result = await cleanStorage({
        target: confirmDialog.target,
        mode: confirmDialog.mode,
        olderThanDays: confirmDialog.olderThanDays
      });

      setCleanFeedback({
        success: true,
        message:
          confirmDialog.mode === 'media_only'
            ? t('Freed {size} by deleting {files} media file(s).', { size: formatBytes(result.freedMediaBytes), files: result.deletedFilesCount })
            : t('Freed {size}. Removed {messages} message(s) and {files} file(s). SQLite optimized.', { size: formatBytes(result.freedMediaBytes), messages: result.deletedMessagesCount, files: result.deletedFilesCount }),
        result
      });

      // Recarrega os dados com refresh
      await loadData(true);
      if (onStorageCleaned) {
        onStorageCleaned();
      }
    } catch (err: any) {
      console.error('Erro ao limpar armazenamento:', err);
      setCleanFeedback({
        success: false,
        message: t("Storage cleanup failed. Please try again.")
      });
    } finally {
      setIsCleaning(false);
      setConfirmDialog(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header do Modal */}
        <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between bg-gray-900/90 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-950 text-emerald-400 border border-emerald-800/60 flex items-center justify-center shadow-inner">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-100 flex items-center gap-2">
                {t("Storage Management")}
                <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800">
                  {t("On Demand")}
                </span>
              </h2>
              <p className="text-xs text-gray-400">
                {t("Find chats using the most storage and free up space by clearing media or history.")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => loadData(true)}
              disabled={isLoading}
              title={t("Recalculate statistics")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white border border-gray-700 transition disabled:opacity-50"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>{t("Refresh")}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Feedback de Limpeza */}
        {cleanFeedback && (
          <div
            className={`px-6 py-3 border-b flex items-center gap-2 text-xs font-medium flex-shrink-0 ${
              cleanFeedback.success
                ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                : 'bg-rose-950/60 border-rose-800 text-rose-300'
            }`}
          >
            {cleanFeedback.success ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            )}
            <span className="flex-1">{cleanFeedback.message}</span>
            <button
              onClick={() => setCleanFeedback(null)}
              className="text-gray-400 hover:text-gray-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Área Rolável */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Banner de Segurança: Apenas Cópias Locais */}
          <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-xl p-3.5 flex items-start gap-3 shadow-sm">
            <ShieldCheck className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-emerald-200/90 leading-relaxed">
              <span className="font-semibold text-emerald-300">{t("Only local copies on this server:")} </span>
              {t("Media and chat cleanup affects")} <strong>{t("only the local disk")}</strong> {t("of this gateway.")}
              <span className="text-emerald-100 font-medium"> {t("No messages or media will be deleted from WhatsApp on your phone or from WhatsApp servers.")}</span>
            </div>
          </div>

          {/* Cards de Resumo */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Card Mídias */}
            <div className="bg-gray-950/70 border border-gray-800/80 rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between text-gray-400 mb-2">
                <span className="text-xs font-medium">{t("Media on Disk")}</span>
                <FileAudio className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-100">
                  {summary ? formatBytes(summary.totalMediaBytes) : '...'}
                </div>
                <div className="text-[11px] text-gray-400 mt-0.5">
                  {summary ? t('{count} files saved', { count: summary.totalMediaFiles.toLocaleString(locale) }) : t("Loading...")}
                </div>
              </div>
            </div>

            {/* Card Banco de Dados */}
            <div className="bg-gray-950/70 border border-gray-800/80 rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between text-gray-400 mb-2">
                <span className="text-xs font-medium">{t("Database (SQLite)")}</span>
                <Database className="w-4 h-4 text-indigo-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-100">
                  {summary
                    ? formatBytes(summary.databaseBytes + summary.walBytes)
                    : '...'}
                </div>
                <div className="text-[11px] text-gray-400 mt-0.5">
                  {summary ? t('{count} messages recorded', { count: summary.totalMessages.toLocaleString(locale) }) : t("Loading...")}
                </div>
              </div>
            </div>

            {/* Card Conversas */}
            <div className="bg-gray-950/70 border border-gray-800/80 rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between text-gray-400 mb-2">
                <span className="text-xs font-medium">{t("Collected Chats")}</span>
                <Users className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-100">
                  {summary ? summary.totalContactsWithData : '...'}
                </div>
                <div className="text-[11px] text-gray-400 mt-0.5">
                  {t("With history or attachments")}
                </div>
              </div>
            </div>
          </div>

          {/* Seção Limpeza Rápida Global */}
          <div className="bg-gradient-to-r from-gray-950 to-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-gray-200">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span>{t("Quick Cleanup")}</span>
            </div>
            <p className="text-xs text-gray-400 mb-3">
              {t("Remove old media in bulk while keeping text messages and Whisper transcriptions.")}
            </p>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  promptClean(
                    'groups_only',
                    t("All Groups"),
                    'media_only',
                    30,
                    summary?.totalMediaBytes
                  )
                }
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 transition flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5 text-amber-400" />
                <span>{t("Clear group media (> 30 days)")}</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  promptClean(
                    'all',
                    t("All Chats"),
                    'media_only',
                    60,
                    summary?.totalMediaBytes
                  )
                }
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 transition flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5 text-amber-400" />
                <span>{t("Clear all media (> 60 days)")}</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  promptClean(
                    'groups_only',
                    t("All Groups"),
                    'media_only',
                    0,
                    summary?.totalMediaBytes
                  )
                }
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-950/40 hover:bg-rose-900/40 text-rose-300 border border-rose-800/60 transition flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                <span>{t("Clear ALL group media")}</span>
              </button>
            </div>
          </div>

          {/* Tabela de Ranking por Conversa */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-1 bg-gray-950 p-1 rounded-xl border border-gray-800 text-xs">
                <button
                  type="button"
                  onClick={() => setFilterType('all')}
                  className={`px-3 py-1 rounded-lg font-medium transition ${
                    filterType === 'all'
                      ? 'bg-gray-800 text-white shadow-sm'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {t("All (")}{chats.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterType('groups')}
                  className={`px-3 py-1 rounded-lg font-medium transition ${
                    filterType === 'groups'
                      ? 'bg-gray-800 text-white shadow-sm'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {t("Groups (")}{chats.filter((c) => c.isGroup).length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterType('contacts')}
                  className={`px-3 py-1 rounded-lg font-medium transition ${
                    filterType === 'contacts'
                      ? 'bg-gray-800 text-white shadow-sm'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {t("Contacts (")}{chats.filter((c) => !c.isGroup).length})
                </button>
              </div>

              {/* Busca rápida na tabela */}
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder={t("Filter by name or number...")}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-gray-950 text-xs rounded-xl pl-9 pr-3 py-1.5 text-gray-200 placeholder-gray-500 border border-gray-800 focus:outline-none focus:border-emerald-500 transition"
                />
              </div>
            </div>

            {/* Listagem em Tabela Estilizada */}
            <div className="border border-gray-800 rounded-xl overflow-hidden bg-gray-950/50">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-900/80 text-gray-400 border-b border-gray-800 select-none">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">{t("Chat")}</th>
                      <th className="py-2.5 px-3 font-medium text-center">{t("Messages")}</th>
                      <th className="py-2.5 px-3 font-medium text-center">{t("Media")}</th>
                      <th className="py-2.5 px-4 font-medium">{t("Disk Usage")}</th>
                      <th className="py-2.5 px-4 font-medium text-right">{t("Cleanup Actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/60">
                    {filteredChats.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-gray-500">
                          {t("No chats match the selected filters.")}
                        </td>
                      </tr>
                    ) : (
                      filteredChats.map((chat) => {
                        const usagePercent = Math.min(
                          Math.round((chat.mediaBytes / maxMediaBytes) * 100),
                          100
                        );

                        return (
                          <tr
                            key={chat.jid}
                            className="hover:bg-gray-900/40 transition group"
                          >
                            {/* Nome & Avatar */}
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div
                                  className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                                    chat.isGroup
                                      ? 'bg-indigo-950/80 text-indigo-300 border border-indigo-800/40'
                                      : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/40'
                                  }`}
                                >
                                  {chat.isGroup ? (
                                    <Users className="w-3.5 h-3.5" />
                                  ) : (
                                    <User className="w-3.5 h-3.5" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="font-medium text-gray-200 truncate flex items-center gap-1.5">
                                    <span className="truncate max-w-[200px] sm:max-w-[260px]">
                                      {chat.displayName}
                                    </span>
                                    {chat.isGroup && (
                                      <span className="text-[9px] px-1 rounded bg-indigo-950 text-indigo-400 border border-indigo-800/40">
                                        {t("Group")}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-gray-500 font-mono truncate max-w-[200px]">
                                    {chat.jid}
                                  </div>
                                </div>
                              </div>
                            </td>

                            {/* Mensagens */}
                            <td className="py-3 px-3 text-center text-gray-400 font-mono">
                              {chat.messageCount}
                            </td>

                            {/* Mídias */}
                            <td className="py-3 px-3 text-center text-gray-400 font-mono">
                              {chat.mediaCount}
                            </td>

                            {/* Uso em Disco com Barra */}
                            <td className="py-3 px-4">
                              <div className="w-36">
                                <div className="flex justify-between text-[11px] font-medium text-gray-300 mb-1">
                                  <span>{formatBytes(chat.mediaBytes)}</span>
                                  <span className="text-gray-500 text-[10px]">
                                    {usagePercent}%
                                  </span>
                                </div>
                                <div className="w-full bg-gray-800 h-1.5 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all duration-300 ${
                                      chat.mediaBytes > 50 * 1024 * 1024
                                        ? 'bg-amber-500'
                                        : 'bg-emerald-500'
                                    }`}
                                    style={{ width: `${Math.max(usagePercent, 2)}%` }}
                                  />
                                </div>
                              </div>
                            </td>

                            {/* Ações */}
                            <td className="py-3 px-4 text-right">
                              <div className="inline-flex items-center gap-1.5">
                                {/* Limpar Mídias */}
                                <button
                                  type="button"
                                  disabled={chat.mediaCount === 0}
                                  onClick={() =>
                                    promptClean(
                                      chat.jid,
                                      chat.displayName,
                                      'media_only',
                                      0,
                                      chat.mediaBytes,
                                      chat.mediaCount
                                    )
                                  }
                                  title={t("Clear only the media files for this chat")}
                                  className="px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-800 hover:bg-gray-700 text-amber-300 hover:text-amber-200 border border-gray-700 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                                >
                                  <Trash2 className="w-3 h-3 text-amber-400" />
                                  <span>{t("Media")}</span>
                                </button>

                                {/* Limpar Tudo (Mensagens + Mídias) */}
                                <button
                                  type="button"
                                  disabled={chat.messageCount === 0 && chat.mediaCount === 0}
                                  onClick={() =>
                                    promptClean(
                                      chat.jid,
                                      chat.displayName,
                                      'all',
                                      0,
                                      chat.mediaBytes,
                                      chat.mediaCount,
                                      chat.messageCount
                                    )
                                  }
                                  title={t("Delete message history and media for this chat")}
                                  className="px-2.5 py-1 rounded-lg text-xs font-medium bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 hover:text-rose-200 border border-rose-800/60 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                                >
                                  <Trash2 className="w-3 h-3 text-rose-400" />
                                  <span>{t("Everything")}</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Rodapé do Modal */}
        <div className="px-6 py-3.5 border-t border-gray-800 bg-gray-900/90 flex flex-col sm:flex-row items-center justify-between gap-2 flex-shrink-0 text-xs text-gray-400">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>
              <strong>{t("100% Safe:")}</strong> {t("Original messages and media on your phone and in WhatsApp remain intact.")}
            </span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-200 transition"
          >
            {t("Close")}
          </button>
        </div>
      </div>

      {/* Sub-modal de Confirmação de Limpeza */}
      {confirmDialog && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-950 text-amber-400 border border-amber-800/60 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-100">
                  {t("Confirm Storage Cleanup")}
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {t("This action is irreversible and will free up disk space on this server.")}
                </p>
              </div>
            </div>

            {/* Aviso de Isolamento no Celular */}
            <div className="bg-emerald-950/40 border border-emerald-800/50 rounded-xl p-3 flex items-start gap-2.5 text-xs text-emerald-200">
              <Smartphone className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-emerald-300">{t("Your phone remains untouched:")} </span>
                {t("This cleanup deletes only files saved on this server. Nothing is deleted from your WhatsApp app or the cloud.")}
              </div>
            </div>

            <div className="bg-gray-950/80 rounded-xl p-3.5 border border-gray-800 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-400">{t("Target:")}</span>
                <span className="font-semibold text-gray-200">
                  {confirmDialog.targetTitle}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">{t("Cleanup Type:")}</span>
                <span className="font-semibold text-amber-300">
                  {confirmDialog.mode === 'media_only'
                    ? t("Media Only (keeps texts/transcriptions)")
                    : t("Full (Messages + Media + VACUUM)")}
                </span>
              </div>
              {confirmDialog.estimatedMediaBytes !== undefined && (
                <div className="flex justify-between">
                  <span className="text-gray-400">{t("Estimated Space:")}</span>
                  <span className="font-semibold text-emerald-400">
                    ~{formatBytes(confirmDialog.estimatedMediaBytes)}
                  </span>
                </div>
              )}
            </div>

            {/* Opção de Corte Temporal */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-300">
                {t("Date cutoff:")}
              </label>
              <select
                value={confirmDialog.olderThanDays}
                onChange={(e) =>
                  setConfirmDialog({
                    ...confirmDialog,
                    olderThanDays: parseInt(e.target.value, 10)
                  })
                }
                className="w-full bg-gray-950 text-xs text-gray-200 border border-gray-800 rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500"
              >
                <option value={0}>{t("All history (no date limit)")}</option>
                <option value={7}>{t("Only items older than 7 days")}</option>
                <option value={30}>{t("Only items older than 30 days")}</option>
                <option value={60}>{t("Only items older than 60 days")}</option>
                <option value={90}>{t("Only items older than 90 days")}</option>
              </select>
            </div>

            {/* Botões do Diálogo */}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                disabled={isCleaning}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-300 hover:bg-gray-800 transition"
              >
                {t("Cancel")}
              </button>
              <button
                type="button"
                onClick={executeClean}
                disabled={isCleaning}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition ${
                  confirmDialog.mode === 'all'
                    ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/40'
                    : 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-900/40'
                } disabled:opacity-50`}
              >
                {isCleaning && <RotateCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{isCleaning ? t("Cleaning...") : t("Confirm and Clean")}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
