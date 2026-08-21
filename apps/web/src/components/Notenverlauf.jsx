// Notenverlauf: die Erhebungen eines Halbjahres in ihrer zeitlichen Folge.
//
// CardVote-Quizze und Klassenarbeiten auf EINER Achse — beide prüfen dieselben
// Kinder auf dieselbe Weise (erreichte von möglichen Punkten), getrennt gezeigt
// wären es zwei Kurven, die niemand zusammenrechnet. Gerechnet wird im Server
// (app/notenverlauf.py); hier steht nur die Anzeige.
//
// Bewusst KEINE Gesamtnote und kein Mittelwert über die Quellen: ein Quiz über
// vier Fragen und eine zweistündige Arbeit sind nicht gleich viel wert, und sie
// ungewichtet zu mitteln wäre eine Zahl, die so tut, als wüsste sie etwas. Was
// fürs Zeugnis folgt, entscheidet das Notenbuch mit seinen Gewichten.
import { useEffect, useState } from "react";

import { COLORS as C, CONTROL_R, Icon, ICONS, panelStyle, sectionLabel } from "./Icons.jsx";
import { hol } from "../core/melden.js";
import { komma } from "../core/zahl.js";
import { useLanguage } from "../i18n/index.jsx";

// Reine Grafik: der Punkt ist ein Kreis, sein Radius die halbe Kante.
const PUNKT = 9;
// Höhe der Kurvenfläche. Prozent von unten (0) nach oben (100).
const HOEHE = 96;

const farbe = (pct) => (pct == null ? "var(--text3)" : pct < 50 ? C.danger : pct < 75 ? C.warning : C.success);

export default function Notenverlauf({ classId, studentId, cardId, titel }) {
  const { t } = useLanguage();
  const [daten, setDaten] = useState(null);

  useEffect(() => {
    if (!classId) return;
    setDaten(null);
    const wer = studentId ? `?student_id=${studentId}` : cardId ? `?card_id=${cardId}` : "";
    hol(`/api/classes/${classId}/notenverlauf${wer}`).then((d) => setDaten(d || null));
  }, [classId, studentId, cardId]);

  if (!daten) return null;
  const zeilen = daten.schueler || [];
  // Ein einzelner Punkt ist kein Verlauf. Statt einer Kurve aus einem Wert
  // lieber nichts — die Zahl selbst steht ohnehin auf der Auswertungsseite.
  const zeigen = zeilen.filter((s) => (s.werte || []).length >= 2);
  if (!zeigen.length) return null;

  return (
    <div style={{ ...panelStyle, padding: 12, marginTop: 16 }}>
      <div style={{ ...sectionLabel, marginBottom: 8 }}>{titel || t("verlauf.titel")}</div>
      <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>{t("verlauf.hinweis")}</div>
      {zeigen.map((s) => (
        <div key={s.student_id} style={{ marginBottom: zeigen.length > 1 ? 16 : 0 }}>
          {zeigen.length > 1 && (
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{s.name}</div>
          )}
          <Kurve werte={s.werte} t={t} />
        </div>
      ))}
    </div>
  );
}

function Kurve({ werte, t }) {
  // Die Punkte liegen gleichmäßig verteilt — nicht auf einer Zeitachse. Der
  // Abstand zwischen zwei Erhebungen sagt nichts über die Leistung, und eine
  // echte Zeitachse drückt bei drei Terminen im September und einem im Februar
  // alles Wichtige in eine Ecke.
  const n = werte.length;
  const x = (i) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (pct) => HOEHE - (Math.max(0, Math.min(100, pct)) / 100) * HOEHE;

  return (
    <div>
      <div style={{ position: "relative", height: HOEHE, marginBottom: 6 }}>
        {/* 50-%-Linie: die Grenze, an der es kippt. Eine Grafik ohne Bezug ist
            eine Zickzacklinie. */}
        <div style={{ position: "absolute", left: 0, right: 0, top: y(50), borderTop: "1px dashed var(--border2)" }} />
        <svg viewBox={`0 0 100 ${HOEHE}`} preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-hidden>
          <polyline fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke"
            points={werte.map((w, i) => `${x(i)},${y(w.pct)}`).join(" ")} />
        </svg>
        {werte.map((w, i) => (
          <span key={`${w.quelle}-${w.id}`}
            title={`${w.name} · ${w.pct}% · ${t("verlauf.note", { n: komma(w.note) })}`}
            style={{
              position: "absolute", left: `${x(i)}%`, top: y(w.pct),
              width: PUNKT, height: PUNKT, borderRadius: PUNKT / 2,
              transform: "translate(-50%, -50%)", background: farbe(w.pct),
              // Die Arbeit bekommt einen Ring: sie wiegt schwerer als ein Quiz,
              // und man soll sie in der Kurve wiederfinden, ohne zu raten.
              boxShadow: w.quelle === "arbeit" ? "0 0 0 3px var(--card)" : "none",
              border: w.quelle === "arbeit" ? "2px solid var(--text)" : "none",
            }} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11, color: "var(--text3)" }}>
        {werte.map((w) => (
          <span key={`${w.quelle}-${w.id}-l`} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
            <Icon d={w.quelle === "arbeit" ? ICONS.edit : ICONS.check} size={11} />
            {w.pct}%
          </span>
        ))}
      </div>
    </div>
  );
}
