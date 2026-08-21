import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { DownloadLink, COLORS as C, pageApp, pageTitle, th as thBasis, td as tdBasis, Icon, ICONS, quoteFarbe, sectionLabel, StatCard } from "../components/Icons.jsx";
import { median } from "../core/statistik.js";
import { prozent } from "../core/zahl.js";
import FruehwarnPanel from "../components/Fruehwarnung.jsx";
import Themenstand from "../components/Themenstand.jsx";
import Notenverlauf from "../components/Notenverlauf.jsx";
import { useLanguage } from "../i18n/index.jsx";

const API = "/api";

export default function StudentEvaluation() {
  const { t } = useLanguage();
  const { classId, cardId } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch(`${API}/classes/${classId}/evaluation`).then((r) => r.json()).then(setData);
  }, [classId]);

  if (!data) return <div style={{ minHeight: "70vh" }} />;

  const { class_name, students, tests } = data;
  const student = students.find((s) => String(s.card_id) === cardId);
  if (!student) return <p style={{ color: C.danger }}>{t("cv.studentNotFound")}</p>;

  const results = tests.map((test) => {
    const s = test.student_scores[student.card_id];
    return {
      session_id: test.session_id,
      name: test.set_name || test.name || t("cv.thTest"),
      date: test.date,
      present: s?.present || false,
      score: s?.score || 0,
      total: s?.total || test.max_score,
      // pct kommt aus der Wertung am Server (E/G-Bonus, Minuspunkte); Fallback
      // für alte Datensätze: Punkte durch erreichbare Punkte.
      pct: s?.present ? (s.pct ?? prozent(s.score, s.total, null)) : null,
    };
  });

  const present = results.filter((r) => r.present);
  const totalScore = present.reduce((s, r) => s + r.score, 0);
  const totalPossible = present.reduce((s, r) => s + r.total, 0);
  const avgPct = prozent(totalScore, totalPossible, null);
  const pcts = present.map((r) => r.pct).filter((p) => p != null).sort((a, b) => a - b);
  // War `pcts[floor(n/2)]` — bei gerader Anzahl der OBERE der beiden mittleren
  // Werte, nicht der Median. `median` aus core/statistik.js rechnet ihn richtig.
  const medianPct = pcts.length > 0 ? Math.round(median(pcts)) : null;
  const best = pcts.length > 0 ? pcts[pcts.length - 1] : null;
  const worst = pcts.length > 0 ? pcts[0] : null;

  return (
    <div style={{ ...pageApp }}>
      <Link to={`/cardvote/class-evaluation/${classId}`} style={{ color: "var(--text3)", textDecoration: "none", fontSize: 13, fontWeight: 500 }}>
        <Icon d={ICONS.arrowLeft} size={14} /> {class_name}
      </Link>
      <h2 style={{ ...pageTitle, marginTop: 12 }}>{student.name}</h2>
      <p style={{ color: "var(--text3)", marginBottom: 24, fontSize: 14 }}>
        {t("cv.cardNo", { n: student.card_id })} · {class_name}
        {/* Kursniveau gehört zur Ergebnisanzeige — die Prozentwerte einer
            G-Wertung sind ohne diesen Hinweis nicht einzuordnen. */}
        {student.niveau ? ` · ${t("cv.courseNiveau", { n: student.niveau })}` : ""}
      </p>

      {/* Verlauf gegen die Klasse: dieselbe Auswertung wie auf der Startseite,
          hier nur fuer dieses Kind. Zeigt sich nichts, steht hier auch nichts. */}
      <FruehwarnPanel classId={classId} nurKind={cardId} />
      {/* Themenstand dieses Kindes: was sitzt, was nicht, und wird es besser? */}
      <Themenstand classId={classId} cardId={cardId} />
      {/* Der Verlauf beider Quellen auf einer Achse — die Frage „wird es
          besser?" beantwortet keine einzelne Erhebung. */}
      <Notenverlauf classId={classId} cardId={Number(cardId)} />

      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <StatCard label={t("cv.statAvgTotal")} value={avgPct != null ? `${avgPct}%` : "–"} color={quoteFarbe(avgPct)} />
        <StatCard label={t("cv.statBestTest")} value={best != null ? `${best}%` : "–"} color={C.success} />
        <StatCard label={t("cv.statWorstShort")} value={worst != null ? `${worst}%` : "–"} color={C.danger} />
        <StatCard label={t("cv.statMedian")} value={medianPct != null ? `${medianPct}%` : "–"} />
        <StatCard label={t("cv.statParticipation")} value={`${present.length} / ${tests.length}`} />
      </div>

      {/* Trend bar */}
      {pcts.length >= 2 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ ...sectionLabel, marginBottom: 8 }}>{t("cv.progress")}</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 80 }}>
            {present.map((r, i) => (
              <div key={r.session_id} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "var(--text3)", marginBottom: 2 }}>{r.pct}%</span>
                <div style={{
                  width: "100%", maxWidth: 40,
                  height: `${Math.max(r.pct * 0.7, 4)}px`,
                  // Balkenkappe: reine Grafik, kein Bedienelement.
                  background: quoteFarbe(r.pct), borderRadius: 4, transition: "height 0.3s",
                }} />
              </div>
            ))}
          </div>
        </div>
      )}

      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--border3)" }}>
            <th style={th}>{t("cv.thTest")}</th>
            <th style={{ ...th, textAlign: "center" }}>{t("cv.thPoints")}</th>
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
                color: r.pct == null ? "var(--text3)" : quoteFarbe(r.pct),
              }}>
                {r.pct != null ? `${r.pct}%` : t("cv.absent")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 24 }}>
        <DownloadLink onClick={async () => { const r = await fetch(`${API}/classes/${classId}/all-tests-student-pdf/${cardId}`); if (!r.ok) return; const b = await r.blob(); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `${t("cv.pdfOverviewFile")}_${student.name}.pdf`; a.click(); URL.revokeObjectURL(a.href); }}>
          {t("cv.downloadPdf")}
        </DownloadLink>
      </div>
    </div>
  );
}

// colorForPct kam aus Icons.jsx (quoteFarbe) — die 80/50-Schwelle stand
// achtmal im Code und muss überall dieselbe sein.

// StatCard kommt aus Icons.jsx — die lokale Kopie war eine zweite Design-Quelle.

// Aus dem Kern abgeleitet — wortgleich mit der Klassen-Auswertung, damit
// dieselbe Tabelle nicht zweimal verschieden aussieht (der Strich unter dem
// Kopf sitzt hier an der Zeile).
const th = { ...thBasis, padding: "8px 10px", textAlign: "left", fontSize: 13, color: "var(--text)", borderBottom: "none" };
const tdStyle = { ...tdBasis, padding: "8px 10px", textAlign: "left" };
