/**
 * Nuvora — Systemtest im echten Browser (Playwright, headless Chromium).
 *
 * scripts/selftest-browser.mjs prueft den Rundgang bei EINGESCHALTETEN Modulen.
 * Dieser Test prueft das Gegenteil und ist damit der Beweis fuer Regel 3
 * ("Module haengen nicht voneinander ab"):
 *
 *   1. Jedes Modul EINZELN — die anderen werden abgeschaltet. Die Modulseite
 *      muss trotzdem vollstaendig rendern (ohne Konsolenfehler, ohne kaputte
 *      Anfragen), die Startseite darf GENAU dieses Modul anbieten, und jede
 *      fremde Modul-Adresse muss auf /modules zurueckfallen (ModuleGate).
 *   2. Keine verbotenen Verbindungen: ein Knopf, der ins Nachbarmodul fuehrt,
 *      darf ohne dieses Modul nicht existieren. Jede Verbindung wird DOPPELT
 *      geprueft — allein (darf nicht da sein) und zu zweit (muss da sein).
 *      Nur beides zusammen beweist etwas: ein Knopf, der nie erscheint, wuerde
 *      die Solo-Pruefung sonst stillschweigend bestehen.
 *   3. Echte Bedienung: in mindestens fuenf Modulen wird ueber die Oberflaeche
 *      etwas angelegt (klicken, tippen), neu geladen, geprueft und wieder
 *      geloescht. Ein Formular, das rendert aber nichts speichert, faellt nur
 *      so auf.
 *
 * Der Modul-Zustand des Kontos und alle Testdaten werden am Ende zurueckgesetzt.
 *
 * Nutzung:  node scripts/systemtest-browser.mjs --url … --email … --passwort …
 *           (oder SELFTEST_URL / SELFTEST_EMAIL / SELFTEST_PASSWORD)
 * Rueckgabewert: 0 = gruen, 1 = mindestens ein Fund.
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

// Rauschen, das nichts ueber die Gesundheit der Installation sagt.
const EGAL = [
  /favicon/i,
  /ResizeObserver loop/i,
  /Download the React DevTools/i,
  /api\.github\.com/i,
  /\/api\/version/,
];
const istEgal = (text) => EGAL.some((r) => r.test(text));

const ergebnisse = [];
const notiere = (gruppe, name, ok, detail = "") => ergebnisse.push({ gruppe, name, ok, detail });

const FARBE = process.stdout.isTTY && !process.env.NO_COLOR;
const ROT = FARBE ? "\x1b[31m" : "";
const GRUEN = FARBE ? "\x1b[32m" : "";
const FETT = FARBE ? "\x1b[1m" : "";
const AUS = FARBE ? "\x1b[0m" : "";

// Marke, an der alles Angelegte erkennbar ist — und wieder wegkommt.
const MARKE = "ZZ-Systemtest";
// Die Bedienprobe braucht eine EIGENE Marke: die Testdaten oben heissen
// "ZZ-Systemtest-Einstieg" usw., und eine Suche nach der kurzen Marke wuerde
// in der Liste zuerst die Testdaten treffen und die falsche Zeile loeschen.
const MARKE_UI = `${MARKE}-UI`;

let kontext = null;
let token = null;

/** API-Aufruf mit dem Token der Lehrkraft. */
const api = (pfad, methode = "get", data) =>
  kontext.request[methode](pfad, {
    headers: { Authorization: `Bearer ${token}`, ...(data ? { "Content-Type": "application/json" } : {}) },
    ...(data !== undefined ? { data } : {}),
  });
const apiJson = async (pfad, methode = "get", data) => {
  const r = await api(pfad, methode, data);
  if (!r.ok()) return null;
  const text = await r.text();
  return text ? JSON.parse(text) : null;
};

