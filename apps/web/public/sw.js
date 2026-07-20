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
  if (url.pathname.includes("/qr/")) return false;          // QR-PNGs
  return true;
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== API_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
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
          .catch(() => caches.match(event.request).then((c) => c || Response.error()))
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
        .catch(() => caches.match(event.request))
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
