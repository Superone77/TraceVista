// Interface language. The English text is the key, so the code still reads as English and a missing
// translation falls back to it. Translations live in i18n.zh.json (source files stay English-only).
// Only the interface switches: titles, summaries, reading layers and raw records keep their own language.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import zh from './i18n.zh.json';

export type Lang = 'en' | 'zh';
type Vars = Record<string, string | number>;
const STORE = 'tracevista.lang';
const dictionaries: Record<Exclude<Lang, 'en'>, Record<string, string>> = { zh: zh as Record<string, string> };

const fill = (text: string, vars?: Vars) => vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] != null ? String(vars[k]) : m) : text;
export function translate(lang: Lang, key: string, vars?: Vars): string {
  return fill(lang === 'en' ? key : dictionaries[lang][key] ?? key, vars);
}

interface LangValue { lang: Lang; setLang: (lang: Lang) => void; t: (key: string, vars?: Vars) => string }
const LangContext = createContext<LangValue>({ lang: 'en', setLang: () => {}, t: (key, vars) => fill(key, vars) });

function storedLang(): Lang {
  try { return localStorage.getItem(STORE) === 'zh' ? 'zh' : 'en'; } catch { return 'en'; }
}

export function LangProvider({ children, initialLang }: { children: ReactNode; initialLang?: Lang }) {
  const [lang, setLangState] = useState<Lang>(() => initialLang ?? storedLang());
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try { localStorage.setItem(STORE, next); } catch { /* private mode: the choice lasts for this page */ }
  }, []);
  useEffect(() => { document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'; }, [lang]);
  const value = useMemo<LangValue>(() => ({ lang, setLang, t: (key, vars) => translate(lang, key, vars) }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export const useLang = () => useContext(LangContext);

/** EN / 中文: each language named in itself, so the way back is always readable. */
export function LangToggle() {
  const { lang, setLang } = useLang();
  const names: Record<Lang, string> = { en: 'EN', zh: dictionaries.zh['$name'] ?? 'ZH' };
  return <div className="lang-toggle" role="group" aria-label={translate(lang, 'Interface language')}>
    {(['en', 'zh'] as Lang[]).map(l => <button key={l} type="button" aria-pressed={lang === l} lang={l === 'zh' ? 'zh-CN' : 'en'} onClick={() => setLang(l)}>{names[l]}</button>)}
  </div>;
}
