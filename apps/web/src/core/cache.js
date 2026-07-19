// Stale-while-revalidate fuer selten wechselnde GET-Daten (Klassen, Themen …).
//
// Idee: den zuletzt gesehenen Stand in localStorage halten und beim naechsten
// Seitenaufruf SOFORT anzeigen — die Seite wirkt instant. Parallel wird im
// Hintergrund neu geladen; nur wenn sich die Daten wirklich geaendert haben,
// wird der Callback ein zweites Mal (mit den frischen Daten) aufgerufen und die
// Ansicht aktualisiert. So faellt der wahrgenommene Ladebalken weg, ohne dass
// veraltete Daten haengen bleiben.

const PREFIX = "nuvora_cache_";

function read(key) {
  try { const raw = localStorage.getItem(PREFIX + key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function write(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* Quota/Privatmodus: egal */ }
}

/**
 * @param {string}   key     eindeutiger Cache-Schluessel (z.B. "classes")
 * @param {string}   url     GET-URL, liefert JSON
 * @param {function} onData  (data, fromCache) => void — ggf. zweimal aufgerufen
 * @returns {function} Abbruch: verhindert das Setzen nach Unmount
 */
export function swr(key, url, onData) {
  let alive = true;
  const cached = read(key);
  if (cached != null) onData(cached, true);

  fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!alive || data == null) return;
      const next = JSON.stringify(data);
      const prev = JSON.stringify(cached);
      // Nur re-rendern, wenn es beim ersten Mal keinen Cache gab ODER sich der
      // Inhalt geaendert hat — sonst bleibt die instant gezeigte Ansicht stehen.
      if (cached == null || next !== prev) {
        write(key, data);
        onData(data, false);
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
export function peek(key) { return read(key); }

/** Frischen Stand in den Cache schreiben (z.B. nach einer eigenen Mutation). */
export function put(key, data) { write(key, data); }
