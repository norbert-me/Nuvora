// Modul Tafel (Classroom-Screen) — frei platzierbare Textfelder für den Beamer.
// Jedes Feld ist verschiebbar, in der Größe änderbar und hat eine Schriftgröße.
// Reiner Client; der Stand liegt lokal (localStorage), damit er den Reload übersteht.
import { useState, useRef, useEffect } from "react";
import { pageTitle, btnPrimary, btnSecondary, Icon, ICONS, iconBtn, COLORS as C } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

const KEY = "nuvora_tafel_v1";
const COLORS = ["#111827", "#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed"];
// Feste Referenzfläche (16:9). Alle Element-Koordinaten liegen in diesem Raum;
// die Anzeige skaliert per transform an die tatsächliche Breite.
const REF_W = 1600, REF_H = 900;

// Alt-Stände lagen in ungefähren Pixeln eines ~1000px breiten Boards. Einmalig
// in den REF-Raum hochskalieren (Faktor ~1.6), danach _ref markiert.
const load = () => {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY)) || [];
    return arr.map((it) => (it._ref ? it : {
      ...it, _ref: true,
      x: (it.x || 0) * 1.6, y: (it.y || 0) * 1.6,
      w: (it.w || 240) * 1.6, h: (it.h || 90) * 1.6,
      fontSize: Math.round((it.fontSize || 28) * 1.6),
    }));
  } catch { return []; }
};

