import { lies } from "./speicher.js";
// Offline-Outbox (Phase 1 + 2): puffert Schreibvorgaenge offline und spielt sie
// bei Verbindung automatisch nach. Kern-Garantie: keine verlorene Aenderung an
// BESTEHENDEN Daten.
//
// Phase 1: idempotente Upserts auf bestehende Entitaeten (Noten-Zelle, Override,
//   Anwesenheit, SEGEL) — mehrfach nachspielbar ohne Duplikate.
// Phase 2: offline ANLEGEN (POST) und LOESCHEN (DELETE).
//   - Anlegen bekommt eine Behelfs-ID ("tmp-…"); beim Sync vergibt der Server
//     die echte ID, und alle nachfolgenden, noch wartenden Anfragen, die die
//     Behelfs-ID referenzieren (URL oder Body), werden umgehaengt.
//   - Die Abbildung tmp→echt liegt PERSISTENT im localStorage, damit sie auch
//     ueber mehrere Sync-Laeufe haelt (falls ein abhaengiger Eintrag spaeter dran ist).
//   - Sicherung: bleibt nach dem Umhaengen eine unaufgeloeste Behelfs-ID uebrig
//     (der zugehoerige Anlege-Vorgang ist dauerhaft gescheitert), wird der
//     abhaengige Eintrag VERWORFEN (mit Warnung) statt eine kaputte ID zu senden.
//   - BESTEHENDE Daten (echte IDs) werden vom Umhaengen NIE beruehrt.

const DB = "nuvora-outbox";
const STORE = "queue";
const IDMAP_KEY = "nuvora_idmap"; // { "tmp-…": echteId }
let _db = null;
const listeners = new Set();

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}
function tx(mode) { return open().then((db) => db.transaction(STORE, mode).objectStore(STORE)); }

