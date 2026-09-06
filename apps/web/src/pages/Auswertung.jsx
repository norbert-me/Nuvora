// Modul Auswertung — bündelt die Leistungsauswertung: „Notenbuch" (gewichtete
// Spalten, Schnitt/Trend) und „Klassenarbeit" (Fehlerprofil je Thema). Die Reiter
// stehen in der Navbar (?tab=noten|klassenarbeit); der Vergleich liegt auf einer
// eigenen Unterroute (/auswertung/vergleich). Beide laufen unverändert gegen ihre
// APIs (/api/noten, /api/klassenarbeit). Trennung Note/Beobachtung bleibt: die
// Beobachtungen sitzen in der Klassenleitung, nicht hier.
import { useSearchParams } from "react-router-dom";
import { pageApp } from "../components/Icons.jsx";
import Noten from "./Noten.jsx";
import Klassenarbeit from "./Klassenarbeit.jsx";
import { useModulOption } from "../core/modules.js";

export default function Auswertung() {
  const [params] = useSearchParams();
  // Beide Teile lassen sich im Modul-Zahnrad abschalten. Ist das Notenbuch aus,
  // fuehrt der Aufruf ohne ?tab nicht ins Leere, sondern zu den Klassenarbeiten
  // — sonst laege hinter dem Modulnamen eine Seite, die es nicht mehr gibt.
  const notenAn = useModulOption("auswertung", "noten");
  const gewaehlt = params.get("tab") === "klassenarbeit" ? "klassenarbeit" : "noten";
  const tab = gewaehlt === "noten" && !notenAn ? "klassenarbeit" : gewaehlt;
  return <div style={{ ...pageApp }}>{tab === "klassenarbeit" ? <Klassenarbeit /> : <Noten />}</div>;
}
