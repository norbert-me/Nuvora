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
import Speicherleiste from "./Speichern.jsx";
import { CONTROL_R, SHADOW } from "./Icons.jsx";

export default function SpeicherBalken({ entwurf, style }) {
  return (
    <div style={{
      position: "fixed", left: "50%", bottom: 16, transform: "translateX(-50%)", zIndex: 60,
      display: entwurf.geaendert ? "flex" : "none", alignItems: "center",
      padding: "8px 12px", borderRadius: CONTROL_R, border: "1px solid var(--border2)",
      background: "var(--card)", boxShadow: SHADOW.schwebend, maxWidth: "calc(100vw - 24px)",
      ...style,
    }}>
      <Speicherleiste entwurf={entwurf} />
    </div>
  );
}
