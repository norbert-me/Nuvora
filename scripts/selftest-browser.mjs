/**
 * Nuvora — Selbsttest im echten Browser (Playwright; Chromium und/oder WebKit).
 *
 * Ergaenzt scripts/selftest.py: dort wird die API geprueft, hier die Shell.
 * Der Browser meldet sich an, schaltet jedes Modul zu, ruft jede Modul- und
 * Kern-Seite auf und meldet, was eine Lehrkraft merken wuerde:
 *
 *   - Seite rendert nicht (leere Shell, Absturz im Render)
 *   - Fehler in der Browser-Konsole
 *   - fehlgeschlagene Netzanfragen (404/500 auf API oder Statik)
 *   - Modul-Gate wirft trotz aktivem Modul auf /modules zurueck
 *   - tote interne Links (Navigation, Fussleiste, Modulkacheln)
 *
 * Der Modul-Zustand des Kontos wird am Ende wiederhergestellt — auch nach
 * Strg-C, siehe `modulZustandHerstellen`.
 *
 * Nutzung:  node scripts/selftest-browser.mjs --url … --email … --passwort …
 *           (oder SELFTEST_URL / SELFTEST_EMAIL / SELFTEST_PASSWORD)
 *           --browser=chromium|webkit|beide  (Vorgabe: chromium)
 *           WebKit ist die Engine der iPads, auf denen gearbeitet wird — sie
 *           laeuft nicht bei jedem Deploy mit, weil das die Laufzeit verdoppelt.
 * Rueckgabewert: 0 = gruen, 1 = mindestens ein Fehler.
 */
import { chromium, webkit } from "playwright";

