// Modul Kalender — Unterrichtsplanung. Tag-, Wochen- und Monatsansicht; je Tag
// Stunden eintragen und optional Klasse + Thema (Kern-Taxonomie) zuordnen.
import { useState, useEffect, useCallback } from "react";
import { Icon, ICONS, iconBtn, btnPrimary, btnSecondary, pageTitle, COLORS as C } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

const API = "/api/kalender";

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = (d) => { const x = startOfDay(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };

export default function Kalender() {
  const { t } = useLanguage();
  const [view, setView] = useState("month"); // month | week | day
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [entries, setEntries] = useState([]);
  const [classes, setClasses] = useState([]);
  const [topics, setTopics] = useState([]);
  const [editing, setEditing] = useState(null); // { date, ...entry } oder null

  useEffect(() => {
    fetch("/api/classes").then((r) => (r.ok ? r.json() : [])).then((d) => setClasses(Array.isArray(d) ? d : [])).catch(() => {});
    fetch("/api/topics").then((r) => (r.ok ? r.json() : [])).then((d) => setTopics(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  // Sichtbarer Zeitraum je Ansicht.
  const range = (() => {
    if (view === "day") return [startOfDay(cursor), startOfDay(cursor)];
    if (view === "week") { const s = mondayOf(cursor); return [s, addDays(s, 6)]; }
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    return [mondayOf(first), addDays(mondayOf(last), 6)];
  })();

  const load = useCallback(() => {
    const [a, b] = range;
    fetch(`${API}/entries?frm=${a.toISOString()}&to=${addDays(b, 1).toISOString()}`)
      .then((r) => (r.ok ? r.json() : [])).then((d) => setEntries(Array.isArray(d) ? d : [])).catch(() => {});
  }, [view, cursor]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);

  const topicName = (id) => {
    const tp = topics.find((x) => x.id === id);
    if (!tp) return "";
    const p = tp.parent_id ? topics.find((x) => x.id === tp.parent_id) : null;
    return p ? `${p.name} / ${tp.name}` : tp.name;
  };
  const byDay = (d) => entries.filter((e) => ymd(new Date(e.date)) === ymd(d));

  const move = (dir) => {
    if (view === "day") setCursor(addDays(cursor, dir));
    else if (view === "week") setCursor(addDays(cursor, dir * 7));
    else setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1));
  };

  const save = async (e) => {
    const body = { date: new Date(e.date).toISOString(), title: e.title || "", notes: e.notes || "", class_id: e.class_id || null, topic_id: e.topic_id || null };
    const res = await fetch(e.id ? `${API}/entries/${e.id}` : `${API}/entries`, {
      method: e.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).catch(() => null);
    if (res && res.ok) { setEditing(null); load(); }
  };
  const remove = async (id) => { await fetch(`${API}/entries/${id}`, { method: "DELETE" }).catch(() => {}); setEditing(null); load(); };

  const title = view === "month"
    ? cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : view === "week"
    ? `${mondayOf(cursor).toLocaleDateString()} – ${addDays(mondayOf(cursor), 6).toLocaleDateString()}`
    : cursor.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <h1 style={pageTitle}>{t("kalender.title")}</h1>
        <div style={{ display: "inline-flex", border: "1px solid var(--border2)", borderRadius: 980, overflow: "hidden" }}>
          {[["month", t("kalender.month")], ["week", t("kalender.week")], ["day", t("kalender.day")]].map(([v, l]) => (
            <button key={v} onClick={() => setView(v)} style={{ padding: "6px 14px", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", background: view === v ? "var(--accent)" : "transparent", color: view === v ? "#fff" : "var(--text2)" }}>{l}</button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
          <button onClick={() => move(-1)} style={{ ...btnSecondary, padding: "5px 12px", fontSize: 15 }} title="◀">‹</button>
          <button onClick={() => setCursor(startOfDay(new Date()))} style={{ ...btnSecondary, padding: "5px 12px", fontSize: 13 }}>{t("kalender.today")}</button>
          <button onClick={() => move(1)} style={{ ...btnSecondary, padding: "5px 12px", fontSize: 15 }} title="▶">›</button>
        </div>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "var(--text)" }}>{title}</div>

      {view === "month" && <MonthGrid range={range} cursor={cursor} byDay={byDay} topicName={topicName} onAdd={(d) => setEditing({ date: startOfDay(d) })} onOpen={setEditing} t={t} />}
      {view === "week" && <WeekView range={range} byDay={byDay} topicName={topicName} onAdd={(d) => setEditing({ date: startOfDay(d) })} onOpen={setEditing} t={t} />}
      {view === "day" && <DayView day={cursor} byDay={byDay} topicName={topicName} onAdd={(d) => setEditing({ date: startOfDay(d) })} onOpen={setEditing} t={t} />}

      {editing && <EntryModal entry={editing} classes={classes} topics={topics} topicName={topicName} onSave={save} onDelete={remove} onClose={() => setEditing(null)} t={t} />}
    </div>
  );
}

const cell = { border: "1px solid var(--border)", minHeight: 84, padding: 6, verticalAlign: "top", background: "var(--card)" };
const chip = { display: "block", width: "100%", textAlign: "left", fontSize: 11.5, padding: "2px 6px", borderRadius: 6, background: "var(--accent-bg, rgba(10,132,255,0.12))", color: "var(--accent)", border: "none", cursor: "pointer", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

function EntryChips({ list, topicName, onOpen }) {
  return list.map((e) => (
    <button key={e.id} onClick={() => onOpen({ ...e, date: new Date(e.date) })} style={chip} title={e.title || topicName(e.topic_id)}>
      {e.title || topicName(e.topic_id) || "—"}
    </button>
  ));
}

function MonthGrid({ range, cursor, byDay, topicName, onAdd, onOpen, t }) {
  const days = [];
  for (let d = new Date(range[0]); d <= range[1]; d = addDays(d, 1)) days.push(new Date(d));
  const wdays = [t("kalender.mon"), t("kalender.tue"), t("kalender.wed"), t("kalender.thu"), t("kalender.fri"), t("kalender.sat"), t("kalender.sun")];
  const heute = ymd(new Date());
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed", minWidth: 700 }}>
        <thead><tr>{wdays.map((w) => <th key={w} style={{ padding: 6, fontSize: 12, color: "var(--text3)", textAlign: "left" }}>{w}</th>)}</tr></thead>
        <tbody>
          {Array.from({ length: days.length / 7 }).map((_, r) => (
            <tr key={r}>
              {days.slice(r * 7, r * 7 + 7).map((d) => {
                const other = d.getMonth() !== cursor.getMonth();
                return (
                  <td key={ymd(d)} style={{ ...cell, opacity: other ? 0.5 : 1, outline: ymd(d) === heute ? "2px solid var(--accent)" : "none", outlineOffset: -2 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)" }}>{d.getDate()}</span>
                      <button onClick={() => onAdd(d)} className="icon-btn" style={{ ...iconBtn, padding: 0 }} title={t("kalender.add")}><Icon d={ICONS.plus} size={13} color="var(--accent)" /></button>
                    </div>
                    <EntryChips list={byDay(d)} topicName={topicName} onOpen={onOpen} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WeekView({ range, byDay, topicName, onAdd, onOpen, t }) {
  const days = [];
  for (let d = new Date(range[0]); d <= range[1]; d = addDays(d, 1)) days.push(new Date(d));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, overflowX: "auto" }}>
      {days.map((d) => (
        <div key={ymd(d)} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 8, minHeight: 160, background: "var(--card)", minWidth: 90 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}</span>
            <button onClick={() => onAdd(d)} className="icon-btn" style={{ ...iconBtn, padding: 0 }}><Icon d={ICONS.plus} size={13} color="var(--accent)" /></button>
          </div>
          <EntryChips list={byDay(d)} topicName={topicName} onOpen={onOpen} />
        </div>
      ))}
    </div>
  );
}

function DayView({ day, byDay, topicName, onAdd, onOpen, t }) {
  const list = byDay(day);
  return (
    <div>
      <button onClick={() => onAdd(day)} style={{ ...btnPrimary, marginBottom: 14 }}>{t("kalender.add")}</button>
      {list.length === 0 ? <p style={{ fontSize: 13.5, color: "var(--text3)" }}>{t("kalender.empty")}</p> : list.map((e) => (
        <button key={e.id} onClick={() => onOpen({ ...e, date: new Date(e.date) })} style={{ display: "block", width: "100%", textAlign: "left", padding: 14, marginBottom: 8, borderRadius: 12, border: "1px solid var(--border)", background: "var(--card)", cursor: "pointer" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{e.title || topicName(e.topic_id) || "—"}</div>
          {e.topic_id && e.title && <div style={{ fontSize: 12.5, color: "var(--accent)" }}>{topicName(e.topic_id)}</div>}
          {e.notes && <div style={{ fontSize: 13, color: "var(--text3)", marginTop: 4 }}>{e.notes}</div>}
        </button>
      ))}
    </div>
  );
}

function EntryModal({ entry, classes, topics, onSave, onDelete, onClose, t }) {
  const [title, setTitle] = useState(entry.title || "");
  const [notes, setNotes] = useState(entry.notes || "");
  const [classId, setClassId] = useState(entry.class_id || "");
  const [topicId, setTopicId] = useState(entry.topic_id || "");
  const fld = { width: "100%", padding: 9, border: "1px solid var(--border2)", borderRadius: 8, fontSize: 14, background: "var(--bg)", color: "var(--text)", boxSizing: "border-box" };
  const lbl = { fontSize: 12.5, color: "var(--text2)", margin: "12px 0 5px" };
  const topicLabel = (tp) => { const p = tp.parent_id ? topics.find((x) => x.id === tp.parent_id) : null; return p ? `${p.name} / ${tp.name}` : tp.name; };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 200 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--card)", borderRadius: 16, maxWidth: 440, width: "100%", padding: 22, border: "1px solid var(--border)", maxHeight: "85vh", overflow: "auto" }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 2 }}>{entry.id ? t("kalender.editEntry") : t("kalender.newEntry")}</h3>
        <div style={{ fontSize: 12.5, color: "var(--text3)" }}>{new Date(entry.date).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
        <div style={lbl}>{t("kalender.entryTitle")}</div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder={t("kalender.entryTitlePlaceholder")} style={fld} />
        <div style={lbl}>{t("nav.classes")}</div>
        <select value={classId} onChange={(e) => setClassId(e.target.value)} style={fld}>
          <option value="">– {t("kalender.noClass")} –</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div style={lbl}>{t("kalender.topic")}</div>
        <select value={topicId} onChange={(e) => setTopicId(e.target.value)} style={fld}>
          <option value="">– {t("kalender.noTopic")} –</option>
          {topics.map((tp) => <option key={tp.id} value={tp.id}>{topicLabel(tp)}</option>)}
        </select>
        <div style={lbl}>{t("kalender.notes")}</div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ ...fld, resize: "vertical" }} />
        <div style={{ display: "flex", gap: 8, marginTop: 18, alignItems: "center" }}>
          <button onClick={() => onSave({ ...entry, title, notes, class_id: classId ? Number(classId) : null, topic_id: topicId ? Number(topicId) : null })} style={btnPrimary}>{t("common.save")}</button>
          <button onClick={onClose} style={btnSecondary}>{t("common.abort")}</button>
          {entry.id && <button onClick={() => onDelete(entry.id)} className="icon-btn" style={{ ...iconBtn, marginLeft: "auto" }} title={t("common.delete")}><Icon d={ICONS.trash} color={C.danger} /></button>}
        </div>
      </div>
    </div>
  );
}
