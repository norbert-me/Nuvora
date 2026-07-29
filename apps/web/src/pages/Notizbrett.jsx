// Modul Notizbrett — bündelt zwei besitzerlose Werkzeuge unter einem Dach:
// „Notizen" (freie Zettel) und „Aufgaben" (To-do-Liste). Die Reiter stehen in
// der Navbar (?tab=notizen|aufgaben), genau wie bei anderen Modulen. Beide laufen
// weiter eigenständig gegen ihre APIs (/api/notizblock, /api/todo); hier nur die
// gemeinsame Hülle. Nicht an Schüler gebunden (Regel 3).
import { useSearchParams } from "react-router-dom";
import Notizblock from "./Notizblock.jsx";
import Todo from "./Todo.jsx";

export default function Notizbrett() {
  const [params] = useSearchParams();
  const tab = params.get("tab") === "aufgaben" ? "aufgaben" : "notizen";
  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      {tab === "aufgaben" ? <Todo embedded /> : <Notizblock embedded />}
    </div>
  );
}