const arg = (name, fallback) => {
  // Beide Schreibweisen: `--name wert` und `--name=wert`. Die zweite ist die,
  // die man beim Tippen erwartet — und ohne sie landete `--browser=webkit`
  // stillschweigend als unbekanntes Argument im Nirgendwo.
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

// ── Welche Browser-Engine? ─────────────────────────────────────────────────
//
// Der Betrieb laeuft zu grossen Teilen auf iPads, also auf WebKit — der Engine
// mit den meisten Eigenheiten. Chromium bleibt trotzdem die VORGABE: der Deploy
// ruft diesen Test bei jedem Durchlauf, und er soll nicht ungefragt doppelt so
// lange dauern. Wer WebKit sehen will, sagt es (`--browser=webkit`), wer beides
// braucht, auch (`--browser=beide`).
const MOTOREN_ALLE = { chromium, webkit };
const MOTOR_WAHL = String(arg("browser", process.env.SELFTEST_BROWSERS) || "chromium").toLowerCase();
const MOTOREN = MOTOR_WAHL === "beide" ? ["chromium", "webkit"] : [MOTOR_WAHL];
if (MOTOREN.some((m) => !MOTOREN_ALLE[m])) {
  console.error(`Fehler: --browser kennt nur chromium, webkit oder beide (bekommen: „${MOTOR_WAHL}").`);
  process.exit(2);
}
// Der Name der laufenden Engine steht in JEDER Zeile und in der
// Zusammenfassung. Ohne ihn ist beim Fehlersuchen nicht zu erkennen, welcher
// Lauf gemeint war — und genau das ist der haeufigste Fall bei zwei Engines.
let MOTOR = MOTOREN[0];

// Kern-Seiten, die immer erreichbar sein muessen. Die Modul-Seiten kommen aus
// dem Register (/api/modules) — so prueft der Test genau die Module, die es im
// Code wirklich gibt, und niemand muss diese Liste pflegen.
const KERN_SEITEN = [
  "/", "/modules", "/classes", "/kurse", "/topics", "/papierkorb",
  "/profile", "/marktplatz", "/legal", "/contact", "/help", "/tutorial",
];

// Rauschen, das nichts ueber die Gesundheit der Installation sagt.
const EGAL = [
  /favicon/i,
  /ResizeObserver loop/i,
  /Download the React DevTools/i,
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
const EGAL_HOSTS = new Set(["api.github.com"]);
const istEgalerHost = (text) => {
  for (const gefunden of String(text).match(/https?:\/\/[^\s"'<>)]+/gi) || []) {
    try {
      if (EGAL_HOSTS.has(new URL(gefunden).hostname.toLowerCase())) return true;
    } catch { /* keine gueltige Adresse — dann ist es auch kein bekannter Host */ }
  }
  return false;
};
const istEgal = (text) => EGAL.some((r) => r.test(text)) || istEgalerHost(text);

// HTTP 429 ist Infrastruktur, kein Anwendungsfehler: der Proxy drosselt /api/
// (nginx.conf, `limit_req zone=api_rl`), und dieser Test klappert Dutzende
// Seiten in Folge ab, die jede mehrere API-Aufrufe feuern. Er darf den Lauf
// nicht rot faerben — aber auch nicht spurlos verschwinden: die betroffene
// Seite wird nach einer Pause noch einmal besucht, und was dann bleibt, steht
// als Hinweis im Bericht.
// BEWUSST nur 429. Ein 403 oder 404 auf einer Seite, die etwas laden will, ist
// ein echter Befund — genau so kam der Kalender-403 ans Licht.
const istDrosselung = (text) => /\b429\b|Too Many Requests/i.test(text);
const PAUSE_429 = 4000;
// Harte Obergrenze je Seite. Ohne sie blockiert ein einziger Haenger (Seite,
// die nie „networkidle" erreicht) den ganzen Lauf, und der Nutzer bricht ab.
const FRIST_SEITE = 60000;

const ergebnisse = [];

// Farbe nur im Terminal (sonst landen Steuerzeichen in Logdateien), NO_COLOR
// als uebliche Notbremse.
const FARBE = process.stdout.isTTY && !process.env.NO_COLOR;
const ROT = FARBE ? "\x1b[31m" : "";
const GRUEN = FARBE ? "\x1b[32m" : "";
const GRAU = FARBE ? "\x1b[90m" : "";
const FETT = FARBE ? "\x1b[1m" : "";
const AUS = FARBE ? "\x1b[0m" : "";

// Jede Zeile erscheint SOFORT, nicht erst am Ende. Ein Lauf dauert Minuten;
// wer nur einen stehenden Bildschirm sieht, haelt das fuer einen Haenger und
// bricht ab (genau das ist passiert). Die Laufzeit vorn zeigt zusaetzlich, wo
// die Zeit hingeht.
const START = Date.now();
const seit = () => `${String(Math.round((Date.now() - START) / 1000)).padStart(4)}s`;
let letzteGruppe = null;
const notiere = (gruppe, name, ok, detail = "") => {
  ergebnisse.push({ motor: MOTOR, gruppe, name, ok, detail });
  if (`${MOTOR}/${gruppe}` !== letzteGruppe) {
    console.log(`\n${FETT}── [${MOTOR}] ${gruppe}${AUS}`);
    letzteGruppe = `${MOTOR}/${gruppe}`;
  }
  const zeile = `${name}${detail ? `   ${detail}` : ""}`;
  console.log(`  ${GRAU}${seit()}${AUS} ${ok ? `${GRUEN}✓${AUS} ${zeile}` : `${ROT}✗ ${zeile}${AUS}`}`);
};

// ── Modul-Zustand zurueckstellen, auch ohne Browser ────────────────────────
//
// Der Test schaltet Module zu. Frueher lief das Zuruecksetzen ueber den
// Playwright-Kontext — nach Strg-C (oder wenn der Browser stirbt) ist der
// geschlossen, JEDES Zuruecksetzen scheitert, und die Lehrkraft findet ihr
// Konto mit allen Modulen an. Ein Testwerkzeug darf fremde Einstellungen nicht
// dauerhaft veraendern. Also laeuft das Aufraeumen ueber schlichtes `fetch`,
// das den Browser nicht braucht, haengt an SIGINT/SIGTERM — und sieht
// hinterher nach, statt es nur zu versuchen.
const zurueckzustellen = new Set();
let token = null;
let aufgeraeumt = false;

async function modulZustandHerstellen(ohneBericht = false) {
  if (aufgeraeumt || !token) return;
  aufgeraeumt = true;
  const kopf = { Authorization: `Bearer ${token}` };
  // Alle auf einmal: nach einem Strg-C zaehlt jede Zehntelsekunde (siehe die
  // Exit-Bremse unten). Die Aufrufe haengen nicht voneinander ab.
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
    ? (zurueckzustellen.size ? `${zurueckzustellen.size} zugeschaltete Module wieder abgeschaltet` : "unverändert")
    : `blieb zugeschaltet: ${offen.join(", ")}`;
  if (ohneBericht) console.error(`\n${gut ? GRUEN : ROT}Modul-Zustand: ${text}${AUS}`);
  else notiere("Aufräumen", "Modulzustand", gut, text);
}

// Playwright haengt eigene SIGINT/SIGTERM-Handler an (processLauncher:
// `gracefullyCloseAll().then(() => process.exit(130))`). Die beenden den
// Prozess, sobald der Browser zu ist — mitten im Aufraeumen. Genau daran ist es
// gescheitert: nach einem Strg-C blieben 13 von 14 Modulen zugeschaltet.
// Deshalb wird bis zum fertigen Aufraeumen KEIN Prozessende durchgelassen. Ein
// zweites Strg-C bricht hart ab, und nach 20 s gibt auch die Bremse auf.
const echterExit = process.exit.bind(process);
let abbruchLaeuft = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (abbruchLaeuft) return echterExit(130);
    abbruchLaeuft = true;
    console.error(`\n${ROT}Abbruch (${signal}) — stelle den Modul-Zustand des Kontos wieder her …${AUS}`);
    process.exit = () => {};
    const fertig = () => { process.exit = echterExit; echterExit(130); };
    Promise.race([modulZustandHerstellen(true), warte(20000)]).then(fertig, fertig);
  });
}

/**
 * Fehlertext auf ein lesbares Mass bringen.
 *
 * Playwright haengt an seine Fehlermeldungen das komplette Browser-Protokoll.
 * Kommt ein Konsolenfehler im Sekundentakt, sind das achtzig gleichlautende
 * Zeilen, die den eigentlichen Grund begraben — genau so sah der Bericht nach
 * dem Abbruch aus. Erste Zeile, danach hoechstens drei weitere VERSCHIEDENE,
 * jede nur einmal und mit Zaehler.
 */
function kurzfehler(e, zeilen = 4) {
  const roh = String(e?.message || e).split("\n").map((z) => z.trim()).filter(Boolean);
  const zaehl = new Map();
  for (const z of roh) zaehl.set(z, (zaehl.get(z) || 0) + 1);
  return [...zaehl.entries()].slice(0, zeilen)
    .map(([z, n]) => (n > 1 ? `${z.slice(0, 160)} (${n}×)` : z.slice(0, 160)))
    .join(" | ");
}

/** Harte Frist um eine Zusage. Der Aufrufer schliesst die Seite im finally. */
function mitFrist(zusage, ms, was) {
  let uhr;
  const frist = new Promise((_, ab) => {
    uhr = setTimeout(() => ab(new Error(`Zeitüberschreitung nach ${Math.round(ms / 1000)}s (${was})`)), ms);
  });
  return Promise.race([zusage, frist]).finally(() => clearTimeout(uhr));
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Anmeldung in den localStorage legen — abgesichert.
 *
 * `addInitScript` laeuft in JEDEM Dokument des Kontexts, auch in solchen ohne
 * echte Herkunft: dem `about:blank`, mit dem Playwright jede neue Seite
 * startet, in `data:`/`blob:`-Dokumenten und in sandboxed Rahmen. Dort ist
 * localStorage gesperrt, der Zugriff wirft SecurityError — und weil das bei
 * jedem Seitenaufruf passiert, flutete die Meldung das Protokoll. Also erst
 * die Herkunft pruefen, dann zugreifen, und beides in try/catch.
 */
async function anmeldungHinterlegen(kontext, token, user, extra = {}) {
  await kontext.addInitScript(([tok, usr, mehr]) => {
    try {
      if (!/^https?:$/.test(location.protocol)) return;   // about:blank, data:, blob:
      if (!window.localStorage) return;
      localStorage.setItem("token", tok);
      localStorage.setItem("user", usr);
      // Gefuehrte Touren vorab abhaken: sie starten 900 ms nach dem
      // Seitenaufruf und legen ein Overlay ueber ALLES (z-index 4000).
      // Wegklicken allein reicht nicht — die naechste Seite bringt die
      // naechste Tour.
      localStorage.setItem("nuvora_kerntour_done", "1");
      try { localStorage.setItem(`nuvora_onboarded_${JSON.parse(usr).id}`, "1"); } catch { /* egal */ }
      for (const id of ["kalender", "noten", "karten"]) localStorage.setItem(`nuvora_tour_${id}_done`, "1");
      for (const [k, v] of Object.entries(mehr)) localStorage.setItem(k, v);
    } catch { /* Dokument ohne eigene Herkunft — hier gibt es nichts zu setzen */ }
  }, [token, JSON.stringify(user), extra]);
}

/**
 * Ein Lauf je Engine. Der Modul-Zustand wird nach JEDEM Lauf zurueckgestellt,
 * also muessen die Merker davor wieder auf Anfang — sonst haelt der zweite Lauf
 * sich fuer schon aufgeraeumt und laesst die Module des Kontos an.
 */
async function main() {
  for (const name of MOTOREN) {
    MOTOR = name;
    letzteGruppe = null;
    aufgeraeumt = false;
    token = null;
    zurueckzustellen.clear();
    console.log(`\n${FETT}══════ Browser-Engine: ${name} ══════${AUS}`);
    await lauf(MOTOREN_ALLE[name]);
  }
  drucke();
  process.exit(ergebnisse.some((e) => !e.ok) ? 1 : 0);
}

async function lauf(motor) {
  const browser = await motor.launch();
  const kontext = await browser.newContext({ baseURL: URL_BASIS, viewport: { width: 1280, height: 900 } });

  try {
    // ── Anmelden ueber die API, Token wie die Shell in den localStorage ──
    const login = await kontext.request.post("/api/auth/login", {
      data: { email: EMAIL, password: PASSWORT },
    });
    if (login.status() === 401)
      throw new Error(`Konto '${EMAIL}' gibt es nicht (oder falsches Passwort). Einmalig unter ${URL_BASIS}/login registrieren und E-Mail bestaetigen.`);
    if (login.status() === 403)
      throw new Error(`Konto '${EMAIL}' ist noch nicht per E-Mail bestaetigt.`);
    if (!login.ok()) throw new Error(`Login fehlgeschlagen: HTTP ${login.status()}`);
    const { token: t, user } = await login.json();
    token = t;
    notiere("Anmeldung", "Login", true, `als ${user.email}`);

    // Mit Geduld bei 429: die Testfamilien laufen hintereinander gegen dasselbe
    // Konto und teilen sich dessen Rate-Limit (siehe systemtest-browser.mjs).
    const api = async (pfad, methode = "get", data) => {
      let r;
      for (const warte of [0, 6000, 15000]) {
        if (warte) await new Promise((f) => setTimeout(f, warte));
        r = await kontext.request[methode](pfad, { headers: { Authorization: `Bearer ${token}` }, ...(data ? { data } : {}) });
        if (r.status() !== 429) return r;
      }
      return r;
    };

    await anmeldungHinterlegen(kontext, token, user);

    // ── Module zuschalten (Zustand merken, am Ende zuruecksetzen) ──
    const module = await (await api("/api/modules")).json();
    for (const m of module) {
      if (!m.available || m.active) continue;
      const r = await api(`/api/modules/${m.key}/activate`, "post");
      // Vor der Antwort vormerken: bricht der Lauf gleich hier ab, muss auch
      // ein halb durchgelaufenes Zuschalten wieder weg.
      if (r.ok()) zurueckzustellen.add(m.key);
      else notiere("Module", m.key, false, `Aktivieren fehlgeschlagen: HTTP ${r.status()}`);
    }

    // ── Rundgang ──
    const seiten = [
      ...KERN_SEITEN.map((p) => ({ pfad: p, name: p })),
      ...module.filter((m) => m.available && !m.external).map((m) => ({ pfad: m.path, name: `${m.name} (${m.path})` })),
    ];

    const gefundeneLinks = new Set();
    for (const { pfad, name } of seiten) {
      const befund = await besucheGeduldig(kontext, pfad, gefundeneLinks);
      notiere("Seiten", name, befund.ok, befund.detail);
    }

    // ── Interne Links, die auf den besuchten Seiten stehen ──
    const schonBesucht = new Set(seiten.map((s) => s.pfad));
    const offen = [...gefundeneLinks].filter((l) => !schonBesucht.has(l)).sort();
    for (const pfad of offen) {
      const befund = await besucheGeduldig(kontext, pfad, null);
      notiere("Verlinkung", pfad, befund.ok, befund.detail);
    }

    // ── Handy-Ansicht: Nuvora wird im Unterricht am Telefon bedient ──
    const handy = await neuerKontext(browser, token, user, { width: 390, height: 844 });
    for (const { pfad, name } of seiten) {
      const befund = await besucheGeduldig(handy, pfad, null, { pruefeUeberlauf: true });
      notiere("Handy (390px)", name, befund.ok, befund.detail);
    }
    await handy.close();

    // ── Dunkles Design: feste Farben fallen erst hier auf ──
    const dunkel = await neuerKontext(browser, token, user, null, "dark");
    for (const { pfad, name } of seiten) {
      const befund = await besucheGeduldig(dunkel, pfad, null);
      notiere("Dunkles Design", name, befund.ok, befund.detail);
    }
    await dunkel.close();

    // ── Der Lernpfad muss seine Daten wirklich holen ──
    // Er ist die einzige Seite, die nicht React ist: eine eingebettete App, die
    // die Shell nachtraeglich startet. Genau daran ist sie einmal gescheitert —
    // sie rief nie /exercises auf und zeigte nur den localStorage-Cache, also im
    // frischen Browser gar nichts. "Rendert" reicht hier als Nachweis nicht.
    if (module.some((m) => m.key === "lernpfad" && m.available)) {
      const befund = await ladeLernpfadDaten(kontext);
      notiere("Seiten", "Lernpfad holt seine Daten", befund.ok, befund.detail);
    }

    // ── Wirklich bedienen, nicht nur ansehen ──
    // Vorher merken, was es gibt: abgeraeumt wird danach genau das Neue. Nach
    // dem Titel zu suchen reichte nicht — scheitert das Tippen, bleibt ein
    // leerer Zettel stehen, den niemand zuordnen kann.
    // Zuerst die Reste eines abgebrochenen Laufs weg. Liegen sie noch da,
    // antwortet das Anlegen mit 409 („gibt es an dieser Stelle schon") — und
    // schlimmer: der alte Zettel traegt dieselbe Marke, der Test faende ihn
    // nach dem Neuladen und meldete faelschlich Erfolg.
    const reste = await resteAbraeumen(api);
    notiere("Bedienung", "Reste des letzten Laufs", true,
      reste ? `${reste} Reste eines abgebrochenen Laufs abgeräumt` : "keine");

    const vorher = await bestand(api);
    for (const flow of BEDIENUNG) {
      const befund = await bediene(kontext, flow);
      notiere("Bedienung", flow.name, befund.ok, befund.detail);
    }
    await aufraeumenBedienung(api, vorher);

    // ── Globale Suche ──
    await sucheProbe(kontext);

    // ── Reihenfolge der Schueler im Formular ──
    await reihenfolgeProbe(kontext, api);

    // ── Lernpfad wirklich bedienen ──
    // Das Modul ist die einzige Nicht-React-Seite; „rendert" sagt hier am
    // wenigsten. Eigene Gruppe, siehe lernpfadProbe.
    if (module.some((m) => m.key === "lernpfad" && m.available)) await lernpfadProbe(kontext, api);

    // ── Ohne benutzbaren localStorage ──
    // Am Ende, weil die Probe eigene Kontexte braucht und nichts anlegt.
    await speicherProbe(browser, token, user);
  } catch (e) {
    notiere("Ablauf", "Selbsttest", false, kurzfehler(e));
  } finally {
    // Der Selbsttest darf die Einstellungen des Kontos nicht veraendern — und
    // zwar ueber `fetch`, nicht ueber den Browser: der kann hier schon tot sein.
    await modulZustandHerstellen();
    await browser.close().catch(() => {});
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Ohne benutzbaren localStorage
//
// An localStorage haengt in Nuvora fast alles: der Anmelde-Token, der
// Modul-Cache (core/modules.js), der Anzeige-Cache des Lernpfads, die Tafel,
// die Sprache. Auf dem iPad ist das der wackeligste Untergrund im ganzen
// System, und zwar aus zwei Gruenden, die es in Chromium so nicht gibt:
//
//   - Im privaten Modus (und bei blockierten Cookies) WIRFT Safari beim
//     Zugriff, statt still zu scheitern. Ein ungeschuetztes
//     `localStorage.getItem(...)` reisst dann alles mit, was daran haengt.
//   - Der Tracking-Schutz raeumt den Speicher nach sieben Tagen ohne Besuch
//     ab. Die Kollegin nach den Ferien ist genau dieser Fall.
//
// Geprueft wird nicht, ob Nuvora sich dabei alles merkt — das kann es nicht.
// Geprueft wird, dass eine LESBARE Seite stehenbleibt statt einer weissen.
const SPEICHER_BRICHT = () => {
  const werfen = () => { throw new Error("SecurityError: localStorage ist gesperrt (Safari, privater Modus)"); };
  try {
    Object.defineProperty(window, "localStorage", { configurable: true, get: werfen });
  } catch { /* Engine laesst das Umdefinieren nicht zu — faellt in der Probe auf */ }
};

const SPEICHER_NUR_LESEN = () => {
  try {
    const echt = window.localStorage;
    const kaputt = () => { throw new Error("QuotaExceededError: localStorage ist voll (Safari, privater Modus)"); };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => ({
        getItem: (k) => echt.getItem(k),
        key: (i) => echt.key(i),
        get length() { return echt.length; },
        setItem: kaputt,
        removeItem: kaputt,
        clear: kaputt,
      }),
    });
  } catch { /* siehe oben */ }
};

/**
 * Eine Seite unter erschwerten Speicherbedingungen aufrufen und bewerten.
 * Weiss = Befund. Alles andere (Anmeldemaske, Hinweis, volle Seite) ist gut.
 */
async function speicherSeite(kontext, pfad) {
  const { seite, probleme } = await neueSeite(kontext);
  try {
    const holen = async () => {
      await seite.goto(pfad, { waitUntil: "domcontentloaded", timeout: 30000 });
      // NICHT auf „networkidle" warten: bricht der Token-Zugriff, feuert die
      // Shell womoeglich gar keine Anfrage mehr — dann waere die Wartezeit die
      // einzige Aussage des Tests.
      await seite.waitForTimeout(3000);
      const text = (await seite.locator("body").innerText()).trim();
      const wo = new URL(seite.url()).pathname;
      const abstuerze = probleme.filter((p) => p.startsWith("Absturz"));
      if (text.length < 20)
        return { ok: false, detail: `WEISSE SEITE auf ${pfad} (${text.length} Zeichen sichtbar`
          + `${wo !== pfad ? `, gelandet auf ${wo}` : ""})`
          + (abstuerze.length ? ` — ${abstuerze[0]}` : "") };
      return { ok: true, detail: `${text.length} Zeichen lesbar (${wo})`
        + (abstuerze.length ? ` · Absturz im Protokoll: ${abstuerze[0].slice(0, 90)}` : "") };
    };
    return await mitFrist(holen(), FRIST_SEITE, pfad);
  } catch (e) {
    return { ok: false, detail: String(e.message || e).split("\n")[0].slice(0, 160) };
  } finally {
    await seite.close().catch(() => {});
  }
}

/**
 * Anmelden, waehrend der Speicher gesperrt ist.
 *
 * Gut ist zweierlei: entweder es klappt trotzdem (die Shell weicht aus), oder
 * die Meldung sagt, WORAN es liegt. Nicht gut ist eine Meldung, die auf die
 * falsche Faehrte fuehrt — dann ruft die Lehrkraft an und meldet „Server down".
 */
async function speicherAnmeldung(kontext) {
  const { seite } = await neueSeite(kontext);
  try {
    const tun = async () => {
      await seite.goto("/login", { waitUntil: "domcontentloaded", timeout: 30000 });
      const felder = seite.locator("input");
      if (await felder.count() < 2) return { ok: false, detail: "die Anmeldemaske erscheint gar nicht" };
      await seite.locator("input[type=email], input[name=email]").first().fill(EMAIL);
      await seite.locator("input[type=password]").first().fill(PASSWORT);
      // Beschriftung in allen drei Sprachen: welche die Maske zeigt, entscheidet
      // ohne Speicher das Geraet, nicht das Konto.
      await seite.getByRole("button", { name: /anmelden|sign in|login|iniciar/i }).first().click({ timeout: 8000 });
      await seite.waitForTimeout(3000);
      const text = (await seite.locator("body").innerText()).replace(/\s+/g, " ").trim();
      const wo = new URL(seite.url()).pathname;
      if (wo !== "/login") return { ok: true, detail: `kommt trotz gesperrtem Speicher hinein (${wo})` };
      if (/speicher|privat|cookie|storage|almacen/i.test(text))
        return { ok: true, detail: "bleibt auf /login und nennt den Speicher als Grund" };
      const meldung = (text.match(/Verbindungsfehler|Connection error|Error de conexión/i) || [])[0];
      return { ok: false, detail: meldung
        ? `meldet „${meldung}" — falsche Fährte: die Anmeldung war erfolgreich, nur das Ablegen des Tokens `
          + "scheiterte (apps/web/src/pages/Login.jsx:71 im try, Auffangzweig Zeile 74)"
        : `kommt nicht hinein und nennt keinen Grund (sichtbar: „${text.slice(0, 120)}")` };
    };
    return await mitFrist(tun(), FRIST_SEITE, "/login");
  } catch (e) {
    return { ok: false, detail: String(e.message || e).split("\n")[0].slice(0, 160) };
  } finally {
    await seite.close().catch(() => {});
  }
}

/**
 * Die Suche muss finden, was die Navigation versteckt.
 *
 * Der Fall aus dem Alltag: man weiss, dass es die Ausleihe gibt, aber nicht,
 * dass sie unter Orga sitzt. Geprueft wird genau dieser Weg — Lupe auf, Wort
 * tippen, Enter, und die richtige Seite steht da. Dazu die Gegenprobe: ein
 * Ziel eines abgeschalteten Moduls darf gar nicht erst auftauchen (Regel 3).
 */
async function sucheProbe(kontext) {
  const { seite } = await neueSeite(kontext);
  try {
    await seite.goto("/", { waitUntil: "networkidle", timeout: 30000 });
    await tourWegklicken(seite);
    // Drei Wege, einer muss gehen: Tastenkuerzel (je nach System Meta oder
    // Strg) und der Knopf in der Navigation. Frueher pruefte der Test direkt
    // nach dem Tastendruck, ob das Feld schon da ist — ein Rennen, das er
    // regelmaessig verlor.
    const feld = seite.locator("input[placeholder*='suchen'], input[placeholder*='Suchen']").first();
    const offen = async () => (await feld.count()) > 0 && await feld.isVisible().catch(() => false);
    for (const versuch of ["Meta+k", "Control+k", "knopf"]) {
      if (await offen()) break;
      if (versuch === "knopf") await seite.getByRole("button", { name: /suchen|search|buscar/i }).first().click({ timeout: 8000 });
      else await seite.keyboard.press(versuch).catch(() => {});
      await seite.waitForTimeout(600);
    }
    await feld.waitFor({ state: "visible", timeout: 8000 });
    await feld.fill("ausleihe");
    await seite.waitForTimeout(300);
    await feld.press("Enter");
    await seite.waitForURL(/\/orga\?tab=ausleihe/, { timeout: 8000 });
    notiere("Bedienung", "Suche springt zum Reiter", true,
      "Suchwort 'ausleihe' fuehrt auf /orga?tab=ausleihe — ohne zu wissen, wo der Reiter sitzt");
  } catch (e) {
    notiere("Bedienung", "Suche springt zum Reiter", false, kurzfehler(e));
  } finally {
    await seite.close().catch(() => {});
  }
}

/**
 * Die Klassenmaske muss die gespeicherte Reihenfolge zeigen.
 *
 * Sie kam vom Server richtig sortiert (position), wurde im Formular aber nach
 * Kartennummer neu sortiert und durchnummeriert — jedes Verschieben war beim
 * naechsten Oeffnen wieder weg, und die Kartennummer (sie steht auf der
 * gedruckten Karte) wanderte auf ein anderes Kind. Geprueft wird deshalb genau
 * das: umsortieren per API, Maske oeffnen, Reihenfolge der Namensfelder
 * vergleichen.
 */
async function reihenfolgeProbe(kontext, api) {
  const name = `${MARKE} Reihenfolge`;
  let klasse = null;
  try {
    const angelegt = await api("/api/classes", "post", {
      name,
      students: [{ card_id: 1, name: `${MARKE} Anna` }, { card_id: 2, name: `${MARKE} Bea` }],
    });
    if (!angelegt.ok()) throw new Error(`Klasse anlegen: HTTP ${angelegt.status()}`);
    klasse = await angelegt.json();

    // Umdrehen: Bea steht jetzt vorn, die Kartennummern bleiben, wo sie sind.
    const gedreht = [...klasse.students].reverse();
    const put = await api(`/api/classes/${klasse.id}`, "put", {
      name, students: gedreht.map((s) => ({ card_id: s.card_id, name: s.name })),
    });
    if (!put.ok()) throw new Error(`Umsortieren: HTTP ${put.status()}`);
    const soll = gedreht.map((s) => s.name);

    const { seite } = await neueSeite(kontext);
    try {
      await seite.goto(`/classes?open=${klasse.id}`, { waitUntil: "networkidle", timeout: 30000 });
      await tourWegklicken(seite);
      // Nur die Schuelerzeilen: das Feld mit dem KLASSENNAMEN traegt dieselbe
      // Marke und stuende sonst als erster Treffer in der Liste.
      const felder = seite.locator(`input[placeholder='Name'][value^='${MARKE} ']`);
      await felder.first().waitFor({ state: "visible", timeout: 15000 });
      const ist = await felder.evaluateAll((els) => els.map((e) => e.value));
      if (JSON.stringify(ist) !== JSON.stringify(soll)) {
        notiere("Bedienung", "Reihenfolge im Klassenformular", false,
          `Maske zeigt ${JSON.stringify(ist)}, gespeichert ist ${JSON.stringify(soll)}`);
      } else {
        notiere("Bedienung", "Reihenfolge im Klassenformular", true,
          `gespeicherte Reihenfolge steht so in der Maske (${soll.join(", ")})`);
      }
    } finally {
      await seite.close().catch(() => {});
    }
  } catch (e) {
    notiere("Bedienung", "Reihenfolge im Klassenformular", false, kurzfehler(e));
  } finally {
    if (klasse?.id) {
      await api(`/api/classes/${klasse.id}`, "delete").catch(() => {});
      await api(`/api/classes/${klasse.id}/purge`, "delete").catch(() => {});
    }
  }
}

async function speicherProbe(browser, token, user) {
  const G = "Ohne localStorage";
  // Sprache am Kontext festnageln. Nuvora merkt sich die Sprache im
  // localStorage — genau der ist hier kaputt, also faellt die Oberflaeche auf
  // die Sprache des Geraets zurueck. Playwright startet ohne Angabe mit en-US
  // (Chromium) bzw. der Systemsprache (WebKit); dann sucht der Test deutsche
  // Beschriftungen in einer englischen Maske. Ein iPad im Kollegium meldet
  // de-DE, also meldet es der Test auch.
  const neu = async (skript, mitAnmeldung) => {
    const k = await browser.newContext({ baseURL: URL_BASIS, locale: "de-DE", viewport: { width: 1280, height: 900 } });
    // Reihenfolge zaehlt: erst die Anmeldung hinterlegen (braucht einen heilen
    // Speicher), dann den Speicher kaputtmachen.
    if (mitAnmeldung) await anmeldungHinterlegen(k, token, user);
    await k.addInitScript(skript);
    return k;
  };

  // 1) Zugriff wirft — privater Modus / blockierte Cookies, nicht angemeldet.
  let k = await neu(SPEICHER_BRICHT, false);
  for (const pfad of ["/", "/login"]) {
    const b = await speicherSeite(k, pfad);
    notiere(G, `Zugriff wirft · ${pfad}`, b.ok, b.detail);
  }
  await k.close();

  // 2) Zugriff wirft, aber die Lehrkraft WAR angemeldet — nach dem Umschalten
  //    in den privaten Modus oder nach dem Blockieren von Cookies.
  k = await neu(SPEICHER_BRICHT, true);
  for (const pfad of ["/modules", "/classes"]) {
    const b = await speicherSeite(k, pfad);
    notiere(G, `Zugriff wirft, angemeldet · ${pfad}`, b.ok, b.detail);
  }
  await k.close();

  // 3) Lesen geht, Schreiben wirft — Safaris privater Modus in der Variante,
  //    die den Speicher zwar herausgibt, aber jede Ablage verweigert.
  k = await neu(SPEICHER_NUR_LESEN, true);
  for (const pfad of ["/", "/classes"]) {
    const b = await speicherSeite(k, pfad);
    notiere(G, `Schreiben wirft · ${pfad}`, b.ok, b.detail);
  }
  await k.close();

  // 3b) Und der Weg, an dem es wirklich haengt: ANMELDEN ohne Speicher.
  //     Die Maske erscheint, der Server nimmt die Anmeldung an — und dann
  //     scheitert das Ablegen des Tokens. Was die Lehrkraft davon zu sehen
  //     bekommt, entscheidet, ob sie weiterkommt oder den Server fuer kaputt
  //     haelt. „Verbindungsfehler" ist die falsche Auskunft: die Verbindung
  //     stand, der Speicher war es.
  k = await neu(SPEICHER_BRICHT, false);
  const anmeldung = await speicherAnmeldung(k);
  notiere(G, "Anmelden ohne Speicher nennt den Grund", anmeldung.ok, anmeldung.detail);
  await k.close();

  // 4) Leer statt kaputt — der Tracking-Schutz hat nach sieben Tagen alles
  //    abgeraeumt. Die Lehrkraft muss auf einer BEDIENBAREN Seite landen
  //    (Anmeldung oder Startseite), nicht vor einer weissen.
  k = await browser.newContext({ baseURL: URL_BASIS, locale: "de-DE", viewport: { width: 1280, height: 900 } });
  const b = await speicherSeite(k, "/classes");
  notiere(G, "Speicher geleert (7-Tage-Regel) · /classes", b.ok, b.detail);
  await k.close();
}

/** Weiterer Browser-Kontext (Handy, dunkles Design) mit derselben Anmeldung. */
async function neuerKontext(browser, token, user, viewport, colorScheme) {
  const k = await browser.newContext({
    baseURL: URL_BASIS,
    viewport: viewport || { width: 1280, height: 900 },
    ...(colorScheme ? { colorScheme } : {}),
  });
  await anmeldungHinterlegen(k, token, user);
  return k;
}

// Marker, an dem alles Angelegte erkennbar ist — und wieder wegkommt.
const MARKE = "ZZ-Selbsttest-UI";

/**
 * Die Einstiegs-Tour wegklicken.
 *
 * Ein frisches Konto bekommt ein Overlay ("Tour starten / Später"), das ueber
 * der Seite liegt und jeden Klick abfaengt. Eine Lehrkraft klickt es weg, also
 * tut der Test das auch — sonst prueft er nur das Overlay.
 *
 * Beschriftungen in allen drei Sprachen (de/en/es), denn die Oberflaeche
 * startet je nach Konto unterschiedlich.
 */
async function tourWegklicken(seite) {
  // Zwei Sorten: die Willkommens-Tour ("Später") und die Modul-Tour beim
  // ersten Besuch einer Modulseite ("Überspringen"). Beide legen sich ueber
  // die Seite und verschlucken jeden Klick — und ohne sie wegzuklicken prueft
  // der Test nur das Overlay.
  // Zweimal durch: die Modul-Tour erscheint erst, wenn die Daten da sind.
  //
  // Beide Beschriftungen in EINEM Locator (`.or`): frueher wartete der Test je
  // Runde zweimal hintereinander auf ein Overlay, das es meistens gar nicht
  // gibt — vier Sekunden Leerlauf pro Seite, mal ueber hundert Seiten. Jetzt
  // laeuft eine Wartezeit fuer beide, die Abdeckung bleibt dieselbe.
  const knopf = seite.getByRole("button", { name: /später|spaeter|later|más tarde|mas tarde/i })
    .or(seite.getByRole("button", { name: /überspringen|ueberspringen|skip|saltar|omitir/i })).first();
  for (const runde of [0, 1]) {
    try {
      if (await knopf.isVisible({ timeout: runde ? 600 : 1200 })) await knopf.click({ timeout: 3000 });
    } catch { /* kein Overlay da — der Normalfall */ }
    if (!runde) await seite.waitForTimeout(700);
  }
}

/**
 * Handgriffe, die eine Lehrkraft wirklich macht. Jeder legt etwas an, laedt
 * die Seite neu und besteht darauf, dass es noch da ist — nur so faellt ein
 * Formular auf, das zwar rendert, aber nichts speichert.
 *
 * Bewusst wenige, dafuer haltbare Wege: Beschriftungen aendern sich, IDs gibt
 * es kaum. Wo ein Bedienelement fehlt, ist genau das der Befund.
 */
const BEDIENUNG = [
  {
    name: "Notizzettel anlegen und tippen (/notizbrett)",
    pfad: "/notizbrett",
    async schritte(seite) {
      // Beschriftung je nach Sprache des Kontos.
      const neu = seite.getByRole("button", { name: /neuer? zettel|neu$|new note|new$|nueva? nota/i }).first();
      await neu.click({ timeout: 8000 });
      const feld = seite.locator("input[placeholder]").first();
      await feld.fill(MARKE, { timeout: 8000 });
      // Der Zettel speichert gebuendelt (600 ms) — abwarten, sonst prueft der
      // Test das Neuladen gegen einen noch nicht gesendeten Stand.
      await seite.waitForTimeout(1500);
    },
  },
  {
    name: "Thema anlegen (/topics)",
    pfad: "/topics",
    async schritte(seite) {
      // Der Knopf traegt nur ein Icon; erkennbar ist er am title-Attribut.
      await seite.locator("[title='Neues Thema'], [title='New topic'], [title='Nuevo tema']")
        .first().click({ timeout: 8000 });
      const feld = seite.locator("input:visible").last();
      await feld.fill(MARKE, { timeout: 8000 });
      await feld.press("Enter");
      await seite.waitForTimeout(1200);
    },
  },
];

/** Einen Handgriff ausfuehren und pruefen, dass er das Neuladen ueberlebt. */
async function bediene(kontext, flow) {
  const { seite, probleme } = await neueSeite(kontext);
  // Hier zaehlt nur der Absturz: Konsolenfehler und 4xx bewertet der Rundgang.
  const handgriff = async () => {
    await seite.goto(flow.pfad, { waitUntil: "networkidle", timeout: 30000 });
    await tourWegklicken(seite);
    await flow.schritte(seite);
    await seite.reload({ waitUntil: "networkidle" });
    const text = await seite.locator("body").innerText();
    const drin = text.includes(MARKE) || (await seite.locator(`input[value='${MARKE}']`).count()) > 0;
    if (!drin) return { ok: false, detail: "nach dem Neuladen verschwunden — wird nicht gespeichert" };
    const abstuerze = probleme.filter((p) => p.startsWith("Absturz"));
    if (abstuerze.length) return { ok: false, detail: abstuerze[0] };
    return { ok: true, detail: "angelegt, ueberlebt das Neuladen" };
  };
  try {
    return await mitFrist(handgriff(), FRIST_SEITE, flow.pfad);
  } catch (e) {
    return { ok: false, detail: String(e.message || e).split("\n")[0].slice(0, 140) };
  } finally {
    await seite.close().catch(() => {});
  }
}

/**
 * Reste eines abgebrochenen Laufs abraeumen, BEVOR die Bedienprobe anfaengt.
 *
 * Sicherheitsnetz wie in scripts/aufraeumen.py: geloescht wird ausschliesslich,
 * was die Marke traegt — und geprueft wird das unmittelbar vor dem DELETE,
 * nicht nur bei der Auswahl. Rueckgabe: wie viel weg musste.
 */
async function resteAbraeumen(api) {
  let weg = 0;
  // Klassen auch: die Reihenfolge-Probe legt eine an. Bleibt sie liegen, faellt
  // die naechste Runde ueber den doppelten Namen.
  for (const pfad of ["/api/notizblock", "/api/topics", "/api/classes"]) {
    try {
      for (const eintrag of await (await api(pfad)).json()) {
        if (!`${eintrag.title || ""}${eintrag.name || ""}`.includes(MARKE)) continue;
        await api(`${pfad}/${eintrag.id}`, "delete");
        await api(`${pfad}/${eintrag.id}/purge`, "delete").catch(() => {});
        weg++;
      }
    } catch { /* was bleibt, faellt gleich beim Anlegen auf */ }
  }
  return weg;
}

/** IDs, die es vor der Bedienprobe schon gab. */
async function bestand(api) {
  const ids = async (pfad) => {
    try { return new Set((await (await api(pfad)).json()).map((x) => x.id)); } catch { return new Set(); }
  };
  return { notizblock: await ids("/api/notizblock"), topics: await ids("/api/topics") };
}

/** Genau das wieder entfernen, was die Bedienprobe angelegt hat. */
async function aufraeumenBedienung(api, vorher) {
  for (const [pfad, schluessel] of [["/api/notizblock", "notizblock"], ["/api/topics", "topics"]]) {
    try {
      for (const eintrag of await (await api(pfad)).json()) {
        const neuAngelegt = !vorher[schluessel].has(eintrag.id);
        // Zusaetzlich alles mit der Marke: lief ein frueherer Testlauf parallel
        // oder brach ab, zaehlt sein Rest sonst als "Bestand" und bliebe liegen.
        const traegtMarke = `${eintrag.title || ""}${eintrag.name || ""}`.includes(MARKE);
        if (neuAngelegt || traegtMarke) await api(`${pfad}/${eintrag.id}`, "delete");
      }
    } catch { /* was bleibt, faellt beim naechsten Lauf auf */ }
  }
}

/** Holt die eingebettete Lernpfad-App ihre Inhalte vom Server? */
async function ladeLernpfadDaten(kontext) {
  const seite = await kontext.newPage();
  const gesehen = [];
  seite.on("request", (r) => { if (r.url().includes("/api/lernpfad/")) gesehen.push(new URL(r.url()).pathname); });
  const holen = async () => {
    await seite.goto("/lernpfad", { waitUntil: "networkidle", timeout: 30000 });
    await tourWegklicken(seite);
    await seite.waitForTimeout(2500);
    if (!gesehen.some((p) => p.endsWith("/exercises"))) {
      return { ok: false, detail: "ruft /api/lernpfad/exercises nie auf — zeigt nur den lokalen Cache, "
                                  + "im frischen Browser also nichts" };
    }
    return { ok: true, detail: `holt ${[...new Set(gesehen)].length} Datenquellen vom Server` };
  };
  try {
    return await mitFrist(holen(), FRIST_SEITE, "/lernpfad");
  } catch (e) {
    return { ok: false, detail: String(e.message || e).split("\n")[0].slice(0, 140) };
  } finally {
    await seite.close().catch(() => {});
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Lernpfad — die einzige Oberflaeche, die nicht React ist
//
// Die App ist bewusst NICHT nachgebaut worden (siehe CLAUDE.md): 2000 Zeilen
// erprobtes Vanilla-JS, in-page in einen Host `#lp-app` gemountet. Genau
// deshalb steht sie in keinem Unit-Test — geprueft wurde bis hier nur, DASS sie
// ihre Daten holt. Diese Gruppe bedient sie wie eine Lehrkraft und besteht
// nach jedem Handgriff auf einem Neuladen: der localStorage der App ist nur
// Anzeige-Cache, der Server ist autoritativ. Wer nicht neu laedt, prueft den
// Cache und nennt es „gespeichert".
//
// Zusaetzlich der Adapter (vonKern/zuKern in app.js): die Oberflaeche kennt
// Thema/Unterthema als TEXT, der Kern kennt nur `topic_id`. Bricht die
// Uebersetzung, sieht die Oberflaeche heil aus und speichert trotzdem falsch —
// darum wird nach dem Anlegen die API direkt gegengelesen.
//
// Alles Angelegte traegt LP_MARKE und wird restlos wieder abgeraeumt; die
// Themen entstehen dabei IM KERN (die App legt sie bei Bedarf an) und sind
// damit ebenfalls Testdaten, die weg muessen.
const LP_MARKE = "ZZ-Selbsttest-LP";
const LP_THEMA = `${LP_MARKE} Thema`;
const LP_UNTER = `${LP_MARKE} Unterthema`;
const LP_KERNTHEMA = `${LP_MARKE} Kernthema`;
const LP_KLASSE = `${LP_MARKE} 9x`;
const LP_SCHUELER = `${LP_MARKE} Muster`;
const LP_GENTHEMA = `${LP_MARKE} Generator`;
const LP_PFAD = `${LP_MARKE} Pfad`;
const LP_TEXT = `${LP_MARKE} Aufgabentext`;
const LP_KARTE = 990001;          // card_id des Testschuelers

/** JSON einer API-Antwort — mit Status im Fehlerfall, nie stilles `null`. */
async function lpJson(api, pfad) {
  const r = await api(pfad);
  if (!r.ok()) throw new Error(`GET ${pfad} → HTTP ${r.status()}`);
  const daten = await r.json();
  if (!Array.isArray(daten)) throw new Error(`GET ${pfad} liefert kein Array`);
  return daten;
}

/**
 * Die Lernpfad-Seite oeffnen und warten, bis die eingebettete App wirklich
 * steht: Host gemountet, Formular im DOM, Aufgaben vom Server geholt.
 * Gewartet wird auf Ergebnisse, nicht auf die Uhr.
 */
async function lpOeffnen(seite, pfad = "/lernpfad") {
  // Toasts der App mitschneiden — sie sind oft die einzige Begruendung, warum
  // ein Handgriff nichts gespeichert hat ("Keine Schüler in dieser Klasse").
  await seite.addInitScript(() => {
    if (window.__lpToasts) return;
    window.__lpToasts = [];
    window.addEventListener("message", (e) => {
      // Der Lernpfad wird in-page gemountet und schickt seine Toasts per
      // window.postMessage an dasselbe Fenster — die Herkunft ist also immer
      // die eigene. Alles andere (Werbe-Rahmen, fremde Einbettung) hat hier
      // nichts zu melden: sonst koennte fremder Text als Toast der App im
      // Testbericht landen.
      if (e.origin !== location.origin) return;
      if (e.data && e.data.type === "lernpfad:toast") window.__lpToasts.push(String(e.data.msg));
    });
    // Jeden Klick mitschreiben, samt Ziel. Bleibt ein Handgriff wirkungslos,
    // ist das die einzige Auskunft darueber, WO der Klick gelandet ist — auf
    // dem Knopf (dann liegt es an der App) oder daneben (dann an der Ebene
    // darueber). Ohne das bleibt es bei „nichts passiert".
    // Stille Ausnahmen: eine abgewiesene Zusage (unhandledrejection) taucht in
    // WebKit weder als pageerror noch verlaesslich in der Konsole auf. Genau so
    // verschwindet ein Handgriff spurlos — deshalb hier mitschreiben.
    // Warnungen mitschreiben. Die App begruendet abgelehnte Handgriffe zum Teil
    // NUR mit console.warn (savePfad: „laeuft bereits" / „zu schnell
    // hintereinander") — und weil der Test nur Fehler sammelt, blieb genau die
    // Begruendung unsichtbar, die den Fall erklaert.
    window.__lpWarn = [];
    const _warn = console.warn.bind(console);
    console.warn = (...a) => { window.__lpWarn.push(a.map(String).join(" ").slice(0, 200)); _warn(...a); };
    window.__lpFehler = [];
    window.addEventListener("unhandledrejection", (e) => window.__lpFehler.push(
      `unhandledrejection: ${String((e.reason && (e.reason.stack || e.reason.message)) || e.reason).slice(0, 300)}`));
    window.addEventListener("error", (e) => window.__lpFehler.push(`error: ${String(e.message || "").slice(0, 200)}`));
    window.__lpKlicks = [];
    document.addEventListener("click", (e) => {
      const el = e.target;
      window.__lpKlicks.push(el ? el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "")
        + (typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : "") : "?");
    }, true);
  });
  const geladen = seite.waitForResponse(
    (r) => r.url().includes("/api/lernpfad/exercises") && r.request().method() === "GET",
    { timeout: 30000 });
  await seite.goto(pfad, { waitUntil: "domcontentloaded", timeout: 30000 });
  await tourWegklicken(seite);
  await seite.waitForSelector("#lp-app #aufgabe-form", { state: "attached", timeout: 20000 });
  const antwort = await geladen;
  if (!antwort.ok()) throw new Error(`GET /api/lernpfad/exercises → HTTP ${antwort.status()}`);
  // Die Oberflaeche baut sich erst NACH der Antwort neu auf. Auf das Ergebnis
  // warten (Aufgaben-Tabelle fertig gerendert), nicht auf eine Wartezeit.
  await seite.waitForFunction(() => !!document.querySelector("#lp-app #aufgaben-tabelle tbody"),
    null, { timeout: 15000 });
  // Und bis die Nachladerei fertig ist: die App baut ihre Generator-Selektoren
  // ganz am ENDE des Ladens neu auf (refreshGeneratorDropdowns) und verwirft
  // dabei eine schon getroffene Themenwahl. Wer frueher tippt, tippt ins Leere.
  await seite.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => { /* eine haengende Anfrage faellt an anderer Stelle auf */ });
  return seite;
}

/**
 * Auf ein sichtbares Element warten — und im Fehlerfall SAGEN, worauf.
 *
 * Ein nacktes `waitFor` meldet nur „Timeout 15000ms". Die App begruendet ihre
 * Verweigerung aber in einem Toast („Keine Aufgaben für dieses Thema"), und
 * genau der gehoert in den Bericht.
 */
async function lpWarte(seite, selektor, was, ms = 15000) {
  try {
    await seite.locator(selektor).waitFor({ state: "visible", timeout: ms });
  } catch {
    throw new Error(`${was} erscheint nicht (${selektor})${await lpToast(seite)}`);
  }
}

/**
 * Den gestylten Bestaetigungs-Dialog der App wegklicken.
 *
 * `confirmDlg` (app.js) haengt seine Ebene als LETZTES Kind an #lp-app. Ueber
 * die ganze Seite zu suchen reicht nicht: die Loesch-Knoepfe der Tabelle tragen
 * denselben Namen (title="Löschen") — Playwright bricht dann mit
 * „strict mode violation" ab.
 */
async function lpBestaetigen(seite, name) {
  const dialog = seite.locator("#lp-app > div").last();
  await dialog.getByRole("button", { name }).click({ timeout: 10000 });
}

/** Zuletzt gezeigte Meldungen der App — als Begruendung im Fehlerfall. */
async function lpToast(seite) {
  const msgs = await seite.evaluate(() => window.__lpToasts || []).catch(() => []);
  return msgs.length ? ` (Meldung der App: „${msgs.slice(-2).join(" / ")}")` : "";
}

/**
 * Der Zustand des Generators, wenn „In Lernpfad speichern" nichts bewirkt.
 *
 * „kein POST" allein ist als Befund wertlos: die App lehnt den Handgriff aus
 * einem halben Dutzend Gruenden ab, und die meisten davon sagt sie niemandem
 * (previewData leer, nichts angehakt, kein Thema, falscher Pfad — und die
 * Bremse in savePfad, die nur eine console.warn hinterlaesst). Genau daran ist
 * die Suche unter WebKit haengengeblieben, bis hier stand, was der Bildschirm
 * zeigt: Auswahl, Vorschau, Haken, wer auf dem Knopf liegt, wohin die Klicks
 * gingen, welche Warnungen und stillen Ausnahmen dabei anfielen.
 */
async function lpStand(seite) {
  const s = await seite.evaluate(() => {
    const q = (w) => document.querySelector(`#lp-app ${w}`);
    const pfad = q("#gen-pfad");
    const vorschau = q("#preview-area");
    // Wer liegt auf dem Speichern-Knopf? Ein unsichtbarer Deckel faengt den
    // Fingertipp ab, ohne dass irgendwo ein Fehler entsteht — die Lehrkraft
    // tippt und nichts passiert. Genau dieser Fall ist ohne Namen nicht zu
    // finden, deshalb steht hier das Element unter dem Mauszeiger.
    const knopf = q("#btn-save-to-pfad");
    let deckung = "kein #btn-save-to-pfad";
    if (knopf) {
      const r = knopf.getBoundingClientRect();
      const oben = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const name = (el) => el ? el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "")
        + (typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : "") : "nichts";
      deckung = oben === knopf ? "frei" : `verdeckt von ${name(oben)}`;
    }
    // Ist der Knopf zwischen Merken und Klicken ausgetauscht worden? app.js
    // haengt seine Handler EINMAL beim Start an den Knopf (app.js:2222). Wird
    // der Knoten zwischendurch neu gebaut, sieht alles heil aus, aber der
    // Handler haengt am weggeworfenen Knoten — der Tipp verpufft.
    const knopfIdentitaet = !knopf ? "kein Knopf"
      : (knopf.__zzGemerkt ? "derselbe Knoten wie vor dem Klick" : "AUSGETAUSCHT seit dem Merken (Handler hängt am alten Knoten)");
    return {
      deckung, knopfIdentitaet,
      pfad: pfad ? `${pfad.value || "(leer = Einzeln)"}/${pfad.selectedOptions[0]?.textContent || ""}` : "kein #gen-pfad",
      thema: q("#gen-thema")?.value || "(leer)",
      kurs: q("#gen-klasse")?.value || "(leer)",
      vorschau: vorschau ? (getComputedStyle(vorschau).display === "none" ? "verborgen" : "sichtbar") : "fehlt",
      angehakt: document.querySelectorAll("#lp-app #preview-area input[type=checkbox]:checked").length,
      kaesten: document.querySelectorAll("#lp-app #preview-area input[type=checkbox]").length,
      meldungen: (window.__lpToasts || []).join(" / "),
      klicks: (window.__lpKlicks || []).slice(-6).join(" → ") || "keine",
      stilleFehler: (window.__lpFehler || []).slice(0, 2).join(" | ") || "keine",
      warnungen: (window.__lpWarn || []).slice(-3).join(" | ") || "keine",
    };
  }).catch((e) => ({ pfad: `Stand nicht lesbar: ${String(e.message || e).slice(0, 60)}` }));
  return ` [Stand: Pfad ${s.pfad}, Thema ${s.thema}, Kurs ${s.kurs}, Vorschau ${s.vorschau}, `
    + `${s.angehakt}/${s.kaesten} angehakt, Knopf ${s.deckung} · ${s.knopfIdentitaet}; letzte Klicks: ${s.klicks}; `
    + `stille Ausnahmen: ${s.stilleFehler}; Warnungen: ${s.warnungen}; Meldungen: ${s.meldungen || "keine"}]`;
}

/** Nach der Marke suchen und zaehlen, wie viele Aufgaben-Zeilen sie zeigen. */
async function lpSuche(seite, text) {
  // Die Suche filtert synchron im input-Handler; nach `fill` steht das Ergebnis.
  await seite.fill("#lp-app #aufgaben-suche", text);
  return await seite.locator(`#lp-app #aufgaben-tabelle tbody tr:has-text("${text}")`).count();
}

/** Mountet die App ueberhaupt — Host, Reiter, Inhalt, keine Fehler? */
async function lpMountet(kontext) {
  const { seite, probleme } = await neueSeite(kontext);
  try {
    await lpOeffnen(seite, "/lernpfad");
    const reiter = await seite.locator("#lp-app .nav-link.tab").count();
    if (reiter < 4)
      return { ok: false, detail: `nur ${reiter} Reiter unter #lp-app — das Markup von /lp/index.html ist nicht (vollständig) injiziert` };
    const zeichen = (await seite.locator("#lp-app").innerText()).trim().length;
    if (zeichen < 50)
      return { ok: false, detail: `#lp-app bleibt leer (${zeichen} Zeichen) — App nicht gemountet` };
    if (probleme.length) return { ok: false, detail: probleme.slice(0, 3).join(" | ") };
    return { ok: true, detail: `#lp-app gemountet, ${reiter} Reiter, ${zeichen} Zeichen, keine Konsolen-/Netzfehler` };
  } finally {
    await seite.close().catch(() => {});
  }
}

/** Aufgabe ueber das Formular anlegen — und das Neuladen ueberstehen. */
async function lpAufgabeAnlegen(kontext) {
  const { seite } = await neueSeite(kontext);
  try {
    await lpOeffnen(seite, "/lernpfad");
    // Das Formular startet eingeklappt; eine Lehrkraft klickt die Ueberschrift an.
    await seite.click("#lp-app #aufgaben-form-title");
    await lpWarte(seite, "#lp-app #aufgabe-form", "Das Aufgaben-Formular", 10000);

    // Autocomplete: nach dem Tippen legt sich eine Vorschlagsliste ueber das
    // Formular. Escape schliesst sie — sonst faengt sie den naechsten Klick ab.
    const tippe = async (id, wert) => {
      await seite.fill(`#lp-app #${id}`, wert);
      await seite.press(`#lp-app #${id}`, "Escape");
    };
    await tippe("aufgabe-thema", LP_THEMA);
    await seite.selectOption("#lp-app #aufgabe-kategorie", "Basis");
    await lpWarte(seite, "#lp-app #aufgabe-unterthema", "Das Feld Unterthema", 10000);
    await tippe("aufgabe-unterthema", LP_UNTER);
    await tippe("aufgabe-operator", "Berechne");
    await lpWarte(seite, "#lp-app #aufgabe-aufgabentext", "Das Feld Aufgabentext", 10000);
    await seite.fill("#lp-app #aufgabe-aufgabentext", LP_TEXT);

    const angelegt = seite.waitForResponse(
      (r) => /\/api\/lernpfad\/exercises$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
      { timeout: 25000 }).catch(() => null);
    await seite.click("#lp-app #aufgabe-submit-btn");
    const antwort = await angelegt;
    if (!antwort)
      return { ok: false, detail: `kein POST /api/lernpfad/exercises nach „Aufgabe speichern"${await lpToast(seite)}` };
    if (antwort.status() !== 201)
      return { ok: false, detail: `POST /api/lernpfad/exercises → HTTP ${antwort.status()} ${(await antwort.text().catch(() => "")).slice(0, 120)}` };

    // Der Beweis: neu laden. Was nur im Anzeige-Cache stand, ist jetzt weg.
    await lpOeffnen(seite, "/lernpfad");
    const treffer = await lpSuche(seite, LP_THEMA);
    if (treffer !== 1)
      return { ok: false, detail: `nach dem Neuladen ${treffer} Aufgaben zu „${LP_THEMA}" statt 1 — nicht gespeichert` };
    return { ok: true, detail: "über das Formular angelegt, überlebt das Neuladen" };
  } finally {
    await seite.close().catch(() => {});
  }
}

/**
 * Der Adapter, an der API gegengelesen.
 *
 * Die Oberflaeche hat Thema/Unterthema als Text getippt. Im Kern muss daraus
 * eine echte Taxonomie geworden sein (Thema > Unterthema), und die Aufgabe muss
 * per `topic_id` darauf zeigen — nicht bloss einen Text tragen.
 */
async function lpAdapter(api) {
  const themen = await lpJson(api, "/api/topics");
  const ober = themen.find((t) => t.name === LP_THEMA && !t.parent_id);
  if (!ober)
    return { ok: false, detail: `Thema „${LP_THEMA}" fehlt in /api/topics — der Adapter hat es nicht im Kern angelegt` };
  const unter = themen.find((t) => t.name === LP_UNTER && t.parent_id === ober.id);
  if (!unter)
    return { ok: false, detail: `„${LP_UNTER}" hängt nicht als Unterthema unter „${LP_THEMA}" (Kern-Taxonomie unvollständig)` };

  const aufgaben = await lpJson(api, "/api/lernpfad/exercises");
  const unsere = aufgaben.filter((e) => String(e.aufgabentext || "") === LP_TEXT);
  if (unsere.length !== 1)
    return { ok: false, detail: `${unsere.length} Aufgaben mit der Marke in /api/lernpfad/exercises statt genau 1` };
  const ex = unsere[0];
  if (ex.topic_id == null)
    return { ok: false, detail: `Aufgabe ${ex.id} hat topic_id=null — der Adapter hat das Thema verloren (Text gespeichert, Kern-Bezug nicht)` };
  if (ex.topic_id !== unter.id)
    return { ok: false, detail: `Aufgabe ${ex.id} zeigt auf topic_id=${ex.topic_id}, erwartet ${unter.id} („${LP_UNTER}")` };
  return { ok: true, detail: `topic_id=${unter.id} → „${LP_THEMA} > ${LP_UNTER}" existiert wirklich im Kern` };
}

/** Und andersherum: ein per API angelegtes Kern-Thema muss die App anzeigen. */
async function lpKernThemaSichtbar(kontext) {
  const { seite } = await neueSeite(kontext);
  try {
    await lpOeffnen(seite, "/lernpfad?tab=generator");
    try {
      await seite.waitForFunction(
        (name) => [...document.querySelectorAll("#lp-app #gen-thema option")].some((o) => o.value === name),
        LP_KERNTHEMA, { timeout: 15000 });
    } catch {
      const da = await seite.locator("#lp-app #gen-thema option").allTextContents().catch(() => []);
      return { ok: false, detail: `per API angelegtes Kern-Thema „${LP_KERNTHEMA}" fehlt in der Themenauswahl `
        + `(${da.length} Optionen: ${da.slice(0, 6).join(", ") || "keine"})` };
    }
    return { ok: true, detail: `per API angelegtes Kern-Thema „${LP_KERNTHEMA}" steht in der Themenauswahl` };
  } finally {
    await seite.close().catch(() => {});
  }
}

/**
 * Lernpfad UND Lernleiter — zwei verschiedene Dinge (CLAUDE.md): ein Lernpfad
 * besteht aus mehreren Lernleitern. Beide ueber die Oberflaeche anlegen.
 */
async function lpPfadMitLernleiter(kontext) {
  // `probleme` wird hier gebraucht: bleibt „In Lernpfad speichern" wirkungslos,
  // ist ein Fehler in der Konsole die naechstliegende Erklaerung — und er ging
  // frueher verloren, weil diese Gruppe nur auf Netzantworten geschaut hat.
  const { seite, probleme } = await neueSeite(kontext);
  try {
    await lpOeffnen(seite, "/lernpfad?tab=lernpfade");
    await seite.fill("#lp-app #pfad-name", LP_PFAD);
    const pfadAngelegt = seite.waitForResponse(
      (r) => /\/api\/lernpfad\/paths$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
      { timeout: 25000 }).catch(() => null);
    await seite.click("#lp-app #pfad-create-btn");
    const a1 = await pfadAngelegt;
    if (!a1) return { ok: false, detail: `kein POST /api/lernpfad/paths nach „Pfad anlegen"${await lpToast(seite)}` };
    if (a1.status() !== 201) return { ok: false, detail: `POST /api/lernpfad/paths → HTTP ${a1.status()}` };

    // „+ Lernleiter hinzufügen" springt in den Generator, mit vorgewaehltem Pfad.
    await lpWarte(seite, "#lp-app #pfad-add-ll-btn", "Der Knopf zum Hinzufügen einer Lernleiter", 10000);
    await seite.click("#lp-app #pfad-add-ll-btn");
    await lpWarte(seite, "#lp-app #tab-generator.active", "Der Generator-Reiter", 10000);

    // Thema und Kurs waehlen — mit Wiederholung, und zwar aus einem konkreten
    // Grund: der Reiterwechsel baut die Selektoren MEHRFACH neu auf. Die App
    // meldet den Wechsel an die Shell, die setzt ?tab=generator, schickt ihn
    // zurueck, und jedes switchTab ruft refreshGeneratorDropdowns — asynchron.
    // Jeder Neuaufbau wirft die Themenwahl weg (der Kurs wird erhalten). Der
    // Test wiederholt deshalb, bis das ERGEBNIS da ist (die Vorschau steht),
    // hoechstens vier Mal — gewartet wird auf Ergebnisse, nicht auf die Uhr.
    let vorschau = false;
    let zuletzt = "";
    let anlaeufe = 0;
    for (let versuch = 1; versuch <= 4 && !vorschau; versuch++) {
      anlaeufe = versuch;
      await seite.selectOption("#lp-app #gen-thema", LP_GENTHEMA);
      await seite.selectOption("#lp-app #gen-klasse", LP_KLASSE);
      const gewaehlt = {
        thema: await seite.inputValue("#lp-app #gen-thema"),
        kurs: await seite.inputValue("#lp-app #gen-klasse"),
      };
      if (gewaehlt.thema !== LP_GENTHEMA || gewaehlt.kurs !== LP_KLASSE) {
        zuletzt = `Auswahl hält nicht (Thema „${gewaehlt.thema}", Kurs „${gewaehlt.kurs}")`;
        continue;
      }
      try {
        await seite.locator("#lp-app #gen-config").waitFor({ state: "visible", timeout: 5000 });
        await seite.click("#lp-app #btn-generate-config");
        await seite.locator("#lp-app #preview-area").waitFor({ state: "visible", timeout: 5000 });
        vorschau = true;
      } catch {
        zuletzt = "Vorschau bleibt aus";
      }
    }
    if (!vorschau)
      return { ok: false, detail: `Die Vorschau der Lernleiter erscheint nicht — ${zuletzt}${await lpToast(seite)}` };

    const llGespeichert = seite.waitForResponse(
      (r) => /\/api\/lernpfad\/paths\/\d+\/ladders$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
      { timeout: 25000 }).catch(() => null);
    // Den Knoten markieren, BEVOR geklickt wird — siehe lpStand: nur so laesst
    // sich hinterher sagen, ob der Knopf noch derselbe ist.
    await seite.evaluate(() => { const b = document.querySelector("#lp-app #btn-save-to-pfad"); if (b) b.__zzGemerkt = true; });
    // Kurz warten, BEVOR gespeichert wird — und zwar aus einem konkreten Grund:
    // `savePfad` (lp/js/app.js:2313) lehnt jeden Aufruf ab, der weniger als
    // 400 ms nach dem letzten kommt, und `saveToPfad` kehrt danach OHNE Meldung
    // zurueck (app.js:2287). Unter WebKit laeuft der Weg von der Vorschau zum
    // Speichern-Klick schnell genug, um genau in dieses Fenster zu fallen — der
    // Test prueft dann die Bremse statt das Speichern. Der Befund selbst bleibt
    // ein Befund (stiller Klick ohne Rueckmeldung, siehe Bericht); hier geht es
    // um das Speichern.
    await seite.waitForTimeout(700);
    await seite.click("#lp-app #btn-save-to-pfad");
    const a2 = await llGespeichert;
    if (!a2) {
      // Gegenprobe: derselbe Knopf, aber per DOM gedrueckt. Spricht die App
      // darauf an, lag es NICHT an ihr, sondern daran, dass der echte Tipp den
      // Knopf nie erreicht hat (Deckel, Ebene, Scrollposition) — auf dem iPad
      // heisst das: die Lehrkraft tippt und es passiert nichts.
      const nachtrag = seite.waitForResponse(
        (r) => /\/api\/lernpfad\/paths\/\d+\/ladders$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
        { timeout: 8000 }).catch(() => null);
      await seite.evaluate(() => document.querySelector("#lp-app #btn-save-to-pfad")?.click()).catch(() => {});
      const domKlick = await nachtrag
        ? "der Klick per DOM speichert sehr wohl — der echte Klick erreicht den Knopf nicht"
        : "auch der Klick per DOM bewirkt nichts — die App speichert nicht";
      return { ok: false, detail: `kein POST …/paths/<id>/ladders nach „In Lernpfad speichern" `
        + `(Vorschau kam im ${anlaeufe}. Anlauf; ${domKlick})${await lpStand(seite)}`
        + (probleme.length ? ` [Konsole: ${probleme.slice(0, 3).join(" | ")}]` : " [Konsole still]") };
    }
    if (a2.status() !== 201) return { ok: false, detail: `POST …/ladders → HTTP ${a2.status()}` };

    // Neu laden — steht die Lernleiter danach wirklich im Pfad?
    await lpOeffnen(seite, "/lernpfad?tab=lernpfade");
    const zeile = seite.locator(`#lp-app #pfade-list .list-row:has-text("${LP_PFAD}")`).first();
    try {
      await zeile.waitFor({ timeout: 15000 });
    } catch {
      return { ok: false, detail: `Pfad „${LP_PFAD}" ist nach dem Neuladen verschwunden — nicht gespeichert` };
    }
    const text = (await zeile.innerText()).replace(/\s+/g, " ").trim();
    if (!/\b1 Lernleitern\b/.test(text))
      return { ok: false, detail: `Pfad zeigt nach dem Neuladen „${text}" — die Lernleiter ist nicht gespeichert` };
    return { ok: true, detail: `Pfad + 1 Lernleiter über die Oberfläche angelegt, überlebt das Neuladen` };
  } finally {
    await seite.close().catch(() => {});
  }
}

/** Pfad ueber die Oberflaeche loeschen (Papierkorb) — und weg bleiben. */
async function lpPfadLoeschen(kontext) {
  const { seite } = await neueSeite(kontext);
  try {
    await lpOeffnen(seite, "/lernpfad?tab=lernpfade");
    const zeile = seite.locator(`#lp-app #pfade-list .list-row:has-text("${LP_PFAD}")`).first();
    try {
      await zeile.waitFor({ timeout: 15000 });
    } catch {
      return { ok: false, detail: `Pfad „${LP_PFAD}" nicht in der Liste — nichts zu löschen` };
    }
    // Sicherheitsnetz unmittelbar vor dem Loeschen: nur was die Marke traegt.
    const beleg = await zeile.innerText();
    if (!beleg.includes(LP_MARKE))
      return { ok: false, detail: `Zeile ohne Marke („${beleg.slice(0, 60)}") — nicht gelöscht` };

    const geloescht = seite.waitForResponse(
      (r) => /\/api\/lernpfad\/paths\/\d+$/.test(new URL(r.url()).pathname) && r.request().method() === "DELETE",
      { timeout: 25000 }).catch(() => null);
    await zeile.locator("[data-action='delete']").click();
    await lpBestaetigen(seite, /^In den Papierkorb$/);
    const antwort = await geloescht;
    if (!antwort) return { ok: false, detail: `kein DELETE …/paths/<id> nach dem Löschen${await lpToast(seite)}` };
    if (antwort.status() >= 400) return { ok: false, detail: `DELETE …/paths/<id> → HTTP ${antwort.status()}` };

    await lpOeffnen(seite, "/lernpfad?tab=lernpfade");
    const uebrig = await seite.locator(`#lp-app #pfade-list .list-row:has-text("${LP_PFAD}")`).count();
    if (uebrig) return { ok: false, detail: `nach dem Neuladen noch ${uebrig}× „${LP_PFAD}" — nur lokal gelöscht` };
    return { ok: true, detail: "in den Papierkorb verschoben, bleibt nach dem Neuladen weg" };
  } finally {
    await seite.close().catch(() => {});
  }
}

/** Aufgabe ueber die Oberflaeche loeschen — und weg bleiben. */
async function lpAufgabeLoeschen(kontext) {
  const { seite } = await neueSeite(kontext);
  try {
    await lpOeffnen(seite, "/lernpfad");
    const treffer = await lpSuche(seite, LP_THEMA);
    if (treffer !== 1)
      return { ok: false, detail: `${treffer} Aufgaben zu „${LP_THEMA}" gefunden statt genau 1 — nichts gelöscht` };
    const zeile = seite.locator(`#lp-app #aufgaben-tabelle tbody tr:has-text("${LP_THEMA}")`).first();
    const beleg = await zeile.innerText();
    if (!beleg.includes(LP_MARKE))
      return { ok: false, detail: `Zeile ohne Marke („${beleg.slice(0, 60)}") — nicht gelöscht` };

    const geloescht = seite.waitForResponse(
      (r) => /\/api\/lernpfad\/exercises\/\d+$/.test(new URL(r.url()).pathname) && r.request().method() === "DELETE",
      { timeout: 25000 }).catch(() => null);
    await zeile.locator("[data-action='delete']").click();
    await lpBestaetigen(seite, /^Löschen$/);
    const antwort = await geloescht;
    if (!antwort) return { ok: false, detail: `kein DELETE …/exercises/<id> nach dem Löschen${await lpToast(seite)}` };
    if (antwort.status() >= 400) return { ok: false, detail: `DELETE …/exercises/<id> → HTTP ${antwort.status()}` };

    await lpOeffnen(seite, "/lernpfad");
    const uebrig = await lpSuche(seite, LP_THEMA);
    if (uebrig !== 0)
      return { ok: false, detail: `nach dem Neuladen noch ${uebrig} Aufgaben mit der Marke — nur im Anzeige-Cache gelöscht` };
    return { ok: true, detail: "über die Oberfläche gelöscht, bleibt nach dem Neuladen weg" };
  } finally {
    await seite.close().catch(() => {});
  }
}

/**
 * Der Reiter „Klasse" zeigt nur an — gepflegt wird unter /classes (CLAUDE.md).
 * Zwei getrennte Befunde: erscheinen die Kern-Klassen, und sind die per CSS
 * versteckten Pflege-Formulare wirklich nicht bedienbar (nur versteckt, nicht
 * entfernt — app.js haengt ueberall daran).
 */
async function lpKlasseTab(kontext) {
  const { seite } = await neueSeite(kontext);
  try {
    await lpOeffnen(seite, "/lernpfad?tab=klasse");
    await lpWarte(seite, "#lp-app #tab-klasse.active", "Der Reiter Klasse", 10000);

    // Nicht bedienbar sein muessen die BEDIENELEMENTE, nicht der Kasten. Der
    // Kasten #klasse-form-panel muss sogar sichtbar sein: darin stehen die
    // Klassen-Chips (#klassen-chips), und ohne sie zeigt der Reiter gar nichts.
    // Die erste Fassung dieser Pruefung sah auf das ganze Panel — und haette
    // damit den Fehler zementiert, den sie aufgedeckt hat.
    const formulare = [];
    for (const wahl of ["#klasse-name", "#btn-klasse-add", "#schueler-panel"]) {
      const el = seite.locator(`#lp-app ${wahl}`);
      if (await el.count() === 0) { formulare.push(`${wahl} ist ENTFERNT statt versteckt — app.js hängt daran`); continue; }
      if (await el.isVisible()) formulare.push(`${wahl} ist bedienbar — Pflege gehört nach /classes`);
    }
    // Und die Gegenprobe: der Loeschknopf am Chip darf nicht erscheinen, sonst
    // liesse sich eine Kern-Klasse aus dem Modul heraus entfernen.
    const loeschKnopf = seite.locator("#lp-app .klasse-chip .chip-delete");
    if (await loeschKnopf.count() > 0 && await loeschKnopf.first().isVisible())
      formulare.push("der Löschknopf am Klassen-Chip ist sichtbar — Klassen gehören dem Kern");
    const anzeige = { ok: formulare.length === 0, detail: formulare.length ? formulare.join(" | ")
      : "Klassen sichtbar, Pflege-Bedienelemente versteckt (CSS) — Ansicht ja, Bearbeitung nein" };

    // Erscheinen die Klassen des Kerns? SICHTBARER Text zaehlt, nicht das DOM —
    // gerendert und dann per CSS ausgeblendet hilft der Lehrkraft nicht.
    const reiter = seite.locator("#lp-app #tab-klasse");
    const sichtbar = await reiter.innerText();
    const imDom = await reiter.evaluate((el) => el.textContent || "");
    let klassen;
    if (sichtbar.includes(LP_KLASSE)) {
      klassen = { ok: true, detail: `Kern-Klasse „${LP_KLASSE}" wird im Reiter angezeigt` };
    } else if (imDom.includes(LP_KLASSE)) {
      // Die Daten sind da, nur unsichtbar: die Chips stehen in #klassen-chips,
      // das liegt IN dem per CSS versteckten Pflege-Panel; die Klassenübersicht
      // oeffnet ausschliesslich ein Klick auf eben diese versteckten Chips.
      klassen = { ok: false, detail: `„${LP_KLASSE}" ist gerendert, aber unsichtbar: #klassen-chips liegt in dem `
        + "per CSS ausgeblendeten #klasse-form-panel (lp/css/style.scoped.css:1182), und #schueler-overview-panel "
        + "öffnet nur ein Klick auf genau diese versteckten Chips (lp/js/app.js:1500) — der Reiter „Klasse\" zeigt gar nichts an" };
    } else {
      klassen = { ok: false, detail: `Kern-Klasse „${LP_KLASSE}" steht weder sichtbar noch im DOM des Reiters `
        + `(sichtbar: ${sichtbar.replace(/\s+/g, " ").trim().slice(0, 100)}…)` };
    }
    return { anzeige, klassen };
  } finally {
    await seite.close().catch(() => {});
  }
}

/**
 * Restlos abraeumen — auch nach einem Fehlschlag, und vor dem Lauf einmal, weil
 * Reste eines abgebrochenen Laufs den naechsten faelschlich gruen faerben.
 *
 * Reihenfolge: Aufgaben (hart), dann Pfade und Klasse (weich → Papierkorb),
 * dann der Papierkorb selbst, zuletzt die Themen (loeschen ihre Unterthemen
 * mit). Geprueft wird die Marke UNMITTELBAR vor jedem DELETE, am Beleg, der sie
 * traegt — nicht bloss bei der Auswahl.
 */
async function lernpfadAufraeumen(api) {
  const traegtMarke = (s) => typeof s === "string" && s.includes(LP_MARKE);
  let weg = 0;
  const fehler = [];
  const holen = async (pfad) => {
    try { return await lpJson(api, pfad); }
    catch (e) { fehler.push(String(e.message || e).slice(0, 90)); return []; }
  };
  const loesche = async (pfad, beleg) => {
    if (!traegtMarke(beleg)) return;             // Sicherheitsnetz
    try {
      const r = await api(pfad, "delete");
      if (r.ok() || r.status() === 404) weg++;
      else fehler.push(`DELETE ${pfad} → HTTP ${r.status()}`);
    } catch (e) { fehler.push(`DELETE ${pfad} → ${String(e.message || e).slice(0, 60)}`); }
  };

  const themen = await holen("/api/topics");
  const themaName = new Map(themen.map((t) => [t.id, t.name]));

  for (const ex of await holen("/api/lernpfad/exercises")) {
    const beleg = traegtMarke(ex.aufgabentext) ? ex.aufgabentext : (themaName.get(ex.topic_id) || "");
    await loesche(`/api/lernpfad/exercises/${ex.id}`, beleg);
  }
  for (const p of await holen("/api/lernpfad/paths")) await loesche(`/api/lernpfad/paths/${p.id}`, p.name);
  for (const c of await holen("/api/classes")) await loesche(`/api/classes/${c.id}`, c.name);
  // Themen: das Loeschen nimmt die Unterthemen mit.
  for (const t of themen) if (!t.parent_id) await loesche(`/api/topics/${t.id}`, t.name);
  // Papierkorb ZULETZT: alles hier ist weiches Loeschen, auch Themen — der
  // Durchgang stand vorher VOR dem Loeschen der Themen und hat sie deshalb
  // nicht mehr gesehen. Die drei Themen blieben als „Reste" liegen und der
  // Lauf war rot, obwohl aufgeraeumt wurde. Endgueltig weg muss es, sonst
  // liegt es 30 Tage im Konto der Lehrkraft.
  for (const it of await holen("/api/trash")) await loesche(`/api/trash/${it.kind}/${it.id}`, `${it.label} ${it.context}`);

  // Nachschau statt Hoffnung: was traegt die Marke noch?
  const uebrig = [];
  const nachsehen = async (pfad, feld) => {
    for (const x of await holen(pfad)) if (traegtMarke(x[feld])) uebrig.push(`${pfad}: ${x[feld]}`);
  };
  await nachsehen("/api/topics", "name");
  await nachsehen("/api/classes", "name");
  await nachsehen("/api/lernpfad/paths", "name");
  await nachsehen("/api/lernpfad/exercises", "aufgabentext");
  for (const it of await holen("/api/trash")) if (traegtMarke(`${it.label} ${it.context}`)) uebrig.push(`Papierkorb: ${it.label}`);
  return { weg, uebrig, fehler };
}

/** Die ganze Gruppe „Lernpfad" — Vorbereitung, Handgriffe, Aufräumen. */
async function lernpfadProbe(kontext, api) {
  const G = "Lernpfad";
  const schritt = async (name, fn) => {
    let befund;
    try { befund = await mitFrist(fn(), FRIST_SEITE, name); }
    catch (e) { befund = { ok: false, detail: String(e.message || e).split("\n")[0].slice(0, 180) }; }
    notiere(G, name, befund.ok, befund.detail);
    return befund.ok;
  };

  try {
    const vor = await lernpfadAufraeumen(api);
    notiere(G, "Reste des letzten Laufs", !vor.fehler.length,
      vor.fehler.length ? vor.fehler.slice(0, 2).join(" | ")
        : (vor.weg ? `${vor.weg} Reste eines abgebrochenen Laufs abgeräumt` : "keine"));

    // Vorbereitung im Kern: die Lernleiter braucht einen Kurs mit Schülern
    // (Klassen und Schüler gehören dem Kern, nicht dem Modul — Regel 1), und
    // die Gegenrichtung des Adapters braucht ein Thema, das die App NICHT
    // angelegt hat.
    const klasse = await api("/api/classes", "post",
      { name: LP_KLASSE, students: [{ card_id: LP_KARTE, name: LP_SCHUELER, niveau: "G" }] });
    if (!klasse.ok()) {
      notiere(G, "Vorbereitung im Kern", false,
        `POST /api/classes → HTTP ${klasse.status()} ${(await klasse.text().catch(() => "")).slice(0, 120)}`);
      return;
    }
    const thema = await api("/api/topics", "post", { name: LP_KERNTHEMA, parent_id: null });
    if (!thema.ok()) {
      notiere(G, "Vorbereitung im Kern", false, `POST /api/topics → HTTP ${thema.status()}`);
      return;
    }
    // Futter fuer den Generator: ein eigenes Thema mit je einer Aufgabe pro
    // Niveau. Zwei Gruende, das NICHT dem Thema der Handprobe aufzuladen:
    //
    //  - Die Lernleiter mischt nach Niveau (Basis/G/E). Aus einer einzigen
    //    Basis-Aufgabe waehlt sie fuer einen G-Schueler nichts aus, und der
    //    Test scheiterte an der Aufgabenauswahl statt an der Oberflaeche.
    //  - Die Handprobe zaehlt Zeilen zu „${LP_THEMA}"; alles Weitere gehoert in
    //    ein anderes Thema, sonst zaehlt der Test sein eigenes Beiwerk mit.
    //
    // Nebeneffekt, der ebenfalls gebraucht wird: die Aufgabenliste ist damit nie
    // leer. Die App spiegelt eine LEERE Liste bewusst nicht zum Server (Schutz
    // vor Datenverlust, syncAufgaben in lp/js/app.js) — sonst liefe die
    // Loeschprobe in genau diese Schutzklausel statt in den Alltag.
    const genThema = await api("/api/topics", "post", { name: LP_GENTHEMA, parent_id: null });
    if (!genThema.ok()) {
      notiere(G, "Vorbereitung im Kern", false, `POST /api/topics → HTTP ${genThema.status()}`);
      return;
    }
    const genId = (await genThema.json()).id;
    for (const kategorie of ["Basis", "G-Niveau", "E-Niveau"]) {
      const r = await api("/api/lernpfad/exercises", "post",
        { topic_id: genId, kategorie, operator: "Berechne", aufgabentext: `${LP_MARKE} Generatoraufgabe ${kategorie}` });
      if (!r.ok()) {
        notiere(G, "Vorbereitung im Kern", false, `POST /api/lernpfad/exercises (${kategorie}) → HTTP ${r.status()}`);
        return;
      }
    }
    notiere(G, "Vorbereitung im Kern", true,
      `Klasse „${LP_KLASSE}" (1 Schüler), Thema „${LP_KERNTHEMA}" und „${LP_GENTHEMA}" mit 3 Aufgaben angelegt`);

    await schritt("App mountet in-page (#lp-app)", () => lpMountet(kontext));
    const angelegt = await schritt("Aufgabe über das Formular anlegen", () => lpAufgabeAnlegen(kontext));
    if (angelegt) await schritt("Adapter: Thema landet als topic_id im Kern", () => lpAdapter(api));
    await schritt("Adapter rückwärts: Kern-Thema erscheint in der App", () => lpKernThemaSichtbar(kontext));
    if (angelegt) {
      const pfad = await schritt("Lernpfad mit Lernleiter anlegen", () => lpPfadMitLernleiter(kontext));
      if (pfad) await schritt("Lernpfad über die Oberfläche löschen", () => lpPfadLoeschen(kontext));
      await schritt("Aufgabe über die Oberfläche löschen", () => lpAufgabeLoeschen(kontext));
    }

    // Der Reiter „Klasse" liefert zwei Befunde auf einmal.
    let klasseTab;
    try { klasseTab = await mitFrist(lpKlasseTab(kontext), FRIST_SEITE, "Reiter Klasse"); }
    catch (e) {
      const detail = String(e.message || e).split("\n")[0].slice(0, 180);
      klasseTab = { anzeige: { ok: false, detail }, klassen: { ok: false, detail } };
    }
    notiere(G, "Reiter Klasse: Kern-Klassen sichtbar", klasseTab.klassen.ok, klasseTab.klassen.detail);
    notiere(G, "Reiter Klasse: Pflege-Formulare nicht bedienbar", klasseTab.anzeige.ok, klasseTab.anzeige.detail);
  } finally {
    const nach = await lernpfadAufraeumen(api);
    const rest = [...nach.uebrig, ...nach.fehler];
    notiere(G, "Aufgeräumt", rest.length === 0,
      rest.length ? `Reste: ${rest.slice(0, 4).join(" | ")}` : `${nach.weg} Testdaten restlos entfernt`);
  }
}

/**
 * Neue Seite mit Mitschrift.
 *
 * `merke` legt jeden Befund nur EINMAL ab und deckelt die Zahl: eine Seite, die
 * im Sekundentakt denselben Fehler wirft, hat frueher hunderte Zeilen erzeugt
 * und alles andere unlesbar gemacht. Drosselungen (429) laufen in einen
 * eigenen Topf und sind kein Befund.
 */
async function neueSeite(kontext) {
  const seite = await kontext.newPage();
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
  seite.on("pageerror", (e) => merke(`Absturz: ${String(e).slice(0, 160)}`));
  seite.on("response", (r) => {
    if (r.status() === 429) { drossel.push(new URL(r.url()).pathname); return; }
    if (r.status() >= 400 && !istEgal(r.url())) merke(`HTTP ${r.status()} ${new URL(r.url()).pathname}`);
  });
  return { seite, probleme, drossel, merke };
}

/**
 * Eine Seite besuchen — und noch einmal, bevor sie bewertet wird, wenn beim
 * ersten Mal etwas dazwischenkam. Zwei Gruende:
 *
 *   - Drosselung (429): Infrastruktur, siehe `istDrosselung`. Bleibt sie beim
 *     zweiten Mal, steht sie als Hinweis im Bericht — rot wird davon nichts.
 *   - Ruecksprung ans ModuleGate: scheitert der Modul-Abruf einmal (Netz,
 *     Drosselung, abgebrochene Anfrage), arbeitet die Shell mit einer leeren
 *     Modulliste weiter und das Gate schickt auf /modules — obwohl das Modul
 *     zugeschaltet ist. Ein wirklich abgeschaltetes Modul faellt auch beim
 *     zweiten Versuch zurueck; die Pruefung verliert also nichts.
 */
async function besucheGeduldig(kontext, pfad, linkSenke, opts = {}) {
  const erst = await besuche(kontext, pfad, linkSenke, opts);
  if (!erst.gedrosselt && !erst.wackelig) return erst;
  await warte(erst.gedrosselt ? PAUSE_429 : 1500);
  const zweit = await besuche(kontext, pfad, linkSenke, opts);
  let hinweis = "";
  if (erst.gedrosselt) {
    hinweis = zweit.gedrosselt
      ? `Hinweis: Proxy drosselt weiter (HTTP 429 auf ${zweit.gedrosselt})`
      : `Hinweis: einmal HTTP 429 (Proxy-Drosselung auf ${erst.gedrosselt}), Wiederholung sauber`;
  } else if (zweit.wackelig) {
    hinweis = "auch beim zweiten Versuch";
  }
  return { ...zweit, detail: [zweit.detail, hinweis].filter(Boolean).join(" · ") };
}

/** Eine Seite oeffnen und alles sammeln, was schiefgeht. */
async function besuche(kontext, pfad, linkSenke, opts = {}) {
  const { seite, probleme, drossel, merke } = await neueSeite(kontext);
  try {
    const befund = await mitFrist(rundgang(seite, pfad, linkSenke, opts, probleme, merke), FRIST_SEITE, pfad);
    return { ...befund, gedrosselt: [...new Set(drossel)].slice(0, 3).join(", ") };
  } catch (e) {
    return {
      ok: false,
      detail: String(e.message || e).split("\n")[0].slice(0, 160),
      gedrosselt: [...new Set(drossel)].slice(0, 3).join(", "),
    };
  } finally {
    await seite.close().catch(() => {});
  }
}

async function rundgang(seite, pfad, linkSenke, opts, probleme, merke) {
  {
    const antwort = await seite.goto(pfad, { waitUntil: "networkidle", timeout: 30000 });
    if (!antwort || antwort.status() >= 400) return { ok: false, detail: `HTTP ${antwort?.status()}` };
    await tourWegklicken(seite);

    // Landet die Seite auf /modules oder auf der Landing-Seite, greift das Gate
    // oder der Login — beides bedeutet: die Seite ist fuer die Lehrkraft nicht da.
    const jetzt = new URL(seite.url()).pathname;
    // Umleitungen INNERHALB des Moduls sind erwuenscht (/cardvote →
    // /cardvote/questions) und kein Befund. Nur der Sprung woanders hin zaehlt.
    const drin = jetzt === pfad || jetzt.startsWith(pfad) || pfad.startsWith(jetzt);
    let hinweis = "";
    if (!drin) {
      // `wackelig`: einen Ruecksprung sieht sich der Aufrufer noch einmal an
      // (siehe besucheGeduldig) — ein wirklich abgeschaltetes Modul faellt auch
      // beim zweiten Versuch zurueck.
      if (jetzt === "/modules")
        return { ok: false, wackelig: true, detail: "ModuleGate wirft auf /modules zurueck (Modul nicht aktiv?)" };
      if (jetzt === "/")
        return { ok: false, wackelig: true, detail: "landet auf der Startseite — nicht angemeldet?" };
      // Sonstige Umleitungen sind gewollt (alte CardVote-Adressen zeigen auf
      // /cardvote/*). Kein Befund — geprueft wird trotzdem, ob das Ziel rendert.
      hinweis = ` → ${jetzt}`;
    }
    // Gerenderter Inhalt statt leerer Shell.
    const textLaenge = (await seite.locator("body").innerText()).trim().length;
    if (textLaenge < 20) probleme.push("Seite bleibt leer (Render-Fehler?)");

    if (opts.pruefeUeberlauf) {
      // Waagerechtes Scrollen heisst auf dem Telefon: etwas ragt aus dem Bild,
      // Knoepfe sind nicht erreichbar. Tabellen duerfen fuer sich scrollen,
      // die Seite selbst nicht.
      // Mit dem Schuldigen: "irgendwas ragt raus" hilft niemandem beim Suchen.
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
        // Nur statische interne Ziele; Links mit Platzhaltern oder IDs kommen
        // aus Listen und haengen an Testdaten, die es hier nicht gibt.
        if (href && !href.includes("#") && !href.includes("?")) linkSenke.add(href);
      }
    }
    return probleme.length
      ? { ok: false, detail: probleme.slice(0, 3).join(" | ") }
      : { ok: true, detail: `${textLaenge} Zeichen gerendert${hinweis}` };
  }
}

