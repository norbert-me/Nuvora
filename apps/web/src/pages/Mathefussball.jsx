// Modul Mathefußball — Kopfrechen-Spiel für zwei Teams am Beamer. Reiner Client,
// keine Daten. Richtige Antwort schiebt den Ball Richtung gegnerisches Tor;
// erreicht er das Tor, gibt es ein Tor und der Ball geht zurück in die Mitte.
import { useState, useRef, useEffect } from "react";
import { btnPrimary, btnSecondary, cardStyle, COLORS as C, CONTROL_R, Icon, ICONS, pageApp, toolbarBtn, toolbarInput } from "../components/Icons.jsx";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import { useLanguage } from "../i18n/index.jsx";

// Team B ist die zweite Datenfarbe des Spielfelds — Tor, Spielstand und Knopf
// muessen dieselbe sein, sonst gehoert am Beamer nichts zusammen. Deshalb EINE
// Stelle statt viermal derselbe Farbwert.
const TEAM_B = "#ff9500";

const STEPS = 2; // Felder je Seite (2 links, Mitte, 2 rechts); Tor beim Überschreiten des Rands

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
  const names = [t("mathefussball.teamA"), t("mathefussball.teamB")];
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
    if (np > STEPS) { setScore((s) => [s[0] + 1, s[1]]); np = 0; goal = `⚽ ${names[0]}!`; }
    else if (np < -STEPS) { setScore((s) => [s[0], s[1] + 1]); np = 0; goal = `⚽ ${names[1]}!`; }
    setPos(np); setReveal(true); setBusy(true); setFlash(goal);
    timer.current = setTimeout(() => { setFlash(""); setBusy(false); nextTask(); }, 2000);
  };
  const skip = () => { if (busy) return; nextTask(); };
  const resetGame = () => { clearTimeout(timer.current); setPos(0); setScore([0, 0]); setBusy(false); setFlash(""); nextTask(); };

  const cells = Array.from({ length: STEPS * 2 + 1 }, (_, i) => i - STEPS); // -STEPS..STEPS

  return (
    <div style={{ ...pageApp }}>
      {/* Einstellungen als Werkzeugleiste: Zahlenfeld, Rechenarten und
          Zuruecksetzen standen zuletzt in drei verschiedenen Hoehen
          nebeneinander. */}
      <Werkzeugleiste style={{ marginBottom: 16 }} links={
        <label style={{ fontSize: 13, color: "var(--text2)", display: "inline-flex", alignItems: "center", gap: 8 }}>
          {t("mathefussball.range")}
          <input type="number" min="10" max="1000" value={max} onChange={(e) => setMax(Math.max(5, Number(e.target.value) || 20))} style={{ ...toolbarInput, width: 90 }} />
        </label>
      }>
        {["+", "-", "×", ":"].map((o) => (
          <button key={o} onClick={() => toggleOp(o)} style={{ ...toolbarBtn, fontWeight: 700, background: ops.includes(o) ? "var(--accent)" : undefined, color: ops.includes(o) ? C.aufAkzent : undefined }}>{o}</button>
        ))}
        <span style={{ flex: 1 }} />
        <button onClick={resetGame} style={toolbarBtn}><Icon d={ICONS.refresh} size={15} /> {t("mathefussball.reset")}</button>
      </Werkzeugleiste>

      {/* Spielstand */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "var(--accent)" }}>{names[0]} · {score[0]}</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: TEAM_B }}>{score[1]} · {names[1]}</div>
      </div>

      {/* Spielfeld */}
      <div style={{ display: "flex", alignItems: "stretch", gap: 4, marginBottom: 24 }}>
        {/* Torpfosten: reine Grafik, der Radius ist die halbe Kante (10/2). */}
        <div style={{ width: 10, borderRadius: 5, background: "var(--accent)" }} title={names[0]} />
        <div style={{ flex: 1, display: "flex", gap: 4 }}>
          {cells.map((c) => (
            <div key={c} style={{ flex: 1, height: 70, borderRadius: CONTROL_R, border: "1px solid var(--border)", background: c === pos ? "transparent" : "var(--card)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>{/* Beamer-Grafik: der Ball fuellt das Feld, keine Textgroesse */}
              {c === pos ? "⚽" : ""}
            </div>
          ))}
        </div>
        <div style={{ width: 10, borderRadius: 5, background: TEAM_B }} title={names[1]} />
      </div>

      {!started ? (
        <div style={{ textAlign: "center", padding: "40px 16px" }}>
          <button onClick={start} style={{ ...btnPrimary, fontSize: 22, padding: "16px 40px", display: "inline-flex", alignItems: "center", gap: 8 }}><Icon d={ICONS.play} size={18} color="var(--bg)" /> {t("mathefussball.start")}</button>
        </div>
      ) : (<>
        {/* Aufgabe (oder Tor-Anzeige während des 2s-Übergangs) */}
        <div style={{ ...cardStyle, textAlign: "center", padding: "24px 16px", background: flash ? C.success + "1f" : "var(--card)", marginBottom: 16, transition: "background .2s" }}>
          <div style={{ fontSize: "clamp(40px, 12vw, 90px)", fontWeight: 800, lineHeight: 1 }}>
            {flash ? flash : `${task.q}${reveal ? ` = ${task.r}` : ""}`}
          </div>
          {!reveal && !busy && <button onClick={() => setReveal(true)} style={{ ...btnSecondary, marginTop: 12 }}>{t("mathefussball.reveal")}</button>}
        </div>

        {/* Wer war richtig? -> Ball bewegen. Während des Übergangs gesperrt. */}
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", opacity: busy ? 0.5 : 1 }}>
          {/* Der Pfeil sagt, wohin der Ball rollt. */}
          <button onClick={() => correct(0)} disabled={busy} style={{ ...btnPrimary, padding: "12px 24px", fontSize: 16, display: "inline-flex", alignItems: "center", gap: 8 }}>{names[0]} {t("mathefussball.correct")} <Icon d={ICONS.arrowRight} size={16} color="var(--bg)" /></button>
          <button onClick={skip} disabled={busy} style={{ ...btnSecondary, padding: "12px 20px" }}>{t("mathefussball.skip")}</button>
          <button onClick={() => correct(1)} disabled={busy} style={{ ...btnPrimary, padding: "12px 24px", fontSize: 16, background: TEAM_B, borderColor: TEAM_B, display: "inline-flex", alignItems: "center", gap: 8 }}><Icon d={ICONS.arrowLeft} size={16} color="var(--bg)" /> {names[1]} {t("mathefussball.correct")}</button>
        </div>
      </>)}
    </div>
  );
}
