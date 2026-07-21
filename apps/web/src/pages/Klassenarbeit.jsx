// Modul „Klassenarbeit auswerten": eine Arbeit als Raster — Zeilen = Aufgaben
// (Label + Thema), Spalten = SuS, Zelle = richtig/falsch. Daraus je SuS ein
// Fehlerprofil nach Thema und auf Knopfdruck gezielte Wiederholung (Karten des
// schwachen Themas wieder fällig).
import { useState, useEffect, useRef, useMemo } from "react";
import { pageTitle, btnPrimary, btnSecondary, selectStyle, inputStyle, Icon, ICONS, iconBtn, COLORS as C, Empty, modalOverlay, modalPanel } from "../components/Icons.jsx";
import KursKlasseSelect from "../components/KursKlasseSelect.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { useModules } from "../core/modules.js";
import { askConfirm, showAlert } from "../core/dialog.jsx";
import { lastClass, rememberClass } from "../core/cache.js";
import { gradeFromPct, DEFAULT_SCALE } from "../core/grades.js";

const API = "/api/klassenarbeit";
const newId = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export default function Klassenarbeit() {
  const { t } = useLanguage();
  const { modules } = useModules();
  const kartenAktiv = modules.find((m) => m.key === "karten")?.active ?? false;
  const lernpfadAktiv = modules.find((m) => m.key === "lernpfad")?.active ?? false;
  const notenAktiv = modules.find((m) => m.key === "noten")?.active ?? false;
  const [notenModal, setNotenModal] = useState(false);
  const [classId, setClassId] = useState(null);
  const [kursId, setKursId] = useState(null);
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [topics, setTopics] = useState([]);
  const [works, setWorks] = useState([]);
  const [work, setWork] = useState(null); // { id, name, tasks:[{id,label,topic_id}], results:{sid:[taskId]} }
  const [busy, setBusy] = useState(false);
  const kq = kursId != null ? `?kurs_id=${kursId}` : "";
  const saveTimer = useRef(null);

  useEffect(() => { fetch("/api/topics").then((r) => (r.ok ? r.json() : [])).then((d) => setTopics(Array.isArray(d) ? d : [])).catch(() => {}); }, []);
  // Beim ersten Besuch gleich eine Klasse wählen (zuletzt genutzte, sonst erste),
  // damit die Arbeitsauswahl nicht ausgeblendet bleibt, bis man von Hand klickt.
  useEffect(() => {
    fetch("/api/classes").then((r) => (r.ok ? r.json() : [])).then((list) => {
      const l = Array.isArray(list) ? list : []; setClasses(l);
      if (classId == null && l.length) { const w = lastClass(); setClassId(l.some((c) => c.id === w) ? w : l[0].id); }
    }).catch(() => {});
  }, []); // eslint-disable-line
  useEffect(() => {
    if (classId) rememberClass(classId);
    if (!classId) { setStudents([]); setWorks([]); setWork(null); return; }
    fetch(`${API}/classes/${classId}/students`).then((r) => (r.ok ? r.json() : [])).then((d) => setStudents(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`${API}/classes/${classId}/works${kq}`).then((r) => (r.ok ? r.json() : [])).then((d) => { const l = Array.isArray(d) ? d : []; setWorks(l); setWork(l[0] || null); }).catch(() => {});
  }, [classId, kursId]);

  const topicLabel = (id) => { const tp = topics.find((x) => x.id === id); if (!tp) return ""; const p = tp.parent_id ? topics.find((x) => x.id === tp.parent_id) : null; return p ? `${p.name} / ${tp.name}` : tp.name; };

  // Änderung lokal + gebündelt speichern (PUT der ganzen Arbeit).
  const persist = (next) => {
    setWork(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch(`${API}/works/${next.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: next.name, tasks: next.tasks, results: next.results }) }).catch(() => {});
    }, 600);
  };

  const neueArbeit = async () => {
    const res = await fetch(`${API}/works`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ class_id: classId, kurs_id: kursId, name: t("klassenarbeit.newName") }) }).catch(() => null);
    if (res && res.ok) { const w = await res.json(); setWorks((p) => [w, ...p]); setWork(w); }
  };
  const loeschen = async () => {
    if (!work || !(await askConfirm(t("klassenarbeit.delConfirm", { name: work.name })))) return;
    await fetch(`${API}/works/${work.id}`, { method: "DELETE" }).catch(() => {});
    setWorks((p) => p.filter((x) => x.id !== work.id)); setWork(null);
  };

  const addTask = () => persist({ ...work, tasks: [...(work.tasks || []), { id: newId(), label: "", topic_id: null }] });
  const setTask = (id, patch) => persist({ ...work, tasks: work.tasks.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const delTask = (id) => persist({ ...work, tasks: work.tasks.filter((x) => x.id !== id), results: Object.fromEntries(Object.entries(work.results || {}).map(([s, arr]) => [s, (arr || []).filter((tid) => tid !== id)])) });
  const wrongOf = (sid) => new Set((work.results || {})[String(sid)] || []);
  const toggleCell = (taskId, sid) => {
    const cur = wrongOf(sid); cur.has(taskId) ? cur.delete(taskId) : cur.add(taskId);
    persist({ ...work, results: { ...(work.results || {}), [String(sid)]: [...cur] } });
  };

  // Auswertung LIVE aus dem Raster (kein Button, kein Server-Call): je Thema die
  // Trefferquote der Klasse + je SuS die schwachen Themen (≥ 50 % falsch).
  const analyse = useMemo(() => {
    if (!work) return null;
    const topicTasks = {};
    (work.tasks || []).forEach((tk) => { if (tk.topic_id) (topicTasks[tk.topic_id] ||= []).push(tk.id); });
    const wrong = (sid) => new Set((work.results || {})[String(sid)] || []);
    const topicsOut = Object.entries(topicTasks).map(([tid, tids]) => {
      let f = 0, tot = 0;
      students.forEach((s) => { const w = wrong(s.id); tids.forEach((id) => { tot++; if (w.has(id)) f++; }); });
      return { topic_id: Number(tid), label: topicLabel(Number(tid)), pct: tot ? Math.round((1 - f / tot) * 100) : 0 };
    }).sort((a, b) => a.pct - b.pct);
    const studentsOut = students.map((s) => {
      const w = wrong(s.id);
      const weak = Object.entries(topicTasks).filter(([, tids]) => { const f = tids.filter((id) => w.has(id)).length; return tids.length && f / tids.length >= 0.5; }).map(([tid]) => topicLabel(Number(tid)));
      return weak.length ? { student_id: s.id, name: s.name, weak } : null;
    }).filter(Boolean);
    return { topics: topicsOut, students: studentsOut };
  }, [work, students, topics]);
  const wiederholen = async () => {
    if (!work) return;
    setBusy(true);
    const res = await fetch(`${API}/works/${work.id}/remediate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threshold: 0.5, cards: kartenAktiv, exercises: lernpfadAktiv }) }).catch(() => null);
    setBusy(false);
    if (res && res.ok) { const j = await res.json(); showAlert(t("klassenarbeit.remediateDone", { students: j.students, cards: j.cards_requeued, exercises: j.exercises_created || 0 })); }
    else showAlert(t("common.notWork"));
  };

  const th = { padding: "6px 8px", borderBottom: "2px solid var(--border)", fontSize: 11.5, color: "var(--text2)", fontWeight: 600 };
  const td = { padding: 0, borderBottom: "1px solid var(--border)", textAlign: "center" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <h1 style={{ ...pageTitle, marginBottom: 0 }}>{t("klassenarbeit.title")}</h1>
        <KursKlasseSelect value={classId} onChange={(id, kid) => { setClassId(id); setKursId(kid); }} onKurs={setKursId} />
      </div>
      <p style={{ fontSize: 13, color: "var(--text3)", margin: "0 0 16px" }}>{t("klassenarbeit.hint")}</p>

      {!classId ? null : (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <select value={work?.id || ""} onChange={(e) => setWork(works.find((w) => String(w.id) === e.target.value) || null)} style={{ ...selectStyle, minWidth: 180 }}>
            {works.length === 0 && <option value="">{t("klassenarbeit.none")}</option>}
            {works.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <button onClick={neueArbeit} style={btnSecondary}>{t("klassenarbeit.new")}</button>
          {work && <button onClick={loeschen} className="icon-btn" style={iconBtn} title={t("common.delete")}><Icon d={ICONS.trash} color={C.danger} /></button>}
        </div>
      )}

      {classId && work && students.length > 0 && (
        <>
          {/* Name sofort auch im Auswahl-Dropdown zeigen (nicht erst nach Reload). */}
          <input value={work.name} onChange={(e) => { const name = e.target.value; persist({ ...work, name }); setWorks((ws) => ws.map((x) => (x.id === work.id ? { ...x, name } : x))); }} placeholder={t("klassenarbeit.newName")}
            style={{ ...inputStyle, fontSize: 16, fontWeight: 600, marginBottom: 12, maxWidth: 360 }} />

          <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 12 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left", minWidth: 150, position: "sticky", left: 0, background: "var(--card)" }}>{t("klassenarbeit.task")}</th>
                  <th style={{ ...th, textAlign: "left", minWidth: 130 }}>{t("klassenarbeit.topic")}</th>
                  {students.map((s) => <th key={s.id} style={{ ...th, minWidth: 30, maxWidth: 34, writingMode: "vertical-rl", transform: "rotate(180deg)", whiteSpace: "nowrap", height: 90 }} title={s.name}>{s.name}</th>)}
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {(work.tasks || []).map((task, i) => (
                  <tr key={task.id}>
                    <td style={{ ...td, textAlign: "left", position: "sticky", left: 0, background: "var(--card)" }}>
                      <input value={task.label} onChange={(e) => setTask(task.id, { label: e.target.value })} placeholder={`${i + 1}.`} style={{ ...inputStyle, fontSize: 12.5, padding: "6px 8px", width: 140, border: "none", background: "transparent" }} />
                    </td>
                    <td style={{ ...td, textAlign: "left" }}>
                      <select value={task.topic_id || ""} onChange={(e) => setTask(task.id, { topic_id: e.target.value ? Number(e.target.value) : null })} style={{ ...selectStyle, fontSize: 12, padding: "6px 8px", minWidth: 120, border: "none", background: "transparent" }}>
                        <option value="">{t("klassenarbeit.topicNone")}</option>
                        {topics.map((tp) => <option key={tp.id} value={tp.id}>{topicLabel(tp.id)}</option>)}
                      </select>
                    </td>
                    {students.map((s) => {
                      const falsch = wrongOf(s.id).has(task.id);
                      return (
                        <td key={s.id} style={td}>
                          <button onClick={() => toggleCell(task.id, s.id)} title={falsch ? t("klassenarbeit.wrong") : t("klassenarbeit.right")}
                            style={{ width: 30, height: 30, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, background: "transparent", color: falsch ? "#d1350f" : "#0a7d3e" }}>
                            {falsch ? "✗" : "✓"}
                          </button>
                        </td>
                      );
                    })}
                    <td style={td}><button onClick={() => delTask(task.id)} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("common.delete")}><Icon d={ICONS.trash} size={14} color={C.danger} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={addTask} style={{ ...btnSecondary, marginTop: 10 }}>+ {t("klassenarbeit.addTask")}</button>

          <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
            {notenAktiv && (work.tasks || []).length > 0 && <button onClick={() => setNotenModal(true)} style={btnPrimary}>{t("klassenarbeit.toNoten")}</button>}
            {(kartenAktiv || lernpfadAktiv) && <button onClick={wiederholen} disabled={busy} style={{ ...btnSecondary, opacity: busy ? 0.6 : 1 }}>💡 {t("klassenarbeit.remediate")}</button>}
          </div>
          {notenModal && <NotenUebernahme t={t} classId={classId} kursId={kursId} students={students} work={work} onClose={() => setNotenModal(false)} />}

          {analyse && (analyse.topics.length > 0 || analyse.students.length > 0) && (
            <div style={{ marginTop: 18, border: "1px solid var(--border)", borderRadius: 12, padding: 16, background: "var(--card)" }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{t("klassenarbeit.byTopic")}</div>
              {analyse.topics.length === 0 ? <p style={{ fontSize: 12.5, color: "var(--text3)" }}>{t("klassenarbeit.noTopics")}</p> : analyse.topics.map((tp) => (
                <div key={tp.topic_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
                  <span style={{ flex: 1, fontSize: 13 }}>{tp.label}</span>
                  <span style={{ width: 120, height: 8, background: "var(--bg2)", borderRadius: 4, overflow: "hidden" }}><span style={{ display: "block", width: `${tp.pct}%`, height: "100%", background: tp.pct < 50 ? "#d1350f" : tp.pct < 75 ? "#b8860b" : "#0a7d3e" }} /></span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, minWidth: 38, textAlign: "right" }}>{tp.pct}%</span>
                </div>
              ))}
              {analyse.students.length > 0 && (<>
                <div style={{ fontSize: 14, fontWeight: 700, margin: "16px 0 8px" }}>{t("klassenarbeit.weakStudents")}</div>
                {analyse.students.map((s) => (
                  <div key={s.student_id} style={{ fontSize: 13, padding: "3px 0" }}><b>{s.name}:</b> <span style={{ color: "#d1350f" }}>{s.weak.join(", ")}</span></div>
                ))}
              </>)}
            </div>
          )}
        </>
      )}
      {classId && !work && <Empty title={t("klassenarbeit.empty")} hint={t("klassenarbeit.emptyHint")} action={t("klassenarbeit.new")} onAction={neueArbeit} />}
      {classId && work && students.length === 0 && <Empty title={t("klassenarbeit.noStudents")} />}
    </div>
  );
}

// In Noten übernehmen: aus der Trefferquote (richtige/gesamt) je SuS eine Note
// über die Notenskala der Lehrkraft, als neue Spalte im gewählten Abschnitt.
// Nur SuS mit mind. einer markierten falschen Aufgabe ODER allen richtig — die
// Spalte ist frei editierbar (Abwesende später herausnehmen).
function NotenUebernahme({ t, classId, kursId, students, work, onClose }) {
  const [sections, setSections] = useState(null);
  const [sectionId, setSectionId] = useState("");
  const [name, setName] = useState(work.name || t("klassenarbeit.newName"));
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const kq = `?term=all${kursId != null ? `&kurs_id=${kursId}` : ""}`;
  useEffect(() => {
    fetch(`/api/noten/classes/${classId}/sections${kq}`).then((r) => (r.ok ? r.json() : [])).then((d) => { const l = Array.isArray(d) ? d : []; setSections(l); if (l[0]) setSectionId(String(l[0].id)); }).catch(() => setSections([]));
    try { const u = JSON.parse(localStorage.getItem("user")); if (u?.grade_scale) setScale(u.grade_scale); } catch { /* Default */ }
  }, []);
  const total = (work.tasks || []).length;
  const grades = students.map((s) => {
    const wrong = ((work.results || {})[String(s.id)] || []).length;
    return { student_id: s.id, value: gradeFromPct(((total - wrong) / total) * 100, scale) };
  }).filter((g) => g.value >= 1 && g.value <= 6);
  const secLabel = (s) => `${s.term === "2" ? "2. Hj · " : "1. Hj · "}${s.name}`;
  const submit = async () => {
    if (!sectionId) { setErr(t("karten.masteryNoSection")); return; }
    setBusy(true); setErr("");
    const res = await fetch("/api/noten/import-grades", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ class_id: classId, kurs_id: kursId, section_id: Number(sectionId), column_name: name.trim(), note: t("klassenarbeit.title"), source_kind: "klassenarbeit", grades }) }).catch(() => null);
    setBusy(false);
    if (res && res.ok) onClose();
    else { const b = res ? await res.json().catch(() => ({})) : {}; setErr(typeof b.detail === "string" ? b.detail : t("common.notWork")); }
  };
  const lbl = { fontSize: 12.5, color: "var(--text2)", margin: "12px 0 5px" };
  return (
    <div onClick={onClose} style={modalOverlay}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modalPanel, maxWidth: 440 }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{t("klassenarbeit.toNoten")}</h3>
        <p style={{ fontSize: 12.5, color: "var(--text3)", margin: "0 0 12px" }}>{t("klassenarbeit.toNotenHint", { n: grades.length })}</p>
        {sections && sections.length === 0 ? (
          <p style={{ fontSize: 13, color: "#d1350f" }}>{t("karten.masteryNoSection")}</p>
        ) : (<>
          <div style={{ ...lbl, marginTop: 0 }}>{t("karten.masterySection")}</div>
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={{ ...selectStyle, width: "100%" }}>
            {(sections || []).map((s) => <option key={s.id} value={s.id}>{secLabel(s)}</option>)}
          </select>
          <div style={lbl}>{t("noten.columnName")}</div>
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, width: "100%" }} />
        </>)}
        {err && <p style={{ color: "#d1350f", fontSize: 12.5, marginTop: 10 }}>{err}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button onClick={submit} disabled={busy || grades.length === 0 || (sections && sections.length === 0)} style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }}>{t("common.save")}</button>
          <button onClick={onClose} style={btnSecondary}>{t("common.abort")}</button>
        </div>
      </div>
    </div>
  );
}
