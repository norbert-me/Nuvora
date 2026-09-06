import { useEffect, useMemo, useRef, useState } from "react";
import {
  CONTROL_H, CONTROL_R, Icon, ICONS, Popover, selectStyle, toolbarInput,
} from "./Icons.jsx";
import { useLanguage } from "../i18n";

// Ein Auswahlfeld, das man durchsuchen kann.
//
// Der Grund kommt aus dem Gebrauch: ein <select> mit sechzig Themen ist eine
// Liste, durch die man scrollt, bis man das Richtige sieht — und auf dem Handy
// öffnet der Browser sie bildschirmfüllend ohne jede Suche. Wer weiß, wie sein
// Thema heißt, will es tippen.
//
// Ab `abSuche` Einträgen erscheint das Suchfeld; darunter wäre es ein Feld für
// vier Zeilen. Bedienung wie beim Original: Escape schließt, Enter nimmt den
// ersten Treffer, ↑/↓ wandern.
export default function SuchSelect({
  value, onChange, optionen = [], leerLabel = "", abSuche = 8, style, title, disabled = false,
}) {
  const { t } = useLanguage();
  const [offen, setOffen] = useState(false);
  const [suche, setSuche] = useState("");
  const [aktiv, setAktiv] = useState(0);
  const huelle = useRef(null);

  // Klick daneben schließt — dieselbe Erwartung wie bei jedem Menü.
  useEffect(() => {
    if (!offen) return;
    const zu = (e) => { if (huelle.current && !huelle.current.contains(e.target)) setOffen(false); };
    document.addEventListener("mousedown", zu);
    return () => document.removeEventListener("mousedown", zu);
  }, [offen]);

  const alle = useMemo(() => (leerLabel
    ? [{ wert: "", label: leerLabel }, ...optionen]
    : optionen), [optionen, leerLabel]);

  const treffer = useMemo(() => {
    const q = suche.trim().toLowerCase();
    if (!q) return alle;
    // Alle Wörter müssen vorkommen — „bruch 7" findet „Bruchrechnung (7)".
    const worte = q.split(/\s+/);
    return alle.filter((o) => worte.every((w) => String(o.label || "").toLowerCase().includes(w)));
  }, [alle, suche]);

  const gewaehlt = alle.find((o) => String(o.wert) === String(value ?? ""));

  // Kurze Listen bleiben ein echtes <select>: es ist bedienbar, barrierefrei
  // und auf dem Handy das, was das Betriebssystem anbietet.
  if (alle.length < abSuche) {
    return (
      <select value={value ?? ""} disabled={disabled} title={title}
        onChange={(e) => onChange(e.target.value)} style={{ ...selectStyle, ...style }}>
        {alle.map((o) => <option key={String(o.wert)} value={o.wert}>{o.label}</option>)}
      </select>
    );
  }

  const waehlen = (o) => { onChange(o.wert); setOffen(false); setSuche(""); };

  return (
    <span ref={huelle} style={{ position: "relative", display: "inline-flex", ...style }}>
      <button type="button" disabled={disabled} title={title}
        onClick={() => { setOffen((v) => !v); setSuche(""); setAktiv(0); }}
        style={{ ...selectStyle, textAlign: "left", display: "inline-flex", alignItems: "center",
          gap: 6, width: "100%", cursor: disabled ? "not-allowed" : "pointer" }}>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {gewaehlt ? gewaehlt.label : (leerLabel || "—")}
        </span>
        <Icon d={ICONS.open} size={12} color="var(--text3)" />
      </button>

      {offen && (
        <Popover style={{ zIndex: 60, top: CONTROL_H + 4, left: 0, minWidth: 240, maxWidth: "min(360px, 90vw)", padding: 8 }}>
          <input autoFocus value={suche} placeholder={t("common.search")}
            onChange={(e) => { setSuche(e.target.value); setAktiv(0); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setOffen(false); return; }
              if (e.key === "Enter" && treffer[aktiv]) { e.preventDefault(); waehlen(treffer[aktiv]); }
              if (e.key === "ArrowDown") { e.preventDefault(); setAktiv((i) => Math.min(i + 1, treffer.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setAktiv((i) => Math.max(i - 1, 0)); }
            }}
            style={{ ...toolbarInput, width: "100%", boxSizing: "border-box", marginBottom: 6 }} />
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            {treffer.length === 0 && (
              <div style={{ fontSize: 13, color: "var(--text3)", padding: "6px 8px" }}>{t("common.noResults")}</div>
            )}
            {treffer.map((o, i) => (
              <button key={String(o.wert)} type="button" onClick={() => waehlen(o)}
                onMouseEnter={() => setAktiv(i)}
                style={{ display: "block", width: "100%", textAlign: "left", border: "none",
                  padding: "6px 8px", borderRadius: CONTROL_R, cursor: "pointer", fontSize: 13,
                  background: i === aktiv ? "var(--bg2)" : "transparent",
                  color: String(o.wert) === String(value ?? "") ? "var(--accent)" : "var(--text)",
                  fontWeight: String(o.wert) === String(value ?? "") ? 600 : 400 }}>
                {o.label}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </span>
  );
}
