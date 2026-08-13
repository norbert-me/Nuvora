// Wohin ein Inhalt führt, der an einem Thema hängt.
//
// Zwei Ansichten zeigen dieselbe Liste: die Themenseite (`ThemaAnsicht.jsx`)
// und das Ausklapp-Panel in `Topics.jsx`. Die Ziele stehen deshalb hier und
// nicht zweimal daneben — sonst verlinkt die eine Ansicht auf den Kalendertag,
// während die andere weiter auf „irgendwo im Kalender" zeigt.
//
// Die Adressen sind die Deep-Links, die die Zielseiten bereits auswerten:
//   Dashboard.jsx  ?set=      — öffnet das Quiz im Fragen-Editor
//   Karten.jsx     ?class=&deck=
//   LernpfadModule ?tab=lernpfade&ll=  (postMessage „nuvora:open-lernleiter")
//   Kalender.jsx   ?view=day&date=
//
// `null` heißt: kein Ziel. Dann bleibt die Zeile Text — eine Zeile, die
// aussieht wie ein Link und beim Klick nichts tut, ist schlimmer als Text.
export const themaZiel = {
  // Eine Frage allein hat im Editor keinen Ort; geöffnet wird ihr Quiz.
  // Ohne Quiz (`set_id` fehlt) gibt es nichts anzuspringen.
  cardvote: (q) => (q.set_id ? `/cardvote/questions?set=${q.set_id}` : null),
  karten: (d) => `/karten?class=${d.class_id}&deck=${d.id}`,
  lernpfad: (l) => `/lernpfad?tab=lernpfade&ll=${l.id}`,
  kalender: (e) => (e.date ? `/kalender?view=day&date=${e.date}` : "/kalender"),
  codedetektiv: (p) => `/code-detektiv/puzzle/${p.client_id}?mode=solo`,
};
