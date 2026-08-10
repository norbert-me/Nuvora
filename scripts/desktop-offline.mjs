/**
 * Nuvora Desktop — das Offline-Versprechen nachhalten (Playwright + Electron).
 *
 * Die Desktop-App verspricht in README und `apps/desktop/main.js` genau eine
 * Sache, die die Weboberflaeche allein nicht kann: **offline lesen**. Dieses
 * Skript prueft dieses Versprechen und sonst nichts — der Rundgang durch Start,
 * Seiten, Menue und Handgriffe steht in `scripts/desktop-test.mjs`.
 *
 * Warum es das gibt: auf der real konfigurierten Adresse (http auf einer IP im
 * Schulnetz) gab es lange gar keinen Service-Worker — `navigator.serviceWorker`
 * war nicht vorhanden, weil Chromium ihn nur im "secure context" herausgibt.
 * Das Offline-Lesen hat es dort also nie gegeben, und niemand hat es gemerkt.
 * Ein Versprechen, das niemand prueft, ist keins.
 *
 * Geprueft wird in dieser Reihenfolge:
 *   1. Ist ueberhaupt ein Service-Worker da? (secure context, Registrierung,
 *      Nuvora-Caches) — schlaegt das fehl, ist alles Weitere gegenstandslos.
 *   2. Offline lesen: online anmelden, Seiten besuchen, Netz kappen, neu laden.
 *   3. Deep-Link offline: eine Adresse, die online NIE besucht wurde.
 *   4. Echte Inhaltsdaten offline: Klasse + zwei Kinder, Namen muessen bleiben.
 *   5. Fehlerfall tote Adresse: erkennbare deutsche Auskunft, kein leeres Fenster.
 *
 * Nutzung:  node scripts/desktop-offline.mjs --url … --email … --passwort …
 *           (oder SELFTEST_URL/SITE_URL, SELFTEST_EMAIL, SELFTEST_PASSWORD)
 * Rueckgabewert: 0 = gruen, 1 = mindestens ein Fehler, 2 = Aufruf unbrauchbar.
 *
 * Testdaten tragen das Praefix ZZ-Desktop-Offline, werden vor dem Aufbau und am
 * Ende abgeraeumt (inklusive Papierkorb); was bleibt, steht unter „Reste".
 */
import { _electron } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HIER = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HIER, "..", "apps", "desktop");

