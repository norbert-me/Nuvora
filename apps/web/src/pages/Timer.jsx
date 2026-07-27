// Modul Timer — Countdown & Stoppuhr für den Unterricht. Reiner Client, keine
// Daten. Groß für den Beamer; Signalton am Ende des Countdowns.
import { useState, useEffect, useRef } from "react";
import { pageTitle, btnPrimary, btnSecondary, Icon, ICONS } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

const PRESETS = [1, 2, 3, 5, 10, 15, 20]; // Minuten

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = "sine"; o.frequency.value = 880;
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    o.start();
    // drei kurze Töne
    let t = ctx.currentTime;
    for (let i = 0; i < 3; i++) { g.gain.setValueAtTime(0.3, t); g.gain.setValueAtTime(0.0001, t + 0.15); t += 0.3; }
    o.stop(t + 0.05);
  } catch { /* Ton optional */ }
}

export default function Timer() {
  const { t } = useLanguage();
  const [mode, setMode] = useState("countdown"); // countdown | stopwatch
  const [remaining, setRemaining] = useState(5 * 60); // Sekunden
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [total, setTotal] = useState(5 * 60);
  const tick = useRef(null);

  useEffect(() => {
    if (!running) return;
    tick.current = setInterval(() => {
      if (mode === "countdown") {
        setRemaining((r) => {
          if (r <= 1) { setRunning(false); beep(); return 0; }
          return r - 1;
        });
      } else {
        setElapsed((e) => e + 1);
      }
    }, 1000);
    return () => clearInterval(tick.current);
  }, [running, mode]);

  const setMinutes = (m) => { setTotal(m * 60); setRemaining(m * 60); setRunning(false); };
  const reset = () => { setRunning(false); if (mode === "countdown") setRemaining(total); else setElapsed(0); };
  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const value = mode === "countdown" ? remaining : elapsed;
  const done = mode === "countdown" && remaining === 0;
  const pct = mode === "countdown" && total > 0 ? (remaining / total) * 100 : 0;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", textAlign: "center" }}>
      <h1 style={pageTitle}>{t("timer.title")}</h1>

      <div style={{ display: "inline-flex", border: "1px solid var(--border2)", borderRadius: 980, overflow: "hidden", marginBottom: 20 }}>
        {[["countdown", t("timer.countdown")], ["stopwatch", t("timer.stopwatch")]].map(([m, label]) => (
          <button key={m} onClick={() => { setMode(m); setRunning(false); }}
            style={{ padding: "8px 18px", fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer", background: mode === m ? "var(--accent)" : "transparent", color: mode === m ? "#fff" : "var(--text2)" }}>{label}</button>
        ))}
      </div>

      {mode === "countdown" && (
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 20 }}>
          {PRESETS.map((m) => (
            <button key={m} onClick={() => setMinutes(m)} style={{ ...btnSecondary, padding: "6px 14px" }}>{m} min</button>
          ))}
        </div>
      )}

      <div style={{ position: "relative", padding: "36px 16px", borderRadius: 24, border: "1px solid var(--border)", background: done ? "rgba(255,59,48,0.10)" : "var(--card)", marginBottom: 24, overflow: "hidden" }}>
        {mode === "countdown" && (
          <div style={{ position: "absolute", left: 0, bottom: 0, height: 6, width: `${pct}%`, background: done ? "var(--danger, #ff3b30)" : "var(--accent)", transition: "width 1s linear" }} />
        )}
        <div style={{ fontSize: "clamp(64px, 22vw, 200px)", fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: done ? "var(--danger, #ff3b30)" : "var(--text)" }}>{fmt(value)}</div>
      </div>

      <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
        {!running ? (
          <button onClick={() => { if (!(mode === "countdown" && remaining === 0)) setRunning(true); }} disabled={mode === "countdown" && remaining === 0}
            style={{ ...btnPrimary, fontSize: 17, padding: "12px 30px", opacity: (mode === "countdown" && remaining === 0) ? 0.5 : 1 }}>▶ {t("timer.start")}</button>
        ) : (
          <button onClick={() => setRunning(false)} style={{ ...btnSecondary, fontSize: 17, padding: "12px 30px" }}>❚❚ {t("timer.pause")}</button>
        )}
        <button onClick={reset} style={{ ...btnSecondary, fontSize: 17, padding: "12px 24px", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon d={ICONS.refresh} size={18} /> {t("timer.reset")}
        </button>
      </div>
    </div>
  );
}
