// Wie ein Kurs beschriftet wird — an EINER Stelle.
//
// Erst das Fach, dann der Kursname: „Mathe · 7.5". Im Kalender steht immer die
// Frage „was habe ich jetzt?" vor „mit wem?", und der Kursname allein
// beantwortet sie nicht — er ist frei gewaehlt („7.5", „Gruppe rot", „M7b")
// und sagt bei der Haelfte der Konten gar kein Fach.
//
// Warum ein eigenes Modul: dieselbe Beschriftung entsteht in der Oberflaeche
// (Kalender, Stundenplan) und im ICS-Feed, den Apple und Outlook anzeigen.
// Zwei Fassungen davon hiessen: derselbe Termin heisst im Browser anders als
// im Handykalender. Die Server-Seite hat ihr Gegenstueck in
// `_kurs_label` (apps/api/app/routers/kalender.py) und muss mitgezogen werden.

/** "Mathe · 7.5" — Fach zuerst, Kursname dahinter. */
export function kursLabel(kurs) {
  if (!kurs) return "";
  const fach = (kurs.fach || "").trim();
  const name = (kurs.name || "").trim();
  if (!fach) return name;
  if (!name) return fach;
  // Steht das Fach schon im Namen („Mathe 7.5"), waere „Mathe · Mathe 7.5"
  // doppelt gemoppelt. Viele Konten benennen ihre Kurse genau so.
  if (name.toLowerCase().includes(fach.toLowerCase())) return name;
  return `${fach} · ${name}`;
}
