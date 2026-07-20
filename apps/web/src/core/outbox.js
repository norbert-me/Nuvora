// Offline-Outbox (Phase 1): puffert Schreibvorgaenge, wenn kein Netz da ist, und
// spielt sie bei Verbindung automatisch nach. Kern-Garantie: keine verlorene
// Aenderung.
//
// BEWUSST ENG: nur idempotente Writes auf BESTEHENDE Entitaeten (Upserts) —
// keine Neuanlagen mit Behelfs-IDs (die muessten beim Sync umgehaengt werden,
// da verliert ein halbfertiger Sync stillschweigend Daten). Backend-seitig sind
// die vier hier gewhitelisteten Endpunkte Upserts, also mehrfach-nachspielbar
// ohne Duplikate.
//
// Der Token wird NICHT mitgespeichert (koennte ablaufen) — beim Nachspielen
// kommt der aktuelle aus dem localStorage frisch dran.

const DB = "nuvora-outbox";
const STORE = "queue";
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

// Entscheidet, ob ein Write gefahrlos gepuffert werden darf. Nur Upserts auf
// Bestehendes; Beobachtungen (kind != "grade") NICHT (die duerfen mehrfach sein
// -> Nachspielen wuerde duplizieren).
export function isQueueable(method, url, bodyObj) {
  const m = (method || "GET").toUpperCase();
  if (m !== "PUT" && m !== "POST") return false;
  try {
    const p = new URL(url, location.origin).pathname;
    if (p.endsWith("/noten/entries")) return !!bodyObj && bodyObj.kind === "grade";
    if (p.endsWith("/noten/overrides")) return true;
    if (p.startsWith("/api/anwesenheit/")) return true;
    if (p.startsWith("/api/sitzplan/") && p.endsWith("/segel")) return true;
  } catch { /* ungueltige URL */ }
  return false;
}

function notify() {
  count().then((n) => listeners.forEach((cb) => { try { cb(n); } catch { /* egal */ } }));
}

export function subscribe(cb) { listeners.add(cb); count().then(cb); return () => listeners.delete(cb); }

export async function count() {
  const store = await tx("readonly");
  return new Promise((resolve) => { const r = store.count(); r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(0); });
}

export async function enqueue(method, url, body) {
  const store = await tx("readwrite");
  await new Promise((resolve, reject) => {
    const r = store.add({ method, url, body: body || null, ts: Date.now() });
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

let _flushing = false;

// Spielt die Warteschlange in Reihenfolge nach. Erfolg (2xx) -> Eintrag weg.
// 4xx (Server lehnt dauerhaft ab, z.B. Validierung) -> Eintrag weg + Warnung
// (sonst blockierte er die Queue ewig). 5xx/Netzfehler -> abbrechen, spaeter
// erneut. Nutzt den Original-fetch, nicht den gepatchten (sonst Endlosschleife).
export async function flush(rawFetch) {
  if (_flushing) return;
  _flushing = true;
  const doFetch = rawFetch || window.fetch;
  try {
    const items = (await all()).sort((a, b) => a.id - b.id);
    for (const it of items) {
      const headers = { "Content-Type": "application/json" };
      const token = localStorage.getItem("token");
      if (token) headers["Authorization"] = `Bearer ${token}`;
      let res;
      try {
        res = await doFetch(it.url, { method: it.method, headers, body: it.body });
      } catch {
        break; // weiterhin offline -> spaeter erneut, Reihenfolge wahren
      }
      if (res.ok) { await remove(it.id); notify(); continue; }
      if (res.status >= 400 && res.status < 500) {
        console.warn("Outbox: verworfen (dauerhafter Fehler)", it.method, it.url, res.status);
        await remove(it.id); notify(); continue;
      }
      break; // 5xx -> Server hakt, spaeter erneut
    }
  } finally {
    _flushing = false;
  }
}
