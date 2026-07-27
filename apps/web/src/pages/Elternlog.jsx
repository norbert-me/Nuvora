// Modul Elternkontakte — dokumentierte Kontakte je Schüler (Datum, Kanal, Notiz).
import { useState, useEffect } from "react";
import { pageTitle, btnPrimary, btnSecondary, inputStyle, selectStyle, Icon, ICONS, iconBtn, COLORS as C, Empty } from "../components/Icons.jsx";
import KursKlasseSelect from "../components/KursKlasseSelect.jsx";
import { Link } from "react-router-dom";
import { useLanguage } from "../i18n/index.jsx";
import { useModules } from "../core/modules.js";
import { swr, lastClass, rememberClass } from "../core/cache.js";

const API = "/api/elternlog";
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const CHANNELS = [["telefon", "Telefon"], ["mail", "Mail"], ["gespraech", "Gespräch"], ["brief", "Brief"], ["sonstiges", "Sonstiges"]];

export default function Elternlog() {
  const { t } = useLanguage();
  const { modules } = useModules();
  const notenAktiv = modules.find((m) => m.key === "noten")?.active ?? false;
  const [grades, setGrades] = useState({}); // student_id -> Gesamtnote (nur bei aktivem Noten-Modul)
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState(null);
  const [counts, setCounts] = useState({});
  const [sel, setSel] = useState(null);
  const [list, setList] = useState([]);
  const [text, setText] = useState("");
  const [channel, setChannel] = useState("telefon");
  const [date, setDate] = useState(ymd(new Date()));

  useEffect(() => swr("classes", "/api/classes", (d) => {
    const l = Array.isArray(d) ? d : []; setClasses(l);
    if (classId === null && l.length) { const w = lastClass(); setClassId(l.some((c) => c.id === w) ? w : l[0].id); }
  }), []);
  useEffect(() => { if (classId) rememberClass(classId); }, [classId]);

  const cls = classes.find((c) => c.id === classId);
  const students = cls?.students || [];
  const chLabel = (v) => (CHANNELS.find((c) => c[0] === v) || [, ""])[1];

  const loadCounts = () => { if (classId) fetch(`${API}/counts?class_id=${classId}`).then((r) => (r.ok ? r.json() : {})).then((d) => setCounts(d || {})).catch(() => {}); };
  // Gesamtnoten der Klasse laden — nur wenn das Noten-Modul aktiv ist (Regel 3).
  const loadGrades = () => {
    if (!classId || !notenAktiv) { setGrades({}); return; }
    fetch(`/api/noten/classes/${classId}/summary?term=1&agg=mean`).then((r) => (r.ok ? r.json() : [])).then((rows) => {
      const g = {}; (Array.isArray(rows) ? rows : []).forEach((s) => { const v = s.total_override ?? s.weighted; if (v != null) g[String(s.student_id)] = v; }); setGrades(g);
    }).catch(() => {});
  };
  useEffect(() => { setSel(null); loadCounts(); loadGrades(); /* eslint-disable-next-line */ }, [classId, notenAktiv]);
  const noteStr = (sid) => { const v = grades[String(sid)]; return v == null ? null : String(v).replace(".", ","); };

  const loadList = (sid) => fetch(`${API}?student_id=${sid}`).then((r) => (r.ok ? r.json() : [])).then((d) => setList(Array.isArray(d) ? d : [])).catch(() => {});
  const open = (s) => { setSel(s); setText(""); setChannel("telefon"); setDate(ymd(new Date())); loadList(s.id); };

  const add = async () => {
    if (!sel || !text.trim()) return;
    await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ student_id: sel.id, date: date || null, channel, text: text.trim() }) }).catch(() => {});
    setText(""); loadList(sel.id); loadCounts();
  };
  const del = async (id) => { await fetch(`${API}/${id}`, { method: "DELETE" }).catch(() => {}); if (sel) loadList(sel.id); loadCounts(); };
  const fmt = (iso) => { try { return new Date(iso + "T00:00:00").toLocaleDateString(); } catch { return iso; } };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1 style={pageTitle}>{t("elternlog.title")}</h1>
      <p style={{ fontSize: 12.5, color: "var(--text3)", marginTop: -8, marginBottom: 16 }}>{t("elternlog.intro")}</p>

      <div style={{ marginBottom: 16 }}><KursKlasseSelect value={classId} onChange={setClassId} /></div>

      {!sel ? (
        students.length === 0 ? <Empty title={t("elternlog.noStudents")} /> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
            {students.map((s) => (
              <button key={s.id} onClick={() => open(s)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--card)", cursor: "pointer", textAlign: "left", color: "var(--text)" }}>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                {counts[String(s.id)] > 0 && <span style={{ fontSize: 12, fontWeight: 700, padding: "1px 8px", borderRadius: 980, background: "var(--accent-bg, rgba(10,132,255,0.12))", color: "var(--accent)" }}>{counts[String(s.id)]}</span>}
              </button>
            ))}
          </div>
        )
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <button onClick={() => setSel(null)} style={{ ...btnSecondary, padding: "6px 12px" }}>← {t("common.back")}</button>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{sel.name}</h2>
            {notenAktiv && noteStr(sel.id) && (
              <Link to="/noten" title={t("elternlog.toGrades")} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, padding: "4px 12px", borderRadius: 980, background: "var(--accent-bg, rgba(10,132,255,0.12))", color: "var(--accent)", textDecoration: "none" }}>
                {t("elternlog.grade")}: {noteStr(sel.id)} ↗
              </Link>
            )}
          </div>

          <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)", padding: 14, marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, padding: "8px 8px" }} />
              <select value={channel} onChange={(e) => setChannel(e.target.value)} style={{ ...selectStyle, padding: "8px 26px 8px 10px", fontSize: 13 }}>
                {CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={t("elternlog.placeholder")} rows={3} style={{ ...inputStyle, width: "100%", resize: "vertical", boxSizing: "border-box" }} />
            <div style={{ marginTop: 8, textAlign: "right" }}>
              <button onClick={add} disabled={!text.trim()} style={{ ...btnPrimary, opacity: text.trim() ? 1 : 0.5 }}>{t("common.add")}</button>
            </div>
          </div>

          {list.length === 0 ? (
            <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("elternlog.empty")}</p>
          ) : list.map((c) => (
            <div key={c.id} style={{ display: "flex", gap: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--card)", marginBottom: 6 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 2 }}>
                  {c.date ? fmt(c.date) : ""}{c.channel ? ` · ${chLabel(c.channel)}` : ""}
                </div>
                <div style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{c.text}</div>
              </div>
              <button onClick={() => del(c.id)} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("common.delete")}><Icon d={ICONS.trash} size={15} color={C.danger} /></button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
