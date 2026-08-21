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
import {
  zugang, motorenWahl, MOTOREN_ALLE, macheIstEgal, macheBericht, druckeBericht,
  bilanzJeMotor, abbruchBremse, macheKontextApi, modulZustandStellen, traegtMarke,
  dialogeAnnehmen, beobachte, tourWegklicken, anmeldungHinterlegen, rundgang, geduldig,
  mitFrist, kurzfehler, KERN_SEITEN, FRIST_SEITE, ROT, GRUEN, FETT, AUS,
} from "./browser-gemeinsam.mjs";

const { basis: URL_BASIS, email: EMAIL, passwort: PASSWORT } = zugang();

// Der Name der laufenden Engine steht in JEDER Zeile und in der
// Zusammenfassung. Ohne ihn ist beim Fehlersuchen nicht zu erkennen, welcher
// Lauf gemeint war — und genau das ist der haeufigste Fall bei zwei Engines.
const MOTOREN = motorenWahl();
let MOTOR = MOTOREN[0];

const istEgal = macheIstEgal();

const { ergebnisse, notiere, neueGruppe } = macheBericht({
  gruppePraefix: () => `[${MOTOR}] `,
  zusatz: () => ({ motor: MOTOR }),
});

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
  const { falsch } = await modulZustandStellen({ basis: URL_BASIS, token, keys: zurueckzustellen });
  const gut = falsch.length === 0;
  const text = gut
    ? (zurueckzustellen.size ? `${zurueckzustellen.size} zugeschaltete Module wieder abgeschaltet` : "unverändert")
    : `blieb zugeschaltet: ${falsch.join(", ")}`;
  if (ohneBericht) console.error(`\n${gut ? GRUEN : ROT}Modul-Zustand: ${text}${AUS}`);
  else notiere("Aufräumen", "Modulzustand", gut, text);
}

abbruchBremse(() => modulZustandHerstellen(true),
  "stelle den Modul-Zustand des Kontos wieder her …");

/**
 * Ein Lauf je Engine. Der Modul-Zustand wird nach JEDEM Lauf zurueckgestellt,
 * also muessen die Merker davor wieder auf Anfang — sonst haelt der zweite Lauf
 * sich fuer schon aufgeraeumt und laesst die Module des Kontos an.
 */
