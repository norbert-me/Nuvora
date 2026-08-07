// Modul Unterrichtsplanung — die Ideensammlung für den Unterrichtseinstieg.
//
// Die frühere „Stoffverteilung" ist entfallen: die Themen des Kerns tragen
// Reihenfolge, Lernziele und die E/G-Anforderungen bereits — eine zweite
// Jahresplanung daneben hätte dieselben Inhalte doppelt gepflegt.
import { pageApp } from "../components/Icons.jsx";
import Methoden from "./Methoden.jsx";

export default function Unterrichtsplanung() {
  return (
    <div style={{ ...pageApp }}>
      <Methoden embedded />
    </div>
  );
}