// ───────────────────────── Verbotene Verbindungen ─────────────────────────
//
// Jede Zeile ist eine Bruecke zwischen zwei Modulen. `allein` schaltet nur die
// Module ein, die die Bruecke NICHT rechtfertigen — dann darf der Marker nicht
// auftauchen. `zusammen` schaltet beide ein — dann MUSS er auftauchen.
const verbindungen = (td) => [
  {
    name: "Karten → „Als Note übernehmen\" (braucht Auswertung)",
    pfad: "/karten?tab=progress",
    marker: "Als Note übernehmen",
    allein: ["karten"],
    zusammen: ["karten", "auswertung"],
  },
  {
    name: "CardVote-Auswertung → „Ins Notenmodul\" (braucht Auswertung)",
    pfad: `/cardvote/evaluation/${td.session?.id}`,
    marker: "Ins Notenmodul",
    allein: ["cardvote"],
    zusammen: ["cardvote", "auswertung"],
  },
  {
    name: "CardVote-Auswertung → „Karten-Deck anlegen\" (braucht Karten)",
    pfad: `/cardvote/evaluation/${td.session?.id}`,
    marker: "Karten-Deck anlegen",
    allein: ["cardvote"],
    zusammen: ["cardvote", "karten"],
  },
  {
    name: "CardVote-Auswertung → „Lernpfad-Aufgabe\" (braucht Lernpfad)",
    pfad: `/cardvote/evaluation/${td.session?.id}`,
    marker: "Lernpfad-Aufgabe",
    allein: ["cardvote"],
    zusammen: ["cardvote", "lernpfad"],
  },
  {
    name: "Klassenleitung → Note im Elternkontakt (braucht Auswertung)",
    pfad: "/klassenleitung",
    // Der Notenchip ist ein Link ins Notenmodul — eindeutiger als der Text „Note".
    // Praefix-Vergleich: der Link traegt Klasse und Kurs mit (…&class=7&kurs=3),
    // damit die Auswertung gleich beim richtigen Fach aufgeht.
    finde: async (seite) => (await seite.locator("a[href^='/auswertung?tab=noten']").count()) > 0,
    beschreibung: "Notenchip (Link auf /auswertung?tab=noten)",
    // Bewusst der EIGENE Schueler, nicht ein Name aus einer geseedeten
    // Spielinstanz: im Deploy laeuft der Test mit einem leeren Testkonto.
    vorbereiten: async (seite) => {
      await seite.getByRole("button", { name: new RegExp(`${MARKE} Ann`) }).first().click({ timeout: 8000 });
      await seite.waitForTimeout(600);
    },
    allein: ["klassenleitung"],
    zusammen: ["klassenleitung", "auswertung"],
  },
  {
    name: "Notenbuch → „Aus Code-Detektiv\" (braucht Code-Detektiv)",
    pfad: "/auswertung?tab=noten",
    marker: "Aus Code-Detektiv",
    allein: ["auswertung"],
    zusammen: ["auswertung", "code-detektiv"],
  },
  {
    name: "Klassenarbeit → „Wiederholung erzeugen\" (braucht Karten/Lernpfad)",
    pfad: "/auswertung?tab=klassenarbeit",
    marker: "Wiederholung erzeugen",
    allein: ["auswertung"],
    zusammen: ["auswertung", "karten", "lernpfad"],
    // Die Seite waehlt die erste Klassenarbeit selbst aus — nur abwarten.
    vorbereiten: (seite) => seite.waitForTimeout(1500),
  },
  {
    name: "Kalender → Quiz-Selektor im Termin-Dialog (braucht CardVote)",
    pfad: "/kalender",
    marker: "CardVote-Quiz",
    vorbereiten: terminDialogOeffnen,
    allein: ["kalender"],
    zusammen: ["kalender", "cardvote"],
  },
  {
    name: "Kalender → Deck-Selektor im Termin-Dialog (braucht Karten)",
    pfad: "/kalender",
    marker: "Karten-Stapel",
    vorbereiten: terminDialogOeffnen,
    allein: ["kalender"],
    zusammen: ["kalender", "karten"],
  },
  {
    name: "Kalender → Lernleiter-Selektor im Termin-Dialog (braucht Lernpfad)",
    pfad: "/kalender",
    marker: "Lernleiter",
    vorbereiten: terminDialogOeffnen,
    allein: ["kalender"],
    zusammen: ["kalender", "lernpfad"],
  },
  {
    name: "Kalender → Einstieg-Selektor im Termin-Dialog (braucht Unterrichtsplanung)",
    pfad: "/kalender",
    beschreibung: "Selektor „Einstieg\"",
    finde: async (seite) => (await seite.getByText("Einstieg", { exact: true }).count()) > 0,
    vorbereiten: terminDialogOeffnen,
    allein: ["kalender"],
    zusammen: ["kalender", "unterrichtsplanung"],
  },
  {
    name: "Startseite → „Deck erstellen\" bei schwachem Thema (braucht Karten)",
    pfad: "/",
    marker: "Deck erstellen",
    allein: ["cardvote"],
    zusammen: ["cardvote", "karten"],
  },
  {
    name: "Startseite → „Aufgabe anlegen\" bei schwachem Thema (braucht Lernpfad)",
    pfad: "/",
    marker: "Aufgabe anlegen",
    allein: ["cardvote"],
    zusammen: ["cardvote", "lernpfad"],
  },
  {
    name: "Startseite → Einstieg-Chip bei schwachem Thema (braucht Unterrichtsplanung)",
    pfad: "/",
    marker: "💡 Einstieg",
    allein: ["cardvote"],
    zusammen: ["cardvote", "unterrichtsplanung"],
  },
  {
    name: "Marktplatz → Karten-Deck „Übernehmen\" (braucht Karten)",
    pfad: "/marktplatz",
    beschreibung: `Knopf „Übernehmen" am Karten-Deck „${td.deckName}"`,
    finde: async (seite) => {
      // Ohne veroeffentlichtes Deck wuerde die Suche auf jeden Text passen und
      // beide Richtungen scheinbar bestaetigen — dann lieber laut scheitern.
      if (!td.deckName) throw new Error("kein Karten-Deck veröffentlicht — Vorbedingung fehlt");
      return (await aktionZuTitel(seite, td.deckName)) === "Übernehmen";
    },
    allein: ["cardvote"],
    zusammen: ["cardvote", "karten"],
  },
  {
    name: "Marktplatz → Filter „Karten\" (braucht Karten)",
    pfad: "/marktplatz",
    beschreibung: "Filterreiter „Karten\"",
    finde: async (seite) => (await seite.getByRole("button", { name: "Karten", exact: true }).count()) > 0,
    allein: ["cardvote"],
    zusammen: ["cardvote", "karten"],
  },
];

/** Im Kalender den Dialog „Neuer Eintrag" oeffnen. */
async function terminDialogOeffnen(seite) {
  await seite.locator("[title='Neuer Eintrag']").first().click({ timeout: 8000 });
  await seite.waitForTimeout(700);
}