const arg = (name, fallback) => {
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

// Electron liegt in apps/desktop/node_modules, Playwright in scripts/node_modules
// — zwei getrennte Projekte, also findet Playwright die Binaerdatei nicht von
// selbst. `path.txt` ist der vom electron-Paket vorgesehene Weg dorthin.
function electronPfad() {
  const wurzel = path.join(APP_DIR, "node_modules", "electron");
  try {
    const rel = fs.readFileSync(path.join(wurzel, "path.txt"), "utf-8").trim();
    const voll = path.join(wurzel, "dist", rel);
    return fs.existsSync(voll) ? voll : null;
  } catch { return null; }
}

const MARKE = "ZZ-Desktop-Offline";
const KIND_A = `${MARKE} Kind Eins`;
const KIND_B = `${MARKE} Kind Zwei`;

// ── Ausgabe (Ton und Aufbau wie scripts/selftest-browser.mjs) ──────────────
const FARBE = process.stdout.isTTY && !process.env.NO_COLOR;
const ROT = FARBE ? "\x1b[31m" : "";
const GRUEN = FARBE ? "\x1b[32m" : "";
const GRAU = FARBE ? "\x1b[90m" : "";
const FETT = FARBE ? "\x1b[1m" : "";
const AUS = FARBE ? "\x1b[0m" : "";

const ergebnisse = [];
const START = Date.now();
const seit = () => `${String(Math.round((Date.now() - START) / 1000)).padStart(4)}s`;
let letzteGruppe = null;
const notiere = (gruppe, name, ok, detail = "") => {
  ergebnisse.push({ gruppe, name, ok, detail });
  if (gruppe !== letzteGruppe) {
    console.log(`\n${FETT}── ${gruppe}${AUS}`);
    letzteGruppe = gruppe;
  }
  const zeile = `${name}${detail ? `   ${detail}` : ""}`;
  console.log(`  ${GRAU}${seit()}${AUS} ${ok ? `${GRUEN}✓${AUS} ${zeile}` : `${ROT}✗ ${zeile}${AUS}`}`);
};

const kurz = (e, n = 140) => String(e?.message || e).split("\n")[0].slice(0, n);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

/** Harte Frist um eine Zusage — ein Haenger darf den Lauf nicht verschlucken. */
function mitFrist(zusage, ms, was) {
  let uhr;
  const frist = new Promise((_, ab) => {
    uhr = setTimeout(() => ab(new Error(`Zeitüberschreitung nach ${Math.round(ms / 1000)}s (${was})`)), ms);
  });
  return Promise.race([zusage, frist]).finally(() => clearTimeout(uhr));
}

// ── API ohne Browser ───────────────────────────────────────────────────────
let token = null;
const api = async (pfad, methode = "GET", data) => {
  const r = await fetch(`${URL_BASIS}${pfad}`, {
    method: methode,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { "content-type": "application/json" } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  return r;
};
const apiJson = async (pfad) => {
  const r = await api(pfad);
  if (!r.ok) throw new Error(`GET ${pfad}: HTTP ${r.status}`);
  return r.json();
};

/**
 * Reste abraeumen — vor dem Aufbau und am Ende.
 *
 * Sicherheitsnetz wie in scripts/aufraeumen.py: geprueft wird die Marke
 * unmittelbar vor dem Loeschen, nicht nur bei der Auswahl. Geloescht wird weich
 * UND aus dem Papierkorb, sonst sammelt sich der Testmuell dort an.
 * Rueckgabe: { weg, reste } — `reste` ist ein Befund, kein Rauschen.
 */
async function abraeumen() {
  let weg = 0;
  const reste = [];
  for (const pfad of ["/api/classes", "/api/classes/trash"]) {
    let liste;
    try { liste = await apiJson(pfad); } catch (e) { reste.push(`${pfad}: ${kurz(e, 60)}`); continue; }
    for (const k of liste) {
      if (!String(k.name || "").includes(MARKE)) continue;   // Marke direkt vor dem Loeschen
      try {
        if (pfad === "/api/classes") await api(`/api/classes/${k.id}`, "DELETE");  // weich -> Papierkorb
        const p = await api(`/api/classes/${k.id}/purge`, "DELETE");               // endgueltig
        if (p.ok || p.status === 204) weg++;
        else reste.push(`${k.name}: purge HTTP ${p.status}`);
      } catch (e) { reste.push(`${k.name}: ${kurz(e, 60)}`); }
    }
  }
  return { weg, reste };
}

// Abbruch: die Testklasse darf nicht im fremden Konto liegen bleiben.
let abbruchLaeuft = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (abbruchLaeuft) process.exit(130);
    abbruchLaeuft = true;
    console.error(`\n${ROT}Abbruch (${signal}) — räume die Testdaten weg …${AUS}`);
    try { await Promise.race([abraeumen(), warte(15000)]); } catch { /* gleich raus */ }
    process.exit(130);
  });
}

/** Einstiegs-Tour wegklicken (frisches Profil legt ein Overlay ueber alles). */
async function tourWegklicken(seite) {
  const knopf = seite.getByRole("button", { name: /später|spaeter|later|más tarde|mas tarde/i })
    .or(seite.getByRole("button", { name: /überspringen|ueberspringen|skip|saltar|omitir/i })).first();
  for (const runde of [0, 1]) {
    try {
      if (await knopf.isVisible({ timeout: runde ? 600 : 1200 })) await knopf.click({ timeout: 3000 });
    } catch { /* kein Overlay — der Normalfall */ }
    if (!runde) await seite.waitForTimeout(500);
  }
}

/** Sichtbarer Text des Fensters, robust auch wenn gerade nichts gerendert ist. */
const text = (seite) => seite.evaluate(() => (document.body ? document.body.innerText : "")).catch(() => "");

async function starteApp(url, exe) {
  return _electron.launch({
    args: ["."],
    executablePath: exe,
    cwd: APP_DIR,
    // NUVORA_URL hat in main.js Vorrang vor der gespeicherten Einstellung —
    // der Test fasst die Einstellung der Lehrkraft nicht an.
    env: { ...process.env, NUVORA_URL: url },
  });
}

