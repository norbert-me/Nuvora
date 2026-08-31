import { useState, useEffect, useRef } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { useAktiv } from "../core/modules.js";
import AbschnittWahl from "../components/AbschnittWahl.jsx";
import { useLanguage } from "../i18n/index.jsx";
import Latex from "../components/Latex.jsx";
import { ANTWORT_COLORS, Boxplot, COLORS as C, CONTROL_R, ICONS, Icon, Modal, StatCard, Tabs, btnPrimary, btnSecondary, cardStyle, chipStyle, iconBtn, inputStyle, klebtLinks, pageApp, panelStyle, quoteFarbe, quoteFlaeche, td as tdBasis, th as thBasis, toolbarBtn } from "../components/Icons.jsx";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import Rueckmeldebogen from "../components/Rueckmeldebogen.jsx";
import Speicherleiste, { useEntwurf } from "../components/Speichern.jsx";
import { gradeFromPct, DEFAULT_SCALE } from "../core/grades.js";
import { bewerte, statusOf } from "../core/scoring.js";
import { mmss } from "../core/datum.js";
import { median, streuung as stddev } from "../core/statistik.js";
import { alsJson, hol } from "../core/melden.js";
import { useThemen } from "../core/topics.js";

const API = "/api";
// Antwortfarben A–D kommen aus dem Kern (ANTWORT_COLORS) — die Kopie hier war
// eine von dreien im Modul.

// median und stddev kommen aus core/statistik.js — beide standen hier
// zeichengleich noch einmal (und in grades.js, aufgabenstatistik.js,
// ClassEvaluation.jsx ein weiteres Mal).

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

// Boxplot liegt jetzt zentral in Icons.jsx (eine Quelle für CardVote,
// Klassen-Auswertung und Klassenarbeit). Hier nur noch importiert.

