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
    const it = { id: uid(), x: b ? b.width / 2 - 120 : 60, y: 60, w: 240, h: 90, text: "", fontSize: 28, color: "#111827" };
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
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <h1 style={{ ...pageTitle, marginBottom: 0, flex: 1 }}>{t("tafel.title")}</h1>
        <button onClick={add} style={{ ...btnPrimary, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon d={ICONS.plus} size={15} color="#fff" /> {t("tafel.add")}</button>
        <button onClick={() => boardRef.current?.requestFullscreen?.()} style={{ ...btnSecondary, display: "inline-flex", alignItems: "center", gap: 6 }} title={t("tafel.fullscreen")}><Icon d={ICONS.fit} size={16} /> {t("tafel.fullscreen")}</button>
      </div>

      {/* Werkzeugleiste für das gewählte Feld */}
      {selItem && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--card)", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: "var(--text3)" }}>{t("tafel.textSize")}</span>
          <button onClick={() => bumpFont(-4)} style={{ ...btnSecondary, padding: "4px 12px", fontWeight: 700 }}>A−</button>
          <span style={{ fontSize: 13, minWidth: 34, textAlign: "center" }}>{selItem.fontSize}</span>
          <button onClick={() => bumpFont(4)} style={{ ...btnSecondary, padding: "4px 12px", fontWeight: 700 }}>A+</button>
          <span style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px" }} />
          {COLORS.map((c) => (
            <button key={c} onClick={() => patch(selItem.id, { color: c })} title={t("tafel.color")}
              style={{ width: 22, height: 22, borderRadius: 6, background: c, border: selItem.color === c ? "2px solid var(--accent)" : "1px solid var(--border2)", cursor: "pointer" }} />
          ))}
          <span style={{ flex: 1 }} />
          <button onClick={() => del(selItem.id)} className="icon-btn" style={{ ...iconBtn }} title={t("common.delete")}><Icon d={ICONS.trash} size={16} color={C.danger} /></button>
        </div>
      )}

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
            <textarea value={it.text} onChange={(e) => patch(it.id, { text: e.target.value })} placeholder={t("tafel.placeholder")}
              style={{ width: "100%", height: "100%", boxSizing: "border-box", border: "none", outline: "none", resize: "none", background: "transparent",
                color: it.color, fontSize: it.fontSize, fontWeight: 700, lineHeight: 1.15, padding: "12px 10px 8px", overflow: "hidden", fontFamily: "inherit" }} />
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
