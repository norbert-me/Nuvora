// Modul Notizbrett — bündelt zwei besitzerlose Werkzeuge unter einem Dach:
// „Notizen" (freie Zettel) und „Aufgaben" (To-do-Liste). Die Reiter stehen in
// der Navbar (?tab=notizen|aufgaben), genau wie bei anderen Modulen. Beide laufen
// weiter eigenständig gegen ihre APIs (/api/notizblock, /api/todo); hier nur die
// gemeinsame Hülle. Nicht an Schüler gebunden (Regel 3).
import { useSearchParams } from "react-router-dom";
import { pageApp } from "../components/Icons.jsx";
import Notizblock from "./Notizblock.jsx";
import Todo from "./Todo.jsx";
import { useModulOption } from "../core/modules.js";

export default function Notizbrett() {
  const [params] = useSearchParams();
  // Dieselbe Regel wie in der Auswertung: ist der voreingestellte Teil im
  // Modul-Zahnrad abgeschaltet, zeigt der Aufruf ohne ?tab den anderen.
  const notizenAn = useModulOption("notizbrett", "notizen");
  const gewaehlt = params.get("tab") === "aufgaben" ? "aufgaben" : "notizen";
  const tab = gewaehlt === "notizen" && !notizenAn ? "aufgaben" : gewaehlt;
  return (
    <div style={{ ...pageApp }}>
      {tab === "aufgaben" ? <Todo embedded /> : <Notizblock embedded />}
    </div>
  );
}
