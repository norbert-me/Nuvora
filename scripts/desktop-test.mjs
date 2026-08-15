/**
 * Nuvora — Rundgang durch die Mac-App (Playwright steuert Electron).
 *
 * Der fuenfte Teil der Testfamilie. Die vier anderen pruefen den Server und die
 * Weboberflaeche; die Desktop-Huelle (`apps/desktop`) prueft bisher niemand —
 * und nach dem Sprung von Electron 32 auf 43 ist genau das die Luecke.
 *
 * Was hier drinsteht:
 *   1. Start — Fenster oeffnet, Titel stimmt, die uebergebene Adresse wird
 *      geladen. Und: der Erststart OHNE Adresse zeigt setup.html (eigener Lauf
 *      mit leerem userData-Verzeichnis, sonst faellt die gemerkte Adresse
 *      dazwischen und das Setup erscheint nie).
 *   2. Anmeldung ueber das ECHTE Formular (kein Token in den localStorage
 *      geschoben) — und nach einem App-Neustart ist man noch angemeldet. Das ist
 *      der Punkt, an dem eine Electron-Aktualisierung am ehesten bricht: die
 *      persistente Session.
 *   3. Seiten — Kern-Seiten plus ALLE Module zur Laufzeit aus /api/modules
 *      durchgezaehlt (kein festgeschriebener Katalog: ein neues Modul waere
 *      sonst wieder ungeprueft).
 *   4. Vergleich mit dem Browser — dieselbe Seitenliste in Chromium gegen
 *      dieselbe Adresse. Ein Befund ist erst dann ein DESKTOP-Befund, wenn er in
 *      Chromium NICHT auftritt. Ohne diese Unterscheidung meldet der Test
 *      Web-Fehler als App-Fehler, und dafuer gibt es schon selftest-browser.mjs.
 *   5. Menue und Fenster — das Menue ist aufgebaut (Ansicht, Server), und
 *      `window.open` auf eine fremde Adresse oeffnet KEIN zweites Fenster
 *      (setWindowOpenHandler = deny).
 *   6. Ein echter Handgriff — Notizzettel anlegen, App neu starten, nachsehen:
 *      der Beweis, dass Schreiben durch die Huelle wirklich beim Server ankommt.
 *
 * Ausdruecklich NICHT hier drin: Offline-Betrieb und der Fehlerfall bei toter
 * Adresse. Das prueft scripts/desktop-offline.mjs — doppelt gepruefte Dinge
 * verrotten doppelt.
 *
 * Nutzung:  node scripts/desktop-test.mjs --url … --email … --passwort …
 *           (oder SELFTEST_URL/SITE_URL, SELFTEST_EMAIL, SELFTEST_PASSWORD)
 * Rueckgabewert: 0 = gruen, 1 = mindestens ein Desktop-Befund.
 */
