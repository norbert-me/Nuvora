// Was hat die Anwendung zuletzt getan? — ein Ringpuffer im Browser.
//
// Der Grund ist die Fehlermeldung: „geht nicht" ist keine Meldung, mit der
// jemand etwas anfangen kann. Was fehlt, ist der Weg dorthin — welche Seite,
// welcher Aufruf, welcher Fehler. Genau das sammelt diese Datei mit, damit es
// der Meldung beiliegen kann, ohne dass jemand es abtippt.
//
// ─── Was hier NICHT hineindarf ───
//
// Nuvora verwaltet besonders schützenswerte Daten (Förderschwerpunkte,
// Maßnahmen, Notizen — DSGVO Art. 9). Ein Protokoll, das Antwortkörper oder
// Formularinhalte mitschreibt, wäre eine zweite Kopie davon — im Browser und
// später im Postfach des Betreibers. Deshalb gilt hier hart:
//
//   • KEINE Antwortkörper, KEINE Anfragekörper, KEINE Formularwerte.
//   • Von einem Aufruf nur: Methode, Pfad, Status, Dauer.
//   • Aus dem Pfad werden Zahlen zu „…/{id}" — sonst stünde im Protokoll,
//     welche Klasse und welches Kind angesehen wurde.
//   • Fehlertexte werden gekürzt; ein Stacktrace gehört nicht dazu (er nennt
//     nur Dateinamen aus dem Bundle und macht die Meldung unlesbar).
//
// Alles bleibt im Arbeitsspeicher: kein localStorage, keine Übertragung — außer
// jemand schickt ausdrücklich eine Fehlermeldung ab und sieht vorher, was
// mitgeht.

// Der Puffer war mit 60 Eintraegen zu kurz: ein Fehler entsteht oft drei
// Seitenwechsel frueher, und genau die fehlten dann in der Meldung. 200 Zeilen
// sind eine lesbare Mail und immer noch nichts fuer den Arbeitsspeicher.
const MAX = 200;
const TEXT_MAX = 400;   // abgeschnittene Fehlertexte enden mitten im Hinweis
// Langsame Aufrufe sind ein Befund fuer sich ("die Seite haengt"), auch wenn
// sie am Ende 200 liefern. Alles darunter bleibt Rauschen.
const LANGSAM_MS = 2000;

const eintraege = [];
const hoerer = new Set();

/** Zahlen im Pfad ersetzen: /api/classes/12/students/7 -> /api/classes/{id}/students/{id} */
function anonym(pfad) {
  return String(pfad).split("?")[0].replace(/\/\d+(?=\/|$)/g, "/{id}")
    // Tokens und Codes sind lang und zufällig — auch die haben hier nichts zu suchen.
    .replace(/\/[A-Za-z0-9_-]{16,}(?=\/|$)/g, "/{token}");
}

function melde() {
  hoerer.forEach((fn) => { try { fn(eintraege.length); } catch { /* egal */ } });
}

/**
 * Einen Eintrag anhängen.
 * @param {"seite"|"aufruf"|"fehler"} art
 * @param {string} text  bereits gekürzt und ohne Inhalte
 */
export function notiere(art, text) {
  eintraege.push({ art, text: String(text).slice(0, TEXT_MAX), zeit: Date.now() });
  if (eintraege.length > MAX) eintraege.shift();
  melde();
}

export function protokoll() {
  return [...eintraege];
}

export function leeren() {
  eintraege.length = 0;
  melde();
}

export function beobachte(fn) {
  hoerer.add(fn);
  fn(eintraege.length);
  return () => hoerer.delete(fn);
}

/** Das Protokoll als Text — genau so geht es mit der Meldung hinaus. */
export function alsText() {
  if (!eintraege.length) return "";
  const t0 = eintraege[0].zeit;
  return eintraege
    .map((e) => `+${String(Math.round((e.zeit - t0) / 100) / 10).padStart(5)}s  ${e.art.padEnd(6)}  ${e.text}`)
    .join("\n");
}

/**
 * Einen API-Aufruf notieren. Wird vom fetch-Interceptor in main.jsx gerufen —
 * dort läuft ohnehin jeder Aufruf durch, eine zweite Stelle gäbe es nicht.
 */
export function notiereAufruf(method, url, status, ms) {
  // Erfolgreiche GETs sind Rauschen: sie sagen nichts über einen Fehler und
  // würden den Puffer in Sekunden füllen.
  const m = (method || "GET").toUpperCase();
  if (status >= 200 && status < 400 && m === "GET" && !(ms != null && ms >= LANGSAM_MS)) return;
  notiere("aufruf", `${m} ${anonym(url)} → ${status || "kein Netz"}${ms != null ? ` (${Math.round(ms)}ms)` : ""}`);
}