/**
 * Welche Aktion bietet die Marktplatz-Karte mit diesem Titel an?
 * Sucht das Element mit dem Titel und geht so weit nach oben, bis ein Knopf
 * oder Link mit „Übernehmen"/„Modul aktivieren" darin liegt.
 */
async function aktionZuTitel(seite, titel) {
  return await seite.evaluate((t) => {
    const alle = [...document.querySelectorAll("*")];
    const start = alle.find((e) => e.children.length === 0 && (e.textContent || "").trim().includes(t))
      || alle.find((e) => (e.textContent || "").trim() === t);
    if (!start) return "";
    let el = start;
    while (el && el !== document.body) {
      for (const b of el.querySelectorAll("button, a")) {
        const txt = (b.textContent || "").trim();
        if (txt === "Übernehmen" || txt === "Modul aktivieren") return txt;
      }
      el = el.parentElement;
    }
    return "";
  }, titel);
}

// ───────────────────────────── Bedienung ─────────────────────────────
//
// Handgriffe, die eine Lehrkraft wirklich macht — in fuenf verschiedenen
// Modulen. Jeder legt etwas an, laedt neu, besteht darauf dass es noch da ist,
// und raeumt ueber die Oberflaeche wieder ab.
const BEDIENUNG = [
  {
    modul: "notizbrett",
    name: "Aufgabe anlegen (/notizbrett?tab=aufgaben)",
    pfad: "/notizbrett?tab=aufgaben",
    async anlegen(seite) {
      await seite.locator("input[placeholder='Neue Aufgabe …']").first().fill(MARKE_UI, { timeout: 8000 });
      await seite.getByRole("button", { name: "Hinzufügen", exact: true }).first().click({ timeout: 8000 });
      await seite.waitForTimeout(900);
    },
  },
  {
    modul: "orga",
    name: "Checklisten-Punkt anlegen (/orga)",
    pfad: "/orga",
    async anlegen(seite) {
      await seite.locator("input[placeholder^='Neuer Punkt']").first().fill(MARKE_UI, { timeout: 8000 });
      await seite.locator("[title='Anlegen']").first().click({ timeout: 8000 });
      await seite.waitForTimeout(900);
    },
  },
  {
    modul: "karten",
    name: "Kartenstapel anlegen (/karten)",
    pfad: "/karten",
    async anlegen(seite) {
      await seite.locator("[title='Hinzufügen']").first().click({ timeout: 8000 });
      await seite.getByRole("button", { name: "Neuer Stapel", exact: true }).first().click({ timeout: 8000 });
      await seite.locator("input[placeholder^='Neuer Stapel']").first().fill(MARKE_UI, { timeout: 8000 });
      await seite.getByRole("button", { name: "Hinzufügen", exact: true }).first().click({ timeout: 8000 });
      await seite.waitForTimeout(900);
    },
    async loeschen(seite) {
      // Der Loeschknopf des Stapels erscheint erst im Umbenennen-Modus.
      const fehler = await knopfInZeile(seite, MARKE_UI, "Stapel umbenennen");
      if (fehler) return fehler;
      await seite.waitForTimeout(400);
      return await zeileLoeschen(seite, MARKE_UI);
    },
  },
  {
    modul: "unterrichtsplanung",
    name: "Einstieg anlegen (/unterrichtsplanung)",
    pfad: "/unterrichtsplanung",
    async anlegen(seite) {
      await seite.locator("[title='Neu']").first().click({ timeout: 8000 });
      await seite.getByRole("button", { name: "Neu", exact: true }).last().click({ timeout: 8000 });
      await seite.locator("input:visible").first().fill(MARKE_UI, { timeout: 8000 });
      await seite.getByRole("button", { name: "Speichern", exact: true }).first().click({ timeout: 8000 });
      await seite.waitForTimeout(900);
    },
    async loeschen(seite) {
      // Streng im Dialog bleiben: die Liste dahinter hat eigene „Löschen"-Knöpfe
      // (Ordner) — ein .first() darüber würde den falschen Datensatz treffen.
      await seite.getByText(MARKE_UI, { exact: false }).first().click({ timeout: 8000 });
      const dialog = seite.locator("[role='dialog']").last();
      await dialog.locator("[title='Bearbeiten']").first().click({ timeout: 8000 });
      await seite.waitForTimeout(400);
      await seite.locator("[role='dialog']").last().locator("[title='Löschen']").first().click({ timeout: 8000 });
      await bestaetigen(seite);
      await seite.waitForTimeout(6500);
      return "";
    },
  },
  {
    modul: "kalender",
    name: "Termin anlegen (/kalender)",
    pfad: "/kalender",
    async anlegen(seite) {
      await terminDialogOeffnen(seite);
      await seite.locator("input[placeholder^='z. B. Einführung']").first().fill(MARKE_UI, { timeout: 8000 });
      await seite.getByRole("button", { name: "Speichern", exact: true }).first().click({ timeout: 8000 });
      await seite.waitForTimeout(1200);
    },
    async loeschen(seite) {
      await seite.getByText(MARKE_UI, { exact: false }).first().click({ timeout: 8000 });
      await seite.waitForTimeout(600);
      await seite.locator("[role='dialog']").last().locator("[title='Löschen']").first().click({ timeout: 8000 });
      await bestaetigen(seite);
      await seite.waitForTimeout(6500);
      return "";
    },
  },
];

/**
 * Die Zeile mit der Marke suchen und ihren Loeschknopf druecken. Generisch,
 * weil jede Modulseite ihre Liste anders baut, aber alle denselben Icon-Knopf
 * aus Icons.jsx benutzen (title="Löschen").
 */
