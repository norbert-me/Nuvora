// Daten fuer den Offline-Betrieb vorladen.
//
// Der Service-Worker legt die Seiten (JS/CSS) beim Installieren komplett ab —
// aber eine Seite ohne Daten ist eine leere Huelle. Sein API-Cache fuellt sich
// nur mit dem, was jemand vorher wirklich aufgerufen hat: wer die App oeffnet
// und ohne Umweg das Netz verlaesst, sieht offline ueberall "keine Daten".
// Deshalb einmal je Sitzung die Listen holen, aus denen die Seiten leben.
//
// Grenzen, absichtlich:
// - NUR Lesen (GET). Es wird nichts geschrieben und nichts angezeigt; scheitert
//   ein Aufruf, passiert nichts weiter — es ist Vorrat, keine Funktion.
// - NUR aktive Module (Regel 3). Ein Aufruf in ein abgeschaltetes Modul gaebe
//   403 und stuende danach als Fehlantwort im Cache.
// - Nacheinander mit kleiner Pause: der Server begrenzt die Rate, und ein
//   Schwall von zwanzig Anfragen beim Anmelden verdraengt die Aufrufe der
//   Seite, die die Lehrkraft gerade sehen will.

import { sparsamesNetz } from "./sparsam.js";

const KERN = ["/api/auth/me", "/api/modules", "/api/classes", "/api/kurse", "/api/topics"];

// Je Modul die Listen, die seine Startseite braucht. Neues Modul: hier eintragen —
// sonst ist es online da und offline leer.
const JE_MODUL = {
  cardvote: ["/api/questions", "/api/folders", "/api/root-question-sets", "/api/sessions-list", "/api/sessions/active", "/api/stats/dashboard"],
  lernpfad: ["/api/lernpfad/exercises", "/api/lernpfad/paths"],
  auswertung: ["/api/noten/code-sessions"],
  karten: ["/api/karten/decks", "/api/karten/card-folders"],
  kalender: ["/api/kalender/timetable", "/api/kalender/breaks", "/api/kalender/entries", "/api/kalender/klassenarbeiten"],
  orga: ["/api/todo", "/api/material", "/api/ausleihe/items", "/api/ausleihe/loans"],
  unterrichtsplanung: ["/api/methoden/list", "/api/methoden/folders"],
  notizbrett: ["/api/notizblock"],
  "code-detektiv": ["/api/codedetektiv/puzzles"],
  pap: ["/api/pap/aufgaben"],
  tafel: ["/api/tafel"],
};

// Und je KURS — die Bedienebene, auf der die meisten Seiten stehen. {id} wird
// ersetzt. In der Desktop-Huelle ist das der Unterschied zwischen „die App ist
// da" und „die App zeigt meinen Unterricht": wer sie im Zug oeffnet, waehlt
// seinen Kurs und erwartet die Aufgaben, nicht eine leere Liste.
const JE_KURS = {
  karten: ["/api/karten/decks?kurs_id={id}"],
  auswertung: ["/api/noten/kurse/{id}/students"],
  kalender: ["/api/kalender/zeitleiste?kurs_id={id}"],
};

// Dasselbe je Klasse: die meisten Seiten zeigen nichts ohne eine gewaehlte
// Klasse, und genau diese Antworten fehlten offline. {id} wird ersetzt.
const JE_KLASSE = {
  auswertung: ["/api/noten/classes/{id}/sections", "/api/noten/classes/{id}/entries", "/api/noten/classes/{id}/summary", "/api/klassenarbeit/classes/{id}/works"],
  karten: ["/api/karten/classes/{id}/decks"],
  orga: ["/api/orga/{id}"],
  cardvote: ["/api/classes/{id}/evaluation"],
};

let gelaufen = false;

async function hole(pfad) {
  try { await fetch(pfad, { headers: { Accept: "application/json" } }); }
  catch { /* offline oder Fehler: Vorrat ist kein Muss */ }
}

