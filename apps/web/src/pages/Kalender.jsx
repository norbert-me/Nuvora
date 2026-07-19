// Modul Kalender — Unterrichtsplanung. Tag-, Wochen- und Monatsansicht; je Tag
// Stunden eintragen und optional Klasse + Thema (Kern-Taxonomie) zuordnen.
import { useState, useEffect, useCallback, Fragment } from "react";
import { askConfirm, askPrompt, showAlert } from "../core/dialog.jsx";
import { Link, useNavigate } from "react-router-dom";
import { Icon, ICONS, iconBtn, btnPrimary, btnSecondary, pageTitle, COLORS as C, selectStyle } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { swr, put } from "../core/cache.js";

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
  const [methods, setMethods] = useState([]); // aus Modul Methoden (falls aktiv)
  const [quizze, setQuizze] = useState([]); // CardVote-Quizze (falls aktiv), flach
  const [ladders, setLadders] = useState([]); // Lernpfad-Lernleitern (falls aktiv), flach
  const [puzzles, setPuzzles] = useState([]); // Code-Detektiv-Rätsel (falls aktiv)
  const [aktiv, setAktiv] = useState({}); // { cardvote, karten, lernpfad } aktiv?
  const [editing, setEditing] = useState(null); // { date, ...entry } oder null
  const [tt, setTt] = useState({ periods: 6, slots: [] }); // Stundenplan
  const [breaks, setBreaks] = useState([]); // unterrichtsfreie Zeitraeume (Ferien/Feiertage)
  const [wdhVorschlag, setWdhVorschlag] = useState([]); // schwache Themen der Vorwoche
  const [slotEdit, setSlotEdit] = useState(null); // { weekday, period, ...slot } oder null

  useEffect(() => {
    swr("classes", "/api/classes", (d) => setClasses(Array.isArray(d) ? d : []));
    swr("topics", "/api/topics", (d) => setTopics(Array.isArray(d) ? d : []));
    // Methoden nur, wenn das Modul aktiv ist (sonst 403 -> leer, kein Selektor).
    fetch("/api/methoden/list").then((r) => (r.ok ? r.json() : [])).then((d) => setMethods(Array.isArray(d) ? d : [])).catch(() => {});
    // Regel 3: Modul-Objekte nur laden/anbieten, wenn das Modul aktiviert ist.
    fetch("/api/modules").then((r) => (r.ok ? r.json() : [])).then((mods) => {
      const on = {};
      (Array.isArray(mods) ? mods : []).forEach((m) => { if (m.active) on[m.key] = true; });
      setAktiv(on);
      if (on.cardvote) fetch("/api/folders").then((r) => (r.ok ? r.json() : [])).then((tree) => {
        // Quizze aus dem (rekursiven) Ordnerbaum flach ziehen, Ordnername als Kontext.
        const flat = [];
        const walk = (f) => { (f.question_sets || []).forEach((q) => flat.push({ id: q.id, name: q.name, folder: f.name })); (f.children || []).forEach(walk); };
        (Array.isArray(tree) ? tree : []).forEach(walk);
        setQuizze(flat);
      }).catch(() => {});
      if (on.lernpfad) fetch("/api/lernpfad/paths").then((r) => (r.ok ? r.json() : [])).then((paths) => {
        const flat = [];
        (Array.isArray(paths) ? paths : []).forEach((p) => (p.ladders || []).forEach((l) => flat.push({ id: l.id, name: l.name, path: p.name })));
        setLadders(flat);
      }).catch(() => {});
      if (on["code-detektiv"]) fetch("/api/codedetektiv/puzzles").then((r) => (r.ok ? r.json() : [])).then((d) => setPuzzles(Array.isArray(d) ? d : [])).catch(() => {});
    }).catch(() => {});
  }, []);

  const loadTt = useCallback(() => {
    fetch(`${API}/timetable`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setTt(d); }).catch(() => {});
  }, []);
  useEffect(() => { loadTt(); }, [loadTt]);

  const loadBreaks = useCallback(() => {
    fetch(`${API}/breaks`).then((r) => (r.ok ? r.json() : [])).then((d) => setBreaks(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);
  useEffect(() => { loadBreaks(); }, [loadBreaks]);

  // Wochenansicht: schwache Themen der Vorwoche als Wiederholungs-Vorschlag.
  useEffect(() => {
    if (view !== "week" || !aktiv.cardvote) { setWdhVorschlag([]); return; }
    const vorMo = addDays(mondayOf(cursor), -7);
    const vorSo = addDays(vorMo, 6);
    fetch(`/api/sessions/weak-topics?frm=${vorMo.toISOString()}&to=${addDays(vorSo, 1).toISOString()}`)
      .then((r) => (r.ok ? r.json() : null)).then((d) => setWdhVorschlag(d && Array.isArray(d.topics) ? d.topics : [])).catch(() => {});
  }, [view, cursor, aktiv.cardvote]);
  // Ist der Tag unterrichtsfrei (in einem Ferien-/Feiertags-Zeitraum)?
  const frei = (d) => breaks.find((b) => ymd(d) >= ymd(new Date(b.start_date)) && ymd(d) <= ymd(new Date(b.end_date)));
  const addBreak = async (b) => {
    const res = await fetch(`${API}/breaks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).catch(() => null);
    if (res && res.ok) loadBreaks();
  };
  const delBreak = async (id) => { await fetch(`${API}/breaks/${id}`, { method: "DELETE" }).catch(() => {}); loadBreaks(); };

  const exportKal = async () => {
    const r = await fetch(`${API}/export`).catch(() => null);
    if (!r || !r.ok) return;
    const blob = await r.blob(); const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "kalender.json"; a.click(); URL.revokeObjectURL(a.href);
  };
  const importKal = async (file) => {
    try {
      const data = JSON.parse(await file.text());
      const r = await fetch(`${API}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (r.ok) { load(); loadTt(); loadBreaks(); }
    } catch { /* ignorieren */ }
  };

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
    const body = { date: new Date(e.date).toISOString(), title: e.title || "", notes: e.notes || "", class_id: e.class_id || null, topic_id: e.topic_id || null, method_id: e.method_id || null, period: e.period ?? null, cardvote_set_id: e.cardvote_set_id || null, karten_deck_id: e.karten_deck_id || null, lernpfad_ladder_id: e.lernpfad_ladder_id || null, codedetektiv_puzzle: e.codedetektiv_puzzle || null };
    const res = await fetch(e.id ? `${API}/entries/${e.id}` : `${API}/entries`, {
      method: e.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).catch(() => null);
    if (res && res.ok) { setEditing(null); load(); }
  };
  const remove = async (id) => { await fetch(`${API}/entries/${id}`, { method: "DELETE" }).catch(() => {}); setEditing(null); load(); };

  const className = (id) => (classes.find((c) => c.id === id) || {}).name || "";
  const classColor = (id) => (classes.find((c) => c.id === id) || {}).color || "#2563eb";
  const weekdayOf = (d) => (new Date(d).getDay() + 6) % 7; // 0 = Montag
  const slotsFor = (d) => tt.slots.filter((s) => s.weekday === weekdayOf(d)).sort((a, b) => a.period - b.period);
  // Klick auf eine Stundenplan-Vorlage: gibt es an dem Tag schon einen Eintrag
  // dieser Klasse, wird der bearbeitet; sonst ein neuer aus der Vorlage.
  const fromSlot = (day, s) => {
    // Eindeutig ueber Tag + Stunde: ein zweiter Klick auf dieselbe Stunde
    // bearbeitet den vorhandenen Eintrag statt einen neuen anzulegen.
    const vorhanden = entries.find((e) => ymd(new Date(e.date)) === ymd(day) && e.period != null && e.period === s.period);
    if (vorhanden) setEditing({ ...vorhanden, date: new Date(vorhanden.date) });
    else setEditing({ date: startOfDay(day), period: s.period, title: s.title || "", class_id: s.class_id || null, topic_id: s.topic_id || null });
  };

  // Klassenfarbe aus dem Stundenplan setzen: sofort lokal, dann speichern.
  const setClassColor = async (id, color) => {
    setClasses((prev) => { const next = prev.map((c) => (c.id === id ? { ...c, color } : c)); put("classes", next); return next; });
    await fetch(`/api/classes/${id}/color`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ color }) }).catch(() => {});
  };

  const saveSlot = async (s) => {
    const body = { weekday: s.weekday, period: s.period, title: s.title || "", class_id: s.class_id || null, topic_id: s.topic_id || null };
    const res = await fetch(`${API}/timetable/slot`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (res && res.ok) { setSlotEdit(null); loadTt(); }
  };
  const removeSlot = async (id) => { await fetch(`${API}/timetable/slot/${id}`, { method: "DELETE" }).catch(() => {}); setSlotEdit(null); loadTt(); };
  const setPeriods = async (n) => {
    const res = await fetch(`${API}/timetable/periods`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ periods: n }) }).catch(() => null);
    if (res && res.ok) setTt(await res.json());
  };
  const setTimes = async (times) => {
    const res = await fetch(`${API}/timetable/times`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ times }) }).catch(() => null);
    if (res && res.ok) setTt(await res.json());
  };

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
          {[["month", t("kalender.month")], ["week", t("kalender.week")], ["day", t("kalender.day")], ["timetable", t("kalender.timetable")], ["breaks", t("kalender.breaksTab")]].map(([v, l]) => (
            <button key={v} onClick={() => setView(v)} style={{ padding: "6px 14px", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", background: view === v ? "var(--accent)" : "transparent", color: view === v ? "#fff" : "var(--text2)" }}>{l}</button>
          ))}
        </div>
        {view !== "timetable" && view !== "breaks" && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
            <button onClick={() => move(-1)} style={{ ...btnSecondary, padding: "5px 12px", fontSize: 15 }} title="◀">‹</button>
            <button onClick={() => setCursor(startOfDay(new Date()))} style={{ ...btnSecondary, padding: "5px 12px", fontSize: 13 }}>{t("kalender.today")}</button>
            <button onClick={() => move(1)} style={{ ...btnSecondary, padding: "5px 12px", fontSize: 15 }} title="▶">›</button>
          </div>
        )}
      </div>
      {view === "timetable" && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button onClick={exportKal} style={btnSecondary}>{t("kalender.export")}</button>
          <label style={{ ...btnSecondary, cursor: "pointer" }}>{t("kalender.import")}
            <input type="file" accept=".json,application/json" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) importKal(e.target.files[0]); e.target.value = ""; }} />
          </label>
        </div>
      )}
      {view !== "timetable" && view !== "breaks" && <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "var(--text)" }}>{title}</div>}
      {view === "breaks" && <BreaksPanel breaks={breaks} onAdd={addBreak} onDel={delBreak} t={t} standalone />}

      {view === "month" && <MonthGrid range={range} cursor={cursor} byDay={byDay} slotsFor={slotsFor} onSlot={fromSlot} frei={frei} className={className} topicName={topicName} classColor={classColor} onAdd={(d) => setEditing({ date: startOfDay(d) })} onOpen={setEditing} t={t} />}
      {view === "week" && wdhVorschlag.length > 0 && (
        <div style={{ marginBottom: 12, padding: "12px 14px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{t("kalender.wdhTitle")}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {wdhVorschlag.map((tp) => (
              <button key={tp.topic_id} onClick={() => setEditing({ date: startOfDay(mondayOf(cursor)), title: `${t("kalender.wdhPrefix")}: ${tp.name}`, topic_id: tp.topic_id })}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 980, border: "1px solid var(--border2)", background: "var(--bg)", cursor: "pointer", fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{tp.name}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: tp.pct < 40 ? "#d1350f" : "#b8860b" }}>{tp.pct}%</span>
                <span style={{ color: "var(--accent)" }}>+</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {view === "week" && <WeekView range={range} byDay={byDay} slotsFor={slotsFor} frei={frei} className={className} classColor={classColor} topicName={topicName} onAdd={(d) => setEditing({ date: startOfDay(d) })} onOpen={setEditing} onSlot={fromSlot} t={t} />}
      {view === "day" && <DayView day={cursor} byDay={byDay} slotsFor={slotsFor} frei={frei} className={className} classColor={classColor} topicName={topicName} onAdd={(d) => setEditing({ date: startOfDay(d) })} onOpen={setEditing} onSlot={fromSlot} t={t} />}
      {view === "timetable" && <TimetableView tt={tt} className={className} classColor={classColor} topicName={topicName} onEdit={setSlotEdit} onPeriods={setPeriods} onTimes={setTimes} t={t} />}

      {editing && <EntryModal entry={editing} classes={classes} topics={topics} methods={methods} quizze={quizze} ladders={ladders} puzzles={puzzles} aktiv={aktiv} topicName={topicName} onSave={save} onDelete={remove} onClose={() => setEditing(null)} t={t} />}
      {slotEdit && <SlotModal slot={slotEdit} classes={classes} topics={topics} onSave={saveSlot} onDelete={removeSlot} onColor={setClassColor} onClose={() => setSlotEdit(null)} t={t} />}
    </div>
  );
}