import { _electron, chromium } from "playwright";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const arg = (name, fallback) => {
  // Beide Schreibweisen: `--name wert` und `--name=wert`.
  const mitGleich = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (mitGleich) return mitGleich.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const URL_BASIS = (arg("url", process.env.SELFTEST_URL || process.env.SITE_URL) || "").replace(/\/$/, "");
const EMAIL = arg("email", process.env.SELFTEST_EMAIL);
const PASSWORT = arg("passwort", process.env.SELFTEST_PASSWORD);

if (!URL_BASIS || !EMAIL || !PASSWORT) {
  console.error("Fehler: --url, --email und --passwort noetig (oder SELFTEST_URL/SELFTEST_EMAIL/SELFTEST_PASSWORD).");
  process.exit(2);
}

const HIER = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(HIER, "..", "apps", "desktop");
// Playwright sucht die Electron-Binaerdatei sonst im eigenen node_modules; sie
// liegt aber bei der App (apps/desktop/node_modules) — das ist genau die
// Version, die auch die fertige Mac-App traegt, und nur die soll geprueft
// werden.
const ELECTRON_BIN = path.join(DESKTOP, "node_modules", "electron", "dist",
  process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron"
  : process.platform === "win32" ? "electron.exe" : "electron");

// Kern-Seiten, die immer erreichbar sein muessen. Die Modul-Seiten kommen aus
// dem Register (/api/modules) — so prueft der Test genau die Module, die es im
// Code wirklich gibt, und niemand muss diese Liste pflegen.
const KERN_SEITEN = [
  "/", "/modules", "/classes", "/kurse", "/topics", "/papierkorb",
  "/profile", "/marktplatz", "/legal", "/contact", "/help", "/tutorial",
];

// Marke, an der alles Angelegte erkennbar ist — und wieder wegkommt.
const MARKE = "ZZ-Desktop";

// ── Bekanntes Rauschen ─────────────────────────────────────────────────────
//
// Jede Zeile hier ist eine Ausnahme MIT Grund. Was hier steht, verschluckt der
// Test — deshalb steht hier nur, was nachweislich nichts ueber die Gesundheit
// der App sagt.
const EGAL = [
  /favicon/i,                          // das Symbol fehlt mal, das sagt nichts
  /ResizeObserver loop/i,              // Browser-Eigenheit, kein Anwendungsfehler
  /Download the React DevTools/i,      // Hinweis von React selbst
  /\/api\/version/,                    // gehoert der Administration; 403 ist fuer jedes andere Konto richtig
  // net::ERR_ABORTED entsteht, wenn eine Seite gewechselt wird, waehrend ihre
  // fetches noch laufen: React raeumt beim Unmount ab, Chromium meldet den
  // Abbruch. Dieser Test klappert Dutzende Seiten in Folge ab und erzeugt das
  // damit selbst. Ein echter Ladefehler traegt einen anderen Code (ERR_FAILED,
  // ERR_CONNECTION_REFUSED, ERR_NAME_NOT_RESOLVED) und bleibt ein Befund.
  /ERR_ABORTED/,
  // Electrons eigener Sicherheitshinweis im Entwicklungsmodus. Er erscheint,
  // weil die App unverpackt (`electron .`) laeuft — in der gebauten App nicht.
  /Electron Security Warning/i,
];

// Fremde Hosts, deren Fehler nichts ueber die Installation sagen: Marktplatz
// und Update-Check fragen GitHub. Verglichen wird der HOSTNAME einer geparsten
// Adresse — ein unverankerter Ausdruck wuerde auch auf
// „https://nuvora.example/x/api.github.com/y" passen, und ein Pruefwerkzeug,
// das Befunde verschluckt, meldet gruen, ohne gruen zu sein.
const EGAL_HOSTS = new Set(["api.github.com"]);
const istEgalerHost = (text) => {
  for (const gefunden of String(text).match(/https?:\/\/[^\s"'<>)]+/gi) || []) {
    try { if (EGAL_HOSTS.has(new URL(gefunden).hostname.toLowerCase())) return true; }
    catch { /* keine gueltige Adresse — dann auch kein bekannter Host */ }
  }
  return false;
};
const istEgal = (text) => EGAL.some((r) => r.test(text)) || istEgalerHost(text);

// HTTP 429 ist Infrastruktur, kein Anwendungsfehler: der Proxy drosselt /api/.
// Faerbt den Lauf nicht rot, verschwindet aber auch nicht — die Seite wird nach
// einer Pause noch einmal besucht, und was dann bleibt, steht als Hinweis da.
const istDrosselung = (text) => /\b429\b|Too Many Requests/i.test(text);
const PAUSE_429 = 4000;
const FRIST_SEITE = 60000;

const ergebnisse = [];

const FARBE = process.stdout.isTTY && !process.env.NO_COLOR;
const ROT = FARBE ? "\x1b[31m" : "";
const GRUEN = FARBE ? "\x1b[32m" : "";
const GRAU = FARBE ? "\x1b[90m" : "";
const FETT = FARBE ? "\x1b[1m" : "";
const AUS = FARBE ? "\x1b[0m" : "";

// Jede Zeile erscheint SOFORT, nicht erst am Ende: ein Lauf dauert Minuten, und
// wer nur einen stehenden Bildschirm sieht, haelt das fuer einen Haenger.
const START = Date.now();
const seit = () => `${String(Math.round((Date.now() - START) / 1000)).padStart(4)}s`;
let letzteGruppe = null;

/**
 * Eine Zeile in den Bericht.
 *
 * `art` kennt drei Werte:
 *   "pruefung" (Vorgabe) — zaehlt fuer das Ergebnis, ✓ oder ✗.
 *   "hinweis"            — zaehlt NICHT. Damit stehen die Chromium-Ergebnisse
 *                          im Bericht (man sieht, ob der Vergleich ueberhaupt
 *                          gelaufen ist), ohne dass ein Web-Fehler die Mac-App
 *                          rot faerbt. Dafuer gibt es selftest-browser.mjs.
 */
const notiere = (gruppe, name, ok, detail = "", art = "pruefung") => {
  ergebnisse.push({ gruppe, name, ok, detail, art });
  if (gruppe !== letzteGruppe) {
    console.log(`\n${FETT}── [desktop] ${gruppe}${AUS}`);
    letzteGruppe = gruppe;
  }
  const zeile = `${name}${detail ? `   ${detail}` : ""}`;
  const marke = art === "hinweis"
    ? `${GRAU}•${AUS} ${GRAU}${zeile}${AUS}`
    : (ok ? `${GRUEN}✓${AUS} ${zeile}` : `${ROT}✗ ${zeile}${AUS}`);
  console.log(`  ${GRAU}${seit()}${AUS} ${marke}`);
};

/** Harte Frist um eine Zusage — ein Haenger darf nicht den ganzen Lauf blockieren. */
function mitFrist(zusage, ms, was) {
  let uhr;
  const frist = new Promise((_, ab) => {
    uhr = setTimeout(() => ab(new Error(`Zeitüberschreitung nach ${Math.round(ms / 1000)}s (${was})`)), ms);
  });
  return Promise.race([zusage, frist]).finally(() => clearTimeout(uhr));
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fehlertext auf ein lesbares Mass bringen: Playwright haengt an seine
 * Meldungen das komplette Protokoll, und ein Fehler im Sekundentakt begraebt
 * darin den eigentlichen Grund.
 */
function kurzfehler(e, zeilen = 3) {
  const roh = String(e?.message || e).split("\n").map((z) => z.trim()).filter(Boolean);
  const zaehl = new Map();
  for (const z of roh) zaehl.set(z, (zaehl.get(z) || 0) + 1);
  return [...zaehl.entries()].slice(0, zeilen)
    .map(([z, n]) => (n > 1 ? `${z.slice(0, 150)} (${n}×)` : z.slice(0, 150)))
    .join(" | ");
}

// ───────────────────────── Zustand des Kontos ──────────────────────────────
//
// Der Test schaltet Module zu, damit ihre Seiten ueberhaupt erreichbar sind.
// Das Zuruecksetzen laeuft ueber schlichtes `fetch` statt ueber Playwright:
// nach einem Strg-C ist der Browser (und die Electron-App) tot, und ein
// Testwerkzeug darf fremde Einstellungen nicht dauerhaft veraendern.
const zurueckzustellen = new Set();
let token = null;
let aufgeraeumt = false;
// Verzeichnisse, die dieser Lauf angelegt hat (userData der Testfenster).
const tempOrdner = new Set();

const api = async (pfad, methode = "GET", data) => {
  const antwort = await fetch(`${URL_BASIS}${pfad}`, {
    method: methode,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  });
  return antwort;
};
const apiJson = async (pfad, methode = "GET", data) => {
  const r = await api(pfad, methode, data);
  if (!r.ok) return null;
  const text = await r.text();
  return text ? JSON.parse(text) : null;
};

async function kontoZustandHerstellen(ohneBericht = false) {
  if (aufgeraeumt) return;
  aufgeraeumt = true;
  for (const ordner of tempOrdner) {
    try { fs.rmSync(ordner, { recursive: true, force: true }); } catch { /* Reste im Temp sind harmlos */ }
  }
  if (!token) return;
  const kopf = { Authorization: `Bearer ${token}` };
  await Promise.all([...zurueckzustellen].map((key) =>
    fetch(`${URL_BASIS}/api/modules/${key}/activate`, { method: "DELETE", headers: kopf })
      .catch(() => { /* die Nachschau unten sagt, ob es gereicht hat */ })));
  let offen;
  try {
    const liste = await (await fetch(`${URL_BASIS}/api/modules`, { headers: kopf })).json();
    offen = liste.filter((m) => m.active && zurueckzustellen.has(m.key)).map((m) => m.key);
  } catch (e) {
    offen = [`Nachschau fehlgeschlagen: ${String(e.message || e).slice(0, 80)}`];
  }
  const gut = offen.length === 0;
  const text = gut
    ? (zurueckzustellen.size ? `${zurueckzustellen.size} zugeschaltete Module wieder aus` : "nichts zu tun")
    : `stimmt NICHT: ${offen.join(", ")} noch an`;
  if (ohneBericht) console.error(`\n${gut ? GRUEN : ROT}Modul-Zustand: ${text}${AUS}`);
  else notiere("Aufräumen", "Modulzustand", gut, text);
}

// Playwright haengt eigene SIGINT/SIGTERM-Handler an, die den Prozess beenden,
// sobald der Browser zu ist — mitten im Aufraeumen. Deshalb wird bis zum
// fertigen Aufraeumen kein Prozessende durchgelassen; ein zweites Strg-C bricht
// hart ab, und nach 20 s gibt auch die Bremse auf.
const echterExit = process.exit.bind(process);
let abbruchLaeuft = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (abbruchLaeuft) return echterExit(130);
    abbruchLaeuft = true;
    console.error(`\n${ROT}Abbruch (${signal}) — stelle den Zustand des Kontos wieder her …${AUS}`);
    process.exit = () => {};
    const fertig = () => { process.exit = echterExit; echterExit(130); };
    Promise.race([kontoZustandHerstellen(true), warte(20000)]).then(fertig, fertig);
  });
}

// ───────────────────────── Reste des letzten Laufs ─────────────────────────
//
// Sicherheitsnetz wie in scripts/aufraeumen.py: geloescht wird ausschliesslich,
// was die Marke traegt — geprueft unmittelbar VOR dem DELETE, nicht nur bei der
// Auswahl. Ohne das Abraeumen faende der Handgriff den alten Zettel wieder und
// meldete faelschlich Erfolg.
async function resteAbraeumen() {
  let weg = 0;
  const rest = [];
  const liste = await apiJson("/api/notizblock");
  for (const eintrag of liste || []) {
    if (!`${eintrag.title || ""}${eintrag.content || ""}`.includes(MARKE)) continue;
    const r = await api(`/api/notizblock/${eintrag.id}`, "DELETE");
    if (r.ok) weg++;
    else rest.push(`Notizzettel ${eintrag.id} (HTTP ${r.status})`);
  }
  return { weg, rest };
}

// ───────────────────────── Die App starten ─────────────────────────────────

/** Ein frisches, leeres userData-Verzeichnis (wird am Ende geloescht). */
function neuerProfilOrdner(zweck) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `nuvora-desktop-${zweck}-`));
  tempOrdner.add(dir);
  return dir;
}

