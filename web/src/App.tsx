import { useI18n } from './i18n';
import React, { useState, useEffect, useCallback } from 'react';
import {
  MessageSquare,
  Search,
  Settings as SettingsIcon,
  QrCode,
  Radio,
  CheckCircle2,
  AlertTriangle,
  HardDrive,
  ArrowLeft,
  X
} from 'lucide-react';
import {
  fetchChats,
  fetchMessages,
  toggleIgnoreContact,
  toggleAllowSendContact,
  searchMessages,
  fetchAuthStatus,
  fetchSettings,
  type Contact,
  type Message,
  type SearchResult,
  type AuthStatus,
  type Settings
} from './api';
import { ChatList } from './components/ChatList';
import { MessageView } from './components/MessageView';
import { GlobalSearch } from './components/GlobalSearch';
import { SettingsModal } from './components/SettingsModal';
import { QrModal } from './components/QrModal';
import { StorageModal } from './components/StorageModal';

export const App: React.FC = () => {
  const { t, language, setLanguage } = useI18n();
  const [chats, setChats] = useState<Contact[]>([]);
  const [selectedChat, setSelectedChat] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  // Busca global FTS5
  const [globalSearchTerm, setGlobalSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);

  // Status & Modais
  const [authStatus, setAuthStatus] = useState<AuthStatus>({
    status: 'connecting',
    qrCodeDataUrl: null,
    userJid: null,
    userName: null
  });
  const [settings, setSettings] = useState<Settings>({
    hasGroqKey: false,
    groqKeyMasked: null,
    readOnly: true
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isQrOpen, setIsQrOpen] = useState(false);
  const [isStorageOpen, setIsStorageOpen] = useState(false);
  const [storageInitialSearch, setStorageInitialSearch] = useState('');

  // Carrega lista de contatos
  const loadChats = useCallback(async (searchQuery?: string) => {
    try {
      const data = await fetchChats(searchQuery);
      setChats(data);
    } catch (err) {
      console.error('Erro ao carregar conversas:', err);
    }
  }, []);

  // Carrega status de autenticação e settings
  const loadMeta = useCallback(async () => {
    try {
      const [auth, sett] = await Promise.all([fetchAuthStatus(), fetchSettings()]);
      setAuthStatus(auth);
      setSettings(sett);
    } catch (err) {
      console.error('Erro ao carregar meta:', err);
    }
  }, []);

  // Carrega mensagens do chat selecionado
  const loadChatMessages = useCallback(async (chatJid: string, isSilent = false) => {
    if (!isSilent) setIsLoadingMessages(true);
    try {
      const data = await fetchMessages(chatJid);
      setMessages(data);
    } catch (err) {
      console.error('Erro ao carregar mensagens:', err);
    } finally {
      if (!isSilent) setIsLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    loadChats();
    loadMeta();

    const interval = setInterval(() => {
      loadChats();
      loadMeta();
      if (selectedChat?.jid) {
        loadChatMessages(selectedChat.jid, true);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [loadChats, loadMeta, loadChatMessages, selectedChat?.jid]);

  const handleSelectChat = (chat: Contact) => {
    setSelectedChat(chat);
    setIsSearchActive(false);
    loadChatMessages(chat.jid);
  };

  const handleToggleIgnore = async (jid: string, newIgnoredState: boolean) => {
    // Atualização otimista na UI
    setChats((prev) =>
      prev.map((c) => (c.jid === jid ? { ...c, is_ignored: newIgnoredState ? 1 : 0 } : c))
    );
    if (selectedChat?.jid === jid) {
      setSelectedChat((prev) => (prev ? { ...prev, is_ignored: newIgnoredState ? 1 : 0 } : null));
    }

    try {
      await toggleIgnoreContact(jid, newIgnoredState);
    } catch (err) {
      console.error('Erro ao atualizar ignore:', err);
      loadChats();
    }
  };

  const handleToggleAllowSend = async (jid: string, newAllowSendState: boolean) => {
    // Atualização otimista na UI
    setChats((prev) =>
      prev.map((c) => (c.jid === jid ? { ...c, allow_send: newAllowSendState ? 1 : 0 } : c))
    );
    if (selectedChat?.jid === jid) {
      setSelectedChat((prev) => (prev ? { ...prev, allow_send: newAllowSendState ? 1 : 0 } : null));
    }

    try {
      await toggleAllowSendContact(jid, newAllowSendState);
    } catch (err) {
      console.error('Erro ao atualizar permissão de envio:', err);
      loadChats();
    }
  };

  // Disparo de busca global
  const handleGlobalSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!globalSearchTerm.trim()) return;

    setIsSearchActive(true);
    setIsSearching(true);
    try {
      const results = await searchMessages(globalSearchTerm.trim());
      setSearchResults(results);
    } catch (err) {
      console.error('Erro na busca global:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectSearchResult = (chatJid: string) => {
    const found = chats.find((c) => c.jid === chatJid);
    if (found) {
      handleSelectChat(found);
    } else {
      const fallbackChat: Contact = {
        jid: chatJid,
        name: chatJid.split('@')[0],
        notify_name: null,
        is_group: chatJid.endsWith('@g.us') ? 1 : 0,
        is_ignored: 0,
        unread_count: 0,
        last_message_timestamp: 0
      };
      handleSelectChat(fallbackChat);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-gray-950 font-sans">
      {/* Top Navbar */}
      <header className="h-14 border-b border-gray-800 bg-gray-900 px-3 sm:px-6 flex items-center justify-between flex-shrink-0 z-20 gap-2">
        {isMobileSearchOpen ? (
          <form
            onSubmit={(e) => {
              handleGlobalSearch(e);
            }}
            className="flex-1 flex items-center gap-2 max-w-full"
          >
            <button
              type="button"
              onClick={() => setIsMobileSearchOpen(false)}
              className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition flex-shrink-0"
              title={t("Close")}
              aria-label={t("Close")}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                autoFocus
                type="text"
                placeholder={t("Search all messages and voice transcriptions...")}
                value={globalSearchTerm}
                onChange={(e) => setGlobalSearchTerm(e.target.value)}
                className="w-full bg-gray-950 text-xs rounded-xl pl-9 pr-8 py-2 text-gray-200 placeholder-gray-500 border border-gray-800 focus:outline-none focus:border-emerald-500 transition"
              />
              {globalSearchTerm && (
                <button
                  type="button"
                  onClick={() => setGlobalSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </form>
        ) : (
          <>
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white shadow-md shadow-emerald-900/50 flex-shrink-0">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-gray-100 flex items-center gap-1.5 sm:gap-2">
                  <span className="hidden xs:inline">WhatsApp</span> Gateway
                  <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 hidden lg:inline-block">
                    {t("MCP Active")}
                  </span>
                </h1>
              </div>
            </div>

            {/* Campo de Busca Global no Desktop */}
            <form onSubmit={handleGlobalSearch} className="hidden md:flex flex-1 max-w-lg mx-4 lg:mx-8">
              <div className="relative w-full">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder={t("Search all messages and voice transcriptions...")}
                  value={globalSearchTerm}
                  onChange={(e) => setGlobalSearchTerm(e.target.value)}
                  className="w-full bg-gray-950 text-xs rounded-xl pl-9 pr-4 py-2 text-gray-200 placeholder-gray-500 border border-gray-800 focus:outline-none focus:border-emerald-500 transition"
                />
              </div>
            </form>

            {/* Ações e Status */}
            <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
              {/* Botão de Busca no Mobile */}
              <button
                type="button"
                onClick={() => setIsMobileSearchOpen(true)}
                className="md:hidden p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white border border-gray-700/60 transition"
                title={t("Search")}
                aria-label={t("Search")}
              >
                <Search className="w-4 h-4" />
              </button>

              <label className="flex items-center gap-1 sm:gap-2 text-xs text-gray-300">
                <span className="sr-only">{t('Language')}</span>
                <select
                  aria-label={t('Language')}
                  title={language === 'pt-BR' ? 'Português (Brasil)' : 'English'}
                  value={language}
                  onChange={(event) => setLanguage(event.target.value === 'pt-BR' ? 'pt-BR' : 'en')}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-gray-100 text-base leading-none"
                >
                  <option value="en" lang="en" aria-label="English">🇺🇸</option>
                  <option value="pt-BR" lang="pt-BR" aria-label="Português (Brasil)">🇧🇷</option>
                </select>
              </label>

              {/* Status Conexão */}
              <button
                onClick={() => setIsQrOpen(true)}
                title={authStatus.status === 'connected' ? t("WhatsApp Online") : t("Scan QR")}
                className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                  authStatus.status === 'connected'
                    ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/60 hover:bg-emerald-900/40'
                    : 'bg-amber-950/60 text-amber-400 border-amber-800/60 hover:bg-amber-900/40 animate-pulse'
                }`}
              >
                {authStatus.status === 'connected' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                ) : (
                  <Radio className="w-3.5 h-3.5 flex-shrink-0" />
                )}
                <span className="hidden sm:inline">
                  {authStatus.status === 'connected' ? t("WhatsApp Online") : t("Scan QR")}
                </span>
              </button>

              {/* Gerenciamento de Armazenamento */}
              <button
                onClick={() => {
                  setStorageInitialSearch('');
                  setIsStorageOpen(true);
                }}
                title={t("Storage management and cleanup")}
                className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white border border-gray-700/60 transition"
              >
                <HardDrive className="w-4 h-4" />
              </button>

              {/* Configurações (Groq API Key) */}
              <button
                onClick={() => setIsSettingsOpen(true)}
                title={t("Configure Whisper (Groq)")}
                className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white border border-gray-700/60 transition"
              >
                <SettingsIcon className="w-4 h-4" />
              </button>
            </div>
          </>
        )}
      </header>

      {/* Conteúdo Principal */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Barra Lateral Otimizada com Lista de Conversas */}
        <div
          className={`w-full md:w-72 md:flex-shrink-0 border-r border-gray-800 h-full flex flex-col ${
            (selectedChat || isSearchActive) ? 'hidden md:flex' : 'flex'
          }`}
        >
          <ChatList
            chats={chats}
            selectedChatJid={selectedChat?.jid || null}
            onSelectChat={handleSelectChat}
            onSearchChange={(search) => loadChats(search)}
          />
        </div>

        {/* Área Central: Busca Global OU Histórico da Conversa */}
        <div
          className={`flex-1 h-full min-w-0 ${
            (!selectedChat && !isSearchActive) ? 'hidden md:flex' : 'flex'
          }`}
        >
          {isSearchActive ? (
            <GlobalSearch
              results={searchResults}
              query={globalSearchTerm}
              isSearching={isSearching}
              onClose={() => {
                setIsSearchActive(false);
                setIsMobileSearchOpen(false);
              }}
              onSelectResult={handleSelectSearchResult}
            />
          ) : (
            <MessageView
              chat={selectedChat}
              messages={messages}
              isLoading={isLoadingMessages}
              onBack={() => setSelectedChat(null)}
              onToggleIgnore={handleToggleIgnore}
              onToggleAllowSend={handleToggleAllowSend}
              onOpenStorage={(jid) => {
                const found = chats.find((c) => c.jid === jid);
                setStorageInitialSearch(found?.name || found?.notify_name || jid);
                setIsStorageOpen(true);
              }}
            />
          )}
        </div>
      </div>

      {/* Modais */}
      <StorageModal
        isOpen={isStorageOpen}
        initialSearch={storageInitialSearch}
        onClose={() => setIsStorageOpen(false)}
        onStorageCleaned={() => {
          loadChats();
          if (selectedChat?.jid) {
            loadChatMessages(selectedChat.jid, true);
          }
        }}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        hasGroqKey={settings.hasGroqKey}
        groqKeyMasked={settings.groqKeyMasked}
        onClose={() => setIsSettingsOpen(false)}
        onSaved={loadMeta}
      />

      <QrModal
        isOpen={isQrOpen}
        authStatus={authStatus}
        onClose={() => setIsQrOpen(false)}
        onRefreshStatus={loadMeta}
      />
    </div>
  );
};