export default function Evaluation() {
  const { t } = useLanguage();
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [selectedQ, setSelectedQ] = useState(null);
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
  // Voreinstellung aus dem Profil (grade_tendency): mit Tendenz (2+) oder ganz.
  const [gradeMode, setGradeMode] = useState(() => { try { const u = JSON.parse(localStorage.getItem("user")); return u && u.grade_tendency === false ? "whole" : "tendency"; } catch { return "whole"; } }); // "whole" | "tendency"
  const aktiv = useAktiv();
  const notenAktiv = aktiv("auswertung");
  const kartenAktiv = aktiv("karten");
  const lernpfadAktiv = aktiv("lernpfad");
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
  // Lehrer-Übersicht nach Kursniveau filtern ("" = alle).
  const [niveauFilter, setNiveauFilter] = useState("");
  const [loadError, setLoadError] = useState(false);

  // Alles, was an dieser Auswertung einstellbar ist, ist EIN Entwurf mit EINER
  // Speicherleiste: Gewichte, Notenschluessel und die Einstufung krank/anwesend.
  // Vorher lief jede dieser Aenderungen nach 800 ms von selbst zum Server —
  // man sah nur ein kurzes „gespeichert" und hatte nichts in der Hand.
  const [gespeicherteConfig, setGespeicherteConfig] = useState({
    weights: {}, gradeScale: DEFAULT_SCALE, krank: [], anwesend: [],
  });
  // Was sonst noch in der Konfiguration steht (Zeiten aus der Live-Sitzung).
  // Die PUT ersetzt sie als Ganzes — ohne diese Kopie waeren sie nach dem
  // ersten Speichern weg.
  const restConfig = useRef({});
  const eConf = useEntwurf(gespeicherteConfig, async (wert) => {
    const r = await fetch(`${API}/sessions/${id}/eval-config`, alsJson("PUT", {
        ...restConfig.current,
        weights: wert.weights, grade_scale: wert.gradeScale,
        krank: wert.krank, anwesend: wert.anwesend,
      })).catch(() => null);
    if (!r || !r.ok) return false;
    setGespeicherteConfig(wert);
  });
  const { weights, gradeScale, krank: krankListe, anwesend: anwesendListe } = eConf.wert;

  // Nach dem Laden die Arbeitskopie auf den geladenen Stand setzen. `useEntwurf`
  // uebernimmt einen neuen Stand nur, wenn NICHTS offen ist — und beim ersten
  // Laden sieht die Voreinstellung neben der geladenen Konfiguration wie eine
  // offene Aenderung aus. Ohne diese Zeile stuende die Seite direkt nach dem
  // Aufruf auf „nicht gespeichert" und zeigte den Notenschluessel von vorher.
  const [ladeStand, setLadeStand] = useState(0);
  // Rueckmeldung je Kind (was sass, was fehlt). Eigener Aufruf statt aus der
  // Auswertung gerechnet: die Regeln (Schwellen, Mindestzahl an Fragen, wer als
  // krank gilt) stehen im Server (app/rueckmeldung.py) und werden vom Kind auf
  // seiner Seite genauso gelesen — zwei Rechnungen waeren zwei Wahrheiten.
  const [bogen, setBogen] = useState([]);
  useEffect(() => { if (ladeStand) eConf.verwerfen(); }, [ladeStand]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = setTimeout(() => { if (!data) setLoadError(true); }, 15000);
    Promise.all([
      fetch(`${API}/sessions/${id}/evaluation`).then((r) => r.json()),
      fetch(`${API}/sessions/${id}/eval-config`).then((r) => r.json()),
      fetch(`${API}/sessions/${id}/rueckmeldung`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([evalData, config, rm]) => {
      setBogen(rm && Array.isArray(rm.students) ? rm.students : []);
      clearTimeout(timer);
      if (evalData && evalData.questions && evalData.students) setData({ ...evalData, _evalConfig: config || {} });
      const { weights: _w, grade_scale: _g, krank: _k, anwesend: _a, ...rest } = config || {};
      restConfig.current = rest;
      let skala = (config && config.grade_scale) || null;
      if (!skala) {
        try {
          const user = JSON.parse(localStorage.getItem("user"));
          if (user && user.grade_scale) skala = user.grade_scale;
        } catch {}
      }
      setGespeicherteConfig({
        weights: (config && config.weights) || {},
        gradeScale: skala || DEFAULT_SCALE,
        krank: (config && Array.isArray(config.krank)) ? config.krank : [],
        anwesend: (config && Array.isArray(config.anwesend)) ? config.anwesend : [],
      });
      setLadeStand((n) => n + 1);
    });
  }, [id]);

  // Datei holen und speichern — dreimal dieselbe Zeile inline war einmal zu oft.
  const holen = async (url, dateiname) => {
    const r = await fetch(url);
    if (!r.ok) return;
    const b = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = dateiname;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Kind zwischen „krank" (aus der Wertung) und „anwesend" (0 zählt mit)
  // schalten — im Entwurf, gespeichert wird über die Leiste.
  const setStatus = (cardId, neu) => {
    const key = String(cardId);
    const krank = krankListe.map(String).filter((x) => x !== key);
    const anwesend = anwesendListe.map(String).filter((x) => x !== key);
    if (neu === "krank") krank.push(key); else anwesend.push(key);
    eConf.setz({ krank, anwesend });
  };

  const updateWeight = (qId, val) => {
    const num = Math.max(0, Number(String(val).replace(",", ".")));
    if (isNaN(num)) return;
    eConf.setz((v) => ({ weights: { ...v.weights, [qId]: num } }));
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
    eConf.setz({ gradeScale: next });
  };

  if (loadError && !data) return <p style={{ color: C.danger }}>{t("common.connectionError")}</p>;
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

  // E/G und Minuspunkte kommen vom Quiz; die Wertung selbst steht in
  // core/scoring.js (gleiche Regeln wie am Server).
  const niveauAktiv = !!data.niveau_aktiv;
  const minuspunkte = !!data.minuspunkte;
  const werte = (s) => bewerte(
    questions.map((q) => ({ id: q.id, correct_answer: q.correct_answer, niveau: q.niveau || "" })),
    Object.fromEntries(s.answers.map((a) => [a.question_id, a.answer])),
    { niveau: s.niveau || "", niveauAktiv, minuspunkte, weights, scale: gradeScale },
  );

  // „krank" bleibt aus jeder Wertung. Wer anwesend war und nichts abgegeben
  // hat, zählt mit 0 mit — umschaltbar je Kind (setStatus).
  const status = (s) => statusOf(s.card_id, s.present, { krank: krankListe, anwesend: anwesendListe });
  const presentStudents = students.filter((s) => status(s) === "anwesend").map((s) => {
    const w = werte(s);
    return { ...s, weightedScore: w.score, ownMax: w.maxScore, pct: w.pct, basePct: w.basePct, bonusPct: w.bonusPct, eCorrect: w.eCorrect, eTotal: w.eTotal };
  });

  const absentStudents = students.filter((s) => status(s) === "krank");

  const scores = presentStudents.map((s) => s.weightedScore);
  const pcts = presentStudents.map((s) => s.pct);
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  // Prozentwerte kommen aus der Wertung je Kind (bei E/G hat nicht jedes
  // dieselbe erreichbare Punktzahl) — nicht mehr aus einem gemeinsamen Maximum.
  const avgPct = pcts.length > 0 ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0;
  const medianScore = median(scores);
  const medianPct = pcts.length > 0 ? Math.round(median(pcts)) : 0;
  const sd = stddev(scores);
  const sdPct = pcts.length > 0 ? stddev(pcts) : 0;

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
      tips.push(t("cv.tipTooEasy", { n: tooEasy.length }));
    if (tooHard.length > 0)
      tips.push(t("cv.tipTooHard", { n: tooHard.length }));
    if (negDisc.length > 0)
      tips.push(t("cv.tipNegDisc", { n: negDisc.length }));
    if (lowDisc.length > 1)
      tips.push(t("cv.tipLowDisc", { n: lowDisc.length }));

    if (avgPct > 85) tips.push(t("cv.tipEasyOverall"));
    if (avgPct < 40) tips.push(t("cv.tipHardOverall"));

    if (sdPct < 10 && presentStudents.length >= 2)
      tips.push(t("cv.tipLowSpread", { sd: sdPct.toFixed(1) }));
    else if (sdPct > 25 && presentStudents.length >= 2) {
      if (avgPct < 50)
        tips.push(t("cv.tipHighSpreadLow", { sd: sdPct.toFixed(1) }));
      else if (avgPct > 80)
        tips.push(t("cv.tipHighSpreadHigh", { sd: sdPct.toFixed(1) }));
      else
        tips.push(t("cv.tipHighSpread", { sd: sdPct.toFixed(1) }));
    }

    // Decken- und Bodeneffekt
    if (presentStudents.length >= 3) {
      const ceilingCount = pcts.filter((p) => p >= 95).length;
      const floorCount = pcts.filter((p) => p <= 10).length;
      const ceilingPct = Math.round((ceilingCount / presentStudents.length) * 100);
      const floorPct = Math.round((floorCount / presentStudents.length) * 100);
      if (ceilingPct >= 40)
        tips.push(t("cv.tipCeiling", { n: ceilingCount, total: presentStudents.length, pct: ceilingPct }));
      if (floorPct >= 40)
        tips.push(t("cv.tipFloor", { n: floorCount, total: presentStudents.length, pct: floorPct }));
    }

    const absentPct = students.length > 0 ? Math.round((absentStudents.length / students.length) * 100) : 0;
    if (absentPct > 30 && students.length >= 5)
      tips.push(t("cv.tipAbsent", { pct: absentPct, n: absentStudents.length, total: students.length }));

    const onlyGuessing = questionStats.filter((s, i) => {
      if (!questions[i].correct_answer || s.answered < 3 || s.guessProb === null) return false;
      return Math.abs(s.pct / 100 - s.guessProb) < 0.1;
    });
    if (onlyGuessing.length > 0)
      tips.push(t("cv.tipGuessing", { n: onlyGuessing.length }));

    const avgGrade = presentStudents.length > 0
      ? pcts.reduce((sum, p) => sum + gradeFromPct(p, gradeScale), 0) / presentStudents.length
      : 0;
    if (avgGrade >= 4.5 && avgPct >= 40)
      tips.push(t("cv.tipGradeAvg", { avg: avgGrade.toFixed(1) }));

    return tips;
  })();

  const fmtDisc = (d) => {
    if (d === null) return "–";
    const v = d.toFixed(2);
    const color = d >= 0.4 ? C.success : d >= 0.2 ? C.warning : C.danger;
    const label = d >= 0.4 ? t("cv.discGood") : d >= 0.2 ? t("cv.discOk") : t("cv.discWeak");
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
      <div style={{ ...pageApp }}>
        <button onClick={() => setSelectedQ(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", fontSize: 13, fontWeight: 500, padding: "4px 0", marginBottom: 16, display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Icon d={ICONS.arrowLeft} size={14} /> {t("cv.backOverview")}
        </button>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>{t("cv.questionN", { n: qi + 1 })}</h2>
        <div style={{ fontSize: 16, color: "var(--text)", marginBottom: 24, padding: 16, background: "var(--bg2)", borderRadius: panelStyle.borderRadius, lineHeight: 1.5 }}>
          <Latex>{q.text}</Latex>
        </div>

        {q.image_url && (
          <div style={{ marginBottom: 16 }}>
            <img src={q.image_url} alt="" style={{ maxWidth: "100%", maxHeight: 200, borderRadius: CONTROL_R, border: "1px solid var(--border)" }} />
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24, maxWidth: 500 }}>
          {allKeys.map((k) => {
            const isCorrect = q.correct_answer && q.correct_answer.includes(k);
            const hasChoice = choiceKeys.includes(k);
            return (
              <div key={k} style={{
                padding: 12, borderRadius: CONTROL_R, fontSize: 14,
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

        <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
          <StatCard label={t("cv.statCorrect")} value={`${stat.pct}%`} color={quoteFarbe(stat.pct)} />
          <StatCard label={t("cv.statCi")} value={stat.ciLow !== null ? `${stat.ciLow}–${stat.ciHigh}%` : "–"} />
          <StatCard label={t("cv.statGuess")} value={stat.guessProb !== null ? `${Math.round(stat.guessProb * 100)}%` : "–"} />
          <StatCard label={t("cv.statDisc")} value={stat.discrimination !== null ? stat.discrimination.toFixed(2) : "–"}
            color={stat.discrimination !== null ? (stat.discrimination >= 0.4 ? C.success : stat.discrimination >= 0.2 ? C.warning : C.danger) : undefined} />
          <StatCard label={t("cv.statSd")} value={stat.itemSd !== null ? stat.itemSd.toFixed(2) : "–"} />
          <StatCard label={t("cv.statAnswered")} value={`${stat.answered} / ${presentStudents.length}`} />
          <StatCard label={t("cv.statWeight")} value={`×${getWeight(q.id)}`} />
          {timesData[String(q.id)] != null && (() => {
            const sek = timesData[String(q.id)];
            return <StatCard label={t("cv.statTime")} value={mmss(sek)} />;
          })()}
        </div>

        <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>{t("cv.answerDistribution")}</h3>
        {allKeys.map((k) => {
          const count = stat.answerCounts[k] || 0;
          const pct = stat.answered > 0 ? (count / stat.answered) * 100 : 0;
          const isCorrect = q.correct_answer && q.correct_answer.includes(k);
          return (
            <div key={k} style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
              <span style={{ width: 28, fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{k}</span>
              {/* Balken: der Radius rundet die Kappe der Grafik, kein
                  Bedienelement — deshalb Zahl statt Token. */}
              <div style={{ flex: 1, height: 28, background: "var(--bg2)", borderRadius: 6, overflow: "hidden" }}>
                <div style={{
                  height: "100%", width: `${pct}%`,
                  background: isCorrect ? C.success : ANTWORT_COLORS[k],
                  borderRadius: 6, display: "flex", alignItems: "center", paddingLeft: 8,
                  color: C.aufAkzent, fontSize: 13, fontWeight: 600, transition: "width 0.3s",
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
      <Link to="/cardvote/tests" style={{ color: "var(--text3)", textDecoration: "none", fontSize: 13, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 5 }}>
        <Icon d={ICONS.arrowLeft} size={14} /> {t("cv.backAllTests")}
      </Link>
      {notenDialog && (
        <NotenImport
          sessionId={Number(id)} classId={data.class_id} sessionName={data.session_name}
          grades={presentStudents.map((st) => ({
            card_id: st.card_id, name: st.name,
            value: gradeMode === "tendency"
              ? tendencyGrade(st.pct, gradeScale)
              : Math.round(gradeFromPct(st.pct, gradeScale) * 10) / 10,
          }))}
          onClose={() => setNotenDialog(false)}
        />
      )}
      <h2 style={{ marginTop: 8, fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{session_name || t("cv.sessionFallback", { id })}</h2>

      {/* Eine Werkzeugleiste wie ueberall: der eine Alltagsgriff (Note
          uebernehmen) sichtbar, die drei Exporte im Menue. Vorher standen hier
          fuenf Elemente nebeneinander. */}
      <Werkzeugleiste
        links={<Speicherleiste entwurf={eConf} klein />}
        mehr={[
          { key: "pdf", label: t("cv.exportPdf"), icon: ICONS.pdf, onClick: () => holen(`${API}/sessions/${id}/all-students-pdf`, `Auswertungen_${id}.pdf`) },
          { key: "xlsx", label: t("cv.exportExcel"), icon: ICONS.download, onClick: () => holen(`${API}/sessions/${id}/evaluation-xlsx`, `Auswertung_${id}.xlsx`) },
          { key: "csv", label: t("cv.exportIdoceo"), icon: ICONS.export, onClick: () => holen(`${API}/sessions/${id}/evaluation-scsv`, `CardVote_${id}.csv`) },
        ]}
      >
        {/* Nur sichtbar, wenn das Notenmodul aktiv ist — sonst fuehrt der
            Knopf ins Leere (Regel 3: CardVote haengt nicht von Noten ab). */}
        {notenAktiv && data.class_id && (
          <button onClick={() => setNotenDialog(true)} style={toolbarBtn}>
            {t("notenimp.button")}
          </button>
        )}
        {bogen.length > 0 && (
          <button onClick={() => window.print()} style={toolbarBtn} title={t("bogen.printHint")}>
            <Icon d={ICONS.print} size={15} /> {t("bogen.print")}
          </button>
        )}
      </Werkzeugleiste>

      {kartenAktiv && data.class_id && <WeakTopics sessionId={Number(id)} classId={data.class_id} karten={kartenAktiv} t={t} />}

      {/* Dasselbe Blatt wie zur Klassenarbeit, nur aus dem Quiz: was sass, was
          fehlt, je Kind eines. Der Bogen haengt per Portal am <body> und ist am
          Bildschirm unsichtbar (siehe Druck-CSS in index.html). */}
      {bogen.length > 0 && (
        <Rueckmeldebogen titel={data.session_name || t("cv.evaluation")} bogen={bogen}
          kartenAktiv={kartenAktiv} lernpfadAktiv={lernpfadAktiv} />
      )}

      {/* Statistik-Kacheln */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <Stat label={t("cv.statPresent")} value={`${presentStudents.length} / ${students.length}`} />
        <Stat
          label={avgMode === "pts" ? t("cv.statAvgPoints") : t("cv.statAvgPct")}
          value={avgMode === "pts" ? fmt(avgScore) : `${avgPct}%`}
          onClick={() => setAvgMode(avgMode === "pts" ? "pct" : "pts")}
          clickable
        />
        <Stat
          label={medMode === "pts" ? t("cv.statMedian") : t("cv.statMedianPct")}
          value={medMode === "pts" ? fmt(medianScore) : `${medianPct}%`}
          onClick={() => setMedMode(medMode === "pts" ? "pct" : "pts")}
          clickable
        />
        <Stat
          label={sdMode === "pts" ? t("cv.statSd") : t("cv.statSdPct")}
          value={sdMode === "pts" ? fmt(sd) : `${sdPct.toFixed(1)}%`}
          onClick={() => setSdMode(sdMode === "pts" ? "pct" : "pts")}
          clickable
          info={() => setShowSdInfo(!showSdInfo)}
        />
        {quizCi && (
          <Stat
            label={t("cv.statCiTotal")}
            value={`${quizCi.low}–${quizCi.high}%`}
            info={() => setShowCiTop(!showCiTop)}
          />
        )}
        {totalTime != null && (
          <Stat label={t("cv.statDuration")} value={mmss(totalTime)} />
        )}
      </div>

      {/* Std.abw. Erklärung */}
      {showSdInfo && (
        <div style={{ ...panelStyle, padding: 16, fontSize: 13, color: "var(--text)", lineHeight: 1.6, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h4 style={{ fontSize: 14, fontWeight: 700 }}>{t("cv.sdTitle")}</h4>
            <SchliessenBtn onClick={() => setShowSdInfo(false)} t={t} />
          </div>
          <p style={{ marginBottom: 12 }}>{t("cv.sdText")}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontWeight: 700, color: C.success, minWidth: 64 }}>σ &lt; 10%</span><span>{t("cv.sdLow")}</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontWeight: 700, color: C.warning, minWidth: 64 }}>10–25%</span><span>{t("cv.sdMid")}</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontWeight: 700, color: C.danger, minWidth: 64 }}>σ &gt; 25%</span><span>{t("cv.sdHigh")}</span></div>
          </div>
        </div>
      )}

      {/* KI-Erklaerung der oberen Kachel — direkt hier, nicht am Seitenende. */}
      {showCiTop && <CiInfoBox onClose={() => setShowCiTop(false)} />}

      {/* Notenverteilung / Boxplot toggle */}
      <div style={{ ...panelStyle, padding: 16, marginBottom: 12 }}>
        {/* Reiter aus dem Kern (Tabs) statt vier nachgebauter Pillen. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <Tabs value={gradeView} onChange={setGradeView}
            options={[["bar", t("cv.gradeDistribution")], ["box", t("cv.boxplot")]]} />
          {gradeView === "bar" && (
            <Tabs value={gradeMode} onChange={setGradeMode} style={{ marginLeft: "auto" }}
              options={[["whole", t("cv.wholeGrades")], ["tendency", t("cv.tendencyGrades")]]} />
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
                  <span style={{ fontSize: gradeMode === "tendency" ? 11 : 12, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>{count || ""}</span>
                  <div style={{
                    width: "100%", maxWidth: gradeMode === "tendency" ? 26 : 48, height: barH, minHeight: count > 0 ? 8 : 2,
                    background: count > 0 ? GRADE_COLORS[colorGrade] : "var(--border3)", borderRadius: "6px 6px 0 0", transition: "height 0.3s", opacity: count > 0 ? 0.85 : 0.3,
                  }} />
                  <span style={{ fontSize: gradeMode === "tendency" ? 11 : 13, fontWeight: 600, color: "var(--text3)", marginTop: 4, whiteSpace: "nowrap" }}>{gradeMode === "tendency" ? g.toFixed(1) : g}</span>
                </div>
              );
            })}
          </div>
        ) : (
          scores.length >= 3
            // Bei E/G ist die erreichbare Punktzahl je Kind verschieden — dann
            // ist Prozent die einzige gemeinsame Achse.
            ? (niveauAktiv ? <Boxplot values={pcts} max={100} /> : <Boxplot values={scores} max={maxScore} />)
            : <p style={{ fontSize: 13, color: "var(--text3)" }}>{t("cv.needThree")}</p>
        )}
      </div>

      {/* Notenschlüssel + Gewichtung */}
      {/* Notenschluessel und Gewichtung sind eine Auswahl, kein Paar loser
          Knoepfe — also `Tabs`. Ein erneuter Klick auf den offenen Reiter
          schliesst ihn wieder (dann ist keiner markiert). */}
      <Werkzeugleiste style={{ marginBottom: 12 }}
        links={
          <Tabs
            value={showScale ? "scale" : showWeights ? "weights" : ""}
            onChange={(v) => { setShowScale(v === "scale" && !showScale); setShowWeights(v === "weights" && !showWeights); }}
            options={[["scale", t("cv.gradeScale")], ["weights", t("cv.weights")]]}
          />
        }
      />

      {showScale && (
        <div style={{ ...cardStyle, marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>{t("cv.gradeScale")}</h3>
          <p style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>{t("cv.gradeScaleHint")}</p>
          <style>{NUM_CSS}</style>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(136px, 1fr))", gap: 8 }}>
            {[1, 2, 3, 4, 5].map((g) => (
              <div key={g} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: CONTROL_R, background: "var(--bg3)" }}>
                <span style={gradeBadge}>{g}</span>
                <span style={{ fontSize: 11, color: "var(--text3)" }}>{t("cv.from")}</span>
                <input className="nice-num" type="number" min="0" max="100" step="1"
                  value={Number(gradeScale[g])} onChange={(e) => updateScale(g, e.target.value)} style={numInput} />
                <span style={{ fontSize: 11, color: "var(--text3)" }}>%</span>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: "1px dashed var(--border2)", borderRadius: CONTROL_R }}>
              <span style={gradeBadge}>6</span>
              <span style={{ fontSize: 12, color: "var(--text3)" }}>{t("cv.below", { pct: gradeScale[5] })}</span>
            </div>
          </div>
        </div>
      )}

      {showWeights && (
        <div style={{ ...cardStyle, marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>{t("cv.weights")}</h3>
          <p style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>{t("cv.weightsHint")}</p>
          <style>{NUM_CSS}</style>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
            {questions.map((q, i) => (
              <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: CONTROL_R, background: "var(--bg3)" }}>
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
        <div style={{ ...panelStyle, padding: 16, background: "var(--warn-bg)", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Icon d={ICONS.bulb} size={18} color="var(--text2)" />
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{t("cv.suggestions")}</h3>
          </div>
          {suggestions.map((tip, i) => (
            <div key={i} style={{ fontSize: 13, color: "var(--text)", marginBottom: 8, lineHeight: 1.5, paddingLeft: 12, borderLeft: `2px solid ${C.warning}` }}>
              {tip}
            </div>
          ))}
        </div>
      )}

      <TopicAnalysis questions={questions} presentStudents={presentStudents} />

      {/* Filter nach Kursniveau. Bewusst kein gemeinsames Ranking über beide
          Niveaus — die Maßstäbe sind verschieden. */}
      {niveauAktiv && (
        <Werkzeugleiste style={{ marginBottom: 12 }}
          links={<>
            <span style={{ fontSize: 13, color: "var(--text3)" }}>{t("eval.niveauFilter")}</span>
            <Tabs value={niveauFilter} onChange={setNiveauFilter}
              options={[["", t("eval.niveauAll")], ["E", "E"], ["G", "G"]]} />
          </>}
        />
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 14, whiteSpace: "nowrap" }}>
          <thead>
            <tr>
              <th style={th}>{t("cv.thName")}</th>
              {questions.map((q, i) => (
                <th key={q.id}
                  onClick={() => setSelectedQ(i)}
                  style={{ ...th, writingMode: "vertical-lr", textAlign: "left", maxWidth: 30, height: 120, fontSize: 12, padding: "4px 2px", cursor: "pointer", color: "var(--accent)" }}
                  title={t("cv.questionDetailHint", { text: q.text })}>
                  F{i + 1}{getWeight(q.id) !== 1 ? ` (×${getWeight(q.id)})` : ""}{niveauAktiv && (q.niveau || "") === "E" ? " · E" : ""}
                </th>
              ))}
              <th style={{ ...th, background: "var(--bg2)" }}>{t("cv.thPoints")}</th>
              <th style={{ ...th, background: "var(--bg2)" }}>%</th>
              <th style={{ ...th, background: "var(--bg2)" }}>{t("cv.thGrade")}</th>
            </tr>
            <tr style={{ background: "var(--bg2)" }}>
              <td style={{ ...td, fontWeight: "bold", color: "var(--text3)", fontSize: 12 }}>{t("cv.thSolution")}</td>
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
            {presentStudents
              .filter((s) => !niveauFilter || (s.niveau || "G") === niveauFilter)
              .map((student) => {
              const pct = Math.round(student.pct);
              const grade = gradeFromPct(pct, gradeScale);
              return (
                <tr key={student.card_id}>
                  <td style={{ ...td, ...klebtLinks, fontWeight: "bold" }}>
                    <a
                      href="#"
                      onClick={async (e) => { e.preventDefault(); const r = await fetch(`${API}/sessions/${id}/student-pdf/${student.card_id}`); if (!r.ok) return; const b = await r.blob(); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `${student.name}_${id}.pdf`; a.click(); URL.revokeObjectURL(a.href); }}
                      style={{ color: "var(--text)", textDecoration: "none" }}
                      title={t("cv.downloadPdf")}
                    >
                      {student.name}{" "}
                      <Icon d={ICONS.download} size={15} color="var(--text3)" />
                    </a>
                    {/* Kursniveau steht immer neben dem Ergebnis, nicht nur bei
                        differenzierten Quizzen — die Note ist ohne es nicht lesbar. */}
                    {student.niveau && (
                      <span style={{ ...chipStyle, marginLeft: 8 }} title={t("eval.niveauBadgeHint")}>
                        {student.niveau}
                      </span>
                    )}
                    {!student.present && (
                      <button onClick={() => setStatus(student.card_id, "krank")}
                        title={t("eval.markSick")}
                        style={{ marginLeft: 6, background: "none", border: "none", cursor: "pointer", color: "var(--text3)", fontSize: 11, fontWeight: 600, padding: 0 }}>
                        {t("eval.noSubmission")}
                      </button>
                    )}
                  </td>
                  {student.answers.map((a, i) => (
                    <td
                      key={questions[i].id}
                      style={{
                        ...td,
                        textAlign: "center",
                        fontWeight: "bold",
                        background: a.answer == null ? "var(--bg2)"
                          : a.is_correct ? "var(--success-bg)"
                          : a.correct_answer ? "var(--danger-bg)"
                          : "var(--card)",
                        color: a.answer == null ? "var(--text3)"
                          : a.is_correct ? C.success
                          : a.correct_answer ? C.danger
                          : "var(--text)",
                      }}
                    >
                      {a.answer || "–"}
                    </td>
                  ))}
                  <td style={{ ...td, textAlign: "center", fontWeight: "bold", background: "var(--bg2)" }}>
                    {fmt(student.weightedScore)} / {fmt(student.ownMax)}
                  </td>
                  <td style={{
                    ...td, textAlign: "center", fontWeight: "bold",
                    ...quoteFlaeche(pct),
                  }}>
                    {student.ownMax > 0 ? `${pct}%` : "–"}
                    {/* Bonus aus richtigen E-Fragen — sichtbar, damit die Note nachvollziehbar bleibt. */}
                    {student.bonusPct > 0 && (
                      <span style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text3)" }}
                        title={t("eval.bonusHint", { n: student.eCorrect, total: student.eTotal })}>
                        +{Math.round(student.bonusPct)} E
                      </span>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: "center", fontWeight: 700, color: GRADE_COLORS[Math.round(grade)] }}>
                    {student.ownMax > 0 ? grade.toFixed(1) : "–"}
                  </td>
                </tr>
              );
            })}

            {absentStudents.length > 0 && (
              <tr>
                <td colSpan={questions.length + 4} style={{ ...td, paddingTop: 12, borderBottom: "none" }}>
                  <span style={{ color: "var(--text3)", fontSize: 12, fontStyle: "italic" }}>{t("cv.absentLabel")}</span>
                </td>
              </tr>
            )}
            {absentStudents.map((student) => (
              <tr key={student.card_id} style={{ opacity: 0.4 }}>
                <td style={{ ...td, ...klebtLinks, fontWeight: "bold", fontStyle: "italic" }}>
                  {student.name}
                  {/* Doch anwesend: dann zählt die fehlende Abgabe als 0 mit. */}
                  <button onClick={() => setStatus(student.card_id, "anwesend")}
                    style={{ marginLeft: 8, background: "none", border: "none", cursor: "pointer", color: "var(--accent)", fontSize: 11, fontWeight: 600, padding: 0, fontStyle: "normal" }}>
                    {t("eval.markPresent")}
                  </button>
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
              <td style={{ ...td, fontWeight: "bold", color: "var(--text3)", fontSize: 12 }}>{t("cv.statCorrect")}</td>
              {questionStats.map((stat, i) => (
                <td key={i} style={{ ...td, textAlign: "center", fontSize: 12, fontWeight: "bold", color: quoteFarbe(stat.pct) }}>
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
                  {t("cv.statCi")} <Icon d={ICONS.info} size={12} color="var(--accent)" />
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
                  {t("cv.statGuess")} <Icon d={ICONS.info} size={12} color="var(--accent)" />
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
                  {t("cv.statDisc")} <Icon d={ICONS.info} size={12} color="var(--accent)" />
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
        <div style={{ ...panelStyle, marginTop: 12, padding: 16, fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h4 style={{ fontSize: 14, fontWeight: 700 }}>{t("cv.rateTitle")}</h4>
            <SchliessenBtn onClick={() => setShowRateInfo(false)} t={t} />
          </div>
          <p style={{ marginBottom: 12 }}>{t("cv.rateText")}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {[[2, "50%"], [3, "33%"], [4, "25%"]].map(([n, pct]) => (
              <div key={n} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700, minWidth: 90 }}>{t("cv.nAnswers", { n })}</span><span>{pct}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: "var(--text3)", padding: "8px 12px", background: "var(--bg2)", borderRadius: panelStyle.borderRadius }}>{t("cv.rateHint")}</p>
        </div>
      )}

      {showDiscInfo && (
        <div style={{ ...panelStyle, marginTop: 12, padding: 16, fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h4 style={{ fontSize: 14, fontWeight: 700 }}>{t("cv.discTitle")}</h4>
            <SchliessenBtn onClick={() => setShowDiscInfo(false)} t={t} />
          </div>
          <p style={{ marginBottom: 12 }}>{t("cv.discText")}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontWeight: 700, color: C.success, minWidth: 72 }}>≥ 0.40</span><span>{t("cv.discRowGood")}</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontWeight: 700, color: C.warning, minWidth: 72 }}>0.20–0.39</span><span>{t("cv.discRowOk")}</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontWeight: 700, color: C.danger, minWidth: 72 }}>&lt; 0.20</span><span>{t("cv.discRowWeak")}</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontWeight: 700, color: C.danger, minWidth: 72 }}>{t("cv.discRowNegLabel")}</span><span>{t("cv.discRowNeg")}</span></div>
          </div>
          <p style={{ fontSize: 12, color: "var(--text3)", padding: "8px 12px", background: "var(--bg2)", borderRadius: panelStyle.borderRadius }}>{t("cv.discMin")}</p>
        </div>
      )}
    </div>
  );
}

// KI-Erklaerung — an zwei Stellen genutzt (obere Kachel und Fragetabelle),
// deshalb als Komponente statt doppeltem Markup.
function CiInfoBox({ onClose }) {
  const { t } = useLanguage();
  return (
    <div style={{ ...panelStyle, marginTop: 12, padding: 16, fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h4 style={{ fontSize: 14, fontWeight: 700 }}>{t("cv.ciTitle")}</h4>
        <SchliessenBtn onClick={onClose} t={t} />
      </div>
      <p style={{ marginBottom: 12 }}>{t("cv.ciText1")}</p>
      <p style={{ marginBottom: 0 }}>{t("cv.ciText2")}</p>
      <p style={{ marginTop: 10, marginBottom: 0 }}>{t("cv.ciText3")}</p>
    </div>
  );
}

// Zahlenfelder ohne die haesslichen nativen Spinner-Pfeile, sauber gerahmt.
const NUM_CSS = ".nice-num::-webkit-inner-spin-button,.nice-num::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}.nice-num{-moz-appearance:textfield;appearance:textfield}";
const numInput = { ...inputStyle, width: 48, padding: "6px", fontSize: 13, borderRadius: CONTROL_R, textAlign: "center" };
// Noten-Nummer schlicht, ohne Kreis/Umrandung.
const gradeBadge = { flexShrink: 0, minWidth: 14, color: "var(--text)", fontSize: 14, fontWeight: 700, textAlign: "center" };

// Aus dem Kern abgeleitet: linksbuendig und luftiger, sonst identisch.
const th = { ...thBasis, padding: "8px 10px", borderBottom: "2px solid var(--border3)", textAlign: "left", fontSize: 13, color: "var(--text)" };
const td = { ...tdBasis, padding: "8px 10px", textAlign: "left" };

// Dieselbe Kachel wie ueberall: die Optik kommt aus `StatCard` (Icons.jsx).
// Hier kommt nur dazu, was diese Seite braucht — anklickbar (Punkte/Prozent
// umschalten) und ein „i". Vorher stand hier eine zweite, handgebaute Kachel
// direkt neben der importierten, mit demselben Aussehen und eigenen Werten.
function Stat({ label, value, onClick, clickable, info }) {
  const { t } = useLanguage();
  return (
    <div onClick={onClick}
      style={{ position: "relative", cursor: clickable ? "pointer" : "default", userSelect: "none" }}>
      <StatCard
        value={value}
        label={<>{label}{clickable && <Icon d={ICONS.swap} size={12} color="var(--text3)" />}</>}
      />
      {info && (
        <button
          onClick={(e) => { e.stopPropagation(); info(); }}
          className="icon-btn"
          style={{ ...iconBtn, position: "absolute", top: 4, right: 4, padding: 2, borderRadius: chipStyle.borderRadius, background: "var(--border3)" }}
          title={t("cv.info")}
        ><Icon d={ICONS.info} size={12} color="var(--text3)" /></button>
      )}
    </div>
  );
}

// Schliessen-Kreuz der Erklaerkaesten: viermal dasselbe Inline-SVG, jetzt einmal
// und aus ICONS.
function SchliessenBtn({ onClick, t }) {
  return (
    <button onClick={onClick} className="icon-btn" title={t("common.close")} aria-label={t("common.close")}
      style={{ ...iconBtn, padding: 4, background: "var(--bg2)", color: "var(--text3)" }}>
      <Icon d={ICONS.close} size={13} />
    </button>
  );
}


// Dialog: CardVote-Testnoten in eine Kategorie des Notenmoduls uebernehmen.
function NotenImport({ sessionId, classId, sessionName, grades, onClose }) {
  const { t } = useLanguage();
  const heute = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`; };
  const [sectionId, setSectionId] = useState(null);
  // Standard-Spaltenname ist der Testname (nicht das Datum); ueber lang wird er
  // in der Notentabelle ohnehin per Ellipse gekuerzt. Fallback: heutiges Datum.
  const [colName, setColName] = useState((sessionName || "").trim() || heute());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState("");

  const uebernehmen = async () => {
    setBusy(true); setError("");
    const res = await fetch("/api/noten/import-session", alsJson("POST", { session_id: sessionId, section_id: sectionId, column_name: colName.trim() || heute(), grades: grades.map((g) => ({ card_id: g.card_id, value: g.value })) }));
    setBusy(false);
    if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b.detail || t("notenimp.failed")); return; }
    const b = await res.json();
    setDone(b.imported);
  };

  return (
    <Modal onClose={onClose} width={460} label={t("notenimp.title")}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{t("notenimp.title")}</h3>
        <p style={{ fontSize: 13, color: "var(--text3)", marginBottom: 16 }}>
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
            {error && <p style={{ color: C.danger, fontSize: 13, marginBottom: 12 }}>{error}</p>}
            {(() => { const fld = { ...inputStyle, width: "100%" }; const lbl = { fontSize: 13, color: "var(--text2)", marginBottom: 6, marginTop: 12 }; return (
              <>
                <AbschnittWahl classId={classId} value={sectionId} onChange={setSectionId} />

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
    </Modal>
  );
}


// Ziel 2: Loesungsquote je Thema. Schwache Themen zeigen, wo Uebung fehlt, und
// verlinken die passenden Aufgaben im Lernpfad — nur wenn Fragen ein Thema
// haben und das Modul aktiv ist. Reine Anzeige, kein Automatismus: die
// Lehrkraft entscheidet.
function TopicAnalysis({ questions, presentStudents }) {
  const { t } = useLanguage();
  const aktiv = useAktiv();
  const lernpfad = aktiv("lernpfad");
  // Kern-Themen aus core/topics.js — dieselbe Zeile stand auf sechs Seiten.
  const topics = useThemen();
  const [exCount, setExCount] = useState({}); // topic_id -> Anzahl Aufgaben

  useEffect(() => {
    if (lernpfad) {
      hol("/api/lernpfad/exercises").then((exs) => {
        const c = {};
        (exs || []).forEach((e) => { if (e.topic_id) c[e.topic_id] = (c[e.topic_id] || 0) + 1; });
        setExCount(c);
      });
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

  // Kein Satz mehr, der die Liste darunter noch einmal vorliest ("Unter 60 %
  // liegen: …"). Die Liste ist nach Quote sortiert, rot eingefaerbt und
  // beschriftet — wer sie ansieht, sieht dasselbe schneller.

  return (
    <div style={{ ...cardStyle, marginBottom: 16 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t("analyse.title")}</h3>
      <p style={{ fontSize: 13, color: "var(--text3)", marginBottom: 12 }}>{t("analyse.intro")}</p>
      {rows.map((r) => {
        const weak = r.pct < 60;
        const n = exCount[r.tid] || 0;
        return (
          <div key={r.tid} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
            <span style={{ flex: 1, minWidth: 140, fontSize: 14, fontWeight: weak ? 600 : 400 }}>{label(r.tid)}</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: weak ? C.danger : C.success, width: 48, textAlign: "right" }}>{r.pct}%</span>
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
function WeakTopics({ sessionId, classId, karten, t }) {
  const [topics, setTopics] = useState([]);
  const [busy, setBusy] = useState(null);        // topic_id
  // Was angelegt wurde, samt Ziel: { topic_id: deckId }. Ein Haken allein sagte
  // nur „passiert" — das Deck ist leer und will gefuellt werden, und der Weg
  // dorthin war ein Modulwechsel und eine Suche in der Stapelliste.
  const [angelegt, setAngelegt] = useState({});

  useEffect(() => {
    hol(`/api/sessions/${sessionId}/topic-stats`, null)
      .then((d) => setTopics(d && Array.isArray(d.topics) ? d.topics : []));
  }, [sessionId]);

  // Schwach = unter 60 % Trefferquote.
  const schwach = topics.filter((tp) => tp.topic_id && tp.pct < 60);
  if (!schwach.length) return null;

  const deckAnlegen = async (tp) => {
    setBusy(tp.topic_id);
    const r = await fetch(`/api/karten/classes/${classId}/decks`,
      alsJson("POST", { name: tp.name, topic_id: tp.topic_id })).catch(() => null);
    const d = r && r.ok ? await r.json().catch(() => null) : null;
    setBusy(null);
    if (d && d.id) setAngelegt((a) => ({ ...a, [tp.topic_id]: d.id }));
  };

  return (
    <div style={{ ...cardStyle, marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t("weak.title")}</div>
      <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 12 }}>{t("weak.hint")}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {schwach.map((tp) => (
          <div key={tp.topic_id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: CONTROL_R, flexWrap: "wrap" }}>
            <span style={{ flex: 1, fontWeight: 600, minWidth: 120 }}>{tp.name}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: tp.pct < 40 ? C.danger : C.warning }}>{tp.pct}%</span>
            {/* Nur noch das Karten-Deck. Die "Lernpfad-Aufgabe" legte eine
                Aufgabe mit einem Titel und ohne Inhalt an — ein Platzhalter,
                den man danach ohnehin von Hand ausfuellen musste. */}
            {karten && (angelegt[tp.topic_id]
              ? (
                <Link to={`/karten?class=${classId}&deck=${angelegt[tp.topic_id]}`}
                  style={{ ...toolbarBtn, display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none", color: "var(--accent)" }}>
                  <Icon d={ICONS.check} size={15} color={C.success} /> {t("weak.toDeck")}
                </Link>
              )
              : (
                <button onClick={() => deckAnlegen(tp)} disabled={busy === tp.topic_id}
                  style={{ ...toolbarBtn, opacity: busy === tp.topic_id ? 0.6 : 1 }}>{t("weak.makeDeck")}</button>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
