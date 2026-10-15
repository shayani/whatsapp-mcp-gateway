export interface Contact {
  jid: string;
  name: string | null;
  notify_name: string | null;
  is_group: number;
  is_ignored: number;
  allow_send?: number;
  unread_count: number;
  last_message_timestamp: number;
}

export interface Attachment {
  id: string;
  message_id: string;
  file_path: string;
  file_name: string | null;
  mimetype: string;
  file_size: number | null;
  transcription_text: string | null;
  transcription_status: 'none' | 'pending' | 'completed' | 'failed' | 'skipped';
}

export interface Message {
  id: string;
  chat_jid: string;
  sender_jid: string;
  sender_name?: string | null;
  from_me: number;
  timestamp: number;
  message_type: string;
  content: string | null;
  raw_json?: string | null;
  source?: string | null;
  attachments: Attachment[];
}

export interface SearchResult {
  message_id: string;
  chat_jid: string;
  content: string | null;
  transcription_text: string | null;
  timestamp: number;
  sender_jid: string;
  sender_name?: string | null;
  from_me: number;
  message_type: string;
}

export interface AuthStatus {
  status: 'disconnected' | 'connecting' | 'connected';
  qrCodeDataUrl: string | null;
  userJid: string | null;
  userName: string | null;
}

export interface Settings {
  hasGroqKey: boolean;
  groqKeyMasked: string | null;
  readOnly: boolean;
}

export async function fetchChats(search?: string): Promise<Contact[]> {
  const url = search ? `/api/ui/chats?search=${encodeURIComponent(search)}` : '/api/ui/chats';
  const res = await fetch(url);
  const data = await res.json();
  return data.chats || [];
}

export async function fetchMessages(chatJid: string): Promise<Message[]> {
  const res = await fetch(`/api/ui/chats/${encodeURIComponent(chatJid)}/messages?limit=100`);
  const data = await res.json();
  return data.messages || [];
}

export async function toggleIgnoreContact(jid: string, isIgnored: boolean): Promise<boolean> {
  const res = await fetch('/api/ui/chats/toggle-ignore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jid, is_ignored: isIgnored })
  });
  const data = await res.json();
  return data.success;
}

export async function toggleAllowSendContact(jid: string, allowSend: boolean): Promise<boolean> {
  const res = await fetch('/api/ui/chats/toggle-send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jid, allow_send: allowSend })
  });
  const data = await res.json();
  return data.success;
}

export async function searchMessages(query: string, chatJid?: string): Promise<SearchResult[]> {
  let url = `/api/ui/search?q=${encodeURIComponent(query)}`;
  if (chatJid) url += `&chat_jid=${encodeURIComponent(chatJid)}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.results || [];
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const res = await fetch('/api/auth/status');
  return res.json();
}

export async function fetchSettings(): Promise<Settings> {
  const res = await fetch('/api/ui/settings');
  return res.json();
}

export async function saveGroqKey(groqApiKey: string): Promise<boolean> {
  const res = await fetch('/api/ui/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groq_api_key: groqApiKey })
  });
  const data = await res.json();
  return data.success;
}

export function getAttachmentUrl(attachmentId: string): string {
  return `/api/ui/attachments/${encodeURIComponent(attachmentId)}`;
}

