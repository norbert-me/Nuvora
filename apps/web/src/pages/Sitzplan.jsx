// Modul Sitzplan — Sitzordnung je Klasse auf einem Raster.
// Schüler per Drag & Drop aus dem Pool in eine Zelle ziehen (oder zwischen
// Zellen). Gespeichert werden nur Positionen: { cols, cells: [studentId|null] }.
import { useState, useEffect, useMemo, useCallback } from "react";
import { pageTitle, btnPrimary, btnSecondary, selectStyle, Icon, ICONS, iconBtn, COLORS as C } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { swr } from "../core/cache.js";

const API = "/api/sitzplan";

export default function Sitzplan() {
  const { t } = useLanguage();
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState(null);
  const [cols, setCols] = useState(6);
  const [cells, setCells] = useState([]); // Länge = Zellen; Wert studentId|null
  const [drag, setDrag] = useState(null); // { from: "pool"|index, id }
  const [over, setOver] = useState(null);  // Zielzelle-Index oder "pool" (Vorschau)
  const [msg, setMsg] = useState("");

  useEffect(() => {
    return swr("classes", "/api/classes", (d) => {
      const list = Array.isArray(d) ? d : [];
      setClasses(list);
      if (classId === null && list.length) setClassId(list[0].id);
    });
  }, []);

  const cls = useMemo(() => classes.find((c) => c.id === classId), [classes, classId]);
  const students = useMemo(() => cls?.students || [], [cls]);

  const load = useCallback((id) => {
    if (!id) return;
    fetch(`${API}/${id}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) { setCols(6); setCells([]); return; }
      setCols(d.cols || 6);
      setCells(Array.isArray(d.cells) ? d.cells : []);
    }).catch(() => {});
  }, []);
  useEffect(() => { load(classId); }, [classId, load]);

  // Zellenzahl an Spalten anpassen: mindestens so viele Reihen, dass alle
  // Schüler Platz haben, plus eine leere Reihe.
  const rows = Math.max(Math.ceil((students.length + 1) / cols), Math.ceil(cells.length / cols) || 1);
  const total = rows * cols;
  const grid = [...cells];
  while (grid.length < total) grid.push(null);

  const placed = new Set(grid.filter((x) => x != null));
  const pool = students.filter((s) => !placed.has(s.id));
  const byId = (id) => students.find((s) => s.id === id);

  const persist = (nextCols, nextCells) => {
    if (!classId) return;
    fetch(`${API}/${classId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cols: nextCols, cells: nextCells }) }).catch(() => {});
  };

  const dropOnCell = (idx) => {
    if (!drag) return;
    const next = [...grid];
    if (drag.from === "pool") {
      // In Zelle setzen; falls belegt, den bisherigen zurück in den Pool (raus).
      next[idx] = drag.id;
    } else {
      // Zwischen Zellen tauschen.
      const tmp = next[idx];
      next[idx] = drag.id;
      next[drag.from] = tmp;
    }
    setCells(next); setDrag(null); setOver(null); persist(cols, next);
  };
  const dropOnPool = () => {
    if (!drag || drag.from === "pool") { setDrag(null); setOver(null); return; }
    const next = [...grid]; next[drag.from] = null;
    setCells(next); setDrag(null); setOver(null); persist(cols, next);
  };
  const setColsPersist = (n) => { const v = Math.max(2, Math.min(12, n)); setCols(v); persist(v, grid); };
  const leeren = () => { setCells([]); persist(cols, []); setMsg(t("sitzplan.cleared")); setTimeout(() => setMsg(""), 2500); };

  const seatStyle = (filled) => ({
    minHeight: 52, borderRadius: 10, border: filled ? "1px solid var(--border2)" : "1px dashed var(--border2)",
    background: filled ? "var(--card)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center",
    padding: 6, fontSize: 13, fontWeight: 600, textAlign: "center", cursor: filled ? "grab" : "default", color: "var(--text)",
  });

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <h1 style={{ ...pageTitle, marginBottom: 0 }}>{t("sitzplan.title")}</h1>
        <select value={classId ?? ""} onChange={(e) => setClassId(Number(e.target.value))} style={selectStyle}>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          <span style={{ fontSize: 12.5, color: "var(--text3)" }}>{t("sitzplan.cols")}</span>
          <button onClick={() => setColsPersist(cols - 1)} style={{ ...btnSecondary, padding: "4px 10px" }}>−</button>
          <span style={{ minWidth: 20, textAlign: "center", fontWeight: 600 }}>{cols}</span>
          <button onClick={() => setColsPersist(cols + 1)} style={{ ...btnSecondary, padding: "4px 10px" }}>+</button>
          <button onClick={leeren} className="icon-btn" style={{ ...iconBtn, marginLeft: 6 }} title={t("sitzplan.clear")}><Icon d={ICONS.restore} color={C.danger} /></button>
        </div>
      </div>
      <p style={{ fontSize: 13, color: "var(--text3)", margin: "8px 0 18px" }}>{t("sitzplan.hint")}</p>
      {msg && <p style={{ fontSize: 13, color: "#0a7d3e", marginBottom: 10 }}>{msg}</p>}

      {students.length === 0 ? (
        <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("sitzplan.noStudents")}</p>
      ) : (
        <>
          {/* Tafel-Hinweis, damit "vorne" klar ist */}
          <div style={{ textAlign: "center", fontSize: 11.5, letterSpacing: "0.1em", color: "var(--text3)", textTransform: "uppercase", padding: "6px 0", marginBottom: 10, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg2)" }}>{t("sitzplan.board")}</div>

          <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8, marginBottom: 24 }}>
            {grid.map((sid, idx) => {
              const s = sid != null ? byId(sid) : null;
              return (
                <div key={idx}
                  draggable={!!s}
                  onDragStart={() => s && setDrag({ from: idx, id: sid })}
                  onDragOver={(e) => { e.preventDefault(); if (drag && over !== idx) setOver(idx); }}
                  onDrop={() => dropOnCell(idx)}
                  onDragEnd={() => { setDrag(null); setOver(null); }}
                  style={{ ...seatStyle(!!s), opacity: drag && drag.from === idx ? 0.4 : 1,
                    // Vorschau: wo die gezogene Person landen wuerde.
                    ...(drag && over === idx ? { outline: "2px solid var(--accent)", outlineOffset: -2, background: "var(--accent-bg, rgba(10,132,255,0.12))" } : {}) }}>
                  {drag && over === idx && drag.id !== sid ? (byId(drag.id)?.name || (s ? s.name : "")) : (s ? s.name : "")}
                </div>
              );
            })}
          </div>

          <div onDragOver={(e) => { e.preventDefault(); if (over !== "pool") setOver("pool"); }} onDrop={dropOnPool}
            style={{ borderRadius: 12, padding: 12, minHeight: 60, background: "var(--bg2)",
              border: drag && over === "pool" && drag.from !== "pool" ? "1px solid var(--accent)" : "1px dashed var(--border2)" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              {t("sitzplan.pool")} ({pool.length})
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {pool.map((s) => (
                <div key={s.id} draggable onDragStart={() => setDrag({ from: "pool", id: s.id })}
                  style={{ padding: "7px 12px", borderRadius: 980, border: "1px solid var(--border2)", background: "var(--card)", fontSize: 13, fontWeight: 600, cursor: "grab" }}>
                  {s.name}
                </div>
              ))}
              {pool.length === 0 && <span style={{ fontSize: 13, color: "var(--text3)" }}>{t("sitzplan.allSeated")}</span>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
