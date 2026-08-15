// Werkzeugleiste einer Seite — eine Bauform für alle Module.
//
// Vorher erfand jede Seite ihre eigene: mal sieben Knöpfe nebeneinander, mal
// zwei Zeilen, mal ein Papierkorb direkt neben „Speichern". Man findet nichts
// wieder, weil nichts an derselben Stelle steht.
//
// Die Regel hier ist schlicht und gilt überall:
//
//   [ Auswahl ]  [ was man oft tut ]        … [ Ansicht ] [ ⋯ Mehr ]
//
//   • `links`    — Klasse/Kurs, Datum, Reiter: WAS gerade bearbeitet wird
//   • `children` — die zwei, drei Handgriffe des Alltags
//   • `ansicht`  — das Zahnrad (ViewMenu), wenn die Seite eins hat
//   • `mehr`     — alles Seltene und alles Gefährliche, in einem Menü
//
// Warum Seltenes ins Menü gehört: ein Papierkorb neben „Speichern" wird
// irgendwann getroffen. Zwei Handgriffe sichtbar sind hilfreich, sieben sind
// eine Wand.
import { useState } from "react";

import { COLORS as C, CONTROL_H, Icon, ICONS, menuRow, Popover, toolbarIconBtn } from "./Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

/**
 * @param links     Auswahl-Elemente (Klasse, Datum …) — stehen ganz vorn
 * @param children  häufige Aktionen
 * @param ansicht   optional das ViewMenu der Seite
 * @param mehr      [{ key, label, onClick, icon, gefahr }] — Seltenes/Gefährliches
 */
export default function Werkzeugleiste({ links, children, ansicht, mehr = [], style }) {
  const eintraege = mehr.filter(Boolean);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12, ...style }}>
      {links}
      {children}
      {/* Alles Weitere rechts — dort greift niemand versehentlich hin. */}
      <span style={{ flex: 1, minWidth: 0 }} />
      {ansicht}
      {eintraege.length > 0 && <MehrMenu eintraege={eintraege} />}
    </div>
  );
}

/** Kebab-Menü mit den selteneren Aktionen. Gefährliches steht unten und rot. */
export function MehrMenu({ eintraege = [], titel }) {
  const { t } = useLanguage();
  const [offen, setOffen] = useState(false);
  const name = titel || t("common.more");
  if (!eintraege.length) return null;
  // Gefährliches immer ans Ende, egal in welcher Reihenfolge es hereinkommt:
  // so liegt es nie unter dem Finger, der auf den zweiten Eintrag zielt.
  const sortiert = [...eintraege].sort((a, b) => (a.gefahr ? 1 : 0) - (b.gefahr ? 1 : 0));
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button onClick={() => setOffen((o) => !o)} className="icon-btn" title={name} aria-label={name}
        style={{ ...toolbarIconBtn, color: offen ? "var(--accent)" : "var(--text3)" }}>
        <Icon d={ICONS.more} size={17} />
      </button>
      {offen && (
        <>
          <span onClick={() => setOffen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <Popover align="right" style={{ zIndex: 41, top: CONTROL_H + 2, minWidth: 210, padding: 4 }}>
            {sortiert.map((e) => (
              <button key={e.key} onClick={() => { setOffen(false); e.onClick(); }} disabled={e.disabled}
                style={{ ...menuRow, color: e.gefahr ? C.danger : "var(--text)", opacity: e.disabled ? 0.45 : 1 }}>
                {e.icon && <Icon d={e.icon} size={15} color={e.gefahr ? C.danger : undefined} />}
                {e.label}
              </button>
            ))}
          </Popover>
        </>
      )}
    </span>
  );
}
