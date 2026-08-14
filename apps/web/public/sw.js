// Nuvora Service-Worker.
//
// Ziel: die App als installierte PWA nutzbar halten, auch offline — READ-ONLY.
// Online ist der Server immer autoritativ (network-first); der Cache ist nur
// die Rückfallebene, wenn kein Netz da ist. SCHREIBEN geht offline NICHT
// (Nicht-GET-Anfragen laufen netzwerk-only) — dafür bräuchte es eine Sync-/
// Konflikt-Schicht, die es (noch) nicht gibt.
const CACHE_NAME = "nuvora-v2";
const API_CACHE = "nuvora-api-v2";
const STATIC_ASSETS = ["/", "/index.html"];

// Diese GET-API-Antworten NICHT cachen: Binärdownloads (groß), reine
// Aktions-/Diagnose-Endpunkte. Alles andere unter /api/ wird als Offline-
// Rückfall gecacht, damit einmal geladene Daten offline lesbar bleiben.
function apiCacheable(url, method) {
  if (method !== "GET" || !url.pathname.startsWith("/api/")) return false;
  if (url.pathname.endsWith("/download")) return false;     // Material-/Datei-Blobs
  if (url.pathname.startsWith("/api/mail-test")) return false;
  if (url.pathname === "/api/health") return false;         // Live-Connectivity-Probe: netzwerk-only,
                                                            // sonst liefert der Cache-Fallback Response.error()
                                                            // ("access control checks") und faelscht offline vor.
  if (url.pathname.includes("/qr/")) return false;          // QR-PNGs
  return true;
}

// Eine Antwort aus dem Zwischenspeicher als solche kennzeichnen.
//
// Warum: sie kommt als HTTP 200 in der Shell an, ununterscheidbar von einer
// echten Antwort vom Server. Der fetch-Interceptor in main.jsx hat daraus
// "Server erreichbar" geschlossen und den Offline-Balken wieder ausgeblendet —
// mitten im Offline-Betrieb, kaum dass die Verbindungsprobe ihn gesetzt hatte.
// Die Lehrkraft sah damit alte Daten ohne jeden Hinweis. Kopfzeilen einer
// Antwort sind unveraenderlich, deshalb eine neue Antwort mit demselben Rumpf.
function ausCache(res) {
  if (!res) return res;
  const kopfe = new Headers(res.headers);
  kopfe.set("X-Nuvora-Cache", "hit");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: kopfe });
}

// Vite haengt an jeden Chunk einen Inhalts-Hash: "Kalender-a1b2c3.js". Nach
// einem Deploy heisst dieselbe Seite anders, und die alte Datei blieb bisher
// fuer immer im Cache liegen — der wuchs mit jedem Deploy um das ganze Bundle.
// Der Grundname ohne Hash sagt, welche Eintraege dasselbe meinen.
function assetBase(pathname) {
  const file = pathname.slice(pathname.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  if (dot < 0) return file;
  return file.slice(0, dot).replace(/-[A-Za-z0-9_-]{8,}$/, "") + file.slice(dot);
}

// Von jedem Grundnamen nur den juengsten Eintrag behalten. cache.keys() liefert
// die Eintraege in Einfuegereihenfolge, also steht der zuletzt geladene hinten.
async function pruneOldAssets() {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  const newest = new Map();
  for (const req of keys) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/assets/")) continue; // "/" und index.html nie wegwerfen
    newest.set(assetBase(url.pathname), req);
  }
  const keep = new Set([...newest.values()]);
  await Promise.all(keys
    .filter((req) => new URL(req.url).pathname.startsWith("/assets/") && !keep.has(req))
    .map((req) => cache.delete(req)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  // Bewusst KEIN skipWaiting: die offene Seite laeuft mit ihren alten, jetzt
  // vom Server geloeschten Chunk-Dateien weiter. Wuerde der neue Worker sofort
  // uebernehmen und aufraeumen, liefe ein spaeter nachgeladener Seitenchunk ins
  // Leere. Der Nutzer entscheidet ueber die Hinweisleiste, wann umgeschaltet wird.
});

// Zuruf aus der Update-Leiste (main.jsx): jetzt umschalten, die Seite laedt neu.
// Herkunft wird geprueft, bevor irgendetwas passiert: nur Seiten dieser Origin
// duerfen den Worker steuern. (navigator.serviceWorker ist ohnehin an die Origin
// gebunden, fremde Seiten kommen also gar nicht an diesen Worker heran — die
// Pruefung haelt das fest, damit es beim naechsten Handler-Typ nicht kippt.
// Der Lernpfad wird zwar per postMessage angesprochen, aber das ist
// window.postMessage in der Seite, nicht der Service-Worker — unberuehrt.)
self.addEventListener("message", (event) => {
  // event.origin ist bei Client-Nachrichten gesetzt; falls nicht, sagt die URL
  // des absendenden Clients dasselbe. Kein Treffer -> ignorieren.
  let herkunft = event.origin || "";
  if (!herkunft && event.source && event.source.url) {
    try { herkunft = new URL(event.source.url).origin; } catch { herkunft = ""; }
  }
  // Leer bleibt erlaubt: nicht jeder Browser setzt beides. Ein Fremdzugriff ist
  // damit nicht moeglich (der Worker gehoert der Origin), aber ein stiller
  // Abbruch waere teuer — dann kaeme das Update nie an.
  if (herkunft && herkunft !== self.location.origin) return;
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== API_CACHE).map((k) => caches.delete(k)));
    await pruneOldAssets();
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API: network-first (Server bleibt autoritativ), Cache nur als Offline-Fallback.
  if (url.pathname.startsWith("/api/")) {
    if (apiCacheable(url, event.request.method)) {
      event.respondWith(
        fetch(event.request)
          .then((res) => {
            if (res.ok) {
              const clone = res.clone();
              caches.open(API_CACHE).then((c) => c.put(event.request, clone));
            }
            return res;
          })
          .catch(() => caches.match(event.request).then((c) => (c ? ausCache(c) : Response.error())))
      );
      return;
    }
    // Schreiben/Diagnose/Downloads: netzwerk-only.
    return;
  }

  // Navigation (HTML) und "/": IMMER netzwerk-first, sonst bleiben Deploys für
  // wiederkehrende Nutzende dauerhaft unsichtbar (index.html verweist auf neue
  // Asset-Dateinamen; ein gecachtes altes index.html würde sie nie laden).
  const isNavigation = event.request.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith(".html");
  if (isNavigation) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          }
          return res;
        })
        // Offline: erst die genaue Adresse aus dem Cache, sonst die Shell.
        // Ohne den zweiten Schritt lief jede Adresse, die online nie besucht
        // wurde (Deep-Link auf /cardvote o.ae.), in respondWith(undefined) und
        // damit in einen Netzwerkfehler — weisses Fenster statt App. Nuvora ist
        // eine SPA: index.html kann jede Route rendern, das Routing macht der
        // Client. Cache-Schluessel der Shell ist "/index.html" (STATIC_ASSETS).
        .catch(() => caches.match(event.request).then((r) => r || caches.match("/index.html")))
    );
    return;
  }

  // Übrige statische Assets (JS/CSS/Bilder mit Content-Hash im Dateinamen):
  // cache-first ist sicher, da sich der Inhalt unter demselben Namen nie ändert.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res.ok && (url.pathname.endsWith(".js") || url.pathname.endsWith(".css") ||
                       url.pathname.match(/\.(png|jpg|jpeg|svg|webp|woff2?)$/))) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        }
        return res;
      });
    })
  );
});
