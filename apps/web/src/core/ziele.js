// Alles, wohin man springen kann — eine Liste, die die Suche durchsucht.
//
// Der Grund: Nuvora hat 14 Module mit je zwei bis fünf Reitern. Man weiß, dass
// es „Ausleihe" gibt, aber nicht, dass sie unter Orga sitzt. Die Navigation
// zeigt immer nur den Bereich, in dem man gerade steht — wer im Kalender ist,
// sieht die Kartenreiter nicht. Diese Liste macht jeden Reiter auffindbar,
// ohne ihn vorher zu kennen.
//
// `modul: null` heißt Kern (immer da). Alles andere erscheint nur, wenn das
// Modul für diese Lehrkraft läuft (Regel 3 — kein Weg zu einem Modul, das die
// Lehrkraft nicht hat). `worte` sind zusätzliche Suchbegriffe: wonach man
// sucht, ist selten das, wie der Reiter heißt („Fehlzeiten" → Anwesenheit).

/** @typedef {{pfad: string, key: string, modul: string|null, worte?: string[], eltern?: string}} Ziel */

export const ZIELE = [
  // ── Kern ──
  { pfad: "/", key: "nav.start", modul: null, worte: ["start", "dashboard", "übersicht"] },
  { pfad: "/classes", key: "nav.classes", modul: null, worte: ["schüler", "sus", "kinder", "namen", "förderschwerpunkt", "maßnahmen", "reihenfolge"] },
  { pfad: "/kurse", key: "kurse.title", modul: null, worte: ["fach", "fächer", "gruppen"] },
  { pfad: "/topics", key: "nav.topics", modul: null, worte: ["thema", "themen", "unterthema", "lehrplan", "jahresplanung"] },
  { pfad: "/modules", key: "nav.modules", modul: null, worte: ["module", "einschalten", "aktivieren", "werkzeuge"] },
  { pfad: "/papierkorb", key: "nav.trash", modul: null, worte: ["gelöscht", "wiederherstellen"] },
  { pfad: "/profile", key: "nav.profile", modul: null, worte: ["konto", "passwort", "sprache", "abmelden", "design"] },
  { pfad: "/marktplatz", key: "nav.marketplace", modul: null, worte: ["teilen", "veröffentlichen", "übernehmen"] },
  // Sicherungen sind Kern, aber nur die Administration sieht den Navigationspunkt.
  // Die Schranke sitzt im Server (_require_admin) — hier trotzdem auffindbar,
  // damit niemand die Adresse auswendig können muss.
  { pfad: "/backup", key: "nav.backup", modul: null, worte: ["sicherung", "backup", "datensicherung", "wiederherstellen", "dump", "administration"] },
  { pfad: "/help", key: "help.title", modul: null, worte: ["hilfe", "anleitung", "faq"] },
  { pfad: "/tutorial", key: "nav.tutorial", modul: null, worte: ["einführung", "tour", "erste schritte"] },
  { pfad: "/legal", key: "legal.title", modul: null, worte: ["impressum", "datenschutz", "dsgvo"] },
  { pfad: "/contact", key: "contact.title", modul: null, worte: ["kontakt", "melden", "fehler"] },

  // ── CardVote ──
  { pfad: "/cardvote/questions", key: "nav.questions", modul: "cardvote", worte: ["frage", "fragen", "quiz", "frageset", "ordner"] },
  { pfad: "/cardvote/session", key: "nav.session", modul: "cardvote", worte: ["abstimmung", "scannen", "beamer", "live"] },
  { pfad: "/cardvote/tests", key: "nav.tests", modul: "cardvote", worte: ["ergebnisse", "auswertung", "test"] },
  { pfad: "/cardvote/cards", key: "nav.cards", modul: "cardvote", worte: ["karten drucken", "aruco", "abstimmkarten"] },
  { pfad: "/cardvote/scan", key: "nav.scanner", modul: "cardvote", worte: ["scannen", "scanner", "kamera", "handy", "abfotografieren", "erkennen", "aruco"] },
  { pfad: "/cardvote/marketplace", key: "market.kindQuiz", modul: "cardvote", worte: ["marktplatz", "quiz teilen", "frageset übernehmen", "veröffentlichen", "fremde fragen"] },

  // ── Lernpfad ──
  { pfad: "/lernpfad?tab=aufgaben", key: "nav.exercises", modul: "lernpfad", worte: ["aufgabe", "aufgaben", "pool"] },
  { pfad: "/lernpfad?tab=generator", key: "ziele.lpGenerator", modul: "lernpfad", worte: ["lernleiter", "generieren", "erzeugen"] },
  { pfad: "/lernpfad?tab=lernpfade", key: "ziele.lpPfade", modul: "lernpfad", worte: ["lernpfad", "leitern", "zuweisen"] },

  // ── Auswertung ──
  { pfad: "/auswertung?tab=noten", key: "auswertung.tabGrades", modul: "auswertung", worte: ["note", "noten", "notenbuch", "zeugnis", "schnitt", "gewichtung", "kommentar", "beobachtung", "notiz"] },
  { pfad: "/auswertung?tab=klassenarbeit", key: "auswertung.tabWorks", modul: "auswertung", worte: ["klassenarbeit", "arbeit", "punkte", "erwartungshorizont"] },
  { pfad: "/auswertung/vergleich", key: "klassenarbeit.navCompare", modul: "auswertung", worte: ["vergleich", "klassen vergleichen", "statistik"] },

  // ── Karteikarten ──
  { pfad: "/karten?tab=cards", key: "karten.tabCards", modul: "karten", worte: ["karteikarten", "stapel", "deck", "üben"] },
  { pfad: "/karten?tab=progress", key: "karten.tabProgress", modul: "karten", worte: ["fortschritt", "lernstand"] },
  { pfad: "/karten?tab=qr", key: "karten.tabQr", modul: "karten", worte: ["qr", "zugang", "code", "zettel drucken"] },
  { pfad: "/marktplatz?area=karten&kind=karten_deck", key: "market.kindDeck", modul: "karten", worte: ["marktplatz", "stapel teilen", "deck übernehmen", "fremde karten"] },

  // ── Kalender ──
  { pfad: "/kalender", key: "kalender.title", modul: "kalender", worte: ["termin", "woche", "monat", "tag"] },
  { pfad: "/kalender?view=timetable", key: "kalender.timetable", modul: "kalender", worte: ["stundenplan", "stunden", "slots"] },
  { pfad: "/kalender?view=breaks", key: "kalender.breaksTab", modul: "kalender", worte: ["ferien", "feiertag", "frei"] },
  { pfad: "/kalender?view=ausgeblendet", key: "kalender.hiddenTab", modul: "kalender", worte: ["ausgeblendet", "entfallen", "ausfall", "versteckt", "wieder einblenden"] },
  { pfad: "/kalender?view=klassenarbeit", key: "kalender.examsTab", modul: "kalender", worte: ["klassenarbeit termin", "arbeit planen"] },
  { pfad: "/kalender?view=stoffplan", key: "stoffplan.tab", modul: "kalender", worte: ["stoffverteilung", "stoffverteilungsplan", "jahresplanung", "themen planen", "wann kommt was"] },

  // ── Orga ──
  { pfad: "/orga?tab=checklisten", key: "orga.tabChecklists", modul: "orga", worte: ["checkliste", "haken", "eingesammelt", "zettel"] },
  { pfad: "/orga?tab=anwesenheit", key: "anwesenheit.title", modul: "orga", worte: ["fehlzeiten", "krank", "entschuldigt", "fehlt", "abwesend"] },
  { pfad: "/orga?tab=ausleihe", key: "ausleihe.title", modul: "orga", worte: ["ausleihe", "buch", "material", "zurückgeben"] },
  { pfad: "/orga?tab=sitzplan", key: "sitzplan.title", modul: "orga", worte: ["sitzplan", "plätze", "tische", "aufruf"] },
  { pfad: "/orga?tab=optionen", key: "orga.tabOptions", modul: "orga", worte: ["reiter ausblenden", "einblenden", "zahnrad", "einstellungen orga", "aufräumen"] },

  // ── Übrige Module ──
  { pfad: "/code-detektiv/admin", key: "cd.create", modul: "code-detektiv", worte: ["rätsel", "blöcke", "programmieren"] },
  { pfad: "/code-detektiv/solo", key: "cd.solo", modul: "code-detektiv", worte: ["üben", "einzeln"] },
  { pfad: "/code-detektiv/home?join=1", key: "cd.join", modul: "code-detektiv", worte: ["beitreten", "sitzungscode", "code eingeben", "mitmachen", "raum"] },
  { pfad: "/zufall", key: "zufall.navDraw", modul: "zufall", worte: ["ziehen", "würfeln", "wer ist dran", "zufällig"] },
  { pfad: "/zufall?tab=gruppen", key: "zufall.navGroups", modul: "zufall", worte: ["gruppen bilden", "teams", "einteilen"] },
  { pfad: "/unterrichtsplanung", key: "unterrichtsplanung.tabEinstiege", modul: "unterrichtsplanung", worte: ["einstieg", "methode", "stundenanfang"] },
  // Die beiden gefilterten Marktplatz-Ansichten haengen am jeweiligen Modul
  // (Regel 3): ohne Unterrichtsplanung bzw. Karten gibt es dorthin keinen Weg.
  { pfad: "/marktplatz?area=methoden&kind=method", key: "market.kindMethod", modul: "unterrichtsplanung", worte: ["marktplatz", "methoden teilen", "einstiege übernehmen", "fremde einstiege"] },
  { pfad: "/notizbrett?tab=notizen", key: "notizbrett.tabNotes", modul: "notizbrett", worte: ["notiz", "zettel", "merken"] },
  { pfad: "/notizbrett?tab=aufgaben", key: "notizbrett.tabTodos", modul: "notizbrett", worte: ["to-do", "todo", "aufgabe", "erledigen"] },
  { pfad: "/tafel", key: "tafel.title", modul: "tafel", worte: ["tafel", "whiteboard", "anschrieb"] },
  { pfad: "/mathespiele", key: "mathefussball.title", modul: "mathespiele", worte: ["spiel", "fußball", "üben"] },
];

/**
 * Passt der Suchbegriff? Bewusst schlicht: alle Wörter der Eingabe müssen
 * irgendwo vorkommen (Titel, Zusatzwörter, Pfad). Kein Fuzzy-Matching — das
 * liefert bei 40 Zielen mehr Rauschen als Nutzen, und „note" soll das
 * Notenbuch finden, nicht „Notizen" mit auf Platz eins spülen.
 */
export function passt(text, begriff) {
  const worte = begriff.toLowerCase().split(/\s+/).filter(Boolean);
  const heu = text.toLowerCase();
  return worte.every((w) => heu.includes(w));
}

/** Treffer weiter oben, wenn der Titel selbst anfängt wie die Eingabe. */
export function rang(titel, begriff) {
  const t = titel.toLowerCase(), b = begriff.toLowerCase();
  if (t === b) return 0;
  if (t.startsWith(b)) return 1;
  if (t.includes(b)) return 2;
  return 3;
}
