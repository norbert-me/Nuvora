// Ein Zugang zum Browserspeicher, der nicht wirft.
//
// Safari im privaten Modus — und jeder Browser, in dem Cookies/Website-Daten
// blockiert sind — laesst `localStorage` werfen: mal schon beim blossen
// Zugriff, mal erst beim Ablegen. Ungeschuetzt reisst das die Stelle mit, an
// der es steht. Zwei davon waren teuer:
//
//   - der globale fetch-Interceptor (main.jsx) las den Token ungeschuetzt —
//     jeder API-Aufruf flog auseinander;
//   - die Anmeldung legte Token und Nutzer im selben `try` ab wie das fetch
//     und meldete im Auffangzweig „Verbindungsfehler". Der Server hatte die
//     Anmeldung da laengst angenommen. Die Lehrkraft las „Server kaputt" und
//     kam auf dem iPad nie hinein.
//
// Statt jede Stelle einzeln in try/catch zu wickeln (so machen es modules.js
// und cache.js — die duerfen so bleiben, sie speichern nur Anzeige-Caches),
// gibt es hier einen Zugang mit zwei Zusagen:
//
//   1. Er wirft nie.
//   2. Laesst der Browser nichts ablegen, weicht er in den Arbeitsspeicher
//      aus. Die Sitzung traegt dann bis zum Neuladen des Tabs — mehr ist ohne
//      Speicher nicht moeglich, und genau das sagt die Oberflaeche dann auch
//      (SpeicherHinweis in main.jsx).
//
// `schreib()` meldet mit true/false, ob es DAUERHAFT abgelegt wurde. Wer das
// unterscheiden muss (die Anmeldung), fragt danach; alle anderen ignorieren es.

// Ausweichlager fuer alles, was der Browser nicht annehmen wollte. Bewusst
// modul-global: es soll den ganzen Tab ueberdauern, aber keinen Neustart.
const _arbeitsspeicher = new Map();

// Der Zugriff selbst kann werfen — deshalb nie direkt `localStorage`.
function _ls() {
  const s = globalThis.localStorage;
  if (!s) throw new Error("kein localStorage");
  return s;
}

const PROBE = "__nuvora_speicherprobe__";
let _nutzbar = null;

/**
 * Kann dieser Browser ueberhaupt etwas dauerhaft ablegen?
 * Einmal geprueft (schreiben + wieder loeschen), danach gemerkt.
 */
export function speicherNutzbar() {
  if (_nutzbar === null) {
    try {
      _ls().setItem(PROBE, "1");
      _ls().removeItem(PROBE);
      _nutzbar = true;
    } catch {
      _nutzbar = false;
    }
  }
  return _nutzbar;
}

/** Nur fuer Tests: die gemerkte Antwort und das Ausweichlager verwerfen. */
export function speicherVergessen() {
  _nutzbar = null;
  _arbeitsspeicher.clear();
}

/** Wert lesen. Nie ein Wurf, im Zweifel null. */
export function lies(schluessel) {
  // Das Ausweichlager zuerst: was dort liegt, ist der neuere Stand (der
  // Browser hat das Ablegen ja gerade verweigert).
  if (_arbeitsspeicher.has(schluessel)) return _arbeitsspeicher.get(schluessel);
  try {
    return _ls().getItem(schluessel);
  } catch {
    return null;
  }
}

/**
 * Wert ablegen.
 * @returns {boolean} true = dauerhaft abgelegt, false = nur im Arbeitsspeicher
 *                    (haelt bis zum Neuladen).
 */
export function schreib(schluessel, wert) {
  const s = String(wert);
  try {
    _ls().setItem(schluessel, s);
    _arbeitsspeicher.delete(schluessel);
    return true;
  } catch {
    _arbeitsspeicher.set(schluessel, s);
    _nutzbar = false;
    return false;
  }
}

/** Wert loeschen — im Browser und im Ausweichlager. */
export function loesche(schluessel) {
  _arbeitsspeicher.delete(schluessel);
  try {
    _ls().removeItem(schluessel);
    return true;
  } catch {
    return false;
  }
}

/** JSON lesen; kaputter Inhalt zaehlt wie „nichts da". */
export function liesJson(schluessel, ersatz = null) {
  const roh = lies(schluessel);
  if (roh == null) return ersatz;
  try {
    const v = JSON.parse(roh);
    return v == null ? ersatz : v;
  } catch {
    return ersatz;
  }
}

/** JSON ablegen; Rueckgabe wie bei schreib(). */
export function schreibJson(schluessel, wert) {
  try {
    return schreib(schluessel, JSON.stringify(wert));
  } catch {
    return false; // nicht serialisierbar (Zyklus) — kein Grund zum Absturz
  }
}

/**
 * Alle Schluessel mit diesem Praefix (Browser + Ausweichlager, ohne Dubletten).
 * Ueber length/key statt Object.keys: das funktioniert auch, wenn der Browser
 * ein abgespecktes Speicher-Objekt herausgibt.
 */
export function schluessel(praefix = "") {
  const raus = new Set();
  for (const k of _arbeitsspeicher.keys()) if (k.startsWith(praefix)) raus.add(k);
  try {
    const s = _ls();
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(praefix)) raus.add(k);
    }
  } catch {
    /* dann eben nur das Ausweichlager */
  }
  return [...raus];
}
