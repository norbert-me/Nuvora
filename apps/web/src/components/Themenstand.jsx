// Themenstand: wie sicher sitzt ein Unterthema — und wird es besser?
//
// Die Frage kommt aus dem Unterricht: „Ich schreibe eine Arbeit über mehrere
// Unterthemen, also müsste ich sehen können, wie gut ein Kind jedes davon
// kann." Gerechnet wird das im Server (app/themenprofil.py, mit Test); hier
// steht nur die Anzeige.
//
// Bewusst KEINE Note als Hauptzahl: der Notenschlüssel gilt für eine ganze
// Arbeit, nicht für drei Aufgaben daraus. Die Note steht klein daneben, als
// Orientierung — die Zeugnisnote bleibt eine pädagogische Entscheidung.
import { useEffect, useState } from "react";
import { COLORS as C, Icon, ICONS, selectStyle, cardStyle, CONTROL_R } from "./Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { hol } from "../core/melden.js";
import { komma } from "../core/zahl.js";

// Reine Grafik, kein Bedienelement: der Fortschrittsbalken bekommt seine
// Rundung aus der halben Hoehe, damit die Kappen rund sind. Deshalb hier eine
// Zahl statt CONTROL_R — der Balken soll keine Knopf-Ecken haben.
const BALKEN_H = 8;

const farbe = (pct) => (pct == null ? "var(--text3)" : pct < 50 ? C.danger : pct < 75 ? C.warning : C.success);

// Texte, die es noch in keinem Wörterbuch gibt: die i18n-Dateien werden
// gesammelt nachgezogen (die Schlüssel liegen mit allen drei Sprachen in
// /tmp/nuvora-themenstand.md). `tt` nimmt die Übersetzung, sobald sie da ist,
// und zeigt bis dahin den deutschen Satz — nie den nackten Schlüssel, genau
// der Fehler, gegen den i18n/keys.test.js geschrieben wurde.
const NEU = {
  "themen.due": "{{n}} fällig",
  "themen.cards": "Karten",
  "themen.exams": "Arbeiten",
  "themen.quizzes": "Quizze",
  "themen.from": "aus {{q}}",
  "themen.cardsDetail": "{{treffer}} von {{versuche}} Kartenversuchen ({{k}} Karten)",
  "themen.tooThinCards": "erst {{k}} geübte Karten — zu wenig für eine Aussage",
  "themen.hintCards": "Karteikarten zählen mit: ein Kartenversuch ist ein Punkt, Treffer sind die richtig erinnerten. Karten haben kein Datum und stehen deshalb nicht im Verlauf.",
};

function tt(t, key, vars) {
  const s = t(key, vars);
  if (s !== key) return s;
  let f = NEU[key] || key;
  for (const [k, v] of Object.entries(vars || {})) f = f.split(`{{${k}}}`).join(v);
  return f;
}

// Woraus die Zahl entstand — die Anzeige nennt immer ihre Herkunft.
const QUELLE_KEY = { arbeit: "themen.exams", quiz: "themen.quizzes", karten: "themen.cards" };
const quellenText = (t, quellen) =>
  (quellen || []).map((q) => tt(t, QUELLE_KEY[q] || q)).join(" · ");

function TrendPfeil({ trend, t }) {
  if (!trend) return <span style={{ fontSize: 11, color: "var(--text3)" }}>{t("themen.noTrend")}</span>;
  if (trend.richtung === "gleich") {
    return <span style={{ fontSize: 11, color: "var(--text3)" }}>{t("themen.trendFlat")}</span>;
  }
  const auf = trend.richtung === "auf";
  return (
    <span title={t(auf ? "themen.trendUpHint" : "themen.trendDownHint", { v: Math.abs(trend.delta) })}
      style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 700, color: auf ? C.success : C.danger }}>
      <Icon d={ICONS.open} size={11} color={auf ? C.success : C.danger}
        style={{ transform: auf ? "rotate(-90deg)" : "rotate(90deg)" }} />
      {trend.delta > 0 ? "+" : ""}{Math.round(trend.delta)} Pp
    </span>
  );
}

