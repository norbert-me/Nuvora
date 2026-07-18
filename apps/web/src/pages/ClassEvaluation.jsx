import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";

const API = "/api";

function fmt(n) { return n % 1 === 0 ? String(n) : n.toFixed(1); }

function Boxplot({ values }) {
  if (values.length < 3) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const med = sorted[Math.floor(sorted.length / 2)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lo = Math.max(sorted[0], q1 - 1.5 * iqr);
  const hi = Math.min(sorted[sorted.length - 1], q3 + 1.5 * iqr);
  const outliers = sorted.filter((v) => v < lo || v > hi);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ position: "relative", height: 48, margin: "0 20px" }}>
        <div style={{ position: "absolute", top: 22, left: `${lo}%`, width: `${hi - lo}%`, height: 4, background: "var(--border3)" }} />
        <div style={{ position: "absolute", top: 14, left: `${lo}%`, width: 2, height: 20, background: "var(--text3)" }} />
        <div style={{ position: "absolute", top: 14, left: `${hi}%`, width: 2, height: 20, background: "var(--text3)" }} />
        <div style={{ position: "absolute", top: 8, left: `${q1}%`, width: `${q3 - q1}%`, height: 32, background: "rgba(10,132,255,0.15)", border: "2px solid var(--accent)", borderRadius: 6 }} />
        <div style={{ position: "absolute", top: 6, left: `${med}%`, width: 3, height: 36, background: "var(--accent)", borderRadius: 2 }} />
        {outliers.map((v, i) => (
          <div key={i} style={{ position: "absolute", top: 19, left: `${v}%`, width: 10, height: 10, borderRadius: 5, background: "#d1350f", transform: "translateX(-5px)" }} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", margin: "4px 20px 0", fontSize: 11, color: "var(--text3)" }}>
        <span>Min: {fmt(sorted[0])}%</span>
        <span>Q1: {fmt(q1)}%</span>
        <span>Med: {fmt(med)}%</span>
        <span>Q3: {fmt(q3)}%</span>
        <span>Max: {fmt(sorted[sorted.length - 1])}%</span>
      </div>
    </div>
  );
}

export default function ClassEvaluation() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [chartView, setChartView] = useState("none");

  useEffect(() => {
    const timer = setTimeout(() => { if (!data) setLoadError(true); }, 15000);
    fetch(`${API}/classes/${id}/evaluation`)
      .then(async (r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d) => { setData(d); clearTimeout(timer); })
      .catch(() => setLoadError(true));
    return () => clearTimeout(timer);
  }, [id]);

  if (loadError && !data) return <p style={{ color: "#d1350f", padding: 20 }}>Auswertung konnte nicht geladen werden.</p>;
  if (!data) return <div style={{ minHeight: "70vh" }} />;
  // Fehler-Payload (z. B. {detail: …}) statt Auswertung: nicht am fehlenden
  // Feld abstürzen, sondern melden.
  if (!Array.isArray(data.tests)) return <p style={{ color: "#d1350f", padding: 20 }}>Auswertung konnte nicht geladen werden.</p>;

  const { class_name, students, tests } = data;

  if (tests.length === 0) {
    return (
      <div>
        <Link to="/cardvote/tests" style={backLink}>← Alle Tests</Link>
        <h2 style={{ marginTop: 12, fontSize: 22, fontWeight: 700, color: "var(--text)" }}>Klasse {class_name}</h2>
        <p style={{ color: "var(--text3)" }}>Noch keine Tests für diese Klasse.</p>
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

  const sorted = [...studentRows].sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));

  const testAverages = tests.map((test, ti) => {
    let sum = 0;
    let count = 0;
    for (const s of studentRows) {
      if (s.perTest[ti].present) {
        sum += s.perTest[ti].score;
        count++;
      }
    }
    return count > 0 ? (sum / count).toFixed(1) : "–";
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
      <Link to="/cardvote/tests" style={backLink}>← Alle Tests</Link>
      <h2 style={{ marginTop: 12, marginBottom: 20, fontSize: 24, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.3px" }}>
        {class_name} <span style={{ fontWeight: 400, color: "var(--text3)", fontSize: 18 }}>— Gesamtauswertung</span>
      </h2>

      {/* Stat tiles */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <Stat label="Lernende" value={students.length} />
        <Stat label="Tests" value={tests.length} />
        <Stat label="Ø Gesamt" value={`${classAvgPct}%`} />
        {med != null && <Stat label="Median" value={`${med}%`} />}
        {best != null && <Stat label="Beste/r" value={`${best}%`} />}
        {worst != null && <Stat label="Schwächste/r" value={`${worst}%`} />}
        {sd > 0 && <Stat label="Std.abw." value={`${sd.toFixed(1)}%`} />}
      </div>

      {/* Boxplot toggle */}
      {pctValues.length >= 3 && (
        <div style={{ padding: 0, background: "var(--bg3)", borderRadius: 14, border: "1px solid var(--border)", marginBottom: 16, overflow: "hidden" }}>
          <div style={{ display: "flex", gap: 8, padding: "12px 16px 0" }}>
            <button
              onClick={() => setChartView(chartView === "box" ? "none" : "box")}
              style={{
                fontSize: 13, fontWeight: 600, padding: "5px 12px", borderRadius: 980, border: "none", cursor: "pointer",
                background: chartView === "box" ? "var(--accent)" : "var(--bg2)",
                color: chartView === "box" ? "#fff" : "var(--text3)",
                transition: "all 0.2s",
              }}
            >Boxplot</button>
          </div>
          {chartView === "box" && <Boxplot values={pctValues} />}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 14, whiteSpace: "nowrap", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>Name</th>
              {tests.map((t, i) => {
                const label = t.set_name || t.name || `Test ${i + 1}`;
                return (
                  <th
                    key={t.session_id}
                    style={{ ...th, textAlign: "center", fontSize: 12, padding: "8px 6px", maxWidth: 80 }}
                  >
                    <Link
                      to={`/cardvote/evaluation/${t.session_id}`}
                      style={{ color: "var(--accent)", textDecoration: "none", whiteSpace: "normal", wordBreak: "break-word", display: "block", lineHeight: 1.3 }}
                      title={`${t.name} (${label})`}
                    >
                      {label.length > 20 ? label.slice(0, 18) + "…" : label}
                    </Link>
                  </th>
                );
              })}
              <th style={{ ...th, background: "var(--bg2)" }}>Gesamt</th>
              <th style={{ ...th, background: "var(--bg2)" }}>%</th>
            </tr>
            <tr style={{ background: "var(--bg2)" }}>
              <td style={{ ...td, fontWeight: 600, color: "var(--text3)", fontSize: 12 }}>Max</td>
              {tests.map((t) => (
                <td key={t.session_id} style={{ ...td, textAlign: "center", color: "var(--text3)", fontSize: 12 }}>
                  {t.max_score}
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
  if (pct >= 80) return { background: "var(--success-bg)", color: "#0a7d3e" };
  if (pct >= 50) return { background: "var(--warn-bg)", color: "#b8860b" };
  return { background: "var(--danger-bg)", color: "#d1350f" };
}

function pctStyle(pct) {
  if (pct == null) return { color: "#ccc", background: "var(--bg2)" };
  if (pct >= 80) return { background: "var(--success-bg)", color: "#0a7d3e" };
  if (pct >= 50) return { background: "var(--warn-bg)", color: "#b8860b" };
  return { background: "var(--danger-bg)", color: "#d1350f" };
}

const backLink = { color: "var(--text3)", textDecoration: "none", fontSize: 13, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 0", transition: "color 0.15s" };
const th = { padding: "8px 10px", borderBottom: "2px solid var(--border3)", textAlign: "left", fontSize: 13, color: "var(--text)" };
const td = { padding: "8px 10px", borderBottom: "1px solid var(--border)" };

function Stat({ label, value }) {
  return (
    <div style={{ padding: "10px 16px", background: "var(--bg2)", borderRadius: 12, textAlign: "center", minWidth: 80 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--text3)" }}>{label}</div>
    </div>
  );
}
