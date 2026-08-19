// Wiederverwendbares „Ansicht"-Menü: ein Zahnrad, das Nebenfunktionen eines
// Moduls ein-/ausblendet — statt die Werkzeugleiste vollzustellen. Jedes Modul
// gibt eine Liste Toggles rein. Optional persistiert der Aufrufer die Werte
// (z.B. pro Kurs). Diese Komponente hält nur das Auf/Zu des Menüs.
import { useState } from "react";
import { Icon, ICONS, toolbarIconBtn, Toggle, Popover, sectionLabel, selectStyle } from "./Icons.jsx";

// items: [{ key, label, value, onChange, hint }]
//        oder [{ key, label, art: "wahl", value, onChange, hint,
//                optionen: [{ wert, label }] }]
//
// Die zweite Form gibt es, weil nicht jede Ansichts-Frage ja/nein ist: „wonach
// faerben?" hat vier Antworten und waere als vier Schalter ein Zustand, in dem
// zwei gleichzeitig an sein koennen. Ein Auswahlfeld kann das nicht.
export default function ViewMenu({ items = [], title = "Ansicht" }) {
  const [open, setOpen] = useState(false);
  const anyOn = items.some((i) => (i.art === "wahl" ? !!i.value : i.value));
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button onClick={() => setOpen((o) => !o)} className="icon-btn" title={title} aria-label={title}
        style={{ ...toolbarIconBtn, border: (open || anyOn) ? "1px solid var(--accent)" : "1px solid var(--border2)", color: (open || anyOn) ? "var(--accent)" : "var(--text3)" }}>
        <Icon d={ICONS.settings} size={17} />
      </button>
      {open && (
        <>
          <span onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <Popover align="right" style={{ zIndex: 41, top: 36, minWidth: 220, padding: 12 }}>
            <div style={{ ...sectionLabel, margin: "2px 4px 8px" }}>{title}</div>
            {items.map((it) => (
              <div key={it.key} style={{ padding: "6px 4px" }}>
                {it.art === "wahl" ? (
                  <label style={{ display: "block", fontSize: 13, color: "var(--text2)" }}>
                    {it.label}
                    <select value={it.value ?? ""} onChange={(ev) => it.onChange(ev.target.value)}
                      style={{ ...selectStyle, width: "100%", marginTop: 4 }}>
                      {(it.optionen || []).map((o) => <option key={o.wert} value={o.wert}>{o.label}</option>)}
                    </select>
                  </label>
                ) : (
                  <Toggle checked={!!it.value} onChange={(v) => it.onChange(v)} label={it.label} />
                )}
                {/* 46 = Breite des Schalters (38) + sein Abstand zum Text (8):
                    der Hinweis soll genau unter der Beschriftung beginnen. */}
                {it.hint && <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4, marginLeft: it.art === "wahl" ? 0 : 46 }}>{it.hint}</div>}
              </div>
            ))}
          </Popover>
        </>
      )}
    </span>
  );
}
