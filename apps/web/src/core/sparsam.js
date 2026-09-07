// Datensparen: die App holt dann nur, was gerade gebraucht wird.
//
// Der Browser meldet eine schlechte Leitung nur manchmal (`saveData`,
// `effectiveType`) — Safari gar nicht, und im Schulnetz ist das WLAN formal
// schnell, während dreißig Geräte an einem DSL-Anschluss hängen. Deshalb gibt
// es den Schalter zusätzlich von Hand.
//
// Was er abschaltet: das Vorladen aller Seiten durch den Service-Worker
// (rund 2,7 MB beim ersten Öffnen und nach jedem Update) und den täglichen
// Datenvorrat (ein paar Dutzend Anfragen). Beides ist Vorrat für den
// Offline-Betrieb, nichts davon braucht die Seite, die gerade offen ist —
// offline steht danach weniger zur Verfügung, und genau das ist der Tausch.
const KEY = "nuvora_sparsam";
// Muss zu CACHE_NAME in public/sw.js passen: der Worker liest den Schalter
// dort, weil er an den localStorage nicht herankommt.
const SW_CACHE = "nuvora-v4";
const SW_MARKE = "/__sparsam";

export function sparsamAn() {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

export async function setzeSparsam(an) {
  try { localStorage.setItem(KEY, an ? "1" : "0"); } catch { /* egal */ }
  // Dem Worker Bescheid geben — über den Cache, nicht per Nachricht: beim
  // Installieren nach einem Update ist oft noch kein Client da, der etwas
  // schicken könnte.
  try {
    const cache = await caches.open(SW_CACHE);
    await cache.put(SW_MARKE, new Response(an ? "1" : "0"));
  } catch { /* kein Cache-API (privates Fenster): dann gilt nur der localStorage */ }
}

// Sparen wir gerade? Der Schalter von Hand ODER das, was der Browser meldet.
export function sparsamesNetz() {
  if (sparsamAn()) return true;
  const v = typeof navigator !== "undefined" ? navigator.connection : null;
  if (!v) return false;
  if (v.saveData) return true;
  return ["slow-2g", "2g", "3g"].includes(v.effectiveType || "");
}
