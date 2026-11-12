// Drucken mit sprechendem Dateinamen.
//
// Der Browser schlaegt beim „Als PDF sichern" den Titel der Seite als Dateinamen vor —
// bei Nuvora also immer „Nuvora — Werkzeugkasten für Lehrkräfte". Wer ein Blatt ablegen
// will, soll den Namen nicht von Hand tippen: waehrend des Druckens heisst die Seite
// so, wie die Datei heissen soll, danach wieder wie vorher.

/** Zeichen, die in Dateinamen nicht erlaubt oder unueblich sind, werden zu „-". */
export function dateiname(roh) {
  return String(roh || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120);
}

/** „Rückmeldebogen_<Name der Arbeit>" — ohne Namen nur „Rückmeldebogen". */
export const bogenName = (arbeit) => {
  const n = dateiname(arbeit);
  return n ? `Rückmeldebogen_${n}` : "Rückmeldebogen";
};

/** Druckdialog mit dem Titel `titel`; der alte Titel kommt danach zurueck. */
export function druckenMitTitel(titel) {
  const alt = document.title;
  const neu = dateiname(titel);
  if (neu) document.title = neu;
  let fertig = false;
  const zurueck = () => {
    if (fertig) return;
    fertig = true;
    document.title = alt;
    window.removeEventListener("afterprint", zurueck);
  };
  window.addEventListener("afterprint", zurueck);
  setTimeout(zurueck, 120000);       // Rueckfall: nicht jeder Browser meldet afterprint
  window.print();
}
