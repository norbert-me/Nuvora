import { createContext, useContext, useState, useCallback } from "react";
import de from "./de.js";
import en from "./en.js";
import es from "./es.js";

export const LANGUAGES = { de: "Deutsch", en: "English", es: "Español" };
const DICTS = { de, en, es };
const STORAGE_KEY = "cardvote_lang";
const DEFAULT_LANG = "de";

function detectLang() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && DICTS[stored]) return stored;
  } catch {}
  const nav = (navigator.language || "de").slice(0, 2).toLowerCase();
  return DICTS[nav] ? nav : DEFAULT_LANG;
}

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(detectLang);

  const setLang = useCallback((next) => {
    if (!DICTS[next]) return;
    setLangState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
  }, []);

  // Fällt auf Deutsch zurück, falls ein Key in der Zielsprache fehlt (nie ein leerer/kaputter String)
  const t = useCallback((key, vars) => {
    let str = DICTS[lang]?.[key] ?? DICTS[DEFAULT_LANG][key] ?? key;
    if (vars) {
      // split/join statt replace: ersetzt ALLE Vorkommen eines Platzhalters
      for (const [k, v] of Object.entries(vars)) str = str.split(`{{${k}}}`).join(v);
    }
    return str;
  }, [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage muss innerhalb von LanguageProvider verwendet werden");
  return ctx;
}
