/**
 * Gemeinsames Werkzeug der vier Browser-Testskripte.
 *
 *   scripts/selftest-browser.mjs    — Rundgang bei eingeschalteten Modulen
 *   scripts/systemtest-browser.mjs  — jedes Modul einzeln, verbotene Verbindungen
 *   scripts/desktop-test.mjs        — die Mac-App im echten Electron-Fenster
 *   scripts/desktop-offline.mjs     — dieselbe App ohne Netz
 *
 * Warum eine eigene Datei? Dieselben Gedanken standen bis hier in vier
 * Fassungen nebeneinander: die Anmeldung samt Vorbelegen des localStorage, der
 * Dialog-Handler, der Bericht mit Farben und Schlussbilanz, das Abraeumen mit
 * Testmarke, `kurzfehler`/`mitFrist`/`warte`, das Warten auf eine ruhige
 * Adresse und der HTTP-Zugang zum API. Vier Fassungen desselben Gedankens
 * laufen auseinander — und dann prueft ein Skript etwas, von dem die anderen
 * drei nichts mehr wissen.
 *
 * Die Richtung ist gerade und muss es bleiben, genau wie auf der Python-Seite
 * (siehe scripts/gemeinsam.py):
 *
 *     browser-gemeinsam.mjs  <-  selftest-browser.mjs
 *                            <-  systemtest-browser.mjs
 *                            <-  desktop-test.mjs
 *                            <-  desktop-offline.mjs
 *
 * Hier importiert NICHTS zurueck. Wer das umdreht, baut den Importring, den es
 * auf der Python-Seite schon einmal gab.
 *
 * Was hier NICHT hingehoert: alles, was nur zufaellig gleich aussieht. Die
 * Reste-Abraeumer der vier Skripte etwa raeumen voellig verschiedene Dinge ab
 * (ein Notizzettel, ein Dutzend Modul-Arten mit Reihenfolge, eine Klasse) —
 * sie bleiben getrennt und teilen sich nur das Sicherheitsnetz `traegtMarke`.
 */
import { chromium, webkit } from "playwright";

// ─────────────────────────── Argumente ───────────────────────────

/**
 * Ein Aufrufargument lesen — beide Schreibweisen: `--name wert` und
 * `--name=wert`. Die zweite ist die, die man beim Tippen erwartet; ohne sie
 * landete `--browser=webkit` stillschweigend als unbekanntes Argument im
 * Nirgendwo und der Lauf nahm kommentarlos die Vorgabe.
 */