export default function Tafel() {
  const { t } = useLanguage();
  const [items, setItems] = useState(load);
  const [sel, setSel] = useState(null);
  const outerRef = useRef(null);   // misst die verfügbare Breite, Ziel für Vollbild
  const [scale, setScale] = useState(1); // REF-Koordinaten -> Bildschirm
  const scaleRef = useRef(1);
  const drag = useRef(null); // { id, mode, sx, sy, ox, oy, ow, oh }

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* voll — egal */ } }, [items]);

  // Board hat eine feste Referenzgröße (REF_W×REF_H); die Anzeige wird über
  // transform:scale an die Breite angepasst. So bleiben alle Elemente relativ zur
  // Fläche stehen und verschwinden nie unten/rechts, egal wie breit der Bildschirm.
  useEffect(() => {
    const el = outerRef.current; if (!el) return;
    const measure = () => { const w = el.clientWidth || REF_W; const s = w / REF_W; scaleRef.current = s; setScale(s); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    document.addEventListener("fullscreenchange", measure);
    return () => { ro.disconnect(); document.removeEventListener("fullscreenchange", measure); };
  }, []);

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const clampX = (x, w) => Math.max(0, Math.min(REF_W - w, x));
  const clampY = (y, h) => Math.max(0, Math.min(REF_H - h, y));
  const add = () => {
    const w = 460, h = 150;
    const it = { id: uid(), type: "text", x: (REF_W - w) / 2, y: 120, w, h, text: "", fontSize: 48, color: "#111827", _ref: true };
    setItems((p) => [...p, it]); setSel(it.id);
  };
  const addTimer = () => {
    const w = 460, h = 340;
    const it = { id: uid(), type: "timer", x: (REF_W - w) / 2, y: 140, w, h, minutes: 5, _ref: true };
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
    const s = scaleRef.current || 1;
    const dx = (e.clientX - d.sx) / s, dy = (e.clientY - d.sy) / s; // Bildschirm -> REF
    if (d.mode === "move") patch(d.id, { x: clampX(d.ox + dx, d.ow), y: clampY(d.oy + dy, d.oh) });
    else {
      const w = Math.max(140, Math.min(REF_W - d.ox, d.ow + dx));
      const h = Math.max(90, Math.min(REF_H - d.oy, d.oh + dy));
      patch(d.id, { w, h });
    }
  };
  const onUp = () => { drag.current = null; window.removeEventListener("pointermove", onMove); };

  const selItem = items.find((i) => i.id === sel);
  const [fontPop, setFontPop] = useState(false);
  const [fs, setFs] = useState(false); // Pseudo-Vollbild (iOS kennt kein requestFullscreen für divs)
  const setFont = (v) => { if (selItem) patch(selItem.id, { fontSize: Math.max(16, Math.min(280, Math.round(v))) }); };
  const bumpFont = (delta) => { if (selItem) setFont((selItem.fontSize || 48) + delta); };
  // Wählt ein Element und holt es nach vorn — so lässt sich bei Überlappung das
  // obere greifen und wegziehen, um das untere freizulegen.
  const select = (id) => {
    setSel(id);
    setItems((p) => { const i = p.findIndex((x) => x.id === id); if (i < 0 || i === p.length - 1) return p; const n = [...p]; const [it] = n.splice(i, 1); n.push(it); return n; });
  };
  // Beim Auswählen die Farb-/Größen-Optik eingeklappt lassen (erst Stift zeigen).
  useEffect(() => { setFontPop(false); }, [sel]);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <style>{`@keyframes tafelFlash{0%,100%{background:transparent}50%{background:rgba(220,38,38,0.55)}}.tafel-flash{animation:tafelFlash .5s steps(1) 6}`}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ flex: 1 }} />
        <button onClick={add} style={{ ...btnPrimary, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon d={ICONS.plus} size={15} color="#fff" /> {t("tafel.add")}</button>
        <button onClick={addTimer} style={{ ...btnSecondary, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon d={ICONS.plus} size={15} /> {t("tafel.addTimer")}</button>
        <button onClick={() => setFs((v) => !v)} style={{ ...btnSecondary, display: "inline-flex", alignItems: "center", gap: 6 }} title={t("tafel.fullscreen")}><Icon d={fs ? ICONS.close : ICONS.fit} size={16} /> {fs ? t("common.close") : t("tafel.fullscreen")}</button>
      </div>

      {/* Tafel-Fläche: äußerer Rahmen misst die Breite, das innere Board hat feste
          Referenzgröße und wird per transform:scale eingepasst. Die Steuerleiste
          schwebt am gewählten Element (kein fester Balken oben). */}
      <div ref={outerRef} onPointerDown={() => setSel(null)}
        style={{ position: "relative", width: "100%", height: scale * REF_H, border: "1px solid var(--border)", borderRadius: fs ? 0 : 12, background: "var(--card)", overflow: "hidden",
          ...(fs ? { position: "fixed", inset: 0, width: "100vw", height: "100vh", zIndex: 9999 } : {}) }}>
        {fs && (
          <button onClick={() => setFs(false)} style={{ position: "absolute", top: 10, right: 10, zIndex: 20, ...btnSecondary, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon d={ICONS.close} size={16} /> {t("common.close")}
          </button>
        )}
        <div style={{ position: "absolute", top: 0, left: 0, width: REF_W, height: REF_H, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          {items.length === 0 && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text3)", fontSize: 28, pointerEvents: "none" }}>{t("tafel.empty")}</div>
          )}
          {items.map((it) => (
            <div key={it.id} onPointerDown={(e) => { e.stopPropagation(); select(it.id); }}
              style={{ position: "absolute", left: it.x, top: it.y, width: it.w, height: it.h,
                border: sel === it.id ? "3px solid var(--accent)" : "2px dashed transparent",
                borderRadius: 10, boxSizing: "border-box", background: sel === it.id ? "rgba(10,132,255,0.04)" : "transparent" }}>
              {it.type === "timer" ? (
                <TafelTimer item={it} onPatch={(o) => patch(it.id, o)} t={t} />
              ) : (
                <textarea value={it.text} onChange={(e) => patch(it.id, { text: e.target.value })} placeholder={t("tafel.placeholder")} className="keep-fontsize"
                  style={{ width: "100%", height: "100%", boxSizing: "border-box", border: "none", outline: "none", resize: "none", background: "transparent",
                    color: it.color, fontSize: it.fontSize, fontWeight: 700, lineHeight: 1.15, padding: "18px 16px 12px", overflow: "hidden", fontFamily: "inherit" }} />
              )}
              {/* Größen-Griff unten rechts (groß genug fürs Handy) */}
              <div onPointerDown={(e) => onDown(e, it.id, "resize")}
                style={{ position: "absolute", right: -3, bottom: -3, width: 44, height: 44, cursor: "nwse-resize", display: sel === it.id ? "block" : "none",
                  borderRight: "7px solid var(--accent)", borderBottom: "7px solid var(--accent)", borderBottomRightRadius: 10 }} />
            </div>
          ))}
        </div>

        {/* Steuerleiste schwebt direkt am gewählten Element (in Bildschirm-Pixeln,
            darum außerhalb der skalierten Fläche gerendert). */}
        {selItem && (() => {
          const ex = selItem.x * scale, ey = selItem.y * scale, eh = selItem.h * scale;
          const top = ey - 52 >= 4 ? ey - 52 : ey + eh + 8; // sonst unter das Element
          return (
            <div onPointerDown={(e) => e.stopPropagation()}
              style={{ position: "absolute", left: Math.max(4, ex), top, zIndex: 10, display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", border: "1px solid var(--border2)", borderRadius: 10, background: "var(--card)", boxShadow: "0 6px 20px rgba(0,0,0,0.16)", flexWrap: "wrap", maxWidth: "94%" }}>
              {/* Verschieben-Griff (in Bildschirmpixeln — auf dem Handy gut greifbar) */}
              <button onPointerDown={(e) => onDown(e, selItem.id, "move")} className="icon-btn" style={{ ...iconBtn, border: "1px solid var(--border2)", borderRadius: 8, cursor: "grab", touchAction: "none" }} title={t("tafel.move") || ""}>
                <Icon d={ICONS.moveAll} size={18} color="var(--text2)" />
              </button>
              {selItem.type !== "timer" && (<>
                <button onClick={() => setFontPop((v) => !v)} className="icon-btn" style={{ ...iconBtn, border: fontPop ? "1px solid var(--accent)" : "1px solid var(--border2)", borderRadius: 8 }} title={t("tafel.textSize")}>
                  <Icon d={ICONS.edit} size={16} color={fontPop ? "var(--accent)" : "var(--text2)"} />
                </button>
                {fontPop && (<>
                  {COLORS.map((c) => (
                    <button key={c} onClick={() => patch(selItem.id, { color: c })} title={t("tafel.color")}
                      style={{ width: 22, height: 22, borderRadius: 6, background: c, border: selItem.color === c ? "2px solid var(--accent)" : "1px solid var(--border2)", cursor: "pointer" }} />
                  ))}
                  <button onClick={() => bumpFont(-2)} style={{ ...btnSecondary, padding: "4px 12px", fontWeight: 700 }}>A−</button>
                  <span style={{ fontSize: 13, minWidth: 40, textAlign: "center", fontWeight: 600 }}>{selItem.fontSize}</span>
                  <button onClick={() => bumpFont(2)} style={{ ...btnSecondary, padding: "4px 12px", fontWeight: 700 }}>A+</button>
                </>)}
              </>)}
              {selItem.type === "timer" && (
                <button onClick={() => patch(selItem.id, { muted: !selItem.muted })} style={{ ...btnSecondary, padding: "4px 12px", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {selItem.muted ? "🔇" : "🔊"} {selItem.muted ? t("tafel.soundOff") : t("tafel.soundOn")}
                </button>
              )}
              <span style={{ width: 1, height: 20, background: "var(--border)", margin: "0 2px" }} />
              <button onClick={() => del(selItem.id)} className="icon-btn" style={{ ...iconBtn }} title={t("common.delete")}><Icon d={ICONS.trash} size={16} color={C.danger} /></button>
            </div>
          );
        })()}
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
  const bump = (d) => onPatch({ minutes: Math.max(1, Math.min(180, (item.minutes || 5) + d)) });
  const bh = item.h || 150;
  return (
    <div className={flash ? "tafel-flash" : ""} style={{ width: "100%", height: "100%", boxSizing: "border-box", borderRadius: 8, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "22px 12px 16px" }}>
      <div style={{ fontSize: Math.max(28, Math.min(bh * 0.42, item.w * 0.32)), fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: done ? "#dc2626" : "var(--text)" }}>{fmt(remaining)}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", justifyContent: "center" }}>
        <button onClick={() => bump(-1)} style={{ ...miniBtn }}>−</button>
        <span style={{ fontSize: 30, color: "var(--text2)", minWidth: 120, textAlign: "center", fontWeight: 600 }}>{item.minutes || 5} {t("tafel.min")}</span>
        <button onClick={() => bump(1)} style={{ ...miniBtn }}>＋</button>
      </div>
      <div style={{ display: "flex", gap: 14 }}>
        {!running
          ? <button onClick={() => { if (!done) setRunning(true); }} disabled={done} style={{ ...miniBtn, opacity: done ? 0.5 : 1 }}>▶</button>
          : <button onClick={() => setRunning(false)} style={{ ...miniBtn }}>❚❚</button>}
        <button onClick={() => { setRunning(false); setRemaining(total); }} style={{ ...miniBtn }}>↺</button>
      </div>
    </div>
  );
}

const miniBtn = { padding: "8px 22px", fontSize: 32, fontWeight: 700, lineHeight: 1, border: "2px solid var(--border2)", borderRadius: 12, background: "var(--bg)", color: "var(--text)", cursor: "pointer" };
