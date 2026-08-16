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
import {
  zugang, macheIstEgal, macheBericht, druckeBericht, abbruchBremse, macheFetchApi,
  anmeldenApi, modulZustandStellen, traegtMarke, dialogeAnnehmen, beobachte,
  tourWegklicken, anmeldungHinterlegen, rundgang, geduldig, mitFrist, warte,
  kurzfehler, KERN_SEITEN, FRIST_SEITE, ROT, GRUEN, AUS,
} from "./browser-gemeinsam.mjs";

const { basis: URL_BASIS, email: EMAIL, passwort: PASSWORT } = zugang();

const HIER = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(HIER, "..", "apps", "desktop");
// Playwright sucht die Electron-Binaerdatei sonst im eigenen node_modules; sie
// liegt aber bei der App (apps/desktop/node_modules) — das ist genau die
// Version, die auch die fertige Mac-App traegt, und nur die soll geprueft
// werden.
const ELECTRON_BIN = path.join(DESKTOP, "node_modules", "electron", "dist",
  process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron"
  : process.platform === "win32" ? "electron.exe" : "electron");

// Marke, an der alles Angelegte erkennbar ist — und wieder wegkommt.
const MARKE = "ZZ-Desktop";

// ── Bekanntes Rauschen, das es NUR hier gibt ──────────────────────────────
//
// Jede Zeile ist eine Ausnahme MIT Grund. Was hier steht, verschluckt der Test
// — deshalb steht hier nur, was nachweislich nichts ueber die Gesundheit der
// App sagt. Der gemeinsame Grundstock steht in browser-gemeinsam.mjs.
const istEgal = macheIstEgal([
  // net::ERR_ABORTED entsteht, wenn eine Seite gewechselt wird, waehrend ihre
  // fetches noch laufen: React raeumt beim Unmount ab, Chromium meldet den
  // Abbruch. Dieser Test klappert Dutzende Seiten in Folge ab und erzeugt das
  // damit selbst. Ein echter Ladefehler traegt einen anderen Code (ERR_FAILED,
  // ERR_CONNECTION_REFUSED, ERR_NAME_NOT_RESOLVED) und bleibt ein Befund.
  /ERR_ABORTED/,
  // Electrons eigener Sicherheitshinweis im Entwicklungsmodus. Er erscheint,
  // weil die App unverpackt (`electron .`) laeuft — in der gebauten App nicht.
  /Electron Security Warning/i,
]);

// Die Anmeldung darf laenger dauern als eine Seite: faellt sie in die
// Login-Drosselung des Servers (5 Versuche je Minute), wartet sie die
// Sperrfrist ab und versucht es noch einmal.
const FRIST_ANMELDUNG = 150000;

// Der Bericht: „hinweis"-Zeilen zaehlen NICHT fuer das Ergebnis. Damit stehen
// die Chromium-Vergleichszeilen im Bericht (man sieht, ob der Vergleich
// ueberhaupt gelaufen ist), ohne dass ein Web-Fehler die Mac-App rot faerbt.
// Dafuer gibt es selftest-browser.mjs.
const { ergebnisse, notiere } = macheBericht({ gruppePraefix: () => "[desktop] " });

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

// HTTP ohne Browser: die Electron-App kann tot sein, wenn hier noch
// aufgeraeumt wird (siehe `macheFetchApi` in browser-gemeinsam.mjs).
const { api, apiJson } = macheFetchApi(URL_BASIS, () => token);

async function kontoZustandHerstellen(ohneBericht = false) {
  if (aufgeraeumt) return;
  aufgeraeumt = true;
  for (const ordner of tempOrdner) {
    try { fs.rmSync(ordner, { recursive: true, force: true }); } catch { /* Reste im Temp sind harmlos */ }
  }
  if (!token) return;
  const { falsch } = await modulZustandStellen({ basis: URL_BASIS, token, keys: zurueckzustellen });
  const gut = falsch.length === 0;
  const text = gut
    ? (zurueckzustellen.size ? `${zurueckzustellen.size} zugeschaltete Module wieder aus` : "nichts zu tun")
    : `stimmt NICHT: ${falsch.join(", ")}`;
  if (ohneBericht) console.error(`\n${gut ? GRUEN : ROT}Modul-Zustand: ${text}${AUS}`);
  else notiere("Aufräumen", "Modulzustand", gut, text);
}

abbruchBremse(() => kontoZustandHerstellen(true),
  "stelle den Zustand des Kontos wieder her …");

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
    if (!traegtMarke(eintrag, MARKE)) continue;
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
  dialogeAnnehmen(seite);
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
// legt der Vergleich dagegen je Adresse eine neue Seite an.) Aufbau und
// Deckelung stehen in `beobachte` in browser-gemeinsam.mjs.
const beobachteSeite = (seite) => beobachte(seite, istEgal);

/** Ein Besuch mit Wiederholung bei Drosselung oder Ruecksprung. */
const besuche = (oeffne, pfad) => geduldig(() => oeffne(pfad));

