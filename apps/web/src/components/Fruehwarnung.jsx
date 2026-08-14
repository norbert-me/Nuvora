// Frühwarnung, sichtbar gemacht — eine Quelle für Klassen- und Schüleransicht.
//
// Die Regel selbst steht im Server (app/fruehwarnung.py) und wird dort auch
// getestet; hier wird nur angezeigt, was sie geliefert hat — samt der Zahlen,
// aus denen sie entstanden ist. Eine Ampel ohne Begründung wäre ein Orakel.
import { useEffect, useState } from "react";
import { COLORS as C, badge } from "./Icons.jsx";
import { useEmpfindlich } from "../core/fruehwarnung.js";
import { useLanguage } from "../i18n/index.jsx";

/**
 * Abstand zur Klasse je Test, als kleine Balkenreihe um eine Nulllinie.
 *
 * Bewusst divergierend statt einer Linie: der Wert hat einen Nullpunkt mit
 * Bedeutung („genau wie die Klasse"), und die Richtung ist die Aussage. Balken
 * nach unten = unter der Klasse. Eine Linie ohne Nullbezug laedt dazu ein, die
 * Steigung zu lesen, wo die Lage gemeint ist.
 *
 * Farbe traegt hier einen Zustand, keine Serie: darum die Status-Farben aus
 * Icons.jsx und keine eigene Palette. Jeder Balken hat einen <title>, damit die
 * Zahl auch ohne Beschriftung erreichbar ist.
 */
