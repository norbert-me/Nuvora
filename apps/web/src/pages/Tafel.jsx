// Modul Tafel (Classroom-Screen) — frei platzierbare Textfelder für den Beamer.
// Jedes Feld ist verschiebbar, in der Größe änderbar und hat eine Schriftgröße.
// Reiner Client; der Stand liegt lokal (localStorage), damit er den Reload übersteht.
import { useState, useRef, useEffect } from "react";
import { pageTitle, btnPrimary, btnSecondary, Icon, ICONS, iconBtn, COLORS as C } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

const KEY = "nuvora_tafel_v1";
const COLORS = ["#111827", "#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed"];

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };

export default function Tafel() {
  const { t } = useLanguage();
  const [items, setItems] = useState(load);
  const [sel, setSel] = useState(null);
  const boardRef = useRef(null);
  const drag = useRef(null); // { id, mode, sx, sy, ox, oy, ow, oh }

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* voll — egal */ } }, [items]);

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const add = () => {
    const b = boardRef.current?.getBoundingClientRect();
    const it = { id: uid(), type: "text", x: b ? b.width / 2 - 120 : 60, y: 60, w: 240, h: 90, text: "", fontSize: 28, color: "#111827" };
    setItems((p) => [...p, it]); setSel(it.id);
  };
  const addTimer = () => {
    const b = boardRef.current?.getBoundingClientRect();
    const it = { id: uid(), type: "timer", x: b ? b.width / 2 - 130 : 80, y: 90, w: 260, h: 150, minutes: 5 };
    setItems((p) => [...p, it]); setSel(it.id);
  };
  const patch = (id, o) => setItems((p) => p.map((i) => (i.id === id ? { ...i, ...o } : i)));
  const del = (id) => { setItems((p) => p.filter((i) => i.id !== id)); if (sel === id) setSel(null); };

  const onDown = (e, id, mode) => {
    e.preventDefault(); e.stopPropagation(); setSel(id);
    const it = items.find((i) => i.id === id); if (!it) return;
    drag.current = { id, mode, sx: e.clientX, sy: e.clientY, ox: it.x, oy: it.y, ow: it.w, oh: it.h };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };
  const onMove = (e) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (d.mode === "move") patch(d.id, { x: Math.max(0, d.ox + dx), y: Math.max(0, d.oy + dy) });
    else patch(d.id, { w: Math.max(80, d.ow + dx), h: Math.max(50, d.oh + dy) });
  };
  const onUp = () => { drag.current = null; window.removeEventListener("pointermove", onMove); };

  const selItem = items.find((i) => i.id === sel);
  const bumpFont = (delta) => { if (selItem) patch(selItem.id, { fontSize: Math.max(10, Math.min(160, (selItem.fontSize || 28) + delta)) }); };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <style>{`@keyframes tafelFlash{0%,100%{background:transparent}50%{background:rgba(220,38,38,0.55)}}.tafel-flash{animation:tafelFlash .5s steps(1) 6}`}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ flex: 1 }} />
        <button onClick={add} style={{ ...btnPrimary, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon d={ICONS.plus} size={15} color="#fff" /> {t("tafel.add")}</button>
        <button onClick={addTimer} style={{ ...btnSecondary, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon d={ICONS.plus} size={15} /> {t("tafel.addTimer")}</button>
        <button onClick={() => boardRef.current?.requestFullscreen?.()} style={{ ...btnSecondary, display: "inline-flex", alignItems: "center", gap: 6 }} title={t("tafel.fullscreen")}><Icon d={ICONS.fit} size={16} /> {t("tafel.fullscreen")}</button>
      </div>

      {/* Werkzeugleiste: immer sichtbar mit fester Höhe, damit die Tafel beim
          Aus-/Abwählen nicht springt und Felder stabil platzierbar bleiben. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 38, marginBottom: 10, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--card)", flexWrap: "wrap" }}>
        {!selItem && <span style={{ fontSize: 12.5, color: "var(--text3)" }}>{t("tafel.selectHint")}</span>}
        {selItem && selItem.type !== "timer" && (<>
          <span style={{ fontSize: 12.5, color: "var(--text3)" }}>{t("tafel.textSize")}</span>
          <button onClick={() => bumpFont(-4)} style={{ ...btnSecondary, padding: "4px 12px", fontWeight: 700 }}>A−</button>
          <span style={{ fontSize: 13, minWidth: 34, textAlign: "center" }}>{selItem.fontSize}</span>
          <button onClick={() => bumpFont(4)} style={{ ...btnSecondary, padding: "4px 12px", fontWeight: 700 }}>A+</button>
          <span style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px" }} />
          {COLORS.map((c) => (
            <button key={c} onClick={() => patch(selItem.id, { color: c })} title={t("tafel.color")}
              style={{ width: 22, height: 22, borderRadius: 6, background: c, border: selItem.color === c ? "2px solid var(--accent)" : "1px solid var(--border2)", cursor: "pointer" }} />
          ))}
        </>)}
        {selItem && selItem.type === "timer" && (
          <button onClick={() => patch(selItem.id, { muted: !selItem.muted })} style={{ ...btnSecondary, padding: "4px 12px", display: "inline-flex", alignItems: "center", gap: 6 }}>
            {selItem.muted ? "🔇" : "🔊"} {selItem.muted ? t("tafel.soundOff") : t("tafel.soundOn")}
          </button>
        )}
        {selItem && <><span style={{ flex: 1 }} />
          <button onClick={() => del(selItem.id)} className="icon-btn" style={{ ...iconBtn }} title={t("common.delete")}><Icon d={ICONS.trash} size={16} color={C.danger} /></button></>}
      </div>

      {/* Tafel-Fläche */}
      <div ref={boardRef} onPointerDown={() => setSel(null)}
        style={{ position: "relative", width: "100%", minHeight: "70vh", border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)", overflow: "hidden" }}>
        {items.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text3)", fontSize: 14, pointerEvents: "none" }}>{t("tafel.empty")}</div>
        )}
        {items.map((it) => (
          <div key={it.id} onPointerDown={(e) => { e.stopPropagation(); setSel(it.id); }}
            style={{ position: "absolute", left: it.x, top: it.y, width: it.w, height: it.h,
              border: sel === it.id ? "2px solid var(--accent)" : "1px dashed transparent",
              borderRadius: 8, boxSizing: "border-box", background: sel === it.id ? "rgba(10,132,255,0.04)" : "transparent" }}>
            {/* Zieh-Griff oben */}
            <div onPointerDown={(e) => onDown(e, it.id, "move")}
              style={{ position: "absolute", top: -2, left: 0, right: 0, height: 16, cursor: "grab", display: sel === it.id ? "flex" : "none", alignItems: "center", justifyContent: "center", color: "var(--text3)" }}>
              <Icon d={ICONS.move || ICONS.grip} size={13} />
            </div>
            {it.type === "timer" ? (
              <TafelTimer item={it} onPatch={(o) => patch(it.id, o)} t={t} />
            ) : (
              <textarea value={it.text} onChange={(e) => patch(it.id, { text: e.target.value })} placeholder={t("tafel.placeholder")}
                style={{ width: "100%", height: "100%", boxSizing: "border-box", border: "none", outline: "none", resize: "none", background: "transparent",
                  color: it.color, fontSize: it.fontSize, fontWeight: 700, lineHeight: 1.15, padding: "12px 10px 8px", overflow: "hidden", fontFamily: "inherit" }} />
            )}
            {/* Größen-Griff unten rechts */}
            <div onPointerDown={(e) => onDown(e, it.id, "resize")}
              style={{ position: "absolute", right: -1, bottom: -1, width: 16, height: 16, cursor: "nwse-resize", display: sel === it.id ? "block" : "none",
                borderRight: "3px solid var(--accent)", borderBottom: "3px solid var(--accent)", borderBottomRightRadius: 6 }} />
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 10 }}>{t("tafel.hint")}</p>
    </div>
  );
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.type = "sine"; o.frequency.value = 880;
    let ti = ctx.currentTime; o.start();
    for (let i = 0; i < 3; i++) { g.gain.setValueAtTime(0.3, ti); g.gain.setValueAtTime(0.0001, ti + 0.15); ti += 0.3; }
    o.stop(ti + 0.05);
  } catch { /* Ton optional */ }
}

// Countdown-Widget auf der Tafel. Zeit skaliert mit der Feldhöhe; die eingestellte
// Minutenzahl wird gespeichert (onMinutes), der Lauf selbst ist flüchtig.
function TafelTimer({ item, onPatch, t }) {
  const total = Math.max(1, item.minutes || 5) * 60;
  const [remaining, setRemaining] = useState(total);
  const [running, setRunning] = useState(false);
  const [flash, setFlash] = useState(false); // Aufblitzen am Ende
  const tick = useRef(null);
  useEffect(() => { setRemaining(total); setRunning(false); setFlash(false); }, [total]);
  useEffect(() => {
    if (!running) return;
    tick.current = setInterval(() => setRemaining((r) => {
      if (r <= 1) { setRunning(false); if (!item.muted) beep(); setFlash(true); setTimeout(() => setFlash(false), 3000); return 0; }
      return r - 1;
    }), 1000);
    return () => clearInterval(tick.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const done = remaining === 0;
  const stop = (e) => e.stopPropagation();
  const bump = (d) => onPatch({ minutes: Math.max(1, Math.min(180, (item.minutes || 5) + d)) });
  const bh = item.h || 150;
  return (
    <div onPointerDown={stop} className={flash ? "tafel-flash" : ""} style={{ width: "100%", height: "100%", boxSizing: "border-box", borderRadius: 8, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: "14px 8px 8px" }}>
      <div style={{ fontSize: Math.max(28, Math.min(bh * 0.42, item.w * 0.32)), fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: done ? "#dc2626" : "var(--text)" }}>{fmt(remaining)}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
        <button onClick={() => bump(-1)} style={{ ...miniBtn }}>−</button>
        <span style={{ fontSize: 12, color: "var(--text3)", minWidth: 40, textAlign: "center" }}>{item.minutes || 5} {t("tafel.min")}</span>
        <button onClick={() => bump(1)} style={{ ...miniBtn }}>＋</button>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {!running
          ? <button onClick={() => { if (!done) setRunning(true); }} disabled={done} style={{ ...miniBtn, opacity: done ? 0.5 : 1 }}>▶</button>
          : <button onClick={() => setRunning(false)} style={{ ...miniBtn }}>❚❚</button>}
        <button onClick={() => { setRunning(false); setRemaining(total); }} style={{ ...miniBtn }}>↺</button>
      </div>
    </div>
  );
}

const miniBtn = { padding: "3px 10px", fontSize: 14, fontWeight: 700, border: "1px solid var(--border2)", borderRadius: 8, background: "var(--bg)", color: "var(--text)", cursor: "pointer" };
