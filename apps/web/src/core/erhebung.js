// Wohin führt eine Spalte der Gesamtauswertung? Ein Quiz in seine Auswertung,
// eine Klassenarbeit (`art: "arbeit"`, nur mit Modul Auswertung) in die
// Klassenarbeit — dieselbe Adresse, die auch der Kalender benutzt.
export function erhebungLink(test, classId) {
  if (test && test.art === "arbeit") {
    return `/auswertung?tab=klassenarbeit&class=${classId}${test.kurs_id ? `&kurs=${test.kurs_id}` : ""}&work=${test.work_id}`;
  }
  return `/cardvote/evaluation/${test.session_id}`;
}