async function main() {
  const exe = electronPfad();
  if (!exe) {
    notiere("Vorbereitung", "Electron gefunden", false,
      `keine Binärdatei in ${path.join(APP_DIR, "node_modules", "electron")} — vorher „npm install" in apps/desktop`);
    return drucke();
  }
  notiere("Vorbereitung", "Electron gefunden", true, path.relative(HIER, exe));

  // ── Anmelden (wie die Shell: Token in den localStorage) ──
  const login = await fetch(`${URL_BASIS}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORT }),
  }).catch((e) => ({ ok: false, status: 0, _e: e }));
  if (!login.ok) {
    const grund = login.status === 401 ? `Konto gibt es nicht (oder falsches Passwort) — einmalig unter ${URL_BASIS}/login registrieren und E-Mail bestätigen`
      : login.status === 403 ? "Konto ist noch nicht per E-Mail bestätigt"
      : login.status ? `HTTP ${login.status}` : kurz(login._e);
    notiere("Vorbereitung", "Anmeldung", false, grund);
    return drucke();
  }
  const { token: t, user } = await login.json();
  token = t;
  notiere("Vorbereitung", "Anmeldung", true, `als ${user.email}`);

  // ── Reste des letzten Laufs ──
  const vorher = await abraeumen();
  notiere("Vorbereitung", "Reste des letzten Laufs", !vorher.reste.length,
    vorher.reste.length ? `Reste: ${vorher.reste.slice(0, 3).join(" | ")}`
      : vorher.weg ? `${vorher.weg} Reste eines abgebrochenen Laufs abgeräumt` : "keine");

  // ── Testklasse anlegen: erst damit heisst „offline lesbar" mehr als „rendert" ──
  let klasse = null;
  try {
    const r = await api("/api/classes", "POST", {
      name: `${MARKE} Klasse`,
      students: [{ card_id: 1, name: KIND_A }, { card_id: 2, name: KIND_B }],
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    klasse = await r.json();
    notiere("Vorbereitung", "Testklasse angelegt", true, `„${klasse.name}" mit 2 Kindern`);
  } catch (e) {
    notiere("Vorbereitung", "Testklasse angelegt", false, kurz(e));
  }

  try {
    await mitFrist(offlineProbe(exe, user), 5 * 60 * 1000, "Offline-Probe")
      .catch((e) => notiere("Ablauf", "Offline-Probe", false, kurz(e)));
    await mitFrist(toteAdresse(exe), 2 * 60 * 1000, "Fehlerfall tote Adresse")
      .catch((e) => notiere("Ablauf", "Fehlerfall tote Adresse", false, kurz(e)));
  } finally {
    const nach = await abraeumen();
    notiere("Aufräumen", "Testdaten", !nach.reste.length,
      nach.reste.length ? `Reste: ${nach.reste.slice(0, 3).join(" | ")}` : `${nach.weg} Testdaten restlos entfernt`);
  }
  drucke();
}

/**
 * Netz kappen — und BEWEISEN, dass es gekappt ist.
 *
 * Drei Wege standen zur Wahl, gemessen wurde an der laufenden App:
 *
 *  - `session.enableNetworkEmulation({offline:true})` im Hauptprozess: sieht
 *    richtig aus, hat aber NICHTS gekappt — die Sonde bekam weiter HTTP 200.
 *    Damit waere jeder Offline-Test still gruen geworden, ohne je offline zu sein.
 *  - eigener TCP-Weiterleiter auf 127.0.0.1, Verbindungen zerstoeren: kappt
 *    sicher, aendert aber die Herkunft auf loopback — und loopback gilt Chromium
 *    als sicherer Kontext. Genau die Frage aus Pruefung 1 (gibt es auf http-IP
 *    ueberhaupt einen Service-Worker?) waere damit weggemogelt.
 *  - `page.context().setOffline(true)`: kappt, und zwar bis in den
 *    Service-Worker hinein — die Sonde unten geht durch dessen fetch-Handler und
 *    scheitert. Deshalb dieser Weg.
 *
 * Die Sonde bleibt trotzdem stehen: sie fragt einen cachebaren, aber nie
 * gecachten API-Pfad. Antwortet der noch, ist das Netz nicht wirklich weg —
 * dann sind die folgenden Pruefungen wertlos, und das sagt der Bericht.
 */
