// Nuvora Service-Worker.
//
// Ziel: die App als installierte PWA nutzbar halten, auch offline — READ-ONLY.
// Online ist der Server immer autoritativ (network-first); der Cache ist nur
// die Rückfallebene, wenn kein Netz da ist. SCHREIBEN geht offline NICHT
// (Nicht-GET-Anfragen laufen netzwerk-only) — dafür bräuchte es eine Sync-/
// Konflikt-Schicht, die es (noch) nicht gibt.
const CACHE_NAME = "nuvora-v4";
const API_CACHE = "nuvora-api-v4";
const STATIC_ASSETS = ["/", "/index.html", "/manifest.json", "/favicon.svg", "/icon-192.png", "/icon-512.png"];

// Die Lernpfad-App liegt als Statik daneben und wird von LernpfadModule.jsx
// nachgeladen — sie steckt in keinem Vite-Bundle und stuende deshalb in
// precache.json nicht drin.
const LERNPFAD_ASSETS = ["/lp/index.html", "/lp/style.scoped.css", "/lp/js/app.js"];

// Wie gut ist die Leitung? Im Schulnetz haengen dreissig Geraete an einem
// DSL-Anschluss, und dann ist „alle Seiten sofort holen" kein Dienst mehr,
// sondern der Grund, warum die erste Seite zwei Minuten braucht. Auf einer
// langsamen oder ausdruecklich sparsamen Verbindung wird deshalb nur die
// Huelle vorgeladen; alles andere kommt beim Aufrufen und landet dabei
// genauso im Cache. Das Offline-Versprechen bleibt — es erfuellt sich dann
// eben nach und nach statt in einem Zug.
async function langsameLeitung(cache) {
  // Der Schalter von Hand (Profil) liegt im Cache — an den localStorage kommt
  // ein Worker nicht heran, und beim Installieren nach einem Update ist oft
  // noch kein Client da, der ihn schicken koennte (core/sparsam.js).
  try {
    const marke = await cache.match("/__sparsam");
    if (marke && (await marke.text()) === "1") return true;
  } catch { /* kein Cache-Eintrag: dann entscheidet die Messung */ }
  const v = self.navigator && self.navigator.connection;
  if (!v) return false;                       // Safari kennt das nicht: wie bisher
  if (v.saveData) return true;                // „Datensparmodus" ist eine Ansage
  return ["slow-2g", "2g", "3g"].includes(v.effectiveType || "");
}

// Alle Seiten beim ERSTEN Oeffnen holen, nicht erst beim ersten Besuch.
//
// Jede Route liegt in einem eigenen Chunk (React.lazy). Wer die App einmal
// oeffnete und dann offline ging, hatte nur die Seiten, die er vorher
// angeklickt hatte; alle anderen liefen ins Leere. Die Namen der Chunks
// erzeugt der Build in /precache.json (siehe vite.config.js).
//
// Einzeln statt cache.addAll: addAll bricht komplett ab, sobald EINE Datei
// nicht kommt — dann waere der Worker gar nicht installiert und die App auch
// online gestoert. Hier darf jede Datei fuer sich scheitern.
async function alleSeitenVorladen(cache) {
  let liste = [];
  try {
    const res = await fetch("/precache.json", { cache: "no-cache" });
    if (res.ok) liste = await res.json();
  } catch { /* kein Netz beim Installieren: dann eben beim naechsten Mal */ }
  const alles = [...liste, ...LERNPFAD_ASSETS];
  await Promise.allSettled(alles.map(async (pfad) => {
    const treffer = await cache.match(pfad);
    if (treffer) return;                       // schon da (Deploy aendert nur die neuen Namen)
    const res = await fetch(pfad, { cache: "no-cache" });
    if (res.ok) await cache.put(pfad, res);
  }));
}

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

// Wie lange auf den Server gewartet wird, bevor der Zwischenspeicher antwortet.
//
// Der Anlass ist nicht „offline", sondern SCHLECHTES Netz: im Schulnetz
// antwortet der Server manchmal erst nach zehn Sekunden oder gar nicht, ohne
// dass der Browser einen Fehler wirft. Network-first hiess dann: die Seite
// wartet, die Liste bleibt leer, und die Lehrkraft sieht „keine Aufgaben" statt
// der Aufgaben, die sie vor zwei Minuten noch hatte. Nach dem Zeitlimit
// antwortet der Cache (als solcher gekennzeichnet, siehe ausCache) — die echte
// Antwort laeuft weiter und aktualisiert den Cache im Hintergrund fuer den
// naechsten Aufruf.
//
// 3,5 Sekunden: lang genug, dass eine normale Antwort (ein paar Dutzend
// Millisekunden) nie in die Naehe kommt, kurz genug, dass niemand davor sitzt
// und wartet. Ohne Cache-Eintrag wird weiter regulaer gewartet — eine leere
// Antwort waere schlechter als eine langsame.
const API_WARTEN_MS = 3500;

