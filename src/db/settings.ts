import { getDatabase } from './index.js';
import { config } from '../config.js';

export function getSetting(key: string): string | null {
  const db = getDatabase();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (row) {
    return row.value;
  }
  return null;
}

export function setSetting(key: string, value: string): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).run(key, value);
}

export function getEffectiveGroqApiKey(): string | undefined {
  const dbKey = getSetting('groq_api_key');
  if (dbKey && dbKey.trim().length > 0) {
    return dbKey.trim();
  }
  return config.groqApiKey;
}
