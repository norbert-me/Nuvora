/**
 * Nuvora — Systemtest im echten Browser (Playwright; Chromium und/oder WebKit).
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
 * Der Modul-Zustand des Kontos und alle Testdaten werden am Ende zurueckgesetzt
 * — auch nach Strg-C, siehe `modulZustandHerstellen`.
 *
 * Nutzung:  node scripts/systemtest-browser.mjs --url … --email … --passwort …
 *           (oder SELFTEST_URL / SELFTEST_EMAIL / SELFTEST_PASSWORD)
 *           --browser=chromium|webkit|beide  (Vorgabe: chromium)
 *           WebKit ist die Engine der iPads, auf denen gearbeitet wird — sie
 *           laeuft nicht bei jedem Deploy mit, weil das die Laufzeit verdoppelt.
 * Rueckgabewert: 0 = gruen, 1 = mindestens ein Fund.
 */
import {
  zugang, motorenWahl, MOTOREN_ALLE, macheIstEgal, macheBericht, druckeBericht,
  bilanzJeMotor, abbruchBremse, macheKontextApi, modulZustandStellen, traegtMarke,
  dialogeAnnehmen, beobachte, beimLaden, tourWegklicken, anmeldungHinterlegen,
  rundgang, geduldig, mitFrist, warte, kurzfehler, drosselText,
  FRIST_SEITE, TOUR_TAKT_KNAPP, ROT, GRUEN, FETT, AUS,
} from "./browser-gemeinsam.mjs";

const { basis: URL_BASIS, email: EMAIL, passwort: PASSWORT } = zugang();

// Der Name der laufenden Engine steht in JEDER Zeile und in der Zusammenfassung
// — sonst ist beim Fehlersuchen nicht zu erkennen, welcher Lauf gemeint war.
const MOTOREN = motorenWahl();
let MOTOR = MOTOREN[0];

const istEgal = macheIstEgal();

const { ergebnisse, notiere, neueGruppe } = macheBericht({
  gruppePraefix: () => `[${MOTOR}] `,
  zusatz: () => ({ motor: MOTOR }),
});

// Dieser Test klappert besonders viele Seiten ab — deshalb der knappe Takt bei
// der Tour-Suche (siehe TOUR_TAKT_KNAPP).
const tourWeg = (seite) => tourWegklicken(seite, TOUR_TAKT_KNAPP);

// Marke, an der alles Angelegte erkennbar ist — und wieder wegkommt.
const MARKE = "ZZ-Systemtest";
// Die Bedienprobe braucht eine EIGENE Marke: die Testdaten oben heissen
// "ZZ-Systemtest-Einstieg" usw., und eine Suche nach der kurzen Marke wuerde
// in der Liste zuerst die Testdaten treffen und die falsche Zeile loeschen.
const MARKE_UI = `${MARKE}-UI`;

let kontext = null;
let token = null;

// HTTP-Zugang mit dem Token der Lehrkraft — mit Geduld bei 429, siehe
// `macheKontextApi` in browser-gemeinsam.mjs.
const { api, apiJson } = macheKontextApi(() => kontext, () => token);

// ── Modul-Zustand zurueckstellen, auch ohne Browser ────────────────────────
//
// Der Test schaltet fuer jede Pruefung andere Module ein. Frueher lief das
// Zuruecksetzen ueber den Playwright-Kontext — nach Strg-C (oder wenn der
// Browser stirbt) ist der geschlossen, JEDES Zuruecksetzen scheitert, und die
// Lehrkraft findet ihr Konto verstellt vor. Ein Testwerkzeug darf fremde
// Einstellungen nicht dauerhaft veraendern. Also laeuft das Aufraeumen ueber
// schlichtes `fetch`, das den Browser nicht braucht, haengt an SIGINT/SIGTERM —
// und sieht hinterher nach, statt es nur zu versuchen.
let sollZustand = null;   // { alle: [key], aktiv: [key] } — Stand vor dem Lauf
let aufgeraeumt = false;

async function modulZustandHerstellen(ohneBericht = false) {
  if (aufgeraeumt || !token || !sollZustand) return;
  aufgeraeumt = true;
  const soll = new Set(sollZustand.aktiv);
  const { falsch } = await modulZustandStellen({
    basis: URL_BASIS, token, keys: new Set(sollZustand.alle), aktiv: soll,
  });
  const gut = falsch.length === 0;
  const text = gut
    ? `wie vorher (${soll.size ? [...soll].join(", ") : "kein Modul aktiv"})`
    : `stimmt NICHT: ${falsch.join(", ")}`;
  if (ohneBericht) console.error(`\n${gut ? GRUEN : ROT}Modul-Zustand: ${text}${AUS}`);
  else notiere("Aufräumen", "Modulzustand", gut, text);
}

abbruchBremse(() => modulZustandHerstellen(true),
  "stelle den Modul-Zustand des Kontos wieder her …");

// ───────────────────────── Verbotene Verbindungen ─────────────────────────
//
// Jede Zeile ist eine Bruecke zwischen zwei Modulen. `allein` schaltet nur die
// Module ein, die die Bruecke NICHT rechtfertigen — dann darf der Marker nicht
// auftauchen. `zusammen` schaltet beide ein — dann MUSS er auftauchen.
/** "?class=7&kurs=3" fuer die Testklasse — die Shell wertet das aus
 * (core/klassenwahl.js). Ohne diesen Zusatz zeigt jede Seite die zuletzt
 * gewaehlte Klasse des Kontos, und auf einer Instanz mit echten Daten ist das
 * nie die Testklasse. */
const klassenParam = (td, trenner = "?") => {
  if (!td.klasse?.id) return "";
  const kurs = td.kurs?.id ? `&kurs=${td.kurs.id}` : "";
  return `${trenner}class=${td.klasse.id}${kurs}`;
};

