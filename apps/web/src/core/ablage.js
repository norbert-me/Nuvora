// Darf der Browser unseren Offline-Vorrat wieder wegräumen?
//
// Jeder Browser hat eine Aufräumregel für Seiten-Speicher: Safari löscht
// script-schreibbaren Speicher von Seiten, die wochenlang niemand öffnet,
// Chrome räumt bei Platzmangel die am wenigsten benutzten Herkünfte zuerst ab.
// Wer offline arbeiten will, will genau das nicht — dafür gibt es
// `navigator.storage.persist()`.
//
// Drei Dinge, die man dazu wissen muss und die den Umgang hier erklären:
//
//  (a) **Es ist eine Bitte, keine Einstellung.** Der Browser entscheidet, und
//      zwar aus Heuristiken: Ist die App auf dem Home-Bildschirm? Wird sie
//      regelmäßig benutzt? Ein „nein" heute kann morgen ein „ja" sein. Also
//      wird bei jedem Start EINMAL gefragt statt nur beim ersten Mal.
//  (b) **Es gibt keinen Dialog.** Kein Browser fragt die Lehrkraft; es gibt
//      also nichts zu erklären und nichts wegzuklicken.
//  (c) **Ein „nein" ist kein Fehler.** Die Daten sind da, sie sind nur nicht
//      gegen das Aufräumen geschützt. Genau so steht es auch in der
//      Offline-Diagnose im Profil.
export async function dauerhaftAnfragen() {
  try {
    if (typeof navigator === "undefined" || !navigator.storage || !navigator.storage.persist) return false;
    // Schon zugesagt? Dann nicht noch einmal fragen — manche Browser zählen
    // wiederholte Anfragen gegen die Heuristik.
    if (navigator.storage.persisted && await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;   // Ältere Browser, privater Modus: dann eben ohne Zusage
  }
}
