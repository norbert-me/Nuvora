// Stale-while-revalidate fuer selten wechselnde GET-Daten (Klassen, Themen …).
//
// Idee: den zuletzt gesehenen Stand in localStorage halten und beim naechsten
// Seitenaufruf SOFORT anzeigen — die Seite wirkt instant. Parallel wird im
// Hintergrund neu geladen; nur wenn sich die Daten wirklich geaendert haben,
// wird der Callback ein zweites Mal (mit den frischen Daten) aufgerufen und die
// Ansicht aktualisiert.
//
// Zusaetzlich wird pro Eintrag ein ETag gespeichert und beim Revalidieren als
// If-None-Match mitgeschickt. Hat sich nichts geaendert, antwortet der Server
// mit 304 (kein Body) — der Hintergrund-Refresh kostet dann praktisch keine
// Bytes mehr.

const PREFIX = "nuvora_cache_";

// Gespeichert wird { d: <daten>, e: <etag|null> }. Alte reine Arrays werden noch
// gelesen (als Daten ohne ETag), damit ein Update nichts wegwirft.
function readEntry(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "d" in parsed) return parsed;
    return { d: parsed, e: null };
  } catch { return null; }
}
function writeEntry(key, d, e) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify({ d, e: e || null })); } catch { /* Quota/Privatmodus: egal */ }
}

/**
 * @param {string}   key     eindeutiger Cache-Schluessel (z.B. "classes")
 * @param {string}   url     GET-URL, liefert JSON
 * @param {function} onData  (data, fromCache) => void — ggf. zweimal aufgerufen
 * @returns {function} Abbruch: verhindert das Setzen nach Unmount
 */
export function swr(key, url, onData) {
  let alive = true;
  const entry = readEntry(key);
  if (entry && entry.d != null) onData(entry.d, true);

  fetch(url, entry && entry.e ? { headers: { "If-None-Match": entry.e } } : undefined)
    .then((r) => {
      if (r.status === 304) return null;        // unveraendert: Cache bleibt stehen
      if (!r.ok) return null;
      const etag = r.headers.get("etag");
      return r.json().then((data) => ({ data, etag }));
    })
    .then((res) => {
      if (!alive || res == null || res.data == null) return;
      const changed = entry == null || JSON.stringify(res.data) !== JSON.stringify(entry.d);
      if (changed) {
        writeEntry(key, res.data, res.etag);
        onData(res.data, false);
      } else if (res.etag && res.etag !== (entry && entry.e)) {
        writeEntry(key, entry.d, res.etag); // gleiche Daten, nur ETag nachtragen
      }
    })
    .catch(() => { /* offline: der Cache-Stand bleibt stehen */ });

  return () => { alive = false; };
}

/** Cache gezielt verwerfen (z.B. nach dem Bearbeiten von Klassen/Themen). */
export function bust(key) {
  try { localStorage.removeItem(PREFIX + key); } catch { /* egal */ }
}

/** Gecachten Stand lesen, ohne zu laden (fuer sofortiges Erst-Rendern). */
export function peek(key) { const e = readEntry(key); return e ? e.d : null; }

/** Frischen Stand in den Cache schreiben (z.B. nach einer eigenen Mutation). */
export function put(key, data) { writeEntry(key, data, null); }

// Zuletzt gewaehlte Klasse — modulübergreifend gemerkt, damit die Auswahl beim
// Zurueckkommen (oder Seitenwechsel) nicht auf die erste Klasse zurueckspringt.
const CLASS_KEY = "nuvora_selected_class";
export function lastClass() {
  try { const v = Number(localStorage.getItem(CLASS_KEY)); return v || null; } catch { return null; }
}
export function rememberClass(id) {
  try { if (id) localStorage.setItem(CLASS_KEY, String(id)); } catch { /* egal */ }
}
