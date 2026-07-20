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

// Entscheidet, ob ein Request gefahrlos gepuffert werden darf, und WIE
// (kind: "write" idempotenter Upsert | "create" liefert neue ID | "delete").
// Nur diese Faelle — sonst laeuft der Request wie bisher offline auf Fehler.
export function classify(method, url, bodyObj) {
  const m = (method || "GET").toUpperCase();
  let p;
  try { p = new URL(url, location.origin).pathname; } catch { return null; }

  // Phase 1 — idempotente Upserts auf Bestehendes:
  if (m === "POST" && p.endsWith("/noten/entries")) return bodyObj && bodyObj.kind === "grade" ? "write" : null;
  if (m === "PUT" && p.endsWith("/noten/overrides")) return "write";
  if (m === "PUT" && p.startsWith("/api/anwesenheit/")) return "write";
  if (m === "PUT" && p.startsWith("/api/sitzplan/") && p.endsWith("/segel")) return "write";
  if (m === "PUT" && /\/noten\/categories\/\d+$/.test(p)) return "write"; // Spalte umbenennen (echte ID)

  // Phase 2 — anlegen (liefert ID) / loeschen:
  if (m === "POST" && /\/noten\/classes\/\d+\/sections$/.test(p)) return "create";
  if (m === "POST" && p.endsWith("/noten/categories")) return "create";
  if (m === "DELETE" && (/\/noten\/categories\/\d+$/.test(p) || /\/noten\/sections\/\d+$/.test(p))) return "delete";
  return null;
}

export function isQueueable(method, url, bodyObj) { return classify(method, url, bodyObj) !== null; }

function notify() { count().then((n) => listeners.forEach((cb) => { try { cb(n); } catch { /* egal */ } })); }
export function subscribe(cb) { listeners.add(cb); count().then(cb); return () => listeners.delete(cb); }

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
        console.warn("Outbox: verworfen (verwaiste Behelfs-ID)", it.method, it.url);
        await remove(it.id); notify(); continue;
      }
      let res;
      try {
        const headers = { "Content-Type": "application/json" };
        const token = localStorage.getItem("token");
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
        console.warn("Outbox: verworfen (dauerhafter Fehler)", it.method, url, res.status);
        await remove(it.id); notify(); continue;
      }
      break; // 5xx → Server hakt, spaeter erneut
    }
  } finally {
    _flushing = false;
  }
}
