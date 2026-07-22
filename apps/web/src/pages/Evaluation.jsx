import { useState, useEffect, useRef } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { useModules } from "../core/modules.js";
import { useLanguage } from "../i18n/index.jsx";
import Latex from "../components/Latex.jsx";
import { DownloadLink, Icon, ICONS, btnPrimary, btnSecondary, modalOverlay, modalPanel, inputStyle, COLORS as C } from "../components/Icons.jsx";
import { gradeFromPct, DEFAULT_SCALE } from "../core/grades.js";

const API = "/api";
const COLORS = { A: "#0066cc", B: "#5856d6", C: C.warning, D: C.danger };

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}

const GRADE_COLORS = { 1: C.success, 2: C.success, 3: C.warning, 4: C.warning, 5: C.danger, 6: C.danger };
// gradeFromPct + DEFAULT_SCALE liegen zentral in core/grades.js (eine Quelle,
// auch von der Karten-Meisterung genutzt).

function fmt(n) { return n % 1 === 0 ? String(n) : n.toFixed(1); }

// Tendenznote: rundet die stetige Dezimalnote auf die naechste Stufe .0 / .3 / .7
// (z.B. 1,0 / 1,3(-) / 1,7(2+)) — wie in vielen Bundeslaendern ueblich, statt nur ganzer Noten.
function tendencyGrade(pct, scale) {
  const v = gradeFromPct(pct, scale);
  const whole = Math.floor(v);
  const frac = v - whole;
  let snap;
  if (frac < 0.15) snap = 0;
  else if (frac < 0.5) snap = 0.3;
  else if (frac < 0.85) snap = 0.7;
  else snap = 1;
  let result = Math.round((whole + snap) * 10) / 10;
  if (result > 6) result = 6;
  if (result < 1) result = 1;
  return result;
}

const TENDENCY_GRADES = [1, 2, 3, 4, 5].flatMap((g) => [g, Math.round((g + 0.3) * 10) / 10, Math.round((g + 0.7) * 10) / 10]).concat([6]);

