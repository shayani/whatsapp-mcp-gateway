import React, { createContext, useContext, useEffect, useState } from 'react';
import { ptBR } from './translations';

export type Language = 'en' | 'pt-BR';
export type TranslationKey = keyof typeof ptBR;
export type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;
export const LANGUAGE_STORAGE_KEY = 'whatsapp-gateway.language';

export function normalizeLanguage(value: unknown): Language {
  return value === 'pt-BR' ? 'pt-BR' : 'en';
}

export function translate(language: Language, key: TranslationKey, values: Record<string, string | number> = {}): string {
  const template = language === 'pt-BR' ? ptBR[key] : key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    values[name] === undefined ? match : String(values[name]));
}

function readLanguage(): Language {
  try {
    return normalizeLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return 'en';
  }
}

interface I18nContextValue {
  language: Language;
  locale: string;
  setLanguage: (language: Language) => void;
  t: Translate;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, updateLanguage] = useState<Language>(readLanguage);
  const setLanguage = (value: Language) => {
    const next = normalizeLanguage(value);
    updateLanguage(next);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // Language switching still works when browser storage is unavailable.
    }
  };

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return (
    <I18nContext.Provider value={{ language, locale: language === 'en' ? 'en-US' : 'pt-BR', setLanguage, t: (key, values) => translate(language, key, values) }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n requires I18nProvider');
  return context;
}