/**
 * Einmal je Sitzung alle Listen holen, damit die App danach offline benutzbar ist.
 * Laeuft im Hintergrund; der Aufrufer wartet nicht darauf.
 */
export async function vorladen({ erzwingen = false } = {}) {
  if (gelaufen && !erzwingen) return;
  gelaufen = true;
  if (typeof navigator !== "undefined" && navigator.onLine === false) { gelaufen = false; return; }
  // Auf einer langsamen oder ausdruecklich sparsamen Verbindung faellt der
  // Vorrat aus. Er ist ein paar Dutzend Anfragen, die niemand angefordert hat —
  // im Schulnetz sind das genau die, die der gerade geoeffneten Seite fehlen.
  // Offline geht danach weniger; das ist der ehrlichere Tausch als eine App,
  // die zehn Minuten laedt, bevor die erste Klassenliste steht.
  // „Erzwingen" kommt aus der Offline-Diagnose im Profil: dort hat jemand
  // ausdruecklich „jetzt vorbereiten" gedrueckt — dann gilt weder der
  // Sparsam-Schalter noch der Tagesabstand.
  if (!erzwingen && sparsamesNetz()) { gelaufen = false; return; }
  // Nicht bei jedem Neuladen: das waeren je Mal ein paar Dutzend Anfragen, nur
  // um denselben Vorrat noch einmal abzulegen. Einmal am Tag reicht — im
  // laufenden Betrieb fuellt der Worker den Cache ohnehin bei jedem Aufruf.
  try {
    const zuletzt = Number(localStorage.getItem("nuvora:vorgeladen") || 0);
    if (!erzwingen && zuletzt && Date.now() - zuletzt < 12 * 60 * 60 * 1000) return;
  } catch { /* kein Speicher: dann eben jedes Mal */ }

  let aktiv = [];
  try {
    const res = await fetch("/api/modules", { headers: { Accept: "application/json" } });
    if (!res.ok) return;
    aktiv = (await res.json()).filter((m) => m.active).map((m) => m.key);
  } catch { return; }

  // Die Huelle (Desktop) ist der Fall, fuer den der Vorrat gemacht ist: sie
  // wird gezielt geoeffnet, um offline zu arbeiten, und liegt auf einem
  // Rechner mit Platz. Dort wird auch je KURS vorgeladen, im Browser nicht —
  // dort ist der Vorrat ein Nebeneffekt des Besuchs.
  const huelle = typeof window !== "undefined" && !!(window.nuvora || window.nuvoraDesktop);

  let klassen = [];
  try {
    const res = await fetch("/api/classes", { headers: { Accept: "application/json" } });
    if (res.ok) klassen = await res.json();
  } catch { /* dann eben nur die globalen Listen */ }

  let kurse = [];
  if (huelle) {
    try {
      const res = await fetch("/api/kurse", { headers: { Accept: "application/json" } });
      if (res.ok) kurse = await res.json();
    } catch { /* dann eben ohne die Kurs-Listen */ }
  }

  const pfade = [...KERN];
  for (const key of aktiv) for (const p of JE_MODUL[key] || []) pfade.push(p);
  for (const k of klassen) {
    if (k.archived || k.deleted_at) continue;   // stillgelegte Klassen braucht offline niemand
    for (const key of aktiv) for (const p of JE_KLASSE[key] || []) pfade.push(p.replace("{id}", k.id));
  }

  for (const k of kurse) {
    if (k.archiviert || k.deleted_at) continue;
    for (const key of aktiv) for (const p of JE_KURS[key] || []) pfade.push(p.replace("{id}", k.id));
  }

  for (const p of pfade) {
    await hole(p);
    await new Promise((r) => setTimeout(r, 120));
  }
  try { localStorage.setItem("nuvora:vorgeladen", String(Date.now())); } catch { /* egal */ }
}
