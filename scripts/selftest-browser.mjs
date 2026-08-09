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

/** Eine Seite oeffnen und alles sammeln, was schiefgeht. */
async function besuche(kontext, pfad, linkSenke) {
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

    // Landet die Seite auf /modules oder auf der Landing-Seite, greift das Gate
    // oder der Login — beides bedeutet: die Seite ist fuer die Lehrkraft nicht da.
    const jetzt = new URL(seite.url()).pathname;
    if (jetzt !== pfad && !pfad.startsWith(jetzt)) {
      if (jetzt === "/modules" && pfad !== "/modules")
        return { ok: false, detail: `ModuleGate wirft auf /modules zurueck (Modul nicht aktiv?)` };
      probleme.push(`umgeleitet nach ${jetzt}`);
    }
    // Gerenderter Inhalt statt leerer Shell.
    const textLaenge = (await seite.locator("body").innerText()).trim().length;
    if (textLaenge < 20) probleme.push("Seite bleibt leer (Render-Fehler?)");

    if (linkSenke) {
      for (const href of await seite.locator("a[href^='/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")))) {
        // Nur statische interne Ziele; Links mit Platzhaltern oder IDs kommen
        // aus Listen und haengen an Testdaten, die es hier nicht gibt.
        if (href && !href.includes("#") && !href.includes("?")) linkSenke.add(href);
      }
    }
    return probleme.length
      ? { ok: false, detail: probleme.slice(0, 3).join(" | ") }
      : { ok: true, detail: `${textLaenge} Zeichen gerendert` };
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
    console.log(`  Browser-Selbsttest ROT — ${fehler.length} Fehler:`);
    for (const f of fehler) console.log(`    ✗ ${f.gruppe} / ${f.name}: ${f.detail}`);
  }
  console.log("=".repeat(40));
}

main();
