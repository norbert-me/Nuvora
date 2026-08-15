// Modulwechsel direkt aus der Navigation — ohne Umweg über die Startseite.
//
// Die Leiste zeigt immer nur den Bereich, in dem man gerade steht: im Kalender
// die Kalender-Reiter, in den Karten die Karten-Reiter. Wer von dort in ein
// anderes Modul wollte, musste erst auf „Nuvora" (Startseite) und von da
// weiter — zwei Klicks und ein Seitenwechsel für etwas, das man im Unterricht
// dauernd tut.
//
// Die Suche (⌘K) löst dasselbe Problem für Leute, die den Namen kennen und
// tippen wollen. Das hier ist der Weg mit der Maus: ein Knopf, der alle
// zugeschalteten Module zeigt — mit dem aktuellen als Beschriftung, damit man
// nebenbei sieht, wo man ist.
import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

import { Icon, ICONS, MODULE_ICONS, Popover } from "./Icons.jsx";
import { useModules } from "../core/modules.js";
import { useLanguage } from "../i18n/index.jsx";

export default function ModulWechsler() {
  const { t } = useLanguage();
  const { modules } = useModules();
  const location = useLocation();
  const [offen, setOffen] = useState(false);

  const aktiv = (modules || []).filter((m) => m.active && m.available);
  if (aktiv.length < 2) return null;   // mit einem Modul gibt es nichts zu wechseln

  const hier = aktiv.find((m) => location.pathname.startsWith(m.path));
  const zeile = {
    display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "8px 10px",
    borderRadius: 8, textDecoration: "none", fontSize: 13.5, color: "var(--text)",
  };

  return (
    <span style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
      <button onClick={() => setOffen((o) => !o)} data-modulwechsler title={t("nav.switchModule")} aria-label={t("nav.switchModule")}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", border: "1px solid var(--border2)",
          borderRadius: 980, background: "transparent", color: "var(--text2)", cursor: "pointer", fontSize: 13.5,
          whiteSpace: "nowrap", maxWidth: 190 }}>
        {hier && <Icon d={MODULE_ICONS[hier.key] || ICONS.folder} size={15} color="var(--text3)" />}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{hier ? hier.name : t("nav.modules")}</span>
        <Icon d={ICONS.open} size={10} color="var(--text3)" style={{ transform: "rotate(90deg)" }} />
      </button>
      {offen && (
        <>
          <span onClick={() => setOffen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <Popover align="left" style={{ zIndex: 41, top: 34, minWidth: 230, padding: 4, maxHeight: "70vh", overflowY: "auto" }}>
            {aktiv.map((m) => {
              const an = hier?.key === m.key;
              return (
                <NavLink key={m.key} to={m.path} data-modulziel={m.key} onClick={() => setOffen(false)}
                  style={{ ...zeile, background: an ? "var(--bg2)" : "transparent", fontWeight: an ? 700 : 400 }}>
                  <Icon d={MODULE_ICONS[m.key] || ICONS.folder} size={15} color={an ? "var(--accent)" : "var(--text3)"} />
                  {m.name}
                </NavLink>
              );
            })}
            <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0" }} />
            <NavLink to="/modules" onClick={() => setOffen(false)} style={{ ...zeile, color: "var(--text2)" }}>
              <Icon d={ICONS.settings} size={15} color="var(--text3)" />
              {t("nav.modules")}
            </NavLink>
          </Popover>
        </>
      )}
    </span>
  );
}