async function zeileLoeschen(seite, marke) {
  const fehler = await knopfInZeile(seite, marke, "Löschen");
  if (fehler) return fehler;
  await bestaetigen(seite);
  // Nuvora loescht mit Undo-Frist (core/undo.jsx, 5 s): erst danach geht die
  // Loeschung wirklich zum Server. Wer vorher neu laedt, macht sie rueckgaengig.
  await seite.waitForTimeout(6500);
  return "";
}

/** „OK" im gestylten Bestätigungsdialog (core/dialog.jsx), falls einer kam. */
async function bestaetigen(seite) {
  try {
    const ok = seite.getByRole("button", { name: "OK", exact: true }).first();
    if (await ok.isVisible({ timeout: 1200 })) await ok.click({ timeout: 3000 });
  } catch { /* kein Dialog — der Normalfall */ }
}

/** Den Knopf mit diesem title/aria-label in der Zeile mit der Marke druecken. */
async function knopfInZeile(seite, marke, titel) {
  return await seite.evaluate(([m, titel]) => {
    const passt = (e) => (e.textContent || "").includes(m);
    const blatt = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && passt(e));
    const feld = [...document.querySelectorAll("input, textarea")].find((i) => (i.value || "").includes(m));
    let el = blatt || feld;
    if (!el) return "kein Element mit der Marke gefunden";
    while (el && el !== document.body) {
      const knopf = [...el.querySelectorAll("button")].find(
        (b) => b.getAttribute("title") === titel || b.getAttribute("aria-label") === titel);
      if (knopf) { knopf.click(); return ""; }
      el = el.parentElement;
    }
    return `kein Knopf „${titel}" in der Zeile`;
  }, [marke, titel]);
}

// ─────────────────────────────── Ablauf ───────────────────────────────

async function main() {
  const browser = await chromium.launch();
  // Deutsch erzwingen: die Marker unten sind die deutschen Beschriftungen, und
  // Playwright startet sonst mit en-US — dann sucht der Test Knoepfe, die es in
  // dieser Sprache gar nicht gibt.
  kontext = await browser.newContext({ baseURL: URL_BASIS, locale: "de-DE", viewport: { width: 1280, height: 900 } });
  let vorherAktiv = [];
  let module = [];
  const testdaten = { topic: null, question: null, set: null, session: null, method: null, arbeit: null, markt: [], deckName: "" };

  try {
    // ── Anmelden ──
    const login = await kontext.request.post("/api/auth/login", { data: { email: EMAIL, password: PASSWORT } });
    if (!login.ok()) throw new Error(`Login fehlgeschlagen: HTTP ${login.status()}`);
    const { token: t, user } = await login.json();
    token = t;
    notiere("Anmeldung", "Login", true, `als ${user.email}`);

    await kontext.addInitScript(([tok, usr]) => {
      localStorage.setItem("token", tok);
      localStorage.setItem("user", usr);
      // Der Modul-Cache wuerde den Stand des vorigen Durchgangs zeigen — hier
      // wird pro Durchgang umgeschaltet, also immer frisch fragen.
      localStorage.removeItem("nuvora_cache_modules");
      // Sprache festnageln (siehe locale oben).
      localStorage.setItem("cardvote_lang", "de");
    }, [token, JSON.stringify(user)]);

    module = (await apiJson("/api/modules")).filter((m) => m.available && !m.external);
    vorherAktiv = module.filter((m) => m.active).map((m) => m.key);
    const alle = module.map((m) => m.key);

    // ── Testdaten, die es fuer die Brueckenpruefung braucht ──
    await nurDiese(module, alle);
    const bereit = await testdatenAnlegen(testdaten);
    notiere("Testdaten", "schwaches Thema, Marktplatz-Einträge", bereit.ok, bereit.detail);

    // ── 1. Jedes Modul einzeln ──
    for (const [i, m] of module.entries()) {
      await nurDiese(module, [m.key]);

      const befund = await besuche(m.path);
      notiere("Modul allein", `${m.name} (${m.path})`, befund.ok, befund.detail);

      const nav = await startseitenKacheln(module);
      const fremd = nav.filter((k) => k !== m.key);
      const fehlt = nav.includes(m.key);
      notiere("Modul allein · Navigation", m.name, fremd.length === 0 && fehlt,
        fremd.length ? `Startseite bietet zusätzlich: ${fremd.join(", ")}`
          : fehlt ? "genau dieses Modul auf der Startseite" : "das eigene Modul fehlt auf der Startseite");

      // Stichprobe: drei fremde Modul-Adressen muessen ans Gate laufen.
      const proben = [1, 2, 3].map((d) => module[(i + d) % module.length]).filter((x) => x.key !== m.key);
      const durchgerutscht = [];
      for (const p of proben) {
        const wo = await wohinFuehrt(p.path);
        if (wo !== "/modules") durchgerutscht.push(`${p.path} → ${wo}`);
      }
      notiere("Modul allein · ModuleGate", m.name, durchgerutscht.length === 0,
        durchgerutscht.length ? `nicht gesperrt: ${durchgerutscht.join(", ")}`
          : `gesperrt: ${proben.map((p) => p.path).join(", ")}`);
    }

    // ── 2. Verbotene Verbindungen ──
    // Ohne Testdaten waeren alle Ergebnisse hier wertlos: eine Bruecke, deren
    // Ausgangsdaten fehlen, kann gar nichts anzeigen. Dann EIN klarer Fehler,
    // statt ein Dutzend erfundener "tote Bruecke"-Meldungen.
    if (!bereit.ok) {
      notiere("Verbindung", "übersprungen", false,
        `Vorbedingung fehlt (${bereit.detail}) — ${verbindungen(testdaten).length * 2} Prüfungen NICHT gelaufen`);
    } else
    for (const v of verbindungen(testdaten)) {
      const was = v.beschreibung || `„${v.marker}"`;
      await nurDiese(module, v.allein);
      const solo = await sichtbar(v);
      notiere("Verbindung · allein", `${v.name} · ${v.allein.join("+")}`, solo.ok ? !solo.da : false,
        !solo.ok ? solo.detail : solo.da ? `${was} erscheint OHNE das nötige Modul` : `${was} bleibt weg — richtig`);

      await nurDiese(module, v.zusammen);
      const paar = await sichtbar(v);
      notiere("Verbindung · zusammen", `${v.name} · ${v.zusammen.join("+")}`, paar.ok ? paar.da : false,
        !paar.ok ? paar.detail : paar.da ? `${was} erscheint — richtig` : `${was} fehlt TROTZ aktivem Modul (tote Brücke)`);
    }

    // ── 3. Echte Bedienung ──
    await nurDiese(module, alle);
    for (const flow of BEDIENUNG) {
      const befund = await bediene(flow);
      notiere("Bedienung", `${flow.modul}: ${flow.name}`, befund.ok, befund.detail);
    }
  } catch (e) {
    notiere("Ablauf", "Systemtest", false, String(e.message || e));
  } finally {
    // Testdaten weg, Modul-Zustand des Kontos wie vorher.
    try { await testdatenAufraeumen(testdaten); } catch (e) { notiere("Aufräumen", "Testdaten", false, String(e.message || e)); }
    try { await restLoeschen(); } catch { /* faellt beim naechsten Lauf auf */ }
    try { if (module.length) await nurDiese(module, vorherAktiv); }
    catch (e) { notiere("Aufräumen", "Modulzustand", false, String(e.message || e)); }
    await browser.close();
  }

  drucke();
  process.exit(ergebnisse.some((e) => !e.ok) ? 1 : 0);
}