async function main() {
  for (const name of MOTOREN) {
    MOTOR = name;
    neueGruppe();
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
    // Konto und teilen sich dessen Rate-Limit (siehe browser-gemeinsam.mjs).
    const { api } = macheKontextApi(() => kontext, () => token);

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
      const befund = await bediene(kontext, flow, api);
      notiere("Bedienung", flow.name, befund.ok, befund.detail);
    }
    await aufraeumenBedienung(api, vorher);

    // ── Globale Suche ──
    await sucheProbe(kontext);

    // ── Werkzeugleisten: eine Hoehe, eine Form ──
    await leistenProbe(kontext);


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
 * Alle Bedienelemente einer Werkzeugleiste sind gleich hoch und gleich geformt.
 *
 * Das stand als Regel im Code (CONTROL_H / CONTROL_R in Icons.jsx) und wurde
 * trotzdem immer wieder gebrochen: nebeneinander standen zuletzt eine Pille,
 * ein Rechteck mit Radius 10 und ein Kreis, dazu ein Auswahlfeld, das vier
 * Pixel hoeher war als die Reiter. Auffallen kann das nur, wer misst — also
 * misst es der Test: fuer jede Leiste die Hoehen ihrer direkten Kinder.
 *
 * Geprueft wird nicht der exakte Wert (eine Leiste darf auch mal 30 px hoch
 * sein), sondern die GLEICHHEIT innerhalb einer Leiste. Genau das ist das, was
 * man sieht.
 */
async function leistenProbe(kontext) {
  const seiten = [["/auswertung?tab=noten", "Notenbuch"], ["/orga?tab=sitzplan", "Sitzplan"],
                  ["/kalender", "Kalender"], ["/karten", "Karteikarten"]];
  const { seite } = await neueSeite(kontext);
  const schief = [];
  try {
    for (const [pfad, name] of seiten) {
      await seite.goto(pfad, { waitUntil: "networkidle", timeout: 30000 });
      await tourWegklicken(seite);
      await seite.waitForTimeout(900);
      const befund = await seite.evaluate(() => {
        // Die erste Reihe unter der Navigation, die mehrere Bedienelemente
        // nebeneinander traegt — das ist die Werkzeugleiste der Seite.
        const reihen = [...document.querySelectorAll("div")].filter((d) => {
          const st = getComputedStyle(d);
          if (st.display !== "flex" || st.flexDirection === "column") return false;
          const kinder = [...d.children].filter((k) => k.getBoundingClientRect().height > 0);
          const bedien = kinder.filter((k) => k.matches("button, select, input, span, label, div")
            && k.querySelectorAll("button, select, input").length + (k.matches("button, select, input") ? 1 : 0) > 0);
          return bedien.length >= 3 && d.getBoundingClientRect().top < 400;
        });
        if (!reihen.length) return null;
        const leiste = reihen[0];
        const hoehen = [...leiste.children]
          .map((k) => ({ text: (k.textContent || "").trim().slice(0, 14) || k.tagName,
                         h: Math.round(k.getBoundingClientRect().height) }))
          .filter((x) => x.h > 0);
        return hoehen;
      });
      if (!befund || befund.length < 2) continue;
      const werte = befund.map((x) => x.h);
      const spanne = Math.max(...werte) - Math.min(...werte);
      if (spanne > 2) {
        schief.push(`${name}: ${befund.map((x) => `${x.text}=${x.h}`).join(", ")}`);
      }
    }
    notiere("Bedienung", "Werkzeugleisten: eine Hoehe", schief.length === 0,
      schief.length ? schief.join(" | ") : `${seiten.length} Leisten geprueft, alle Elemente gleich hoch`);
  } catch (e) {
    notiere("Bedienung", "Werkzeugleisten: eine Hoehe", false, kurzfehler(e));
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
    // Ueber `data-suche`, nicht ueber Texte: der Platzhalter ist uebersetzt, und
    // mit englischer Oberflaeche fand der Test das Feld nicht — klickte dann auf
    // den Knopf, der schon hinter dem offenen Dialog lag, und lief in einen
    // Timeout. Ein Kennzeichen im Markup ist in jeder Sprache dasselbe.
    const feld = seite.locator("[data-suche='feld']").first();
    const offen = async () => (await feld.count()) > 0 && await feld.isVisible().catch(() => false);
    // Der Knopf in der Navigation ist bewusst weg (die Leiste soll den Bereich
    // zeigen, nicht Werkzeuge sammeln) — es bleiben das Tastenkuerzel und das
    // Suchfeld auf der Startseite.
    for (const versuch of ["Meta+k", "Control+k", "startseite"]) {
      if (await offen()) break;
      if (versuch === "startseite") {
        await seite.goto("/", { waitUntil: "networkidle", timeout: 30000 });
        await tourWegklicken(seite);
        await seite.locator("[data-suche='startseite']").first().click({ timeout: 8000 });
      } else await seite.keyboard.press(versuch).catch(() => {});
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
    async schritte(seite, api) {
      // Beschriftung je nach Sprache des Kontos.
      const neu = seite.getByRole("button", { name: /neuer? zettel|neu$|new note|new$|nueva? nota/i }).first();
      await neu.click({ timeout: 8000 });
      const feld = seite.locator("input[placeholder]").first();
      await feld.fill(MARKE, { timeout: 8000 });

      // Frueher speicherte der Zettel von selbst (600 ms nach dem letzten
      // Tastendruck) und der Test wartete das nur ab. Jetzt gilt: getippt ist
      // NICHT gespeichert. Damit ist die Zusicherung dreiteilig, und alle drei
      // Teile werden geprueft — sonst faellt ein Speichern-Knopf, der wieder
      // heimlich mitschreibt, niemandem auf.
      //
      //   1. die Seite sagt sichtbar „nicht gespeichert"
      const offen = seite.getByText(/nicht gespeichert|unsaved|sin guardar/i).first();
      await offen.waitFor({ state: "visible", timeout: 8000 });
      //   2. beim Server steht davon noch nichts
      const vorher = await (await api("/api/notizblock")).json();
      if ((vorher || []).some((n) => `${n.title || ""}${n.content || ""}`.includes(MARKE)))
        throw new Error("der Server kennt den Text schon VOR dem Speichern — die Seite speichert doch von selbst");
      //   3. erst der Knopf schickt ihn hin
      // Beschriftung aus `common.save`; das Testkonto laeuft teils auf
      // Englisch, darum alle drei Sprachen in EINEM Muster.
      await seite.getByRole("button", { name: /^(Speichern|Save|Guardar)$/ }).first().click({ timeout: 8000 });
      // Auf das Ergebnis warten, nicht auf die Uhr: der Hinweis verschwindet,
      // sobald der Entwurf uebernommen ist.
      await offen.waitFor({ state: "hidden", timeout: 15000 });
    },
  },
  {
    // Die Startseite laesst sich einrichten: Widgets an/aus, Kacheln ausblenden.
    // Das liegt im localStorage — ein Neuladen ist also der einzige Beweis,
    // dass es wirklich gespeichert wurde. Geprueft wird am „Heute"-Widget: es
    // ist voreingestellt an und traegt einen Link, den man eindeutig findet.
    name: "Startseite einrichten (Widget aus/an)",
    pfad: "/",
    async schritte(seite) {
      const kalenderLink = seite.getByRole("link", { name: /zum kalender|to the calendar|al calendario/i }).first();
      if (!(await kalenderLink.count())) return;   // Kalender nicht aktiv: nichts zu pruefen
      const bearbeiten = seite.locator("[title='Anordnen'], [title='Arrange'], [title='Organizar']").first();
      await bearbeiten.click({ timeout: 8000 });
      // Der Schalter des Widgets traegt seinen Namen als Text.
      await seite.getByRole("button", { name: /^(Heute|Today|Hoy)$/ }).first().click({ timeout: 8000 });
      await seite.getByRole("button", { name: /^(Speichern|Save|Guardar)$/ }).first().click({ timeout: 8000 });
      await seite.waitForTimeout(600);
    },
    async pruefe(seite) {
      // Nach dem Neuladen muss das Widget WEG sein — sonst hat das Einrichten
      // nichts gespeichert.
      const nochDa = await seite.getByRole("link", { name: /zum kalender|to the calendar|al calendario/i }).count();
      if (nochDa) return { ok: false, detail: "Widget nach dem Neuladen wieder da — die Einrichtung wird nicht gespeichert" };
      // Und wieder anschalten: der Lauf darf die Startseite nicht veraendert
      // zuruecklassen.
      const bearbeiten = seite.locator("[title='Anordnen'], [title='Arrange'], [title='Organizar']").first();
      await bearbeiten.click({ timeout: 8000 });
      await seite.getByRole("button", { name: /^(Heute|Today|Hoy)$/ }).first().click({ timeout: 8000 });
      await seite.getByRole("button", { name: /^(Speichern|Save|Guardar)$/ }).first().click({ timeout: 8000 });
      await seite.waitForTimeout(600);
      return { ok: true, detail: "Widget abgeschaltet, ueberlebt das Neuladen, wieder angeschaltet" };
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
async function bediene(kontext, flow, api) {
  const { seite, probleme } = await neueSeite(kontext);
  // Hier zaehlt nur der Absturz: Konsolenfehler und 4xx bewertet der Rundgang.
  const handgriff = async () => {
    await seite.goto(flow.pfad, { waitUntil: "networkidle", timeout: 30000 });
    await tourWegklicken(seite);
    // `api` fuer Handgriffe, die zwischendurch gegen den Server pruefen
    // muessen (der Notizzettel: „vor dem Speichern steht dort nichts").
    await flow.schritte(seite, api);
    await seite.reload({ waitUntil: "networkidle" });
    // Ein Handgriff, der nichts ANLEGT (die Startseite einrichten), bringt
    // seine eigene Pruefung mit — die Marke gaebe es dort nicht.
    if (flow.pruefe) return await flow.pruefe(seite);
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
        if (!traegtMarke(eintrag, MARKE)) continue;
        await api(`${pfad}/${eintrag.id}`, "delete");
        weg++;
      }
    } catch { /* was bleibt, faellt gleich beim Anlegen auf */ }
  }
  return weg + await papierkorbLeeren(api);
}

/**
 * Testreste ENDGUELTIG entfernen — sie liegen nach dem Loeschen im Papierkorb.
 *
 * Module und Kern loeschen nur noch weich (`deleted_at`, siehe CLAUDE.md), und
 * ein weich geloeschtes Thema belegt seinen Namen weiter: der naechste Lauf
 * bekommt beim Anlegen 409 („Dieses Thema gibt es an dieser Stelle schon") und
 * die Probe waere bei jedem zweiten Lauf rot. Der Weg dafuer ist
 * `DELETE /api/trash/{art}/{id}` — ein `…/purge` an der Modul-Adresse gibt es
 * nicht (hier stand genau das, lief immer ins Leere und wurde verschluckt).
 *
 * Sicherheitsnetz wie ueberall: geloescht wird ausschliesslich, was die Marke
 * traegt, geprueft unmittelbar vor dem DELETE.
 */
async function papierkorbLeeren(api) {
  let weg = 0;
  try {
    for (const eintrag of await (await api("/api/trash")).json()) {
      if (!traegtMarke(eintrag, MARKE)) continue;
      await api(`/api/trash/${eintrag.kind}/${eintrag.id}`, "delete");
      weg++;
    }
  } catch { /* was bleibt, faellt beim naechsten Lauf auf */ }
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
        if (neuAngelegt || traegtMarke(eintrag, MARKE)) await api(`${pfad}/${eintrag.id}`, "delete");
      }
    } catch { /* was bleibt, faellt beim naechsten Lauf auf */ }
  }
  // Und aus dem Papierkorb heraus: weich geloescht heisst „liegt noch da" und
  // blockiert den Namen fuer den naechsten Lauf.
  await papierkorbLeeren(api);
}

