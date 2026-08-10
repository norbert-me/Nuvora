/**
 * Nuvora — Selbsttest im echten Browser (Playwright, headless Chromium).
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
 * Rueckgabewert: 0 = gruen, 1 = mindestens ein Fehler.
 */
import { chromium } from "playwright";

const arg = (name, fallback) => {
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
  // Der Marktplatz und der Update-Check fragen GitHub — offline im Serverraum
  // ist das kein Fehler der Installation.
  /api\.github\.com/i,
  // /api/version gehoert der Administration; fuer jedes andere Konto ist 403
  // die richtige Antwort und kein Befund.
  /\/api\/version/,
];
const istEgal = (text) => EGAL.some((r) => r.test(text));

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
  ergebnisse.push({ gruppe, name, ok, detail });
  if (gruppe !== letzteGruppe) {
    console.log(`\n${FETT}── ${gruppe}${AUS}`);
    letzteGruppe = gruppe;
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
      for (const [k, v] of Object.entries(mehr)) localStorage.setItem(k, v);
    } catch { /* Dokument ohne eigene Herkunft — hier gibt es nichts zu setzen */ }
  }, [token, JSON.stringify(user), extra]);
}

async function main() {
  const browser = await chromium.launch();
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

    const api = (pfad, methode = "get", data) =>
      kontext.request[methode](pfad, { headers: { Authorization: `Bearer ${token}` }, ...(data ? { data } : {}) });

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
  } catch (e) {
    notiere("Ablauf", "Selbsttest", false, kurzfehler(e));
  } finally {
    // Der Selbsttest darf die Einstellungen des Kontos nicht veraendern — und
    // zwar ueber `fetch`, nicht ueber den Browser: der kann hier schon tot sein.
    await modulZustandHerstellen();
    await browser.close().catch(() => {});
  }

  drucke();
  process.exit(ergebnisse.some((e) => !e.ok) ? 1 : 0);
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
  for (const pfad of ["/api/notizblock", "/api/topics"]) {
    try {
      for (const eintrag of await (await api(pfad)).json()) {
        if (!`${eintrag.title || ""}${eintrag.name || ""}`.includes(MARKE)) continue;
        await api(`${pfad}/${eintrag.id}`, "delete");
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
  console.log("\n" + "=".repeat(40));
  if (!fehler.length) {
    console.log(`  ${GRUEN}Browser-Selbsttest gruen${AUS} — ${ergebnisse.length} Seiten/Checks in ${seit().trim()}.`);
    console.log("=".repeat(40));
    return;
  }
  console.log(`  ${ROT}${FETT}Browser-Selbsttest ROT${AUS} — ${fehler.length} von ${ergebnisse.length} Prüfungen.`);
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
