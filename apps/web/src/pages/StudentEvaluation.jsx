import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { DownloadLink } from "../components/Icons.jsx";

const API = "/api";

export default function StudentEvaluation() {
  const { classId, cardId } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch(`${API}/classes/${classId}/evaluation`).then((r) => r.json()).then(setData);
  }, [classId]);

  if (!data) return <div style={{ minHeight: "70vh" }} />;

  const { class_name, students, tests } = data;
  const student = students.find((s) => String(s.card_id) === cardId);
  if (!student) return <p style={{ color: "#d1350f" }}>Lernende/r nicht gefunden.</p>;

  const results = tests.map((test) => {
    const s = test.student_scores[student.card_id];
    return {
      session_id: test.session_id,
      name: test.set_name || test.name || "Test",
      date: test.date,
      present: s?.present || false,
      score: s?.score || 0,
      total: s?.total || test.max_score,
      pct: s?.present && s.total > 0 ? Math.round((s.score / s.total) * 100) : null,
    };
  });

  const present = results.filter((r) => r.present);
  const totalScore = present.reduce((s, r) => s + r.score, 0);
  const totalPossible = present.reduce((s, r) => s + r.total, 0);
  const avgPct = totalPossible > 0 ? Math.round((totalScore / totalPossible) * 100) : null;
  const pcts = present.map((r) => r.pct).filter((p) => p != null).sort((a, b) => a - b);
  const median = pcts.length > 0 ? pcts[Math.floor(pcts.length / 2)] : null;
  const best = pcts.length > 0 ? pcts[pcts.length - 1] : null;
  const worst = pcts.length > 0 ? pcts[0] : null;

  return (
    <div style={{ maxWidth: 700 }}>
      <Link to={`/cardvote/class-evaluation/${classId}`} style={{ color: "var(--text3)", textDecoration: "none", fontSize: 13, fontWeight: 500 }}>
        ← {class_name}
      </Link>
      <h2 style={{ marginTop: 12, fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{student.name}</h2>
      <p style={{ color: "var(--text3)", marginBottom: 20, fontSize: 14 }}>
        Karte #{student.card_id} · {class_name}
      </p>

      <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        <StatCard label="Ø Gesamt" value={avgPct != null ? `${avgPct}%` : "–"} color={colorForPct(avgPct)} />
        <StatCard label="Bester Test" value={best != null ? `${best}%` : "–"} color="#0a7d3e" />
        <StatCard label="Schwächster" value={worst != null ? `${worst}%` : "–"} color="#d1350f" />
        <StatCard label="Median" value={median != null ? `${median}%` : "–"} />
        <StatCard label="Teilnahmen" value={`${present.length} / ${tests.length}`} />
      </div>

      {/* Trend bar */}
      {pcts.length >= 2 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text3)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>Verlauf</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 80 }}>
            {present.map((r, i) => (
              <div key={r.session_id} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "var(--text3)", marginBottom: 2 }}>{r.pct}%</span>
                <div style={{
                  width: "100%", maxWidth: 40,
                  height: `${Math.max(r.pct * 0.7, 4)}px`,
                  background: colorForPct(r.pct), borderRadius: 4, transition: "height 0.3s",
                }} />
              </div>
            ))}
          </div>
        </div>
      )}

      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--border3)" }}>
            <th style={th}>Test</th>
            <th style={{ ...th, textAlign: "center" }}>Punkte</th>
            <th style={{ ...th, textAlign: "center" }}>%</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.session_id} style={{ borderBottom: "1px solid var(--border)", opacity: r.present ? 1 : 0.4 }}>
              <td style={tdStyle}>
                <Link to={`/cardvote/evaluation/${r.session_id}`} style={{ color: "var(--accent)", textDecoration: "none" }}>
                  {r.name}
                </Link>
              </td>
              <td style={{ ...tdStyle, textAlign: "center", fontWeight: 600 }}>
                {r.present ? `${r.score} / ${r.total}` : "–"}
              </td>
              <td style={{
                ...tdStyle, textAlign: "center", fontWeight: 700,
                color: r.pct == null ? "var(--text3)" : colorForPct(r.pct),
              }}>
                {r.pct != null ? `${r.pct}%` : "abwesend"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 20 }}>
        <DownloadLink onClick={async () => { const r = await fetch(`${API}/classes/${classId}/all-tests-student-pdf/${cardId}`); if (!r.ok) return; const b = await r.blob(); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `Gesamtübersicht_${student.name}.pdf`; a.click(); URL.revokeObjectURL(a.href); }}>
          PDF herunterladen
        </DownloadLink>
      </div>
    </div>
  );
}

function colorForPct(pct) {
  if (pct == null) return "var(--text3)";
  if (pct >= 80) return "#0a7d3e";
  if (pct >= 50) return "#b8860b";
  return "#d1350f";
}

function StatCard({ label, value, color }) {
  return (
    <div style={{ padding: "10px 16px", background: "var(--bg2)", borderRadius: 12, textAlign: "center", minWidth: 80 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || "var(--text)" }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--text3)" }}>{label}</div>
    </div>
  );
}

const th = { padding: "8px 10px", textAlign: "left", fontSize: 13, color: "var(--text3)" };
const tdStyle = { padding: "10px", color: "var(--text)" };