export const arg = (name, fallback) => {
  const mitGleich = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (mitGleich) return mitGleich.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

/**
 * Adresse und Zugangsdaten — oder ein klarer Abbruch.
 *
 * Alle vier Skripte nehmen dieselben drei Angaben aus denselben Quellen.
 * Rueckgabe: { basis, email, passwort }.
 */
export function zugang() {
  const basis = (arg("url", process.env.SELFTEST_URL || process.env.SITE_URL) || "").replace(/\/$/, "");
  const email = arg("email", process.env.SELFTEST_EMAIL);
  const passwort = arg("passwort", process.env.SELFTEST_PASSWORD);
  if (!basis || !email || !passwort) {
    console.error("Fehler: --url, --email und --passwort noetig (oder SELFTEST_URL/SELFTEST_EMAIL/SELFTEST_PASSWORD).");
    process.exit(2);
  }
  return { basis, email, passwort };
}

// ── Welche Browser-Engine? ─────────────────────────────────────────────────
//
// Der Betrieb laeuft zu grossen Teilen auf iPads, also auf WebKit — der Engine
// mit den meisten Eigenheiten. Chromium bleibt trotzdem die VORGABE: der Deploy
// ruft die Tests bei jedem Durchlauf, und sie sollen nicht ungefragt doppelt so
// lange dauern. Wer WebKit sehen will, sagt es (`--browser=webkit`), wer beides
// braucht, auch (`--browser=beide`).
export const MOTOREN_ALLE = { chromium, webkit };

export function motorenWahl() {
  const wahl = String(arg("browser", process.env.SELFTEST_BROWSERS) || "chromium").toLowerCase();
  const motoren = wahl === "beide" ? ["chromium", "webkit"] : [wahl];
  if (motoren.some((m) => !MOTOREN_ALLE[m])) {
    console.error(`Fehler: --browser kennt nur chromium, webkit oder beide (bekommen: „${wahl}").`);
    process.exit(2);
  }
  return motoren;
}

// ─────────────────────────── Farben und Uhr ───────────────────────────

// Farbe nur im Terminal (sonst landen Steuerzeichen in Logdateien), NO_COLOR
// als uebliche Notbremse.
export const FARBE = process.stdout.isTTY && !process.env.NO_COLOR;
export const ROT = FARBE ? "\x1b[31m" : "";
export const GRUEN = FARBE ? "\x1b[32m" : "";
export const GRAU = FARBE ? "\x1b[90m" : "";
export const FETT = FARBE ? "\x1b[1m" : "";
export const AUS = FARBE ? "\x1b[0m" : "";

// Die Laufzeit steht vor jeder Zeile: ein Lauf dauert Minuten, und so sieht
// man, wo die Zeit hingeht.
export const START = Date.now();
export const seit = () => `${String(Math.round((Date.now() - START) / 1000)).padStart(4)}s`;

// ─────────────────────────── Kleinkram ───────────────────────────

export const warte = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Harte Frist um eine Zusage. Ohne sie blockiert ein einziger Haenger (eine
 * Seite, die nie „networkidle" erreicht) den ganzen Lauf, und der Nutzer bricht
 * ab. Der Aufrufer schliesst die Seite im finally.
 */
export function mitFrist(zusage, ms, was) {
  let uhr;
  const frist = new Promise((_, ab) => {
    uhr = setTimeout(() => ab(new Error(`Zeitüberschreitung nach ${Math.round(ms / 1000)}s (${was})`)), ms);
  });
  return Promise.race([zusage, frist]).finally(() => clearTimeout(uhr));
}

/**
 * Fehlertext auf ein lesbares Mass bringen.
 *
 * Playwright haengt an seine Fehlermeldungen das komplette Browser-Protokoll.
 * Kommt ein Konsolenfehler im Sekundentakt, sind das achtzig gleichlautende
 * Zeilen, die den eigentlichen Grund begraben. Erste Zeile, danach hoechstens
 * `zeilen-1` weitere VERSCHIEDENE, jede nur einmal und mit Zaehler.
 */
export function kurzfehler(e, zeilen = 4) {
  const roh = String(e?.message || e).split("\n").map((z) => z.trim()).filter(Boolean);
  const zaehl = new Map();
  for (const z of roh) zaehl.set(z, (zaehl.get(z) || 0) + 1);
  return [...zaehl.entries()].slice(0, zeilen)
    .map(([z, n]) => (n > 1 ? `${z.slice(0, 160)} (${n}×)` : z.slice(0, 160)))
    .join(" | ");
}

/** Nur die erste Zeile eines Fehlers, gekuerzt. */
export const kurz = (e, n = 140) => String(e?.message || e).split("\n")[0].slice(0, n);

// ─────────────────────────── Rauschen ───────────────────────────

// Was nichts ueber die Gesundheit der Installation sagt. Jede Zeile ist eine
// Ausnahme MIT Grund — was hier steht, verschluckt der Test.
export const EGAL_VORGABE = [
  /favicon/i,                          // das Symbol fehlt mal, das sagt nichts
  /ResizeObserver loop/i,              // Browser-Eigenheit, kein Anwendungsfehler
  /Download the React DevTools/i,      // Hinweis von React selbst
  // /api/version gehoert der Administration; fuer jedes andere Konto ist 403
  // die richtige Antwort und kein Befund.
  /\/api\/version/,
];

// Fremde Hosts, deren Fehler nichts ueber die Installation sagen: der
// Marktplatz und der Update-Check fragen GitHub — offline im Serverraum ist
// das kein Fehler.
//
// Verglichen wird der HOSTNAME einer geparsten Adresse, frueher stand hier
// /api\.github\.com/i. Ein solcher Ausdruck ist nicht verankert und trifft
// irgendwo in der Zeichenkette: „https://nuvora.example/x/api.github.com/y"
// waere stillschweigend durchgewunken worden. Ein Pruefwerkzeug, das Befunde
// verschluckt, meldet gruen, ohne gruen zu sein.
export const EGAL_HOSTS = new Set(["api.github.com"]);

export const istEgalerHost = (text) => {
  for (const gefunden of String(text).match(/https?:\/\/[^\s"'<>)]+/gi) || []) {
    try {
      if (EGAL_HOSTS.has(new URL(gefunden).hostname.toLowerCase())) return true;
    } catch { /* keine gueltige Adresse — dann ist es auch kein bekannter Host */ }
  }
  return false;
};

/** `istEgal` bauen — `extra` sind zusaetzliche Ausnahmen dieses Skripts. */
export function macheIstEgal(extra = []) {
  const muster = [...EGAL_VORGABE, ...extra];
  return (text) => muster.some((r) => r.test(text)) || istEgalerHost(text);
}

// HTTP 429 ist Infrastruktur, kein Anwendungsfehler: der Proxy drosselt /api/
// (nginx.conf, `limit_req zone=api_rl`), und die Tests klappern Dutzende Seiten
// in Folge ab, die jede mehrere API-Aufrufe feuern. Das darf den Lauf nicht rot
// faerben — aber auch nicht spurlos verschwinden: die betroffene Seite wird
// nach einer Pause noch einmal besucht, und was dann bleibt, steht als Hinweis
// im Bericht.
// BEWUSST nur 429. Ein 403 oder 404 auf einer Seite, die etwas laden will, ist
// ein echter Befund — genau so kam der Kalender-403 ans Licht.
export const istDrosselung = (text) => /\b429\b|Too Many Requests/i.test(text);
export const PAUSE_429 = 4000;
// Harte Obergrenze je Seite.
export const FRIST_SEITE = 60000;

/** Was der Proxy gedrosselt hat, kurz gefasst (leer = nichts gedrosselt). */
export const drosselText = (drossel) => [...new Set(drossel)].slice(0, 3).join(", ");

// ─────────────────────────── Bericht ───────────────────────────

/**
 * Ein Bericht, der jede Zeile SOFORT ausgibt.
 *
 * Nicht erst am Ende: ein Lauf dauert Minuten; wer nur einen stehenden
 * Bildschirm sieht, haelt das fuer einen Haenger und bricht ab (genau das ist
 * passiert).
 *
 *   `gruppePraefix()` — steht vor jeder Gruppenueberschrift. Die Browser-Tests
 *                       setzen dort die laufende Engine ein, die Desktop-App
 *                       „[desktop]". Eine Funktion, weil die Engine je Lauf
 *                       wechselt.
 *   `zusatz()`        — Felder, die jede Zeile zusaetzlich traegt (etwa der
 *                       Motor, nach dem die Schlussbilanz gruppiert).
 *
 * `art` kennt zwei Werte: "pruefung" (Vorgabe) zaehlt fuer das Ergebnis;
 * "hinweis" zaehlt NICHT — damit stehen etwa die Chromium-Vergleichszeilen im
 * Bericht, ohne dass ein Web-Fehler die Mac-App rot faerbt.
 */
export function macheBericht({ gruppePraefix = () => "", zusatz = () => ({}) } = {}) {
  const ergebnisse = [];
  let letzteGruppe = null;
  const notiere = (gruppe, name, ok, detail = "", art = "pruefung") => {
    ergebnisse.push({ gruppe, name, ok, detail, art, ...zusatz() });
    const kopf = `${gruppePraefix()}${gruppe}`;
    if (kopf !== letzteGruppe) {
      console.log(`\n${FETT}── ${kopf}${AUS}`);
      letzteGruppe = kopf;
    }
    const zeile = `${name}${detail ? `   ${detail}` : ""}`;
    const marke = art === "hinweis"
      ? `${GRAU}•${AUS} ${GRAU}${zeile}${AUS}`
      : (ok ? `${GRUEN}✓${AUS} ${zeile}` : `${ROT}✗ ${zeile}${AUS}`);
    console.log(`  ${GRAU}${seit()}${AUS} ${marke}`);
  };
  // Vor jedem weiteren Engine-Lauf: sonst faellt die erste Gruppenueberschrift
  // des zweiten Laufs weg, weil sie zufaellig genauso heisst wie die letzte.
  const neueGruppe = () => { letzteGruppe = null; };
  return { ergebnisse, notiere, neueGruppe };
}

/**
 * Zusammenfassung. Die Einzelzeilen sind waehrend des Laufs schon erschienen
 * (siehe `notiere`), hier steht nur noch, was schiefging — und zwar NACH
 * URSACHE gebuendelt: ein Fehler, der jede Seite trifft (etwa ein einzelner
 * Konsolenfehler in der Shell), ist EIN Befund. Frueher standen dafuer achtzig
 * gleichlautende Zeilen und begruben alles andere.
 *
 * Rueckgabe: true = es gab Fehler (der Aufrufer entscheidet ueber den Exit-Code).
 */
export function druckeBericht(ergebnisse, {
  titel,                       // „Browser-Selbsttest"
  gruenWort = "grün",
  einheitGruen = "Prüfungen",
  einheitRot = "Prüfungen",
  zusatzzeile = "",            // Bilanz je Engine / Browser-Vergleich
  gruppiert = true,
  grundVon = (f) => f.detail || "(ohne Detail)",
} = {}) {
  const pruefungen = ergebnisse.filter((e) => e.art !== "hinweis");
  const fehler = pruefungen.filter((e) => !e.ok);
  console.log("\n" + "=".repeat(40));
  if (!fehler.length) {
    console.log(`  ${GRUEN}${titel} ${gruenWort}${AUS} — ${pruefungen.length} ${einheitGruen} in ${seit().trim()}.`);
    if (zusatzzeile) console.log(`  ${GRAU}${zusatzzeile}${AUS}`);
    console.log("=".repeat(40));
    return false;
  }
  console.log(`  ${ROT}${FETT}${titel} ROT${AUS} — ${fehler.length} von ${pruefungen.length} ${einheitRot}.`);
  if (zusatzzeile) console.log(`  ${GRAU}${zusatzzeile}${AUS}`);
  if (!gruppiert) {
    for (const f of fehler) {
      console.log(`${ROT}  ✗ ${f.gruppe} / ${f.name}${AUS}`);
      if (f.detail) console.log(`      ${f.detail}`);
    }
    console.log("=".repeat(40));
    return true;
  }
  const nachGrund = new Map();
  for (const f of fehler) {
    const grund = grundVon(f);
    if (!nachGrund.has(grund)) nachGrund.set(grund, []);
    nachGrund.get(grund).push(`${f.gruppe} / ${f.name}`);
  }
  for (const [grund, wo] of nachGrund) {
    const rest = wo.length > 3 ? ` (und ${wo.length - 3} weitere)` : "";
    console.log(`${ROT}  ✗ ${wo.slice(0, 3).join(", ")}${rest}${AUS}`);
    console.log(`      ${grund}`);
  }
  console.log("=".repeat(40));
  return true;
}

/** Bilanz je Engine — „grün" ohne die Engine daneben sagt nicht, WORAUF. */
export const bilanzJeMotor = (ergebnisse, motoren) => motoren.map((m) => {
  const alle = ergebnisse.filter((e) => e.motor === m);
  const rot = alle.filter((e) => !e.ok).length;
  return `${m}: ${rot ? `${rot} von ${alle.length} rot` : `${alle.length} grün`}`;
}).join(" · ");

// ─────────────────────────── Abbruch ───────────────────────────

/**
 * Bis zum fertigen Aufraeumen KEIN Prozessende durchlassen.
 *
 * Playwright haengt eigene SIGINT/SIGTERM-Handler an (processLauncher:
 * `gracefullyCloseAll().then(() => process.exit(130))`). Die beenden den
 * Prozess, sobald der Browser zu ist — mitten im Aufraeumen. Genau daran ist es
 * gescheitert: nach einem Strg-C blieben 13 von 14 Modulen zugeschaltet, und
 * die Lehrkraft fand ihr Konto verstellt vor. Ein zweites Strg-C bricht hart
 * ab, und nach 20 s gibt auch die Bremse auf.
 */
export function abbruchBremse(aufraeumen, meldung = "räume auf …") {
  const echterExit = process.exit.bind(process);
  let laeuft = false;
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      if (laeuft) return echterExit(130);
      laeuft = true;
      console.error(`\n${ROT}Abbruch (${signal}) — ${meldung}${AUS}`);
      process.exit = () => {};
      const fertig = () => { process.exit = echterExit; echterExit(130); };
      Promise.race([Promise.resolve().then(aufraeumen), warte(20000)]).then(fertig, fertig);
    });
  }
}

// ─────────────────────────── HTTP-Zugang ───────────────────────────

// Die Testfamilien laufen direkt hintereinander gegen DASSELBE Konto, und der
// Server begrenzt das Anlegen (rate_limit in den Routern, limit_req im Proxy).
// Der Selbsttest legt seine Klassen an, danach kam der Systemtest und bekam
// „HTTP 429" — und meldete 45 Pruefungen als nicht gelaufen. Das ist ein Befund
// ueber die Taktung der Tests, nicht ueber die Seite. Also dreimal versuchen,
// mit wachsender Pause.
const RATELIMIT_PAUSEN = [0, 6000, 15000];

/**
 * API ueber den Playwright-Kontext (`kontext.request`).
 *
 * Gibt eine Playwright-`APIResponse` zurueck — also `r.ok()` und `r.status()`
 * mit Klammern. `holeKontext`/`holeToken` sind Funktionen, weil beide je
 * Engine-Lauf neu gesetzt werden.
 */
export function macheKontextApi(holeKontext, holeToken) {
  const api = async (pfad, methode = "get", data) => {
    let r;
    for (const pause of RATELIMIT_PAUSEN) {
      if (pause) await warte(pause);
      r = await holeKontext().request[methode](pfad, {
        headers: {
          Authorization: `Bearer ${holeToken()}`,
          ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(data !== undefined ? { data } : {}),
      });
      if (r.status() !== 429) return r;
    }
    return r;
  };
  /** JSON oder `null` bei jedem Nicht-2xx. */
  const apiJson = async (pfad, methode = "get", data) => {
    const r = await api(pfad, methode, data);
    if (!r.ok()) return null;
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  };
  return { api, apiJson };
}

/**
 * API ohne Browser (`fetch`) — fuer die Desktop-Tests und fuer alles, was auch
 * nach dem Tod des Browsers noch laufen muss (Aufraeumen nach Strg-C).
 *
 * Gibt eine `Response` zurueck — also `r.ok` und `r.status` OHNE Klammern.
 */
export function macheFetchApi(basis, holeToken) {
  const api = async (pfad, methode = "GET", data) => {
    let r;
    for (const pause of RATELIMIT_PAUSEN) {
      if (pause) await warte(pause);
      const tok = holeToken();
      r = await fetch(`${basis}${pfad}`, {
        method: methode,
        headers: {
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
          ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
      });
      if (r.status !== 429) return r;
    }
    return r;
  };
  const apiJson = async (pfad, methode = "GET", data) => {
    const r = await api(pfad, methode, data);
    if (!r.ok) return null;
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  };
  return { api, apiJson };
}

/**
 * Anmelden ueber die API — mit einer Auskunft, die weiterhilft.
 *
 * Das Testkonto legt kein Skript an: Registrieren verlangt eine
 * E-Mail-Bestaetigung. Fehlt es, sagt der Fehler genau das statt nur „401".
 */
export async function anmeldenApi(basis, email, passwort) {
  const r = await fetch(`${basis}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: passwort }),
  });
  if (r.status === 401)
    throw new Error(`Konto '${email}' gibt es nicht (oder falsches Passwort). Einmalig unter ${basis}/login registrieren und E-Mail bestaetigen.`);
  if (r.status === 403) throw new Error(`Konto '${email}' ist noch nicht per E-Mail bestaetigt.`);
  if (!r.ok) throw new Error(`Login fehlgeschlagen: HTTP ${r.status}`);
  return await r.json();   // { token, user }
}

// ─────────────────────────── Modul-Zustand ───────────────────────────

/**
 * Den Modul-Zustand des Kontos wieder geradebiegen — und NACHSEHEN, statt es
 * nur zu versuchen.
 *
 * Ueber schlichtes `fetch`, nicht ueber den Playwright-Kontext: nach Strg-C
 * (oder wenn der Browser stirbt) ist der geschlossen, JEDES Zuruecksetzen
 * scheitert, und die Lehrkraft findet ihr Konto verstellt vor. Ein Testwerkzeug
 * darf fremde Einstellungen nicht dauerhaft veraendern.
 *
 *   `keys`  — die Schluessel, die dieser Lauf angefasst hat (Set).
 *   `aktiv` — welche davon danach AN sein sollen (Set; leer = alle aus).
 *
 * Rueckgabe: { falsch: [Text] } — leer heisst „stimmt wieder".
 */
export async function modulZustandStellen({ basis, token, keys, aktiv = new Set() }) {
  const kopf = { Authorization: `Bearer ${token}` };
  // Alle auf einmal: nach einem Strg-C zaehlt jede Zehntelsekunde (siehe
  // `abbruchBremse`). Die Aufrufe haengen nicht voneinander ab.
  await Promise.all([...keys].map((key) =>
    fetch(`${basis}/api/modules/${key}/activate`,
      { method: aktiv.has(key) ? "POST" : "DELETE", headers: kopf })
      .catch(() => { /* die Nachschau unten sagt, ob es gereicht hat */ })));
  try {
    const liste = await (await fetch(`${basis}/api/modules`, { headers: kopf })).json();
    return {
      falsch: liste.filter((m) => keys.has(m.key) && !!m.active !== aktiv.has(m.key))
        .map((m) => `${m.key} ${m.active ? "noch an" : "aus"}`),
    };
  } catch (e) {
    return { falsch: [`Nachschau fehlgeschlagen: ${String(e.message || e).slice(0, 80)}`] };
  }
}

// ─────────────────────────── Testmarken ───────────────────────────

// Felder, unter denen ein Objekt seinen sprechenden Namen traegt — je nach
// Modul heisst das Feld anders (wie LABEL_FELDER in scripts/aufraeumen.py).
export const LABEL_FELDER = ["name", "title", "text", "label", "front", "aufgabentext", "content"];

/**
 * Traegt dieser Datensatz die Testmarke?
 *
 * Das Sicherheitsnetz jedes Abraeumens. Geprueft wird damit UNMITTELBAR vor dem
 * DELETE, nicht nur bei der Auswahl weiter oben — eine Klasse „7a" bleibt so
 * auch dann unberuehrt, wenn sie neben einer „ZZ-Systemtest-Klasse" steht.
 */
export const traegtMarke = (obj, marke) => LABEL_FELDER.some(
  (f) => typeof obj?.[f] === "string" && obj[f].includes(marke));

// ─────────────────────────── Browser-Handgriffe ───────────────────────────

/**
 * Rueckfragen bestaetigen — GENAU EIN Handler je Seite.
 *
 * Warum das sein muss: seit „wo sich etwas aendern laesst, gibt es einen
 * Speichern-Knopf" warnt Nuvora beim Verlassen einer Seite mit offenen
 * Aenderungen (`useVerlassenWarnung` in components/Speichern.jsx, ein
 * `window.confirm`). Playwright weist Dialoge von sich aus AB — damit
 * antwortet der Test „Nein", der Seitenwechsel bleibt haengen und der Locator
 * dahinter laeuft in sein Zeitlimit. Eine Lehrkraft, die bewusst weggeht,
 * bestaetigt; also bestaetigt der Test auch.
 *
 * Und genau EINER: zwei Handler auf demselben Dialog lassen den zweiten ins
 * Leere greifen („Protocol error (Page.handleJavaScriptDialog): No dialog is
 * showing") und reissen den ganzen Lauf ab. Wer hier etwas braucht, erweitert
 * diese Funktion — kein zweites `seite.on("dialog", …)` daneben.
 */
export function dialogeAnnehmen(seite) {
  seite.on("dialog", (d) => d.accept().catch(() => {}));
}

/**
 * Abgebrochene Anfrage statt echtem Fehler? Die Texte, mit denen die Engines
 * einen Abbruch melden — WebKit ist hier gespraechiger als Chromium.
 */
export const istAbbruchBeimLaden = (text) =>
  /Load failed|Fetch API cannot load|access control checks|NetworkError|operation was aborted|Failed to fetch/i.test(text);

/**
 * Etwas laden und dabei wissen, DASS gerade geladen wird.
 *
 * Waehrend eines Neuladens sterben laufende Anfragen — das ist normal und
 * nichts, was eine Lehrkraft je saehe. Der Merker sagt dem Fehler-Mitschnitt,
 * dass er in genau diesem Fenster nachsichtig sein darf.
 */
export async function beimLaden(seite, tun) {
  seite.__laedtGerade = true;
  try {
    return await tun();
  } finally {
    // Kurze Nachlaufzeit: die abgewiesene Zusage einer abgebrochenen Anfrage
    // trifft manchmal erst ein, wenn das Neuladen schon als fertig gilt.
    setTimeout(() => { seite.__laedtGerade = false; }, 500);
  }
}

/**
 * Fehler-Mitschrift an eine Seite haengen.
 *
 * `merke` legt jeden Befund nur EINMAL ab und deckelt die Zahl: eine Seite, die
 * im Sekundentakt denselben Fehler wirft, hat frueher hunderte Zeilen erzeugt
 * und alles andere unlesbar gemacht. Drosselungen (429) laufen in einen eigenen
 * Topf und sind kein Befund.
 *
 * `nachsichtigBeimLaden`: ein Neuladen bricht laufende Anfragen ab; WebKit
 * meldet das als „TypeError: Load failed", Chromium haelt still. Das ist eine
 * Eigenheit der Engine an einer Stelle, die der Test SELBST verursacht — nur
 * innerhalb von `beimLaden` wird es uebergangen, sonst nicht.
 */
export function beobachte(seite, istEgal, { nachsichtigBeimLaden = false } = {}) {
  const probleme = [];
  const drossel = [];
  const merke = (text) => {
    if (probleme.length < 12 && !probleme.includes(text)) probleme.push(text);
  };
  seite.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (istEgal(text)) return;
    if (istDrosselung(text)) drossel.push("Konsole");
    else merke(`Konsole: ${text.slice(0, 160)}`);
  });
  seite.on("pageerror", (e) => {
    const text = String(e);
    if (nachsichtigBeimLaden && seite.__laedtGerade && istAbbruchBeimLaden(text)) return;
    merke(`Absturz: ${text.slice(0, 160)}`);
  });
  seite.on("response", (r) => {
    if (r.status() === 429) { drossel.push(new URL(r.url()).pathname); return; }
    if (r.status() >= 400 && !istEgal(r.url())) merke(`HTTP ${r.status()} ${new URL(r.url()).pathname}`);
  });
  return {
    probleme, drossel, merke,
    leeren: () => { probleme.length = 0; drossel.length = 0; },
  };
}

// Takt der Tour-Suche. Zwei Runden: die Modul-Tour erscheint erst, wenn die
// Daten da sind. Der Systemtest klappert deutlich mehr Seiten ab und nimmt
// deshalb den knapperen Takt — die Abdeckung bleibt dieselbe.
export const TOUR_TAKT = { erste: 1200, weitere: 600, pause: 700 };
export const TOUR_TAKT_KNAPP = { erste: 1000, weitere: 400, pause: 500 };

/**
 * Die Einstiegs-Tour wegklicken.
 *
 * Ein frisches Konto bekommt ein Overlay ("Tour starten / Später"), das ueber
 * der Seite liegt und jeden Klick abfaengt. Eine Lehrkraft klickt es weg, also
 * tut der Test das auch — sonst prueft er nur das Overlay.
 *
 * Zwei Sorten: die Willkommens-Tour („Später") und die Modul-Tour beim ersten
 * Besuch einer Modulseite („Überspringen"). Beide Beschriftungen in EINEM
 * Locator (`.or`): frueher wartete der Test je Runde zweimal hintereinander auf
 * ein Overlay, das es meistens gar nicht gibt — vier Sekunden Leerlauf pro
 * Seite, mal ueber hundert Seiten.
 *
 * Beschriftungen in allen drei Sprachen (de/en/es), denn die Oberflaeche
 * startet je nach Konto unterschiedlich.
 */
export async function tourWegklicken(seite, takt = TOUR_TAKT) {
  const knopf = seite.getByRole("button", { name: /später|spaeter|later|más tarde|mas tarde/i })
    .or(seite.getByRole("button", { name: /überspringen|ueberspringen|skip|saltar|omitir/i })).first();
  for (const runde of [0, 1]) {
    try {
      if (await knopf.isVisible({ timeout: runde ? takt.weitere : takt.erste })) await knopf.click({ timeout: 3000 });
    } catch { /* kein Overlay da — der Normalfall */ }
    if (!runde) await seite.waitForTimeout(takt.pause);
  }
}

/**
 * Anmeldung in den localStorage legen — abgesichert.
 *
 * `addInitScript` laeuft in JEDEM Dokument des Kontexts, auch in solchen ohne
 * echte Herkunft: dem `about:blank`, mit dem Playwright jede neue Seite
 * startet, in `data:`/`blob:`-Dokumenten und in sandboxed Rahmen. Dort ist
 * localStorage gesperrt, der Zugriff wirft SecurityError — und weil das bei
 * jedem Seitenaufruf passiert, flutete die Meldung das Protokoll. Also erst
 * die Herkunft pruefen, dann zugreifen, und beides in try/catch.
 *
 *   `touren`           — gefuehrte Touren vorab abhaken. Sie starten 900 ms
 *                        nach dem Seitenaufruf und legen ein Overlay ueber
 *                        ALLES (z-index 4000); Wegklicken allein reicht nicht,
 *                        die naechste Seite bringt die naechste Tour.
 *   `modulCacheLeeren` — der Modul-Cache wuerde den Stand des vorigen
 *                        Durchgangs zeigen. Wer je Durchgang umschaltet
 *                        (Systemtest), muss immer frisch fragen.
 *   `extra`            — weitere Schluessel, etwa die Sprache.
 */
export async function anmeldungHinterlegen(kontext, token, user, {
  extra = {}, touren = true, modulCacheLeeren = false,
} = {}) {
  await kontext.addInitScript(([tok, usr, mehr, mitTouren, cacheWeg]) => {
    try {
      if (!/^https?:$/.test(location.protocol)) return;   // about:blank, data:, blob:
      if (!window.localStorage) return;
      localStorage.setItem("token", tok);
      if (usr) localStorage.setItem("user", usr);
      if (cacheWeg) localStorage.removeItem("nuvora_cache_modules");
      if (mitTouren) {
        localStorage.setItem("nuvora_kerntour_done", "1");
        try { if (usr) localStorage.setItem(`nuvora_onboarded_${JSON.parse(usr).id}`, "1"); } catch { /* egal */ }
        for (const id of ["kalender", "noten", "karten"]) localStorage.setItem(`nuvora_tour_${id}_done`, "1");
      }
      for (const [k, v] of Object.entries(mehr)) localStorage.setItem(k, v);
    } catch { /* Dokument ohne eigene Herkunft — hier gibt es nichts zu setzen */ }
  }, [token, user ? JSON.stringify(user) : null, extra, touren, modulCacheLeeren]);
}

/**
 * Eine Seite oeffnen und bewerten — gleiche Massstaebe fuer alle vier Tests,
 * damit ihre Befunde vergleichbar bleiben (der Desktop-Test stellt App und
 * Browser genau so gegenueber).
 *
 *   `basis`          — Adressvorsatz. Leer, wenn der Kontext eine `baseURL`
 *                      hat; die Electron-Huelle braucht die volle Adresse.
 *   `linkSenke`      — Set, in das die internen Links der Seite wandern.
 *   `pruefeUeberlauf`— waagerechtes Scrollen melden (Handy-Ansicht).
 *   `takt`           — Takt fuer `tourWegklicken`.
 */
export async function rundgang(seite, pfad, probleme, {
  basis = "", linkSenke = null, pruefeUeberlauf = false, takt = TOUR_TAKT,
} = {}) {
  const antwort = await seite.goto(`${basis}${pfad}`, { waitUntil: "networkidle", timeout: 30000 });
  if (!antwort || antwort.status() >= 400) return { ok: false, detail: `HTTP ${antwort?.status()}`, probleme: [...probleme] };
  await tourWegklicken(seite, takt);

  // Landet die Seite auf /modules oder auf der Landing-Seite, greift das Gate
  // oder der Login — beides bedeutet: die Seite ist fuer die Lehrkraft nicht da.
  const jetzt = new URL(seite.url()).pathname;
  // Umleitungen INNERHALB des Moduls sind erwuenscht (/cardvote →
  // /cardvote/questions) und kein Befund. Nur der Sprung woanders hin zaehlt.
  const drin = jetzt === pfad || jetzt.startsWith(pfad) || pfad.startsWith(jetzt);
  let hinweis = "";
  if (!drin) {
    // `wackelig`: einen Ruecksprung sieht sich der Aufrufer noch einmal an
    // (siehe `geduldig`) — scheitert der Modul-Abruf einmal (Netz, Drosselung,
    // abgebrochene Anfrage), arbeitet die Shell mit einer leeren Modulliste
    // weiter und das Gate schickt auf /modules, obwohl das Modul zugeschaltet
    // ist. Ein wirklich abgeschaltetes Modul faellt auch beim zweiten Versuch
    // zurueck; die Pruefung verliert also nichts.
    if (jetzt === "/modules")
      return { ok: false, wackelig: true, detail: "ModuleGate wirft auf /modules zurück (Modul nicht aktiv?)", probleme: [...probleme] };
    if (jetzt === "/")
      return { ok: false, wackelig: true, detail: "landet auf der Startseite — nicht angemeldet?", probleme: [...probleme] };
    // Sonstige Umleitungen sind gewollt (alte CardVote-Adressen zeigen auf
    // /cardvote/*). Kein Befund — geprueft wird trotzdem, ob das Ziel rendert.
    hinweis = ` → ${jetzt}`;
  }
  // Gerenderter Inhalt statt leerer Shell.
  const text = (await seite.locator("body").innerText()).trim();
  const textLaenge = text.length;
  if (textLaenge < 20) probleme.push("Seite bleibt leer (Render-Fehler?)");
  // Die Auffangseite (LadeFehler in main.jsx) IST Inhalt — nach Zeichenzahl
  // sah eine abgestuerzte Seite deshalb gesund aus. Genau so blieb der
  // Sitzplan-Absturz („Can't find variable: abs") im Rundgang unbemerkt: die
  // Auffangseite rendert 150 Zeichen und faellt durch keine der Pruefungen.
  if (/Diese Seite konnte nicht geladen werden/i.test(text))
    probleme.push("zeigt die Auffangseite (die Seite ist beim Rendern gestorben)");

  if (pruefeUeberlauf) {
    // Waagerechtes Scrollen heisst auf dem Telefon: etwas ragt aus dem Bild,
    // Knoepfe sind nicht erreichbar. Tabellen duerfen fuer sich scrollen, die
    // Seite selbst nicht. Mit dem Schuldigen: „irgendwas ragt raus" hilft
    // niemandem beim Suchen.
    const { ueber, wer } = await seite.evaluate(() => {
      const w = window.innerWidth;
      const ueber = document.documentElement.scrollWidth - w;
      let schlimmster = null;
      for (const el of document.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.right > w + 2 && r.width > 30 && (!schlimmster || r.right > schlimmster.right)) {
          schlimmster = { right: r.right, name: el.tagName.toLowerCase() +
            (el.id ? "#" + el.id : "") +
            (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/)[0] : "") };
        }
      }
      return { ueber, wer: schlimmster ? schlimmster.name : "" };
    });
    if (ueber > 2)
      probleme.push(`ragt ${ueber}px aus dem Bild${wer ? ` (${wer})` : ""} — waagerechtes Scrollen`);
  }

  if (linkSenke) {
    for (const href of await seite.locator("a[href^='/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")))) {
      // Nur statische interne Ziele; Links mit Platzhaltern oder IDs kommen aus
      // Listen und haengen an Testdaten, die es hier nicht gibt.
      if (href && !href.includes("#") && !href.includes("?")) linkSenke.add(href);
    }
  }
  return probleme.length
    ? { ok: false, detail: probleme.slice(0, 3).join(" | "), probleme: [...probleme] }
    : { ok: true, detail: `${textLaenge} Zeichen gerendert${hinweis}`, probleme: [] };
}

/**
 * Etwas an einer Seite pruefen — und noch einmal, wenn beim ersten Mal etwas
 * dazwischenkam. Zwei Gruende:
 *
 *   - Drosselung (429): Infrastruktur, siehe `istDrosselung`. Bleibt sie beim
 *     zweiten Mal, steht sie als Hinweis im Bericht — rot wird davon nichts.
 *   - Ruecksprung ans ModuleGate, OBWOHL das Modul zugeschaltet ist: siehe
 *     `rundgang`. Ein wirklich abgeschaltetes Modul faellt auch beim zweiten
 *     Versuch zurueck — die Pruefung verliert also nichts.
 */
export async function geduldig(fn) {
  const erst = await fn();
  if (!erst.gedrosselt && !erst.wackelig) return erst;
  await warte(erst.gedrosselt ? PAUSE_429 : 1500);
  const zweit = await fn();
  let hinweis = "";
  if (erst.gedrosselt) {
    hinweis = zweit.gedrosselt
      ? `Hinweis: Proxy drosselt weiter (HTTP 429 auf ${zweit.gedrosselt})`
      : `Hinweis: einmal HTTP 429 (Proxy-Drosselung auf ${erst.gedrosselt}), Wiederholung sauber`;
  } else if (zweit.wackelig) {
    hinweis = "auch beim zweiten Versuch";
  }
  return { ...zweit, hinweis, detail: [zweit.detail, hinweis].filter(Boolean).join(" · ") };
}

// Kern-Seiten, die immer erreichbar sein muessen. Die Modul-Seiten kommen aus
// dem Register (/api/modules) — so pruefen die Tests genau die Module, die es
// im Code wirklich gibt, und niemand muss diese Liste pflegen.
export const KERN_SEITEN = [
  "/", "/modules", "/classes", "/kurse", "/topics", "/papierkorb",
  "/profile", "/marktplatz", "/legal", "/contact", "/help", "/tutorial",
];