function quantile(sorted, p) {
  const n = sorted.length;
  const idx = p * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function Boxplot({ values, max, label }) {
  if (values.length < 3) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const med = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const loBound = q1 - 1.5 * iqr;
  const hiBound = q3 + 1.5 * iqr;
  const inliers = sorted.filter((v) => v >= loBound && v <= hiBound);
  const lo = inliers.length > 0 ? inliers[0] : sorted[0];
  const hi = inliers.length > 0 ? inliers[inliers.length - 1] : sorted[sorted.length - 1];
  const outliers = sorted.filter((v) => v < loBound || v > hiBound);
  const pct = (v) => max > 0 ? (v / max) * 100 : 0;

  return (
    <div style={{ padding: 16 }}>
      {label && <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text3)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>}
      <div style={{ position: "relative", height: 48, margin: "0 20px" }}>
        {/* Whisker line */}
        <div style={{ position: "absolute", top: 22, left: `${pct(lo)}%`, width: `${pct(hi - lo)}%`, height: 4, background: "var(--border3)" }} />
        {/* Whisker caps */}
        <div style={{ position: "absolute", top: 14, left: `${pct(lo)}%`, width: 2, height: 20, background: "var(--text3)" }} />
        <div style={{ position: "absolute", top: 14, left: `${pct(hi)}%`, width: 2, height: 20, background: "var(--text3)" }} />
        {/* IQR box */}
        <div style={{
          position: "absolute", top: 8, left: `${pct(q1)}%`, width: `${pct(q3 - q1)}%`, height: 32,
          background: "rgba(10,132,255,0.15)", border: "2px solid var(--accent)", borderRadius: 6,
        }} />
        {/* Median line */}
        <div style={{ position: "absolute", top: 6, left: `${pct(med)}%`, width: 3, height: 36, background: "var(--accent)", borderRadius: 2, transform: "translateX(-1.5px)" }} />
        {/* Outliers */}
        {outliers.map((v, i) => (
          <div key={i} style={{
            position: "absolute", top: 19, left: `${pct(v)}%`,
            width: 10, height: 10, borderRadius: 5, background: C.danger, transform: "translateX(-5px)",
          }} />
        ))}
      </div>
      {/* Beschriftungen an ihrer echten Position, nicht gleichmaessig verteilt —
          sonst stehen sie nicht unter ihren Markierungen. Liegen zwei Werte nah
          beieinander (z. B. Q3 und Max), weicht das zweite in eine zweite Zeile
          aus, damit sich die Texte nicht ueberschneiden. */}
      {(() => {
        const MINGAP = 14; // Prozent Mindestabstand, sonst zweite Zeile
        const last = [-Infinity, -Infinity];
        const items = [["Min", sorted[0]], ["Q1", q1], ["Med", med], ["Q3", q3], ["Max", sorted[sorted.length - 1]]].map(([lbl, v]) => {
          const x = pct(v);
          let row = x - last[0] >= MINGAP ? 0 : x - last[1] >= MINGAP ? 1 : (last[0] <= last[1] ? 0 : 1);
          last[row] = x;
          return { lbl, v, x, row };
        });
        return (
          <div style={{ position: "relative", height: 28, margin: "4px 20px 0", fontSize: 11, color: "var(--text3)" }}>
            {items.map((it, i) => (
              <span key={i} style={{ position: "absolute", top: it.row * 13, left: `${it.x}%`, transform: "translateX(-50%)", whiteSpace: "nowrap" }}>{it.lbl}: {fmt(it.v)}</span>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

export default function Evaluation() {
  const { t } = useLanguage();
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [selectedQ, setSelectedQ] = useState(null);
  const [weights, setWeights] = useState({});
  const [gradeScale, setGradeScale] = useState(DEFAULT_SCALE);
  const [showWeights, setShowWeights] = useState(false);
  const [showScale, setShowScale] = useState(false);
  const [showDiscInfo, setShowDiscInfo] = useState(false);
  const [showSdInfo, setShowSdInfo] = useState(false);
  const [showRateInfo, setShowRateInfo] = useState(false);
  const [showCiInfo, setShowCiInfo] = useState(false);
  // Eigener Zustand fuer das "i" der oberen Kachel "95%-KI gesamt": seine
  // Erklaerung erschien sonst ganz unten unter der Fragetabelle statt bei der
  // Kachel.
  const [showCiTop, setShowCiTop] = useState(false);
  const [gradeView, setGradeView] = useState("bar");
  const [gradeMode, setGradeMode] = useState("whole"); // "whole" | "tendency"
  const { modules } = useModules();
  const notenAktiv = modules.find((m) => m.key === "noten")?.active ?? false;
  const kartenAktiv = modules.find((m) => m.key === "karten")?.active ?? false;
  const lernpfadAktiv = modules.find((m) => m.key === "lernpfad")?.active ?? false;
  const [notenDialog, setNotenDialog] = useState(false);
  const [sp] = useSearchParams();
  // Aus dem Kalender ("Ergebnis als Note"): Import direkt öffnen, sobald Daten
  // und Klasse da sind.
  useEffect(() => {
    if (sp.get("import") === "1" && notenAktiv && data?.class_id) setNotenDialog(true);
  }, [sp, notenAktiv, data]);
  const [avgMode, setAvgMode] = useState("pts");
  const [medMode, setMedMode] = useState("pts");
  const [sdMode, setSdMode] = useState("pts");
  const [configDirty, setConfigDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => { if (!data) setLoadError(true); }, 15000);
    Promise.all([
      fetch(`${API}/sessions/${id}/evaluation`).then((r) => r.json()),
      fetch(`${API}/sessions/${id}/eval-config`).then((r) => r.json()),
    ]).then(([evalData, config]) => {
      clearTimeout(timer);
      if (evalData && evalData.questions && evalData.students) setData({ ...evalData, _evalConfig: config || {} });
      if (config && config.weights) setWeights(config.weights);
      if (config && config.grade_scale) setGradeScale(config.grade_scale);
      else {
        try {
          const user = JSON.parse(localStorage.getItem("user"));
          if (user && user.grade_scale) setGradeScale(user.grade_scale);
        } catch {}
      }
    });
  }, [id]);

  const saveConfig = (newWeights, newScale) => {
    clearTimeout(saveTimer.current);
    setConfigDirty(true);
    saveTimer.current = setTimeout(() => {
      setSaving(true);
      fetch(`${API}/sessions/${id}/eval-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weights: newWeights, grade_scale: newScale }),
      }).then(() => { setSaving(false); setConfigDirty(false); });
    }, 800);
  };

  const updateWeight = (qId, val) => {
    const num = Math.max(0, Number(String(val).replace(",", ".")));
    if (isNaN(num)) return;
    const next = { ...weights, [qId]: num };
    setWeights(next);
    saveConfig(next, gradeScale);
  };

  const updateScale = (grade, val) => {
    let v = Math.max(0, Math.min(100, Number(val)));
    const next = { ...gradeScale, [grade]: v };
    for (let g = grade - 1; g >= 1; g--) {
      if (next[g] < next[g + 1]) next[g] = next[g + 1];
    }
    for (let g = grade + 1; g <= 5; g++) {
      if (next[g] > next[g - 1]) next[g] = next[g - 1];
    }
    setGradeScale(next);
    saveConfig(weights, next);
  };

  if (loadError && !data) return <p style={{ color: C.danger }}>Verbindungsfehler — Server nicht erreichbar.</p>;
  if (!data) return <div style={{ minHeight: "70vh" }} />;

  const { questions: rawQuestions = [], students: rawStudents = [], session_name } = data;

  // Filter out questions where nobody answered
  const answeredIndices = rawQuestions.map((_, i) =>
    rawStudents.some((s) => s.present && s.answers[i]?.answer)
  );
  const questions = rawQuestions.filter((_, i) => answeredIndices[i]);
  const students = rawStudents.map((s) => ({
    ...s,
    answers: s.answers.filter((_, i) => answeredIndices[i]),
  }));

  const getWeight = (qId) => weights[qId] ?? 1;
  const maxScore = questions.reduce((sum, q) => sum + (q.correct_answer ? getWeight(q.id) : 0), 0);

  const presentStudents = students.filter((s) => s.present).map((s) => {
    const score = s.answers.reduce((sum, a, i) => {
      if (a.is_correct) return sum + getWeight(questions[i].id);
      return sum;
    }, 0);
    return { ...s, weightedScore: score };
  });

  const absentStudents = students.filter((s) => !s.present);

  const scores = presentStudents.map((s) => s.weightedScore);
  const pcts = scores.map((s) => maxScore > 0 ? (s / maxScore) * 100 : 0);
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const avgPct = maxScore > 0 ? Math.round((avgScore / maxScore) * 100) : 0;
  const medianScore = median(scores);
  const medianPct = maxScore > 0 ? Math.round((medianScore / maxScore) * 100) : 0;
  const sd = stddev(scores);
  const sdPct = maxScore > 0 ? stddev(pcts) : 0;

const gradeDistribution = (() => {
    if (gradeMode === "tendency") {
      const dist = {};
      TENDENCY_GRADES.forEach((g) => { dist[g] = 0; });
      pcts.forEach((p) => { dist[tendencyGrade(p, gradeScale)]++; });
      return dist;
    }
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    pcts.forEach((p) => { dist[Math.round(gradeFromPct(p, gradeScale))]++; });
    return dist;
  })();

  const questionStats = questions.map((q, qi) => {
    let correct = 0;
    let answered = 0;
    const answerCounts = {};
    const itemScores = [];

    for (const s of presentStudents) {
      const a = s.answers[qi];
      if (a && a.answer) {
        answered++;
        answerCounts[a.answer] = (answerCounts[a.answer] || 0) + 1;
        itemScores.push(a.is_correct ? 1 : 0);
        if (a.is_correct) correct++;
      }
    }

    const numChoices = q.num_choices || Object.keys(q.choices).length;
    const guessProb = numChoices > 0 ? 1 / numChoices : null;

    let discrimination = null;
    if (itemScores.length >= 3 && maxScore > 0) {
      const totalScores = presentStudents
        .filter((s) => s.answers[qi]?.answer)
        .map((s) => s.weightedScore);
      const n = itemScores.length;
      const meanItem = itemScores.reduce((a, b) => a + b, 0) / n;
      const meanTotal = totalScores.reduce((a, b) => a + b, 0) / n;
      const sdItem = Math.sqrt(itemScores.reduce((s, x) => s + (x - meanItem) ** 2, 0) / n);
      const sdTotal = Math.sqrt(totalScores.reduce((s, x) => s + (x - meanTotal) ** 2, 0) / n);
      if (sdItem > 0 && sdTotal > 0) {
        const cov = itemScores.reduce((s, x, i) => s + (x - meanItem) * (totalScores[i] - meanTotal), 0) / n;
        discrimination = cov / (sdItem * sdTotal);
      }
    }

    const itemSd = itemScores.length >= 2 ? stddev(itemScores) : null;

    // 95%-Wilson-Konfidenzintervall fuer den Anteil richtiger Antworten
    let ciLow = null, ciHigh = null;
    if (answered > 0) {
      const p = correct / answered, z = 1.96, nn = answered;
      const denom = 1 + (z * z) / nn;
      const center = (p + (z * z) / (2 * nn)) / denom;
      const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * nn)) / nn)) / denom;
      ciLow = Math.round(Math.max(0, center - margin) * 100);
      ciHigh = Math.round(Math.min(1, center + margin) * 100);
    }
    return { correct, answered, pct: answered > 0 ? Math.round((correct / answered) * 100) : 0, ciLow, ciHigh, guessProb, discrimination, answerCounts, itemSd };
  });

  // Gesamt-Konfidenzintervall des Tests: alle Antworten aller Fragen gepoolt (Wilson, 95%)
  const quizCi = (() => {
    let c = 0, n = 0;
    questionStats.forEach((st) => { c += st.correct; n += st.answered; });
    if (n === 0) return null;
    const p = c / n, z = 1.96;
    const denom = 1 + (z * z) / n;
    const center = (p + (z * z) / (2 * n)) / denom;
    const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / denom;
    return { low: Math.round(Math.max(0, center - margin) * 100), high: Math.round(Math.min(1, center + margin) * 100), pct: Math.round(p * 100), n };
  })();

  
  const evalConfig = data._evalConfig || {};
  const timesData = evalConfig.times || {};
  const totalTime = evalConfig.total_time || null;

  const suggestions = (() => {
    const tips = [];
    const tooEasy = questionStats.filter((s, i) => s.pct >= 90 && questions[i].correct_answer);
    const tooHard = questionStats.filter((s, i) => s.pct <= 20 && s.answered > 0 && questions[i].correct_answer);
    const lowDisc = questionStats.filter((s) => s.discrimination !== null && s.discrimination < 0.1 && s.answered > 0);
    const negDisc = questionStats.filter((s) => s.discrimination !== null && s.discrimination < 0);

    if (tooEasy.length > 0)
      tips.push(`${tooEasy.length} Frage(n) mit >90% Richtig — erwäge schwierigere Alternativen oder höhere Gewichtung.`);
    if (tooHard.length > 0)
      tips.push(`${tooHard.length} Frage(n) mit ≤20% Richtig — ggf. Aufgabenstellung oder Distraktoren überarbeiten.`);
    if (negDisc.length > 0)
      tips.push(`${negDisc.length} Frage(n) mit negativer Trennschärfe — starke Lernende antworten hier häufiger falsch. Formulierung prüfen!`);
    if (lowDisc.length > 1)
      tips.push(`${lowDisc.length} Fragen trennen kaum zwischen starken und schwachen Lernenden.`);

    if (avgPct > 85) tips.push("Durchschnitt >85% — der Test war insgesamt recht leicht.");
    if (avgPct < 40) tips.push("Durchschnitt <40% — der Test war sehr schwer. Lernstand prüfen oder Aufgaben anpassen.");

    if (sdPct < 10 && presentStudents.length >= 2)
      tips.push(`Geringe Streuung (σ=${sdPct.toFixed(1)}%) — der Test differenziert wenig zwischen Leistungsniveaus. Mehr Aufgaben mit mittlerem Schwierigkeitsgrad einbauen.`);
    else if (sdPct > 25 && presentStudents.length >= 2) {
      if (avgPct < 50)
        tips.push(`Hohe Streuung (σ=${sdPct.toFixed(1)}%) bei niedrigem Durchschnitt — die Aufgaben sind vermutlich zu schwer. Schwierigkeitsgrad senken oder Thema erneut behandeln.`);
      else if (avgPct > 80)
        tips.push(`Hohe Streuung (σ=${sdPct.toFixed(1)}%) bei hohem Durchschnitt — einzelne Lernende haben deutliche Lücken, während die Mehrheit den Stoff beherrscht. Gezielte Förderung erwägen.`);
      else
        tips.push(`Hohe Streuung (σ=${sdPct.toFixed(1)}%) — große Leistungsunterschiede. Binnendifferenzierung oder gestufte Aufgaben erwägen.`);
    }

    // Decken- und Bodeneffekt
    if (presentStudents.length >= 3) {
      const ceilingCount = pcts.filter((p) => p >= 95).length;
      const floorCount = pcts.filter((p) => p <= 10).length;
      const ceilingPct = Math.round((ceilingCount / presentStudents.length) * 100);
      const floorPct = Math.round((floorCount / presentStudents.length) * 100);
      if (ceilingPct >= 40)
        tips.push(`Deckeneffekt: ${ceilingCount} von ${presentStudents.length} Lernenden (${ceilingPct}%) erreichen ≥95%. Der Test war zu leicht — Differenzierung nach oben nicht möglich. Schwierigere Aufgaben einbauen.`);
      if (floorPct >= 40)
        tips.push(`Bodeneffekt: ${floorCount} von ${presentStudents.length} Lernenden (${floorPct}%) erreichen ≤10%. Der Test war zu schwer — Differenzierung nach unten nicht möglich. Schwierigkeitsgrad senken oder Thema wiederholen.`);
    }

    const absentPct = students.length > 0 ? Math.round((absentStudents.length / students.length) * 100) : 0;
    if (absentPct > 30 && students.length >= 5)
      tips.push(`${absentPct}% abwesend (${absentStudents.length}/${students.length}) — hohe Fehlquote, Nachholtermin einplanen.`);

    const onlyGuessing = questionStats.filter((s, i) => {
      if (!questions[i].correct_answer || s.answered < 3 || s.guessProb === null) return false;
      return Math.abs(s.pct / 100 - s.guessProb) < 0.1;
    });
    if (onlyGuessing.length > 0)
      tips.push(`${onlyGuessing.length} Frage(n) nahe Ratewahrscheinlichkeit — Lernende scheinen zu raten. Thema wiederholen oder Distraktoren verbessern.`);

    const avgGrade = presentStudents.length > 0
      ? pcts.reduce((sum, p) => sum + gradeFromPct(p, gradeScale), 0) / presentStudents.length
      : 0;
    if (avgGrade >= 4.5 && avgPct >= 40)
      tips.push(`Notenschnitt ${avgGrade.toFixed(1)} — ggf. Notenschlüssel anpassen.`);

    return tips;
  })();

  const fmtDisc = (d) => {
    if (d === null) return "–";
    const v = d.toFixed(2);
    const color = d >= 0.4 ? C.success : d >= 0.2 ? C.warning : C.danger;
    const label = d >= 0.4 ? "gut" : d >= 0.2 ? "akzeptabel" : "schwach";
    return <span style={{ color }} title={label}>{v}</span>;
  };

  if (selectedQ !== null) {
    const qi = selectedQ;
    const q = questions[qi];
    const stat = questionStats[qi];
    const numChoices = q.num_choices || Object.keys(q.choices).length;
    const choiceKeys = ["A", "B", "C", "D"].slice(0, numChoices);
    const allKeys = ["A", "B", "C", "D"];

    return (
      <div>
        <button onClick={() => setSelectedQ(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", fontSize: 13, fontWeight: 500, padding: "4px 0", marginBottom: 16 }}>← Zurück zur Übersicht</button>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Frage {qi + 1}</h2>
        <div style={{ fontSize: 18, color: "var(--text)", marginBottom: 20, padding: 16, background: "var(--bg2)", borderRadius: 12, lineHeight: 1.5 }}>
          <Latex>{q.text}</Latex>
        </div>

        {q.image_url && (
          <div style={{ marginBottom: 16 }}>
            <img src={q.image_url} alt="" style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 10, border: "1px solid #e5e5e5" }} />
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 24, maxWidth: 500 }}>
          {allKeys.map((k) => {
            const isCorrect = q.correct_answer && q.correct_answer.includes(k);
            const hasChoice = choiceKeys.includes(k);
            return (
              <div key={k} style={{
                padding: 12, borderRadius: 10, fontSize: 15,
                background: isCorrect ? "var(--success-bg)" : "var(--bg2)",
                border: isCorrect ? `2px solid ${C.success}` : "2px solid transparent",
                color: "var(--text)",
                opacity: hasChoice ? 1 : 0.4,
              }}>
                <strong>{k}</strong>: <Latex>{q.choices[k] || "–"}</Latex>
                <span style={{ float: "right", fontWeight: 700, color: "var(--text3)" }}>
                  {stat.answerCounts[k] || 0}×
                </span>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 20, marginBottom: 20, flexWrap: "wrap" }}>
          <StatBox label="Richtig" value={`${stat.pct}%`} color={stat.pct >= 80 ? C.success : stat.pct >= 50 ? C.warning : C.danger} />
          <StatBox label="95%-KI" value={stat.ciLow !== null ? `${stat.ciLow}–${stat.ciHigh}%` : "–"} />
          <StatBox label="Ratewahrsch." value={stat.guessProb !== null ? `${Math.round(stat.guessProb * 100)}%` : "–"} />
          <StatBox label="Trennschärfe" value={stat.discrimination !== null ? stat.discrimination.toFixed(2) : "–"}
            color={stat.discrimination !== null ? (stat.discrimination >= 0.4 ? C.success : stat.discrimination >= 0.2 ? C.warning : C.danger) : undefined} />
          <StatBox label="Std.abw." value={stat.itemSd !== null ? stat.itemSd.toFixed(2) : "–"} />
          <StatBox label="Beantwortet" value={`${stat.answered} / ${presentStudents.length}`} />
          <StatBox label="Gewichtung" value={`×${getWeight(q.id)}`} />
          {timesData[String(q.id)] != null && (() => {
            const t = timesData[String(q.id)];
            return <StatBox label="Zeit" value={`${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`} />;
          })()}
        </div>

        <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>Antwortverteilung</h3>
        {allKeys.map((k) => {
          const count = stat.answerCounts[k] || 0;
          const pct = stat.answered > 0 ? (count / stat.answered) * 100 : 0;
          const isCorrect = q.correct_answer && q.correct_answer.includes(k);
          return (
            <div key={k} style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
              <span style={{ width: 28, fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{k}</span>
              <div style={{ flex: 1, height: 28, background: "var(--bg2)", borderRadius: 6, overflow: "hidden" }}>
                <div style={{
                  height: "100%", width: `${pct}%`,
                  background: isCorrect ? C.success : COLORS[k],
                  borderRadius: 6, display: "flex", alignItems: "center", paddingLeft: 8,
                  color: "white", fontSize: 13, fontWeight: 600, transition: "width 0.3s",
                  minWidth: count > 0 ? 28 : 0, opacity: isCorrect ? 1 : 0.6,
                }}>
                  {count > 0 && `${count} (${Math.round(pct)}%)`}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const maxGrade = Math.max(...Object.values(gradeDistribution), 1);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <Link to="/cardvote/tests" style={{ color: "var(--text3)", textDecoration: "none", fontSize: 13, fontWeight: 500 }}>← Alle Tests</Link>
        {notenDialog && (
          <NotenImport
            sessionId={Number(id)} classId={data.class_id} sessionName={data.session_name}
            grades={presentStudents.map((st) => ({
              card_id: st.card_id, name: st.name,
              value: gradeMode === "tendency"
                ? tendencyGrade(maxScore > 0 ? (st.weightedScore / maxScore) * 100 : 0, gradeScale)
                : Math.round(gradeFromPct(maxScore > 0 ? (st.weightedScore / maxScore) * 100 : 0, gradeScale) * 10) / 10,
            }))}
            onClose={() => setNotenDialog(false)}
          />
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {configDirty && <span style={{ fontSize: 11, color: saving ? C.warning : C.success }}>{saving ? "Speichern…" : "Gespeichert"}</span>}
          {/* Nur sichtbar, wenn das Notenmodul aktiv ist — sonst fuehrt der
              Knopf ins Leere (Regel 3: CardVote haengt nicht von Noten ab). */}
          {notenAktiv && data.class_id && (
            <button onClick={() => setNotenDialog(true)} style={{ ...btnSecondary, padding: "6px 14px", fontSize: 13 }}>
              {t("notenimp.button")}
            </button>
          )}
          <DownloadLink onClick={async () => { const r = await fetch(`${API}/sessions/${id}/all-students-pdf`); if (!r.ok) return; const b = await r.blob(); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `Auswertungen_${id}.pdf`; a.click(); URL.revokeObjectURL(a.href); }}>
            PDF
          </DownloadLink>
          <DownloadLink onClick={async () => { const r = await fetch(`${API}/sessions/${id}/evaluation-xlsx`); if (!r.ok) return; const b = await r.blob(); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `Auswertung_${id}.xlsx`; a.click(); URL.revokeObjectURL(a.href); }}>
            Excel
          </DownloadLink>
          <DownloadLink onClick={async () => { const r = await fetch(`${API}/sessions/${id}/evaluation-scsv`); if (!r.ok) return; const b = await r.blob(); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `CardVote_${id}.csv`; a.click(); URL.revokeObjectURL(a.href); }}>
            iDoceo
          </DownloadLink>
        </div>
      </div>
      <h2 style={{ marginTop: 8, fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{session_name || `Session #${id}`}</h2>

      {(kartenAktiv || lernpfadAktiv) && data.class_id && <WeakTopics sessionId={Number(id)} classId={data.class_id} karten={kartenAktiv} lernpfad={lernpfadAktiv} t={t} />}

      {/* Statistik-Kacheln */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <Stat label="Anwesend" value={`${presentStudents.length} / ${students.length}`} />
        <Stat
          label={avgMode === "pts" ? "Ø Punkte" : "Ø Prozent"}
          value={avgMode === "pts" ? fmt(avgScore) : `${avgPct}%`}
          onClick={() => setAvgMode(avgMode === "pts" ? "pct" : "pts")}
          clickable
        />
        <Stat
          label={medMode === "pts" ? "Median" : "Median %"}
          value={medMode === "pts" ? fmt(medianScore) : `${medianPct}%`}
          onClick={() => setMedMode(medMode === "pts" ? "pct" : "pts")}
          clickable
        />
        <Stat
          label={sdMode === "pts" ? "Std.abw." : "Std.abw. %"}
          value={sdMode === "pts" ? fmt(sd) : `${sdPct.toFixed(1)}%`}
          onClick={() => setSdMode(sdMode === "pts" ? "pct" : "pts")}
          clickable
          info={() => setShowSdInfo(!showSdInfo)}
        />
        {quizCi && (
          <Stat
            label="95%-KI gesamt"
            value={`${quizCi.low}–${quizCi.high}%`}
            info={() => setShowCiTop(!showCiTop)}
          />
        )}
        {totalTime != null && (
          <Stat label="Dauer" value={`${Math.floor(totalTime / 60)}:${String(totalTime % 60).padStart(2, "0")}`} />
        )}
      </div>

      {/* Std.abw. Erklärung */}
      {showSdInfo && (
        <div style={{ padding: 16, background: "var(--bg3)", borderRadius: 14, border: "1px solid var(--border)", fontSize: 13, color: "var(--text)", lineHeight: 1.6, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h4 style={{ fontSize: 15, fontWeight: 700 }}>Standardabweichung (σ)</h4>
            <button onClick={() => setShowSdInfo(false)} style={{ width: 24, height: 24, borderRadius: 12, border: "none", background: "var(--bg2)", color: "var(--text3)", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
          </div>
          <p style={{ marginBottom: 10 }}>
            Misst, wie stark die Ergebnisse um den Durchschnitt streuen. Eine <strong>kleine</strong> σ bedeutet, dass alle ähnlich abgeschnitten haben.
            Eine <strong>große</strong> σ zeigt große Leistungsunterschiede.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontWeight: 700, color: C.success, minWidth: 64 }}>σ &lt; 10%</span><span>Homogene Gruppe — wenig Differenzierung.</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontWeight: 700, color: C.warning, minWidth: 64 }}>10–25%</span><span>Normale Streuung — gute Differenzierung.</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontWeight: 700, color: C.danger, minWidth: 64 }}>σ &gt; 25%</span><span>Heterogen — ggf. Binnendifferenzierung prüfen.</span></div>
          </div>
        </div>
      )}

      {/* KI-Erklaerung der oberen Kachel — direkt hier, nicht am Seitenende. */}
      {showCiTop && <CiInfoBox onClose={() => setShowCiTop(false)} />}

      {/* Notenverteilung / Boxplot toggle */}
      <div style={{ padding: 16, background: "var(--bg3)", borderRadius: 14, border: "1px solid var(--border)", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <button
            onClick={() => setGradeView("bar")}
            style={{
              fontSize: 13, fontWeight: 600, padding: "5px 12px", borderRadius: 980, border: "none", cursor: "pointer",
              background: gradeView === "bar" ? "var(--accent)" : "var(--bg2)",
              color: gradeView === "bar" ? "#fff" : "var(--text3)",
              transition: "all 0.2s",
            }}
          >Notenverteilung</button>
          <button
            onClick={() => setGradeView("box")}
            style={{
              fontSize: 13, fontWeight: 600, padding: "5px 12px", borderRadius: 980, border: "none", cursor: "pointer",
              background: gradeView === "box" ? "var(--accent)" : "var(--bg2)",
              color: gradeView === "box" ? "#fff" : "var(--text3)",
              transition: "all 0.2s",
            }}
          >Boxplot</button>
          {gradeView === "bar" && (
            <div style={{ display: "flex", gap: 2, background: "var(--bg2)", borderRadius: 980, padding: 3, marginLeft: "auto" }}>
              <button
                onClick={() => setGradeMode("whole")}
                style={{
                  fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 980, border: "none", cursor: "pointer",
                  background: gradeMode === "whole" ? "var(--card)" : "transparent",
                  color: gradeMode === "whole" ? "var(--text)" : "var(--text3)",
                }}
              >Ganze Noten</button>
              <button
                onClick={() => setGradeMode("tendency")}
                style={{
                  fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 980, border: "none", cursor: "pointer",
                  background: gradeMode === "tendency" ? "var(--card)" : "transparent",
                  color: gradeMode === "tendency" ? "var(--text)" : "var(--text3)",
                }}
              >Mit Teilnoten</button>
            </div>
          )}
        </div>
        {gradeView === "bar" ? (
          <div style={{ display: "flex", alignItems: "flex-end", gap: gradeMode === "tendency" ? 3 : 8 }}>
            {(gradeMode === "tendency" ? TENDENCY_GRADES : [1, 2, 3, 4, 5, 6]).map((g) => {
              const count = gradeDistribution[g];
              const barH = maxGrade > 0 ? Math.round((count / maxGrade) * 80) : 0;
              const colorGrade = gradeMode === "tendency" ? Math.min(6, Math.round(g)) : g;
              return (
                <div key={g} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <span style={{ fontSize: gradeMode === "tendency" ? 10 : 12, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>{count || ""}</span>
                  <div style={{
                    width: "100%", maxWidth: gradeMode === "tendency" ? 26 : 48, height: barH, minHeight: count > 0 ? 8 : 2,
                    background: count > 0 ? GRADE_COLORS[colorGrade] : "var(--border3)", borderRadius: "6px 6px 0 0", transition: "height 0.3s", opacity: count > 0 ? 0.85 : 0.3,
                  }} />
                  <span style={{ fontSize: gradeMode === "tendency" ? 10 : 13, fontWeight: 600, color: "var(--text3)", marginTop: 4, whiteSpace: "nowrap" }}>{gradeMode === "tendency" ? g.toFixed(1) : g}</span>
                </div>
              );
            })}
          </div>
        ) : (
          scores.length >= 3
            ? <Boxplot values={scores} max={maxScore} />
            : <p style={{ fontSize: 13, color: "var(--text3)" }}>Mindestens 3 Ergebnisse nötig.</p>
        )}
      </div>

      {/* Notenschlüssel + Gewichtung */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        <button onClick={() => { setShowScale(!showScale); setShowWeights(false); }}
          style={{
            fontSize: 13, fontWeight: 500, padding: "5px 12px", borderRadius: 980, cursor: "pointer",
            border: "1px solid var(--border2)", background: showScale ? "var(--accent)" : "var(--card)",
            color: showScale ? "#fff" : "var(--text2)", transition: "all 0.15s",
          }}>
          Notenschlüssel
        </button>
        <button onClick={() => { setShowWeights(!showWeights); setShowScale(false); }}
          style={{
            fontSize: 13, fontWeight: 500, padding: "5px 12px", borderRadius: 980, cursor: "pointer",
            border: "1px solid var(--border2)", background: showWeights ? "var(--accent)" : "var(--card)",
            color: showWeights ? "#fff" : "var(--text2)", transition: "all 0.15s",
          }}>
          Gewichtung
        </button>
      </div>

      {showScale && (
        <div style={{ padding: 16, background: "var(--card)", borderRadius: 14, border: "1px solid var(--border)", marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Notenschlüssel</h3>
          <p style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>Mindestprozent für jede Note. Wird pro Test gespeichert.</p>
          <style>{NUM_CSS}</style>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(136px, 1fr))", gap: 8 }}>
            {[1, 2, 3, 4, 5].map((g) => (
              <div key={g} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderRadius: 10, background: "var(--bg3)" }}>
                <span style={gradeBadge}>{g}</span>
                <span style={{ fontSize: 11, color: "var(--text3)" }}>ab</span>
                <input className="nice-num" type="number" min="0" max="100" step="1"
                  value={Number(gradeScale[g])} onChange={(e) => updateScale(g, e.target.value)} style={numInput} />
                <span style={{ fontSize: 11, color: "var(--text3)" }}>%</span>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: "1px dashed var(--border2)", borderRadius: 10 }}>
              <span style={gradeBadge}>6</span>
              <span style={{ fontSize: 12, color: "var(--text3)" }}>unter {gradeScale[5]}%</span>
            </div>
          </div>
        </div>
      )}

      {showWeights && (
        <div style={{ padding: 16, background: "var(--card)", borderRadius: 14, border: "1px solid var(--border)", marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Gewichtung</h3>
          <p style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>Punkte pro richtige Antwort. Standard = 1.</p>
          <style>{NUM_CSS}</style>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
            {questions.map((q, i) => (
              <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 10, background: "var(--bg3)" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", flexShrink: 0 }}>F{i + 1}</span>
                <input className="nice-num" type="number" min="0" max="10" step="0.5"
                  value={Number(getWeight(q.id))} onChange={(e) => updateWeight(q.id, e.target.value)} style={{ ...numInput, marginLeft: "auto" }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Vorschläge */}
      {suggestions.length > 0 && (
        <div style={{ padding: 16, background: "var(--warn-bg)", borderRadius: 14, border: "1px solid var(--border)", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text2)", flexShrink: 0 }}><path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 4 12.7V17a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-2.3A7 7 0 0 1 12 2z"/></svg>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Vorschläge</h3>
          </div>
          {suggestions.map((tip, i) => (
            <div key={i} style={{ fontSize: 13, color: "var(--text)", marginBottom: 6, lineHeight: 1.5, paddingLeft: 12, borderLeft: "2px solid #e5c07b" }}>
              {tip}
            </div>
          ))}
        </div>
      )}

      <TopicAnalysis questions={questions} presentStudents={presentStudents} />

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 14, whiteSpace: "nowrap" }}>
          <thead>
            <tr>
              <th style={th}>Name</th>
              {questions.map((q, i) => (
                <th key={q.id}
                  onClick={() => setSelectedQ(i)}
                  style={{ ...th, writingMode: "vertical-lr", textAlign: "left", maxWidth: 30, height: 120, fontSize: 12, padding: "4px 2px", cursor: "pointer", color: "var(--accent)" }}
                  title={`${q.text} — Klicken für Details`}>
                  F{i + 1}{getWeight(q.id) !== 1 ? ` (×${getWeight(q.id)})` : ""}
                </th>
              ))}
              <th style={{ ...th, background: "var(--bg2)" }}>Punkte</th>
              <th style={{ ...th, background: "var(--bg2)" }}>%</th>
              <th style={{ ...th, background: "var(--bg2)" }}>Note</th>
            </tr>
            <tr style={{ background: "var(--bg2)" }}>
              <td style={{ ...td, fontWeight: "bold", color: "var(--text3)", fontSize: 12 }}>Lösung</td>
              {questions.map((q) => (
                <td key={q.id} style={{ ...td, textAlign: "center", fontWeight: "bold", color: "var(--text)" }}>
                  {q.correct_answer || "–"}
                </td>
              ))}
              <td style={td}></td>
              <td style={td}></td>
              <td style={td}></td>
            </tr>
          </thead>
          <tbody>
            {presentStudents.map((student) => {
              const pct = maxScore > 0 ? Math.round((student.weightedScore / maxScore) * 100) : 0;
              const grade = gradeFromPct(pct, gradeScale);
              return (
                <tr key={student.card_id}>
                  <td style={{ ...td, fontWeight: "bold", position: "sticky", left: 0, background: "var(--card)", zIndex: 1 }}>
                    <a
                      href="#"
                      onClick={async (e) => { e.preventDefault(); const r = await fetch(`${API}/sessions/${id}/student-pdf/${student.card_id}`); if (!r.ok) return; const b = await r.blob(); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `${student.name}_${id}.pdf`; a.click(); URL.revokeObjectURL(a.href); }}
                      style={{ color: "var(--text)", textDecoration: "none" }}
                      title="PDF herunterladen"
                    >
                      {student.name}{" "}
                      <Icon d={ICONS.download} size={15} color="var(--text3)" />
                    </a>
                  </td>
                  {student.answers.map((a, i) => (
                    <td
                      key={questions[i].id}
                      style={{
                        ...td,
                        textAlign: "center",
                        fontWeight: "bold",
                        background: a.answer == null ? "#fafafa"
                          : a.is_correct ? "var(--success-bg)"
                          : a.correct_answer ? "var(--danger-bg)"
                          : "#fff",
                        color: a.answer == null ? "#ccc"
                          : a.is_correct ? C.success
                          : a.correct_answer ? C.danger
                          : "var(--text)",
                      }}
                    >
                      {a.answer || "–"}
                    </td>
                  ))}
                  <td style={{ ...td, textAlign: "center", fontWeight: "bold", background: "var(--bg2)" }}>
                    {fmt(student.weightedScore)} / {maxScore}
                  </td>
                  <td style={{
                    ...td, textAlign: "center", fontWeight: "bold",
                    background: pct >= 80 ? "var(--success-bg)" : pct >= 50 ? "var(--warn-bg)" : "var(--danger-bg)",
                    color: pct >= 80 ? C.success : pct >= 50 ? C.warning : C.danger,
                  }}>
                    {maxScore > 0 ? `${pct}%` : "–"}
                  </td>
                  <td style={{ ...td, textAlign: "center", fontWeight: 700, color: GRADE_COLORS[Math.round(grade)] }}>
                    {maxScore > 0 ? grade.toFixed(1) : "–"}
                  </td>
                </tr>
              );
            })}

            {absentStudents.length > 0 && (
              <tr>
                <td colSpan={questions.length + 4} style={{ ...td, paddingTop: 12, borderBottom: "none" }}>
                  <span style={{ color: "var(--text3)", fontSize: 12, fontStyle: "italic" }}>Abwesend:</span>
                </td>
              </tr>
            )}
            {absentStudents.map((student) => (
              <tr key={student.card_id} style={{ opacity: 0.4 }}>
                <td style={{ ...td, fontWeight: "bold", position: "sticky", left: 0, background: "var(--card)", zIndex: 1, fontStyle: "italic" }}>
                  {student.name}
                </td>
                {questions.map((q) => (
                  <td key={q.id} style={{ ...td, textAlign: "center", color: "var(--border2)" }}>–</td>
                ))}
                <td style={{ ...td, textAlign: "center", color: "var(--border2)", background: "var(--bg2)" }}>–</td>
                <td style={{ ...td, textAlign: "center", color: "var(--border2)", background: "var(--bg2)" }}>–</td>
                <td style={{ ...td, textAlign: "center", color: "var(--border2)", background: "var(--bg2)" }}>–</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--border3)" }}>
              <td style={{ ...td, fontWeight: "bold", color: "var(--text3)", fontSize: 12 }}>Richtig</td>
              {questionStats.map((stat, i) => (
                <td key={i} style={{ ...td, textAlign: "center", fontSize: 12, fontWeight: "bold", color: stat.pct >= 80 ? C.success : stat.pct >= 50 ? C.warning : C.danger }}>
                  {stat.answered > 0 ? `${stat.pct}%` : "–"}
                </td>
              ))}
              <td style={td}></td>
              <td style={td}></td>
              <td style={td}></td>
            </tr>
            <tr>
              <td style={{ ...td, fontWeight: "bold", color: "var(--text3)", fontSize: 12 }}>
                <span style={{ cursor: "pointer" }} onClick={() => setShowCiInfo(!showCiInfo)}>
                  95%-KI <span style={{ color: "var(--accent)", fontSize: 11 }}>ⓘ</span>
                </span>
              </td>
              {questionStats.map((stat, i) => (
                <td key={i} style={{ ...td, textAlign: "center", fontSize: 11, fontWeight: "bold", color: "var(--text3)", whiteSpace: "nowrap" }}>
                  {stat.ciLow !== null ? `${stat.ciLow}–${stat.ciHigh}%` : "–"}
                </td>
              ))}
              <td style={td}></td>
              <td style={td}></td>
              <td style={td}></td>
            </tr>
            <tr>
              <td style={{ ...td, fontWeight: "bold", color: "var(--text3)", fontSize: 12 }}>
                <span style={{ cursor: "pointer" }} onClick={() => setShowRateInfo(!showRateInfo)}>
                  Ratewahrsch. <span style={{ color: "var(--accent)", fontSize: 11 }}>ⓘ</span>
                </span>
              </td>
              {questionStats.map((stat, i) => (
                <td key={i} style={{ ...td, textAlign: "center", fontSize: 12, fontWeight: "bold", color: "var(--text3)" }}>
                  {stat.guessProb !== null ? `${Math.round(stat.guessProb * 100)}%` : "–"}
                </td>
              ))}
              <td style={td}></td>
              <td style={td}></td>
              <td style={td}></td>
            </tr>
            <tr>
              <td style={{ ...td, fontWeight: "bold", color: "var(--text3)", fontSize: 12 }}>
                <span style={{ cursor: "pointer" }} onClick={() => setShowDiscInfo(!showDiscInfo)}>
                  Trennschärfe <span style={{ color: "var(--accent)", fontSize: 11 }}>ⓘ</span>
                </span>
              </td>
              {questionStats.map((stat, i) => (
                <td key={i} style={{ ...td, textAlign: "center", fontSize: 12, fontWeight: "bold" }}>
                  {fmtDisc(stat.discrimination)}
                </td>
              ))}
              <td style={td}></td>
              <td style={td}></td>
              <td style={td}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {showCiInfo && <CiInfoBox onClose={() => setShowCiInfo(false)} />}

      {showRateInfo && (
        <div style={{ marginTop: 12, padding: 16, background: "var(--bg3)", borderRadius: 14, border: "1px solid var(--border)", fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h4 style={{ fontSize: 15, fontWeight: 700 }}>Was ist die Ratewahrscheinlichkeit?</h4>
            <button onClick={() => setShowRateInfo(false)} style={{ width: 24, height: 24, borderRadius: 12, border: "none", background: "var(--bg2)", color: "var(--text3)", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
          </div>
          <p style={{ marginBottom: 10 }}>
            Die Wahrscheinlichkeit, die richtige Antwort <strong>zufällig</strong> zu erraten — also ohne Wissen, nur durch Raten.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontWeight: 700, minWidth: 90 }}>2 Antworten</span><span>50%</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontWeight: 700, minWidth: 90 }}>3 Antworten</span><span>33%</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontWeight: 700, minWidth: 90 }}>4 Antworten</span><span>25%</span></div>
          </div>
          <p style={{ fontSize: 12, color: "var(--text3)", padding: "8px 12px", background: "var(--bg2)", borderRadius: 8 }}>
            Liegt die Richtig-Quote nahe der Ratewahrscheinlichkeit, deutet das auf Raten hin. Ein deutlich höherer Wert zeigt echtes Wissen.
          </p>
        </div>
      )}

      {showDiscInfo && (
        <div style={{ marginTop: 12, padding: 16, background: "var(--bg3)", borderRadius: 14, border: "1px solid var(--border)", fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h4 style={{ fontSize: 15, fontWeight: 700 }}>Was ist Trennschärfe?</h4>
            <button onClick={() => setShowDiscInfo(false)} style={{ width: 24, height: 24, borderRadius: 12, border: "none", background: "var(--bg2)", color: "var(--text3)", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
          </div>
          <p style={{ marginBottom: 10 }}>
            Die Trennschärfe (punkt-biseriale Korrelation) misst, wie gut eine einzelne Frage zwischen leistungsstarken und leistungsschwachen Lernenden unterscheidet. <strong>Wertebereich:</strong> −1 bis +1
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontWeight: 700, color: C.success, minWidth: 72 }}>≥ 0.40</span><span>Gut — die Frage trennt zuverlässig.</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontWeight: 700, color: C.warning, minWidth: 72 }}>0.20–0.39</span><span>Akzeptabel — brauchbar, aber verbesserungsfähig.</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontWeight: 700, color: C.danger, minWidth: 72 }}>&lt; 0.20</span><span>Schwach — überarbeiten oder entfernen.</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontWeight: 700, color: C.danger, minWidth: 72 }}>Negativ</span><span>Starke Lernende antworten häufiger falsch!</span></div>
          </div>
          <p style={{ fontSize: 12, color: "var(--text3)", padding: "8px 12px", background: "var(--bg2)", borderRadius: 8 }}>Mindestens 3 beantwortete Bögen erforderlich.</p>
        </div>
      )}
    </div>
  );
}

// KI-Erklaerung — an zwei Stellen genutzt (obere Kachel und Fragetabelle),
// deshalb als Komponente statt doppeltem Markup.
function CiInfoBox({ onClose }) {
  return (
    <div style={{ marginTop: 12, padding: 16, background: "var(--bg3)", borderRadius: 14, border: "1px solid var(--border)", fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h4 style={{ fontSize: 15, fontWeight: 700 }}>Was ist das 95%-Konfidenzintervall (KI)?</h4>
        <button onClick={onClose} style={{ width: 24, height: 24, borderRadius: 12, border: "none", background: "var(--bg2)", color: "var(--text3)", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
      </div>
      <p style={{ marginBottom: 10 }}>
        Der Prozentwert „Richtig“ ist nur eine Stichprobe dieser einen Abfrage. Das Konfidenzintervall
        zeigt, in welchem Bereich der <strong>wahre</strong> Anteil richtiger Antworten mit 95% Wahrscheinlichkeit
        liegt, wenn man die Abfrage beliebig oft wiederholen könnte.
      </p>
      <p style={{ marginBottom: 0 }}>
        Je <strong>weniger</strong> Antworten vorliegen, desto <strong>breiter</strong> das Intervall — bei kleinen
        Klassen also Vorsicht bei der Interpretation einzelner Fragen. Ein enges Intervall bedeutet ein belastbares Ergebnis.
      </p>
      <p style={{ marginTop: 10, marginBottom: 0 }}>
        <strong>„95%-KI gesamt“</strong> oben fasst alle Antworten dieses Tests zusammen (alle Fragen gepoolt)
        und zeigt, wie belastbar das Gesamtergebnis des Quiz ist. Das KI <strong>pro Frage</strong> in der Tabelle
        unten basiert nur auf den Antworten zu dieser einen Frage in diesem Test — die frageübergreifende
        Statistik (alle jemals gegebenen Antworten) findest du beim Bearbeiten der Frage im Fragen-Bereich.
      </p>
    </div>
  );
}

// Zahlenfelder ohne die haesslichen nativen Spinner-Pfeile, sauber gerahmt.
const NUM_CSS = ".nice-num::-webkit-inner-spin-button,.nice-num::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}.nice-num{-moz-appearance:textfield;appearance:textfield}";
const numInput = { width: 48, padding: "6px 6px", fontSize: 13, border: "1px solid var(--border2)", borderRadius: 8, textAlign: "center", background: "var(--bg)", color: "var(--text)" };
// Noten-Nummer schlicht, ohne Kreis/Umrandung.
const gradeBadge = { flexShrink: 0, minWidth: 14, color: "var(--text)", fontSize: 14, fontWeight: 700, textAlign: "center" };

const th = { padding: "8px 10px", borderBottom: "2px solid var(--border3)", textAlign: "left", fontSize: 13, color: "var(--text)" };
const td = { padding: "8px 10px", borderBottom: "1px solid var(--border)" };

function Stat({ label, value, onClick, clickable, info }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "10px 16px", background: "var(--bg2)", borderRadius: 12, textAlign: "center",
        cursor: clickable ? "pointer" : "default",
        userSelect: "none",
        position: "relative",
        minWidth: 80,
      }}
    >
      {info && (
        <button
          onClick={(e) => { e.stopPropagation(); info(); }}
          style={{
            position: "absolute", top: 4, right: 4,
            width: 18, height: 18, borderRadius: 9, border: "none",
            background: "var(--border3)", color: "var(--text3)",
            fontSize: 11, fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            lineHeight: 1, padding: 0,
          }}
          title="Info"
        >i</button>
      )}
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--text3)" }}>{label}{clickable && " ⇄"}</div>
    </div>
  );
}

function StatBox({ label, value, color }) {
  return (
    <div style={{ padding: "10px 16px", background: "var(--bg2)", borderRadius: 10, textAlign: "center", minWidth: 100 }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: color || "#1d1d1f" }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>{label}</div>
    </div>
  );
}


// Dialog: CardVote-Testnoten in eine Kategorie des Notenmoduls uebernehmen.
function NotenImport({ sessionId, classId, sessionName, grades, onClose }) {
  const { t } = useLanguage();
  const heute = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`; };
  const [term, setTerm] = useState("1");
  const [sections, setSections] = useState([]);
  const [sectionId, setSectionId] = useState(null);
  // Standard-Spaltenname ist der Testname (nicht das Datum); ueber lang wird er
  // in der Notentabelle ohnehin per Ellipse gekuerzt. Fallback: heutiges Datum.
  const [colName, setColName] = useState((sessionName || "").trim() || heute());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/noten/classes/${classId}/sections?term=${term}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((secs) => {
        const list = secs || [];
        setSections(list);
        setSectionId(list.length ? list[0].id : null);
      })
      .catch(() => {});
  }, [classId, term]);

  const uebernehmen = async () => {
    setBusy(true); setError("");
    const res = await fetch("/api/noten/import-session", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, section_id: sectionId, column_name: colName.trim() || heute(), grades: grades.map((g) => ({ card_id: g.card_id, value: g.value })) }),
    });
    setBusy(false);
    if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b.detail || t("notenimp.failed")); return; }
    const b = await res.json();
    setDone(b.imported);
  };

  return (
    <div onClick={onClose} style={modalOverlay}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modalPanel, maxWidth: 460 }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{t("notenimp.title")}</h3>
        <p style={{ fontSize: 12.5, color: "var(--text3)", marginBottom: 16 }}>
          {t("notenimp.intro", { test: sessionName ? t("notenimp.testNamed", { name: sessionName }) : t("notenimp.testThis"), n: grades.length })}
        </p>

        {done !== null ? (
          <>
            <p style={{ fontSize: 14, color: C.success, marginBottom: 16 }}>
{t("notenimp.done", { n: done })}
            </p>
            <button onClick={onClose} style={btnPrimary}>{t("noten.close")}</button>
          </>
        ) : (
          <>
            {error && <p style={{ color: C.danger, fontSize: 13, marginBottom: 10 }}>{error}</p>}
            {(() => { const fld = { ...inputStyle, width: "100%" }; const lbl = { fontSize: 12.5, color: "var(--text2)", marginBottom: 6, marginTop: 12 }; return (
              <>
                <div style={{ ...lbl, marginTop: 0 }}>{t("noten.term")}</div>
                <select value={term} onChange={(e) => setTerm(e.target.value)} style={fld}>
                  <option value="1">{t("noten.term1")}</option>
                  <option value="2">{t("noten.term2")}</option>
                </select>

                <div style={lbl}>{t("notenimp.section")}</div>
                {sections.length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--text3)" }}>{t("notenimp.noSection")}</p>
                ) : (
                  <select value={sectionId ?? ""} onChange={(e) => setSectionId(Number(e.target.value))} style={fld}>
                    {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}

                <div style={lbl}>{t("notenimp.colName")}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={colName} onChange={(e) => setColName(e.target.value)} style={fld} />
                  <button onClick={() => setColName(heute())} style={{ ...btnSecondary, whiteSpace: "nowrap" }}>{t("noten.useDate")}</button>
                </div>
              </>
            ); })()}
            <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
              <button onClick={uebernehmen} disabled={busy || !sectionId} style={{ ...btnPrimary, opacity: busy || !sectionId ? 0.5 : 1 }}>
                {busy ? t("notenimp.importing") : t("notenimp.import")}
              </button>
              <button onClick={onClose} style={btnSecondary}>{t("common.abort")}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}


// Ziel 2: Loesungsquote je Thema. Schwache Themen zeigen, wo Uebung fehlt, und
// verlinken die passenden Aufgaben im Lernpfad — nur wenn Fragen ein Thema
// haben und das Modul aktiv ist. Reine Anzeige, kein Automatismus: die
// Lehrkraft entscheidet.
function TopicAnalysis({ questions, presentStudents }) {
  const { t } = useLanguage();
  const { modules } = useModules();
  const lernpfad = modules.find((m) => m.key === "lernpfad")?.active ?? false;
  const [topics, setTopics] = useState([]);
  const [exCount, setExCount] = useState({}); // topic_id -> Anzahl Aufgaben

  useEffect(() => {
    fetch("/api/topics").then((r) => (r.ok ? r.json() : [])).then((d) => setTopics(Array.isArray(d) ? d : [])).catch(() => {});
    if (lernpfad) {
      fetch("/api/lernpfad/exercises").then((r) => (r.ok ? r.json() : [])).then((exs) => {
        const c = {};
        (exs || []).forEach((e) => { if (e.topic_id) c[e.topic_id] = (c[e.topic_id] || 0) + 1; });
        setExCount(c);
      }).catch(() => {});
    }
  }, [lernpfad]);

  const withTopic = questions.filter((q) => q.topic_id);
  if (withTopic.length === 0) return null;

  const label = (id) => {
    const tp = topics.find((x) => x.id === id);
    if (!tp) return "?";
    const p = tp.parent_id ? topics.find((x) => x.id === tp.parent_id) : null;
    return p ? `${p.name} / ${tp.name}` : tp.name;
  };

  // Loesungsquote je Thema ueber alle anwesenden Personen.
  const byTopic = {};
  for (const q of withTopic) {
    byTopic[q.topic_id] ||= { correct: 0, total: 0 };
  }
  for (const st of presentStudents) {
    // st.answers ist wie questions nach answeredIndices gefiltert — Index passt.
    st.answers.forEach((a, i) => {
      const q = questions[i];
      if (!q || !q.topic_id || !a || !a.answer) return;
      byTopic[q.topic_id].total += 1;
      if (a.is_correct) byTopic[q.topic_id].correct += 1;
    });
  }
  const rows = Object.entries(byTopic).map(([tid, v]) => ({
    tid: Number(tid), pct: v.total ? Math.round((v.correct / v.total) * 100) : 0, total: v.total,
  })).filter((r) => r.total > 0).sort((a, b) => a.pct - b.pct);
  if (rows.length === 0) return null;

  // Kernaussage regelbasiert: schwaechste Themen benennen und eine Empfehlung
  // geben — die Zusammenfassung, die die Lehrkraft sonst selbst aus der Liste
  // ziehen muesste. Kein Automatismus, nur ein Satz.
  const weakRows = rows.filter((r) => r.pct < 60);
  const verdict = weakRows.length > 0
    ? t("analyse.verdictWeak", { list: weakRows.map((r) => `${label(r.tid)} (${r.pct}%)`).join(", ") })
    : t("analyse.verdictOk");

  return (
    <div style={{ padding: 16, background: "var(--card)", borderRadius: 14, border: "1px solid var(--border)", marginBottom: 16 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{t("analyse.title")}</h3>
      <p style={{ fontSize: 12.5, color: "var(--text3)", marginBottom: 12 }}>{t("analyse.intro")}</p>
      <p style={{
        fontSize: 13, lineHeight: 1.6, marginBottom: 12, padding: "10px 12px", borderRadius: 10,
        background: weakRows.length > 0 ? "rgba(184,134,11,0.10)" : "rgba(10,125,62,0.08)",
        border: `1px solid ${weakRows.length > 0 ? "rgba(184,134,11,0.35)" : "rgba(10,125,62,0.25)"}`,
      }}>{verdict}</p>
      {rows.map((r) => {
        const weak = r.pct < 60;
        const n = exCount[r.tid] || 0;
        return (
          <div key={r.tid} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
            <span style={{ flex: 1, minWidth: 140, fontSize: 13.5, fontWeight: weak ? 600 : 400 }}>{label(r.tid)}</span>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: weak ? C.danger : C.success, width: 48, textAlign: "right" }}>{r.pct}%</span>
            {weak && (
              <span style={{ fontSize: 12, color: C.warning, display: "flex", alignItems: "center", gap: 8 }}>
                {t("analyse.weak")}
                {lernpfad && (n > 0
                  ? <Link to="/lernpfad?tab=aufgaben" style={{ color: "var(--accent)", textDecoration: "none" }}>{t("analyse.exercisesN", { n })} →</Link>
                  : <span style={{ color: "var(--text3)" }}>{t("analyse.noExercises")}</span>)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Ziel-2-Brücke: schwache Themen aus dem Test → ein Übungs-Deck im Modul Karten
// anlegen (themengebunden, Entwurf). Nur wenn das Karten-Modul aktiv ist.
function WeakTopics({ sessionId, classId, karten, lernpfad, t }) {
  const [topics, setTopics] = useState([]);
  const [busy, setBusy] = useState(null);        // `${topic_id}:${art}`
  const [done, setDone] = useState({});          // { `${topic_id}:${art}`: true }

  useEffect(() => {
    fetch(`/api/sessions/${sessionId}/topic-stats`).then((r) => (r.ok ? r.json() : null))
      .then((d) => setTopics(d && Array.isArray(d.topics) ? d.topics : [])).catch(() => {});
  }, [sessionId]);

  // Schwach = unter 60 % Trefferquote.
  const schwach = topics.filter((tp) => tp.topic_id && tp.pct < 60);
  if (!schwach.length) return null;

  const run = async (tp, art, req) => {
    const key = `${tp.topic_id}:${art}`;
    setBusy(key);
    const r = await fetch(req.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req.body) }).catch(() => null);
    setBusy(null);
    if (r && r.ok) setDone((d) => ({ ...d, [key]: true }));
  };
  const deckAnlegen = (tp) => run(tp, "karten", { url: `/api/karten/classes/${classId}/decks`, body: { name: tp.name, topic_id: tp.topic_id } });
  const aufgabeAnlegen = (tp) => run(tp, "lernpfad", {
    url: `/api/lernpfad/exercises`,
    body: { topic_id: tp.topic_id, kategorie: "Basis", aufgabentext: t("weak.repTitle", { thema: tp.name }) },
  });

  const Btn = ({ tp, art, onClick, label }) => {
    const key = `${tp.topic_id}:${art}`;
    if (done[key]) return <span style={{ fontSize: 12.5, color: C.success, fontWeight: 600 }}>✓</span>;
    return (
      <button onClick={() => onClick(tp)} disabled={busy === key}
        style={{ ...btnSecondary, padding: "5px 12px", fontSize: 12.5, opacity: busy === key ? 0.6 : 1 }}>{label}</button>
    );
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)", padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t("weak.title")}</div>
      <div style={{ fontSize: 12.5, color: "var(--text3)", marginBottom: 12 }}>{t("weak.hint2")}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {schwach.map((tp) => (
          <div key={tp.topic_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 10, flexWrap: "wrap" }}>
            <span style={{ flex: 1, fontWeight: 600, minWidth: 120 }}>{tp.name}</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: tp.pct < 40 ? C.danger : C.warning }}>{tp.pct}%</span>
            {karten && <Btn tp={tp} art="karten" onClick={deckAnlegen} label={t("weak.makeDeck")} />}
            {lernpfad && <Btn tp={tp} art="lernpfad" onClick={aufgabeAnlegen} label={t("weak.makeExercise")} />}
          </div>
        ))}
      </div>
    </div>
  );
}
