// Modul Stoffverteilung — Themen übers Schuljahr in Reihenfolge bringen (grobe
// KW, Stunden, Notiz), abhaken. Reihenfolge per Drag&Drop mit Vorschau.
import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { pageTitle, btnPrimary, btnSecondary, inputStyle, selectStyle, Icon, ICONS, iconBtn, COLORS as C, Empty } from "../components/Icons.jsx";
import KursKlasseSelect from "../components/KursKlasseSelect.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { swr, lastClass, rememberClass } from "../core/cache.js";

const API = "/api/stoffplan";

export default function Stoffplan({ embedded } = {}) {
  const { t } = useLanguage();
  const [classId, setClassId] = useState(() => lastClass() || null);
  const [kursId, setKursId] = useState(null);
  const [items, setItems] = useState([]);
  const [exams, setExams] = useState([]);   // Klassenarbeitstermine (Kalender)
  const [offen, setOffen] = useState(null); // aufgeklappter Eintrag (E/G-Ziele)
  const [topics, setTopics] = useState([]);
  const [title, setTitle] = useState("");
  const [topicId, setTopicId] = useState("");
  const [kw, setKw] = useState("");
  const [hours, setHours] = useState("");
  useEffect(() => swr("topics", "/api/topics", (d) => setTopics(Array.isArray(d) ? d : [])), []);
  const topicLabel = (tp) => { const p = tp.parent_id ? topics.find((x) => x.id === tp.parent_id) : null; return p ? `${p.name} / ${tp.name}` : tp.name; };
  const topicName = (id) => { const tp = topics.find((x) => x.id === id); return tp ? topicLabel(tp) : ""; };

  const scopeQ = () => (kursId != null ? `kurs_id=${kursId}` : (classId != null ? `class_id=${classId}` : ""));
  const load = () => {
    const q = scopeQ();
    if (!q) { setItems([]); setExams([]); return; }
    fetch(`${API}?${q}`).then((r) => (r.ok ? r.json() : [])).then((d) => setItems(Array.isArray(d) ? d : [])).catch(() => {});
    // Klassenarbeiten kommen aus dem Kalender — hier nur gelesen, damit sie
    // nicht ein zweites Mal als Thema gepflegt werden. Ohne Modul: leere Liste.
    fetch(`${API}/klassenarbeiten?${q}`).then((r) => (r.ok ? r.json() : [])).then((d) => setExams(Array.isArray(d) ? d : [])).catch(() => {});
  };
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
  // Klassenarbeiten stehen zwischen den Themen ihrer Kalenderwoche — geplant
  // werden sie im Kalender, hier sind sie nur sichtbar (sonst pflegt man sie
  // zweimal). Ohne KW am Thema hängen sie hinten an.
  const kwVon = (it) => { const n = parseInt(String(it.kw || "").match(/\d+/)?.[0] ?? "", 10); return Number.isFinite(n) ? n : null; };
  const nachThema = new Map();   // Index des letzten Themas einer KW -> Termine
  const ohnePlatz = [];
  for (const e of exams) {
    let idx = -1;
    if (e.kw != null) view.forEach((it, i) => { const k = kwVon(it); if (k != null && k <= e.kw) idx = i; });
    if (idx >= 0) nachThema.set(idx, [...(nachThema.get(idx) || []), e]);
    else ohnePlatz.push(e);
  }
  const ExamZeile = ({ e }) => (
    <div key={`exam-${e.id}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", border: "1px solid var(--accent)", borderRadius: 14, background: "var(--accent-bg)", marginBottom: 6 }}>
      <Icon d={ICONS.chart} size={15} color="var(--accent)" />
      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: "var(--accent)" }}>
        {e.title || t("stoffplan.exam")}
      </span>
      <span style={{ fontSize: 12, color: "var(--text2)", flexShrink: 0 }}>
        {e.date ? new Date(e.date).toLocaleDateString() : ""}
      </span>
      {e.kw != null && <span style={{ fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 980, background: "var(--bg)", color: "var(--text2)", flexShrink: 0 }}>KW {e.kw}</span>}
      <Link to="/kalender?view=klassenarbeit" className="icon-btn" style={{ ...iconBtn, padding: 4, flexShrink: 0 }} title={t("stoffplan.examEdit")}>
        <Icon d={ICONS.open} size={15} color="var(--accent)" />
      </Link>
    </div>
  );
  return (
    <div style={{ maxWidth: embedded ? "none" : 780, margin: embedded ? 0 : "0 auto" }}>
      {!embedded && <h1 style={pageTitle}>{t("stoffplan.title")}</h1>}
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
        <div key={it.id}>
        <div {...dnd(idx)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)", marginBottom: 6, cursor: "grab", opacity: it.done ? 0.6 : 1 }}>
          <span className="drag-handle" style={{ color: "var(--text3)", display: "inline-flex", flexShrink: 0 }}><Icon d={ICONS.grip} size={15} /></span>
          <input type="checkbox" checked={it.done} onChange={() => patch(it.id, { done: !it.done })} style={{ width: 18, height: 18, cursor: "pointer", flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 14, textDecoration: it.done ? "line-through" : "none" }}>{it.title}</span>
            {/* Anforderungen direkt lesbar — dafür sind sie da. */}
            {(it.ziel_g || it.ziel_e) && (
              <span style={{ display: "block", fontSize: 12, color: "var(--text3)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {it.ziel_g ? `G: ${it.ziel_g}` : ""}{it.ziel_g && it.ziel_e ? "  ·  " : ""}{it.ziel_e ? `E: ${it.ziel_e}` : ""}
              </span>
            )}
          </span>
          {it.topic_id && (
            <Link to={`/thema/${it.topic_id}`} className="icon-btn" style={{ ...iconBtn, padding: 4, flexShrink: 0 }} title={`${t("stoffplan.openTopic")}${topicName(it.topic_id) ? ": " + topicName(it.topic_id) : ""}`}>
              <Icon d={ICONS.open} size={15} color="var(--accent)" />
            </Link>
          )}
          {it.kw && <span style={{ fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 980, background: "var(--bg2, var(--bg))", color: "var(--text2)", flexShrink: 0 }}>KW {it.kw}</span>}
          {it.hours != null && <span style={{ fontSize: 12, color: "var(--text3)", flexShrink: 0 }}>{it.hours} {t("stoffplan.h")}</span>}
          {/* Was auf G und was auf E verlangt wird — dieselbe Stunde, zwei Ansprüche. */}
          <button onClick={() => setOffen(offen === it.id ? null : it.id)}
            title={t("stoffplan.zieleHint")}
            style={{
              flexShrink: 0, padding: "2px 9px", borderRadius: 980, fontSize: 11.5, fontWeight: 700, cursor: "pointer",
              border: (it.ziel_g || it.ziel_e) ? "1px solid var(--accent)" : "1px solid var(--border2)",
              background: (it.ziel_g || it.ziel_e) ? "var(--accent-bg)" : "var(--bg)",
              color: (it.ziel_g || it.ziel_e) ? "var(--accent)" : "var(--text3)",
            }}>
            E/G
          </button>
          <button onClick={() => del(it.id)} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("common.delete")}><Icon d={ICONS.trash} size={15} color={C.danger} /></button>
        </div>
        {offen === it.id && (
          <div style={{ margin: "-2px 0 8px", padding: "10px 12px", border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 14px 14px", background: "var(--bg3)" }}>
            {[["ziel_g", t("stoffplan.zielG"), t("stoffplan.zielGHint")], ["ziel_e", t("stoffplan.zielE"), t("stoffplan.zielEHint")]].map(([feld, label, hint]) => (
              <div key={feld} style={{ marginBottom: feld === "ziel_g" ? 8 : 0 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text3)", marginBottom: 3 }}>{label}</div>
                <textarea
                  defaultValue={it[feld] || ""}
                  onBlur={(e) => { if (e.target.value !== (it[feld] || "")) patch(it.id, { [feld]: e.target.value }); }}
                  rows={2} placeholder={hint} maxLength={2000}
                  style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box", padding: 8, border: "1px solid var(--border2)", borderRadius: 8, fontSize: 13, background: "var(--bg)", color: "var(--text)", resize: "vertical", overflowWrap: "anywhere" }}
                />
              </div>
            ))}
          </div>
        )}
        {(nachThema.get(idx) || []).map((e) => <ExamZeile key={`exam-${e.id}`} e={e} />)}
        </div>
      ))}
      {/* Termine, die sich nicht zwischen die Themen einordnen lassen (Thema
          ohne KW, oder Arbeit vor dem ersten Thema): chronologisch am Ende. */}
      {ohnePlatz.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text3)", marginBottom: 6 }}>
            {t("stoffplan.examsTitle", { n: ohnePlatz.length })}
          </div>
          <p style={{ fontSize: 12, color: "var(--text3)", margin: "0 0 8px" }}>{t("stoffplan.examsHint")}</p>
          {ohnePlatz.map((e) => <ExamZeile key={`exam-${e.id}`} e={e} />)}
        </div>
      )}
    </div>
  );
}