/**
 * Zusammenfassung. Die Einzelzeilen sind waehrend des Laufs schon erschienen
 * (siehe `notiere`), hier steht nur noch, was schiefging — und zwar NACH
 * URSACHE gebuendelt: ein Fehler, der jede Seite trifft (etwa ein einzelner
 * Konsolenfehler in der Shell), ist EIN Befund. Frueher standen dafuer achtzig
 * gleichlautende Zeilen und begruben alles andere.
 */
function drucke() {
  const fehler = ergebnisse.filter((e) => !e.ok);
  // Je Engine eine Zeile: „gruen" ohne die Engine daneben sagt nicht, WORAUF.
  const proMotor = MOTOREN.map((m) => {
    const alle = ergebnisse.filter((e) => e.motor === m);
    const rot = alle.filter((e) => !e.ok).length;
    return `${m}: ${rot ? `${rot} von ${alle.length} rot` : `${alle.length} grün`}`;
  }).join(" · ");
  console.log("\n" + "=".repeat(40));
  if (!fehler.length) {
    console.log(`  ${GRUEN}Browser-Selbsttest gruen${AUS} — ${ergebnisse.length} Seiten/Checks in ${seit().trim()}.`);
    console.log(`  ${GRAU}${proMotor}${AUS}`);
    console.log("=".repeat(40));
    return;
  }
  console.log(`  ${ROT}${FETT}Browser-Selbsttest ROT${AUS} — ${fehler.length} von ${ergebnisse.length} Prüfungen.`);
  console.log(`  ${GRAU}${proMotor}${AUS}`);
  const nachGrund = new Map();
  for (const f of fehler) {
    // Nach Engine UND Grund buendeln: derselbe Text kann in Chromium und
    // WebKit voellig verschiedene Ursachen haben.
    const grund = `[${f.motor}] ${f.detail || "(ohne Detail)"}`;
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