/** Genau diese Module aktiv, alle anderen aus. */
async function nurDiese(module, keys) {
  for (const m of module) {
    const soll = keys.includes(m.key);
    await api(`/api/modules/${m.key}/activate`, soll ? "post" : "delete");
  }
}

/**
 * Testdaten fuer die Brueckenpruefung:
 *   - ein schwaches Thema (0 % richtig, noch nichts dazu geuebt), damit die
 *     Startseite ihre Karten-/Lernpfad-Knoepfe ueberhaupt anbieten kann,
 *   - ein Einstieg zu genau diesem Thema (Chip auf der Startseite),
 *   - je ein Marktplatz-Eintrag der Art Quiz und Karten-Deck.
 */
async function testdatenAnlegen(td) {
  try {
    // Klasse, Kurs und Kartenstapel legt der Test SELBST an.
    //
    // Frueher griff er sich die erste vorhandene Klasse. Auf einer geseedeten
    // Spielinstanz ging das gut; im echten Deploy laeuft der Test aber mit dem
    // ZZ-Selbsttest-Konto, und das ist nach dem Aufraeumen leer. Dann fehlten
    // alle Vorbedingungen, und jede Bruecke meldete "tote Bruecke" — zehn
    // Falschalarme, die nach einem kaputten System aussehen. Ein Test, der bei
    // fehlenden Daten Fehler erfindet, ist schlimmer als keiner.
    const klasse = await apiJson("/api/classes", "post", {
      name: `${MARKE}-Klasse`,
      // card_id ist Pflicht und je Klasse eindeutig: sie ist die Identitaet,
      // ueber die spaeter zusammengefuehrt wird (siehe update_class). Der Wert
      // muss zwischen 0 und 49 liegen — es ist die aufgedruckte ArUco-Nummer
      // (DICT_6X6_50), und /api/scan weist alles darueber mit 422 ab.
      students: [
        { card_id: 47, name: `${MARKE} Ann` },
        { card_id: 48, name: `${MARKE} Ben` },
        { card_id: 49, name: `${MARKE} Cem` },
      ],
    });
    td.klasse = klasse;
    if (!klasse?.id) return { ok: false, detail: "eigene Testklasse liess sich nicht anlegen" };

    td.topic = await apiJson("/api/topics", "post", { name: `${MARKE}-Thema` });
    td.question = await apiJson("/api/questions", "post", {
      text: `${MARKE}: Wie viel ist 1/3 + 1/3?`, question_type: "mc",
      choices: { A: "2/3", B: "2/6", C: "1", D: "1/3" }, correct_answer: "A", topic_id: td.topic.id,
    });
    td.set = await apiJson("/api/question-sets", "post", { name: `${MARKE}-Quiz`, question_ids: [td.question.id] });
    td.session = await apiJson("/api/sessions", "post", {
      name: `${MARKE}-Test`, class_id: klasse.id, question_set_id: td.set.id, mode: "test",
    });
    await api(`/api/sessions/${td.session.id}/set-question?question_id=${td.question.id}`, "post");
    // Antworten pruefen, nicht nur absetzen. Vorher lief eine 422 hier stumm
    // durch und der Fehler tauchte erst drei Schritte spaeter als "das Thema
    // fehlt in weak-review" auf — die Meldung zeigte auf die falsche Stelle.
    for (const s of klasse.students || []) {
      const r = await api("/api/scan", "post", { session_id: td.session.id, student_id: s.card_id, answer: "B" });
      if (!r.ok()) return { ok: false, detail: `Scan fuer Karte ${s.card_id}: HTTP ${r.status()} ${(await r.text()).slice(0, 120)}` };
    }
    await api(`/api/sessions/${td.session.id}/finish`, "post");

    // Eine Klassenarbeit AM KURS: die Seite listet nur die des Kurses, eine
    // klassenlose (wie aus dem Seed) sieht sie nie.
    // KEINEN eigenen Kurs anlegen: eine neue Klasse bekommt automatisch ihren
    // Kurs (classes.py, "Neue Klasse bekommt ihren eigenen Kurs"). Ein zweiter
    // daneben ist genau der Fehler, der die Bruecken rot faerbte — die Note
    // landete im einen Kurs, die Seiten zeigten den anderen. Und er blieb beim
    // Aufraeumen liegen, weil ihn niemand loeschte.
    td.kurs = (await apiJson("/api/kurse") || []).find(
      (x) => (x.classes || []).some((c) => c.id === klasse.id)) || null;
    td.arbeit = await apiJson("/api/klassenarbeit/works", "post", {
      class_id: klasse.id, kurs_id: td.kurs?.id ?? null, name: `${MARKE}-Arbeit`,
    });

    // Noten-Vorbedingung: ohne Abschnitt zeigt das Notenbuch keinen einzigen
    // Knopf (auch nicht "Aus Code-Detektiv"), und ohne eingetragene Note gibt
    // es im Elternkontakt nichts zu verlinken. Beides gehoert zum Aufbau, sonst
    // stehen zwei Bruecken auf Dauer rot, ohne dass etwas kaputt waere.
    td.section = await apiJson(
      `/api/noten/classes/${klasse.id}/sections?term=1${td.kurs?.id ? `&kurs_id=${td.kurs.id}` : ""}`,
      "post", { name: `${MARKE}-Abschnitt`, weight: 100 });
    if (td.section?.id) {
      td.kategorie = await apiJson("/api/noten/categories", "post",
        { name: `${MARKE}-Spalte`, section_id: td.section.id, topic_id: td.topic.id });
      const kind = (klasse.students || [])[0];
      if (td.kategorie?.id && kind) {
        td.note = await apiJson("/api/noten/entries", "post",
          { category_id: td.kategorie.id, student_id: kind.id, kind: "grade", value: 3 });
      }
    }

    td.method = await apiJson("/api/methoden/", "post", {
      title: `${MARKE}-Einstieg`, description: "Kurze Aktivierung.", ablauf: "1. Gruppen bilden",
      material: "", dauer: 10, kind: "einstieg", topic_id: td.topic.id,
    });

    // Marktplatz: ein Quiz und ein Karten-Deck veroeffentlichen — je eine Art
    // mit eigenem Modul, damit beide Richtungen pruefbar sind.
    const echtesSet = td.set;
    // Auch der Stapel wird angelegt, nicht gesucht: sonst haengt der
    // Marktplatz-Teil an Daten, die dem Konto zufaellig gehoeren.
    const deck = await apiJson("/api/karten/classes/" + klasse.id + "/decks", "post",
      { name: `${MARKE}-Stapel`, topic_id: td.topic.id });
    if (deck?.id) {
      td.deck = deck;
      await api(`/api/karten/decks/${deck.id}/cards`, "post", { front: "1/3 + 1/3", back: "2/3" });
      await api(`/api/karten/decks/${deck.id}/release`, "post", { now: true });
    }
    const klagen = [];
    const veroeffentliche = async (pfad, body) => {
      const r = await api(pfad, "post", body);
      if (!r.ok()) { klagen.push(`${pfad}: HTTP ${r.status()} ${(await r.text()).slice(0, 100)}`); return null; }
      const d = await r.json();
      td.markt.push(d.id);
      return d;
    };
    if (!deck?.id) klagen.push("eigener Kartenstapel liess sich nicht anlegen");
    if (echtesSet) await veroeffentliche("/api/marketplace/publish", { set_id: echtesSet.id, description: MARKE });
    if (deck && await veroeffentliche("/api/marketplace/publish/deck", { deck_id: deck.id, description: MARKE })) {
      td.deckName = deck.name;
    }

    const schwach = await apiJson("/api/weak-review?days=14");
    const daBei = (schwach?.topics || []).some((x) => x.topic_id === td.topic.id);
    if (!daBei) return { ok: false, detail: "das angelegte Thema taucht nicht in /api/weak-review auf" };
    if (td.markt.length < 2)
      return { ok: false, detail: `nur ${td.markt.length} Marktplatz-Einträge veröffentlicht — ${klagen.join(" | ") || "kein Grund gemeldet"}` };
    return { ok: true, detail: `schwaches Thema #${td.topic.id}, ${td.markt.length} Marktplatz-Einträge` };
  } catch (e) {
    return { ok: false, detail: String(e.message || e).split("\n")[0].slice(0, 160) };
  }
}

