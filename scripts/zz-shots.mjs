// Nur zur Sichtpruefung: von jeder Seite ein Bild (Desktop + Handy).
import { chromium } from "playwright";
import fs from "fs";

const BASIS = "http://127.0.0.1:8124";
const ZIEL = process.argv[2] || "/tmp/shots";
fs.mkdirSync(ZIEL, { recursive: true });

const SEITEN = [
  ["/", "start"], ["/modules", "module"], ["/classes", "klassen"], ["/kurse", "kurse"],
  ["/topics", "themen"], ["/thema/1", "thema-detail"], ["/papierkorb", "papierkorb"],
  ["/profile", "profil"], ["/marktplatz", "marktplatz"], ["/legal", "impressum"],
  ["/contact", "kontakt"], ["/help", "hilfe"], ["/tutorial", "tutorial"],
  ["/cardvote/questions", "cardvote-fragen"], ["/cardvote/tests", "cardvote-tests"],
  ["/cardvote/evaluation/1", "cardvote-auswertung"], ["/cardvote/cards", "cardvote-karten"],
  ["/cardvote/scan", "cardvote-scan"],
  ["/lernpfad", "lernpfad"], ["/auswertung", "auswertung-noten"],
  ["/auswertung?tab=klassenarbeit", "auswertung-klassenarbeit"],
  ["/karten", "karten"], ["/kalender", "kalender"], ["/kalender?view=week", "kalender-woche"],
  ["/unterrichtsplanung", "unterrichtsplanung"], ["/code-detektiv", "code-detektiv"],
  ["/orga", "orga"], ["/orga?tab=anwesenheit", "orga-anwesenheit"],
  ["/orga?tab=sitzplan", "orga-sitzplan"], ["/orga?tab=ausleihe", "orga-ausleihe"],
  ["/zufall", "zufall"], ["/notizbrett", "notizbrett"], ["/notizen", "beobachtungen"],
  ["/klassenleitung", "klassenleitung"], ["/tafel", "tafel"], ["/mathespiele", "mathespiele"],
];

const b = await chromium.launch();
const r = await (await b.newContext({ baseURL: BASIS })).request.post("/api/auth/login",
  { data: { email: "selftest@example.com", password: "Selbsttest123" } });
const { token, user } = await r.json();

async function tour(kontext, suffix, klein) {
  for (const [pfad, name] of SEITEN) {
    const s = await kontext.newPage();
    try {
      await s.goto(pfad, { waitUntil: "networkidle", timeout: 30000 });
      for (const nm of [/später|later|más tarde/i, /überspringen|skip|saltar/i]) {
        try { const l = s.getByRole("button", { name: nm }).first();
          if (await l.isVisible({ timeout: 900 })) await l.click(); } catch { /* keine Tour */ }
      }
      // Modul-Touren erscheinen erst nach dem Laden der Daten — zweiter Versuch.
      await s.waitForTimeout(900);
      for (const nm of [/später|later|más tarde/i, /überspringen|skip|saltar/i]) {
        try { const l = s.getByRole("button", { name: nm }).first();
          if (await l.isVisible({ timeout: 700 })) await l.click(); } catch { /* keine Tour */ }
      }
      await s.waitForTimeout(400);
      await s.screenshot({ path: `${ZIEL}/${name}${suffix}.png`, fullPage: !klein });
    } catch (e) {
      console.log("!", pfad, String(e.message).split("\n")[0]);
    }
    await s.close();
  }
}

const desktop = await b.newContext({ baseURL: BASIS, viewport: { width: 1280, height: 900 } });
await desktop.addInitScript(([t, u]) => { localStorage.setItem("token", t); localStorage.setItem("user", u); localStorage.setItem("cardvote_lang", "de"); },
  [token, JSON.stringify(user)]);
await tour(desktop, "", false);

const handy = await b.newContext({ baseURL: BASIS, viewport: { width: 390, height: 844 } });
await handy.addInitScript(([t, u]) => { localStorage.setItem("token", t); localStorage.setItem("user", u); localStorage.setItem("cardvote_lang", "de"); },
  [token, JSON.stringify(user)]);
await tour(handy, "-handy", true);

await b.close();
console.log("Bilder in", ZIEL);