/**
 * Die Mac-App starten.
 *
 * `profil` ist das userData-Verzeichnis: derselbe Ordner ueber zwei Starts
 * hinweg heisst „dieselbe Installation" — daran haengen der Anmelde-Token im
 * localStorage und der Service-Worker-Cache. Ein FRISCHER Ordner ist der
 * Erststart.
 *
 * `url` leer heisst: keine Adresse bekannt, die App muss setup.html zeigen.
 * NUVORA_URL wird IMMER gesetzt (notfalls leer) — steht es in der Umgebung des
 * Testers, faellt es sonst mitten in den Erststart-Lauf.
 */
async function starteApp(profil, url) {
  const app = await _electron.launch({
    args: [".", `--user-data-dir=${profil}`],
    cwd: DESKTOP,
    executablePath: ELECTRON_BIN,
    env: { ...process.env, NUVORA_URL: url || "" },
    timeout: 60000,
  });
  const seite = await app.firstWindow({ timeout: 30000 });
  await seite.waitForLoadState("domcontentloaded").catch(() => {});
  // Ladefehler meldet nur der Hauptprozess (`did-fail-load`) — im Renderer ist
  // davon nichts zu sehen. Gefiltert wie in apps/desktop/main.js: -3 ist der
  // Abbruch (Seitenwechsel), Unterrahmen ersetzen die Seite nicht.
  await app.evaluate(({ BrowserWindow }) => {
    global.__ladefehler = [];
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.on("did-fail-load", (_e, code, beschreibung, adresse, hauptrahmen) => {
        if (code === -3 || hauptrahmen === false) return;
        global.__ladefehler.push(`did-fail-load ${code} ${beschreibung} ${adresse}`);
      });
    }
  });
  return { app, seite };
}