export function AbstandSpark({ kurve, hoehe = 34, breite = 132 }) {
  const punkte = (kurve || []).filter((p) => p.abstand !== null && p.abstand !== undefined);
  if (punkte.length === 0) return null;
  const max = Math.max(20, ...punkte.map((p) => Math.abs(p.abstand)));
  const n = (kurve || []).length;
  const spalte = breite / n;
  const balken = Math.max(3, spalte - 2);      // 2 px Luft zwischen den Balken
  const mitte = hoehe / 2;

  return (
    <svg width={breite} height={hoehe} role="img" style={{ display: "block", overflow: "visible" }}>
      <line x1="0" y1={mitte} x2={breite} y2={mitte} stroke="var(--border2)" strokeWidth="2" />
      {(kurve || []).map((p, i) => {
        const x = i * spalte + (spalte - balken) / 2;
        if (p.abstand === null || p.abstand === undefined) {
          // Nicht dabei gewesen: ein Punkt auf der Nulllinie, keine Luecke, die
          // wie „genau im Mittel" aussieht.
          return <circle key={i} cx={x + balken / 2} cy={mitte} r="2" fill="var(--text3)">
            <title>{p.name}: keine Abgabe</title>
          </circle>;
        }
        const h = Math.max(2, (Math.abs(p.abstand) / max) * (mitte - 2));
        const unten = p.abstand < 0;
        // Eine Klassenarbeit ist derselbe Messpunkt wie ein Quiz, aber sie wiegt
        // schwerer — das soll man sehen, ohne den Tooltip zu oeffnen: dunklerer
        // Rand statt einer zweiten Farbe (die Farbe traegt hier die Richtung).
        const arbeit = p.art === "arbeit";
        return (
          <rect key={i} x={x} y={unten ? mitte : mitte - h} width={balken} height={h} rx="2"
            fill={unten ? C.danger : C.success} opacity={Math.abs(p.abstand) < 5 ? 0.45 : 0.9}
            stroke={arbeit ? "var(--text)" : "none"} strokeWidth={arbeit ? 1 : 0}>
            <title>{`${arbeit ? "Klassenarbeit" : "Quiz"} · ${p.name}: ${p.abstand > 0 ? "+" : ""}${p.abstand} Pp (${p.pct} % gegen ${p.klasse} %)`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

function StatusChip({ status, t }) {
  if (status === "melden") return <span style={badge(C.warning)}>{t("fw.watch")}</span>;
  if (status === "zu_wenig_daten") return <span style={{ fontSize: 12, color: "var(--text3)" }}>{t("fw.tooFew")}</span>;
  return <span style={{ fontSize: 12, color: "var(--text3)" }}>{t("fw.ok")}</span>;
}

/** Ein Kind: Kurve, Begründung, Etiketten, Themen. */
export function FruehwarnKarte({ schueler, t, offen = false }) {
  const [auf, setAuf] = useState(offen);
  const s = schueler;
  return (
    <div style={{ border: "1px solid var(--border2)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", cursor: "pointer" }}
        onClick={() => setAuf((v) => !v)}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>{s.name}</span>
        <StatusChip status={s.status} t={t} />
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 10 }}>
          {s.abstand_median !== null && (
            <span style={{ fontSize: 13, fontWeight: 700, color: s.abstand_median < 0 ? C.danger : "var(--text2)" }}>
              {s.abstand_median > 0 ? "+" : ""}{Math.round(s.abstand_median)} Pp
            </span>
          )}
          <AbstandSpark kurve={s.kurve} />
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text2)", marginTop: 4, lineHeight: 1.45 }}>{s.begruendung}</div>

      {auf && (
        <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
          {s.etiketten?.length > 0 && (
            <ul style={{ margin: "0 0 10px", paddingLeft: 18, fontSize: 12.5, color: "var(--text2)", lineHeight: 1.6 }}>
              {s.etiketten.map((e, i) => <li key={i}>{e.text}</li>)}
            </ul>
          )}
          {s.themen?.length > 0 && (
            <>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>
                {t("fw.byTopic")}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {s.themen.map((th) => (
                  <div key={th.topic_id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                    <span style={{ flex: 1, color: "var(--text)" }}>{th.name || `#${th.topic_id}`}</span>
                    <span style={{ fontSize: 11, color: "var(--text3)" }}>
                      {th.altbestand ? t("fw.old") : t("fw.fresh")}
                    </span>
                    <span style={{ color: "var(--text3)" }}>{th.pct} % / {th.klasse} %</span>
                    <span style={{ fontWeight: 700, minWidth: 52, textAlign: "right", color: th.abstand < 0 ? C.danger : C.success }}>
                      {th.abstand > 0 ? "+" : ""}{th.abstand} Pp
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Panel für eine Klasse. `nurKind` (card_id) zeigt nur dieses Kind — so nutzt
 * die Schüleransicht dieselbe Auswertung, ohne sie ein zweites Mal zu bauen.
 */
export default function FruehwarnPanel({ classId, nurKind = null, titel = true }) {
  const { t } = useLanguage();
  const [empfindlich, setEmpfindlich] = useEmpfindlich();
  const [daten, setDaten] = useState(null);

  useEffect(() => {
    if (!classId) return;
    let ab = false;
    fetch(`/api/classes/${classId}/fruehwarnung?empfindlich=${empfindlich ? "true" : "false"}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!ab) setDaten(d); })
      .catch(() => {});
    return () => { ab = true; };
  }, [classId, empfindlich]);

  if (!daten) return null;

  // Warum ist nichts zu sehen? Der Server liefert die Datenlage mit, damit hier
  // ein brauchbarer Satz steht statt „nichts gefunden". Der häufigste Fall:
  // Klassenarbeiten sind da, aber ihre Aufgaben tragen kein Thema — dann kann
  // die Auswertung nichts zuordnen, und genau das gehört gesagt.
  const q = daten.quellen || {};
  const erhebungen = (daten.tests || []).length;
  const grund = () => {
    if (q.arbeiten > 0 && q.arbeiten_ohne_thema === q.arbeiten && !q.quizze) return t("fw.needTopics", { n: q.arbeiten });
    if (!q.cardvote && !q.auswertung) return t("fw.needModule");
    if (!q.quizze && !q.arbeiten) return t("fw.noData");
    if (q.arbeiten_ohne_thema > 0) return t("fw.someWithoutTopics", { n: q.arbeiten_ohne_thema });
    return t("fw.noData");
  };

  const alle = daten.schueler || [];
  const liste = nurKind != null ? alle.filter((s) => String(s.card_id) === String(nurKind)) : alle;
  // In der Klassenansicht nur die Auffaelligen zeigen — sonst steht die halbe
  // Klasse in einer Liste, die „genau hinschauen" heisst.
  const zeigen = nurKind != null ? liste : liste.filter((s) => s.status === "melden");

  if (nurKind != null && zeigen.length === 0) return null;

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)", padding: 16, marginBottom: 16 }}>
      {titel && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>
            {t("fw.title")}{nurKind == null && zeigen.length > 0 ? ` (${zeigen.length})` : ""}
          </div>
          <button onClick={() => setEmpfindlich(!empfindlich)}
            style={{ fontSize: 12, padding: "3px 10px", borderRadius: 980, cursor: "pointer",
              border: `1px solid ${empfindlich ? "var(--accent)" : "var(--border2)"}`,
              background: "var(--card)", color: empfindlich ? "var(--accent)" : "var(--text3)" }}
            title={t("fw.sensitiveHint")}>
            {t("fw.sensitive")}
          </button>
        </div>
      )}
      {erhebungen === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text3)" }}>{grund()}</div>
      ) : alle.every((s) => s.status === "zu_wenig_daten") ? (
        // Nicht „niemand fällt ab": bei einer einzigen Arbeit weiss das niemand.
        <div style={{ fontSize: 13, color: "var(--text3)" }}>{t("fw.tooEarly", { n: erhebungen })}</div>
      ) : zeigen.length === 0 ? (
        <div style={{ fontSize: 13.5, color: "var(--text2)" }}>
          {t("fw.none")}{" "}
          <span style={{ color: "var(--text3)" }}>{t("fw.basedOn", { n: erhebungen })}</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {zeigen.map((s) => <FruehwarnKarte key={s.card_id} schueler={s} t={t} offen={nurKind != null} />)}
        </div>
      )}
      {daten.regel?.abstand && (
        <div style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 10, lineHeight: 1.5 }}>
          {t("fw.rule", { abstand: daten.regel.abstand, von: daten.regel.von, bis: daten.regel.bis, min: daten.regel.mindest_antworten })}
        </div>
      )}
    </div>
  );
}
