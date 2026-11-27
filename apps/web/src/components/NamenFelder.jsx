// Namen eingeben in Teilen: Vorname, weitere Vornamen (mit + erweiterbar), Nachname — je ein eigenes Feld.
// Gespeichert wird weiter EIN Name (`bauName` in core/namen.js); ein Nachname aus mehreren Woertern bleibt dabei
// zusammen. `wert` ist der gespeicherte Name, `onChange` bekommt den neuen.
import { useEffect, useState } from "react";
import { ICONS, Icon, iconBtn, inputStyle } from "./Icons.jsx";
import { bauName, teileName } from "../core/namen.js";
import { useLanguage } from "../i18n/index.jsx";

export default function NamenFelder({ wert = "", onChange, onEnter, autoFocus = false, kompakt = false }) {
  const { t } = useLanguage();
  const [teile, setTeile] = useState(() => teileName(wert));
  // Von aussen geaenderter Name (anderes Kind) uebernimmt die Felder neu.
  useEffect(() => {
    if (bauName(teile) !== String(wert || "").trim()) setTeile(teileName(wert));
  }, [wert]);   // eslint-disable-line react-hooks/exhaustive-deps

  const setz = (neu) => { const n = { ...teile, ...neu }; setTeile(n); onChange?.(bauName(n)); };
  const taste = (e) => { if (e.key === "Enter" && onEnter) onEnter(); };
  const feld = { ...inputStyle, flex: "1 1 120px", minWidth: 0 };

  return (
    <div style={{ display: "flex", flexWrap: kompakt ? "nowrap" : "wrap", gap: 6, alignItems: "center", flex: 1, minWidth: 0 }}>
      <input value={teile.vorname} onChange={(e) => setz({ vorname: e.target.value })} onKeyDown={taste} autoFocus={autoFocus}
        placeholder={t("namen.vorname")} aria-label={t("namen.vorname")} style={feld} />
      {teile.weitere.map((w, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", flex: "1 1 120px", minWidth: 0 }}>
          <input value={w} onChange={(e) => setz({ weitere: teile.weitere.map((x, j) => (j === i ? e.target.value : x)) })} onKeyDown={taste}
            placeholder={t("namen.weitererVorname")} aria-label={t("namen.weitererVorname")} style={{ ...feld, flex: 1 }} />
          <button type="button" onClick={() => setz({ weitere: teile.weitere.filter((_, j) => j !== i) })} className="icon-btn"
            style={{ ...iconBtn, padding: 4 }} title={t("namen.weitererWeg")} aria-label={t("namen.weitererWeg")}><Icon d={ICONS.close} size={14} /></button>
        </span>
      ))}
      <button type="button" onClick={() => setTeile({ ...teile, weitere: [...teile.weitere, ""] })} className="icon-btn"
        style={{ ...iconBtn, padding: 4 }} title={t("namen.weitererDazu")} aria-label={t("namen.weitererDazu")}><Icon d={ICONS.plus} size={16} /></button>
      <input value={teile.nachname} onChange={(e) => setz({ nachname: e.target.value })} onKeyDown={taste}
        placeholder={t("namen.nachname")} aria-label={t("namen.nachname")} style={feld} />
    </div>
  );
}