/** Was der Hauptprozess seit dem letzten Abruf an Ladefehlern gesehen hat. */
const ladefehler = (app) => app.evaluate(() => (global.__ladefehler || []).splice(0));

// ───────────────────────── Beobachter je Seite ─────────────────────────────
//
// Die App hat EIN Fenster, also auch nur EINE Seite: die Beobachter haengen
// einmal dran, und vor jedem Seitenbesuch wird der Eimer geleert. (Im Browser
// legt der Vergleich dagegen je Adresse eine neue Seite an.)
function beobachte(seite) {
  const probleme = [];
  const drossel = [];
  const merke = (text) => { if (probleme.length < 12 && !probleme.includes(text)) probleme.push(text); };
  seite.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (istEgal(text)) return;
    if (istDrosselung(text)) drossel.push("Konsole");
    else merke(`Konsole: ${text.slice(0, 160)}`);
  });
  seite.on("pageerror", (e) => merke(`Absturz: ${String(e).slice(0, 160)}`));
  seite.on("response", (r) => {
    if (r.status() === 429) { drossel.push(new URL(r.url()).pathname); return; }
    if (r.status() >= 400 && !istEgal(r.url())) merke(`HTTP ${r.status()} ${new URL(r.url()).pathname}`);
  });
  return { probleme, drossel, leeren: () => { probleme.length = 0; drossel.length = 0; } };
}

/**
 * Die Einstiegs-Tour wegklicken. Ein frisches Konto bekommt ein Overlay, das
 * ueber der Seite liegt und jeden Klick abfaengt — ohne Wegklicken prueft der
 * Test nur das Overlay. Beschriftungen in allen drei Sprachen (de/en/es).
 */
async function tourWegklicken(seite) {
  const knopf = seite.getByRole("button", { name: /später|spaeter|later|más tarde|mas tarde/i })
    .or(seite.getByRole("button", { name: /überspringen|ueberspringen|skip|saltar|omitir/i })).first();
  for (const runde of [0, 1]) {
    try { if (await knopf.isVisible({ timeout: runde ? 600 : 1200 })) await knopf.click({ timeout: 3000 }); }
    catch { /* kein Overlay da — der Normalfall */ }
    if (!runde) await seite.waitForTimeout(700);
  }
}

/**
 * Eine Seite oeffnen und bewerten — gleiche Massstaebe fuer App und Browser,
 * damit der Vergleich etwas wert ist.
 */
async function rundgang(seite, pfad, probleme) {
  const antwort = await seite.goto(`${URL_BASIS}${pfad}`, { waitUntil: "networkidle", timeout: 30000 });
  if (!antwort || antwort.status() >= 400) return { ok: false, detail: `HTTP ${antwort?.status()}` };
  await tourWegklicken(seite);

  const jetzt = new URL(seite.url()).pathname;
  const drin = jetzt === pfad || jetzt.startsWith(pfad) || pfad.startsWith(jetzt);
  let hinweis = "";
  if (!drin) {
    // `wackelig`: einen Ruecksprung sieht sich der Aufrufer noch einmal an —
    // scheitert der Modul-Abruf einmal, schickt das Gate auf /modules, obwohl
    // das Modul zugeschaltet ist.
    if (jetzt === "/modules") return { ok: false, wackelig: true, detail: "ModuleGate wirft auf /modules zurück (Modul nicht aktiv?)" };
    if (jetzt === "/") return { ok: false, wackelig: true, detail: "landet auf der Startseite — nicht angemeldet?" };
    hinweis = ` → ${jetzt}`;
  }
  const textLaenge = (await seite.locator("body").innerText()).trim().length;
  if (textLaenge < 20) probleme.push("Seite bleibt leer (Render-Fehler?)");
  return probleme.length
    ? { ok: false, detail: probleme.slice(0, 3).join(" | "), probleme: [...probleme] }
    : { ok: true, detail: `${textLaenge} Zeichen gerendert${hinweis}` };
}

/** Ein Besuch mit Wiederholung bei Drosselung oder Ruecksprung. */
async function besuche(oeffne, pfad) {
  const erst = await oeffne(pfad);
  if (!erst.gedrosselt && !erst.wackelig) return erst;
  await warte(erst.gedrosselt ? PAUSE_429 : 1500);
  const zweit = await oeffne(pfad);
  let hinweis = "";
  if (erst.gedrosselt) {
    hinweis = zweit.gedrosselt
      ? `Hinweis: Proxy drosselt weiter (HTTP 429 auf ${zweit.gedrosselt})`
      : `Hinweis: einmal HTTP 429 (Proxy-Drosselung auf ${erst.gedrosselt}), Wiederholung sauber`;
  } else if (zweit.wackelig) hinweis = "auch beim zweiten Versuch";
  return { ...zweit, detail: [zweit.detail, hinweis].filter(Boolean).join(" · ") };
}

