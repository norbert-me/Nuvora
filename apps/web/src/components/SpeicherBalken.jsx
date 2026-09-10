// Die Speicherleiste an einer Stelle, an der sie beim Rollen nicht verschwindet.
//
// Kein zweiter Speichern-Baustein: das hier ist nur der PLATZ. Gespeichert,
// verworfen und gewarnt wird weiter in `Speichern.jsx` — diese Hülle schiebt die
// Leiste bloß an den unteren Fensterrand, damit sie auch bei einer Liste mit
// dreißig Kindern (Anwesenheit) oder einer Notentabelle mit zwanzig Spalten
// sichtbar bleibt. Oben in der Werkzeugleiste wäre sie nach zehn Zeilen weg,
// und ein Speichern-Knopf, den man suchen muss, ist keiner.
//
// `display: none` statt gar nicht rendern: `Speicherleiste` hängt die Warnung
// beim Verlassen an einen Haken in sich selbst — wird sie ausgehängt, warnt
// nichts mehr. Sie zeigt ohnehin nichts, solange nichts offen ist.
import { createPortal } from "react-dom";

import Speicherleiste from "./Speichern.jsx";
import { CONTROL_R, SHADOW } from "./Icons.jsx";

export default function SpeicherBalken({ entwurf, style }) {
  // Am `body` und nicht in der Seite: eine Karte mit `overflow` oder
  // `transform` darueber sperrt ein `position: fixed` darin ein, und der Balken
  // stuende wieder irgendwo statt am Bildschirmrand (Sitzplan zoomt, der
  // Kalender schiebt). Dieselbe Begruendung wie beim schwebenden Knopf in
  // `Speichern.jsx` — deshalb hier dieselbe Bauform.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div style={{
      position: "fixed", left: "50%", bottom: "max(16px, env(safe-area-inset-bottom))", transform: "translateX(-50%)", zIndex: 60,
      display: entwurf.geaendert ? "flex" : "none", alignItems: "center",
      padding: "8px 12px", borderRadius: CONTROL_R, border: "1px solid var(--border2)",
      background: "var(--card)", boxShadow: SHADOW.schwebend, maxWidth: "calc(100vw - 24px)",
      ...style,
    }}>
      {/* `angeheftet={false}`: DIESER Balken IST schon der feste Platz. Mit
          eigenem Anheften haette die Leiste darin fuer einen Augenblick eine
          zweite Fassung an denselben Rand gezeichnet — der Anker ist
          `display: none`, solange nichts offen ist, und gilt dem Beobachter
          damit als „nicht im Bild". */}
      <Speicherleiste entwurf={entwurf} angeheftet={false} />
    </div>,
    document.body,
  );
}
