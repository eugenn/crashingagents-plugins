import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Translate } from '../plugin-core/index';
import messages from './locales/messages.json';
import site from './locales/site.json';

export type Language = keyof typeof site;
export type { Translate };

const languages = Object.keys(site) as Language[];
const isLanguage = (value: unknown): value is Language =>
  typeof value === 'string' && Object.hasOwn(site, value);

const languageContext = createContext<Language>('en');
export const useLanguage = () => useContext(languageContext);

function translator(language: Language): Translate {
  const catalog: Record<string, string> =
    language === 'en' ? {} : (messages[language] as Record<string, string>);
  const errors: Record<string, string> = site[language].errors;
  return (message, params) => {
    const copy = Object.hasOwn(catalog, message)
      ? catalog[message]
      : Object.hasOwn(errors, message)
        ? errors[message]
        : message;
    return params
      ? copy.replace(/\{(\w+)\}/g, (token, name) => String(params[name] ?? token))
      : copy;
  };
}

const translators = new Map(languages.map((language) => [language, translator(language)]));
export const useText = (): Translate => translators.get(useLanguage())!;

export function cardCopy(id: string | undefined, language: Language) {
  const cards: Record<string, { effect?: string; lore?: string }> = site[language].cards;
  return id && Object.hasOwn(cards, id) ? cards[id] : undefined;
}

const STORAGE_KEY = 'crashing-agents.language';

function preferredLanguage(initial?: string): Language {
  if (isLanguage(initial)) return initial;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(saved)) return saved;
  } catch {
    /* Storage can be unavailable in an embedded panel. */
  }
  const browser =
    typeof navigator !== 'undefined'
      ? navigator.languages?.length
        ? navigator.languages
        : [navigator.language]
      : [];
  return browser.map((value) => value?.toLowerCase().split('-')[0]).find(isLanguage) ?? 'en';
}

export function LanguagePanel({
  children,
  initialLanguage,
  theme,
  showSelector = true,
}: {
  children: ReactNode;
  initialLanguage?: string;
  showSelector?: boolean;
  theme?: 'light' | 'dark';
}) {
  const [language, setLanguage] = useState<Language>(() => preferredLanguage(initialLanguage));
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) setLanguage(preferredLanguage());
    };
    const local = (event: Event) => setLanguage((event as CustomEvent<Language>).detail);
    window.addEventListener('storage', sync);
    window.addEventListener(STORAGE_KEY, local);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(STORAGE_KEY, local);
    };
  }, []);
  return (
    <languageContext.Provider value={language}>
      <div
        lang={site[language].intlLocale}
        dir={site[language].direction}
        data-theme={theme}
        className="ca-language-panel"
      >
        {showSelector && <LanguageSelect />}
        {children}
      </div>
    </languageContext.Provider>
  );
}

export function LanguageSelect() {
  const language = useLanguage();
  const t = useText();
  return (
    <label className="ca-language">
      {t('Language')}
      <select
        className="ca-input"
        aria-label={t('Language')}
        value={language}
        onChange={(event) => {
          const next = event.target.value;
          if (!isLanguage(next)) return;
          try {
            localStorage.setItem(STORAGE_KEY, next);
          } catch {
            /* Keep the in-session selection. */
          }
          window.dispatchEvent(new CustomEvent(STORAGE_KEY, { detail: next }));
        }}
      >
        {languages.map((id) => (
          <option key={id} value={id} lang={site[id].intlLocale}>
            {site[id].label}
          </option>
        ))}
      </select>
    </label>
  );
}