/** Eine Adresse in der App aufrufen (ein Fenster, Beobachter zuruecksetzen). */
function appOeffner(seite, app, beobachter) {
  return async (pfad) => {
    beobachter.leeren();
    await ladefehler(app);   // alte Meldungen verwerfen
    try {
      const befund = await mitFrist(rundgang(seite, pfad, beobachter.probleme), FRIST_SEITE, pfad);
      const fehl = await ladefehler(app);
      if (fehl.length) {
        const alle = [...(befund.probleme || []), ...fehl];
        return { ok: false, detail: alle.slice(0, 3).join(" | "), probleme: alle,
                 gedrosselt: [...new Set(beobachter.drossel)].slice(0, 3).join(", ") };
      }
      return { ...befund, gedrosselt: [...new Set(beobachter.drossel)].slice(0, 3).join(", ") };
    } catch (e) {
      return { ok: false, detail: kurzfehler(e, 1), probleme: [kurzfehler(e, 1)],
               gedrosselt: [...new Set(beobachter.drossel)].slice(0, 3).join(", ") };
    }
  };
}

/** Dieselbe Adresse in Chromium (je Adresse eine frische Seite). */
function browserOeffner(kontext) {
  return async (pfad) => {
    const seite = await kontext.newPage();
    const beobachter = beobachte(seite);
    try {
      const befund = await mitFrist(rundgang(seite, pfad, beobachter.probleme), FRIST_SEITE, pfad);
      return { ...befund, gedrosselt: [...new Set(beobachter.drossel)].slice(0, 3).join(", ") };
    } catch (e) {
      return { ok: false, detail: kurzfehler(e, 1), probleme: [kurzfehler(e, 1)],
               gedrosselt: [...new Set(beobachter.drossel)].slice(0, 3).join(", ") };
    } finally {
      await seite.close().catch(() => {});
    }
  };
}

/**
 * Steht dasselbe Problem auch im Browser?
 *
 * Verglichen wird der Anfang der Meldung (die Zahlen darin — HTTP-Status,
 * Pfad — sind Teil davon). Ein Befund, den Chromium genauso zeigt, ist ein
 * Web-Fehler und gehoert selftest-browser.mjs, nicht diesem Test.
 */
const gleicherBefund = (a, b) => a.slice(0, 80) === b.slice(0, 80);

// ───────────────────────── Anmelden ueber das Formular ─────────────────────

/**
 * Ueber die echte Maske anmelden — kein Token in den localStorage geschoben.
 *
 * Genau darum geht es: ob die Anmeldung DURCH die Huelle funktioniert (Formular,
 * fetch, Speicher). Ein untergeschobener Token wuerde das ueberspringen.
 */
async function anmelden(seite) {
  // 60 s statt 30: der erste Aufruf faellt mit dem frisch gestarteten Server
  // zusammen (Deploy, dann sofort die Tests) und traf einmal genau in dessen
  // Aufwaermphase — 31 s fuer den ersten Seitenaufbau, danach lief alles. Ein
  // Timeout, der nur die eigene Startlast misst, ist kein Befund ueber die App.
  await seite.goto(`${URL_BASIS}/login`, { waitUntil: "networkidle", timeout: 60000 });
  const felder = seite.locator("input");
  if (await felder.count() < 2) return { ok: false, detail: "die Anmeldemaske erscheint gar nicht" };
  await seite.locator("input[type=email], input[name=email]").first().fill(EMAIL, { timeout: 8000 });
  await seite.locator("input[type=password]").first().fill(PASSWORT, { timeout: 8000 });
  // Beschriftung in allen drei Sprachen — welche die Maske zeigt, haengt am Geraet.
  await seite.getByRole("button", { name: /anmelden|sign in|login|iniciar/i }).first().click({ timeout: 8000 });
  await seite.waitForTimeout(3000);
  await tourWegklicken(seite);
  const drin = await angemeldet(seite);
  return drin
    ? { ok: true, detail: `als ${EMAIL.replace(/(.).*(@.*)/, "$1…$2")} über das Formular` }
    : { ok: false, detail: `kein Token im localStorage — gelandet auf ${new URL(seite.url()).pathname}` };
}

/** Steckt ein Anmelde-Token im Speicher der App? */
const angemeldet = (seite) => seite.evaluate(() => {
  try { return !!localStorage.getItem("token"); } catch { return false; }
});

// ───────────────────────── Der Lauf ────────────────────────────────────────

async function main() {
  try {
    await lauf();
  } catch (e) {
    notiere("Ablauf", "Desktop-Test", false, kurzfehler(e));
  } finally {
    await kontoZustandHerstellen();
  }
  drucke();
  process.exit(ergebnisse.some((e) => e.art !== "hinweis" && !e.ok) ? 1 : 0);
}

