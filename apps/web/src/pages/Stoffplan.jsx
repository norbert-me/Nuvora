// Modul Stoffverteilung — Themen übers Schuljahr in Reihenfolge bringen (grobe
// KW, Stunden, Notiz), abhaken. Reihenfolge per Drag&Drop mit Vorschau.
import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { pageTitle, btnPrimary, btnSecondary, inputStyle, selectStyle, Icon, ICONS, iconBtn, COLORS as C, Empty } from "../components/Icons.jsx";
import KursKlasseSelect from "../components/KursKlasseSelect.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { swr, lastClass, rememberClass } from "../core/cache.js";

const API = "/api/stoffplan";

export default function Stoffplan() {
  const { t } = useLanguage();
  const [classId, setClassId] = useState(() => lastClass() || null);
  const [kursId, setKursId] = useState(null);
  const [items, setItems] = useState([]);
  const [topics, setTopics] = useState([]);
  const [title, setTitle] = useState("");
  const [topicId, setTopicId] = useState("");
  const [kw, setKw] = useState("");
  const [hours, setHours] = useState("");
  useEffect(() => swr("topics", "/api/topics", (d) => setTopics(Array.isArray(d) ? d : [])), []);
  const topicLabel = (tp) => { const p = tp.parent_id ? topics.find((x) => x.id === tp.parent_id) : null; return p ? `${p.name} / ${tp.name}` : tp.name; };
  const topicName = (id) => { const tp = topics.find((x) => x.id === id); return tp ? topicLabel(tp) : ""; };

  const scopeQ = () => (kursId != null ? `kurs_id=${kursId}` : (classId != null ? `class_id=${classId}` : ""));
  const load = () => { const q = scopeQ(); if (!q) { setItems([]); return; } fetch(`${API}?${q}`).then((r) => (r.ok ? r.json() : [])).then((d) => setItems(Array.isArray(d) ? d : [])).catch(() => {}); };
  useEffect(() => { if (classId) rememberClass(classId); load(); /* eslint-disable-next-line */ }, [classId, kursId]);

  const add = async () => {
    if (!title.trim() || (classId == null && kursId == null)) return;
    await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kurs_id: kursId ?? null, class_id: kursId != null ? null : classId, title: title.trim(), topic_id: topicId ? Number(topicId) : null, kw: kw.trim(), hours: hours ? Number(hours) : null }) }).catch(() => {});
    setTitle(""); setTopicId(""); setKw(""); setHours(""); load();
  };
  // Thema wählen → Titel aus dem Kern-Thema übernehmen (nur wenn Titel leer oder
  // noch der zuletzt gewählte Themenname). So bleibt eigener Text unangetastet.
  const lastTopicTitle = useRef("");
  const pickTopic = (id) => {
    setTopicId(id);
    const n = id ? topicName(Number(id)) : "";
    if (n && (!title.trim() || title === lastTopicTitle.current)) { setTitle(n); lastTopicTitle.current = n; }
  };
  const patch = async (id, body) => { await fetch(`${API}/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {}); load(); };
  const del = async (id) => { await fetch(`${API}/${id}`, { method: "DELETE" }).catch(() => {}); load(); };

  // Drag&Drop mit Vorschau (stabile Arbeits-Liste im Ref).
  const dragIdx = useRef(null); const dragWork = useRef(null);
  const [preview, setPreview] = useState(null);
  const reorderPreview = (from, to) => { if (from == null || from === to || !dragWork.current) return; const a = dragWork.current; const [m] = a.splice(from, 1); a.splice(to, 0, m); setPreview([...a]); };
  const commit = async () => { const arr = dragWork.current; if (!arr) return; setItems(arr); setPreview(null); const ids = arr.map((x) => x.id); dragIdx.current = null; dragWork.current = null; await fetch(`${API}/reorder`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => {}); };
  const dnd = (idx) => ({
    draggable: true,
    onDragStart: () => { dragWork.current = [...(preview || items)]; dragIdx.current = idx; },
    onDragOver: (e) => { if (dragIdx.current == null) return; e.preventDefault(); if (idx !== dragIdx.current) { reorderPreview(dragIdx.current, idx); dragIdx.current = idx; } },
    onDrop: (e) => { e.preventDefault(); commit(); },
    onDragEnd: () => { setPreview(null); dragIdx.current = null; dragWork.current = null; },
  });

  const view = preview || items;
  return (
    <div style={{ maxWidth: 780, margin: "0 auto" }}>
      <h1 style={pageTitle}>{t("stoffplan.title")}</h1>
      <p style={{ fontSize: 12.5, color: "var(--text3)", marginTop: -8, marginBottom: 16 }}>{t("stoffplan.intro")}</p>

      <div style={{ marginBottom: 14 }}>
        <KursKlasseSelect value={classId} kursValue={kursId} onChange={(id, kid) => { setClassId(id); setKursId(kid ?? null); }} onKurs={setKursId} />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        {topics.length > 0 && (
          <select value={topicId} onChange={(e) => pickTopic(e.target.value)} title={t("stoffplan.fromTopic")} style={{ ...selectStyle, fontSize: 13, padding: "9px 26px 9px 10px", maxWidth: 200 }}>
            <option value="">– {t("stoffplan.topic")} –</option>
            {[...topics].sort((a, b) => topicLabel(a).localeCompare(topicLabel(b), "de", { numeric: true })).map((tp) => <option key={tp.id} value={tp.id}>{topicLabel(tp)}</option>)}
          </select>
        )}
        <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder={t("stoffplan.topicPlaceholder")} style={{ ...inputStyle, flex: 1, minWidth: 180 }} />
        <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder={t("stoffplan.kw")} style={{ ...inputStyle, width: 80, padding: "9px 8px" }} title={t("stoffplan.kwHint")} />
        <input type="number" value={hours} onChange={(e) => setHours(e.target.value)} placeholder={t("stoffplan.hours")} style={{ ...inputStyle, width: 80, padding: "9px 8px" }} title={t("stoffplan.hoursHint")} />
        <button onClick={add} disabled={!title.trim() || (classId == null && kursId == null)} style={{ ...btnPrimary, opacity: title.trim() ? 1 : 0.5 }}>{t("common.add")}</button>
      </div>

      {view.length === 0 ? (
        <Empty title={t("stoffplan.empty")} hint={t("stoffplan.emptyHint")} />
      ) : view.map((it, idx) => (
        <div key={it.id} {...dnd(idx)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--card)", marginBottom: 6, cursor: "grab", opacity: it.done ? 0.6 : 1 }}>
          <span className="drag-handle" style={{ color: "var(--text3)", display: "inline-flex", flexShrink: 0 }}><Icon d={ICONS.grip} size={15} /></span>
          <input type="checkbox" checked={it.done} onChange={() => patch(it.id, { done: !it.done })} style={{ width: 18, height: 18, cursor: "pointer", flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 14, textDecoration: it.done ? "line-through" : "none" }}>{it.title}</span>
          {it.topic_id && (
            <Link to={`/thema/${it.topic_id}`} className="icon-btn" style={{ ...iconBtn, padding: 4, flexShrink: 0 }} title={`${t("stoffplan.openTopic")}${topicName(it.topic_id) ? ": " + topicName(it.topic_id) : ""}`}>
              <Icon d={ICONS.open} size={15} color="var(--accent)" />
            </Link>
          )}
          {it.kw && <span style={{ fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 980, background: "var(--bg2, var(--bg))", color: "var(--text2)", flexShrink: 0 }}>KW {it.kw}</span>}
          {it.hours != null && <span style={{ fontSize: 12, color: "var(--text3)", flexShrink: 0 }}>{it.hours} {t("stoffplan.h")}</span>}
          <button onClick={() => del(it.id)} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("common.delete")}><Icon d={ICONS.trash} size={15} color={C.danger} /></button>
        </div>
      ))}
    </div>
  );
}