async function testdatenAufraeumen(td) {
  for (const id of td.markt) await api(`/api/marketplace/${id}`, "delete");
  // Eigene Kern-Daten zuerst hinterher aufraeumen (Reihenfolge: was daran
  // haengt, ist oben schon weg). Papierkorb mit, sonst bleibt der Rest liegen.
  if (td.deck) {
    await api(`/api/karten/decks/${td.deck.id}`, "delete");
    await api(`/api/karten/decks/${td.deck.id}/purge`, "delete");
  }
  if (td.session) await api(`/api/sessions/${td.session.id}`, "delete");
  if (td.set) await api(`/api/question-sets/${td.set.id}`, "delete");
  if (td.question) await api(`/api/questions/${td.question.id}`, "delete");
  if (td.method) await api(`/api/methoden/${td.method.id}`, "delete");
  if (td.arbeit) await api(`/api/klassenarbeit/works/${td.arbeit.id}`, "delete");
  if (td.kategorie) await api(`/api/noten/categories/${td.kategorie.id}`, "delete");
  if (td.section) await api(`/api/noten/sections/${td.section.id}`, "delete");
  if (td.topic) await api(`/api/topics/${td.topic.id}`, "delete");
  if (td.klasse) {
    await api(`/api/classes/${td.klasse.id}`, "delete");
    await api(`/api/classes/${td.klasse.id}/purge`, "delete");
  }
}