async function netzKappen(seite) {
  await seite.context().setOffline(true);
  await warte(500);
  const sonde = await seite.evaluate(async () => {
    try { const r = await fetch(`/api/classes?offline-sonde=${Math.random()}`); return `HTTP ${r.status}`; }
    catch (e) { return `Fehler: ${e.message}`; }
  });
  const gekappt = !/^HTTP 2/.test(sonde);
  notiere("Offline lesen", "Verbindung wirklich gekappt", gekappt,
    gekappt ? `Sonde durch den Service-Worker: ${sonde}` : `Sonde antwortet weiter (${sonde}) — alles Folgende ist wertlos`);
  return gekappt;
}

async function offlineProbe(exe, user) {
  const app = await starteApp(URL_BASIS, exe);
  let seite;
  try {
    seite = await app.firstWindow();
    await seite.waitForLoadState("domcontentloaded").catch(() => {});
    const geladen = seite.url().startsWith(URL_BASIS);
    notiere("Start", "Fenster lädt die konfigurierte Adresse", geladen, geladen ? seite.url() : `stattdessen: ${seite.url()}`);

    // Anmeldung wie die Shell, dann neu laden, damit React sie sieht.
    await seite.evaluate(([tok, usr]) => {
      localStorage.setItem("token", tok);
      localStorage.setItem("user", usr);
    }, [token, JSON.stringify(user)]).catch(() => {});
    await seite.goto(`${URL_BASIS}/`, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
    await tourWegklicken(seite);

    // ── 1. Ist ueberhaupt ein Service-Worker da? ──
    //
    // Die Kernfrage. Ohne ihn gibt es kein Offline-Lesen — dann ist alles
    // Weitere gegenstandslos, und der Bericht sagt genau das, samt Grund.
    const sw = await seite.evaluate(async () => {
      const vorhanden = !!navigator.serviceWorker;
      let regs = -1;
      if (vorhanden) {
        try {
          await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 15000))]);
          regs = (await navigator.serviceWorker.getRegistrations()).length;
        } catch { regs = -1; }
      }
      let namen = [];
      try { namen = await caches.keys(); } catch { namen = []; }
      return { vorhanden, secure: isSecureContext, protokoll: location.protocol, regs, namen, controller: vorhanden && !!navigator.serviceWorker.controller };
    });

    if (!sw.vorhanden) {
      notiere("Service-Worker", "vorhanden", false,
        `Es gibt auf dieser Adresse gar keinen Service-Worker (${sw.protokoll}//…, isSecureContext=${sw.secure}) — ohne ihn kann die App nichts offline lesen; alle folgenden Offline-Prüfungen sind damit gegenstandslos.`);
      for (const w of ["Offline lesen", "Deep-Link offline", "Inhaltsdaten offline"])
        notiere(w, "entfällt", false, "ohne Service-Worker gegenstandslos");
      return;
    }
    notiere("Service-Worker", "vorhanden", true, `isSecureContext=${sw.secure}, ${sw.protokoll}//…`);
    notiere("Service-Worker", "sicherer Kontext", sw.secure,
      sw.secure ? "ja" : "nein — Chromium gibt hier keinen Worker heraus");
    notiere("Service-Worker", "Registrierung aktiv", sw.regs > 0 && sw.controller,
      sw.regs > 0 ? `${sw.regs} Registrierung(en), Seite ${sw.controller ? "wird gesteuert" : "wird NICHT gesteuert"}` : "keine Registrierung");
    const nuvoraCaches = sw.namen.filter((n) => n.startsWith("nuvora"));
    notiere("Service-Worker", "Nuvora-Caches angelegt", nuvoraCaches.length > 0,
      nuvoraCaches.length ? nuvoraCaches.join(", ") : `keine (gefunden: ${sw.namen.join(", ") || "gar nichts"})`);

    // ── Online ein paar Seiten besuchen (das fuellt den Cache) ──
    // /papierkorb wird BEWUSST ausgelassen — das ist gleich der Deep-Link.
    for (const pfad of ["/", "/classes", "/topics"]) {
      await seite.goto(`${URL_BASIS}${pfad}`, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
      await tourWegklicken(seite);
    }
    // Die Klasse muss ONLINE sichtbar sein, sonst prueft der Offline-Teil nichts.
    await seite.goto(`${URL_BASIS}/classes`, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
    await tourWegklicken(seite);
    const onlineDa = (await text(seite)).includes(`${MARKE} Klasse`);
    notiere("Inhaltsdaten offline", "Testklasse online sichtbar", onlineDa,
      onlineDa ? "Voraussetzung erfüllt" : "die Klasse steht schon online nicht auf /classes — der Offline-Vergleich sagt dann nichts");
    await warte(1500);  // dem Worker Zeit geben, die Antwort in den Cache zu legen

    // ── Netz kappen ──
    if (!await netzKappen(seite)) {
      for (const w of ["Offline lesen", "Deep-Link offline", "Inhaltsdaten offline"])
        notiere(w, "entfällt", false, "Verbindung liess sich nicht kappen");
      return;
    }

    // ── 2. Offline lesen: neu laden, Oberflaeche muss stehen ──
    let fehlerLaden = null;
    await seite.reload({ waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => { fehlerLaden = kurz(e, 80); });
    await warte(2500);
    const nachReload = await text(seite);
    const shellSteht = !seite.url().startsWith("file:") && nachReload.length > 100 && /Klassen|Module|Profil/.test(nachReload);
    notiere("Offline lesen", "Oberfläche steht nach dem Neuladen", shellSteht,
      shellSteht ? `${nachReload.length} Zeichen, Navigation da`
        : `${seite.url().startsWith("file:") ? "Ersatzseite statt App: " + seite.url() : `${nachReload.length} Zeichen`}${fehlerLaden ? ` (${fehlerLaden})` : ""}`);

    // Der Offline-Hinweis der Shell (main.jsx pollt /api/health alle 5 s).
    let hinweis = false;
    for (let i = 0; i < 8 && !hinweis; i++) {
      hinweis = /Keine Verbindung|Datenbank nicht erreichbar/.test(await text(seite));
      if (!hinweis) await warte(1500);
    }
    notiere("Offline lesen", "Offline-Hinweis sichtbar", hinweis,
      hinweis ? "Balken „Keine Verbindung“" : "kein Hinweis — die Lehrkraft hält veraltete Daten für aktuell");

    // ── 3. Deep-Link offline: Adresse, die online NIE besucht wurde ──
    //
    // Das Zufallsanhaengsel ist Absicht: der Cache-Schluessel ist die volle
    // Adresse, also kann kein frueherer Lauf diese Navigation schon gecacht
    // haben. Geprueft wird damit wirklich der Rueckfall auf die Shell (SPA:
    // index.html kann jede Route rendern), nicht ein Zufallstreffer.
    let deepFehler = null;
    await seite.goto(`${URL_BASIS}/papierkorb?offline-deeplink=${Math.random().toString(36).slice(2)}`,
      { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => { deepFehler = kurz(e, 80); });
    await warte(2500);
    const deepText = await text(seite);
    const deepOk = !seite.url().startsWith("file:") && deepText.length > 100 && /Klassen|Module|Profil/.test(deepText);
    notiere("Deep-Link offline", "nie besuchte Seite rendert die Shell", deepOk,
      deepOk ? `${deepText.length} Zeichen`
        : seite.url().startsWith("file:")
          ? `Ersatzseite „${deepText.split("\n")[0]}" statt der App — der Navigations-Zweig in sw.js fällt auf nichts zurück${deepFehler ? ` (${deepFehler})` : ""}`
          : `${deepText.length} Zeichen${deepFehler ? ` (${deepFehler})` : ""}`);

    // ── 4. Echte Inhaltsdaten offline ──
    let datenFehler = null;
    await seite.goto(`${URL_BASIS}/classes`, { waitUntil: "domcontentloaded", timeout: 45000 })
      .catch((e) => { datenFehler = kurz(e, 80); });
    await warte(2500);
    await tourWegklicken(seite);
    const klasseDa = (await text(seite)).includes(`${MARKE} Klasse`);
    notiere("Inhaltsdaten offline", "Klasse nach dem Neuladen noch da", klasseDa,
      klasseDa ? `„${MARKE} Klasse"` : `nicht gefunden${datenFehler ? ` (${datenFehler})` : ""}`);

    // Die Namen stehen im Bearbeiten-Formular; eine Lehrkraft klickt die Klasse
    // dafuer an. Genau das ist der Unterschied zwischen „die Seite rendert" und
    // „meine Daten sind noch da".
    let namen = { a: false, b: false };
    if (klasseDa) {
      await seite.getByRole("button", { name: new RegExp(`${MARKE} Klasse`) }).first().click({ timeout: 8000 }).catch(() => {});
      await warte(1200);
      namen = await seite.evaluate(([a, b]) => {
        const werte = [...document.querySelectorAll("input")].map((i) => i.value).join("") + "" + document.body.innerText;
        return { a: werte.includes(a), b: werte.includes(b) };
      }, [KIND_A, KIND_B]);
    }
    notiere("Inhaltsdaten offline", "beide Namen offline lesbar", namen.a && namen.b,
      namen.a && namen.b ? "beide Kinder da"
        : `gefunden: ${[namen.a ? "Kind Eins" : null, namen.b ? "Kind Zwei" : null].filter(Boolean).join(", ") || "keiner"}`);

    await seite.context().setOffline(false).catch(() => {});
  } finally {
    // Erst wieder online schalten, dann schliessen: sonst bleibt eine
    // gekappte Verbindung an einem Kontext haengen, der gleich stirbt.
    if (seite) await seite.context().setOffline(false).catch(() => {});
    await app.close().catch(() => {});
  }
}

/**
 * 5. Fehlerfall tote Adresse.
 *
 * 127.0.0.1:9 ist der Discard-Port — garantiert tot, ohne Netz zu brauchen.
 * Erwartet wird eine erkennbare deutsche Auskunft MIT Weg zurueck, kein leeres
 * Fenster: ohne eigene Seite steht hinter dem Dialog chrome-error://chromewebdata
 * mit null Zeichen.
 */
async function toteAdresse(exe) {
  const app = await starteApp("http://127.0.0.1:9", exe);
  try {
    const seite = await app.firstWindow();
    let inhalt = "";
    for (let i = 0; i < 10; i++) {
      inhalt = await text(seite);
      if (inhalt.trim().length > 20) break;
      await warte(1000);
    }
    const leer = inhalt.trim().length === 0;
    notiere("Fehlerfall tote Adresse", "kein leeres Fenster", !leer,
      leer ? `${seite.url()} zeigt null Zeichen` : `${inhalt.trim().length} Zeichen`);
    const deutsch = /nicht erreichen|nicht erreichbar|kein kontakt|keine verbindung|server/i.test(inhalt);
    notiere("Fehlerfall tote Adresse", "deutsche Auskunft", deutsch,
      deutsch ? `„${inhalt.split("\n")[0].slice(0, 60)}"` : `Text sagt nichts über den Grund: „${inhalt.slice(0, 60)}"`);
    // Weg zurueck: ein Knopf zum erneuten Verbinden ODER der Hinweis aufs Menue.
    const knopf = await seite.getByRole("button").count().catch(() => 0);
    const wegZurueck = knopf > 0 || /Server-Adresse ändern|erneut verbinden/i.test(inhalt);
    notiere("Fehlerfall tote Adresse", "Weg zurück angeboten", wegZurueck,
      wegZurueck ? `${knopf} Knopf/Knöpfe, Hinweis auf das Menü` : "keine Bedienmöglichkeit — die Lehrkraft sitzt fest");
  } finally {
    // Der Hinweis-Dialog aus main.js ist modal; ohne Frist haengt close().
    await Promise.race([app.close().catch(() => {}), warte(10000)]);
  }
}

function drucke() {
  const fehler = ergebnisse.filter((e) => !e.ok);
  console.log("\n" + "=".repeat(40));
  if (!fehler.length) {
    console.log(`  ${GRUEN}Desktop-Offline grün${AUS} — ${ergebnisse.length} Prüfungen in ${seit().trim()}.`);
    console.log("=".repeat(40));
    process.exit(0);
  }
  console.log(`  ${ROT}${FETT}Desktop-Offline ROT${AUS} — ${fehler.length} von ${ergebnisse.length} Prüfungen.`);
  for (const f of fehler) {
    console.log(`${ROT}  ✗ ${f.gruppe} / ${f.name}${AUS}`);
    if (f.detail) console.log(`      ${f.detail}`);
  }
  console.log("=".repeat(40));
  process.exit(1);
}

main();
