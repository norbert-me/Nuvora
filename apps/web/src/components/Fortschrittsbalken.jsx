// Ein Balken für laufende Uploads — eine Quelle, damit er überall gleich
// aussieht (Material, Klassenfoto, Import).
//
// `wert` in Prozent; `null` heißt „läuft, Dauer unbekannt" (der Browser kennt
// die Gesamtgröße nicht immer) und zeigt einen gedämpften Vollbalken. Ohne
// laufenden Upload (`wert === undefined`/kein Upload) erscheint gar nichts —
// eine leere Leiste, die immer dasteht, ist nur Rauschen.
//
// `onAbbrechen` (optional): ein × neben dem Balken. Eine 15-MB-Datei ueber die
// Schulleitung dauert, und wer die falsche erwischt hat, soll nicht warten
// muessen, bis sie ganz oben ist.
import { COLORS as C, Icon, ICONS, iconBtn } from "./Icons.jsx";

export default function Fortschrittsbalken({ wert, style, onAbbrechen, abbrechenLabel = "Abbrechen" }) {
  if (wert === undefined || wert === false) return null;
  const unbestimmt = wert === null;
  const balken = (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={unbestimmt ? undefined : wert}
      style={{ height: 4, borderRadius: 2, background: "var(--bg2)", overflow: "hidden", ...(onAbbrechen ? { flex: 1, minWidth: 0 } : { margin: "0 0 8px", ...style }) }}>
      <div style={{ height: "100%", width: unbestimmt ? "100%" : `${Math.max(2, Math.min(100, wert))}%`,
        background: C.info, opacity: unbestimmt ? 0.4 : 1, transition: "width 0.2s linear" }} />
    </div>
  );
  if (!onAbbrechen) return balken;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 8px", ...style }}>
      {balken}
      <button type="button" onClick={onAbbrechen} className="icon-btn" title={abbrechenLabel} aria-label={abbrechenLabel}
        style={{ ...iconBtn, padding: 4, minWidth: 32, minHeight: 32 }}>
        <Icon d={ICONS.close} size={14} />
      </button>
    </div>
  );
}
