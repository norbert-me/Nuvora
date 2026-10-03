// Ein Kurs mit Fach und Stufe — fuer Auswahllisten, die nur die kurs_id kennen
// (Notenspalte, Aufgaben der Klassenarbeit) und daraus „die Themen dieses
// Kurses" machen (themenFuerKurs in core/topics.js). Die Kursliste wird je
// Seite einmal geholt; sie ist klein.
import { useEffect, useState } from "react";
import { hol } from "./melden.js";

export function useKurs(kursId) {
  const [kurse, setKurse] = useState([]);
  useEffect(() => {
    let aktiv = true;
    hol("/api/kurse").then((d) => { if (aktiv) setKurse(Array.isArray(d) ? d : []); }).catch(() => {});
    return () => { aktiv = false; };
  }, []);
  return kursId != null ? kurse.find((k) => k.id === Number(kursId)) || null : null;
}
