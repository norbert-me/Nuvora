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
 * Der Modul-Zustand des Kontos wird am Ende wiederhergestellt.
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

const ergebnisse = [];
const notiere = (gruppe, name, ok, detail = "") => ergebnisse.push({ gruppe, name, ok, detail });

async function main() {
  const browser = await chromium.launch();
  const kontext = await browser.newContext({ baseURL: URL_BASIS, viewport: { width: 1280, height: 900 } });
  let zugeschaltet = [];
  let token = null;

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

    await kontext.addInitScript(([tok, usr]) => {
      localStorage.setItem("token", tok);
      localStorage.setItem("user", usr);
    }, [token, JSON.stringify(user)]);

    // ── Module zuschalten (Zustand merken, am Ende zuruecksetzen) ──
    const module = await (await api("/api/modules")).json();
    for (const m of module) {
      if (!m.available || m.active) continue;
      const r = await api(`/api/modules/${m.key}/activate`, "post");
      if (r.ok()) zugeschaltet.push(m.key);
      else notiere("Module", m.key, false, `Aktivieren fehlgeschlagen: HTTP ${r.status()}`);
    }

    // ── Rundgang ──
    const seiten = [
      ...KERN_SEITEN.map((p) => ({ pfad: p, name: p })),
      ...module.filter((m) => m.available && !m.external).map((m) => ({ pfad: m.path, name: `${m.name} (${m.path})` })),
    ];

    const gefundeneLinks = new Set();
    for (const { pfad, name } of seiten) {
      const befund = await besuche(kontext, pfad, gefundeneLinks);
      notiere("Seiten", name, befund.ok, befund.detail);
    }

    // ── Interne Links, die auf den besuchten Seiten stehen ──
    const schonBesucht = new Set(seiten.map((s) => s.pfad));
    const offen = [...gefundeneLinks].filter((l) => !schonBesucht.has(l)).sort();
    for (const pfad of offen) {
      const befund = await besuche(kontext, pfad, null);
      notiere("Verlinkung", pfad, befund.ok, befund.detail);
    }

    // ── Handy-Ansicht: Nuvora wird im Unterricht am Telefon bedient ──
    const handy = await neuerKontext(browser, token, user, { width: 390, height: 844 });
    for (const { pfad, name } of seiten) {
      const befund = await besuche(handy, pfad, null, { pruefeUeberlauf: true });
      notiere("Handy (390px)", name, befund.ok, befund.detail);
    }
    await handy.close();

    // ── Dunkles Design: feste Farben fallen erst hier auf ──
    const dunkel = await neuerKontext(browser, token, user, null, "dark");
    for (const { pfad, name } of seiten) {
      const befund = await besuche(dunkel, pfad, null);
      notiere("Dunkles Design", name, befund.ok, befund.detail);
    }
    await dunkel.close();

    // ── Wirklich bedienen, nicht nur ansehen ──
    for (const flow of BEDIENUNG) {
      const befund = await bediene(kontext, flow);
      notiere("Bedienung", flow.name, befund.ok, befund.detail);
    }
    await aufraeumenBedienung(api);
  } catch (e) {
    notiere("Ablauf", "Selbsttest", false, String(e.message || e));
  } finally {
    // Der Selbsttest darf die Einstellungen des Kontos nicht veraendern.
    for (const key of zugeschaltet) {
      try {
        await kontext.request.delete(`/api/modules/${key}/activate`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (e) {
        notiere("Aufraeumen", `Modul ${key}`, false, `blieb zugeschaltet: ${e.message}`);
      }
    }
    await browser.close();
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
  await k.addInitScript(([tok, usr]) => {
    localStorage.setItem("token", tok);
    localStorage.setItem("user", usr);
  }, [token, JSON.stringify(user)]);
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
  try {
    const spaeter = seite.getByRole("button", { name: /später|spaeter|later|más tarde|mas tarde/i }).first();
    if (await spaeter.isVisible({ timeout: 1500 })) await spaeter.click({ timeout: 3000 });
  } catch { /* kein Overlay da — der Normalfall */ }
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
  const seite = await kontext.newPage();
  const probleme = [];
  seite.on("pageerror", (e) => probleme.push(`Absturz: ${String(e).slice(0, 120)}`));
  try {
    await seite.goto(flow.pfad, { waitUntil: "networkidle", timeout: 30000 });
    await tourWegklicken(seite);
    await flow.schritte(seite);
    await seite.reload({ waitUntil: "networkidle" });
    const text = await seite.locator("body").innerText();
    const drin = text.includes(MARKE) || (await seite.locator(`input[value='${MARKE}']`).count()) > 0;
    if (!drin) return { ok: false, detail: "nach dem Neuladen verschwunden — wird nicht gespeichert" };
    if (probleme.length) return { ok: false, detail: probleme[0] };
    return { ok: true, detail: "angelegt, ueberlebt das Neuladen" };
  } catch (e) {
    return { ok: false, detail: String(e.message || e).split("\n")[0].slice(0, 140) };
  } finally {
    await seite.close();
  }
}

/** Was die Bedienprobe angelegt hat, wieder entfernen. */
async function aufraeumenBedienung(api) {
  try {
    for (const n of await (await api("/api/notizblock")).json()) {
      if ((n.title || "").includes(MARKE)) await api(`/api/notizblock/${n.id}`, "delete");
    }
  } catch { /* im Bericht steht dann der Rest */ }
  try {
    for (const t of await (await api("/api/topics")).json()) {
      if ((t.name || "").includes(MARKE)) await api(`/api/topics/${t.id}`, "delete");
    }
  } catch { /* siehe oben */ }
}

/** Eine Seite oeffnen und alles sammeln, was schiefgeht. */
async function besuche(kontext, pfad, linkSenke, opts = {}) {
  const seite = await kontext.newPage();
  const probleme = [];
  seite.on("console", (msg) => {
    if (msg.type() === "error" && !istEgal(msg.text())) probleme.push(`Konsole: ${msg.text().slice(0, 160)}`);
  });
  seite.on("pageerror", (e) => probleme.push(`Absturz: ${String(e).slice(0, 160)}`));
  seite.on("response", (r) => {
    if (r.status() >= 400 && !istEgal(r.url())) probleme.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`);
  });

  try {
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
      if (jetzt === "/modules") return { ok: false, detail: "ModuleGate wirft auf /modules zurueck (Modul nicht aktiv?)" };
      if (jetzt === "/") return { ok: false, detail: "landet auf der Startseite — nicht angemeldet?" };
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
  } catch (e) {
    return { ok: false, detail: String(e.message || e).split("\n")[0].slice(0, 160) };
  } finally {
    await seite.close();
  }
}

function drucke() {
  let gruppe = null;
  for (const e of ergebnisse) {
    if (e.gruppe !== gruppe) {
      console.log(`\n── ${e.gruppe}`);
      gruppe = e.gruppe;
    }
    console.log(`  ${e.ok ? "✓" : "✗"} ${e.name}${e.detail ? `   ${e.detail}` : ""}`);
  }
  const fehler = ergebnisse.filter((e) => !e.ok);
  console.log("\n" + "=".repeat(40));
  if (!fehler.length) console.log(`  Browser-Selbsttest gruen — ${ergebnisse.length} Seiten/Checks.`);
  else {
    // Nur zaehlen und benennen — der Grund steht schon bei jedem ✗ oben.
    const namen = fehler.slice(0, 6).map((f) => `${f.gruppe} / ${f.name}`).join(", ");
    console.log(`  Browser-Selbsttest ROT — ${fehler.length} Fehler.`);
    console.log(`  Betroffen: ${namen}${fehler.length > 6 ? ` und ${fehler.length - 6} weitere` : ""}`);
  }
  console.log("=".repeat(40));
}

main();
