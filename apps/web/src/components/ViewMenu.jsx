// Wiederverwendbares „Ansicht"-Menü: ein Zahnrad, das Nebenfunktionen eines
// Moduls ein-/ausblendet — statt die Werkzeugleiste vollzustellen. Jedes Modul
// gibt eine Liste Toggles rein. Optional persistiert der Aufrufer die Werte
// (z.B. pro Kurs). Diese Komponente hält nur das Auf/Zu des Menüs.
import { useState } from "react";
import { Icon, ICONS, iconBtn, Toggle, popoverPanel } from "./Icons.jsx";

// items: [{ key, label, value, onChange, hint }]
export default function ViewMenu({ items = [], title = "Ansicht" }) {
  const [open, setOpen] = useState(false);
  const anyOn = items.some((i) => i.value);
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button onClick={() => setOpen((o) => !o)} className="icon-btn" title={title} aria-label={title}
        style={{ ...iconBtn, border: (open || anyOn) ? "1px solid var(--accent)" : "1px solid var(--border2)", borderRadius: 999, width: 30, height: 30, color: (open || anyOn) ? "var(--accent)" : "var(--text3)" }}>
        <Icon d={ICONS.settings} size={17} />
      </button>
      {open && (
        <>
          <span onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div style={{ ...popoverPanel, position: "absolute", zIndex: 41, top: 36, right: 0, minWidth: 220, padding: 10 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "2px 4px 8px" }}>{title}</div>
            {items.map((it) => (
              <div key={it.key} style={{ padding: "6px 4px" }}>
                <Toggle checked={!!it.value} onChange={(v) => it.onChange(v)} label={it.label} />
                {it.hint && <div style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 3, marginLeft: 46 }}>{it.hint}</div>}
              </div>
            ))}
          </div>
        </>
      )}
    </span>
  );
}
