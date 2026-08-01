// Modul Unterrichtsplanung — bündelt die Vorbereitung unter einem Dach:
// „Stoffverteilung" (Jahressicht) und „Einstiege" (Ideensammlung). Die Reiter
// stehen in der Navbar (?tab=stoff|einstiege), wie bei den anderen Modulen. Beide
// laufen unverändert gegen ihre APIs (/api/stoffplan, /api/methoden). Deep-Link
// aus dem Kalender (?open=<id>) öffnet direkt den Einstiege-Reiter.
import { useSearchParams } from "react-router-dom";
import { pageApp } from "../components/Icons.jsx";
import Stoffplan from "./Stoffplan.jsx";
import Methoden from "./Methoden.jsx";

export default function Unterrichtsplanung() {
  const [params] = useSearchParams();
  const tab = params.get("open") || params.get("tab") === "einstiege" ? "einstiege" : "stoff";
  return (
    <div style={{ ...pageApp }}>
      {tab === "einstiege" ? <Methoden embedded /> : <Stoffplan embedded />}
    </div>
  );
}
