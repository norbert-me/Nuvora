// Modul Auswertung — bündelt die Leistungsauswertung: „Notenbuch" (gewichtete
// Spalten, Schnitt/Trend) und „Klassenarbeit" (Fehlerprofil je Thema). Die Reiter
// stehen in der Navbar (?tab=noten|klassenarbeit); der Vergleich liegt auf einer
// eigenen Unterroute (/auswertung/vergleich). Beide laufen unverändert gegen ihre
// APIs (/api/noten, /api/klassenarbeit). Trennung Note/Beobachtung bleibt: die
// Beobachtungen sitzen in der Klassenleitung, nicht hier.
import { useSearchParams } from "react-router-dom";
import Noten from "./Noten.jsx";
import Klassenarbeit from "./Klassenarbeit.jsx";

export default function Auswertung() {
  const [params] = useSearchParams();
  const tab = params.get("tab") === "klassenarbeit" ? "klassenarbeit" : "noten";
  return tab === "klassenarbeit" ? <Klassenarbeit /> : <Noten />;
}