export function newTmp() {
  return "tmp-" + (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

// ─── Was darf offline gepuffert werden? ───
//
// Frueher stand hier eine Positivliste mit sechs Endpunkten: alles andere lief
// offline auf einen Netzwerkfehler. Das war ehrlich, aber im Unterricht falsch
// herum — wer im Keller ohne Netz eine Karte anlegt, verliert sie, und das
// merkt er erst hinterher.
//
// Jetzt gilt die Umkehrung: JEDER schreibende Aufruf unter /api wird gepuffert,
// AUSSER er steht auf der Sperrliste. Die Sperrliste ist der eigentliche
// Sicherheitsmechanismus, deshalb steht an jedem Eintrag der Grund — wer einen
// entfernt, muss ihn entkraeften koennen.
//
// Drei Arten von Gruenden, mehr gibt es nicht:
//   (a) braucht den Server JETZT (Anmeldung, Live-Sitzung) — verzoegert ist es
//       sinnlos oder falsch,
//   (b) nicht wiederholbar (Token rotieren, endgueltig loeschen, Aktionen mit
//       Seiteneffekt) — beim Nachspielen liefe es ein zweites Mal,
//   (c) kein JSON (Bilder, Dateien) — laesst sich nicht ablegen.
const SPERRE = [
  // (a) braucht den Server jetzt
  [/^\/api\/auth\//, "Anmeldung, Passwort, E-Mail-Bestaetigung"],
  [/^\/api\/modules\//, "Modul an/aus — offline umgeschaltet stuende die Oberflaeche anders als die Schranke im Server"],
  [/^\/api\/sessions/, "laufende CardVote-Sitzung — eine Abstimmung ohne Server ist keine"],
  [/^\/api\/results/, "Scan-Ergebnisse einer laufenden Sitzung"],
  [/^\/api\/codedetektiv\/sessions/, "laufende Sitzung"],
  [/^\/api\/kalender\/(subscribe|feed|external)/, "reicht nach aussen (Abo, fremder Kalender)"],
  [/^\/api\/kalender\/untis/, "holt live bei WebUntis — und der Abruf traegt ein Passwort, das nirgends liegen bleiben darf"],
  [/^\/api\/caldav/, "Geraete-Passwort: der Klartext kommt genau einmal zurueck — nachgespielt entstuende ein Passwort, das niemand sieht"],
  [/^\/api\/(selftest|mail-test)/, "Diagnose"],
  [/^\/api\/admin\//, "Betrieb"],
  [/^\/api\/backup/, "Betrieb"],
  [/^\/api\/marketplace\//, "Veroeffentlichung nach aussen"],
  // (b) nicht wiederholbar
  [/\/purge$/, "endgueltiges Loeschen — das faehrt man nicht blind nach"],
  [/\/tokens\/rotate$/, "macht jeden ausgeteilten Ausdruck tot"],
  [/\/(copy|remediate|nachholbedarf|draw|probelauf|pruefen|zurueckspielen|resync)$/, "Aktion mit Seiteneffekt, beim Nachspielen liefe sie ein zweites Mal"],
  [/\/(import|export)/, "Massenvorgang"],
  // (c) kein JSON
  [/\/(photo|upload-image)$/, "Bild"],
  [/\/image\//, "Bild"],
  [/^\/api\/material/, "Datei-Ablage"],
  // Die eingebettete Lernpfad-App bringt ihre EIGENE Warteschlange mit
  // (Temp-IDs in app.js, savePfad haengt sie um). Beide zusammen hiessen: zwei
  // Warteschlangen fuer denselben Aufruf, und beim Sync entstuende alles doppelt.
  [/^\/api\/lernpfad\//, "die Lernpfad-App puffert selbst"],
];

/** Steht der Pfad auf der Sperrliste? Liefert den Grund oder null. */
export function gesperrt(pathname) {
  for (const [muster, grund] of SPERRE) if (muster.test(pathname)) return grund;
  return null;
}

// Entscheidet, ob ein Request gefahrlos gepuffert werden darf, und WIE
// (kind: "write" idempotenter Upsert | "create" liefert neue ID | "delete").
// koerperOk: false heisst „da ist ein Koerper, aber kein JSON" (FormData, Blob).
// So etwas laesst sich nicht ablegen und beim Nachspielen nicht wiederherstellen
// — lieber ein ehrlicher Fehler als ein stiller Verlust. Ein Aufruf GANZ OHNE
// Koerper (POST /archive) ist dagegen in Ordnung.
export function classify(method, url, bodyObj, koerperOk = true) {
  const m = (method || "GET").toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(m)) return null;
  let p;
  try { p = new URL(url, location.origin).pathname; } catch { return null; }
  if (!p.startsWith("/api/")) return null;
  if (gesperrt(p)) return null;
  if (!koerperOk) return null;
  if (m === "DELETE") return "delete";
  // POST auf eine Sammlung legt an und liefert eine ID zurueck, auf die spaetere
  // Aufrufe zeigen — die braucht eine Behelfs-ID. POST auf etwas, das schon eine
  // ID IM PFAD hat, ist ein Zustandswechsel an einem bestehenden Ding
  // (archivieren, wiederherstellen, umschalten) und braucht keine.
  if (m === "POST") return /\/\d+(\/[a-z-]+)?$/.test(p) ? "write" : "create";
  return "write";
}

export function isQueueable(method, url, bodyObj) { return classify(method, url, bodyObj) !== null; }

function notify() { count().then((n) => listeners.forEach((cb) => { try { cb(n, fehler().length); } catch { /* egal */ } })); }
export function subscribe(cb) { listeners.add(cb); count().then((n) => cb(n, fehler().length)); return () => listeners.delete(cb); }

export async function count() {
  const store = await tx("readonly");
  return new Promise((resolve) => { const r = store.count(); r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(0); });
}

// method, url, bodyObj(Objekt|null), opts:{ kind, tmp }
export async function enqueue(method, url, bodyObj, opts = {}) {
  const store = await tx("readwrite");
  await new Promise((resolve, reject) => {
    const r = store.add({ method, url, body: bodyObj || null, kind: opts.kind || "write", tmp: opts.tmp || null, ts: Date.now() });
    r.onsuccess = resolve; r.onerror = () => reject(r.error);
  });
  notify();
}

async function all() {
  const store = await tx("readonly");
  return new Promise((resolve) => { const r = store.getAll(); r.onsuccess = () => resolve(r.result || []); r.onerror = () => resolve([]); });
}
async function remove(id) {
  const store = await tx("readwrite");
  return new Promise((resolve) => { const r = store.delete(id); r.onsuccess = resolve; r.onerror = resolve; });
}

// ─── Was NICHT nachgespielt werden konnte ───
//
// Solange nur sechs harmlose Endpunkte gepuffert wurden, war ein verworfener
// Eintrag ein Randfall. Jetzt kann es jede Aenderung sein — und eine Aenderung,
// die der Server beim Nachspielen ablehnt (die Klasse wurde inzwischen
// geloescht, jemand anders hat dieselbe Zeile geaendert), darf nicht still
// verschwinden. Sie landet hier und wird angezeigt, bis jemand sie wegklickt.
const FEHLER_KEY = "nuvora_outbox_fehler";
const MAX_FEHLER = 50;

export function fehler() {
  try { return JSON.parse(localStorage.getItem(FEHLER_KEY) || "[]"); } catch { return []; }
}
export function fehlerLeeren() {
  try { localStorage.removeItem(FEHLER_KEY); } catch { /* egal */ }
  notify();
}
function fehlerMerken(eintrag, grund) {
  try {
    const liste = fehler();
    liste.push({ method: eintrag.method, url: eintrag.url, grund, ts: Date.now() });
    localStorage.setItem(FEHLER_KEY, JSON.stringify(liste.slice(-MAX_FEHLER)));
  } catch { /* voll? dann eben nur die Konsole */ }
  console.warn("Outbox: verworfen", grund, eintrag.method, eintrag.url);
}

function loadMap() { try { return JSON.parse(localStorage.getItem(IDMAP_KEY) || "{}"); } catch { return {}; } }
function saveMap(m) { try { localStorage.setItem(IDMAP_KEY, JSON.stringify(m)); } catch { /* voll? egal */ } }

// Behelfs-IDs in einer URL durch echte ersetzen; meldet, ob noch eine uebrig ist.
function remapUrl(url, map) {
  let out = url, rest = false;
  out = out.replace(/tmp-[\w-]+/g, (t) => (t in map ? String(map[t]) : (rest = true, t)));
  return [out, rest];
}
// Behelfs-IDs tief im Body ersetzen (String-Werte, die eine tmp-ID sind → Zahl).
function remapBody(obj, map) {
  let rest = false;
  const walk = (v) => {
    if (typeof v === "string" && /^tmp-/.test(v)) { if (v in map) return map[v]; rest = true; return v; }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v)) o[k] = walk(v[k]); return o; }
    return v;
  };
  const out = obj ? walk(obj) : obj;
  return [out, rest];
}

let _flushing = false;

export async function flush(rawFetch) {
  if (_flushing) return;
  _flushing = true;
  const doFetch = rawFetch || window.fetch;
  const map = loadMap();
  try {
    const items = (await all()).sort((a, b) => a.id - b.id);
    for (const it of items) {
      const [url, urlRest] = remapUrl(it.url, map);
      const [body, bodyRest] = remapBody(it.body, map);
      if (urlRest || bodyRest) {
        // Unaufgeloeste Behelfs-ID → zugehoeriger Anlege-Vorgang ist gescheitert.
        // Verwerfen statt eine kaputte ID zu senden (keine Korruption Bestehender Daten).
        fehlerMerken(it, "verwaiste Behelfs-ID (das Anlegen davor ist gescheitert)");
        await remove(it.id); notify(); continue;
      }
      let res;
      try {
        const headers = { "Content-Type": "application/json" };
        const token = lies("token");   // ueber speicher.js, siehe dort
        if (token) headers["Authorization"] = `Bearer ${token}`;
        res = await doFetch(url, { method: it.method, headers, body: body != null ? JSON.stringify(body) : undefined });
      } catch {
        break; // weiter offline → Reihenfolge wahren, spaeter erneut
      }
      if (res.ok) {
        if (it.kind === "create" && it.tmp) {
          const j = await res.json().catch(() => ({}));
          if (j && j.id != null) { map[it.tmp] = j.id; saveMap(map); }
        }
        await remove(it.id); notify(); continue;
      }
      if (res.status >= 400 && res.status < 500) {
        fehlerMerken(it, `Server: HTTP ${res.status}`);
        await remove(it.id); notify(); continue;
      }
      break; // 5xx → Server hakt, spaeter erneut
    }
  } finally {
    _flushing = false;
  }
}
