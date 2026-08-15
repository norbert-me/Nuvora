import { useState, useEffect } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { LoadError, COLORS as C, Boxplot, pageApp, th as thBasis, td as tdBasis, Icon, ICONS, chipStyle, panelStyle, Toggle, StatCard } from "../components/Icons.jsx";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import FruehwarnPanel from "../components/Fruehwarnung.jsx";
import { useLanguage } from "../i18n/index.jsx";

const API = "/api";

function fmt(n) { return n % 1 === 0 ? String(n) : n.toFixed(1); }
// Boxplot zentral aus Icons.jsx (eine Quelle, mit Markierungen + Ausreißern).

export default function ClassEvaluation() {
  const { t } = useLanguage();
  const { id } = useParams();
  // ?fw=<card_id> kommt von der Startseite: dort steht der Name, hier die
  // Begruendung im Zusammenhang der Klasse.
  const [suche] = useSearchParams();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [chartView, setChartView] = useState("none");

  const load = () => {
    setLoadError(false);
    fetch(`${API}/classes/${id}/evaluation`)
      .then(async (r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d) => setData(d))
      .catch(() => setLoadError(true));
  };
  useEffect(() => { load(); }, [id]); // eslint-disable-line

  if (loadError && !data) return <div style={{ padding: 20 }}><LoadError message={t("cv.loadFailed")} onRetry={load} /></div>;
  if (!data) return <div style={{ minHeight: "70vh" }} />;
  // Fehler-Payload (z. B. {detail: …}) statt Auswertung: nicht am fehlenden
  // Feld abstürzen, sondern melden.
  if (!Array.isArray(data.tests)) return <div style={{ padding: 20 }}><LoadError message={t("cv.loadFailed")} onRetry={load} /></div>;

  const { class_name, students, tests } = data;

  if (tests.length === 0) {
    return (
      <div style={{ ...pageApp }}>
        <Link to="/cardvote/tests" style={backLink}><Icon d={ICONS.arrowLeft} size={14} /> {t("cv.backAllTests")}</Link>
        <h2 style={{ marginTop: 12, fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{t("cv.classPrefix")} {class_name}</h2>
        <p style={{ color: "var(--text3)" }}>{t("cv.noTestsForClass")}</p>
      </div>
    );
  }

  const totalMaxScore = tests.reduce((sum, t) => sum + t.max_score, 0);

  const studentRows = students.map((student) => {
    let totalScore = 0;
    let totalPossible = 0;
    let testsPresent = 0;

    const perTest = tests.map((test) => {
      const s = test.student_scores[student.card_id];
      if (!s || !s.present) return { score: null, total: test.max_score, present: false };
      totalScore += s.score;
      totalPossible += s.total;
      testsPresent++;
      return { score: s.score, total: s.total, present: true };
    });

    return {
      ...student,
      perTest,
      totalScore,
      totalPossible,
      testsPresent,
      pct: totalPossible > 0 ? Math.round((totalScore / totalPossible) * 100) : null,
    };
  });

  // Kein gemeinsames Ranking über beide Kursniveaus — die Maßstäbe sind
  // verschieden. Gibt es Niveaus, wird zuerst nach Niveau gruppiert.
  const hatNiveaus = students.some((s) => s.niveau);
  const sorted = [...studentRows].sort((a, b) => {
    if (hatNiveaus && (a.niveau || "") !== (b.niveau || "")) return (a.niveau || "").localeCompare(b.niveau || "");
    return (b.pct ?? -1) - (a.pct ?? -1);
  });

  const testAverages = tests.map((test, ti) => {
    let sum = 0;
    let count = 0;
    for (const s of studentRows) {
      if (s.perTest[ti].present) {
        sum += s.perTest[ti].score;
        count++;
      }
    }
    // fmt: glatte Werte ohne „,0" anzeigen (4 statt 4.0), sonst eine Nachkommastelle.
    return count > 0 ? fmt(sum / count) : "–";
  });

  const presentStudents = sorted.filter((s) => s.testsPresent > 0);
  const classAvgPct = presentStudents.length > 0
    ? Math.round(presentStudents.reduce((sum, s) => sum + s.pct, 0) / presentStudents.length)
    : 0;

  const pctValues = presentStudents.map((s) => s.pct).filter((p) => p != null).sort((a, b) => a - b);
  const med = pctValues.length > 0 ? pctValues[Math.floor(pctValues.length / 2)] : null;
  const best = pctValues.length > 0 ? pctValues[pctValues.length - 1] : null;
  const worst = pctValues.length > 0 ? pctValues[0] : null;
  const mean = pctValues.length > 0 ? pctValues.reduce((a, b) => a + b, 0) / pctValues.length : 0;
  const sd = pctValues.length > 1 ? Math.sqrt(pctValues.reduce((s, x) => s + (x - mean) ** 2, 0) / (pctValues.length - 1)) : 0;

  return (
    <div>
      <Link to="/cardvote/tests" style={backLink}><Icon d={ICONS.arrowLeft} size={14} /> {t("cv.backAllTests")}</Link>
      <h2 style={{ marginTop: 12, marginBottom: 24, fontSize: 22, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.3px" }}>
        {class_name} <span style={{ fontWeight: 400, color: "var(--text3)", fontSize: 16 }}>— {t("cv.overallEval")}</span>
      </h2>

      {/* Frühwarnung: wer hängt über mehrere Tests hinweg hinterher? Steht VOR
          den Kennzahlen — eine Durchschnittsquote sagt nichts über einzelne
          Kinder, und genau danach wird hier gesucht. */}
      <FruehwarnPanel classId={id} nurKind={suche.get("fw")} />

      {/* Stat tiles */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <StatCard label={t("cv.statTests")} value={tests.length} />
        <StatCard label={t("cv.statAvgTotal")} value={`${classAvgPct}%`} />
        {med != null && <StatCard label={t("cv.statMedian")} value={`${med}%`} />}
        {best != null && <StatCard label={t("cv.statBest")} value={`${best}%`} />}
        {worst != null && <StatCard label={t("cv.statWorst")} value={`${worst}%`} />}
        {sd > 0 && <StatCard label={t("cv.statSd")} value={`${sd.toFixed(1)}%`} />}
      </div>

      {/* Boxplot toggle */}
      {pctValues.length >= 3 && (
        <div style={{ ...panelStyle, padding: 0, marginBottom: 16, overflow: "hidden" }}>
          {/* Ein Zwei-Zustands-Umschalter, also der Schalter aus dem Kern —
              vorher ein Knopf, der seinen Zustand nur ueber die Farbe zeigte.
              (`Tabs` braeuchte ein zweites Etikett „Aus"; das Wort gibt es im
              Woerterbuch nicht.) */}
          <Werkzeugleiste
            style={{ padding: "12px 16px 0", marginBottom: 0 }}
            links={
              <Toggle
                checked={chartView === "box"}
                onChange={(an) => setChartView(an ? "box" : "none")}
                label={t("cv.boxplot")}
              />
            }
          />
          {chartView === "box" && <Boxplot values={pctValues} max={100} unit="%" />}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 14, whiteSpace: "nowrap", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>{t("cv.thName")}</th>
              {tests.map((test, i) => {
                const label = test.set_name || test.name || t("cv.testN", { n: i + 1 });
                return (
                  <th
                    key={test.session_id}
                    style={{ ...th, textAlign: "center", fontSize: 12, padding: "8px 6px", maxWidth: 80 }}
                  >
                    <Link
                      to={`/cardvote/evaluation/${test.session_id}`}
                      style={{ color: "var(--accent)", textDecoration: "none", whiteSpace: "normal", wordBreak: "break-word", display: "block", lineHeight: 1.3 }}
                      title={`${test.name} (${label})`}
                    >
                      {label.length > 20 ? label.slice(0, 18) + "…" : label}
                    </Link>
                  </th>
                );
              })}
              <th style={{ ...th, background: "var(--bg2)" }}>{t("cv.thTotal")}</th>
              <th style={{ ...th, background: "var(--bg2)" }}>%</th>
            </tr>
            <tr style={{ background: "var(--bg2)" }}>
              <td style={{ ...td, fontWeight: 600, color: "var(--text3)", fontSize: 12 }}>{t("cv.rowMax")}</td>
              {tests.map((test) => (
                <td key={test.session_id} style={{ ...td, textAlign: "center", color: "var(--text3)", fontSize: 12 }}>
                  {test.max_score}
                </td>
              ))}
              <td style={{ ...td, textAlign: "center", color: "var(--text3)", fontSize: 12 }}>{totalMaxScore}</td>
              <td style={td}></td>
            </tr>
          </thead>
          <tbody>
            {sorted.map((student) => (
              <tr key={student.card_id} style={student.testsPresent === 0 ? { opacity: 0.4 } : {}}>
                <td style={{ ...td, fontWeight: 600, position: "sticky", left: 0, background: "var(--card)", zIndex: 1 }}>
                  {student.testsPresent > 0 ? (
                    <Link
                      to={`/cardvote/student-evaluation/${id}/${student.card_id}`}
                      style={{ color: "var(--accent)", textDecoration: "none" }}
                    >
                      {student.name}
                    </Link>
                  ) : student.name}
                  {/* Kursniveau steht immer neben dem Ergebnis. */}
                  {student.niveau && (
                    <span style={{ ...chipStyle, marginLeft: 8 }}>{student.niveau}</span>
                  )}
                </td>
                {student.perTest.map((pt, i) => (
                  <td
                    key={tests[i].session_id}
                    style={{
                      ...td,
                      textAlign: "center",
                      fontWeight: 600,
                      ...cellStyle(pt),
                    }}
                  >
                    {pt.present ? `${pt.score}` : "–"}
                  </td>
                ))}
                <td style={{ ...td, textAlign: "center", fontWeight: 600, background: "var(--bg2)" }}>
                  {student.testsPresent > 0 ? `${student.totalScore} / ${student.totalPossible}` : "–"}
                </td>
                <td style={{
                  ...td,
                  textAlign: "center",
                  fontWeight: 700,
                  ...pctStyle(student.pct),
                }}>
                  {student.pct != null ? `${student.pct}%` : "–"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--border3)" }}>
              <td style={{ ...td, fontWeight: 600, color: "var(--text3)", fontSize: 12 }}>Ø</td>
              {testAverages.map((avg, i) => (
                <td key={i} style={{ ...td, textAlign: "center", fontSize: 12, fontWeight: 600, color: "var(--text2)" }}>
                  {avg}
                </td>
              ))}
              <td style={td}></td>
              <td style={{ ...td, textAlign: "center", fontWeight: 700, color: "var(--text2)", fontSize: 12 }}>
                {classAvgPct}%
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function cellStyle(pt) {
  if (!pt.present) return { color: "var(--border2)" };
  const pct = pt.total > 0 ? (pt.score / pt.total) * 100 : 0;
  if (pct >= 80) return { background: "var(--success-bg)", color: C.success };
  if (pct >= 50) return { background: "var(--warn-bg)", color: C.warning };
  return { background: "var(--danger-bg)", color: C.danger };
}

function pctStyle(pct) {
  if (pct == null) return { color: "var(--text3)", background: "var(--bg2)" };
  if (pct >= 80) return { background: "var(--success-bg)", color: C.success };
  if (pct >= 50) return { background: "var(--warn-bg)", color: C.warning };
  return { background: "var(--danger-bg)", color: C.danger };
}

const backLink = { color: "var(--text3)", textDecoration: "none", fontSize: 13, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 0", transition: "color 0.15s" };
// Aus dem Kern abgeleitet, gleiche Abweichung wie in der Auswertung.
const th = { ...thBasis, padding: "8px 10px", borderBottom: "2px solid var(--border3)", textAlign: "left", fontSize: 13, color: "var(--text)" };
const td = { ...tdBasis, padding: "8px 10px", textAlign: "left" };
// Kachel kommt aus Icons.jsx (StatCard) — die lokale Kopie war eine zweite
// Design-Quelle fuer dieselbe Sache.
