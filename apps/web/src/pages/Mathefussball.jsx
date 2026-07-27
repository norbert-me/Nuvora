// Modul Mathefußball — Kopfrechen-Spiel für zwei Teams am Beamer. Reiner Client,
// keine Daten. Richtige Antwort schiebt den Ball Richtung gegnerisches Tor;
// erreicht er das Tor, gibt es ein Tor und der Ball geht zurück in die Mitte.
import { useState, useRef, useEffect } from "react";
import { pageTitle, btnPrimary, btnSecondary, selectStyle, inputStyle, Icon, ICONS } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

const STEPS = 6; // Felder je Seite bis zum Tor

function gen(max, ops) {
  const op = ops[Math.floor(Math.random() * ops.length)];
  let a = 1 + Math.floor(Math.random() * max);
  let b = 1 + Math.floor(Math.random() * max);
  let q, r;
  if (op === "+") { q = `${a} + ${b}`; r = a + b; }
  else if (op === "-") { if (b > a) [a, b] = [b, a]; q = `${a} − ${b}`; r = a - b; }
  else if (op === "×") { a = 1 + Math.floor(Math.random() * Math.min(max, 12)); b = 1 + Math.floor(Math.random() * Math.min(max, 12)); q = `${a} · ${b}`; r = a * b; }
  else { r = 1 + Math.floor(Math.random() * Math.min(max, 12)); b = 1 + Math.floor(Math.random() * Math.min(max, 12)); a = r * b; q = `${a} : ${b}`; }
  return { q, r };
}

export default function Mathefussball() {
  const { t } = useLanguage();
  const [max, setMax] = useState(20);
  const [ops, setOps] = useState(["+", "-"]);
  const [pos, setPos] = useState(0); // -STEPS..+STEPS, 0 = Mitte; + = Richtung Team B Tor
  const [score, setScore] = useState([0, 0]); // [A, B]
  const [task, setTask] = useState(() => gen(20, ["+", "-"]));
  const [reveal, setReveal] = useState(false);
  const [names] = useState(["Team A", "Team B"]);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);   // 2-Sek-Übergang: Buttons gesperrt
  const [flash, setFlash] = useState("");    // "Tor Team A!" o.ä. während des Übergangs
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const nextTask = () => { setTask(gen(max, ops.length ? ops : ["+"])); setReveal(false); };
  const toggleOp = (o) => setOps((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]));
  const start = () => { setStarted(true); nextTask(); };

  // Team A richtig -> Ball Richtung B-Tor (rechts, +). Tor bei +STEPS.
  // 2-Sek-Übergang: Ball bewegt sich sichtbar, dann kommt die nächste Aufgabe.
  const correct = (team) => {
    if (busy) return;
    const dir = team === 0 ? 1 : -1;
    let np = pos + dir; let goal = "";
    if (np >= STEPS) { setScore((s) => [s[0] + 1, s[1]]); np = 0; goal = `⚽ ${names[0]}!`; }
    else if (np <= -STEPS) { setScore((s) => [s[0], s[1] + 1]); np = 0; goal = `⚽ ${names[1]}!`; }
    setPos(np); setReveal(true); setBusy(true); setFlash(goal);
    timer.current = setTimeout(() => { setFlash(""); setBusy(false); nextTask(); }, 2000);
  };
  const skip = () => { if (busy) return; nextTask(); };
  const resetGame = () => { clearTimeout(timer.current); setPos(0); setScore([0, 0]); setBusy(false); setFlash(""); nextTask(); };

  const cells = Array.from({ length: STEPS * 2 + 1 }, (_, i) => i - STEPS); // -STEPS..STEPS

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <h1 style={pageTitle}>{t("mathefussball.title")}</h1>

      {/* Einstellungen */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 18 }}>
        <label style={{ fontSize: 13, color: "var(--text2)", display: "inline-flex", alignItems: "center", gap: 6 }}>
          {t("mathefussball.range")}
          <input type="number" min="10" max="1000" value={max} onChange={(e) => setMax(Math.max(5, Number(e.target.value) || 20))} style={{ ...inputStyle, width: 90, padding: "6px 8px" }} />
        </label>
        <div style={{ display: "inline-flex", gap: 6 }}>
          {["+", "-", "×", ":"].map((o) => (
            <button key={o} onClick={() => toggleOp(o)} style={{ ...btnSecondary, padding: "6px 12px", fontWeight: 700, background: ops.includes(o) ? "var(--accent)" : undefined, color: ops.includes(o) ? "#fff" : undefined }}>{o}</button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <button onClick={resetGame} style={{ ...btnSecondary, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon d={ICONS.refresh} size={15} /> {t("mathefussball.reset")}</button>
      </div>

      {/* Spielstand */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "var(--accent)" }}>{names[0]} · {score[0]}</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#ff9500" }}>{score[1]} · {names[1]}</div>
      </div>

      {/* Spielfeld */}
      <div style={{ display: "flex", alignItems: "stretch", gap: 4, marginBottom: 24 }}>
        <div style={{ width: 10, borderRadius: 4, background: "var(--accent)" }} title={names[0]} />
        <div style={{ flex: 1, display: "flex", gap: 4 }}>
          {cells.map((c) => (
            <div key={c} style={{ flex: 1, height: 70, borderRadius: 8, border: "1px solid var(--border)", background: c === pos ? "transparent" : "var(--card)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>
              {c === pos ? "⚽" : ""}
            </div>
          ))}
        </div>
        <div style={{ width: 10, borderRadius: 4, background: "#ff9500" }} title={names[1]} />
      </div>

      {!started ? (
        <div style={{ textAlign: "center", padding: "40px 16px" }}>
          <button onClick={start} style={{ ...btnPrimary, fontSize: 20, padding: "16px 44px" }}>▶ {t("mathefussball.start")}</button>
        </div>
      ) : (<>
        {/* Aufgabe (oder Tor-Anzeige während des 2s-Übergangs) */}
        <div style={{ textAlign: "center", padding: "28px 16px", borderRadius: 18, border: "1px solid var(--border)", background: flash ? "rgba(52,199,89,0.12)" : "var(--card)", marginBottom: 18, transition: "background .2s" }}>
          <div style={{ fontSize: "clamp(40px, 12vw, 90px)", fontWeight: 800, lineHeight: 1 }}>
            {flash ? flash : `${task.q}${reveal ? ` = ${task.r}` : ""}`}
          </div>
          {!reveal && !busy && <button onClick={() => setReveal(true)} style={{ ...btnSecondary, marginTop: 14 }}>{t("mathefussball.reveal")}</button>}
        </div>

        {/* Wer war richtig? -> Ball bewegen. Während des Übergangs gesperrt. */}
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", opacity: busy ? 0.5 : 1 }}>
          <button onClick={() => correct(0)} disabled={busy} style={{ ...btnPrimary, padding: "12px 26px", fontSize: 16 }}>{names[0]} {t("mathefussball.correct")} →</button>
          <button onClick={skip} disabled={busy} style={{ ...btnSecondary, padding: "12px 20px" }}>{t("mathefussball.skip")}</button>
          <button onClick={() => correct(1)} disabled={busy} style={{ ...btnPrimary, padding: "12px 26px", fontSize: 16, background: "#ff9500", borderColor: "#ff9500" }}>← {names[1]} {t("mathefussball.correct")}</button>
        </div>
      </>)}
    </div>
  );
}