const verbindungen = (td) => [
  {
    name: "Karten → „Als Note übernehmen\" (braucht Auswertung)",
    // Klasse UND Kurs in der Adresse: die Seiten merken sich sonst die
    // zuletzt gewaehlte Klasse. Auf einer Instanz mit echten Klassen zeigten
    // sie deshalb eine fremde — und die Bruecke sah tot aus, obwohl nur die
    // falsche Klasse offen war. Lokal fiel das nie auf: dort gab es nur die
    // Testklasse.
    pfad: `/karten?tab=progress${klassenParam(td, "&")}`,
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
    name: "Notenbuch → „Aus Code-Detektiv\" (braucht Code-Detektiv)",
    pfad: `/auswertung?tab=noten${klassenParam(td, "&")}`,
    marker: "Aus Code-Detektiv",
    // Der Knopf haengt an ZWEI Bedingungen: aktives Modul UND mindestens ein
    // Notenblock (`cdAktiv && sections.length > 0` in Noten.jsx) — ohne Block
    // gaebe es keine Spalte, in die die Sitzung wandern koennte.
    //
    // Die Bloecke kommen aber erst nach mehreren verketteten Ladeschritten
    // (Klasse -> Kurs -> Abschnitte). Die pauschale Wartezeit von 400 ms reichte
    // dafuer mal und mal nicht: der Lauf meldete „tote Bruecke", obwohl nur die
    // Vorbedingung noch nicht auf dem Schirm war. Also ausdruecklich auf den
    // Abschnitt warten — und wenn DER ausbleibt, sagt die Meldung genau das,
    // statt auf die Bruecke zu zeigen.
    //
    // Seit der Vereinheitlichung der Werkzeugleisten liegt der Knopf im
    // „Mehr"-Menue (components/Werkzeugleiste.jsx) — sichtbar wird er also erst
    // nach einem Klick darauf. Das gehoert in die Vorbereitung, nicht in die
    // Suche: die Verbindung ist da, sie steht nur eine Ebene tiefer. Ohne das
    // meldete der Lauf „tote Bruecke", obwohl nichts kaputt war.
    vorbereiten: async (seite) => {
      await seite.locator("th").filter({ hasText: `${MARKE}-Abschnitt` }).first()
        .waitFor({ state: "visible", timeout: 10000 });
      await seite.locator("[title='Mehr']").first().click({ timeout: 8000 }).catch(() => {});
      await seite.waitForTimeout(300);
    },
    allein: ["auswertung"],
    zusammen: ["auswertung", "code-detektiv"],
  },
  {
    name: "Klassenarbeit → „Wiederholung erzeugen\" (braucht Karten/Lernpfad)",
    // Auch die Klassenarbeit selbst per Deep-Link waehlen (?work=): die Seite
    // nimmt sonst die NEUESTE der Klasse, und das ist auf einer Instanz mit
    // echten Daten nicht die des Tests.
    pfad: `/auswertung?tab=klassenarbeit${klassenParam(td, "&")}${td.arbeit?.id ? `&work=${td.arbeit.id}` : ""}`,
    marker: "Wiederholung erzeugen",
    allein: ["auswertung"],
    zusammen: ["auswertung", "karten", "lernpfad"],
    // Auf das ERGEBNIS warten, nicht auf die Uhr: die Seite laedt Klasse, Kurs
    // und Klassenarbeiten nacheinander nach. Eine feste Wartezeit von 1,5 s
    // reichte mal und mal nicht — der Test meldete dann eine "tote Bruecke",
    // die keine war. Flatterige Pruefungen sind schlimmer als fehlende: man
    // gewoehnt sich an rote Zeilen.
    vorbereiten: async (seite) => {
      // "attached", nicht "visible": der Name steht in einem <option> des
      // Auswahlfeldes, und ein option gilt Playwright grundsaetzlich als
      // unsichtbar. Vorhanden heisst hier: die Liste ist geladen.
      await seite.getByText(`${MARKE}-Arbeit`).first().waitFor({ state: "attached", timeout: 15000 });
    },
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
    // Ohne Emoji: der Chip traegt jetzt ein SVG-Icon, im Text steht nur das Wort.
    marker: "Einstieg",
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
// Handgriffe, die eine Lehrkraft wirklich macht — in JEDEM Modul mit
// Oberflaeche (ausser Lernpfad, der haengt an scripts/selftest-browser.mjs).
// Jeder legt etwas an, laedt neu, besteht darauf dass es noch da ist, und
// raeumt ueber die Oberflaeche wieder ab.
//
// Warum ueberhaupt: „die Seite rendert" ist eine schwache Zusage. Ein toter
// Knopf mitten drin (`isOn("methoden")`, der Notenchip, der nie erscheint, der
// Kalender-403) faellt erst auf, wenn jemand ihn drueckt. Genau das tut dieser
// Teil — und das NEULADEN ist der Beweis, dass wirklich gespeichert wurde und
// nicht nur React-Zustand gehalten hat.
//
// Felder je Handgriff:
//   pfad      — Adresse, IMMER mit Klasse und Kurs (`klassenParam`), sonst
//               zeigt die Seite die zuletzt gewaehlte Klasse des Kontos.
//   oeffnen   — nach JEDEM Laden ausgefuehrt: in die Unteransicht klicken
//               (Schueler waehlen o.ae.). Gibt "" zurueck oder den Grund.
//   anlegen   — der eigentliche Handgriff.
//   dasteht   — eigene Anwesenheitsprobe (Vorgabe: `stehtDa`, Text/Feldwert).
//   loeschen  — eigenes Abraeumen (Vorgabe: `zeileLoeschen`).
//   eigen     — ganz eigener Ablauf; nur fuer Module OHNE Speicher (tafel,
//               mathespiele). Gibt "" zurueck oder den Grund.
// Deshalb eine Funktion und keine Konstante: die Handgriffe brauchen die
// Testdaten (Klasse, Kurs, Abschnitt).
const bedienung = (td) => [
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
      // Einen Knopf „Stapel umbenennen" gibt es nicht mehr: der Name IST das
      // Eingabefeld im Stapelkopf (Karten.jsx, Werkzeugleiste), und das
      // Loeschen sitzt im ⋯-Menue. Das Menue haengt am AUFGEKLAPPTEN Stapel
      // (`mehr={collapsed ? [] : …}`), zugeklappt gibt es dort gar keinen
      // Knopf — also erst aufklappen.
      //
      // Der Aufklapp-Knopf traegt `karten.expandDeck` („Karten anzeigen").
      // Er hiess einmal „Unterthemen anzeigen" — eine geliehene Beschriftung
      // von der Themenseite, die inzwischen richtiggestellt ist. Beide Namen
      // werden akzeptiert, damit dieser Lauf nicht an einem Wort haengt:
      // geprueft wird das Aufklappen, nicht die Beschriftung.
      let fehler = await knopfInZeile(seite, MARKE_UI, ["Karten anzeigen", "Show cards", "Unterthemen anzeigen"]);
      if (fehler) return fehler;
      // Aufgeklappt steht die Marke im Namensfeld statt als Text — kurz warten,
      // bis der Kopf umgebaut ist, sonst sucht der naechste Griff im alten.
      const feld = seite.locator(`input[value='${MARKE_UI}']`).first();
      await feld.waitFor({ state: "visible", timeout: 8000 });
      fehler = await knopfInZeile(seite, MARKE_UI, "Mehr");
      if (fehler) return fehler;
      // „Löschen" steht im aufgeklappten ⋯-Menue; askConfirm fragt danach nach.
      await seite.getByRole("button", { name: "Löschen", exact: true }).first().click({ timeout: 8000 });
      await bestaetigen(seite);
      // Kein Undo-Fenster: der Stapel geht sofort zum Server (`call` in
      // Karten.jsx). Also auf das Ergebnis warten statt auf die Uhr.
      await feld.waitFor({ state: "detached", timeout: 15000 });
      return "";
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
  {
    modul: "cardvote",
    name: "Frageset mit Frage anlegen (/cardvote/questions)",
    pfad: "/cardvote/questions",
    async anlegen(seite) {
      await seite.locator("[title='Hinzufügen']").first().click({ timeout: 8000 });
      await seite.getByRole("button", { name: "+ Neues Frageset", exact: true }).first().click({ timeout: 8000 });
      await seite.locator("input[placeholder='Name des Fragesets']").first().fill(MARKE_UI, { timeout: 8000 });
      await seite.getByRole("button", { name: "OK", exact: true }).first().click({ timeout: 8000 });
      // Das neue Frageset geht SOFORT im Editor auf (createSet setzt
      // editingSet) — der Name steht dort in einem Feld, nicht in der Liste.
      // Also gleich hier die Frage anlegen, wie eine Lehrkraft es taete.
      await seite.locator("[title='Neue Frage']").first().click({ timeout: 15000 });
      const dialog = seite.locator("[role='dialog']").last();
      await dialog.locator("textarea[placeholder^='Fragetext']").first().fill(`${MARKE_UI}-Frage`, { timeout: 8000 });
      await dialog.locator("textarea[placeholder^='Antwort A']").first().fill("2/3", { timeout: 8000 });
      await dialog.locator("textarea[placeholder^='Antwort B']").first().fill("2/6", { timeout: 8000 });
      // Die richtige Antwort markiert der Buchstabenknopf links am Feld.
      await dialog.locator("div").filter({ hasText: /^A$/ }).first().click({ timeout: 8000 });
      await dialog.getByRole("button", { name: "Hinzufügen", exact: true }).first().click({ timeout: 8000 });
      // Auf das Ergebnis warten, nicht auf die Uhr: die Frage steht in der
      // Liste des Fragesets, sobald der Server geantwortet hat.
      await seite.getByText(`${MARKE_UI}-Frage`, { exact: false }).first().waitFor({ timeout: 15000 });
      // Zurueck zur Liste — dort muss das Frageset stehen, und dort wird gleich
      // auch geprueft, ob es das Neuladen uebersteht.
      // „Zurueck" traegt seit dem Icon-Aufraeumen ein SVG statt des Zeichens
      // „←" — der zugaengliche Name ist damit nur noch das Wort.
      await seite.getByRole("button", { name: /Zurück/ }).first().click({ timeout: 8000 });
      await seite.getByText(MARKE_UI, { exact: true }).first().waitFor({ timeout: 15000 });
    },
    // Ein Frageset hat in der Liste KEINEN Loeschknopf — der sitzt im Kopf des
    // Editors. Also aufmachen wie eine Lehrkraft und dort loeschen.
    //
    // Die FRAGE bleibt dabei im Fragenbestand: das Frageset gibt sie nur frei,
    // es besitzt sie nicht. Ueber diese Seite ist sie nicht zu loeschen —
    // `resteAbraeumen` holt sie am Ende (`/api/questions`, Praefix).
    async loeschen(seite) {
      await seite.getByText(MARKE_UI, { exact: true }).first().click({ timeout: 8000 });
      await seite.locator("[title='Löschen']").first().click({ timeout: 8000 });
      await bestaetigen(seite);   // „Frageset löschen?"
      // Kein Undo-Fenster hier: das Loeschen geht sofort zum Server. Auf das
      // Ergebnis warten — die Liste ist wieder da und die Marke ist weg.
      await seite.getByText(MARKE_UI, { exact: true }).first().waitFor({ state: "detached", timeout: 15000 });
      return "";
    },
  },
  {
    modul: "auswertung",
    name: "Notenspalte anlegen und Note eintippen (/auswertung?tab=noten)",
    // Klasse UND Kurs: das Notenbuch haengt am Kurs (Fach). Ohne beides steht
    // die Seite auf einer fremden Klasse, und der Abschnitt aus den Testdaten
    // ist gar nicht zu sehen.
    pfad: `/auswertung?tab=noten${klassenParam(td, "&")}`,
    async anlegen(seite) {
      // Spalten haengen an einem Abschnitt — der aus den Testdaten.
      const abschnitt = seite.locator("th").filter({ hasText: `${MARKE}-Abschnitt` }).first();
      // Erst warten, bis der Abschnittskopf wirklich steht, dann klicken.
      // Vorher lief beides in EINE Frist von 15 s, und die Notenseite ist die
      // langsamste im Test (Klasse, Kurs, Abschnitte, Spalten, Noten in einem
      // Rutsch): ein Lauf scheiterte mit „locator.click: Timeout 15000ms",
      // derselbe Stand ging beim naechsten Mal durch. Getrennte, groessere
      // Fristen sagen im Fehlerfall ausserdem, WORAN es lag — an der Seite, die
      // nicht kommt, oder am Knopf, der sich nicht druecken laesst.
      await abschnitt.waitFor({ state: "visible", timeout: 25000 });
      await abschnitt.locator("[title='Optionen']").first().click({ timeout: 15000 });
      await seite.getByRole("button", { name: "Spalte hinzufügen", exact: true }).first().click({ timeout: 8000 });
      // Ueber `data-spalte`: der Platzhalter ist inzwischen der Namensvorschlag
      // („Spalte 3") und wechselt mit dem Inhalt der Seite.
      await seite.locator("[data-spalte='name']").first().fill(MARKE_UI, { timeout: 8000 });
      await seite.getByRole("button", { name: "OK", exact: true }).first().click({ timeout: 8000 });
      await spaltenIndex(seite, MARKE_UI, 15000);
      // Und jetzt das, was das Notenbuch ausmacht: eine Note in die Zelle.
      // Bewusst eine NOTE, keine Beobachtung — eine Beobachtung mit Notenwert
      // weist die API zu Recht ab (Produktregel, siehe CLAUDE.md).
      const fehler = await noteTippen(seite, MARKE_UI, "2,3");
      if (fehler) throw new Error(fehler);
      const tab = await tabSpringtWeiter(seite, MARKE_UI);
      if (tab) throw new Error(tab);
      // Die Spalte selbst legt der Server sofort an; die NOTE dagegen sammelt
      // die Tabelle nur im Entwurf (useEntwurf in Noten.jsx). Ohne diesen Klick
      // prueft das Neuladen gleich einen Stand, der nie abgeschickt wurde — und
      // die Verlassen-Warnung stuende obendrein im Weg.
      // Der Knopf schwebt unten mittig (components/SpeicherBalken.jsx).
      const speichern = seite.getByRole("button", { name: "Speichern", exact: true }).first();
      await speichern.waitFor({ state: "visible", timeout: 15000 });
      await speichern.click({ timeout: 8000 });
      // Auf das Ergebnis warten: der Hinweis geht weg, sobald der Entwurf
      // uebernommen ist.
      await seite.getByText("nicht gespeichert").first().waitFor({ state: "hidden", timeout: 20000 });
    },
    // Eigene Probe: die Spalte allein beweist nur die halbe Miete. Erst die
    // Zelle zeigt, dass auch die NOTE gespeichert wurde.
    async dasteht(seite) {
      const idx = await spaltenIndex(seite, MARKE_UI, 8000).catch(() => -1);
      if (idx < 0) return false;
      const zelle = seite.locator("tbody tr").first().locator("td").nth(idx);
      return ((await zelle.innerText().catch(() => "")) || "").includes("2,3");
    },
    async loeschen(seite) {
      // Der Loeschknopf sitzt im Menue der Spalte — erst den Kopf antippen.
      const idx = await spaltenIndex(seite, MARKE_UI, 8000).catch(() => -1);
      if (idx < 0) return "Spalte steht nicht mehr im Tabellenkopf";
      await seite.locator("thead tr").last().locator("th").nth(idx)
        .locator("button").first().click({ timeout: 8000 });
      // zeileLoeschen wartet die 5-Sekunden-Undo-Frist ab (core/undo.jsx): die
      // Spalte verschwindet sofort aus der Anzeige, beim Server landet sie erst
      // danach. Wer vorher neu laedt, macht die Loeschung rueckgaengig.
      return await zeileLoeschen(seite, MARKE_UI);
    },
  },
  {
    modul: "code-detektiv",
    name: "Rätsel anlegen (/code-detektiv/admin)",
    pfad: "/code-detektiv/admin",
    async anlegen(seite) {
      await seite.locator("input[placeholder^='z.B. LED']").first().fill(MARKE_UI, { timeout: 8000 });
      const fehler = await bausteinZiehen(seite);
      if (fehler) throw new Error(fehler);
      // Auf die Antwort des Servers warten, nicht auf die Liste: die Liste baut
      // sich beim Aufbau der Seite noch einmal aus der Server-Antwort neu
      // (store.jsx, SET_PUZZLES) — wer sie als Beweis nimmt, prueft ein Rennen.
      // Der PUT ist der Beweis; dass es wirklich liegen bleibt, zeigt gleich
      // das Neuladen.
      const zusage = seite.waitForResponse(
        (r) => r.url().includes("/api/codedetektiv/puzzles") && r.request().method() === "PUT",
        { timeout: 25000 });
      // EIN Klick, und der muss reichen. Frueher klickte der Test bis zu
      // dreimal, weil `bausteinZiehen` noch nicht abwartete, bis das Ablegen zu
      // Ende ist — mit so einer Notloesung faellt ein wirklich toter Knopf nie
      // mehr auf. („Rätsel gespeichert!" kommt als natives alert(); der
      // Dialog-Handler in `neueSeite` bestaetigt es.)
      await seite.getByRole("button", { name: "Rätsel speichern", exact: true }).first().click({ timeout: 8000 });
      const antwort = await zusage;
      if (!antwort.ok()) throw new Error(`Speichern meldet HTTP ${antwort.status()}`);
    },
    async loeschen(seite) {
      // Streng in der Karte des Raetsels bleiben: die Liste enthaelt die
      // Beispiel-Raetsel, und „Löschen" steht dort als Text, nicht als title.
      const karte = seite.locator(".puzzle-card").filter({ hasText: MARKE_UI }).first();
      if (!(await karte.count())) return "Rätsel nicht in der Liste";
      // confirm('Rätsel wirklich löschen?') — bestaetigt der Dialog-Handler.
      await karte.getByRole("button", { name: "Löschen", exact: true }).first().click({ timeout: 8000 });
      await karte.waitFor({ state: "detached", timeout: 15000 });
      return "";
    },
  },
  {
    modul: "zufall",
    name: "Schüler ziehen (/zufall)",
    pfad: `/zufall${klassenParam(td)}`,
    // Kein Anlegen/Loeschen: das Modul legt nichts an, was die Oberflaeche
    // wieder hergibt. Der Beweis ist ein anderer — siehe unten.
    beweis: "gezogen, Server hat den Zug gespeichert, Gedächtnis wieder geleert",
    async eigen(seite) {
      if (!td.klasse?.id) return "keine Testklasse — Vorbedingung fehlt";
      // Auf die ANTWORT des Servers warten, nicht auf die Uhr: die Ziehung
      // laeuft mit einer Animation, und wer danach zu frueh nachsieht, findet
      // ein leeres Gedaechtnis und meldet einen Fehler, der keiner ist.
      const zusage = seite.waitForResponse(
        (r) => r.url().includes(`/api/zufall/${td.klasse.id}/draw`) && r.request().method() === "POST",
        { timeout: 25000 });
      await seite.getByRole("button", { name: "Ziehen", exact: true }).first().click({ timeout: 8000 });
      let antwort;
      try { antwort = await zusage; } catch { return "Ziehen schickt nichts zum Server (kein POST /api/zufall/…/draw)"; }
      if (!antwort.ok()) return `Ziehen meldet HTTP ${antwort.status()}`;
      // Der gezogene Name MUSS aus der Testklasse kommen — sonst zeigt die
      // Seite eine fremde Klasse und die Probe waere wertlos.
      await seite.getByText(new RegExp(`${MARKE} (Ann|Ben|Cem)`)).first().waitFor({ timeout: 15000 });
      const stand = await apiJson(`/api/zufall/${td.klasse.id}`);
      const gezogen = Object.keys(stand?.history || {}).length;
      if (!gezogen) return "der Zug steht nach der Rückmeldung nicht im Zieh-Gedächtnis";
      // Abraeumen ueber die API, NICHT ueber die Oberflaeche: einen Knopf
      // „Gedächtnis leeren" gibt es nicht (siehe Bericht). Die Klasse selbst
      // faellt am Ende ohnehin weg, aber ein Testwerkzeug laesst nichts stehen.
      await api(`/api/zufall/${td.klasse.id}`, "delete");
      const nachher = await apiJson(`/api/zufall/${td.klasse.id}`);
      if (Object.keys(nachher?.history || {}).length) return "Zieh-Gedächtnis liess sich nicht leeren";
      return "";
    },
  },
  {
    modul: "tafel",
    name: "Textfeld beschriften (/tafel)",
    pfad: "/tafel",
    // Die Tafel hat kein Backend — der Stand liegt in localStorage
    // (`nuvora_tafel_v1`, siehe Tafel.jsx). Das Neuladen beweist hier also
    // nicht „der Server hat es", sondern „die Seite legt ihren Stand ab und
    // holt ihn wieder" — genau das, was dieses Modul verspricht. Ein Textfeld,
    // das den Reload nicht uebersteht, waere fuer den Beamer wertlos.
    async anlegen(seite) {
      await seite.getByRole("button", { name: "Textfeld", exact: true }).first().click({ timeout: 8000 });
      const feld = seite.locator("textarea[placeholder^='Text']").first();
      await feld.waitFor({ state: "visible", timeout: 8000 });
      await feld.fill(MARKE_UI, { timeout: 8000 });
    },
    async loeschen(seite) {
      // Erst das Feld anwaehlen — die Leiste mit dem Papierkorb schwebt am
      // gewaehlten Element und existiert vorher gar nicht.
      await seite.locator("textarea").first().click({ timeout: 8000 });
      await seite.locator("[title='Löschen']").first().click({ timeout: 8000 });
      await seite.locator("textarea").first().waitFor({ state: "detached", timeout: 8000 });
      return "";
    },
  },
  {
    modul: "mathespiele",
    name: "Mathefußball spielen (/mathespiele)",
    pfad: "/mathespiele",
    // Reines Spiel, ohne Daten — es gibt nichts, was ein Neuladen ueberstehen
    // koennte. Geprueft wird darum die Mechanik selbst: Spiel starten, drei
    // richtige Antworten fuer Team A, und der Ball MUSS im Tor landen (der
    // Spielstand springt auf 1). Das faellt aus, sobald die Aufgaben ausbleiben,
    // die Knoepfe nicht mehr freigeben oder die Torlogik kaputt ist — also bei
    // genau den Fehlern, die ein reines „die Seite rendert" durchlaesst.
    beweis: "Spiel gestartet, drei Treffer ergeben ein Tor",
    async eigen(seite) {
      // Nicht auf „▶ Start" festnageln: das Dreieck gehoert zur Beschriftung,
      // aber ob es im Namen des Knopfes landet, entscheidet der Browser.
      await seite.getByRole("button", { name: /Start/ }).first().click({ timeout: 8000 });
      const treffer = seite.getByRole("button", { name: /Team A richtig/ }).first();
      // Dreimal: die Spielfeldmitte ist zwei Felder vom Tor entfernt (STEPS=2).
      // Playwright wartet vor jedem Klick von sich aus, bis der Knopf wieder
      // freigegeben ist — der 2-Sekunden-Uebergang braucht keine feste Pause.
      for (const _ of [0, 1, 2]) await treffer.click({ timeout: 20000 });
      await seite.getByText("Team A · 1", { exact: true }).first().waitFor({ timeout: 15000 });
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

/**
 * Spaltennummer im Notenbuch: die wievielte Zelle traegt diese Spalte?
 *
 * Kopf- und Datenzeile sind gleich aufgebaut (Name, dann je Abschnitt die
 * Spalten und die Bereichsnote) — die Nummer aus dem Kopf passt darum auf die
 * Zellen darunter. Wartet, bis die Spalte wirklich da ist, statt einmal
 * nachzusehen und beim Nachladen ins Leere zu greifen.
 */
async function spaltenIndex(seite, name, frist = 8000) {
  // Als Objekt zurueck, nicht als Zahl: `waitForFunction` wartet auf einen
  // WAHREN Wert, und eine 0 waere falsch — sie hiesse „gefunden, ganz vorn".
  const griff = await seite.waitForFunction(([n]) => {
    const reihen = [...document.querySelectorAll("thead tr")];
    const kopf = reihen[reihen.length - 1];
    if (!kopf) return null;
    const i = [...kopf.children].findIndex((th) => (th.textContent || "").includes(n));
    return i < 0 ? null : { i };
  }, [name], { timeout: frist });
  return (await griff.jsonValue()).i;
}

/** Eine Note in die Zelle dieser Spalte tippen (erste Zeile = erster Schüler). */
async function noteTippen(seite, spalte, note) {
  const idx = await spaltenIndex(seite, spalte).catch(() => -1);
  if (idx < 0) return "die neue Spalte steht nicht im Tabellenkopf";
  const zelle = seite.locator("tbody tr").first().locator("td").nth(idx);
  await zelle.locator("button").first().click({ timeout: 8000 });
  const feld = zelle.locator("input").first();
  await feld.waitFor({ state: "visible", timeout: 8000 });
  await feld.fill(note, { timeout: 8000 });
  await feld.press("Enter");
  // Auf das Ergebnis warten: die Note steht in der Zelle, sobald der Server
  // geantwortet hat und die Tabelle neu gerechnet ist.
  try {
    await zelle.getByText(note, { exact: false }).first().waitFor({ timeout: 15000 });
  } catch {
    return `die Note „${note}" erscheint nicht in der Zelle`;
  }
  return "";
}

/**
 * Tab in einer Notenzelle muss die naechste Zelle zum Tippen oeffnen.
 *
 * Ohne das endet jede Eingabe in einem Mausklick: der Browser gibt den Fokus
 * zwar weiter, aber daneben steht ein Knopf und kein Eingabefeld — man tippt
 * ins Leere. Geprueft wird genau das: nach Tab liegt der Fokus in einem INPUT,
 * und zwar in einer ANDEREN Zelle als vorher.
 */
async function tabSpringtWeiter(seite, spalte) {
  const idx = await spaltenIndex(seite, spalte).catch(() => -1);
  if (idx < 0) return "die Spalte steht nicht im Tabellenkopf";
  const zelle = seite.locator("tbody tr").first().locator("td").nth(idx);
  const knopf = zelle.locator("button").first();
  await knopf.waitFor({ state: "visible", timeout: 15000 });
  await knopf.click({ timeout: 15000 });
  const feld = zelle.locator("input").first();
  await feld.waitFor({ state: "visible", timeout: 8000 });
  await feld.press("Tab");
  try {
    await seite.waitForFunction(() => document.activeElement?.tagName === "INPUT", null, { timeout: 8000 });
  } catch {
    return "nach Tab liegt der Fokus in keinem Eingabefeld — die Zelle daneben laesst sich nicht tippen";
  }
  const gleiche = await zelle.locator("input").count();
  if (gleiche > 0) return "nach Tab steht das Eingabefeld noch in derselben Zelle";
  await seite.keyboard.press("Escape");
  return "";
}

/**
 * Im Code-Detektiv einen Baustein aus der Werkzeugkiste auf die Flaeche ziehen.
 *
 * Ohne mindestens einen Block laesst sich kein Raetsel speichern (Admin.jsx:
 * „Titel und mindestens ein Block sind nötig"). Das laeuft ueber dnd-kit mit
 * PointerSensor und 5-px-Schwelle — darum die Zwischenschritte: ein einzelner
 * Sprung von A nach B loest gar keinen Zug aus.
 */
async function bausteinZiehen(seite) {
  await seite.locator(".toolbox-category-header").first().click({ timeout: 8000 });
  const block = seite.locator(".block-toolbox .mc-block, .block-toolbox .mc-container-block").first();
  const ziel = seite.getByText("Blöcke von links hierhin ziehen").first();
  try {
    await block.waitFor({ state: "visible", timeout: 8000 });
    await ziel.waitFor({ state: "visible", timeout: 8000 });
  } catch (e) {
    return `Werkzeugkiste oder Fläche fehlt: ${kurzfehler(e, 1)}`;
  }
  const von = await block.boundingBox();
  const nach = await ziel.boundingBox();
  if (!von || !nach) return "Baustein oder Fläche hat keine Ausdehnung";
  await seite.mouse.move(von.x + von.width / 2, von.y + von.height / 2);
  await seite.mouse.down();
  await seite.mouse.move(von.x + von.width / 2 + 12, von.y + von.height / 2 + 12, { steps: 4 });
  await seite.mouse.move(nach.x + nach.width / 2, nach.y + nach.height / 2, { steps: 12 });
  await seite.mouse.up();
  // Der Zaehler in der Ueberschrift ist das Ergebnis, auf das sich warten
  // laesst: „Lösung (1 Blöcke)".
  try {
    await seite.getByText(/Lösung \(\d+ Blöcke\)/).first().waitFor({ timeout: 8000 });
  } catch {
    return "der Baustein ist nicht auf der Fläche gelandet (Drag & Drop)";
  }
  // Und jetzt warten, bis das Ablegen wirklich ZU ENDE ist: dnd-kit laesst den
  // schwebenden Baustein nach dem Loslassen noch die Ablege-Bewegung lang ueber
  // der Seite stehen (ein `position: fixed`-Knoten direkt an `body`) und
  // verschluckt in dieser Zeit jeden Klick — den ersten Klick nach dem Ablegen
  // bekaeme sonst niemand mit (gemessen: das Fenster endet ~50 ms nach dem
  // Loslassen, die Schicht selbst geht nach ~250 ms). Ein Mensch klickt nie so
  // schnell, ein Testwerkzeug immer. Also auf den Zustand warten, nicht auf die
  // Uhr — und danach reicht EIN Klick, worauf der Aufrufer besteht.
  try {
    await seite.waitForFunction(() => ![...document.body.children].some(
      (e) => getComputedStyle(e).position === "fixed"
        && e.querySelector(".mc-block, .mc-container-block")), null, { timeout: 8000 });
  } catch {
    return "die schwebende Ablege-Schicht von dnd-kit verschwindet nicht";
  }
  return "";
}

/** Den Knopf mit diesem title/aria-label in der Zeile mit der Marke druecken. */
/**
 * Knopf in der Zeile mit dieser Marke anklicken.
 *
 * `titel` darf ein Wort ODER eine Liste sein: eine Probe soll am VERHALTEN
 * haengen, nicht an einer Beschriftung — sonst wird sie rot, sobald jemand
 * einen Tooltip richtigstellt.
 */
async function knopfInZeile(seite, marke, titel) {
  return await seite.evaluate(([m, titel]) => {
    const namen = Array.isArray(titel) ? titel : [titel];
    const passt = (e) => (e.textContent || "").includes(m);
    const blatt = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && passt(e));
    const feld = [...document.querySelectorAll("input, textarea")].find((i) => (i.value || "").includes(m));
    let el = blatt || feld;
    if (!el) return "kein Element mit der Marke gefunden";
    while (el && el !== document.body) {
      const knopf = [...el.querySelectorAll("button")].find(
        (b) => namen.includes(b.getAttribute("title")) || namen.includes(b.getAttribute("aria-label")));
      if (knopf) { knopf.click(); return ""; }
      el = el.parentElement;
    }
    return `kein Knopf „${namen.join(" / ")}" in der Zeile`;
  }, [marke, titel]);
}

// ─────────────────────────────── Ablauf ───────────────────────────────

/**
 * Ein Lauf je Engine. Der Modul-Zustand wird nach JEDEM Lauf zurueckgestellt,
 * also muessen die Merker davor wieder auf Anfang — sonst haelt der zweite Lauf
 * sich fuer schon aufgeraeumt und laesst das Konto verstellt zurueck.
 */
async function main() {
  for (const name of MOTOREN) {
    MOTOR = name;
    neueGruppe();
    aufgeraeumt = false;
    sollZustand = null;
    token = null;
    console.log(`\n${FETT}══════ Browser-Engine: ${name} ══════${AUS}`);
    await lauf(MOTOREN_ALLE[name]);
  }
  drucke();
  process.exit(ergebnisse.some((e) => !e.ok) ? 1 : 0);
}

async function lauf(motor) {
  const browser = await motor.launch();
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

    // Der Modul-Cache muss weg: er wuerde den Stand des vorigen Durchgangs
    // zeigen — hier wird pro Durchgang umgeschaltet, also immer frisch fragen.
    // Die Sprache wird festgenagelt (siehe `locale` oben), die gefuehrten
    // Touren vorab abgehakt. Warum das alles abgesichert laeuft, steht bei
    // `anmeldungHinterlegen` in browser-gemeinsam.mjs.
    await anmeldungHinterlegen(kontext, token, user, {
      modulCacheLeeren: true, extra: { cardvote_lang: "de" },
    });

    module = (await apiJson("/api/modules")).filter((m) => m.available && !m.external);
    vorherAktiv = module.filter((m) => m.active).map((m) => m.key);
    const alle = module.map((m) => m.key);
    // Ab hier weiss auch der Signal-Handler, wohin er zurueckstellen muss.
    sollZustand = { alle, aktiv: vorherAktiv };

    // ── Testdaten, die es fuer die Brueckenpruefung braucht ──
    await nurDiese(module, alle);
    // Erst die Reste des letzten Laufs weg: liegen sie noch da, antwortet das
    // Anlegen mit 409 und der ganze Aufbau faellt aus (siehe resteAbraeumen).
    try {
      const weg = await resteAbraeumen();
      notiere("Testdaten", "Reste des letzten Laufs", true,
        weg ? `${weg} Reste eines abgebrochenen Laufs abgeräumt` : "keine");
    } catch (e) {
      notiere("Testdaten", "Reste des letzten Laufs", false, String(e.message || e).slice(0, 160));
    }
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
      const solo = await sichtbar(v, false);
      const nachsatz = (b) => (b.hinweis ? ` · ${b.hinweis}` : "");
      notiere("Verbindung · allein", `${v.name} · ${v.allein.join("+")}`, solo.ok ? !solo.da : false,
        (!solo.ok ? solo.detail : solo.da ? `${was} erscheint OHNE das nötige Modul` : `${was} bleibt weg — richtig`)
          + (solo.ok ? nachsatz(solo) : ""));

      await nurDiese(module, v.zusammen);
      const paar = await sichtbar(v);
      notiere("Verbindung · zusammen", `${v.name} · ${v.zusammen.join("+")}`, paar.ok ? paar.da : false,
        (!paar.ok ? paar.detail : paar.da ? `${was} erscheint — richtig`
          : `${was} fehlt TROTZ aktivem Modul (tote Brücke) — Seite war ${paar.wo}`)
          + (paar.ok ? nachsatz(paar) : ""));
    }

    // ── 3. Echte Bedienung ──
    await nurDiese(module, alle);
    // Ohne Testklasse (und ohne den Abschnitt im Notenbuch) haetten die meisten
    // Handgriffe gar keinen Datensatz, an dem sie arbeiten koennten — dann EIN
    // klarer Fehler statt einem Dutzend erfundener.
    if (!bereit.ok) {
      notiere("Bedienung", "übersprungen", false,
        `Vorbedingung fehlt (${bereit.detail}) — ${bedienung(testdaten).length} Handgriffe NICHT gelaufen`);
    } else
    for (const flow of bedienung(testdaten)) {
      const befund = await bediene(flow);
      notiere("Bedienung", `${flow.modul}: ${flow.name}`, befund.ok, befund.detail);
    }
  } catch (e) {
    notiere("Ablauf", "Systemtest", false, kurzfehler(e));
  } finally {
    // Testdaten weg, Modul-Zustand des Kontos wie vorher.
    try { await testdatenAufraeumen(testdaten); } catch (e) { notiere("Aufräumen", "Testdaten", false, kurzfehler(e)); }
    try { await resteAbraeumen(); } catch { /* faellt beim naechsten Lauf auf */ }
    // Ueber `fetch`, nicht ueber den Browser: der kann hier schon tot sein.
    await modulZustandHerstellen();
    await browser.close().catch(() => {});
  }
}

/**
 * Genau diese Module aktiv, alle anderen aus — und nachgesehen, dass es auch
 * so ist. Rutscht ein Umschalten durch, faerbt das irgendeine spaetere Pruefung
 * rot („Startseite bietet zusätzlich: zufall"), und niemand findet den Grund
 * mehr. Einmal nachfassen, dann Bescheid sagen.
 */
async function nurDiese(module, keys) {
  const soll = new Set(keys);
  const schalten = () => Promise.all(module.map((m) =>
    api(`/api/modules/${m.key}/activate`, soll.has(m.key) ? "post" : "delete")));
  await schalten();
  for (const versuch of [0, 1]) {
    const liste = (await apiJson("/api/modules")) || [];
    const ist = new Set(liste.filter((m) => m.active).map((m) => m.key));
    const falsch = module.filter((m) => soll.has(m.key) !== ist.has(m.key)).map((m) => m.key);
    if (!falsch.length) return;
    if (versuch) {
      notiere("Modulschaltung", keys.join("+") || "keins", false, `nicht übernommen: ${falsch.join(", ")}`);
      return;
    }
    await warte(500);
    await schalten();
  }
}

/**
 * Anlegen, das seinen Fehlschlag SOFORT nennt.
 *
 * `apiJson` gibt bei jedem Nicht-2xx still `null` zurueck. Der Fehler faellt
 * dann drei Zeilen spaeter beim Zugriff auf `.id` auf — als „Cannot read
 * properties of null", einer Meldung, die niemandem sagt, was los war. Der
 * Server hatte laengst geantwortet: „HTTP 409: Dieses Thema gibt es an dieser
 * Stelle schon". Genau das steht jetzt im Bericht.
 */
async function muss(was, pfad, methode = "post", data) {
  const r = await api(pfad, methode, data);
  const text = await r.text();
  if (!r.ok()) throw new Error(`${was}: HTTP ${r.status()} ${text.slice(0, 140)}`);
  return text ? JSON.parse(text) : null;
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
    const klasse = await muss("Testklasse", "/api/classes", "post", {
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
    // muss(): ein Fehlschlag hier darf nicht still bleiben. apiJson liefert bei
    // jedem Nicht-2xx `null`, und dann fehlte spaeter nur der Knopf — gemeldet
    // wurde "tote Bruecke", obwohl die Klassenarbeit gar nicht angelegt war.
    td.arbeit = await muss("Klassenarbeit anlegen", "/api/klassenarbeit/works", "post", {
      class_id: klasse.id, kurs_id: td.kurs?.id ?? null, name: `${MARKE}-Arbeit`,
    });

    // Noten-Vorbedingung: ohne Abschnitt zeigt das Notenbuch keinen einzigen
    // Knopf (auch nicht "Aus Code-Detektiv"), und ohne eingetragene Note gibt
    // es im Elternkontakt nichts zu verlinken. Beides gehoert zum Aufbau, sonst
    // stehen zwei Bruecken auf Dauer rot, ohne dass etwas kaputt waere.
    // muss(): scheitert das hier still (apiJson liefert bei jedem Nicht-2xx
    // `null`), fehlt spaeter nur ein Knopf — und gemeldet wird „tote Bruecke"
    // statt „der Abschnitt wurde nie angelegt".
    td.section = await muss("Notenblock anlegen",
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
 * Loeschen mit Sicherheitsnetz — genau wie `Fund.loesche` in
 * scripts/aufraeumen.py: geprueft wird UNMITTELBAR vor dem DELETE, nicht nur
 * bei der Auswahl weiter oben. Eine Klasse „7a" bleibt damit auch dann
 * unberuehrt, wenn sie neben einer „ZZ-Systemtest-Klasse" steht.
 * (Das Netz selbst — `traegtMarke` samt Feldliste — steht in
 * browser-gemeinsam.mjs, damit alle vier Tests dasselbe benutzen.)
 */
async function wegDamit(eintrag, ...pfade) {
  if (!traegtMarke(eintrag, MARKE)) throw new Error("Abgebrochen: Eintrag ohne Testpräfix");
  for (const pfad of pfade) await api(pfad, "delete");
}

/**
 * Reste eines abgebrochenen Laufs abraeumen — und zwar VOR dem Aufbau.
 *
 * Bricht ein Lauf ab (Strg-C, toter Browser), bleiben Klasse, Thema, Quiz &Co.
 * mit dem Praefix liegen. Beim naechsten Mal antwortet das Anlegen dann mit
 * 409 („gibt es an dieser Stelle schon"), der Aufbau scheitert, und mit ihm
 * fallen alle Bruecken-Pruefungen aus. Der Test blockierte sich also selbst,
 * dauerhaft, bis jemand von Hand aufraeumte.
 *
 * Reihenfolge wie in scripts/aufraeumen.py: Kinder vor Eltern (Sitzung vor
 * Quiz vor Frage vor Ordner, Note vor Spalte vor Block, Klasse vor Kurs) —
 * sonst greift die Kaskade ins Leere.
 *
 * Dieselbe Funktion raeumt am Ende des Laufs auf: zwei Fassungen desselben
 * Aufraeumens laufen sonst auseinander.
 */
async function resteAbraeumen() {
  const liste = async (pfad) => {
    const d = await apiJson(pfad);
    return Array.isArray(d) ? d : [];
  };
  let weg = 0;
  const raeume = async (eintraege, pfade) => {
    for (const e of eintraege) {
      if (!traegtMarke(e, MARKE)) continue;
      await wegDamit(e, ...pfade(e));
      weg++;
    }
  };

  const klassen = await liste("/api/classes");
  const kurse = await liste("/api/kurse");
  const ich = (await apiJson("/api/auth/me"))?.id;

  // ── Marktplatz zuerst: ein veroeffentlichtes Quiz haelt sein Original fest.
  if (ich) await raeume(await liste(`/api/marketplace?author_id=${ich}`), (o) => [`/api/marketplace/${o.id}`]);

  // ── CardVote: Sitzung → Quiz → Frage → Ordner
  await raeume(await liste("/api/sessions-list"), (o) => [`/api/sessions/${o.id}`]);
  const ordner = [];
  const saetze = [...await liste("/api/root-question-sets")];
  const durchlaufe = (knoten) => {
    for (const n of knoten) {
      ordner.push(n);
      saetze.push(...(n.question_sets || []));
      durchlaufe(n.children || []);
    }
  };
  durchlaufe(await liste("/api/folders"));
  await raeume(saetze, (o) => [`/api/question-sets/${o.id}`]);
  await raeume(await liste("/api/questions"), (o) => [`/api/questions/${o.id}`]);
  await raeume(ordner, (o) => [`/api/folders/${o.id}`]);

  // ── Kartenstapel zuerst ueber die SAMMLUNG: ein ueber die Oberflaeche
  // angelegter Stapel gehoert keiner Klasse mehr (die Zuordnung laeuft ueber
  // die Stunde). Ueber `/classes/<id>/all-decks` allein war er unauffindbar —
  // er blieb liegen, und der naechste Lauf meldete „geloescht, taucht nach dem
  // Neuladen wieder auf", weil er den Rest des Vorlaufs fand.
  await raeume(await liste("/api/karten/decks"),
    (o) => [`/api/karten/decks/${o.id}`, `/api/karten/decks/${o.id}/purge`]);

  // ── Was an der Klasse haengt
  for (const k of klassen) {
    await raeume(await liste(`/api/karten/classes/${k.id}/all-decks`),
      (o) => [`/api/karten/decks/${o.id}`, `/api/karten/decks/${o.id}/purge`]);
    const bloecke = await liste(`/api/noten/classes/${k.id}/sections?term=all`);
    // Spalte vor Block: der Block nimmt seine Spalten sonst mit, und ein Block
    // ohne Praefix duerfte seine Testspalte trotzdem nicht behalten.
    await raeume(bloecke.flatMap((b) => b.categories || []), (o) => [`/api/noten/categories/${o.id}`]);
    await raeume(bloecke, (o) => [`/api/noten/sections/${o.id}`]);
    await raeume(await liste(`/api/klassenarbeit/classes/${k.id}/works`),
      (o) => [`/api/klassenarbeit/works/${o.id}`]);
    // Die Checkliste haengt am Kurs, nicht an der Klasse: ohne kurs_id liefert
    // die Liste nichts und der Rest bliebe fuer immer liegen.
    await raeume(await liste(`/api/orga/${k.id}`), (o) => [`/api/orga/item/${o.id}`]);
    for (const ku of kurse) {
      await raeume(await liste(`/api/orga/${k.id}?kurs_id=${ku.id}`), (o) => [`/api/orga/item/${o.id}`]);
    }
  }

  // ── An den Schuelern haengendes (Beobachtungen, Elternkontakte)
  //
  // Beide haben keine Sammelliste — nur „je Kind". Also je Testschueler
  // nachsehen; fremde Kinder werden dabei nicht angefasst, weil nur Klassen mit
  // dem Praefix durchlaufen werden.
  // ── Module ohne Klassenbezug
  // Code-Detektiv-Raetsel haengen an ihrer client_id, nicht an einer Zahl.
  await raeume(await liste("/api/codedetektiv/puzzles"),
    (o) => [`/api/codedetektiv/puzzles/${encodeURIComponent(o.client_id)}`]);
  await raeume(await liste("/api/methoden/list"), (o) => [`/api/methoden/${o.id}`]);
  await raeume(await liste("/api/methoden/folders"), (o) => [`/api/methoden/folders/${o.id}`]);
  await raeume(await liste("/api/kalender/entries?frm=2000-01-01T00:00:00&to=2100-01-01T00:00:00"),
    (o) => [`/api/kalender/entries/${o.id}`]);
  await raeume(await liste("/api/notizblock"), (o) => [`/api/notizblock/${o.id}`]);
  await raeume(await liste("/api/todo"), (o) => [`/api/todo/${o.id}`]);

  // ── Kern zuletzt: Thema, dann Klasse (mit Papierkorb), dann Kurs
  await raeume(await liste("/api/topics"), (o) => [`/api/topics/${o.id}`]);
  await raeume(klassen, (o) => [`/api/classes/${o.id}`, `/api/classes/${o.id}/purge`]);
  await raeume(await liste("/api/kurse"), (o) => [`/api/kurse/${o.id}`, `/api/kurse/${o.id}/purge`]);

  // ── Papierkorb: Kinder vor Eltern, sonst laeuft der Purge ins Leere.
  const rang = ["card", "ladder", "deck", "path", "class", "kurs"];
  const muell = (await liste("/api/trash"))
    .sort((a, b) => (rang.indexOf(a.kind) + 99 * (rang.indexOf(a.kind) < 0))
      - (rang.indexOf(b.kind) + 99 * (rang.indexOf(b.kind) < 0)));
  await raeume(muell, (o) => [`/api/trash/${o.kind}/${o.id}`]);

  return weg;
}

/** Kachel-Ziele auf der Startseite → welche Module bietet die Shell an? */
async function startseitenKacheln(module) {
  const { seite } = await neueSeite();
  const schauen = async () => {
    await seite.goto("/", { waitUntil: "networkidle", timeout: 30000 });
    await tourWeg(seite);
    const hrefs = await seite.locator("a[href^='/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    return [...new Set(module.filter((m) => hrefs.includes(m.path)).map((m) => m.key))];
  };
  try {
    return await mitFrist(schauen(), FRIST_SEITE, "/");
  } finally {
    await seite.close().catch(() => {});
  }
}

/** Wohin fuehrt diese Adresse wirklich? (fuer die ModuleGate-Stichprobe) */
async function wohinFuehrt(pfad) {
  const { seite } = await neueSeite();
  const gehen = async () => {
    await seite.goto(pfad, { waitUntil: "networkidle", timeout: 30000 });
    await seite.waitForTimeout(400);
    return new URL(seite.url()).pathname;
  };
  try {
    return await mitFrist(gehen(), FRIST_SEITE, pfad);
  } catch (e) {
    return `Fehler: ${String(e.message || e).split("\n")[0].slice(0, 60)}`;
  } finally {
    await seite.close().catch(() => {});
  }
}

/** Ist der Marker der Verbindung auf der Seite zu sehen? */
// streng: die Vorbedingung MUSS herstellbar sein. Das gilt nur fuer den
// Durchgang "zu zweit", in dem der Knopf erscheinen soll. Im Durchgang "allein"
// wird geprueft, dass er WEGBLEIBT — dort ist eine nicht herstellbare
// Vorbedingung kein Befund, sondern nur eine Seite, die ohne das zweite Modul
// weniger anzeigt. Frueher faerbte genau das den Lauf rot.
const sichtbar = (v, streng = true) => geduldig(() => sichtbarEinmal(v, streng));

async function sichtbarEinmal(v, streng = true) {
  const { seite, probleme, drossel } = await neueSeite();
  const schauen = async () => {
    await seite.goto(v.pfad, { waitUntil: "networkidle", timeout: 30000 });
    await tourWeg(seite);
    const jetzt = new URL(seite.url()).pathname;
    if (jetzt === "/modules" && !v.pfad.startsWith("/modules"))
      return { ok: false, wackelig: true, detail: "ModuleGate wirft auf /modules — Modul nicht aktiv?" };
    // Fehler beim Vorbereiten NICHT verschlucken. Vorher endete ein
    // misslungener Klick (Schueler nicht gefunden, weil die Seite die falsche
    // Klasse zeigte) als "Knopf fehlt TROTZ aktivem Modul" — die Meldung zeigte
    // auf die Bruecke statt auf die Ursache.
    if (v.vorbereiten) {
      try {
        await v.vorbereiten(seite);
      } catch (e) {
        if (streng) return { ok: false, detail: `Vorbereitung misslungen: ${kurzfehler(e)}` };
      }
    }
    await seite.waitForTimeout(400);
    const da = v.finde ? await v.finde(seite) : (await seite.locator("body").innerText()).includes(v.marker);
    // Die tatsaechliche Adresse mitgeben: bleibt ein Knopf aus, ist die haeufigste
    // Ursache nicht die Bruecke, sondern eine Seite, die etwas anderes zeigt als
    // erwartet (andere Klasse, andere Auswahl). Ohne die Adresse sucht man lange.
    const wo = new URL(seite.url()).pathname + new URL(seite.url()).search;
    if (probleme.length) return { ok: true, da, wo, detail: probleme[0] };
    return { ok: true, da, wo };
  };
  try {
    const befund = await mitFrist(schauen(), FRIST_SEITE, v.pfad);
    return { ...befund, gedrosselt: drosselText(drossel) };
  } catch (e) {
    return { ok: false, detail: String(e.message || e).split("\n")[0].slice(0, 140), gedrosselt: drosselText(drossel) };
  } finally {
    await seite.close().catch(() => {});
  }
}

/** Einen Handgriff ausfuehren, das Neuladen ueberstehen und wieder abraeumen. */
async function bediene(flow) {
  const { seite, probleme } = await neueSeite();
  // Ein Handgriff klickt, tippt, laedt neu und loescht — mehr Wege als ein
  // blosser Seitenaufruf, also die doppelte Frist. Ohne Frist haengt ein
  // wartender Locator bis in alle Ewigkeit.
  // Nach jedem Laden dasselbe: Tour weg, und wo noetig in die Unteransicht.
  const nachLaden = async () => {
    await tourWeg(seite);
    return flow.oeffnen ? await flow.oeffnen(seite) : "";
  };
  const dasteht = (warten) => (flow.dasteht ? flow.dasteht(seite) : stehtDa(seite, warten));
  const handgriff = async () => {
    await beimLaden(seite, () => seite.goto(flow.pfad, { waitUntil: "networkidle", timeout: 30000 }));
    if (new URL(seite.url()).pathname === "/modules")
      return { ok: false, detail: "ModuleGate wirft auf /modules — Modul nicht aktiv?" };
    let fehler = await nachLaden();
    if (fehler) return { ok: false, detail: fehler };

    // Module ohne Speicher (tafel, mathespiele) bringen ihren eigenen Ablauf
    // mit: es gibt nichts, was ein Neuladen ueberstehen koennte.
    if (flow.eigen) {
      fehler = await flow.eigen(seite);
      if (fehler) return { ok: false, detail: fehler };
      if (probleme.length) return { ok: false, detail: probleme[0] };
      return { ok: true, detail: flow.beweis || "bedient" };
    }

    await flow.anlegen(seite);
    await beimLaden(seite, () => seite.reload({ waitUntil: "networkidle" }));
    fehler = await nachLaden();
    if (fehler) return { ok: false, detail: `angelegt, danach nicht wiederzufinden: ${fehler}` };
    if (!(await dasteht(true)))
      return { ok: false, detail: "nach dem Neuladen verschwunden — wird nicht gespeichert" };

    fehler = flow.loeschen ? await flow.loeschen(seite) : await zeileLoeschen(seite, MARKE_UI);
    if (fehler) return { ok: false, detail: `angelegt, aber nicht löschbar: ${fehler}` };
    await beimLaden(seite, () => seite.reload({ waitUntil: "networkidle" }));
    fehler = await nachLaden();
    // Ein Fehlschlag beim Aufmachen ist hier KEIN Befund: die Unteransicht kann
    // ohne den Datensatz anders aussehen. Weg ist weg — genau das wird geprueft.
    if (!fehler && (await dasteht(false)))
      return { ok: false, detail: "gelöscht, taucht nach dem Neuladen wieder auf" };

    if (probleme.length) return { ok: false, detail: probleme[0] };
    return { ok: true, detail: "angelegt, überlebt das Neuladen, wieder gelöscht" };
  };
  try {
    return await mitFrist(handgriff(), FRIST_SEITE * 2, flow.pfad);
  } catch (e) {
    return { ok: false, detail: String(e.message || e).split("\n")[0].slice(0, 160) };
  } finally {
    await seite.close().catch(() => {});
  }
}

/**
 * Steht die Marke irgendwo auf der Seite (Text oder Eingabefeld)?
 *
 * `warten` heisst: bis zu zehn Sekunden darauf WARTEN, dass sie auftaucht.
 * Die Modulseiten holen ihre Listen per fetch nach — wer direkt nach dem
 * Neuladen einmal nachsieht, sieht die leere Seite davor und meldet „wird nicht
 * gespeichert", obwohl der Datensatz eine Zehntelsekunde spaeter da ist. Genau
 * das ist Beobachtungen und Elternkontakten passiert.
 * Beim Gegenbeweis (nach dem Loeschen) wird NICHT gewartet: da soll nichts mehr
 * kommen, und Warten hiesse nur, zehn Sekunden lang nichts zu tun.
 */
async function stehtDa(seite, warten = true) {
  const probe = (m) => document.body.innerText.includes(m)
    || [...document.querySelectorAll("input, textarea")].some((i) => (i.value || "").includes(m));
  if (warten) {
    try {
      await seite.waitForFunction(probe, MARKE_UI, { timeout: 10000 });
      return true;
    } catch { /* nicht gekommen — die Nachschau unten sagt es endgueltig */ }
  }
  return await seite.evaluate(probe, MARKE_UI);
}

/** Eine Seite oeffnen und alles sammeln, was schiefgeht. */
const besuche = (pfad) => geduldig(() => besucheEinmal(pfad));

async function besucheEinmal(pfad) {
  const { seite, probleme, drossel } = await neueSeite();
  try {
    const befund = await mitFrist(rundgang(seite, pfad, probleme, { takt: TOUR_TAKT_KNAPP }), FRIST_SEITE, pfad);
    return { ...befund, gedrosselt: drosselText(drossel) };
  } catch (e) {
    return { ok: false, detail: String(e.message || e).split("\n")[0].slice(0, 160), gedrosselt: drosselText(drossel) };
  } finally {
    await seite.close().catch(() => {});
  }
}

/**
 * Neue Seite mit Fehler-Mitschrift; Dialoge werden bestaetigt.
 *
 * `nachsichtigBeimLaden`: ein Neuladen bricht laufende Anfragen ab — WebKit
 * meldet das als „TypeError: Load failed", Chromium haelt still. Das ist eine
 * Eigenheit der Engine an einer Stelle, die dieser Test SELBST verursacht (er
 * laedt neu, waehrend die Seite noch laedt). Nur innerhalb von `beimLaden` wird
 * es uebergangen; ein „Load failed" im Betrieb bleibt ein Befund.
 */
async function neueSeite() {
  const seite = await kontext.newPage();
  dialogeAnnehmen(seite);
  return { seite, ...beobachte(seite, istEgal, { nachsichtigBeimLaden: true }) };
}

/** Zusammenfassung — Aufbau und Buendelung siehe `druckeBericht`. */
function drucke() {
  return druckeBericht(ergebnisse, {
    titel: "Systemtest",
    zusatzzeile: bilanzJeMotor(ergebnisse, MOTOREN),
    grundVon: (f) => `[${f.motor}] ${f.detail || "(ohne Detail)"}`,
  });
}

main();