/**
 * Was die Bedienprobe angelegt hat, wieder loswerden — auch, wenn ein Lauf
 * mittendrin abgebrochen ist. Sonst zaehlt der Rest beim naechsten Mal als
 * Bestand und bleibt fuer immer liegen.
 */
async function restLoeschen() {
  const klassen = await apiJson("/api/classes");
  const listen = [
    ["/api/todo", "/api/todo"],
    ["/api/notizblock", "/api/notizblock"],
    ["/api/methoden/list", "/api/methoden"],
    ["/api/kalender/entries?frm=2000-01-01T00:00:00&to=2100-01-01T00:00:00", "/api/kalender/entries"],
  ];
  const kurse = await apiJson("/api/kurse");
  for (const k of klassen || []) {
    // Die Checkliste haengt am Kurs, nicht an der Klasse: ohne kurs_id liefert
    // die Liste nichts und der Rest bliebe fuer immer liegen.
    listen.push([`/api/orga/${k.id}`, "/api/orga/item"]);
    for (const ku of kurse || []) listen.push([`/api/orga/${k.id}?kurs_id=${ku.id}`, "/api/orga/item"]);
    listen.push([`/api/karten/classes/${k.id}/all-decks`, "/api/karten/decks"]);
  }
  for (const [lesen, loeschen] of listen) {
    const daten = await apiJson(lesen);
    for (const e of Array.isArray(daten) ? daten : []) {
      const text = `${e.title || ""}${e.name || ""}${e.text || ""}`;
      if (text.includes(MARKE)) await api(`${loeschen}/${e.id}`, "delete");
    }
  }
}

