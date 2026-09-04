// Ein Balken für laufende Uploads — eine Quelle, damit er überall gleich
// aussieht (Material, Klassenfoto, Import).
//
// `wert` in Prozent; `null` heißt „läuft, Dauer unbekannt" (der Browser kennt
// die Gesamtgröße nicht immer) und zeigt einen gedämpften Vollbalken. Ohne
// laufenden Upload (`wert === undefined`/kein Upload) erscheint gar nichts —
// eine leere Leiste, die immer dasteht, ist nur Rauschen.
import { COLORS as C } from "./Icons.jsx";

export default function Fortschrittsbalken({ wert, style }) {
  if (wert === undefined || wert === false) return null;
  const unbestimmt = wert === null;
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={unbestimmt ? undefined : wert}
      style={{ height: 4, borderRadius: 2, background: "var(--bg2)", overflow: "hidden", margin: "0 0 8px", ...style }}>
      <div style={{ height: "100%", width: unbestimmt ? "100%" : `${Math.max(2, Math.min(100, wert))}%`,
        background: C.info, opacity: unbestimmt ? 0.4 : 1, transition: "width 0.2s linear" }} />
    </div>
  );
}
