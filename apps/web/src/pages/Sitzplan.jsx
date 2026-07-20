// Modul Sitzplan — freie Fläche statt Raster. Tische frei platzieren und
// drehen (z.B. schräge Tische). Gespeichert wird { seats: [{sid,x,y,rot}] }.
// Schüler bleiben im Kern; hier nur ihre Positionen (Regel 3).
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { pageTitle, btnSecondary, selectStyle, Icon, ICONS, iconBtn, COLORS as C } from "../components/Icons.jsx";
import KursKlasseSelect from "../components/KursKlasseSelect.jsx";
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
  // Anwesenheit lebt im Modul „Orga" (Aufruf-Ansicht nutzt sie).
  const anwesenheitAktiv = modules.find((m) => m.key === "orga")?.active ?? false;
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState(null);
  const [kursId, setKursId] = useState(null); // Sitzplan hängt am Kurs (Fach)
  const [seats, setSeats] = useState([]); // [{sid,x,y,rot}]
  const [tafel, setTafel] = useState({ x: 200, y: 8 }); // bewegliche Tafel
  const tafelRef = useRef(null);
  const [zoom, setZoom] = useState(1); // Anzeige-Zoom (Positionen bleiben unskaliert gespeichert)
  const [abwesend, setAbwesend] = useState({});
  const [aufruf, setAufruf] = useState(false);
  const [showHint, setShowHint] = useState(false); // Erklärung per „i" ein-/ausblenden
  const [msg, setMsg] = useState("");
  const canvasRef = useRef(null);
  const dragRef = useRef(null); // { sid, dx, dy } aktives Ziehen

  const [kurse, setKurse] = useState([]);
  useEffect(() => {
    fetch("/api/kurse").then((r) => (r.ok ? r.json() : [])).then((d) => setKurse(Array.isArray(d) ? d : [])).catch(() => {});
    return swr("classes", "/api/classes", (d) => {
      const list = Array.isArray(d) ? d : [];
      setClasses(list);
      if (classId === null && list.length) { const w = lastClass(); setClassId(list.some((c) => c.id === w) ? w : list[0].id); }
    });
  }, []);

  useEffect(() => { if (classId) rememberClass(classId); }, [classId]);

  const cls = useMemo(() => classes.find((c) => c.id === classId), [classes, classId]);
  // Sitzplan gilt kursweit: Roster = kanonische SuS des Kurses (gleichnamige
  // Fach-Klassen-SuS = eine Person), damit die gespeicherten Sitz-IDs passen.
  const students = useMemo(() => {
    if (!cls) return [];
    const kurs = kurse.find((k) => (k.classes || []).some((c) => c.id === cls.id));
    const sib = kurs ? new Set(kurs.classes.map((c) => c.id)) : new Set([cls.id]);
    const all = classes.filter((c) => sib.has(c.id)).flatMap((c) => c.students || []);
    const canon = {};
    all.forEach((s) => { const n = s.name.trim(); if (!(n in canon)) canon[n] = s; });
    return Object.values(canon).sort((a, b) => a.card_id - b.card_id);
  }, [cls, classes, kurse]);
  const byId = (id) => students.find((s) => s.id === id);

  const kursQ = kursId != null ? `?kurs_id=${kursId}` : "";
  const load = useCallback((id) => {
    if (!id) return;
    fetch(`${API}/${id}${kursId != null ? `?kurs_id=${kursId}` : ""}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) { setSeats([]); return; }
      setTafel(d.tafel && typeof d.tafel.x === "number" ? d.tafel : { x: 200, y: 8 });
      // Altes Raster (cells) einmalig in freie Positionen umrechnen.
      if (Array.isArray(d.seats)) { setSeats(d.seats); return; }
      if (Array.isArray(d.cells)) {
        const cols = d.cols || 6;
        const migr = [];
        d.cells.forEach((sid, i) => { if (sid != null) migr.push({ sid, x: 20 + (i % cols) * (SEAT_W + 14), y: 20 + Math.floor(i / cols) * (SEAT_H + 18), rot: 0 }); });
        setSeats(migr);
      } else setSeats([]);
    }).catch(() => {});
  }, [kursId]);
  useEffect(() => { load(classId); }, [classId, kursId, load]);

  useEffect(() => {
    if (!anwesenheitAktiv || !aufruf || !classId) { setAbwesend({}); return; }
    fetch(`/api/anwesenheit/${classId}?date=${new Date(ymd(new Date()) + "T00:00:00").toISOString()}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((d) => { const m = {}; Object.entries(d || {}).forEach(([sid, v]) => { if (v.status && v.status !== "da") m[sid] = v.status; }); setAbwesend(m); })
      .catch(() => {});
  }, [anwesenheitAktiv, aufruf, classId]);

  const persist = (next, tf = tafel) => {
    setSeats(next);
    if (classId) fetch(`${API}/${classId}${kursQ}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seats: next, tafel: tf }) }).catch(() => {});
  };

  // Tafel ziehen (Pointer). Breite/Höhe der Tafel-Fläche.
  const TAFEL_W = 200, TAFEL_H = 30;
  const onTafelDown = (e) => {
    if (aufruf) return;
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    tafelRef.current = { dx: (e.clientX - rect.left) / zoom - tafel.x, dy: (e.clientY - rect.top) / zoom - tafel.y };
    window.addEventListener("pointermove", onTafelMove);
    window.addEventListener("pointerup", onTafelUp);
  };
  const onTafelMove = (e) => {
    const d = tafelRef.current; if (!d) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min((e.clientX - rect.left) / zoom - d.dx, rect.width / zoom - TAFEL_W));
    const y = Math.max(0, Math.min((e.clientY - rect.top) / zoom - d.dy, rect.height / zoom - TAFEL_H));
    setTafel({ x, y });
  };
  const onTafelUp = () => {
    window.removeEventListener("pointermove", onTafelMove);
    window.removeEventListener("pointerup", onTafelUp);
    if (tafelRef.current) { tafelRef.current = null; setTafel((tf) => { persist(seats, tf); return tf; }); }
  };

  const platziert = new Set(seats.map((s) => s.sid));
  const pool = students.filter((s) => !platziert.has(s.id));

  // ── Ziehen platzierter Tische (Pointer, damit es flüssig folgt) ──
  const onSeatDown = (e, seat) => {
    if (aufruf) return;
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    dragRef.current = { sid: seat.sid, dx: (e.clientX - rect.left) / zoom - seat.x, dy: (e.clientY - rect.top) / zoom - seat.y };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const onMove = (e) => {
    const d = dragRef.current; if (!d) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min((e.clientX - rect.left) / zoom - d.dx, rect.width / zoom - SEAT_W));
    const y = Math.max(0, Math.min((e.clientY - rect.top) / zoom - d.dy, rect.height / zoom - SEAT_H));
    setSeats((prev) => prev.map((s) => (s.sid === d.sid ? { ...s, x, y } : s)));
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    if (dragRef.current) { dragRef.current = null; setSeats((prev) => { persist(prev); return prev; }); }
  };

  const entfernen = (sid) => persist(seats.filter((s) => s.sid !== sid));

  // ── Freie Drehung per Eck-Griff (oben rechts). Winkel = Richtung vom
  // Tisch-Mittelpunkt zum Zeiger. ──
  const rotRef = useRef(null);
  const _angle = (e, cx, cy) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return Math.atan2((e.clientY - rect.top) / zoom - cy, (e.clientX - rect.left) / zoom - cx) * 180 / Math.PI;
  };
  const onRotDown = (e, seat) => {
    if (aufruf) return;
    e.preventDefault(); e.stopPropagation();
    const cx = seat.x + SEAT_W / 2, cy = seat.y + SEAT_H / 2;
    // Relativ drehen: Start-Zeigerwinkel und Start-Drehung merken, damit das
    // Greifen des Griffs nicht sofort auf einen absoluten Winkel springt.
    rotRef.current = { sid: seat.sid, cx, cy, startAngle: _angle(e, cx, cy), startRot: seat.rot || 0 };
    window.addEventListener("pointermove", onRotMove);
    window.addEventListener("pointerup", onRotUp);
  };
  const onRotMove = (e) => {
    const d = rotRef.current; if (!d) return;
    let deg = Math.round(d.startRot + (_angle(e, d.cx, d.cy) - d.startAngle));
    deg = ((deg % 360) + 360) % 360;
    setSeats((prev) => prev.map((s) => (s.sid === d.sid ? { ...s, rot: deg } : s)));
  };
  const onRotUp = () => {
    window.removeEventListener("pointermove", onRotMove);
    window.removeEventListener("pointerup", onRotUp);
    if (rotRef.current) { rotRef.current = null; setSeats((prev) => { persist(prev); return prev; }); }
  };

  // Tafel drehen (gleicher Eck-Griff-Mechanismus).
  const tafelRotRef = useRef(null);
  const onTafelRotDown = (e) => {
    if (aufruf) return;
    e.preventDefault(); e.stopPropagation();
    const cx = tafel.x + TAFEL_W / 2, cy = tafel.y + TAFEL_H / 2;
    tafelRotRef.current = { cx, cy, startAngle: _angle(e, cx, cy), startRot: tafel.rot || 0 };
    window.addEventListener("pointermove", onTafelRotMove);
    window.addEventListener("pointerup", onTafelRotUp);
  };
  const onTafelRotMove = (e) => {
    const d = tafelRotRef.current; if (!d) return;
    let deg = Math.round(d.startRot + (_angle(e, d.cx, d.cy) - d.startAngle));
    deg = ((deg % 360) + 360) % 360;
    setTafel((tf) => ({ ...tf, rot: deg }));
  };
  const onTafelRotUp = () => {
    window.removeEventListener("pointermove", onTafelRotMove);
    window.removeEventListener("pointerup", onTafelRotUp);
    if (tafelRotRef.current) { tafelRotRef.current = null; setTafel((tf) => { persist(seats, tf); return tf; }); }
  };

  // Pool → Fläche (HTML5-Drop; Position aus der Cursorstelle).
  const onCanvasDrop = (e) => {
    e.preventDefault();
    const sid = Number(e.dataTransfer.getData("text/plain"));
    if (!sid || platziert.has(sid)) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min((e.clientX - rect.left) / zoom - SEAT_W / 2, rect.width / zoom - SEAT_W));
    const y = Math.max(0, Math.min((e.clientY - rect.top) / zoom - SEAT_H / 2, rect.height / zoom - SEAT_H));
    persist([...seats, { sid, x, y, rot: 0 }]);
  };

  const leeren = () => { persist([]); setMsg(t("sitzplan.cleared")); setTimeout(() => setMsg(""), 2500); };

  // Ebene verschieben: leere Fläche greifen und die ganze Ansicht schieben
  // (pant den Scroll-Container). Nur wenn direkt auf die Fläche geklickt wird.
  const scrollRef = useRef(null);
  const panRef = useRef(null);
  const onCanvasDown = (e) => {
    if (aufruf || e.target !== canvasRef.current) return;
    panRef.current = { x: e.clientX, y: e.clientY, l: scrollRef.current.scrollLeft, t: scrollRef.current.scrollTop };
    window.addEventListener("pointermove", onPanMove);
    window.addEventListener("pointerup", onPanUp);
  };
  const onPanMove = (e) => {
    const p = panRef.current; if (!p) return;
    scrollRef.current.scrollLeft = p.l - (e.clientX - p.x);
    scrollRef.current.scrollTop = p.t - (e.clientY - p.y);
  };
  const onPanUp = () => {
    window.removeEventListener("pointermove", onPanMove);
    window.removeEventListener("pointerup", onPanUp);
    panRef.current = null;
  };

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <h1 style={{ ...pageTitle, marginBottom: 0 }}>{t("sitzplan.title")}</h1>
        <KursKlasseSelect value={classId} onChange={(id, kid) => { setClassId(id); setKursId(kid); }} onKurs={setKursId} />
        {anwesenheitAktiv && (
          <button onClick={() => setAufruf((a) => !a)} style={{ padding: "6px 13px", fontSize: 13, fontWeight: 600, borderRadius: 980, cursor: "pointer", border: aufruf ? "1px solid var(--accent)" : "1px solid var(--border2)", background: aufruf ? "var(--accent)" : "transparent", color: aufruf ? "#fff" : "var(--text2)" }}>{t("sitzplan.rollcall")}</button>
        )}
        <button onClick={() => setShowHint((v) => !v)} className="icon-btn" title={t("sitzplan.hintFree")}
          style={{ ...iconBtn, border: showHint ? "1px solid var(--accent)" : "1px solid var(--border2)", borderRadius: 999, width: 30, height: 30, fontWeight: 700, color: showHint ? "var(--accent)" : "var(--text3)" }}>i</button>
        <button onClick={leeren} className="icon-btn" style={{ ...iconBtn, marginLeft: anwesenheitAktiv ? 0 : "auto" }} title={t("sitzplan.clear")}><Icon d={ICONS.trash} color={C.danger} /></button>
      </div>
      {showHint && <p style={{ fontSize: 13, color: "var(--text3)", margin: "8px 0 14px" }}>{t("sitzplan.hintFree")}</p>}
      {msg && <p style={{ fontSize: 13, color: "#0a7d3e", marginBottom: 10 }}>{msg}</p>}

      {students.length === 0 ? (
        <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("sitzplan.noStudents")}</p>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, color: "var(--text3)" }}>{t("sitzplan.zoom")}</span>
            <button onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))} style={{ ...iconBtn, border: "1px solid var(--border2)", borderRadius: 8, width: 28, height: 28, fontSize: 16 }}>−</button>
            <span style={{ fontSize: 12.5, color: "var(--text2)", minWidth: 40, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.1) * 10) / 10))} style={{ ...iconBtn, border: "1px solid var(--border2)", borderRadius: 8, width: 28, height: 28, fontSize: 16 }}>+</button>
            {zoom !== 1 && <button onClick={() => setZoom(1)} style={{ ...btnSecondary, padding: "4px 10px", fontSize: 12 }}>{t("sitzplan.zoomReset")}</button>}
          </div>
          <div ref={scrollRef} style={{ height: 520, overflow: "auto", border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)", marginBottom: 18 }}>
          <div ref={canvasRef} onPointerDown={onCanvasDown} onDragOver={(e) => e.preventDefault()} onDrop={onCanvasDrop}
            style={{ position: "relative", height: 760, width: 1200, transform: `scale(${zoom})`, transformOrigin: "0 0",
              cursor: aufruf ? "default" : "grab",
              backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)", backgroundSize: "24px 24px" }}>
            {/* Bewegliche Tafel */}
            <div onPointerDown={onTafelDown}
              style={{ position: "absolute", left: tafel.x, top: tafel.y, width: TAFEL_W, height: TAFEL_H,
                transform: `rotate(${tafel.rot || 0}deg)`, transformOrigin: "center",
                display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center",
                fontSize: 11.5, letterSpacing: "0.1em", color: "var(--text2)", textTransform: "uppercase", fontWeight: 700,
                border: "2px solid var(--text3)", borderRadius: 6, background: "var(--bg2)",
                cursor: aufruf ? "default" : "grab", userSelect: "none", boxShadow: "0 1px 3px rgba(0,0,0,0.12)" }}
              title={t("sitzplan.board")}>{t("sitzplan.board")}
              {!aufruf && (
                <span onPointerDown={onTafelRotDown} title={t("sitzplan.rotate")}
                  style={{ position: "absolute", right: -9, top: -9, width: 18, height: 18, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center",
                    background: "var(--card)", border: "1px solid var(--border2)", color: "var(--text2)", fontSize: 12, lineHeight: 1, cursor: "grab", touchAction: "none", boxShadow: "0 1px 2px rgba(0,0,0,0.15)" }}>↻</span>
              )}
            </div>
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
                    <>
                      {/* Dreh-Griff (Icon) an der oberen rechten Ecke: ziehen = frei drehen. */}
                      <span onPointerDown={(e) => onRotDown(e, seat)} title={t("sitzplan.rotate")}
                        style={{ position: "absolute", right: -9, top: -9, width: 18, height: 18, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center",
                          background: "var(--card)", border: "1px solid var(--border2)", color: "var(--text2)", fontSize: 12, lineHeight: 1, cursor: "grab", touchAction: "none", boxShadow: "0 1px 2px rgba(0,0,0,0.15)" }}>↻</span>
                      <button onPointerDown={(e) => e.stopPropagation()} onClick={() => entfernen(seat.sid)} title={t("sitzplan.removeSeat")}
                        style={{ position: "absolute", right: 2, top: 2, width: 16, height: 16, border: "none", background: "transparent", cursor: "pointer", color: C.danger, fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
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
