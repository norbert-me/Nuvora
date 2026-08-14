// Empfindlichkeit der Frühwarnung — eine Quelle für alle drei Ansichten
// (Startseite, Klassen-Auswertung, Schülerseite).
//
// Bewusst kein Server-Einstellung und kein Regler je Klasse: die Schwellen sind
// fest (app/fruehwarnung.py), damit eine Meldung überall dasselbe bedeutet und
// zwischen Klassen vergleichbar bleibt. Was die Lehrkraft entscheiden darf, ist
// nur, ob sie früher hinsehen will — ein Schalter, zwei Stufen.
import { useEffect, useState } from "react";

const KEY = "nuvora_fruehwarn_empfindlich";

export function liesEmpfindlich() {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

/** [empfindlich, setzen] — schreibt in localStorage und meldet es allen Ansichten. */
export function useEmpfindlich() {
  const [wert, setWert] = useState(liesEmpfindlich);

  useEffect(() => {
    // Auch auf die Änderung in einer anderen Ansicht/einem anderen Tab hören,
    // sonst zeigen Startseite und Auswertung nebeneinander zwei Wahrheiten.
    const auf = () => setWert(liesEmpfindlich());
    window.addEventListener("nuvora:fruehwarn", auf);
    window.addEventListener("storage", auf);
    return () => {
      window.removeEventListener("nuvora:fruehwarn", auf);
      window.removeEventListener("storage", auf);
    };
  }, []);

  const setzen = (v) => {
    try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* Privatmodus: egal */ }
    setWert(v);
    window.dispatchEvent(new CustomEvent("nuvora:fruehwarn"));
  };
  return [wert, setzen];
}
