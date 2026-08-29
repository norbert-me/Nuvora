import { useState, useEffect, useRef } from "react";
import {
  ANTWORT_COLORS, COLORS as C, Icon, ICONS, PODIUM_COLORS, Tabs, chipStyle, panelStyle,
  sectionLabel, selectStyle, th as thBasis, toolbarIconBtn, cardStyle, CONTROL_R,
  btnPrimary as btnPrimaryKern, btnSecondary as btnSecondaryKern, btnSmall,
} from "../components/Icons.jsx";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import { askPrompt } from "../core/dialog.jsx";
import { useParams, useNavigate } from "react-router-dom";
import Latex from "../components/Latex.jsx";
import { useLanguage } from "../i18n/index.jsx";
import KursKlasseSelect from "../components/KursKlasseSelect.jsx";
import { mmss } from "../core/datum.js";
import { alsJson } from "../core/melden.js";

const API = "/api";
// Antwort- und Podiumsfarben kommen aus dem Kern (ANTWORT_COLORS,
// PODIUM_COLORS) — hier standen sie doppelt, die Podiumsfarben sogar zweimal
// in derselben Datei.

// Gamepad und Pokal kommen jetzt aus ICONS. Geblieben sind die zwei Bilder,
// die `Icon` nicht zeichnen kann, weil sie eine FLAECHE brauchen:
// die Flamme (Serie) und die Medaille (Platzzahl im farbigen Kreis).
const SvgMedal = ({ place, size = 24 }) => {
  const c = PODIUM_COLORS[place] || PODIUM_COLORS[2];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: "inline-block", verticalAlign: "-4px" }}>
      <circle cx="12" cy="14" r="7" fill={c} opacity="0.2" stroke={c} strokeWidth="1.5"/>
      <text x="12" y="18" textAnchor="middle" fontSize="10" fontWeight="700" fill={c}>{place + 1}</text>
      <path d="M8 2l4 8 4-8" stroke={c} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
};

