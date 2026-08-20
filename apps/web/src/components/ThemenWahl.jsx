// Mehrere Kern-Themen auswählen — ein Knopf, ein Klappfenster mit Häkchen.
//
// Warum kein `<select multiple>`: das zeigt bei zwanzig Themen fünf Zeilen und
// verlangt Strg-Klick, um mehrere zu wählen. Wer das nicht weiß, verliert bei
// jedem Klick seine bisherige Auswahl — und genau das passiert der Lehrkraft,
// die eine Arbeit über vier Unterthemen plant.
//
// Der Knopf sagt immer, wie viele gewählt sind, damit man es auch bei
// geschlossenem Fenster sieht. Unterthemen stehen eingerückt unter ihrem
// Oberthema; die Reihenfolge kommt aus `themenIndex` (eine Quelle für alle
// Ansichten), damit dieselbe Liste überall gleich sortiert ist.
import { useState } from "react";

import { Icon, ICONS, Popover, CONTROL_H, toolbarBtn } from "./Icons.jsx";
import { themenIndex } from "../core/topics.js";
import { useLanguage } from "../i18n/index.jsx";

export default function ThemenWahl({ topics, value = [], onChange, style }) {
  const { t } = useLanguage();
  const [offen, setOffen] = useState(false);
  const idx = themenIndex(topics);
  const gewaehlt = new Set(value || []);

  const um = (id) => {
    const naechste = new Set(gewaehlt);
    if (naechste.has(id)) naechste.delete(id); else naechste.add(id);
    // Reihenfolge der Themenliste behalten, nicht die der Klicks: sonst steht
    // dieselbe Auswahl je nach Anklick-Reihenfolge anders da.
    onChange(idx.geordnet.filter((x) => naechste.has(x.id)).map((x) => x.id));
  };

  return (
    <span style={{ position: "relative", display: "inline-flex", ...style }}>
      <button type="button" onClick={() => setOffen((o) => !o)}
        style={{ ...toolbarBtn, color: gewaehlt.size ? "var(--text)" : "var(--text3)" }}
        title={t("kalender.examTopicsHint")}>
        <Icon d={ICONS.tag} size={15} />
        {gewaehlt.size ? t("kalender.examTopicsN", { n: gewaehlt.size }) : t("kalender.examTopics")}
      </button>
      {offen && (
        <>
          <span onClick={() => setOffen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <Popover style={{ zIndex: 41, top: CONTROL_H + 2, minWidth: 240, maxHeight: 300, overflowY: "auto", padding: 8 }}>
            {idx.geordnet.length === 0 && (
              <div style={{ fontSize: 13, color: "var(--text3)", padding: 4 }}>{t("kalender.examTopicsEmpty")}</div>
            )}
            {idx.geordnet.map((tp) => (
              <label key={tp.id} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "5px 4px", cursor: "pointer",
                fontSize: 13, color: "var(--text)",
                // Unterthema eingerückt: die Hierarchie ist der halbe Sinn der
                // Liste, und „Kürzen" gibt es unter mehreren Oberthemen.
                paddingLeft: tp.parent_id ? 20 : 4,
                fontWeight: tp.parent_id ? 400 : 600,
              }}>
                <input type="checkbox" checked={gewaehlt.has(tp.id)} onChange={() => um(tp.id)} />
                {tp.name}
              </label>
            ))}
          </Popover>
        </>
      )}
    </span>
  );
}
