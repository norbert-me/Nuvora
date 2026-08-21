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

const MAX = 60;          // mehr liest niemand, und die Mail soll lesbar bleiben
const TEXT_MAX = 200;

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
  if (status >= 200 && status < 400 && m === "GET") return;
  notiere("aufruf", `${m} ${anonym(url)} → ${status || "kein Netz"}${ms != null ? ` (${Math.round(ms)}ms)` : ""}`);
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