/** Ein Kind: seine Themen mit Stand, Trend und Verlauf. */
export function ThemenstandKind({ kind, t, offenDefault = false }) {
  const [offen, setOffen] = useState(offenDefault ? kind.themen[0]?.topic_id ?? null : null);
  if (!kind.themen.length) return <div style={{ fontSize: 13, color: "var(--text3)" }}>{t("themen.none")}</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {kind.themen.map((th) => {
        const auf = offen === th.topic_id;
        return (
          <div key={th.topic_id} style={{ border: "1px solid var(--border2)", borderRadius: CONTROL_R, padding: "8px 12px" }}>
            <div onClick={() => setOffen(auf ? null : th.topic_id)} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", cursor: "pointer" }}>
              <span style={{ flex: 1, minWidth: 140, fontSize: 13, fontWeight: 600 }}>{th.name || `#${th.topic_id}`}</span>
              {th.genug ? (<>
                <span style={{ width: 110, height: BALKEN_H, background: "var(--bg2)", borderRadius: BALKEN_H / 2, overflow: "hidden", flexShrink: 0 }}>
                  <span style={{ display: "block", width: `${th.pct}%`, height: "100%", background: farbe(th.pct) }} />
                </span>
                <span style={{ fontSize: 13, fontWeight: 800, color: farbe(th.pct), minWidth: 44, textAlign: "right" }}>{Math.round(th.pct)}%</span>
                {/* Note klein und beschriftet: sie ist eine Orientierung, keine Zensur. */}
                {th.note != null && (
                  <span title={t("themen.gradeHint")} style={{ fontSize: 11, color: "var(--text3)", minWidth: 62, textAlign: "right" }}>
                    {t("themen.gradeShort")} {komma(th.note)}
                  </span>
                )}
                <TrendPfeil trend={th.trend} t={t} />
              </>) : (
                <span style={{ fontSize: 11, color: "var(--text3)" }}>
                  {/* Ein Thema, das es nur in den Karten gibt, hat keine
                      Punkte — dann sagt der Hinweis, woran es liegt. */}
                  {th.karten && !th.max
                    ? tt(t, "themen.tooThinCards", { k: th.karten.karten })
                    : t("themen.tooThin", { p: komma(th.max) })}
                </span>
              )}
              {/* Fällige Karten: eine Zählung, keine Bewertung — deshalb steht
                  sie auch dann da, wenn es für eine Zahl noch nicht reicht. */}
              {th.faellig > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, color: C.warning, whiteSpace: "nowrap" }}>
                  {tt(t, "themen.due", { n: th.faellig })}
                </span>
              )}
            </div>

            {auf && (
              <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                {th.verlauf.map((v, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <span style={{ color: "var(--text3)", width: 62, flexShrink: 0 }}>{(v.datum || "").slice(0, 10).split("-").reverse().slice(0, 2).join(".")}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name}</span>
                    <span style={{ fontSize: 11, color: "var(--text3)" }}>{v.art === "quiz" ? t("themen.quiz") : t("themen.exam")}</span>
                    <span style={{ color: "var(--text3)" }}>{komma(v.punkte)}/{komma(v.max)}</span>
                    <span style={{ fontWeight: 700, minWidth: 42, textAlign: "right", color: farbe(v.pct) }}>{v.pct == null ? "–" : `${Math.round(v.pct)}%`}</span>
                  </div>
                ))}
                {/* Karten stehen unter dem Verlauf, nicht darin: sie sind ein
                    aufgelaufener Stand ohne Datum. */}
                {th.karten && th.karten.versuche > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <span style={{ color: "var(--text3)", width: 62, flexShrink: 0 }}>{tt(t, "themen.cards")}</span>
                    <span style={{ flex: 1, minWidth: 0, color: "var(--text3)" }}>
                      {tt(t, "themen.cardsDetail", {
                        treffer: th.karten.treffer, versuche: th.karten.versuche, k: th.karten.karten,
                      })}
                    </span>
                  </div>
                )}
                {th.quellen?.length > 0 && (
                  <div style={{ fontSize: 11, color: "var(--text3)" }}>
                    {tt(t, "themen.from", { q: quellenText(t, th.quellen) })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Panel für eine Klasse: Kind wählen, Themen sehen. */
export default function Themenstand({ classId, studentId = null, cardId = null, titel = true }) {
  const { t } = useLanguage();
  const [daten, setDaten] = useState(null);
  const [wahl, setWahl] = useState(studentId);

  useEffect(() => {
    if (!classId) return;
    let ab = false;
    // Die CardVote-Schuelerseite kennt nur die aufgedruckte Kartennummer, die
    // Klassenarbeit die Datenbank-ID — beide Wege muessen gehen.
    const q = studentId != null ? `?student_id=${studentId}` : "";
    hol(`/api/classes/${classId}/themenprofil${q}`, null)
      .then((d) => {
        if (ab) return;
        setDaten(d);
        const treffer = cardId != null
          ? (d?.schueler || []).find((k) => String(k.card_id) === String(cardId))
          : null;
        setWahl((alt) => treffer?.student_id ?? alt ?? d?.schueler?.[0]?.student_id ?? null);
      });
    return () => { ab = true; };
  }, [classId, studentId, cardId]);

  if (!daten) return null;
  const kinder = daten.schueler || [];
  const kind = kinder.find((k) => k.student_id === wahl) || kinder[0];
  // Nichts gemessen (keine themen-getaggten Aufgaben): dann gar nicht anzeigen,
  // statt eine leere Karte in die Seite zu stellen.
  if (!kind || !kinder.some((k) => k.themen.length)) return null;

  return (
    <div style={{ ...cardStyle, marginBottom: 16 }}>
      {titel && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 700, flex: 1 }}>{t("themen.title")}</div>
          {studentId == null && cardId == null && kinder.length > 1 && (
            <select value={wahl || ""} onChange={(e) => setWahl(Number(e.target.value))} style={{ ...selectStyle, fontSize: 13 }}>
              {kinder.map((k) => <option key={k.student_id} value={k.student_id}>{k.name}</option>)}
            </select>
          )}
        </div>
      )}
      <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 12, lineHeight: 1.5 }}>
        {t("themen.hint")}
        {/* Nur wenn die Karten wirklich mitgerechnet haben (Regel 3: der Server
            liefert die Quelle nur bei aktivem Modul). */}
        {(daten.quellen || []).includes("karten") && ` ${tt(t, "themen.hintCards")}`}
      </div>
      <ThemenstandKind kind={kind} t={t} />
    </div>
  );
}