/** Eine Adresse in der App aufrufen (ein Fenster, Beobachter zuruecksetzen). */
function appOeffner(seite, app, beobachter) {
  return async (pfad) => {
    beobachter.leeren();
    await ladefehler(app);   // alte Meldungen verwerfen
    try {
      const befund = await mitFrist(rundgang(seite, pfad, beobachter.probleme, { basis: URL_BASIS }), FRIST_SEITE, pfad);
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
    dialogeAnnehmen(seite);   // siehe dort: die Verlassen-Warnung braucht ein „Ja"
    const beobachter = beobachteSeite(seite);
    try {
      const befund = await mitFrist(rundgang(seite, pfad, beobachter.probleme, { basis: URL_BASIS }), FRIST_SEITE, pfad);
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
  // Die App navigiert beim Start selbst (Shell -> „/"). Faellt unser Aufruf
  // genau dahinein, bricht Playwright ihn ab: „interrupted by another
  // navigation". Das ist kein Befund ueber die App, sondern ein Rennen — also
  // erst abwarten, bis die eigene Navigation durch ist, dann gehen, und den
  // Abbruch einmal verzeihen.
  // Kurz warten, bis die App ihre eigene Start-Navigation hinter sich hat —
  // NICHT bis das Netz ruhig ist: der Service Worker der Huelle haelt genug
  // Verkehr, dass „networkidle" nie eintritt. Mit 60 s Frist war die ganze
  // Zeit dieses Schritts damit verbraucht, bevor auch nur `/login` aufgerufen
  // wurde — der Test meldete eine Zeitueberschreitung, obwohl die Maske sofort
  // dagestanden haette. Der Wiederholungslauf unten verzeiht ohnehin, wenn ein
  // Aufruf mitten in die App-Navigation faellt.
  await seite.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
  // Warten, bis die Huelle STILLSTEHT — nicht bis das Netz ruhig ist.
  // Beim Start laedt sie „/", die Shell schickt einen ohne Token weiter auf
  // „/login": zwei Navigationen hintereinander. Wer mittendrin selbst
  // navigiert oder tippt, verliert das Rennen — der Test landete dann auf „/"
  // ohne Token und meldete das als kaputte Anmeldung.
  let vorher = "";
  for (let i = 0; i < 40; i++) {
    const jetzt = seite.url();
    if (jetzt === vorher) break;
    vorher = jetzt;
    await seite.waitForTimeout(500);
  }
  // Steht die Maske schon da, gar nicht erst navigieren: die Huelle schickt
  // sich beim Start selbst auf /login, wenn kein Token da ist. Ein eigener
  // Aufruf mitten hinein wird von Playwright als „interrupted by another
  // navigation" abgebrochen — kein Befund ueber die App, nur ein Rennen.
  const schonDa = () => /\/login\/?$/.test(new URL(seite.url()).pathname + "/");
  for (const versuch of [0, 1, 2]) {
    if (schonDa()) break;
    try {
      // `domcontentloaded` statt `networkidle`: in der Huelle laeuft ein
      // Service Worker, und der haelt genug Verkehr, dass „das Netz ist
      // ruhig" nie eintritt — der Aufruf lief in sein Zeitlimit, obwohl die
      // Maske laengst dastand. Gewartet wird deshalb auf das, worauf es
      // ankommt: das Passwortfeld.
      await seite.goto(`${URL_BASIS}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await seite.locator("input[type=password]").first().waitFor({ state: "visible", timeout: 12000 });
      break;
    } catch (e) {
      // Beim letzten Versuch sagen, WAS statt der Maske dastand — sonst meldet
      // der Test nur „Timeout" und man raet, ob die Huelle, der Server oder
      // ein Rennen schuld war.
      if (versuch >= 2) {
        const wo = new URL(seite.url()).pathname;
        const text = (await seite.locator("body").innerText().catch(() => "")).slice(0, 120).replace(/\s+/g, " ");
        return { ok: false, detail: `Anmeldemaske erscheint nicht — auf ${wo} steht: „${text}"` };
      }
      await seite.waitForTimeout(2000);
    }
  }
  const felder = seite.locator("input");
  if (await felder.count() < 2) return { ok: false, detail: "die Anmeldemaske erscheint gar nicht" };

  // Der Server laesst fuenf Anmeldeversuche je Minute und IP zu (auth.py,
  // MAX_LOGIN_ATTEMPTS). Dieser Test laeuft als LETZTER einer Kette, die sich
  // alle am selben Konto anmelden — wer davor viel geprueft hat, bekommt hier
  // eine 429 und der Test meldete „kein Token", als waere die Huelle kaputt.
  // Die Absage ist aber richtiges Verhalten des Servers: also einmal die
  // Sperrfrist abwarten und wiederholen, statt das Limit zu lockern.
  let abgewiesen = false;
  const aufLogin = (a) => { if (a.url().includes("/api/auth/login") && a.status() === 429) abgewiesen = true; };
  seite.on("response", aufLogin);

  const versuchen = async () => {
    abgewiesen = false;
    await seite.locator("input[type=email], input[name=email]").first().fill(EMAIL, { timeout: 8000 });
    await seite.locator("input[type=password]").first().fill(PASSWORT, { timeout: 8000 });
    // Beschriftung in allen drei Sprachen — welche die Maske zeigt, haengt am Geraet.
    await seite.getByRole("button", { name: /anmelden|sign in|login|iniciar/i }).first().click({ timeout: 8000 });
    await seite.waitForTimeout(3000);
    await tourWegklicken(seite);
    return await angemeldet(seite);
  };

  let drin = await versuchen();
  if (!drin && abgewiesen) {
    notiere("Anmeldung", "Sperrfrist", true, "Server drosselt (429) — 65 s warten und noch einmal", "hinweis");
    await warte(65000);
    drin = await versuchen();
  }
  seite.off("response", aufLogin);
  return drin
    ? { ok: true, detail: `als ${EMAIL.replace(/(.).*(@.*)/, "$1…$2")} über das Formular` }
    : { ok: false, detail: `kein Token im localStorage — gelandet auf ${new URL(seite.url()).pathname}` };
}

/**
 * `evaluate`, das eine laufende Navigation ueberlebt.
 *
 * Die Huelle navigiert beim Start und nach der Anmeldung selbst. Faellt ein
 * `evaluate` genau hinein, ist der Ausfuehrungskontext weg („Execution context
 * was destroyed") — und weil der Fehler bis nach oben durchschlaegt, endete der
 * GANZE Desktop-Lauf mit einer einzigen Zeile. Das ist ein Rennen, kein Befund:
 * also abwarten und ein zweites Mal versuchen.
 */
async function ruhigEvaluate(seite, fn, arg, standard = null) {
  for (const versuch of [0, 1, 2]) {
    try {
      return await seite.evaluate(fn, arg);
    } catch (e) {
      if (!/Execution context was destroyed|Target closed|navigation/i.test(String(e))) throw e;
      if (versuch === 2) return standard;
      await seite.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
      await seite.waitForTimeout(800);
    }
  }
  return standard;
}

/** Steckt ein Anmelde-Token im Speicher der App? */
const angemeldet = (seite) => ruhigEvaluate(seite, () => {
  try { return !!localStorage.getItem("token"); } catch { return false; }
}, undefined, false);

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
  token = (await anmeldenApi(URL_BASIS, EMAIL, PASSWORT)).token;
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
    const anmeldung = await mitFrist(anmelden(seite), FRIST_ANMELDUNG, "/login").catch((e) => ({ ok: false, detail: kurzfehler(e, 1) }));
    notiere("Anmeldung", "Formular", anmeldung.ok, anmeldung.detail);
    if (!anmeldung.ok) {
      notiere("Anmeldung", "Abbruch", false, "ohne Anmeldung sind die Seiten nicht prüfbar");
      return;
    }

    // ── 2b. Neustart: bleibt die Anmeldung? ──
    await app.close().catch(() => {});
    ({ app, seite } = await starteApp(profil, URL_BASIS));
    beobachter = beobachteSeite(seite);
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
      // stolpert. Also ohne Nutzerdaten und ohne die Tour-Merker — die App
      // nebenan hat sie auch nicht, und der Vergleich soll fair sein.
      await anmeldungHinterlegen(kontext, token, null, { touren: false });
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
    const bruecke = await ruhigEvaluate(seite, () => typeof window.nuvora?.setUrl, undefined, "undefined");
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
  await ruhigEvaluate(seite, () => { try { window.open("https://beispiel.invalid/fremd", "_blank"); } catch { /* geblockt ist auch gut */ } });
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
    // Frueher speicherte der Zettel von selbst (600 ms nach dem letzten
    // Tastendruck) und der Test wartete das nur ab. Jetzt gilt: getippt ist
    // NICHT gespeichert — erst der Knopf schickt es hin. Der Hinweis „nicht
    // gespeichert" ist der Beleg, dass wirklich etwas offen war.
    const offen = seite.getByText(/nicht gespeichert|unsaved|sin guardar/i).first();
    await offen.waitFor({ state: "visible", timeout: 8000 });
    // Beschriftung aus `common.save`; das Testkonto laeuft teils auf Englisch,
    // darum alle drei Sprachen in EINEM Muster.
    await seite.getByRole("button", { name: /^(Speichern|Save|Guardar)$/ }).first().click({ timeout: 8000 });
    // Auf das Ergebnis warten, nicht auf die Uhr.
    await offen.waitFor({ state: "hidden", timeout: 15000 });
    notiere("Bedienung", "Notizzettel anlegen (/notizbrett)", true, `„${MARKE}" getippt und gespeichert`);
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

/** Zusammenfassung — Aufbau und Buendelung siehe `druckeBericht`. */
function drucke() {
  const hinweise = ergebnisse.filter((e) => e.art === "hinweis");
  const webRot = hinweise.filter((e) => !e.ok).length;
  return druckeBericht(ergebnisse, {
    titel: "Desktop-Test",
    zusatzzeile: hinweise.length
      ? `Browser-Vergleich: ${hinweise.length} Seiten in Chromium${webRot ? `, davon ${webRot} auch dort auffällig (Web-Sache, siehe selftest-browser.mjs)` : " ohne Befund"}`
      : "Browser-Vergleich: nicht gelaufen",
  });
}

main();
