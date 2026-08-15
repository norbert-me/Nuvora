// Uebersetzung fuer den Code-Detektiv — duenne Schicht ueber dem i18n der Shell.
//
// Warum nicht direkt `useLanguage().t`? Bis die Schluessel (Praefix `cd.`) in
// i18n/de.js, en.js und es.js stehen, wuerde `t()` mit einem `cd.`-Schluessel den
// nackten Schluessel auf die Seite schreiben. Der zweite Rueckgabewert ist
// deshalb der bisherige deutsche Text: fehlt die Uebersetzung, steht dort, was
// vorher schon dort stand — nie ein Schluessel.
//
// Sobald die Woerterbuecher die Schluessel kennen, gewinnt die Uebersetzung
// automatisch; der zweite Parameter darf dann irgendwann wegfallen.
import { useLanguage } from "../i18n/index.jsx";

export function useCdText() {
  const { t, lang } = useLanguage();
  const uebersetzt = (key, deutsch, vars) => {
    const s = t(key, vars);
    return s === key ? ersetze(deutsch, vars) : s;
  };
  return { t: uebersetzt, lang };
}

// Platzhalter im Rueckfalltext genauso ersetzen wie im Woerterbuch ({{name}}).
function ersetze(text, vars) {
  if (!vars) return text;
  let s = text;
  for (const [k, v] of Object.entries(vars)) s = s.split(`{{${k}}}`).join(v);
  return s;
}
