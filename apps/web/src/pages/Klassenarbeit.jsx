// Modul „Klassenarbeit auswerten": eine Arbeit als Raster — Zeilen = Aufgaben
// (Label + Thema), Spalten = SuS, Zelle = richtig/falsch. Daraus je SuS ein
// Fehlerprofil nach Thema und auf Knopfdruck gezielte Wiederholung (Karten des
// schwachen Themas wieder fällig).
import { useState, useEffect, useRef } from "react";
import { pageTitle, btnPrimary, btnSecondary, selectStyle, inputStyle, Icon, ICONS, iconBtn, COLORS as C, Empty } from "../components/Icons.jsx";
import KursKlasseSelect from "../components/KursKlasseSelect.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { useModules } from "../core/modules.js";
import { askConfirm, showAlert } from "../core/dialog.jsx";
import { lastClass, rememberClass } from "../core/cache.js";

const API = "/api/klassenarbeit";
const newId = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export default function Klassenarbeit() {
  const { t } = useLanguage();
  const { modules } = useModules();
  const kartenAktiv = modules.find((m) => m.key === "karten")?.active ?? false;
  const lernpfadAktiv = modules.find((m) => m.key === "lernpfad")?.active ?? false;
  const [classId, setClassId] = useState(null);
  const [kursId, setKursId] = useState(null);
  const [students, setStudents] = useState([]);
  const [topics, setTopics] = useState([]);
  const [works, setWorks] = useState([]);
  const [work, setWork] = useState(null); // { id, name, tasks:[{id,label,topic_id}], results:{sid:[taskId]} }
  const [analysis, setAnalysis] = useState(null);
  const [busy, setBusy] = useState(false);
  const kq = kursId != null ? `?kurs_id=${kursId}` : "";
  const saveTimer = useRef(null);

  useEffect(() => { fetch("/api/topics").then((r) => (r.ok ? r.json() : [])).then((d) => setTopics(Array.isArray(d) ? d : [])).catch(() => {}); }, []);
  useEffect(() => {
    if (classId) rememberClass(classId);
    if (!classId) { setStudents([]); setWorks([]); setWork(null); return; }
    fetch(`${API}/classes/${classId}/students`).then((r) => (r.ok ? r.json() : [])).then((d) => setStudents(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`${API}/classes/${classId}/works${kq}`).then((r) => (r.ok ? r.json() : [])).then((d) => { const l = Array.isArray(d) ? d : []; setWorks(l); setWork(l[0] || null); }).catch(() => {});
  }, [classId, kursId]);

  const topicLabel = (id) => { const tp = topics.find((x) => x.id === id); if (!tp) return ""; const p = tp.parent_id ? topics.find((x) => x.id === tp.parent_id) : null; return p ? `${p.name} / ${tp.name}` : tp.name; };

  // Änderung lokal + gebündelt speichern (PUT der ganzen Arbeit).
  const persist = (next) => {
    setWork(next); setAnalysis(null);
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

  const auswerten = () => { if (work) fetch(`${API}/works/${work.id}/analysis`).then((r) => (r.ok ? r.json() : null)).then(setAnalysis).catch(() => {}); };
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
          <input value={work.name} onChange={(e) => persist({ ...work, name: e.target.value })} placeholder={t("klassenarbeit.newName")}
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
                    <td style={td}><button onClick={() => delTask(task.id)} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("common.delete")}><Icon d={ICONS.trash} size={13} color="var(--text3)" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={addTask} style={{ ...btnSecondary, marginTop: 10 }}>+ {t("klassenarbeit.addTask")}</button>

          <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
            <button onClick={auswerten} style={btnPrimary}>{t("klassenarbeit.evaluate")}</button>
            {(kartenAktiv || lernpfadAktiv) && <button onClick={wiederholen} disabled={busy} style={{ ...btnSecondary, opacity: busy ? 0.6 : 1 }}>💡 {t("klassenarbeit.remediate")}</button>}
          </div>

          {analysis && (
            <div style={{ marginTop: 18, border: "1px solid var(--border)", borderRadius: 12, padding: 16, background: "var(--card)" }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{t("klassenarbeit.byTopic")}</div>
              {analysis.topics.length === 0 ? <p style={{ fontSize: 12.5, color: "var(--text3)" }}>{t("klassenarbeit.noTopics")}</p> : analysis.topics.map((tp) => (
                <div key={tp.topic_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
                  <span style={{ flex: 1, fontSize: 13 }}>{tp.label}</span>
                  <span style={{ width: 120, height: 8, background: "var(--bg2)", borderRadius: 4, overflow: "hidden" }}><span style={{ display: "block", width: `${tp.pct}%`, height: "100%", background: tp.pct < 50 ? "#d1350f" : tp.pct < 75 ? "#b8860b" : "#0a7d3e" }} /></span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, minWidth: 38, textAlign: "right" }}>{tp.pct}%</span>
                </div>
              ))}
              {analysis.students.length > 0 && (<>
                <div style={{ fontSize: 14, fontWeight: 700, margin: "16px 0 8px" }}>{t("klassenarbeit.weakStudents")}</div>
                {analysis.students.map((s) => (
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