/**
 * Die Umgebung, in der das passiert ist — Geraet, Fenster, Anzeige, Netz.
 *
 * Das ist der zweite Teil jeder Fehlermeldung: "der Knopf ist weg" heisst auf
 * einem 390-px-Fenster etwas anderes als auf 1600 px, und "nichts wird
 * gespeichert" heisst bei 12 wartenden Aufrufen in der Warteschlange etwas
 * anderes als bei null.
 *
 * Es gilt dieselbe harte Grenze wie oben: NUR technische Eckdaten. Keine
 * Namen, keine IDs, keine Inhalte. Die aktiven Module stehen als Schluessel
 * drin (welche Teile ueberhaupt laufen), nicht ihre Daten.
 */
export function umgebung() {
  const z = [];
  const add = (k, v) => { if (v !== undefined && v !== null && v !== "") z.push(`${k}: ${v}`); };
  try {
    const n = navigator || {};
    add("Fassung", (typeof __APP_VERSION__ !== "undefined" && __APP_VERSION__) || "unbekannt");
    add("Adresse", anonym(location.pathname) + (location.hash ? " " + anonym(location.hash) : ""));
    add("Fenster", `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio || 1}x`);
    add("Bildschirm", screen ? `${screen.width}x${screen.height}` : "");
    add("Ausrichtung", window.innerWidth < window.innerHeight ? "hoch" : "quer");
    add("Darstellung", document.documentElement.getAttribute("data-theme")
      || (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dunkel (System)" : "hell (System)"));
    add("Sprache", n.language);
    add("Zeitzone", Intl.DateTimeFormat().resolvedOptions().timeZone);
    add("Ortszeit", new Date().toLocaleString("de-DE"));
    add("Plattform", n.userAgentData?.platform || n.platform);
    add("Browser", n.userAgent);
    add("Kerne", n.hardwareConcurrency);
    add("Speicher", n.deviceMemory ? `${n.deviceMemory} GB` : "");
    add("Eingabe", (n.maxTouchPoints || 0) > 0 ? "Touch" : "Maus/Tastatur");
    add("Netz", n.onLine ? "online" : "offline");
    add("Verbindung", n.connection?.effectiveType);
    add("Hülle", window.nuvoraDesktop || navigator.userAgent.includes("Electron") ? "Desktop-App"
      : window.matchMedia?.("(display-mode: standalone)").matches ? "installiert (PWA)" : "Browser");
    add("Service Worker", navigator.serviceWorker?.controller ? "aktiv" : "keiner");
    add("Cookies", n.cookieEnabled ? "erlaubt" : "blockiert");
    // Warteschlange und ihre Fehler: die haeufigste Ursache fuer "es speichert
    // nicht" — und beides sind blosse Zahlen, keine Inhalte.
    try {
      const f = JSON.parse(localStorage.getItem("nuvora_outbox_fehler") || "[]");
      add("Offline-Warteschlange", `${f.length} Fehler`);
    } catch { /* egal */ }
    try {
      const mods = JSON.parse(localStorage.getItem("nuvora_cache_modules") || "[]");
      const an = mods.filter((m) => m.active).map((m) => m.key);
      add("Module aktiv", an.length ? an.join(", ") : "keine");
    } catch { /* egal */ }
    add("Protokoll", `${eintraege.length} Einträge`);
  } catch { /* egal — eine unvollständige Umgebung ist besser als keine */ }
  return z.join("\n");
}

/** Seitenwechsel notieren (der Weg dorthin ist die halbe Fehlermeldung). */
export function notiereSeite(pfad) {
  notiere("seite", anonym(pfad));
}

/**
 * Fehler des Browsers mitschreiben: geworfene Ausnahmen, abgelehnte
 * Versprechen und Konsolenfehler. Einmal beim Start aufsetzen.
 */
export function protokollStarten() {
  window.addEventListener("error", (e) => {
    notiere("fehler", e.message || "Fehler ohne Text");
  });
  window.addEventListener("unhandledrejection", (e) => {
    const g = e.reason;
    notiere("fehler", (g && (g.message || g)) || "abgelehntes Versprechen");
  });
  // console.error umlenken, ohne es zu verschlucken: React meldet gebrochene
  // Komponenten genau dort, und das ist oft der einzige Hinweis.
  const orig = console.error;
  console.error = (...args) => {
    try { notiere("fehler", args.map((a) => (a && a.message) || String(a)).join(" ")); } catch { /* egal */ }
    orig.apply(console, args);
  };
}