/** Kachel-Ziele auf der Startseite → welche Module bietet die Shell an? */
async function startseitenKacheln(module) {
  const { seite } = await neueSeite();
  try {
    await seite.goto("/", { waitUntil: "networkidle", timeout: 30000 });
    await tourWegklicken(seite);
    const hrefs = await seite.locator("a[href^='/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    return [...new Set(module.filter((m) => hrefs.includes(m.path)).map((m) => m.key))];
  } finally {
    await seite.close();
  }
}

/** Wohin fuehrt diese Adresse wirklich? (fuer die ModuleGate-Stichprobe) */
async function wohinFuehrt(pfad) {
  const { seite } = await neueSeite();
  try {
    await seite.goto(pfad, { waitUntil: "networkidle", timeout: 30000 });
    await seite.waitForTimeout(400);
    return new URL(seite.url()).pathname;
  } catch (e) {
    return `Fehler: ${String(e.message || e).split("\n")[0].slice(0, 60)}`;
  } finally {
    await seite.close();
  }
}

/** Ist der Marker der Verbindung auf der Seite zu sehen? */
async function sichtbar(v) {
  const { seite, probleme } = await neueSeite();
  try {
    await seite.goto(v.pfad, { waitUntil: "networkidle", timeout: 30000 });
    await tourWegklicken(seite);
    const jetzt = new URL(seite.url()).pathname;
    if (jetzt === "/modules" && !v.pfad.startsWith("/modules"))
      return { ok: false, detail: "ModuleGate wirft auf /modules — Modul nicht aktiv?" };
    if (v.vorbereiten) await v.vorbereiten(seite).catch(() => {});
    await seite.waitForTimeout(400);
    const da = v.finde ? await v.finde(seite) : (await seite.locator("body").innerText()).includes(v.marker);
    if (probleme.length) return { ok: true, da, detail: probleme[0] };
    return { ok: true, da };
  } catch (e) {
    return { ok: false, detail: String(e.message || e).split("\n")[0].slice(0, 140) };
  } finally {
    await seite.close();
  }
}

/** Einen Handgriff ausfuehren, das Neuladen ueberstehen und wieder abraeumen. */
async function bediene(flow) {
  const { seite, probleme } = await neueSeite();
  try {
    await seite.goto(flow.pfad, { waitUntil: "networkidle", timeout: 30000 });
    await tourWegklicken(seite);
    if (new URL(seite.url()).pathname === "/modules")
      return { ok: false, detail: "ModuleGate wirft auf /modules — Modul nicht aktiv?" };

    await flow.anlegen(seite);
    await seite.reload({ waitUntil: "networkidle" });
    await tourWegklicken(seite);
    if (!(await stehtDa(seite)))
      return { ok: false, detail: "nach dem Neuladen verschwunden — wird nicht gespeichert" };

    const fehler = flow.loeschen ? await flow.loeschen(seite) : await zeileLoeschen(seite, MARKE_UI);
    if (fehler) return { ok: false, detail: `angelegt, aber nicht löschbar: ${fehler}` };
    await seite.reload({ waitUntil: "networkidle" });
    await tourWegklicken(seite);
    if (await stehtDa(seite))
      return { ok: false, detail: "gelöscht, taucht nach dem Neuladen wieder auf" };

    if (probleme.length) return { ok: false, detail: probleme[0] };
    return { ok: true, detail: "angelegt, überlebt das Neuladen, wieder gelöscht" };
  } catch (e) {
    return { ok: false, detail: String(e.message || e).split("\n")[0].slice(0, 160) };
  } finally {
    await seite.close();
  }
}

/** Steht die Marke irgendwo auf der Seite (Text oder Eingabefeld)? */
async function stehtDa(seite) {
  const text = await seite.locator("body").innerText();
  if (text.includes(MARKE_UI)) return true;
  return await seite.evaluate((m) =>
    [...document.querySelectorAll("input, textarea")].some((i) => (i.value || "").includes(m)), MARKE_UI);
}

/** Eine Seite oeffnen und alles sammeln, was schiefgeht. */
async function besuche(pfad) {
  const { seite, probleme } = await neueSeite();
  try {
    const antwort = await seite.goto(pfad, { waitUntil: "networkidle", timeout: 30000 });
    if (!antwort || antwort.status() >= 400) return { ok: false, detail: `HTTP ${antwort?.status()}` };
    await tourWegklicken(seite);

    const jetzt = new URL(seite.url()).pathname;
    const drin = jetzt === pfad || jetzt.startsWith(pfad) || pfad.startsWith(jetzt);
    let hinweis = "";
    if (!drin) {
      if (jetzt === "/modules") return { ok: false, detail: "ModuleGate wirft auf /modules zurück (Modul nicht aktiv?)" };
      if (jetzt === "/") return { ok: false, detail: "landet auf der Startseite — nicht angemeldet?" };
      hinweis = ` → ${jetzt}`;
    }
    const textLaenge = (await seite.locator("body").innerText()).trim().length;
    if (textLaenge < 20) probleme.push("Seite bleibt leer (Render-Fehler?)");

    return probleme.length
      ? { ok: false, detail: probleme.slice(0, 3).join(" | ") }
      : { ok: true, detail: `${textLaenge} Zeichen gerendert${hinweis}` };
  } catch (e) {
    return { ok: false, detail: String(e.message || e).split("\n")[0].slice(0, 160) };
  } finally {
    await seite.close();
  }
}

/** Neue Seite mit Fehler-Mitschrift. */
async function neueSeite() {
  const seite = await kontext.newPage();
  const probleme = [];
  seite.on("console", (msg) => {
    if (msg.type() === "error" && !istEgal(msg.text())) probleme.push(`Konsole: ${msg.text().slice(0, 160)}`);
  });
  seite.on("pageerror", (e) => probleme.push(`Absturz: ${String(e).slice(0, 160)}`));
  seite.on("response", (r) => {
    if (r.status() >= 400 && !istEgal(r.url())) probleme.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`);
  });
  // Loeschen fragt teils per confirm() nach — eine Lehrkraft bestaetigt.
  seite.on("dialog", (d) => d.accept().catch(() => {}));
  return { seite, probleme };
}

/** Die Einstiegs-Tour wegklicken — sonst prueft der Test nur das Overlay. */
async function tourWegklicken(seite) {
  for (const runde of [0, 1]) {
    for (const name of [/später|spaeter|later|más tarde/i, /überspringen|ueberspringen|skip|saltar|omitir/i]) {
      try {
        const knopf = seite.getByRole("button", { name }).first();
        if (await knopf.isVisible({ timeout: runde ? 400 : 1000 })) await knopf.click({ timeout: 3000 });
      } catch { /* kein Overlay da — der Normalfall */ }
    }
    if (!runde) await seite.waitForTimeout(500);
  }
}

function drucke() {
  let gruppe = null;
  for (const e of ergebnisse) {
    if (e.gruppe !== gruppe) {
      console.log(`\n${FETT}── ${e.gruppe}${AUS}`);
      gruppe = e.gruppe;
    }
    const zeile = `  ${e.ok ? "✓" : "✗"} ${e.name}${e.detail ? `   ${e.detail}` : ""}`;
    console.log(e.ok ? `  ${GRUEN}✓${AUS}${zeile.slice(3)}` : `${ROT}${zeile}${AUS}`);
  }
  const fehler = ergebnisse.filter((e) => !e.ok);
  console.log("\n" + "=".repeat(40));
  if (!fehler.length) {
    console.log(`  ${GRUEN}Systemtest grün${AUS} — ${ergebnisse.length} Prüfungen.`);
  } else {
    console.log(`  ${ROT}${FETT}Systemtest ROT${AUS} — ${fehler.length} von ${ergebnisse.length} Prüfungen.`);
    for (const f of fehler) {
      console.log(`${ROT}  ✗ ${f.gruppe} / ${f.name}${AUS}`);
      if (f.detail) console.log(`      ${f.detail}`);
    }
  }
  console.log("=".repeat(40));
}

main();
