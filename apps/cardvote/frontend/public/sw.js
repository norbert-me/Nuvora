const CACHE_NAME = "cardvote-v1";
const STATIC_ASSETS = ["/", "/index.html"];
const API_CACHE = "cardvote-api-v1";
const CACHEABLE_API = ["/api/classes", "/api/folders", "/api/sessions/active"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== API_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API requests: network-first, cache fallback
  if (url.pathname.startsWith("/api/")) {
    const shouldCache =
      event.request.method === "GET" &&
      (CACHEABLE_API.some((p) => url.pathname.startsWith(p)) ||
        url.pathname.match(/^\/api\/sessions\/\d+$/) ||
        url.pathname.match(/^\/api\/question-sets\/\d+$/) ||
        url.pathname.match(/^\/api\/classes\/\d+$/));

    if (shouldCache) {
      event.respondWith(
        fetch(event.request)
          .then((res) => {
            const clone = res.clone();
            caches.open(API_CACHE).then((c) => c.put(event.request, clone));
            return res;
          })
          .catch(() => caches.match(event.request))
      );
      return;
    }
    // Non-cacheable API: network only
    return;
  }

  // Navigation (HTML) und "/": IMMER netzwerk-first, sonst bleiben Deploys fuer
  // wiederkehrende Nutzende dauerhaft unsichtbar (index.html verweist auf neue
  // Asset-Dateinamen; ein gecachtes altes index.html wuerde sie nie laden).
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

  // Übrige statische Assets (JS/CSS mit Content-Hash im Dateinamen): cache-first ist
  // sicher, da sich der Inhalt unter demselben Dateinamen nie aendert.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res.ok && (url.pathname.endsWith(".js") || url.pathname.endsWith(".css"))) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        }
        return res;
      });
    })
  );
});