async function lauf() {
  if (!fs.existsSync(ELECTRON_BIN)) {
    notiere("Vorbereitung", "Electron", false,
      `nicht gefunden: ${ELECTRON_BIN} — vorher „npm install" in apps/desktop`);
    return;
  }
  const version = JSON.parse(fs.readFileSync(path.join(DESKTOP, "node_modules", "electron", "package.json"), "utf-8")).version;
  notiere("Vorbereitung", "Electron", true, `Version ${version} aus apps/desktop`);

  // ── Anmelden fuer Vorbereitung und Aufraeumen (die App meldet sich gleich
  //    selbst ueber das Formular an — dieser Token ist nur fuer die API) ──
  const login = await fetch(`${URL_BASIS}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORT }),
  });
  if (login.status === 401)
    throw new Error(`Konto '${EMAIL}' gibt es nicht (oder falsches Passwort). Einmalig unter ${URL_BASIS}/login registrieren und E-Mail bestätigen.`);
  if (login.status === 403) throw new Error(`Konto '${EMAIL}' ist noch nicht per E-Mail bestätigt.`);
  if (!login.ok) throw new Error(`Login fehlgeschlagen: HTTP ${login.status}`);
  token = (await login.json()).token;
  notiere("Vorbereitung", "API-Zugang", true, "Testkonto erreichbar");

  // ── Module zuschalten (Zustand merken, am Ende zuruecksetzen) ──
  const module = await apiJson("/api/modules");
  for (const m of module) {
    if (!m.available || m.active) continue;
    // Vor der Antwort vormerken: bricht der Lauf hier ab, muss auch ein halb
    // durchgelaufenes Zuschalten wieder weg.
    zurueckzustellen.add(m.key);
    const r = await api(`/api/modules/${m.key}/activate`, "POST");
    if (!r.ok) notiere("Vorbereitung", `Modul ${m.key}`, false, `Aktivieren fehlgeschlagen: HTTP ${r.status}`);
  }
  const seiten = [
    ...KERN_SEITEN.map((p) => ({ pfad: p, name: p })),
    ...module.filter((m) => m.available && !m.external).map((m) => ({ pfad: m.path, name: `${m.name} (${m.path})` })),
  ];
  notiere("Vorbereitung", "Seitenliste", true,
    `${KERN_SEITEN.length} Kern-Seiten + ${seiten.length - KERN_SEITEN.length} Module aus /api/modules`);

  // ── Reste des letzten Laufs ──
  const reste = await resteAbraeumen();
  notiere("Vorbereitung", "Reste des letzten Laufs", !reste.rest.length,
    reste.rest.length ? `nicht wegzubekommen: ${reste.rest.join(", ")}`
      : (reste.weg ? `${reste.weg} Reste eines abgebrochenen Laufs abgeräumt` : "keine"));

  // ── 1a. Erststart OHNE Adresse: setup.html ──
  // Eigener Lauf mit leerem userData — mit dem gemerkten Server waere das
  // Setup nie zu sehen, und genau diese Seite bekommt jede Lehrkraft zuerst.
  await erststartProbe();

  // ── 1b. Start MIT Adresse ──
  const profil = neuerProfilOrdner("haupt");
  let { app, seite } = await starteApp(profil, URL_BASIS);
  // Erst nach dem Neustart (2b) gesetzt: die Fenster-/Menuepruefungen davor
  // lesen keine Konsolenmeldungen, und die alte Seite ist danach ohnehin weg.
  let beobachter;
  try {
    const fenster = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w) => ({ titel: w.getTitle(), sichtbar: w.isVisible() })));
    notiere("Start", "Fenster", fenster.length === 1,
      fenster.length === 1 ? `ein Fenster, Titel „${fenster[0].titel}"` : `${fenster.length} Fenster statt einem`);
    // Der Fenstertitel kommt nach dem Laden aus der Seite (<title>), vorher aus
    // BrowserWindow({title}). Beides muss Nuvora heissen — sonst steht im Dock
    // und im Fenster ein fremder Name.
    notiere("Start", "Titel", /nuvora/i.test(fenster[0]?.titel || ""),
      `„${fenster[0]?.titel}"`);
    await seite.waitForLoadState("networkidle").catch(() => {});
    const geladen = seite.url();
    notiere("Start", "Adresse geladen", geladen.startsWith(URL_BASIS),
      geladen.startsWith(URL_BASIS) ? `${new URL(geladen).origin}${new URL(geladen).pathname}` : `lädt ${geladen}`);
    const fehlStart = await ladefehler(app);
    notiere("Start", "kein Ladefehler", fehlStart.length === 0, fehlStart[0] || "sauber geladen");

    // ── 5. Menue und Fenster ──
    await menueProbe(app);
    await fensterProbe(app, seite);

    // ── 2. Anmeldung ueber das echte Formular ──
    const anmeldung = await mitFrist(anmelden(seite), FRIST_SEITE, "/login").catch((e) => ({ ok: false, detail: kurzfehler(e, 1) }));
    notiere("Anmeldung", "Formular", anmeldung.ok, anmeldung.detail);
    if (!anmeldung.ok) {
      notiere("Anmeldung", "Abbruch", false, "ohne Anmeldung sind die Seiten nicht prüfbar");
      return;
    }

    // ── 2b. Neustart: bleibt die Anmeldung? ──
    await app.close().catch(() => {});
    ({ app, seite } = await starteApp(profil, URL_BASIS));
    beobachter = beobachte(seite);
    await seite.waitForLoadState("networkidle").catch(() => {});
    await tourWegklicken(seite);
    const nochDrin = await angemeldet(seite);
    const wo = new URL(seite.url()).pathname;
    notiere("Anmeldung", "überlebt App-Neustart", nochDrin,
      nochDrin ? `Token weiterhin da (${wo})` : `abgemeldet nach Neustart — gelandet auf ${wo}`);

    // ── 4. Vergleich: dieselbe Seitenliste in Chromium ──
    // ZUERST der Browser, damit beim Rundgang durch die App sofort feststeht,
    // ob ein Befund ein Desktop-Befund ist.
    const browser = await chromium.launch();
    const webBefunde = new Map();
    try {
      const kontext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      // Im Vergleichsbrowser genuegt der Token: geprueft wird hier NICHT die
      // Anmeldung (das war Punkt 2), sondern ob dieselbe Seite auch im Browser
      // stolpert.
      await kontext.addInitScript((tok) => {
        try {
          if (!/^https?:$/.test(location.protocol) || !window.localStorage) return;
          localStorage.setItem("token", tok);
        } catch { /* Dokument ohne eigene Herkunft */ }
      }, token);
      const oeffneWeb = browserOeffner(kontext);
      for (const { pfad, name } of seiten) {
        const befund = await besuche(oeffneWeb, pfad);
        webBefunde.set(pfad, befund.probleme || []);
        notiere("Browser-Vergleich (Chromium)", name, befund.ok, befund.detail, "hinweis");
      }
      await kontext.close();
    } finally {
      await browser.close().catch(() => {});
    }

    // ── 3. Seiten in der App ──
    const oeffneApp = appOeffner(seite, app, beobachter);
    for (const { pfad, name } of seiten) {
      const befund = await besuche(oeffneApp, pfad);
      const auchImWeb = (webBefunde.get(pfad) || []);
      const nurApp = (befund.probleme || []).filter((p) => !auchImWeb.some((w) => gleicherBefund(p, w)));
      if (befund.ok) {
        notiere("Seiten", name, true, befund.detail);
      } else if (!nurApp.length) {
        // Derselbe Befund steht auch im Browser: ein Web-Fehler, kein
        // Desktop-Befund. Er verschwindet nicht — er faerbt nur diesen Test
        // nicht rot.
        notiere("Seiten", name, true,
          `Befund auch im Browser (kein Desktop-Befund): ${(befund.probleme || [befund.detail])[0]?.slice(0, 110)}`);
      } else {
        notiere("Seiten", name, false, `NUR in der App: ${nurApp.slice(0, 3).join(" | ")}`);
      }
    }

    // ── 6. Ein echter Handgriff ──
    await handgriffProbe(app, seite, profil);
  } finally {
    await app?.close().catch(() => {});
  }

  // ── Aufraeumen ──
  const nach = await resteAbraeumen();
  notiere("Aufräumen", "Testdaten", !nach.rest.length,
    nach.rest.length ? `Reste: ${nach.rest.join(", ")}` : `${nach.weg} Testdaten restlos entfernt`);
}