export default function Session() {
  const { t } = useLanguage();
  const { id } = useParams();
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState(id ? Number(id) : null);
  const [sessionCode, setSessionCode] = useState("");
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);
  const [kurse, setKurse] = useState([]);
  const [folders, setFolders] = useState([]);
  const [selectedSet, setSelectedSet] = useState(null);
  const [showAnswers, setShowAnswers] = useState(false);
  const [gameMode, setGameMode] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timeLeft, setTimeLeft] = useState(null);
  const timerRef = useRef(null);
  const [questions, setQuestions] = useState([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [question, setQuestion] = useState(null);
  const [counts, setCounts] = useState({ A: 0, B: 0, C: 0, D: 0 });
  const [scannedStudents, setScannedStudents] = useState([]);
  const [revealed, setRevealed] = useState(false);
  const [started, setStarted] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [resumeQid, setResumeQid] = useState(null);
  const [finished, setFinished] = useState(false);
  const [muted, setMuted] = useState(() => localStorage.getItem("nuvora_session_muted") === "1");
  const [volume, setVolume] = useState(() => { const v = parseFloat(localStorage.getItem("nuvora_session_volume")); return Number.isFinite(v) ? v : 0.5; });
  const audioCtxRef = useRef(null);
  const [allScans, setAllScans] = useState({});
  const [questionTimes, setQuestionTimes] = useState({});
  const [scores, setScores] = useState({});
  const [streaks, setStreaks] = useState({});
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const questionStartRef = useRef(null);
  const sessionStartRef = useRef(null);
  const wsRef = useRef(null);

  const [activeSessions, setActiveSessions] = useState([]);

  useEffect(() => {
    fetch(`${API}/classes`).then((r) => r.ok ? r.json() : []).then((d) => setClasses(Array.isArray(d) ? d : []));
    fetch(`${API}/kurse`).then((r) => r.ok ? r.json() : []).then((d) => setKurse(Array.isArray(d) ? d : []));
    fetch(`${API}/folders`).then((r) => r.ok ? r.json() : []).then((d) => setFolders(Array.isArray(d) ? d : []));
    fetch(`${API}/sessions/active`).then((r) => r.ok ? r.json() : []).then((d) => setActiveSessions(Array.isArray(d) ? d : []));
  }, []);

  const shuffleArray = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };

  const shuffleChoices = (q) => {
    const keys = ["A", "B", "C", "D"].slice(0, q.num_choices || 4);
    const shuffled = shuffleArray(keys);
    const newChoices = {}; const answerMap = {};
    shuffled.forEach((origKey, i) => { const newKey = keys[i]; newChoices[newKey] = q.choices[origKey]; answerMap[origKey] = newKey; });
    const newCorrect = q.correct_answer ? [...q.correct_answer].map((c) => answerMap[c] || c).sort().join("") : q.correct_answer;
    const newImages = q.choice_images ? Object.fromEntries(shuffled.map((origKey, i) => [keys[i], q.choice_images[origKey]]).filter(([, v]) => v)) : q.choice_images;
    return { ...q, choices: newChoices, correct_answer: newCorrect, choice_images: newImages || null };
  };

  const startSession = async () => {
    if (!selectedClass || !selectedSet) return;
    const prefix = gameMode ? "Game: " : "";
    const res = await fetch(`${API}/sessions`, alsJson("POST", {
        name: `${prefix}${selectedClass.name} — ${selectedSet.name}`,
        class_id: selectedClass.id,
        question_set_id: selectedSet.id,
        mode: gameMode ? "game" : "test",
      }));
    const s = await res.json();
    setSessionId(s.id);
    setSessionCode(s.code || String(s.id).padStart(4, "0"));
    let qs = selectedSet.questions;
    if (gameMode || selectedSet.shuffle_questions) qs = shuffleArray(qs);
    if (selectedSet.shuffle_answers) qs = qs.map(shuffleChoices);
    setQuestions(qs);
    if (selectedSet.shuffle_answers || selectedSet.shuffle_questions || gameMode) {
      const qmap = {};
      qs.forEach((q) => { qmap[String(q.id)] = q.correct_answer || ""; });
      fetch(`${API}/sessions/${s.id}/question-map`, alsJson("PUT", qmap));
    }
    if (gameMode && timerSeconds === 0) setTimerSeconds(0);
  };

  const resumeSession = async (s) => {
    setSessionId(s.id);
    setSessionCode(s.code || String(s.id).padStart(4, "0"));
    setGameMode(s.mode === "game");
    const cls = classes.find((c) => c.id === s.class_id);
    if (cls) setSelectedClass(cls);
    if (s.set_name) setSelectedSet({ name: s.set_name });
    if (s.question_set_id) {
      const res = await fetch(`${API}/question-sets/${s.question_set_id}`);
      if (res.ok) {
        const qs = await res.json();
        setSelectedSet(qs);
        setQuestions(qs.questions || []);
        if (s.current_question_id && qs.questions) {
          const idx = qs.questions.findIndex((q) => q.id === s.current_question_id);
          if (idx >= 0) {
            setQuestionIndex(idx);
            setQuestion(qs.questions[idx]);
          }
          const scanRes = await fetch(`${API}/sessions/${s.id}/results?question_id=${s.current_question_id}`);
          if (scanRes.ok) {
            const scanData = await scanRes.json();
            setScannedStudents((scanData.scans || []).map((sc) => ({ student_id: sc.student_id, answer: sc.answer, time: Date.now() })));
            setCounts(scanData.counts || {});
          }
        }
      }
    }
    // NICHT direkt in die Live-Ansicht springen: erst die Beitrittsseite mit QR
    // zeigen, damit die Handys wieder scannen koennen. Von dort geht es weiter.
    setResumeQid(s.current_question_id || null);
    setResuming(true);
    sessionStartRef.current = Date.now();
    questionStartRef.current = Date.now();
  };

  // Fortsetzen aus der Beitrittsseite: an der zuletzt aktiven Frage weiter,
  // und sie erneut an die Handys senden.
  const continueResumed = () => {
    setResuming(false);
    setStarted(true);
    const idx = resumeQid ? questions.findIndex((q) => q.id === resumeQid) : -1;
    activateQuestion(idx >= 0 ? idx : 0);
  };


  useEffect(() => {
    if (!sessionId) return;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/session/${sessionId}`);
    wsRef.current = ws;
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "auth", token: localStorage.getItem("token") || "" }));
    });
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "scan") {
        setScannedStudents((prev) => {
          const filtered = prev.filter((s) => s.student_id !== data.student_id);
          return [...filtered, { student_id: data.student_id, answer: data.answer, time: Date.now() }];
        });
      }
      if (data.type === "results") setCounts(data.counts);
      if (data.type === "remote") {
        if (data.action === "reveal") revealRef.current?.();
        else if (data.action === "hide") hideRef.current?.();
        else if (data.action === "next") nextRef.current?.();
        else if (data.action === "finish") finishRef.current?.();
      }
    };
    return () => ws.close();
  }, [sessionId]);

  const saveQuestionTime = () => {
    if (question && questionStartRef.current) {
      const elapsed = Math.round((Date.now() - questionStartRef.current) / 1000);
      setQuestionTimes((prev) => ({ ...prev, [question.id]: elapsed }));
    }
  };

  // Kurzer Signalton per WebAudio (keine Assets). Stumm ueber den Mute-Knopf.
  const beep = (freq, dur = 0.13) => {
    if (muted) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!audioCtxRef.current) audioCtxRef.current = new AC();
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") ctx.resume();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      const peak = Math.max(0.0002, volume * 0.45);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(peak, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + dur);
    } catch { /* Audio nicht verfuegbar */ }
  };
  const toggleMute = () => setMuted((m) => { const n = !m; localStorage.setItem("nuvora_session_muted", n ? "1" : "0"); return n; });
  const changeVolume = (v) => { setVolume(v); localStorage.setItem("nuvora_session_volume", String(v)); if (v > 0 && muted) toggleMute(); };

  const activateQuestion = async (idx) => {
    const q = questions[idx];
    if (!q || !sessionId) return;
    saveQuestionTime();
    beep(523.25);
    await fetch(`${API}/sessions/${sessionId}/set-question?question_id=${q.id}`, { method: "POST" });
    setQuestion(q);
    setQuestionIndex(idx);
    setCounts({ A: 0, B: 0, C: 0, D: 0 });
    setScannedStudents([]);
    setRevealed(false);
    setShowLeaderboard(false);
    broadcastState(false, idx + 1 >= questions.length);
    questionStartRef.current = Date.now();
    if (timerRef.current) clearInterval(timerRef.current);
    const t = timerSeconds;
    if (t > 0) {
      setTimeLeft(t);
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) { clearInterval(timerRef.current); return 0; }
          return prev - 1;
        });
      }, 1000);
    } else {
      setTimeLeft(null);
    }
  };

  const saveCurrentScans = () => {
    if (question) {
      setAllScans((prev) => ({
        ...prev,
        [question.id]: { counts: { ...counts }, scanned: [...scannedStudents] },
      }));
    }
  };

  const calculatePoints = () => {
    if (!question || !question.correct_answer) return;
    const correctAnswer = question.correct_answer;
    const elapsed = (Date.now() - questionStartRef.current) / 1000;
    const timer = timerSeconds || 0;
    const newScores = { ...scores };
    const newStreaks = { ...streaks };
    scannedStudents.forEach((s) => {
      const isCorrect = correctAnswer.includes(s.answer);
      if (!newScores[s.student_id]) newScores[s.student_id] = 0;
      if (!newStreaks[s.student_id]) newStreaks[s.student_id] = 0;
      if (isCorrect) {
        const speedBonus = timer > 0 ? Math.max(0, Math.round((1 - elapsed / timer) * 50)) : 0;
        const streakBonus = Math.min(newStreaks[s.student_id] * 10, 50);
        newScores[s.student_id] += 100 + speedBonus + streakBonus;
        newStreaks[s.student_id]++;
      } else {
        newStreaks[s.student_id] = 0;
      }
    });
    setScores(newScores);
    setStreaks(newStreaks);
  };

  const startFromBeginning = () => {
    setStarted(true);
    sessionStartRef.current = Date.now();
    activateQuestion(0);
  };

  const revealResults = () => {
    setRevealed(true);
    beep(880);
    broadcastState(true);
    if (timerRef.current) clearInterval(timerRef.current);
    if (gameMode) {
      calculatePoints();
      setTimeout(() => setShowLeaderboard(true), 600);
    }
  };

  const nextQuestion = () => {
    saveCurrentScans();
    if (questionIndex + 1 < questions.length) activateQuestion(questionIndex + 1);
  };

  // Statusmeldung an verbundene Scanner senden (Handy spiegelt den Host-Zustand)
  const broadcastState = (revealedState, isLastOverride) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const isLast = isLastOverride !== undefined ? isLastOverride : questionIndex + 1 >= questions.length;
      ws.send(JSON.stringify({ type: "host_state", revealed: revealedState, is_last: isLast }));
    }
  };

  const hideResults = () => { setRevealed(false); broadcastState(false); };

  // Refs für Fernsteuerung vom Handy (gegen Stale-Closures im WS-Handler)
  const revealRef = useRef();
  const nextRef = useRef();
  const hideRef = useRef();
  const finishRef = useRef();
  revealRef.current = () => { if (!revealed) revealResults(); };
  nextRef.current = () => { if (revealed && questionIndex + 1 < questions.length) nextQuestion(); };
  hideRef.current = () => { if (revealed) hideResults(); };
  finishRef.current = () => { if (revealed && questionIndex + 1 >= questions.length) finishSession(); };

  const finishSession = () => {
    saveQuestionTime();
    saveCurrentScans();
    if (gameMode && !revealed) calculatePoints();
    fetch(`${API}/sessions/${sessionId}/finish`, { method: "POST" });
    const totalSec = sessionStartRef.current ? Math.round((Date.now() - sessionStartRef.current) / 1000) : null;
    const finalTimes = { ...questionTimes };
    if (question && questionStartRef.current) {
      finalTimes[question.id] = Math.round((Date.now() - questionStartRef.current) / 1000);
    }
    fetch(`${API}/sessions/${sessionId}/eval-config`).then((r) => r.json()).then((existing) => {
      fetch(`${API}/sessions/${sessionId}/eval-config`, alsJson("PUT", { ...existing, times: finalTimes, total_time: totalSec }));
    });
    if (timerRef.current) clearInterval(timerRef.current);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "session_finished" }));
    }
    setFinished(true);
  };

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const scannedIds = new Set(scannedStudents.map((s) => s.student_id));
  const scanMap = Object.fromEntries(scannedStudents.map((s) => [s.student_id, s.answer]));
  // Roster kursweit: gleichnamige SuS der Fach-Klassen eines Kurses = eine Person.
  const kursRoster = (cls) => {
    if (!cls) return [];
    const kurs = kurse.find((k) => (k.classes || []).some((c) => c.id === cls.id));
    const sib = kurs ? new Set(kurs.classes.map((c) => c.id)) : new Set([cls.id]);
    const studs = classes.filter((c) => sib.has(c.id)).flatMap((c) => c.students || []);
    const canon = {};
    studs.forEach((s) => { const n = s.name.trim(); if (!(n in canon)) canon[n] = s; });
    // Klassenreihenfolge ist position; card_id ist die Nummer der gedruckten
    // Karte und taugt nicht als Reihenfolge, sobald umsortiert wurde.
    return Object.values(canon).sort((a, b) => (a.position || 0) - (b.position || 0) || a.card_id - b.card_id || a.id - b.id);
  };
  const studentList = kursRoster(selectedClass);
  const studentMap = Object.fromEntries(studentList.map((s) => [s.card_id, s.name]));

  const niveauMap = Object.fromEntries(studentList.map((s) => [s.card_id, s.niveau || ""]));
  const leaderboard = Object.entries(scores)
    .map(([cid, pts]) => ({ id: Number(cid), name: studentMap[cid] || `#${cid}`, niveau: niveauMap[cid] || "", points: pts, streak: streaks[cid] || 0 }))
    .sort((a, b) => b.points - a.points);

  // Differenziertes Quiz: keine gemeinsame Rangliste über beide Kursniveaus —
  // die Aufgaben sind für E und G nicht dieselbe Anforderung.
  const getrennteListen = !!selectedSet?.niveau_aktiv && leaderboard.some((p) => p.niveau);
  const boards = getrennteListen
    ? [["E", leaderboard.filter((p) => p.niveau === "E")], ["G", leaderboard.filter((p) => p.niveau !== "E")]]
        .filter(([, list]) => list.length > 0)
    : [["", leaderboard]];

  // Step 1: Choose class + question set + options
  if (!sessionId) {
    return (
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
          <button onClick={async () => {
            const code = await askPrompt(t("session.codePrompt"));
            if (code && code.trim()) navigate(`/cardvote/scan?session=${code.trim().replace(/\D/g, "").slice(0, 4)}`);
          }} style={{ ...btnSecondaryKern, display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
            <Icon d={ICONS.camera} size={18} />
            {t("session.joinScanner")}
          </button>
        </div>

        {activeSessions.length > 0 && (
          <div style={{ ...panelStyle, marginBottom: 24, padding: 20 }}>
            <div style={{ ...sectionLabel, color: "var(--accent)", marginBottom: 12 }}>{t("session.open")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {activeSessions.map((s) => (
                <div key={s.id} style={{ ...panelStyle, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: "var(--card)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {s.mode === "game" && <Icon d={ICONS.gamepad} size={16} color="var(--text3)" />}
                    <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>{s.name || `Session #${s.code}`}</span>
                  </div>
                  {s.mode === "game" ? (
                    <button onClick={async () => { await fetch(`${API}/sessions/${s.id}/finish`, { method: "POST" }); setActiveSessions((prev) => prev.filter((x) => x.id !== s.id)); }}
                      style={{ ...btnPrimaryKern, ...btnSmall, background: C.danger, color: C.aufAkzent }}>
                      {t("session.finish")}
                    </button>
                  ) : (
                    <button onClick={() => resumeSession(s)}
                      style={{ ...btnPrimaryKern, ...btnSmall, background: "var(--accent)", color: C.aufAkzent }}>
                      {t("session.resume")}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 1: Class */}
        <div style={stepCard}>
          <div style={stepLabel}>{t("session.step1")}</div>
          {classes.length === 0 ? (
            <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("session.noClasses")} <a href="/classes" style={{ color: "var(--accent)" }}>{t("session.createClass")}</a></p>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              {/* Kurs zuerst, dann Fach — derselbe Selektor wie überall. Für die
                  Live-Session wird eine konkrete Fach-Klasse gebraucht. */}
              <KursKlasseSelect value={selectedClass?.id ?? ""}
                onChange={(id) => setSelectedClass(classes.find((c) => c.id === Number(id)) || null)} />
              {selectedClass && (
                <span style={{ fontSize: 13, color: "var(--text3)" }}>{(selectedClass.students || []).length} {t("classes.learners")}</span>
              )}
            </div>
          )}
        </div>

        {/* Step 2: Question set */}
        <div style={stepCard}>
          <div style={stepLabel}>{t("session.step2")}</div>
          {folders.length === 0 ? (
            <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("session.noSets")} <a href="/questions" style={{ color: "var(--accent)" }}>{t("session.createQuestions")}</a></p>
          ) : (
            <FolderPicker folders={folders} selected={selectedSet} onSelect={setSelectedSet} />
          )}
        </div>

        {/* Step 3: Options */}
        {selectedClass && selectedSet && (
          <div style={stepCard}>
            <div style={stepLabel}>{t("session.step3")}</div>

            {/* Test/Spiel ist ein Zwei-Zustands-Umschalter — also `Tabs` aus
                dem Kern statt eines eigenen Pillen-Nachbaus. */}
            <Tabs value={gameMode ? "game" : "test"} onChange={(v) => setGameMode(v === "game")}
              style={{ marginBottom: 16 }}
              options={[["test", t("session.test")], ["game", t("session.game")]]} />

            {gameMode && (
              <p style={{ fontSize: 13, color: "var(--text3)", marginBottom: 12, lineHeight: 1.5 }}>
                {t("session.gameHint")}
              </p>
            )}

            <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", marginBottom: 16 }}>
              <input type="checkbox" checked={showAnswers} onChange={(e) => setShowAnswers(e.target.checked)}
                style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
              <span style={{ fontSize: 14, color: "var(--text)" }}>{t("session.showAnswers")}</span>
            </label>

            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
              <span style={{ fontSize: 14, color: "var(--text)" }}>{t("session.timer")}</span>
              <select value={timerSeconds} onChange={(e) => setTimerSeconds(Number(e.target.value))} style={selectStyle}>
                <option value={0}>{gameMode ? t("session.unlimited") : t("session.noTimer")}</option>
                <option value={15}>{t("session.seconds", { n: 15 })}</option>
                <option value={30}>{t("session.seconds", { n: 30 })}</option>
                <option value={45}>{t("session.seconds", { n: 45 })}</option>
                <option value={60}>{t("session.seconds", { n: 60 })}</option>
                <option value={90}>{t("session.seconds", { n: 90 })}</option>
                <option value={120}>{t("session.minutes2")}</option>
              </select>
            </div>

            <button onClick={startSession} style={{
              ...btnLarge,
              background: "var(--text)", color: "var(--bg)",
              display: "inline-flex", alignItems: "center", gap: 8,
            }}>
              {gameMode ? <>{t("session.startGame")}</> : t("session.startSession")}
            </button>
          </div>
        )}
      </div>
    );
  }

  // Step 2: Ready to start
  if (!started) {
    return (
      <div style={{ textAlign: "center", paddingTop: 40 }}>
        {gameMode && <div style={{ marginBottom: 8 }}><Icon d={ICONS.gamepad} size={48} color="var(--text3)" /></div>}
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{[selectedClass?.name, selectedSet?.name].filter(Boolean).join(" — ")}</h2>
        <div style={{
          display: "inline-block", padding: "12px 24px",
          background: "var(--text)", color: "var(--bg)", borderRadius: CONTROL_R,
          // 28 px bewusst: der Sitzungscode wird vom Beamer abgelesen.
          fontSize: 28, fontWeight: 700, marginBottom: 16, fontFamily: "monospace", letterSpacing: 1,
        }}>
          {sessionCode}
        </div>
        {/* Minuspunkte: die Klasse muss wissen, dass Raten kostet und die
            Karte unten zu lassen erlaubt ist. */}
        {selectedSet?.minuspunkte && (
          <p style={{ color: "var(--text2)", marginBottom: 8, fontSize: 14, maxWidth: 520, marginLeft: "auto", marginRight: "auto" }}>
            {t("session.minusHint")}
          </p>
        )}
        <p style={{ color: "var(--text2)", marginBottom: 8, fontSize: 16 }}>
          {t("session.codeHint")}
        </p>
        <div style={{ marginBottom: 16 }}>
          <img src={`${API}/sessions/${sessionId}/qr`} alt="QR Code"
            style={{ width: 160, height: 160, borderRadius: CONTROL_R, border: "1px solid var(--border3)" }}
            onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "none"; }} />
        </div>
        <p style={{ color: "var(--text2)", marginBottom: 24, fontSize: 16 }}>
          {t("session.countsLine", { q: questions.length, s: studentList.length })}
          {gameMode && ` ${t("session.timerSuffix", { t: timerSeconds })}`}
        </p>
        {questions.length === 0 && (
          <p style={{ color: "var(--accent)", marginBottom: 16, fontSize: 14 }}>{t("session.noQuestions")}</p>
        )}
        {resuming ? (
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={continueResumed} disabled={questions.length === 0} style={{ ...btnLarge, background: "var(--text)", color: "var(--bg)" }}>
              {t("session.continue")}
            </button>
            <button onClick={startFromBeginning} disabled={questions.length === 0} style={{ ...btnLarge, background: "var(--card)", color: "var(--text)", border: "1px solid var(--border2)" }}>
              {t("session.fromStart")}
            </button>
          </div>
        ) : (
          <button onClick={startFromBeginning} disabled={questions.length === 0} style={{
            ...btnLarge,
            background: "var(--text)", color: "var(--bg)",
          }}>
            {gameMode ? t("session.letsgo") : t("session.start")}
          </button>
        )}
      </div>
    );
  }

  // Finished
  if (finished) {
    // Game mode: podium
    if (gameMode && leaderboard.length > 0) {
      // Bei E/G kein gemeinsames Podium — stattdessen je Kursniveau eine Liste.
      if (getrennteListen) {
        return (
          <div style={{ textAlign: "center", paddingTop: 20 }}>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", marginBottom: 8 }}><Icon d={ICONS.trophy} size={26} /> {t("session.finalResult")}</h2>
            <p style={{ color: "var(--text3)", marginBottom: 24, fontSize: 16 }}>{selectedClass?.name} — {selectedSet?.name}</p>
            <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
              {boards.map(([niv, list]) => (
                <div key={niv} style={{ minWidth: 260, maxWidth: 360, textAlign: "left" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text3)", marginBottom: 8, textAlign: "center" }}>{niv}-Kurs</div>
                  {list.map((p, i) => (
                    <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 16px", background: i < 3 ? `${PODIUM_COLORS[i]}22` : "var(--bg2)", borderRadius: CONTROL_R, marginBottom: 6 }}>
                      <span style={{ color: "var(--text3)", fontWeight: 600, width: 26, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{i + 1}.</span>
                      <span style={{ flex: 1, marginLeft: 8, color: "var(--text)" }}>{p.name}</span>
                      <span style={{ fontWeight: 700, color: "var(--text)" }}>{p.points}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 32 }}>
              <button onClick={() => navigate(`/cardvote/evaluation/${sessionId}`)} style={{ ...btnPrimary, padding: "10px 20px" }}>{t("session.detailEval")}</button>
              <button onClick={() => navigate("/cardvote/tests")} style={{ ...btnSecondary, padding: "10px 20px" }}>{t("session.allTests")}</button>
            </div>
          </div>
        );
      }
      const top = leaderboard.slice(0, 3);
      const rest = leaderboard.slice(3);
      return (
        <div style={{ textAlign: "center", paddingTop: 20 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", marginBottom: 8 }}><Icon d={ICONS.trophy} size={28} /> {t("session.finalResult")}</h2>
          <p style={{ color: "var(--text3)", marginBottom: 32, fontSize: 16 }}>{selectedClass?.name} — {selectedSet?.name}</p>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "flex-end", gap: 16, marginBottom: 40 }}>
            {[1, 0, 2].map((rank) => {
              const p = top[rank];
              if (!p) return <div key={rank} style={{ width: 120 }} />;
              const heights = [200, 160, 130];
              return (
                <div key={rank} style={{ textAlign: "center", animation: "slideUp 0.5s ease" }}>
                  <div style={{ marginBottom: 8 }}><SvgMedal place={rank} size={rank === 0 ? 48 : 32} /></div>
                  <div style={{ fontWeight: 700, fontSize: rank === 0 ? 22 : 16, color: "var(--text)", marginBottom: 4 }}>{p.name}</div>
                  <div style={{
                    width: 120, height: heights[rank], borderRadius: "16px 16px 0 0",
                    background: `linear-gradient(180deg, ${PODIUM_COLORS[rank]}, ${PODIUM_COLORS[rank]}88)`,
                    display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column",
                  }}>
                    {/* Punktzahl auf dem Podium: grosser Zaehler fuer die
                        Projektion, deshalb 28 fuer den ersten Platz. */}
                    <div style={{ fontSize: rank === 0 ? 28 : 22, fontWeight: 800, color: "var(--text)" }}>{p.points}</div>
                    <div style={{ fontSize: 12, color: "var(--text)", opacity: 0.7 }}>{t("session.points")}</div>
                  </div>
                </div>
              );
            })}
          </div>
          {rest.length > 0 && (
            <div style={{ maxWidth: 400, margin: "0 auto", textAlign: "left" }}>
              {rest.map((p, i) => (
                <div key={p.id} style={{
                  display: "flex", justifyContent: "space-between", padding: "10px 16px",
                  background: "var(--bg2)", borderRadius: CONTROL_R, marginBottom: 6,
                }}>
                  <span style={{ color: "var(--text3)", fontWeight: 600 }}>#{i + 4}</span>
                  <span style={{ flex: 1, marginLeft: 12, color: "var(--text)" }}>{p.name}</span>
                  <span style={{ fontWeight: 700, color: "var(--text)" }}>{p.points}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 32 }}>
            <button onClick={() => navigate(`/cardvote/evaluation/${sessionId}`)} style={{ ...btnPrimary, padding: "10px 20px" }}>{t("session.detailEval")}</button>
            <button onClick={() => navigate("/cardvote/tests")} style={{ ...btnSecondary, padding: "10px 20px" }}>{t("session.allTests")}</button>
          </div>
        </div>
      );
    }

    // Test mode: summary table
    const summaryStats = questions.map((q, i) => {
      const data = allScans[q.id];
      if (!data || !q.correct_answer) return { index: i + 1, text: q.text, pct: null, correct: 0, total: 0 };
      const correct = data.counts[q.correct_answer] || 0;
      const t = Object.values(data.counts).reduce((a, b) => a + b, 0);
      return { index: i + 1, text: q.text, pct: t > 0 ? Math.round((correct / t) * 100) : 0, correct, total: t };
    });
    const overallCorrect = summaryStats.reduce((s, q) => s + q.correct, 0);
    const overallTotal = summaryStats.reduce((s, q) => s + q.total, 0);
    const overallPct = overallTotal > 0 ? Math.round((overallCorrect / overallTotal) * 100) : 0;

    return (
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{t("session.finished")}</h2>
        <p style={{ color: "var(--text2)", marginBottom: 20 }}>
          {selectedClass?.name} — {selectedSet?.name}
          {sessionStartRef.current && (
            <span style={{ marginLeft: 12, color: "var(--text3)" }}>⏱ {mmss(Math.round((Date.now() - sessionStartRef.current) / 1000))}</span>
          )}
        </p>
        <div style={{
          display: "inline-block", padding: "16px 32px", borderRadius: cardStyle.borderRadius,
          background: overallPct >= 80 ? "var(--success-bg)" : overallPct >= 50 ? "var(--warn-bg)" : "var(--danger-bg)",
          marginBottom: 24, textAlign: "center",
        }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)" }}>{overallPct}%</div>
          <div style={{ fontSize: 14, color: "var(--text2)" }}>{t("cv.correctOverall")}</div>
        </div>
        <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 600, fontSize: 16 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border3)" }}>
              <th style={{ ...thStyle, textAlign: "left" }}>#</th>
              <th style={{ ...thStyle, textAlign: "left" }}>{t("cv.thQuestion")}</th>
              <th style={{ ...thStyle, textAlign: "center" }}>{t("cv.statCorrect")}</th>
              <th style={{ ...thStyle, textAlign: "center" }}>{t("cv.statTime")}</th>
            </tr>
          </thead>
          <tbody>
            {summaryStats.map((q, qi) => {
              const qTime = questionTimes[questions[qi]?.id];
              return (
              <tr key={q.index} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "10px 12px", color: "var(--text3)" }}>{q.index}</td>
                <td style={{ padding: "10px 12px", color: "var(--text)" }}><Latex>{q.text}</Latex></td>
                <td style={{
                  padding: "10px 12px", textAlign: "center", fontWeight: 600,
                  color: q.pct === null ? "var(--text3)" : q.pct >= 80 ? C.success : q.pct >= 50 ? C.warning : C.danger,
                }}>
                  {q.pct === null ? "–" : `${q.pct}%`}
                </td>
                <td style={{ padding: "10px 12px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
                  {qTime != null ? mmss(qTime) : "–"}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
          <button onClick={() => navigate(`/cardvote/evaluation/${sessionId}`)} style={{ ...btnPrimary, padding: "10px 20px" }}>{t("session.detailEval")}</button>
          <button onClick={() => navigate("/cardvote/tests")} style={{ ...btnSecondary, padding: "10px 20px" }}>{t("session.allTests")}</button>
        </div>
      </div>
    );
  }

  // Step 3: Live session
  const isLastQuestion = questionIndex + 1 >= questions.length;
  const timerPct = timeLeft != null && timerSeconds > 0 ? (timeLeft / timerSeconds) * 100 : 100;
  const timerColor = timeLeft !== null && timeLeft <= 5 ? C.danger : timeLeft !== null && timeLeft <= 10 ? C.warning : "var(--accent)";

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 120px)" }}>
      <style>{`@keyframes nqIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}`}</style>
      {/* Top bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1vh" }}>
        <h2 style={{ margin: 0, fontSize: "clamp(18px, 2.5vh, 26px)", fontWeight: 700, color: "var(--text)" }}>
          {gameMode && <><Icon d={ICONS.gamepad} size={16} color="var(--text3)" />{" "}</>}{selectedClass?.name}
        </h2>
        {/* Eine Werkzeugleiste wie ueberall: was gerade laeuft (Frage, Code)
            steht links, der eine Alltagsgriff (Ton) sichtbar, alles Seltene und
            das gefaehrliche „Beenden" im Menue. Vorher standen hier sechs
            Elemente nebeneinander, „Beenden" rot mittendrin. */}
        <Werkzeugleiste
          style={{ marginBottom: 0, flex: "0 1 auto", justifyContent: "flex-end" }}
          links={<>
            <span style={{ color: "var(--text3)", fontSize: "clamp(13px, 1.8vh, 16px)", fontWeight: 600 }}>
              {t("session.question", { i: questionIndex + 1, n: questions.length })}
            </span>
            {/* Der Sitzungscode als Chip — im Spielmodus in der Antwortfarbe B
                (Violett) statt eines eigenen Farbverlaufs aus zwei festen
                Hexwerten. */}
            <span style={{
              ...chipStyle, fontFamily: "monospace", fontWeight: 700, fontSize: 13, padding: "4px 12px",
              background: gameMode ? ANTWORT_COLORS.B : "var(--text)",
              color: gameMode ? C.aufAkzent : "var(--bg)",
            }}>
              {sessionCode}
            </span>
          </>}
          mehr={[
            { key: "scanner", label: t("session.openScanner"), icon: ICONS.camera,
              onClick: () => window.open(`/cardvote/scan?session=${sessionCode}`, "_blank") },
            { key: "fullscreen", label: t("session.fullscreen"), icon: ICONS.fit,
              onClick: () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } },
            { key: "finish", label: t("session.finish"), icon: ICONS.close, gefahr: true, onClick: finishSession },
          ]}
        >
          <button onClick={toggleMute} className="icon-btn"
            style={{ ...toolbarIconBtn, color: muted ? C.danger : "var(--text3)" }}
            title={muted ? t("session.unmute") : t("session.mute")} aria-label={muted ? t("session.unmute") : t("session.mute")}>
            <Icon d={muted ? ICONS.volumeOff : ICONS.volume} size={17} color={muted ? C.danger : undefined} />
          </button>
          {!muted && (
            <input type="range" min={0} max={1} step={0.05} value={volume}
              onChange={(e) => changeVolume(parseFloat(e.target.value))}
              title={t("session.volume")} style={{ width: 70, accentColor: "var(--accent)", cursor: "pointer" }} />
          )}
        </Werkzeugleiste>
      </div>

      {/* Timer bar */}
      {timeLeft !== null && (
        /* Fortschrittsbalken: Radius = halbe Hoehe (Balken-Kappe), darum Zahl. */
        <div style={{ height: 4, background: "var(--bg2)", borderRadius: 2, marginBottom: 4, overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${timerPct}%`, background: timerColor,
            borderRadius: 2, transition: "width 1s linear, background 0.3s",
          }} />
        </div>
      )}

      {/* Timer + scan count */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5vh" }}>
        <span style={{ fontSize: "clamp(12px, 1.6vh, 15px)", color: "var(--text3)", fontWeight: 600 }}>
          {t("cv.scanned", { n: scannedStudents.length, total: studentList.length })}
        </span>
        {timeLeft !== null && (
          <span style={{
            // Countdown: aus zehn Metern lesbar, in den letzten Sekunden groesser.
            fontSize: timeLeft <= 5 ? 28 : 22, fontWeight: 800, fontFamily: "monospace",
            color: timerColor, transition: "all 0.3s",
            animation: timeLeft <= 5 && timeLeft > 0 ? "pulse 0.5s infinite" : "none",
          }}>
            {timeLeft > 0 ? mmss(timeLeft) : t("session.timeUp")}
          </span>
        )}
      </div>

      {question && (
        <>
          {/* Question text — large, full width */}
          <div key={`q${question.id}`} style={{
            fontSize: "clamp(28px, 5.5vh, 64px)", fontWeight: 600, marginBottom: "2vh", padding: "clamp(20px, 3.5vh, 44px) clamp(24px, 3vw, 48px)",
            background: "var(--bg2)", borderRadius: cardStyle.borderRadius, color: "var(--text)", lineHeight: 1.4,
            animation: "nqIn 0.22s ease both",
          }}>
            <Latex>{question.text}</Latex>
          </div>

          {question.image_url && (
            <div style={{ marginBottom: 20, textAlign: "center" }}>
              <img src={question.image_url} alt="" style={{ maxWidth: "100%", maxHeight: 400, borderRadius: CONTROL_R, border: "1px solid var(--border3)" }} />
            </div>
          )}

          {/* Answer buttons — NO colored backgrounds, just bordered. Colored on reveal */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "clamp(8px, 1.5vh, 16px)", marginBottom: "2vh", flex: 1 }}>
            {(() => {
              const validKeys = ["A", "B", "C", "D"].slice(0, question.num_choices || 4);
              const extraKeys = revealed ? ["A", "B", "C", "D"].filter((k) => !validKeys.includes(k) && (counts[k] || 0) > 0) : [];
              return [...validKeys, ...extraKeys].map((key, i) => {
                const isExtra = !validKeys.includes(key);
                const isCorrect = revealed && !isExtra && question.correct_answer && question.correct_answer.includes(key);
                const isWrong = revealed && !isExtra && question.correct_answer && !question.correct_answer.includes(key);
                const count = counts[key] || 0;
                return (
                  <div key={`${question.id}-${key}`} style={{
                    padding: "clamp(12px, 2.5vh, 28px) clamp(16px, 2vw, 28px)",
                    background: isExtra ? "var(--bg2)" : isCorrect ? C.success : isWrong ? "var(--bg2)" : "var(--card)",
                    color: isCorrect ? C.aufAkzent : "var(--text)",
                    borderRadius: cardStyle.borderRadius,
                    fontSize: "clamp(20px, 4vh, 44px)",
                    border: isExtra ? "3px dashed var(--border2)" : isCorrect ? `3px solid ${C.success}` : "3px solid var(--border3)",
                    opacity: isExtra ? 0.45 : isWrong ? 0.5 : 1,
                    transition: "all 0.3s",
                    position: "relative",
                    display: "flex", alignItems: "center",
                    animation: "nqIn 0.22s ease both",
                    animationDelay: `${140 * (i + 1)}ms`,
                  }}>
                    <strong style={{ fontSize: "clamp(24px, 4.5vh, 48px)", marginRight: 10 }}>{key}</strong>
                    {isExtra ? <span style={{ fontSize: "clamp(14px, 2.5vh, 22px)", color: "var(--text3)", fontStyle: "italic" }}>{t("session.noAnswerField")}</span> : <Latex>{question.choices[key] || "–"}</Latex>}
                    {!isExtra && question.choice_images?.[key] && <img src={question.choice_images[key]} alt="" style={{ display: "block", marginTop: 8, maxHeight: 100, borderRadius: CONTROL_R }} />}
                    {revealed && count > 0 && (
                      <span style={{
                        position: "absolute", top: 10, right: 14,
                        fontSize: 16, fontWeight: 700,
                        color: isCorrect ? C.aufAkzent : "var(--text3)",
                      }}>
                        {count} ({total > 0 ? Math.round(count / total * 100) : 0}%)
                      </span>
                    )}
                  </div>
                );
              });
            })()}
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: "1.5vh" }}>
            <button onClick={revealed ? hideResults : revealResults} style={{
              ...btnPrimary, padding: "12px 28px", fontSize: 16,
              background: revealed ? "var(--bg2)" : "var(--text)",
              color: revealed ? "var(--text)" : "var(--bg)",
            }}>
              {revealed ? t("scanner.hide") : t("scanner.reveal")}
            </button>
            {revealed && !isLastQuestion && (
              <button onClick={nextQuestion} style={{ ...btnPrimary, padding: "12px 28px", fontSize: 16, background: "var(--text)", color: "var(--bg)" }}>
                {t("scanner.next")}
              </button>
            )}
            {revealed && isLastQuestion && (
              <button onClick={finishSession} style={{ ...btnPrimary, padding: "12px 28px", fontSize: 16, background: C.danger, color: C.aufAkzent, display: "inline-flex", alignItems: "center", gap: 6 }}>
                {gameMode ? <><Icon d={ICONS.trophy} size={16} color={C.aufAkzent} /> {t("session.endGame")}</> : t("scanner.finishTest")}
              </button>
            )}
          </div>

          {/* Student sidebar + game leaderboard */}
          <div style={{ display: "flex", gap: 24 }}>
            {/* Student list */}
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {[...studentList].sort((a, b) => {
                  const aScanned = scannedIds.has(a.card_id);
                  const bScanned = scannedIds.has(b.card_id);
                  if (aScanned !== bScanned) return aScanned ? 1 : -1;
                  return 0;
                }).map((student) => {
                  const scanned = scannedIds.has(student.card_id);
                  const answer = scanMap[student.card_id];
                  const showColor = revealed && scanned && showAnswers;
                  return (
                    <div key={student.card_id} style={{
                      ...chipStyle, padding: "5px 12px", fontSize: 13,
                      fontWeight: scanned ? 600 : 400,
                      background: showColor ? ANTWORT_COLORS[answer] : scanned ? "var(--text)" : "var(--bg2)",
                      color: scanned ? "var(--bg)" : "var(--text3)",
                      transition: "all 0.3s",
                    }}>
                      {student.name}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Game leaderboard */}
            {gameMode && showLeaderboard && leaderboard.length > 0 && (
              <div style={{ width: 240, flexShrink: 0, animation: "slideUp 0.3s ease" }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 10, textAlign: "center" }}>
                  <Icon d={ICONS.trophy} size={16} /> {t("session.leaderboard")}
                </div>
                {boards.map(([niv, list]) => (
                  <div key={niv || "alle"} style={{ marginBottom: boards.length > 1 ? 10 : 0 }}>
                    {niv && <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text3)", marginBottom: 4, textAlign: "center" }}>{niv}-Kurs</div>}
                    {list.slice(0, 8).map((p, i) => (
                  <div key={p.id} style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                    borderRadius: CONTROL_R, marginBottom: 4,
                    background: i < 3 ? `${PODIUM_COLORS[i]}22` : "var(--bg2)",
                  }}>
                    <span style={{ fontWeight: 800, fontSize: 13, color: i < 3 ? PODIUM_COLORS[i] : "var(--text3)", width: 22 }}>
                      {i < 3 ? <SvgMedal place={i} size={18} /> : `${i + 1}.`}
                    </span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.name}
                    </span>
                    <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{p.points}</span>
                    {p.streak >= 2 && <span style={{ fontSize: 11, color: C.warning }}><Icon d={ICONS.flame} size={11} color={C.warning} />{p.streak}</span>}
                  </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const stepCard = { ...panelStyle, marginBottom: 24, padding: 20 };
const stepLabel = { ...sectionLabel, marginBottom: 12 };
const thStyle = { ...thBasis, padding: "8px 12px", fontSize: 13, position: "static", borderBottom: "none" };
// Die Session-Knoepfe bleiben GROSS (aus zehn Metern lesbar) — das ist die
// bewusste Ausnahme in Icons.jsx. Ausgenommen ist aber nur die Groesse: die
// FORM kam aus dem Kern, hier stand Radius 980 (Pille), wo ueberall sonst
// CONTROL_R sitzt.
const btnPrimary = { ...btnPrimaryKern, background: "var(--accent)", color: C.aufAkzent, fontSize: 16, padding: "12px 28px" };
const btnSecondary = { ...btnSecondaryKern, fontSize: 16, padding: "12px 28px" };
const btnLarge = { ...btnPrimary, padding: "14px 36px", background: C.success };

function FolderPicker({ folders, selected, onSelect, depth = 0 }) {
  const [expanded, setExpanded] = useState({});
  const toggle = (id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  if (folders.length === 0 && depth === 0) return null;

  return (
    <div style={{ marginLeft: depth * 20 }}>
      {folders.map((f) => (
        <div key={f.id}>
          <div
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", cursor: "pointer", userSelect: "none" }}
            onClick={() => toggle(f.id)}
          >
            <span style={{ width: 14, textAlign: "center", transition: "transform 0.15s", transform: expanded[f.id] ? "rotate(90deg)" : "rotate(0deg)" }}>
              {(f.children?.length > 0 || f.question_sets?.length > 0) ? <Icon d={ICONS.chevronRight} size={14} /> : ""}
            </span>
            <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}><Icon d={ICONS.folder} size={18} />{f.name}</span>
          </div>
          {expanded[f.id] && (
            <div style={{ marginLeft: 22 }}>
              {(f.question_sets || []).map((qs) => {
                const active = selected?.id === qs.id;
                return (
                  <div key={qs.id} onClick={() => onSelect(qs)} style={{
                    padding: "10px 14px", marginBottom: 4, borderRadius: CONTROL_R, cursor: "pointer",
                    border: active ? "2px solid var(--accent)" : "2px solid transparent",
                    background: active ? "var(--accent-bg)" : "var(--card)",
                    color: "var(--text)", transition: "all 0.15s", fontSize: 14,
                  }}>
                    <strong>{qs.name}</strong>
                    <span style={{ color: "var(--text3)", marginLeft: 8, fontSize: 12 }}>{qs.questions?.length || 0} Fragen</span>
                  </div>
                );
              })}
              {f.children?.length > 0 && <FolderPicker folders={f.children} selected={selected} onSelect={onSelect} depth={depth + 1} />}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
