// Der Fehlermelder-Knopf unten rechts lässt sich ausblenden — am Beamer steht
// er sonst in jeder Übertragung. Eine Einstellung des GERÄTS (wie Sprache und
// Datensparen): am Klassenraum-Rechner aus, am eigenen an. Deshalb bleibt sie
// beim Abmelden liegen (core/abmelden.js).
const KEY = "nuvora_melder_aus";
const EVENT = "nuvora-melder-knopf";

export function melderKnopfAus() {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

export function setzeMelderKnopf(an) {
  try { localStorage.setItem(KEY, an ? "0" : "1"); } catch { /* egal */ }
  // Knopf und Profil-Schalter stehen gleichzeitig im Bild — beide sollen es
  // sofort sehen, ohne Neuladen.
  try { window.dispatchEvent(new Event(EVENT)); } catch { /* egal */ }
}

export function beobachteMelderKnopf(fn) {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