/**
 * Erststart ohne Adresse.
 *
 * Frisches userData UND NUVORA_URL leer — nur so ist der Zustand echt, in dem
 * eine Lehrkraft die App zum ersten Mal oeffnet. Erwartet wird setup.html mit
 * einem Eingabefeld, nicht ein leeres Fenster.
 */
async function erststartProbe() {
  const profil = neuerProfilOrdner("erststart");
  let app;
  try {
    ({ app } = await starteApp(profil, ""));
    const seite = await app.firstWindow();
    await seite.waitForLoadState("domcontentloaded");
    const url = seite.url();
    const istSetup = /setup\.html$/.test(new URL(url).pathname);
    notiere("Erststart", "zeigt setup.html", istSetup,
      istSetup ? "leeres Profil → Einrichtung" : `zeigt stattdessen ${url.slice(0, 90)}`);
    if (!istSetup) return;
    const titel = await seite.title();
    const feld = await seite.locator("input#url").count();
    const knopf = await seite.getByRole("button", { name: /verbinden/i }).count();
    notiere("Erststart", "Einrichtung bedienbar", feld === 1 && knopf === 1,
      `„${titel}", ${feld} Adressfeld, ${knopf} Knopf`);
    // Die schmale Bruecke aus preload.js muss stehen — ohne sie kann die
    // Lehrkraft die Adresse eintragen, aber nichts passiert.
    const bruecke = await seite.evaluate(() => typeof window.nuvora?.setUrl);
    notiere("Erststart", "Brücke zum Hauptprozess", bruecke === "function", `window.nuvora.setUrl ist ${bruecke}`);
  } catch (e) {
    notiere("Erststart", "Start ohne Adresse", false, kurzfehler(e, 1));
  } finally {
    await app?.close().catch(() => {});
  }
}

/**
 * Das Menue ist der einzige Weg, die Server-Adresse zu aendern oder neu zu
 * laden — die App hat keine Werkzeugleiste. Fehlt es, sitzt die Lehrkraft auf
 * einer Adresse fest.
 */
async function menueProbe(app) {
  const menue = await app.evaluate(({ Menu }) => {
    const m = Menu.getApplicationMenu();
    if (!m) return null;
    return m.items.map((i) => ({ label: i.label, unter: (i.submenu?.items || []).map((u) => u.label) }));
  });
  if (!menue) { notiere("Menü", "aufgebaut", false, "kein Anwendungsmenü gesetzt"); return; }
  const labels = menue.map((i) => i.label);
  notiere("Menü", "aufgebaut", menue.length >= 3, `${menue.length} Einträge: ${labels.join(", ")}`);
  for (const soll of ["Ansicht", "Server"]) {
    const eintrag = menue.find((i) => i.label === soll);
    notiere("Menü", soll, !!eintrag && eintrag.unter.length > 0,
      eintrag ? `${eintrag.unter.filter(Boolean).length} Einträge` : "fehlt");
  }
  const server = menue.find((i) => i.label === "Server");
  const kannAendern = (server?.unter || []).some((l) => /adresse/i.test(l || ""));
  notiere("Menü", "Server-Adresse änderbar", kannAendern,
    kannAendern ? "Eintrag „Server-Adresse ändern…“ ist da" : "kein Eintrag zum Ändern der Adresse");
}

/**
 * `window.open` darf kein zweites Fenster aufmachen (setWindowOpenHandler =
 * deny); http/https/mailto gehen in den echten Browser.
 *
 * shell.openExternal wird VORHER durch eine Attrappe ersetzt — sonst reisst der
 * Test dem Tester mitten im Lauf den Standardbrowser auf. Geprueft wird damit
 * beides: kein zweites Fenster UND die Adresse geht nach draussen.
 */
