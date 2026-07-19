// Modul Sitzplan — freie Fläche statt Raster. Tische frei platzieren und
// drehen (z.B. schräge Tische). Gespeichert wird { seats: [{sid,x,y,rot}] }.
// Schüler bleiben im Kern; hier nur ihre Positionen (Regel 3).
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { pageTitle, btnSecondary, selectStyle, Icon, ICONS, iconBtn, COLORS as C } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { useModules } from "../core/modules.js";
import { swr , lastClass, rememberClass } from "../core/cache.js";

const API = "/api/sitzplan";
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ABS_COL = { fehlt: "#d1350f", spaet: "#b8860b", entsch: "#2563eb" };
const SEAT_W = 108, SEAT_H = 46;

export default function Sitzplan() {
  const { t } = useLanguage();
  const { modules } = useModules();
  const anwesenheitAktiv = modules.find((m) => m.key === "anwesenheit")?.active ?? false;
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState(null);
  const [seats, setSeats] = useState([]); // [{sid,x,y,rot}]
  const [abwesend, setAbwesend] = useState({});
  const [aufruf, setAufruf] = useState(false);
  const [msg, setMsg] = useState("");
  const canvasRef = useRef(null);
  const dragRef = useRef(null); // { sid, dx, dy } aktives Ziehen

  useEffect(() => {
    return swr("classes", "/api/classes", (d) => {
      const list = Array.isArray(d) ? d : [];
      setClasses(list);
      if (classId === null && list.length) { const w = lastClass(); setClassId(list.some((c) => c.id === w) ? w : list[0].id); }
    });
  }, []);

  useEffect(() => { if (classId) rememberClass(classId); }, [classId]);

  const cls = useMemo(() => classes.find((c) => c.id === classId), [classes, classId]);
  const students = useMemo(() => cls?.students || [], [cls]);
  const byId = (id) => students.find((s) => s.id === id);

  const load = useCallback((id) => {
    if (!id) return;
    fetch(`${API}/${id}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) { setSeats([]); return; }
      // Altes Raster (cells) einmalig in freie Positionen umrechnen.
      if (Array.isArray(d.seats)) { setSeats(d.seats); return; }
      if (Array.isArray(d.cells)) {
        const cols = d.cols || 6;
        const migr = [];
        d.cells.forEach((sid, i) => { if (sid != null) migr.push({ sid, x: 20 + (i % cols) * (SEAT_W + 14), y: 20 + Math.floor(i / cols) * (SEAT_H + 18), rot: 0 }); });
        setSeats(migr);
      } else setSeats([]);
    }).catch(() => {});
  }, []);
  useEffect(() => { load(classId); }, [classId, load]);

  useEffect(() => {
    if (!anwesenheitAktiv || !aufruf || !classId) { setAbwesend({}); return; }
    fetch(`/api/anwesenheit/${classId}?date=${new Date(ymd(new Date()) + "T00:00:00").toISOString()}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((d) => { const m = {}; Object.entries(d || {}).forEach(([sid, v]) => { if (v.status && v.status !== "da") m[sid] = v.status; }); setAbwesend(m); })
      .catch(() => {});
  }, [anwesenheitAktiv, aufruf, classId]);

  const persist = (next) => {
    setSeats(next);
    if (classId) fetch(`${API}/${classId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seats: next }) }).catch(() => {});
  };

  const platziert = new Set(seats.map((s) => s.sid));
  const pool = students.filter((s) => !platziert.has(s.id));

  // ── Ziehen platzierter Tische (Pointer, damit es flüssig folgt) ──
  const onSeatDown = (e, seat) => {
    if (aufruf) return;
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    dragRef.current = { sid: seat.sid, dx: e.clientX - rect.left - seat.x, dy: e.clientY - rect.top - seat.y };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const onMove = (e) => {
    const d = dragRef.current; if (!d) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left - d.dx, rect.width - SEAT_W));
    const y = Math.max(0, Math.min(e.clientY - rect.top - d.dy, rect.height - SEAT_H));
    setSeats((prev) => prev.map((s) => (s.sid === d.sid ? { ...s, x, y } : s)));
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    if (dragRef.current) { dragRef.current = null; setSeats((prev) => { persist(prev); return prev; }); }
  };

  const drehen = (sid) => persist(seats.map((s) => (s.sid === sid ? { ...s, rot: ((s.rot || 0) + 15) % 360 } : s)));
  const entfernen = (sid) => persist(seats.filter((s) => s.sid !== sid));

  // Pool → Fläche (HTML5-Drop; Position aus der Cursorstelle).
  const onCanvasDrop = (e) => {
    e.preventDefault();
    const sid = Number(e.dataTransfer.getData("text/plain"));
    if (!sid || platziert.has(sid)) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left - SEAT_W / 2, rect.width - SEAT_W));
    const y = Math.max(0, Math.min(e.clientY - rect.top - SEAT_H / 2, rect.height - SEAT_H));
    persist([...seats, { sid, x, y, rot: 0 }]);
  };

  const leeren = () => { persist([]); setMsg(t("sitzplan.cleared")); setTimeout(() => setMsg(""), 2500); };

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <h1 style={{ ...pageTitle, marginBottom: 0 }}>{t("sitzplan.title")}</h1>
        <select value={classId ?? ""} onChange={(e) => setClassId(Number(e.target.value))} style={selectStyle}>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {anwesenheitAktiv && (
          <button onClick={() => setAufruf((a) => !a)} style={{ padding: "6px 13px", fontSize: 13, fontWeight: 600, borderRadius: 980, cursor: "pointer", border: aufruf ? "1px solid var(--accent)" : "1px solid var(--border2)", background: aufruf ? "var(--accent)" : "transparent", color: aufruf ? "#fff" : "var(--text2)" }}>{t("sitzplan.rollcall")}</button>
        )}
        <button onClick={leeren} className="icon-btn" style={{ ...iconBtn, marginLeft: anwesenheitAktiv ? 0 : "auto" }} title={t("sitzplan.clear")}><Icon d={ICONS.restore} color={C.danger} /></button>
      </div>
      <p style={{ fontSize: 13, color: "var(--text3)", margin: "8px 0 14px" }}>{t("sitzplan.hintFree")}</p>
      {msg && <p style={{ fontSize: 13, color: "#0a7d3e", marginBottom: 10 }}>{msg}</p>}

      {students.length === 0 ? (
        <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("sitzplan.noStudents")}</p>
      ) : (
        <>
          <div style={{ textAlign: "center", fontSize: 11.5, letterSpacing: "0.1em", color: "var(--text3)", textTransform: "uppercase", padding: "6px 0", marginBottom: 8, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg2)" }}>{t("sitzplan.board")}</div>

          <div ref={canvasRef} onDragOver={(e) => e.preventDefault()} onDrop={onCanvasDrop}
            style={{ position: "relative", height: 520, border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)", overflow: "hidden", marginBottom: 18,
              backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)", backgroundSize: "24px 24px" }}>
            {seats.map((seat) => {
              const s = byId(seat.sid); if (!s) return null;
              const abs = aufruf ? abwesend[String(seat.sid)] : null;
              return (
                <div key={seat.sid}
                  onPointerDown={(e) => onSeatDown(e, seat)}
                  style={{ position: "absolute", left: seat.x, top: seat.y, width: SEAT_W, minHeight: SEAT_H,
                    transform: `rotate(${seat.rot || 0}deg)`, transformOrigin: "center",
                    display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center",
                    padding: "6px 22px 6px 8px", borderRadius: 8, border: "1px solid var(--border2)",
                    background: abs ? "var(--bg2)" : "var(--bg)", color: "var(--text)", fontSize: 12.5, fontWeight: 600,
                    cursor: aufruf ? "default" : "grab", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", userSelect: "none",
                    opacity: abs ? 0.5 : 1, textDecoration: abs ? "line-through" : "none" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                  {abs && <span style={{ position: "absolute", top: 3, right: 24, width: 8, height: 8, borderRadius: 4, background: ABS_COL[abs] }} title={t(`anwesenheit.${abs}`)} />}
                  {!aufruf && (
                    <div style={{ position: "absolute", right: 2, top: 2, display: "flex", flexDirection: "column", gap: 1 }}>
                      <button onPointerDown={(e) => e.stopPropagation()} onClick={() => drehen(seat.sid)} title={t("sitzplan.rotate")}
                        style={{ width: 16, height: 16, border: "none", background: "transparent", cursor: "pointer", color: "var(--text3)", fontSize: 11, padding: 0, lineHeight: 1 }}>↻</button>
                      <button onPointerDown={(e) => e.stopPropagation()} onClick={() => entfernen(seat.sid)} title={t("sitzplan.removeSeat")}
                        style={{ width: 16, height: 16, border: "none", background: "transparent", cursor: "pointer", color: C.danger, fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ border: "1px dashed var(--border2)", borderRadius: 12, padding: 12, minHeight: 56, background: "var(--bg2)" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>{t("sitzplan.pool")} ({pool.length})</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {pool.map((s) => {
                const abs = aufruf ? abwesend[String(s.id)] : null;
                return (
                  <div key={s.id} draggable={!aufruf} onDragStart={(e) => e.dataTransfer.setData("text/plain", String(s.id))}
                    style={{ padding: "7px 12px", borderRadius: 980, border: "1px solid var(--border2)", background: "var(--card)", fontSize: 13, fontWeight: 600, cursor: aufruf ? "default" : "grab", display: "inline-flex", alignItems: "center", gap: 6, ...(abs ? { opacity: 0.45, textDecoration: "line-through" } : {}) }}>
                    {abs && <span style={{ width: 8, height: 8, borderRadius: 4, background: ABS_COL[abs] }} />}
                    {s.name}
                  </div>
                );
              })}
              {pool.length === 0 && <span style={{ fontSize: 13, color: "var(--text3)" }}>{t("sitzplan.allSeated")}</span>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
