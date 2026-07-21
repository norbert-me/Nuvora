// Modul Sitzplan — freie Fläche statt Raster. Tische frei platzieren und
// drehen (z.B. schräge Tische). Gespeichert wird { seats: [{sid,x,y,rot}] }.
// Schüler bleiben im Kern; hier nur ihre Positionen (Regel 3).
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { pageTitle, btnSecondary, selectStyle, Icon, ICONS, iconBtn, COLORS as C, Empty, ExportButton, ImportButton } from "../components/Icons.jsx";
import KursKlasseSelect from "../components/KursKlasseSelect.jsx";
import ViewMenu from "../components/ViewMenu.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { useModules } from "../core/modules.js";
import { swr , lastClass, rememberClass } from "../core/cache.js";

const API = "/api/sitzplan";
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ABS_COL = { fehlt: "#d1350f", spaet: "#b8860b", entsch: "#2563eb" };
const SEAT_W = 108, SEAT_H = 46;
// SEGEL-Stufen (Helios-Konzept): Boot vom Hafen bis in die Welt, zunehmende
// Selbststeuerung. Reihenfolge = Klick-Kreislauf am Platz (leer → … → leer).
const SEGEL = [
  { key: "hafen", label: "Hafen", ab: "H", color: "#d1350f" },
  { key: "kueste", label: "Küste", ab: "K", color: "#c026a3" },
  { key: "meer", label: "Meer", ab: "M", color: "#2563eb" },
  { key: "welt", label: "Welt", ab: "W", color: "#0a7d3e" },
];
const SEGEL_CYCLE = ["", "hafen", "kueste", "meer", "welt"];

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
  const [segelOn, setSegelOn] = useState(false);   // Voreinstellung pro Kurs (siehe unten)
  const [segel, setSegel] = useState({}); // student_id → Stufe
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

  // SEGEL-Stufen je SuS laden (pro Kurs). Toggle in localStorage merken.
  useEffect(() => {
    if (!classId) { setSegel({}); return; }
    fetch(`${API}/${classId}/segel${kursQ}`).then((r) => (r.ok ? r.json() : {})).then((d) => setSegel(d || {})).catch(() => {});
  }, [classId, kursId]);
  // „Ansicht"-Voreinstellung PRO KURS (Fallback Klasse): welche Zusatz-Anzeigen
  // an sind. Beim Kurswechsel neu laden — so merkt sich jeder Kurs seine Ansicht.
  const viewKey = classId ? (kursId != null ? `k${kursId}` : `c${classId}`) : null;
  useEffect(() => {
    if (!viewKey) return;
    try { const v = JSON.parse(localStorage.getItem(`sitzplan_view_${viewKey}`) || "{}"); setSegelOn(!!v.segel); setAufruf(!!v.aufruf); }
    catch { setSegelOn(false); setAufruf(false); }
  }, [viewKey]);
  const saveView = (patch) => {
    if (!viewKey) return;
    try { const cur = JSON.parse(localStorage.getItem(`sitzplan_view_${viewKey}`) || "{}"); localStorage.setItem(`sitzplan_view_${viewKey}`, JSON.stringify({ ...cur, ...patch })); } catch {}
  };
  const setStage = (sid, stage) => {
    setSegel((m) => { const n = { ...m }; if (stage) n[String(sid)] = stage; else delete n[String(sid)]; return n; });
    if (classId) fetch(`${API}/${classId}/segel${kursQ}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ student_id: sid, stage }) }).catch(() => {});
  };
  const cycleStage = (sid) => {
    const cur = segel[String(sid)] || "";
    setStage(sid, SEGEL_CYCLE[(SEGEL_CYCLE.indexOf(cur) + 1) % SEGEL_CYCLE.length]);
  };

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
    // rot beibehalten — sonst verliert die Tafel beim Verschieben ihre Drehung.
    setTafel((tf) => ({ ...tf, x, y }));
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
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    dragRef.current = { sid: seat.sid, dx: (e.clientX - rect.left) / zoom - seat.x, dy: (e.clientY - rect.top) / zoom - seat.y, rot: seat.rot || 0 };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const onMove = (e) => {
    const d = dragRef.current; if (!d) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min((e.clientX - rect.left) / zoom - d.dx, rect.width / zoom - SEAT_W));
    const y = Math.max(0, Math.min((e.clientY - rect.top) / zoom - d.dy, rect.height / zoom - SEAT_H));
    // rot ausdrücklich beibehalten (Drag darf die Drehung nie verwerfen).
    setSeats((prev) => prev.map((s) => (s.sid === d.sid ? { ...s, x, y, rot: s.rot ?? d.rot } : s)));
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

  // Leeren setzt auch die Tafel zurueck — sonst blieb sie an ihrer verschobenen
  // Stelle stehen, obwohl der Plan leer ist.
  const leeren = () => { const tf = { x: 200, y: 8 }; setTafel(tf); persist([], tf); setMsg(t("sitzplan.cleared")); setTimeout(() => setMsg(""), 2500); };

  // Export/Import: nur das Layout (Positionen + Drehungen + Tafel), ohne feste
  // Schüler. Beim Import werden die SuS der aktuellen Klasse der Reihe nach auf
  // die Plätze gesetzt — so lässt sich eine Sitzordnung auf eine andere Klasse
  // (oder ein anderes Fach) übertragen.
  // Auto-Zoom: alle Elemente einpassen, mit ~30 % Rand ringsum.
  const fitView = () => {
    if (!seats.length) { setZoom(1); return; }
    const items = [...seats.map((s) => ({ x: s.x, y: s.y, w: SEAT_W, h: SEAT_H })), { x: tafel.x, y: tafel.y, w: TAFEL_W, h: TAFEL_H }];
    const minX = Math.min(...items.map((i) => i.x)), minY = Math.min(...items.map((i) => i.y));
    const maxX = Math.max(...items.map((i) => i.x + i.w)), maxY = Math.max(...items.map((i) => i.y + i.h));
    const cw = Math.max(1, maxX - minX), ch = Math.max(1, maxY - minY);
    const vw = scrollRef.current.clientWidth, vh = scrollRef.current.clientHeight;
    const z = Math.min(2, Math.max(0.5, Math.min(vw / (cw * 1.3), vh / (ch * 1.3))));
    setZoom(z);
    requestAnimationFrame(() => {
      if (!scrollRef.current) return;
      scrollRef.current.scrollLeft = (minX + maxX) / 2 * z - vw / 2;
      scrollRef.current.scrollTop = (minY + maxY) / 2 * z - vh / 2;
    });
  };

  // Vorlage: alle SuS automatisch in Reihen anordnen (6 pro Reihe).
  const anordnen = () => {
    const cols = 6, gx = SEAT_W + 16, gy = SEAT_H + 22, x0 = 20, y0 = 60;
    const next = students.map((s, i) => ({ sid: s.id, x: x0 + (i % cols) * gx, y: y0 + Math.floor(i / cols) * gy, rot: 0 }));
    persist(next);
    setTafel((tf) => { const t2 = { ...tf, x: 200, y: 8, rot: 0 }; persist(next, t2); return t2; });
  };

  const doExport = () => {
    const data = { type: "nuvora_sitzplan", slots: seats.map((s) => ({ x: s.x, y: s.y, rot: s.rot || 0 })), tafel };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
    a.download = `Sitzplan_${cls?.name || "klasse"}.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  const doImport = async (file) => {
    try {
      const data = JSON.parse(await file.text());
      if (data.type !== "nuvora_sitzplan" || !Array.isArray(data.slots)) { setMsg(t("sitzplan.importError")); return; }
      const next = students.slice(0, data.slots.length).map((st, i) => ({ sid: st.id, x: data.slots[i].x, y: data.slots[i].y, rot: data.slots[i].rot || 0 }));
      const tf = data.tafel && typeof data.tafel.x === "number" ? { x: data.tafel.x, y: data.tafel.y, rot: data.tafel.rot || 0 } : tafel;
      setTafel(tf);          // lokal übernehmen (nicht nur an den Server senden)
      persist(next, tf);
      setMsg(t("sitzplan.imported")); setTimeout(() => setMsg(""), 2500);
    } catch { setMsg(t("sitzplan.importError")); }
  };

  // Ebene verschieben: leere Fläche greifen und die ganze Ansicht schieben
  // (pant den Scroll-Container). Nur wenn direkt auf die Fläche geklickt wird.
  const scrollRef = useRef(null);
  const panRef = useRef(null);
  const onCanvasDown = (e) => {
    if (e.target !== canvasRef.current) return;
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
        <ViewMenu title={t("sitzplan.view")} items={[
          ...(anwesenheitAktiv ? [{ key: "aufruf", label: t("sitzplan.rollcall"), value: aufruf, onChange: (v) => { setAufruf(v); saveView({ aufruf: v }); } }] : []),
          { key: "segel", label: t("sitzplan.segelToggle"), hint: t("sitzplan.segelHint"), value: segelOn, onChange: (v) => { setSegelOn(v); saveView({ segel: v }); } },
        ]} />
        <button onClick={() => setShowHint((v) => !v)} className="icon-btn" title={t("sitzplan.hintFree")}
          style={{ ...iconBtn, border: showHint ? "1px solid var(--accent)" : "1px solid var(--border2)", borderRadius: 999, width: 30, height: 30, fontWeight: 700, color: showHint ? "var(--accent)" : "var(--text3)" }}>i</button>
        <ExportButton label={t("sitzplan.export")} onClick={doExport} style={{ padding: "6px 12px", fontSize: 13, marginLeft: anwesenheitAktiv ? 0 : "auto" }} />
        <ImportButton label={t("sitzplan.import")} onFile={doImport} style={{ padding: "6px 12px", fontSize: 13 }} />
        <button onClick={leeren} className="icon-btn" style={iconBtn} title={t("sitzplan.clear")}><Icon d={ICONS.trash} color={C.danger} /></button>
      </div>
      {showHint && <p style={{ fontSize: 13, color: "var(--text3)", margin: "8px 0 14px" }}>{t("sitzplan.hintFree")}</p>}
      {segelOn && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "8px 0 12px", fontSize: 12.5, color: "var(--text3)" }}>
          <span>{t("sitzplan.segelLegend")}:</span>
          {SEGEL.map((x) => (
            <span key={x.key} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 16, height: 16, borderRadius: 8, background: x.color, color: "#fff", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{x.ab}</span>
              {x.label}
            </span>
          ))}
          <span style={{ color: "var(--text3)" }}>· {t("sitzplan.segelCycleHint")}</span>
        </div>
      )}
      {msg && <p style={{ fontSize: 13, color: "#0a7d3e", marginBottom: 10 }}>{msg}</p>}

      {students.length === 0 ? (
        <Empty title={t("sitzplan.noStudents")} hint={t("sitzplan.noStudentsHint")} />
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, color: "var(--text3)" }}>{t("sitzplan.zoom")}</span>
            <button onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))} style={{ ...iconBtn, border: "1px solid var(--border2)", borderRadius: 8, width: 28, height: 28, fontSize: 16 }}>−</button>
            <span style={{ fontSize: 12.5, color: "var(--text2)", minWidth: 40, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.1) * 10) / 10))} style={{ ...iconBtn, border: "1px solid var(--border2)", borderRadius: 8, width: 28, height: 28, fontSize: 16 }}>+</button>
            {zoom !== 1 && <button onClick={() => setZoom(1)} style={{ ...btnSecondary, padding: "4px 10px", fontSize: 12 }}>{t("sitzplan.zoomReset")}</button>}
            <button onClick={fitView} className="icon-btn" style={{ ...iconBtn, border: "1px solid var(--border2)", borderRadius: 8, width: 28, height: 28 }} title={t("sitzplan.fitHint")} aria-label={t("sitzplan.fit")}><Icon d={ICONS.fit} size={16} /></button>
            <button onClick={anordnen} style={{ ...btnSecondary, padding: "4px 10px", fontSize: 12 }} title={t("sitzplan.arrangeHint")}>{t("sitzplan.arrange")}</button>
          </div>
          <div ref={scrollRef} style={{ height: 520, overflow: "auto", border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)", marginBottom: 18 }}>
          <div ref={canvasRef} onPointerDown={onCanvasDown} onDragOver={(e) => e.preventDefault()} onDrop={onCanvasDrop}
            style={{ position: "relative", height: 760, width: "calc(100% - 40px)", minWidth: 720, margin: "0 20px", transform: `scale(${zoom})`, transformOrigin: "0 0",
              cursor: "grab",
              backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)", backgroundSize: "24px 24px" }}>
            {/* Bewegliche Tafel */}
            <div onPointerDown={onTafelDown}
              style={{ position: "absolute", left: tafel.x, top: tafel.y, width: TAFEL_W, height: TAFEL_H,
                transform: `rotate(${tafel.rot || 0}deg)`, transformOrigin: "center",
                display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center",
                fontSize: 11.5, letterSpacing: "0.1em", color: "var(--text2)", textTransform: "uppercase", fontWeight: 700,
                border: "2px solid var(--text3)", borderRadius: 6, background: "var(--bg2)",
                cursor: "grab", userSelect: "none", boxShadow: "0 1px 3px rgba(0,0,0,0.12)" }}
              title={t("sitzplan.board")}>{t("sitzplan.board")}
              {(
                <span onPointerDown={onTafelRotDown} title={t("sitzplan.rotate")}
                  style={{ position: "absolute", right: -9, top: -9, width: 18, height: 18, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center",
                    background: "var(--card)", border: "1px solid var(--border2)", color: "var(--text2)", fontSize: 12, lineHeight: 1, cursor: "grab", touchAction: "none", boxShadow: "0 1px 2px rgba(0,0,0,0.15)" }}>↻</span>
              )}
            </div>
            {seats.map((seat) => {
              const s = byId(seat.sid); if (!s) return null;
              const abs = aufruf ? abwesend[String(seat.sid)] : null;
              return (
                <div key={seat.sid} draggable={false}
                  onPointerDown={(e) => onSeatDown(e, seat)}
                  onDragStart={(e) => e.preventDefault()}
                  style={{ position: "absolute", left: seat.x, top: seat.y, width: SEAT_W, minHeight: SEAT_H,
                    transform: `rotate(${seat.rot || 0}deg)`, transformOrigin: "center",
                    display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center",
                    padding: "6px 22px 6px 8px", borderRadius: 8, border: "1px solid var(--border2)",
                    background: abs ? "var(--bg2)" : "var(--bg)", color: "var(--text)", fontSize: 12.5, fontWeight: 600,
                    cursor: "grab", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", userSelect: "none",
                    opacity: abs ? 0.5 : 1, textDecoration: abs ? "line-through" : "none" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                  {abs && <span style={{ position: "absolute", top: 3, right: 24, width: 8, height: 8, borderRadius: 4, background: ABS_COL[abs] }} title={t(`anwesenheit.${abs}`)} />}
                  {segelOn && (() => {
                    const st = SEGEL.find((x) => x.key === segel[String(seat.sid)]);
                    return (
                      <button onPointerDown={(e) => e.stopPropagation()} onClick={() => cycleStage(seat.sid)}
                        title={st ? `SEGEL: ${st.label}` : t("sitzplan.segelSet")}
                        style={{ position: "absolute", left: -9, bottom: -9, width: 20, height: 20, borderRadius: 10, cursor: "pointer", fontSize: 11, fontWeight: 700, lineHeight: 1,
                          display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                          background: st ? st.color : "var(--card)", color: st ? "#fff" : "var(--text3)",
                          border: st ? "none" : "1px dashed var(--border2)" }}>
                        {st ? st.ab : "+"}
                      </button>
                    );
                  })()}
                  {(
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
                  <div key={s.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", String(s.id))}
                    style={{ padding: "7px 12px", borderRadius: 980, border: "1px solid var(--border2)", background: "var(--card)", fontSize: 13, fontWeight: 600, cursor: "grab", display: "inline-flex", alignItems: "center", gap: 6, ...(abs ? { opacity: 0.45, textDecoration: "line-through" } : {}) }}>
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