async function fensterProbe(app, seite) {
  await app.evaluate(({ shell }) => {
    global.__extern = [];
    shell.openExternal = (u) => { global.__extern.push(u); return Promise.resolve(); };
  });
  const vorher = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  await seite.evaluate(() => { try { window.open("https://beispiel.invalid/fremd", "_blank"); } catch { /* geblockt ist auch gut */ } });
  await warte(1000);
  const nachher = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  notiere("Fenster", "window.open öffnet kein zweites Fenster", nachher === vorher,
    nachher === vorher ? `weiterhin ${nachher} Fenster` : `${nachher} statt ${vorher} Fenster — setWindowOpenHandler greift nicht`);
  const extern = await app.evaluate(() => global.__extern || []);
  notiere("Fenster", "fremde Adresse geht an den Browser", extern.length === 1,
    extern.length === 1 ? "shell.openExternal einmal aufgerufen" : `openExternal ${extern.length}× aufgerufen`);
}

/**
 * Der Beweis, dass Schreiben durch die Huelle wirklich beim Server ankommt:
 * Notizzettel ueber die Oberflaeche anlegen, App NEU STARTEN (nicht nur die
 * Seite neu laden — nur der Neustart schliesst einen Cache im Renderer aus),
 * dann muss der Zettel noch da sein.
 */
async function handgriffProbe(app, seite, profil) {
  try {
    await seite.goto(`${URL_BASIS}/notizbrett`, { waitUntil: "networkidle", timeout: 30000 });
    await tourWegklicken(seite);
    // Beschriftung je nach Sprache des Kontos.
    await seite.getByRole("button", { name: /neuer? zettel|neu$|new note|new$|nueva? nota/i })
      .first().click({ timeout: 8000 });
    const feld = seite.locator("input[placeholder]").first();
    await feld.fill(MARKE, { timeout: 8000 });
    // Der Zettel speichert gebuendelt (600 ms) — abwarten, sonst prueft der
    // Neustart gegen einen nie gesendeten Stand.
    await seite.waitForTimeout(1500);
    notiere("Bedienung", "Notizzettel anlegen (/notizbrett)", true, `„${MARKE}" getippt`);
  } catch (e) {
    notiere("Bedienung", "Notizzettel anlegen (/notizbrett)", false, kurzfehler(e, 1));
    return;
  }
  // Der Beweis kommt vom Server, nicht aus der App: liegt der Zettel dort, ist
  // er wirklich durch die Huelle gegangen.
  const beimServer = (await apiJson("/api/notizblock") || []).some((n) => (n.title || "").includes(MARKE));
  notiere("Bedienung", "beim Server angekommen", beimServer,
    beimServer ? "steht in /api/notizblock" : "der Server kennt den Zettel nicht — nur lokal getippt?");

  await app.close().catch(() => {});
  let neu;
  try {
    neu = await starteApp(profil, URL_BASIS);
    await neu.seite.goto(`${URL_BASIS}/notizbrett`, { waitUntil: "networkidle", timeout: 30000 });
    await tourWegklicken(neu.seite);
    await neu.seite.waitForTimeout(1000);
    const text = await neu.seite.locator("body").innerText();
    const drin = text.includes(MARKE) || (await neu.seite.locator(`input[value='${MARKE}']`).count()) > 0;
    notiere("Bedienung", "überlebt den App-Neustart", drin,
      drin ? "der Zettel ist nach dem Neustart noch da" : "nach dem Neustart verschwunden");
  } catch (e) {
    notiere("Bedienung", "überlebt den App-Neustart", false, kurzfehler(e, 1));
  } finally {
    await neu?.app.close().catch(() => {});
  }
}

/**
 * Zusammenfassung. Die Einzelzeilen sind waehrend des Laufs schon erschienen;
 * hier steht nur noch, was schiefging — nach URSACHE gebuendelt, damit ein
 * Fehler, der jede Seite trifft, EIN Befund ist und nicht achtzig Zeilen.
 */
function drucke() {
  const pruefungen = ergebnisse.filter((e) => e.art !== "hinweis");
  const hinweise = ergebnisse.filter((e) => e.art === "hinweis");
  const fehler = pruefungen.filter((e) => !e.ok);
  const webRot = hinweise.filter((e) => !e.ok).length;
  console.log("\n" + "=".repeat(40));
  const vergleich = hinweise.length
    ? `Browser-Vergleich: ${hinweise.length} Seiten in Chromium${webRot ? `, davon ${webRot} auch dort auffällig (Web-Sache, siehe selftest-browser.mjs)` : " ohne Befund"}`
    : "Browser-Vergleich: nicht gelaufen";
  if (!fehler.length) {
    console.log(`  ${GRUEN}Desktop-Test grün${AUS} — ${pruefungen.length} Prüfungen in ${seit().trim()}.`);
    console.log(`  ${GRAU}${vergleich}${AUS}`);
    console.log("=".repeat(40));
    return;
  }
  console.log(`  ${ROT}${FETT}Desktop-Test ROT${AUS} — ${fehler.length} von ${pruefungen.length} Prüfungen.`);
  console.log(`  ${GRAU}${vergleich}${AUS}`);
  const nachGrund = new Map();
  for (const f of fehler) {
    const grund = f.detail || "(ohne Detail)";
    if (!nachGrund.has(grund)) nachGrund.set(grund, []);
    nachGrund.get(grund).push(`${f.gruppe} / ${f.name}`);
  }
  for (const [grund, wo] of nachGrund) {
    const rest = wo.length > 3 ? ` (und ${wo.length - 3} weitere)` : "";
    console.log(`${ROT}  ✗ ${wo.slice(0, 3).join(", ")}${rest}${AUS}`);
    console.log(`      ${grund}`);
  }
  console.log("=".repeat(40));
}

main();