/** Holt die eingebettete Lernpfad-App ihre Inhalte vom Server? */
async function ladeLernpfadDaten(kontext) {
  const seite = await kontext.newPage();
  dialogeAnnehmen(seite);   // siehe dort: die Verlassen-Warnung braucht ein „Ja"
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
  const hatMarke = (s) => typeof s === "string" && s.includes(LP_MARKE);
  let weg = 0;
  const fehler = [];
  const holen = async (pfad) => {
    try { return await lpJson(api, pfad); }
    catch (e) { fehler.push(String(e.message || e).slice(0, 90)); return []; }
  };
  const loesche = async (pfad, beleg) => {
    if (!hatMarke(beleg)) return;             // Sicherheitsnetz
    try {
      const r = await api(pfad, "delete");
      if (r.ok() || r.status() === 404) weg++;
      else fehler.push(`DELETE ${pfad} → HTTP ${r.status()}`);
    } catch (e) { fehler.push(`DELETE ${pfad} → ${String(e.message || e).slice(0, 60)}`); }
  };

  const themen = await holen("/api/topics");
  const themaName = new Map(themen.map((t) => [t.id, t.name]));

  for (const ex of await holen("/api/lernpfad/exercises")) {
    const beleg = hatMarke(ex.aufgabentext) ? ex.aufgabentext : (themaName.get(ex.topic_id) || "");
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
    for (const x of await holen(pfad)) if (hatMarke(x[feld])) uebrig.push(`${pfad}: ${x[feld]}`);
  };
  await nachsehen("/api/topics", "name");
  await nachsehen("/api/classes", "name");
  await nachsehen("/api/lernpfad/paths", "name");
  await nachsehen("/api/lernpfad/exercises", "aufgabentext");
  for (const it of await holen("/api/trash")) if (hatMarke(`${it.label} ${it.context}`)) uebrig.push(`Papierkorb: ${it.label}`);
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

/** Neue Seite mit Mitschrift — Dialoge werden bestaetigt (siehe `dialogeAnnehmen`). */
async function neueSeite(kontext) {
  const seite = await kontext.newPage();
  dialogeAnnehmen(seite);
  return { seite, ...beobachte(seite, istEgal) };
}

/**
 * Eine Seite besuchen — mit Wiederholung bei Drosselung oder Ruecksprung
 * (siehe `geduldig` in browser-gemeinsam.mjs).
 */
const besucheGeduldig = (kontext, pfad, linkSenke, opts = {}) =>
  geduldig(() => besuche(kontext, pfad, linkSenke, opts));

/** Eine Seite oeffnen und alles sammeln, was schiefgeht. */
async function besuche(kontext, pfad, linkSenke, opts = {}) {
  const { seite, probleme, drossel } = await neueSeite(kontext);
  try {
    const befund = await mitFrist(rundgang(seite, pfad, probleme, { ...opts, linkSenke }), FRIST_SEITE, pfad);
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

/** Zusammenfassung — Aufbau und Buendelung siehe `druckeBericht`. */
function drucke() {
  return druckeBericht(ergebnisse, {
    titel: "Browser-Selbsttest",
    gruenWort: "gruen",
    einheitGruen: "Seiten/Checks",
    zusatzzeile: bilanzJeMotor(ergebnisse, MOTOREN),
    grundVon: (f) => `[${f.motor}] ${f.detail || "(ohne Detail)"}`,
  });
}

main();
