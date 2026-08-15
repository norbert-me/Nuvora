// Der Weg zu allem — ein Menü am Namen „Nuvora".
//
// Die Reiter in der Leiste gehören immer nur zum aktuellen Bereich. Wer von
// dort woanders hin will, brauchte den Umweg über die Startseite. Die erste
// Fassung stellte dafür einen eigenen breiten Knopf mit dem Modulnamen neben
// das Logo — der drängte die Reiter aus dem Bild und listete neun Module ohne
// Ordnung untereinander. Zwei Dinge auf einmal falsch: zu viel Platz und zu
// wenig Struktur.
//
// Jetzt: ein schmaler Pfeil direkt am Logo (das Logo selbst bleibt der Weg zur
// Startseite) und ein Menü, das dieselbe Ordnung zeigt wie die Modulseite —
// **Unterricht**, **Organisation**, **Werkzeuge**, dazu vorweg die Kernseiten,
// die kein Modul sind. Die Gruppen kommen aus dem REGISTRY (`group`), es gibt
// sie also nur einmal.
import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

import { Icon, ICONS, MODULE_ICONS, Popover } from "./Icons.jsx";
import { useModules } from "../core/modules.js";
import { useLanguage } from "../i18n/index.jsx";

// Kernseiten zuerst: sie gehören keinem Modul und sind der häufigste Sprung.
const KERN = [
  ["/", "nav.start", "home"],
  ["/classes", "nav.classes", "users"],
  ["/kurse", "kurse.title", "folder"],
  ["/topics", "nav.topics", "tag"],
];

const GRUPPEN = [
  ["unterricht", "modules.groupUnterricht"],
  ["organisation", "modules.groupOrganisation"],
  ["werkzeug", "modules.groupWerkzeug"],
];

export default function ModulWechsler() {
  const { t } = useLanguage();
  const { modules } = useModules();
  const location = useLocation();
  const [offen, setOffen] = useState(false);

  const aktiv = (modules || []).filter((m) => m.active && m.available);
  const hier = aktiv.find((m) => location.pathname.startsWith(m.path));

  const zeile = {
    display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "7px 10px",
    borderRadius: 8, textDecoration: "none", fontSize: 13.5, color: "var(--text)",
  };
  const gruppenkopf = {
    fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5,
    color: "var(--text3)", padding: "9px 10px 3px",
  };

  const eintrag = (to, label, icon, an) => (
    <NavLink key={to} to={to} data-modulziel={to} onClick={() => setOffen(false)}
      style={{ ...zeile, background: an ? "var(--bg2)" : "transparent", fontWeight: an ? 700 : 400 }}>
      <Icon d={icon} size={15} color={an ? "var(--accent)" : "var(--text3)"} />
      {label}
    </NavLink>
  );

  return (
    <span style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
      {/* Nur der Pfeil, keine Beschriftung: welches Modul offen ist, sagt schon
          die Reiterleiste daneben. */}
      <button onClick={() => setOffen((o) => !o)} data-modulwechsler
        title={t("nav.switchModule")} aria-label={t("nav.switchModule")} aria-expanded={offen}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24,
          marginRight: 4, border: "none", borderRadius: 999, background: offen ? "var(--bg2)" : "transparent",
          color: "var(--text3)", cursor: "pointer", padding: 0 }}>
        <Icon d={ICONS.open} size={11} color="var(--text3)" style={{ transform: "rotate(90deg)" }} />
      </button>
      {offen && (
        <>
          <span onClick={() => setOffen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <Popover align="left" style={{ zIndex: 41, top: 30, minWidth: 240, padding: 4, maxHeight: "76vh", overflowY: "auto" }}>
            {KERN.map(([to, key, icon]) =>
              eintrag(to, t(key), ICONS[icon] || ICONS.folder, location.pathname === to))}

            {GRUPPEN.map(([g, key]) => {
              const drin = aktiv.filter((m) => (m.group || "werkzeug") === g);
              if (!drin.length) return null;
              return (
                <div key={g}>
                  <div style={gruppenkopf}>{t(key)}</div>
                  {drin.map((m) => eintrag(m.path, m.name, MODULE_ICONS[m.key] || ICONS.folder, hier?.key === m.key))}
                </div>
              );
            })}

            <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0" }} />
            {eintrag("/modules", t("nav.modules"), ICONS.settings, location.pathname === "/modules")}
          </Popover>
        </>
      )}
    </span>
  );
}