const cell = { border: "1px solid var(--border)", minHeight: 84, padding: 6, verticalAlign: "top", background: "var(--card)" };
const chip = { display: "block", width: "100%", textAlign: "left", fontSize: 11.5, padding: "2px 6px", borderRadius: 6, background: "var(--accent-bg, rgba(10,132,255,0.12))", color: "var(--accent)", border: "none", cursor: "pointer", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
// Vorlage aus dem Stundenplan: gestrichelt, gedaempft — anklicken macht daraus einen Termin.
const ghost = { ...chip, background: "transparent", color: "var(--text3)", border: "1px dashed var(--border2)" };

function SlotGhosts({ list, entries, className, topicName, onSlot, day, t }) {
  // Vorlagen ausblenden, sobald an dem Tag schon ein Eintrag dieser Klasse
  // existiert — der wird dann als Chip gezeigt und dort bearbeitet, statt
  // dass ein Klick auf die Geister-Vorlage einen zweiten Eintrag anlegt.
  const belegt = new Set((entries || []).filter((e) => e.period != null).map((e) => e.period));
  return list.filter((s) => !belegt.has(s.period)).map((s) => {
    const label = [s.period + ". " + t("kalender.period"), className(s.class_id) || s.title || topicName(s.topic_id)].filter(Boolean).join(" · ");
    return (
      <button key={s.id} onClick={() => onSlot(day, s)} style={ghost} title={label + " — " + t("kalender.fromTimetable")}>{label}</button>
    );
  });
}

// Direktlink zum verknuepften Modul-Objekt eines Eintrags (falls vorhanden).
function entryLink(e) {
  if (e.cardvote_set_id) return "/cardvote/questions";
  if (e.karten_deck_id) return `/karten?class=${e.class_id || ""}`;
  if (e.lernpfad_ladder_id) return "/lernpfad";
  return null;
}

function EntryChips({ list, className, topicName, onOpen, classColor }) {
  return list.map((e) => {
    const col = e.class_id && classColor ? classColor(e.class_id) : null;
    const label = e.title || topicName(e.topic_id) || (className && className(e.class_id)) || "—";
    const link = entryLink(e);
    return (
      <div key={e.id} style={{ display: "flex", alignItems: "stretch", gap: 2, marginTop: 3 }}>
        <button onClick={() => onOpen({ ...e, date: new Date(e.date) })}
          style={{ ...chip, marginTop: 0, flex: 1, minWidth: 0, ...(col ? { background: col + "22", color: "var(--text)", borderLeft: `3px solid ${col}` } : {}) }}
          title={label}>
          {label}
        </button>
        {link && (
          <Link to={link} onClick={(ev) => ev.stopPropagation()} title="↗"
            style={{ display: "inline-flex", alignItems: "center", padding: "0 4px", borderRadius: 6, background: col ? col + "22" : "var(--bg2)", color: "var(--accent)", textDecoration: "none" }}>
            <Icon d={ICONS.open} size={12} color="var(--accent)" />
          </Link>
        )}
      </div>
    );
  });
}

function MonthGrid({ range, cursor, byDay, slotsFor, onSlot, frei, className, topicName, classColor, onAdd, onOpen, t }) {
  const days = [];
  for (let d = new Date(range[0]); d <= range[1]; d = addDays(d, 1)) days.push(new Date(d));
  const wdays = [t("kalender.mon"), t("kalender.tue"), t("kalender.wed"), t("kalender.thu"), t("kalender.fri"), t("kalender.sat"), t("kalender.sun")];
  const heute = ymd(new Date());
  return (
    <div>
      <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
        <thead><tr>{wdays.map((w) => <th key={w} style={{ padding: 6, fontSize: 12, color: "var(--text3)", textAlign: "left" }}>{w}</th>)}</tr></thead>
        <tbody>
          {Array.from({ length: days.length / 7 }).map((_, r) => (
            <tr key={r}>
              {days.slice(r * 7, r * 7 + 7).map((d) => {
                const other = d.getMonth() !== cursor.getMonth();
                const f = frei && frei(d);
                return (
                  <td key={ymd(d)} style={{ ...cell, opacity: other ? 0.5 : 1, background: f ? "var(--bg)" : undefined, outline: ymd(d) === heute ? "2px solid var(--accent)" : "none", outlineOffset: -2 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)" }}>{d.getDate()}</span>
                      {!f && <button onClick={() => onAdd(d)} className="icon-btn" style={{ ...iconBtn, padding: 0 }} title={t("kalender.add")}><Icon d={ICONS.plus} size={13} color="var(--accent)" /></button>}
                    </div>
                    {f ? <FreiMarker label={f.label} t={t} /> : (<>
                      <EntryChips list={byDay(d)} className={className} topicName={topicName} onOpen={onOpen} classColor={classColor} />
                      {slotsFor && <SlotGhosts list={slotsFor(d)} entries={byDay(d)} className={className} topicName={topicName} onSlot={onSlot} day={d} t={t} />}
                    </>)}
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

function WeekView({ range, byDay, slotsFor, frei, className, classColor, topicName, onAdd, onOpen, onSlot, t }) {
  const days = [];
  for (let d = new Date(range[0]); d <= range[1]; d = addDays(d, 1)) days.push(new Date(d));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, overflowX: "auto" }}>
      {days.map((d) => {
        const f = frei && frei(d);
        return (
        <div key={ymd(d)} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 8, minHeight: 160, background: f ? "var(--bg)" : "var(--card)", minWidth: 90 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}</span>
            {!f && <button onClick={() => onAdd(d)} className="icon-btn" style={{ ...iconBtn, padding: 0 }}><Icon d={ICONS.plus} size={13} color="var(--accent)" /></button>}
          </div>
          {f ? <FreiMarker label={f.label} t={t} /> : (<>
            <SlotGhosts list={slotsFor(d)} entries={byDay(d)} className={className} topicName={topicName} onSlot={onSlot} day={d} t={t} />
            <EntryChips list={byDay(d)} className={className} topicName={topicName} onOpen={onOpen} classColor={classColor} />
          </>)}
        </div>
        );
      })}
    </div>
  );
}

function FreiMarker({ label, t }) {
  return (
    <div style={{ fontSize: 11.5, color: "var(--text3)", fontStyle: "italic", padding: "4px 2px" }}>
      {label || t("kalender.free")}
    </div>
  );
}

function DayView({ day, byDay, slotsFor, frei, className, classColor, topicName, onAdd, onOpen, onSlot, t }) {
  const list = byDay(day);
  const slots = slotsFor(day);
  const f = frei && frei(day);
  if (f) return <p style={{ fontSize: 14, color: "var(--text3)", fontStyle: "italic" }}>{f.label ? `${f.label} — ${t("kalender.free")}` : t("kalender.free")}</p>;
  return (
    <div>
      <button onClick={() => onAdd(day)} style={{ ...btnPrimary, marginBottom: 14 }}>{t("kalender.add")}</button>
      {slots.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <SlotGhosts list={slots} entries={list} className={className} topicName={topicName} onSlot={onSlot} day={day} t={t} />
        </div>
      )}
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

function TimetableView({ tt, className, classColor, topicName, onEdit, onPeriods, onTimes, breaks = [], onAddBreak, onDelBreak, t }) {
  const wdays = [t("kalender.mon"), t("kalender.tue"), t("kalender.wed"), t("kalender.thu"), t("kalender.fri")];
  const periods = Array.from({ length: tt.periods }, (_, i) => i + 1);
  const slot = (wd, p) => tt.slots.find((s) => s.weekday === wd && s.period === p);
  // Uhrzeiten je Stunde: onBlur speichern (wenige Felder, kein Debounce noetig).
  const timeVal = (i, f) => (tt.times && tt.times[i] && tt.times[i][f]) || "";
  const commitTime = (i, f, val) => {
    const arr = periods.map((_, idx) => ({ start: timeVal(idx, "start"), end: timeVal(idx, "end") }));
    arr[i] = { ...arr[i], [f]: val };
    onTimes(arr);
  };
  const timeInput = { width: "100%", boxSizing: "border-box", border: "1px solid var(--border2)", borderRadius: 6, fontSize: 12, padding: "3px 4px", background: "var(--bg)", color: "var(--text)", marginTop: 2 };
  const tdBase = { border: "1px solid var(--border)", padding: 0, verticalAlign: "top", background: "var(--card)" };
  // Vertikal konstant: Zeilenhoehe = Dauer * px/min. Pausen zwischen den Stunden
  // erscheinen als leere Zwischenzeile derselben Skalierung.
  const toMin = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ""); return m ? (+m[1]) * 60 + (+m[2]) : null; };
  const PXMIN = 1.3;
  const rowH = (p) => { const a = toMin(timeVal(p - 1, "start")), b = toMin(timeVal(p - 1, "end")); return a != null && b != null && b > a ? Math.max(52, (b - a) * PXMIN) : 72; };
  const gapH = (p) => { const a = toMin(timeVal(p - 1, "end")), b = toMin(timeVal(p, "start")); return a != null && b != null && b > a ? (b - a) * PXMIN : 0; };
  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--text3)", margin: "0 0 12px", maxWidth: 620 }}>{t("kalender.timetableHint")}</p>
      <div>
        <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
          <thead><tr>
            <th style={{ width: 96, padding: 6, fontSize: 12, color: "var(--text3)" }}></th>
            {wdays.map((w) => <th key={w} style={{ padding: 6, fontSize: 12, color: "var(--text3)" }}>{w}</th>)}
          </tr></thead>
          <tbody>
            {periods.map((p) => {
              const h = rowH(p);
              const gap = gapH(p); // Pause nach dieser Stunde
              return (
                <Fragment key={p}>
                  <tr>
                    <td style={{ ...tdBase, textAlign: "center", padding: 4, background: "transparent", border: "none", width: 96 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)" }}>{p}.</div>
                      <input type="time" defaultValue={timeVal(p - 1, "start")} onBlur={(e) => commitTime(p - 1, "start", e.target.value)} style={timeInput} title={t("kalender.start")} />
                      <input type="time" defaultValue={timeVal(p - 1, "end")} onBlur={(e) => commitTime(p - 1, "end", e.target.value)} style={timeInput} title={t("kalender.end")} />
                    </td>
                    {wdays.map((_, wd) => {
                      const s = slot(wd, p);
                      const label = s ? className(s.class_id) : "";
                      const col = s ? classColor(s.class_id) : null;
                      return (
                        <td key={wd} style={{ ...tdBase, padding: 0, height: h }}>
                          <button onClick={() => onEdit(s ? { ...s } : { weekday: wd, period: p })}
                            style={{ display: "flex", alignItems: "center", width: "100%", height: "100%", minHeight: h, textAlign: "left", padding: "6px 10px", border: "none", cursor: "pointer", boxSizing: "border-box",
                              borderLeft: col ? `4px solid ${col}` : "4px solid transparent",
                              background: col ? col + "22" : "transparent", color: col ? "var(--text)" : "var(--text3)" }}>
                            {s ? <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label || "—"}</div>
                              : <span style={{ fontSize: 12 }}>+</span>}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                  {gap > 0 && (
                    <tr aria-hidden style={{ height: gap }}>
                      <td style={{ border: "none", background: "transparent" }} />
                      {wdays.map((_, wd) => <td key={wd} style={{ border: "none", background: "repeating-linear-gradient(45deg, var(--bg), var(--bg) 6px, transparent 6px, transparent 12px)" }} />)}
                    </tr>
                  )}
                </Fragment>
              );
            })}
            <tr>
              <td style={{ padding: 6, border: "none", textAlign: "center" }}>
                <div style={{ display: "inline-flex", gap: 4 }}>
                  {tt.periods > 1 && <button onClick={() => onPeriods(tt.periods - 1)} title={t("kalender.removePeriod")} style={{ ...btnSecondary, padding: "3px 9px", fontSize: 14 }}>−</button>}
                  <button onClick={() => onPeriods(tt.periods + 1)} title={t("kalender.addPeriod")} style={{ ...btnSecondary, padding: "3px 9px", fontSize: 14 }}>+</button>
                </div>
              </td>
              {wdays.map((_, wd) => <td key={wd} style={{ border: "none" }} />)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Unterrichtsfreie Zeitraeume (Ferien, bewegliche Feiertage). An diesen Tagen
// blendet der Kalender Vorlagen und Eintraege aus. Eigener Tab (standalone).
function BreaksPanel({ breaks, onAdd, onDel, t, standalone }) {
  const [von, setVon] = useState("");
  const [bis, setBis] = useState("");
  const [label, setLabel] = useState("");
  const fld = { padding: "7px 9px", border: "1px solid var(--border2)", borderRadius: 8, fontSize: 13.5, background: "var(--bg)", color: "var(--text)", boxSizing: "border-box" };
  const speichern = () => {
    if (!von) return;
    const ende = bis || von;
    onAdd({ start_date: new Date(von + "T00:00:00").toISOString(), end_date: new Date(ende + "T00:00:00").toISOString(), label: label.trim() });
    setVon(""); setBis(""); setLabel("");
  };
  const fmt = (s) => new Date(s).toLocaleDateString();
  return (
    <div style={standalone ? {} : { marginTop: 26, borderTop: "1px solid var(--border)", paddingTop: 18 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{t("kalender.breaksTitle")}</h3>
      <p style={{ fontSize: 12.5, color: "var(--text3)", margin: "0 0 12px", maxWidth: 620 }}>{t("kalender.breaksHint")}</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: "var(--text2)", display: "flex", flexDirection: "column", gap: 3 }}>{t("kalender.from")}
          <input type="date" value={von} onChange={(e) => setVon(e.target.value)} style={fld} /></label>
        <label style={{ fontSize: 12, color: "var(--text2)", display: "flex", flexDirection: "column", gap: 3 }}>{t("kalender.to")}
          <input type="date" value={bis} onChange={(e) => setBis(e.target.value)} min={von} style={fld} /></label>
        <label style={{ fontSize: 12, color: "var(--text2)", display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 160 }}>{t("kalender.breakLabel")}
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("kalender.breakLabelPlaceholder")} style={fld} /></label>
        <button onClick={speichern} disabled={!von} style={{ ...btnPrimary, opacity: von ? 1 : 0.5, alignSelf: "flex-end" }}>{t("kalender.addBreak")}</button>
      </div>
      {breaks.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text3)" }}>{t("kalender.noBreaks")}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {breaks.map((b) => (
            <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)" }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{b.label || t("kalender.free")}</span>
              <span style={{ fontSize: 12.5, color: "var(--text3)" }}>{fmt(b.start_date)}{fmt(b.start_date) !== fmt(b.end_date) ? ` – ${fmt(b.end_date)}` : ""}</span>
              <button onClick={() => onDel(b.id)} className="icon-btn" style={{ ...iconBtn, marginLeft: "auto", padding: 5 }} title={t("common.delete")}><Icon d={ICONS.trash} size={16} color={C.danger} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SlotModal({ slot, classes, onSave, onDelete, onColor, onClose, t }) {
  const [classId, setClassId] = useState(slot.class_id || "");
  const cls = classes.find((c) => c.id === Number(classId));
  const [color, setColor] = useState(cls?.color || "#2563eb");
  useEffect(() => { const c = classes.find((x) => x.id === Number(classId)); setColor(c?.color || "#2563eb"); }, [classId]); // eslint-disable-line
  const wdays = [t("kalender.mon"), t("kalender.tue"), t("kalender.wed"), t("kalender.thu"), t("kalender.fri"), t("kalender.sat"), t("kalender.sun")];
  const fld = { width: "100%", padding: 9, border: "1px solid var(--border2)", borderRadius: 8, fontSize: 14, background: "var(--bg)", color: "var(--text)", boxSizing: "border-box" };
  const sfld = { ...selectStyle, width: "100%", fontSize: 14, padding: "10px 34px 10px 12px" };
  const lbl = { fontSize: 12.5, color: "var(--text2)", margin: "12px 0 5px" };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 200 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--card)", borderRadius: 16, maxWidth: 440, width: "100%", padding: 22, border: "1px solid var(--border)", maxHeight: "85vh", overflow: "auto" }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 2 }}>{t("kalender.timetable")}</h3>
        <div style={{ fontSize: 12.5, color: "var(--text3)" }}>{wdays[slot.weekday]} · {slot.period}. {t("kalender.period")}</div>
        <div style={lbl}>{t("nav.classes")}</div>
        <select value={classId} onChange={(e) => setClassId(e.target.value)} style={sfld}>
          <option value="">– {t("kalender.noClass")} –</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {classId && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text2)" }}>
              {t("kalender.classColor")}
              <input type="color" value={color} onChange={(e) => { setColor(e.target.value); onColor && onColor(Number(classId), e.target.value); }}
                style={{ width: 34, height: 28, border: "1px solid var(--border2)", borderRadius: 6, background: "none", cursor: "pointer", padding: 0 }} />
            </label>
            <Link to={`/classes?open=${classId}`} onClick={onClose} style={{ fontSize: 13, color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>{t("kalender.toClass")} ↗</Link>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 18, alignItems: "center" }}>
          <button onClick={() => onSave({ weekday: slot.weekday, period: slot.period, title: "", class_id: classId ? Number(classId) : null, topic_id: null })} style={btnPrimary}>{t("common.save")}</button>
          <button onClick={onClose} style={btnSecondary}>{t("common.abort")}</button>
          {slot.id && <button onClick={() => onDelete(slot.id)} className="icon-btn" style={{ ...iconBtn, marginLeft: "auto" }} title={t("common.delete")}><Icon d={ICONS.trash} color={C.danger} /></button>}
        </div>
      </div>
    </div>
  );
}

function EntryModal({ entry, classes, topics, methods = [], quizze = [], ladders = [], puzzles = [], aktiv = {}, onSave, onDelete, onClose, t }) {
  const navigate = useNavigate();
  // "Ergebnis als Note": die gelaufene Session zum verknüpften Quiz suchen und
  // deren Auswertung mit direkt geöffnetem Noten-Import ansteuern.
  const alsNote = async () => {
    const r = await fetch(`${API}/quiz-session?set_id=${entry.cardvote_set_id}&class_id=${entry.class_id}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (r && r.session_id) { onClose(); navigate(`/cardvote/evaluation/${r.session_id}?import=1`); }
    else showAlert(t("kalender.noSession"));
  };
  const [title, setTitle] = useState(entry.title || "");
  const [notes, setNotes] = useState(entry.notes || "");
  const [classId, setClassId] = useState(entry.class_id || "");
  const [topicId, setTopicId] = useState(entry.topic_id || "");
  const [methodId, setMethodId] = useState(entry.method_id || "");
  const [quizId, setQuizId] = useState(entry.cardvote_set_id || "");
  const [ladderId, setLadderId] = useState(entry.lernpfad_ladder_id || "");
  const [puzzleId, setPuzzleId] = useState(entry.codedetektiv_puzzle || "");
  const [deckId, setDeckId] = useState(entry.karten_deck_id || "");
  const [decks, setDecks] = useState([]); // Karten-Decks der gewaehlten Klasse
  // Decks haengen an der Klasse: neu laden, wenn Klasse wechselt und Modul aktiv.
  useEffect(() => {
    if (!aktiv.karten || !classId) { setDecks([]); return; }
    fetch(`/api/karten/classes/${classId}/decks`).then((r) => (r.ok ? r.json() : [])).then((d) => setDecks(Array.isArray(d) ? d : [])).catch(() => {});
  }, [aktiv.karten, classId]);
  const fld = { width: "100%", padding: 9, border: "1px solid var(--border2)", borderRadius: 8, fontSize: 14, background: "var(--bg)", color: "var(--text)", boxSizing: "border-box" };
  const sfld = { ...selectStyle, width: "100%", fontSize: 14, padding: "10px 34px 10px 12px" };
  const lbl = { fontSize: 12.5, color: "var(--text2)", margin: "12px 0 5px" };
  const topicLabel = (tp) => { const p = tp.parent_id ? topics.find((x) => x.id === tp.parent_id) : null; return p ? `${p.name} / ${tp.name}` : tp.name; };
  // Bestehender Eintrag oeffnet zuerst als Ansicht; neuer direkt im Bearbeiten.
  const [edit, setEdit] = useState(!entry.id);
  const clsName = classId && (classes.find((c) => c.id === Number(classId)) || {}).name;
  const topName = topicId && (() => { const tp = topics.find((x) => x.id === Number(topicId)); return tp ? topicLabel(tp) : ""; })();
  const methName = methodId && (methods.find((m) => m.id === Number(methodId)) || {}).title;
  const linkList = [
    quizId && (() => { const q = quizze.find((x) => x.id === Number(quizId)); return q && { to: "/cardvote/questions", label: q.folder ? `${q.folder} / ${q.name}` : q.name, kind: t("kalender.planCardvote") }; })(),
    deckId && (() => { const d = decks.find((x) => x.id === Number(deckId)); return d && { to: `/karten?class=${classId}`, label: d.name, kind: t("kalender.planKarten") }; })(),
    ladderId && (() => { const l = ladders.find((x) => x.id === Number(ladderId)); return l && { to: "/lernpfad", label: l.path ? `${l.path} / ${l.name}` : l.name, kind: t("kalender.planLernleiter") }; })(),
    puzzleId && (() => { const p = puzzles.find((x) => x.client_id === puzzleId); return { to: `/code-detektiv/puzzle/${puzzleId}?mode=solo`, label: (p && p.title) || puzzleId, kind: t("kalender.planDetektiv") }; })(),
  ].filter(Boolean);
  const zeile = (k, v) => v ? <div style={{ display: "flex", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--border)", fontSize: 13.5 }}><span style={{ color: "var(--text3)", minWidth: 92 }}>{k}</span><span style={{ fontWeight: 500 }}>{v}</span></div> : null;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 200 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--card)", borderRadius: 18, maxWidth: 460, width: "100%", padding: 0, border: "1px solid var(--border)", maxHeight: "88vh", overflow: "auto", boxShadow: "0 20px 50px rgba(0,0,0,0.28)" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 5 }}>{!edit ? (title || t("kalender.entry")) : ((entry.id || entry.period != null) ? t("kalender.editEntry") : t("kalender.newEntry"))}</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {entry.period != null && <span style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 9px", borderRadius: 980, background: "var(--accent)", color: "#fff" }}>{entry.period}. {t("kalender.period")}</span>}
              <span style={{ fontSize: 12.5, color: "var(--text3)" }}>{new Date(entry.date).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
            </div>
          </div>
          <button onClick={onClose} className="icon-btn" style={{ ...iconBtn, padding: 6 }} title={t("common.close")}><Icon d={ICONS.close} size={18} /></button>
        </div>
        <div style={{ padding: "6px 24px 22px" }}>
        {!edit && (
          <div>
            {(clsName || topName || methName) && (
              <div style={{ marginTop: 4 }}>
                {zeile(t("nav.classes"), clsName)}
                {zeile(t("kalender.topic"), topName)}
                {zeile(t("kalender.method"), methName)}
              </div>
            )}
            {aktiv.orga && classId && (
              <Link to={`/orga?tab=anwesenheit&class=${classId}&date=${ymd(new Date(entry.date))}`} onClick={onClose}
                style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, padding: "8px 11px", borderRadius: 8, border: "1px solid var(--border2)", background: "var(--bg)", textDecoration: "none", color: "var(--accent)", fontSize: 13.5, fontWeight: 600 }}>
                <Icon d={ICONS.open} size={15} color="var(--accent)" />
                {t("kalender.toAttendance")}
              </Link>
            )}
            {aktiv.cardvote && aktiv.noten && entry.cardvote_set_id && classId && (
              <button onClick={alsNote}
                style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, padding: "8px 11px", borderRadius: 8, border: "1px solid var(--border2)", background: "var(--bg)", cursor: "pointer", color: "var(--accent)", fontSize: 13.5, fontWeight: 600, width: "100%" }}>
                <Icon d={ICONS.chart} size={15} color="var(--accent)" />
                {t("kalender.resultAsGrade")}
              </button>
            )}
            {linkList.length > 0 && (
              <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={lbl}>{t("kalender.openLinked")}</div>
                {linkList.map((lk) => (
                  <Link key={lk.to} to={lk.to} onClick={onClose}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 11px", borderRadius: 8, border: "1px solid var(--border2)", background: "var(--bg)", textDecoration: "none", color: "var(--accent)", fontSize: 13.5 }}>
                    <Icon d={ICONS.open} size={15} color="var(--accent)" />
                    <span style={{ color: "var(--text3)", fontSize: 11.5 }}>{lk.kind}</span>
                    <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lk.label}</span>
                  </Link>
                ))}
              </div>
            )}
            {notes && <div style={{ marginTop: 14, fontSize: 13.5, whiteSpace: "pre-wrap", color: "var(--text2)" }}>{notes}</div>}
            {!clsName && !topName && !methName && !linkList.length && !notes && <p style={{ fontSize: 13.5, color: "var(--text3)", marginTop: 8 }}>{t("kalender.emptyEntry")}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 20, alignItems: "center" }}>
              <button onClick={() => setEdit(true)} style={btnPrimary}>{t("common.edit")}</button>
              <button onClick={onClose} style={btnSecondary}>{t("common.close")}</button>
              {entry.id && <button onClick={() => onDelete(entry.id)} className="icon-btn" style={{ ...iconBtn, marginLeft: "auto" }} title={t("common.delete")}><Icon d={ICONS.trash} color={C.danger} /></button>}
            </div>
          </div>
        )}
        {edit && (<>
        <div style={lbl}>{t("kalender.entryTitle")}</div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder={t("kalender.entryTitlePlaceholder")} style={fld} />
        <div style={lbl}>{t("nav.classes")}</div>
        <select value={classId} onChange={(e) => setClassId(e.target.value)} style={sfld}>
          <option value="">– {t("kalender.noClass")} –</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div style={lbl}>{t("kalender.topic")}</div>
        <select value={topicId} onChange={(e) => setTopicId(e.target.value)} style={sfld}>
          <option value="">– {t("kalender.noTopic")} –</option>
          {topics.map((tp) => <option key={tp.id} value={tp.id}>{topicLabel(tp)}</option>)}
        </select>
        {methods.length > 0 && (
          <>
            <div style={lbl}>{t("kalender.method")}</div>
            <select value={methodId} onChange={(e) => setMethodId(e.target.value)} style={sfld}>
              <option value="">– {t("kalender.noMethod")} –</option>
              {methods.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
            </select>
          </>
        )}
        {(aktiv.cardvote || aktiv.karten || aktiv.lernpfad) && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 0 2px" }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase", color: "var(--text3)" }}>{t("kalender.planning")}</span>
            <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
          </div>
        )}
        {aktiv.cardvote && (
          <>
            <div style={lbl}>{t("kalender.planCardvote")}</div>
            <select value={quizId} onChange={(e) => setQuizId(e.target.value)} style={sfld}>
              <option value="">– {t("kalender.none")} –</option>
              {quizze.map((q) => <option key={q.id} value={q.id}>{q.folder ? `${q.folder} / ${q.name}` : q.name}</option>)}
            </select>
          </>
        )}
        {aktiv.karten && (
          <>
            <div style={lbl}>{t("kalender.planKarten")}</div>
            <select value={deckId} onChange={(e) => setDeckId(e.target.value)} style={sfld} disabled={!classId} title={!classId ? t("kalender.pickClassFirst") : undefined}>
              <option value="">– {t("kalender.none")} –</option>
              {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            {deckId && <div style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 4 }}>{t("kalender.deckReleaseHint")}</div>}
          </>
        )}
        {aktiv.lernpfad && (
          <>
            <div style={lbl}>{t("kalender.planLernleiter")}</div>
            <select value={ladderId} onChange={(e) => setLadderId(e.target.value)} style={sfld}>
              <option value="">– {t("kalender.none")} –</option>
              {ladders.map((l) => <option key={l.id} value={l.id}>{l.path ? `${l.path} / ${l.name}` : l.name}</option>)}
            </select>
          </>
        )}
        {aktiv["code-detektiv"] && (
          <>
            <div style={lbl}>{t("kalender.planDetektiv")}</div>
            <select value={puzzleId} onChange={(e) => setPuzzleId(e.target.value)} style={sfld}>
              <option value="">– {t("kalender.none")} –</option>
              {puzzles.map((p) => <option key={p.client_id} value={p.client_id}>{p.title || p.client_id}</option>)}
            </select>
          </>
        )}
        {(() => {
          // Verknüpfte Objekte als klickbare Links (öffnet das Modul). Nur was
          // gewählt und dessen Modul aktiv ist — Name aus den geladenen Listen.
          const q = quizId && quizze.find((x) => x.id === Number(quizId));
          const d = deckId && decks.find((x) => x.id === Number(deckId));
          const l = ladderId && ladders.find((x) => x.id === Number(ladderId));
          const links = [
            q && { to: "/cardvote/questions", label: q.folder ? `${q.folder} / ${q.name}` : q.name, icon: t("kalender.planCardvote") },
            d && { to: `/karten?class=${classId}`, label: d.name, icon: t("kalender.planKarten") },
            l && { to: "/lernpfad", label: l.path ? `${l.path} / ${l.name}` : l.name, icon: t("kalender.planLernleiter") },
          ].filter(Boolean);
          if (!links.length) return null;
          return (
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={lbl}>{t("kalender.openLinked")}</div>
              {links.map((lk) => (
                <Link key={lk.to} to={lk.to} onClick={onClose}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 11px", borderRadius: 8, border: "1px solid var(--border2)", background: "var(--bg)", textDecoration: "none", color: "var(--accent)", fontSize: 13.5 }}>
                  <Icon d={ICONS.open} size={15} color="var(--accent)" />
                  <span style={{ color: "var(--text3)", fontSize: 11.5 }}>{lk.icon}</span>
                  <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lk.label}</span>
                </Link>
              ))}
            </div>
          );
        })()}
        <div style={lbl}>{t("kalender.notes")}</div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ ...fld, resize: "vertical" }} />
        <div style={{ display: "flex", gap: 8, marginTop: 18, alignItems: "center" }}>
          <button onClick={() => onSave({ ...entry, title, notes, class_id: classId ? Number(classId) : null, topic_id: topicId ? Number(topicId) : null, method_id: methodId ? Number(methodId) : null, cardvote_set_id: quizId ? Number(quizId) : null, karten_deck_id: deckId ? Number(deckId) : null, lernpfad_ladder_id: ladderId ? Number(ladderId) : null, codedetektiv_puzzle: puzzleId || null })} style={btnPrimary}>{t("common.save")}</button>
          <button onClick={onClose} style={btnSecondary}>{t("common.abort")}</button>
          {entry.id && <button onClick={() => onDelete(entry.id)} className="icon-btn" style={{ ...iconBtn, marginLeft: "auto" }} title={t("common.delete")}><Icon d={ICONS.trash} color={C.danger} /></button>}
        </div>
        </>)}
        </div>
      </div>
    </div>
  );
}