async function apiAntwort(request) {
  const cache = await caches.open(API_CACHE);
  const gecacht = await cache.match(request);
  const netz = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  });
  if (!gecacht) {
    // Nichts im Vorrat: warten, bis der Server antwortet — und wenn er gar
    // nicht antwortet, den ehrlichen Fehler durchreichen.
    return netz.catch(() => Response.error());
  }
  // Wettlauf: der Server, oder nach dem Zeitlimit der Vorrat. `netz` laeuft in
  // beiden Faellen zu Ende und schreibt den Cache fort (die Ablehnung wird
  // abgefangen, sonst meldet der Browser einen unbehandelten Fehler).
  netz.catch(() => {});
  const bremse = new Promise((fertig) => setTimeout(() => fertig(null), API_WARTEN_MS));
  const zuerst = await Promise.race([netz.catch(() => null), bremse]);
  if (zuerst) return zuerst;
  return ausCache(gecacht);
}

// Seiten (HTML) und die Lernpfad-Statik: netzwerk-first MIT Zeitlimit.
//
// Vorher antwortete der Vorrat nur, wenn der Abruf mit einem FEHLER endete. Bei einer kurzen
// Unterbrechung des Internets (WLAN steht, die Leitung dahinter nicht) kommt aber gar kein
// Fehler: die Anfrage haengt, bis der Browser nach einer halben Minute aufgibt — und so lange
// oeffnete sich die Seite nicht, obwohl die ganze Huelle im Cache lag. Jetzt antwortet nach
// SEITEN_WARTEN_MS der Vorrat (die genaue Seite, sonst die Huelle), waehrend der Abruf im
// Hintergrund weiterlaeuft und den Cache fuer den naechsten Aufruf auffrischt. Ohne Vorrat wird
// regulaer gewartet — eine weisse Seite waere schlechter als eine langsame.
const SEITEN_WARTEN_MS = 3000;

async function seitenAntwort(request, mitHuelle) {
  const cache = await caches.open(CACHE_NAME);
  const netz = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  });
  netz.catch(() => {});            // laeuft auch nach dem Zeitlimit zu Ende; die Ablehnung ist erwartet
  const vorrat = async () => (await cache.match(request)) || (mitHuelle ? await cache.match("/index.html") : undefined);
  // Der Browser weiss es schon: ohne Verbindung gar nicht erst warten.
  if (self.navigator && self.navigator.onLine === false) {
    const alt = await vorrat();
    if (alt) return alt;
    return netz;
  }
  const bremse = new Promise((fertig) => setTimeout(() => fertig(null), SEITEN_WARTEN_MS));
  try {
    const zuerst = await Promise.race([netz, bremse]);
    if (zuerst) return zuerst;
  } catch { /* Netzfehler: unten der Vorrat */ }
  const alt = await vorrat();
  if (alt) return alt;
  return netz;                     // kein Vorrat: den Abruf zu Ende warten (oder ehrlich scheitern lassen)
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Die Huelle muss da sein, sonst ist die App offline gar nicht da —
    // deshalb hier addAll (scheitert eine, ist die Installation zu Recht rot).
    await cache.addAll(STATIC_ASSETS);
    if (!(await langsameLeitung(cache))) await alleSeitenVorladen(cache);
  })());
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

  // API: network-first (Server bleibt autoritativ), Cache als Rueckfall.
  if (url.pathname.startsWith("/api/")) {
    if (apiCacheable(url, event.request.method)) {
      event.respondWith(apiAntwort(event.request));
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
    // Offline oder zu langsam: erst die genaue Adresse aus dem Cache, sonst die Shell. Nuvora ist
    // eine SPA — index.html kann jede Route rendern, das Routing macht der Client (Cache-Schluessel
    // der Shell ist "/index.html", siehe STATIC_ASSETS). Ohne die Rueckfallstufe lief jede online nie
    // besuchte Adresse (Deep-Link auf /cardvote o.ae.) in ein weisses Fenster.
    event.respondWith(seitenAntwort(event.request, true));
    return;
  }

  // Die Lernpfad-Statik traegt KEINEN Hash im Namen (/lp/js/app.js,
  // /lp/style.scoped.css) — cache-first hiess dort: nach einem Deploy bleibt
  // die alte Fassung liegen, bis der Cache-Name wechselt. Genau daran sah eine
  // frisch ausgelieferte Aenderung im Lernpfad "gleich aus". Also
  // netzwerk-first mit Cache als Offline-Rueckfall, wie bei der Navigation.
  if (url.pathname.startsWith("/lp/")) {
    event.respondWith(seitenAntwort(event.request, false));
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
