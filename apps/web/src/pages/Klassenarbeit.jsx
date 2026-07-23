// Modul „Klassenarbeit auswerten": Aufgaben mit Thema + Maximalpunkten, dann ein
// Punkte-Raster (Zeilen = SuS, Spalten = Aufgaben, Zelle = erreichte Punkte).
// Daraus LIVE je SuS ein Fehlerprofil nach Thema, eine Note (Punkte/Max → Skala)
// und gezielte Wiederholung (Karten des schwachen Themas wieder fällig).
import { useState, useEffect, useRef, useMemo } from "react";
import { pageTitle, btnPrimary, btnSecondary, selectStyle, inputStyle, Icon, ICONS, iconBtn, COLORS as C, Empty, modalOverlay, modalPanel, Boxplot, StatCard } from "../components/Icons.jsx";
import KursKlasseSelect from "../components/KursKlasseSelect.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { useModules } from "../core/modules.js";
import { askConfirm, showAlert } from "../core/dialog.jsx";
import { lastClass, rememberClass } from "../core/cache.js";
import { gradeFromPct, gradeDetailed, quantile, stdev, DEFAULT_SCALE } from "../core/grades.js";

const API = "/api/klassenarbeit";
const newId = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Eine Zeile „je Aufgabe/Teilaufgabe": Label, Ø-Punkte, farbige %-Zahl, Balken
// auf eigener Zeile und (optional) Trennschärfe + 95%-KI darunter. Gemeinsam für
// „je Aufgabe" und „je Teilaufgabe", damit beide gleich aussehen.
function StatRow({ row, t, expandable, open, onToggle, small }) {
  const col = row.pct < 50 ? C.danger : row.pct < 75 ? C.warning : C.success;
  const dc = row.disc == null ? "var(--text3)" : row.disc >= 0.4 ? C.success : row.disc >= 0.2 ? C.warning : C.danger;
  return (
    <div onClick={expandable ? onToggle : undefined} style={{ padding: small ? "6px 9px" : "8px 10px", borderRadius: 8, background: small ? "var(--bg3)" : "var(--bg2)", marginBottom: 5, cursor: expandable ? "pointer" : "default" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {expandable && <span style={{ display: "inline-flex", color: "var(--text3)", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}><Icon d={ICONS.open} size={12} /></span>}
        <span style={{ flex: 1, fontSize: small ? 12.5 : 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: small ? "var(--text2)" : "var(--text)" }}>{small ? `${t("klassenarbeit.part")} ${row.label}` : row.label}</span>
        <span style={{ fontSize: 11.5, color: "var(--text3)", whiteSpace: "nowrap" }}>⌀ {String(row.avgP).replace(".", ",")}/{row.max}</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: col, minWidth: 40, textAlign: "right" }}>{row.pct}%</span>
      </div>
      <div style={{ marginTop: 5, height: 8, background: "var(--card)", borderRadius: 5, overflow: "hidden" }}>
        <span style={{ display: "block", width: `${row.pct}%`, height: "100%", background: col, borderRadius: 5 }} />
      </div>
      {(row.disc != null || row.ciLow != null) && (
        <div style={{ display: "flex", gap: 14, fontSize: 11, color: "var(--text3)", marginTop: 5 }}>
          {row.disc != null && <span title={t("klassenarbeit.discHint")}>{t("klassenarbeit.disc")}: <b style={{ color: dc }}>{row.disc.toFixed(2).replace(".", ",")}</b></span>}
          {row.ciLow != null && <span title={t("klassenarbeit.ciHint")}>{t("klassenarbeit.ci")}: <b style={{ color: "var(--text2)" }}>{row.ciLow}–{row.ciHigh}%</b></span>}
        </div>
      )}
    </div>
  );
}

export default function Klassenarbeit() {
  const { t } = useLanguage();
  const { modules } = useModules();
  const kartenAktiv = modules.find((m) => m.key === "karten")?.active ?? false;
  const lernpfadAktiv = modules.find((m) => m.key === "lernpfad")?.active ?? false;
  const notenAktiv = modules.find((m) => m.key === "noten")?.active ?? false;
  const [notenModal, setNotenModal] = useState(false);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  useEffect(() => { try { const u = JSON.parse(localStorage.getItem("user")); if (u?.grade_scale) setScale(u.grade_scale); } catch { /* Default */ } }, []);
  const [hideIndividual, setHideIndividual] = useState(false); // #55: SuS-Ansicht — einzelne Leistungen + Noten aus
  const [scaleOpen, setScaleOpen] = useState(false); // Notenschlüssel-Editor auf/zu
  const [expandedTasks, setExpandedTasks] = useState(() => new Set()); // aufgeklappte Teilaufgaben-Auswertung
  const [infoOpen, setInfoOpen] = useState(false); // „Auswertung verstehen"
  const [distMode, setDistMode] = useState("bar");   // Notenverteilung: "bar" | "box"
  const [barMode, setBarMode] = useState("whole");   // Balken: "whole" (1..6) | "fine" (Teilnoten)
  const [boxMode, setBoxMode] = useState("pct");     // Boxplot: "pct" (%) | "note" (Noten)
  // Note-Anzeige aus der Profil-Präferenz vorbelegen (Tendenz 2+ vs. Notenwert).
  const [gradeMode, setGradeMode] = useState("note"); // "note" (2+) | "wert" (2,3)
  useEffect(() => { try { const u = JSON.parse(localStorage.getItem("user")); if (u && u.grade_tendency === false) setGradeMode("wert"); } catch { /* Default */ } }, []);
  const [classId, setClassId] = useState(null);
  const [kursId, setKursId] = useState(null);
  const [subsetKurs, setSubsetKurs] = useState(null); // gewählter Teilkurs (Kurs aus Teilen von Klassen) oder null
  const [subsetKurse, setSubsetKurse] = useState([]); // Kurse mit einzeln hinzugefügten SuS
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [topics, setTopics] = useState([]);
  const [works, setWorks] = useState([]);
  const [work, setWork] = useState(null); // { id, name, tasks:[{id,label,topic_id}], results:{sid:[taskId]} }
  const [busy, setBusy] = useState(false);
  const kq = kursId != null ? `?kurs_id=${kursId}` : "";
  const saveTimer = useRef(null);

  useEffect(() => { fetch("/api/topics").then((r) => (r.ok ? r.json() : [])).then((d) => setTopics(Array.isArray(d) ? d : [])).catch(() => {}); }, []);
  // Teilkurse (Kurse aus Teilen von Klassen = einzeln hinzugefügte SuS) laden.
  useEffect(() => { fetch("/api/kurse").then((r) => (r.ok ? r.json() : [])).then((d) => setSubsetKurse((Array.isArray(d) ? d : []).filter((k) => k.member_count > 0))).catch(() => {}); }, []);
  // Beim ersten Besuch gleich eine Klasse wählen (zuletzt genutzte, sonst erste),
  // damit die Arbeitsauswahl nicht ausgeblendet bleibt, bis man von Hand klickt.
  useEffect(() => {
    fetch("/api/classes").then((r) => (r.ok ? r.json() : [])).then((list) => {
      const l = Array.isArray(list) ? list : []; setClasses(l);
      if (classId == null && l.length) { const w = lastClass(); setClassId(l.some((c) => c.id === w) ? w : l[0].id); }
    }).catch(() => {});
  }, []); // eslint-disable-line
  const repClass = useRef(null); // Referenz-Klasse eines Teilkurses (für work.class_id, FK)
  useEffect(() => {
    // Teilkurs (Kurs aus Teilen von Klassen): Roster + Arbeiten über den Kurs.
    if (subsetKurs) {
      fetch(`${API}/kurse/${subsetKurs}/students`).then((r) => (r.ok ? r.json() : [])).then((list) => {
        const studs = Array.isArray(list) ? list : []; setStudents(studs);
        const rep = studs[0]?.class_id || null; repClass.current = rep;
        if (rep) fetch(`${API}/classes/${rep}/works?kurs_id=${subsetKurs}`).then((r) => (r.ok ? r.json() : [])).then((d) => { const l = Array.isArray(d) ? d : []; setWorks(l); setWork(l[0] || null); }).catch(() => {});
        else { setWorks([]); setWork(null); }
      }).catch(() => { setStudents([]); setWorks([]); setWork(null); });
      return;
    }
    repClass.current = null;
    if (classId) rememberClass(classId);
    if (!classId) { setStudents([]); setWorks([]); setWork(null); return; }
    fetch(`${API}/classes/${classId}/students`).then((r) => (r.ok ? r.json() : [])).then((d) => setStudents(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`${API}/classes/${classId}/works${kq}`).then((r) => (r.ok ? r.json() : [])).then((d) => { const l = Array.isArray(d) ? d : []; setWorks(l); setWork(l[0] || null); }).catch(() => {});
  }, [classId, kursId, subsetKurs]);

  const topicLabel = (id) => { const tp = topics.find((x) => x.id === id); if (!tp) return ""; const p = tp.parent_id ? topics.find((x) => x.id === tp.parent_id) : null; return p ? `${p.name} / ${tp.name}` : tp.name; };

  // Änderung lokal + gebündelt speichern (PUT der ganzen Arbeit).
  const persist = (next) => {
    setWork(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      // scale: echtes dict = Override, sonst {} (Server setzt zurueck auf Profil).
      const scaleOut = (next.scale && Object.keys(next.scale).length) ? next.scale : {};
      fetch(`${API}/works/${next.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: next.name, tasks: next.tasks, results: next.results, scale: scaleOut, absent: next.absent || [] }) }).catch(() => {});
    }, 600);
  };

  const neueArbeit = async () => {
    // Teilkurs: class_id = Referenz-Klasse (FK), kurs_id = Teilkurs (Roster kommt daraus).
    const cid = subsetKurs ? repClass.current : classId;
    const kid = subsetKurs || kursId;
    if (!cid) return;
    const res = await fetch(`${API}/works`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ class_id: cid, kurs_id: kid, name: t("klassenarbeit.newName") }) }).catch(() => null);
    if (res && res.ok) { const w = await res.json(); setWorks((p) => [w, ...p]); setWork(w); }
  };
  const loeschen = async () => {
    if (!work || !(await askConfirm(t("klassenarbeit.delConfirm", { name: work.name })))) return;
    await fetch(`${API}/works/${work.id}`, { method: "DELETE" }).catch(() => {});
    setWorks((p) => p.filter((x) => x.id !== work.id)); setWork(null);
  };

  // Ein „Teil" (Teilaufgabe a/b/c…) ist die kleinste Wertungseinheit. Hat eine
  // Aufgabe keine Teile, gilt sie selbst als eine Einheit (id + max) — so bleibt
  // das alte Format (Aufgabe ohne Teile) unverändert gültig.
  const units = (task) => (task.parts && task.parts.length) ? task.parts : [{ id: task.id, label: "", max: Number(task.max) > 0 ? Number(task.max) : 1 }];
  const unitMax = (u) => (Number(u.max) > 0 ? Number(u.max) : 1);
  const taskMax = (task) => units(task).reduce((n, u) => n + unitMax(u), 0);
  const partLabel = (i) => String.fromCharCode(97 + i); // a, b, c …
  const cleanResults = (results, removeIds) => Object.fromEntries(
    Object.entries(results || {})
      .map(([s, m]) => (m === "abwesend" ? [s, m] : [s, Object.fromEntries(Object.entries(m || {}).filter(([k]) => !removeIds.has(String(k))))]))
      .filter(([, m]) => m === "abwesend" || Object.keys(m).length));

  const addTask = () => persist({ ...work, tasks: [...(work.tasks || []), { id: newId(), label: "", topic_id: null, max: 1, parts: [] }] });
  const setTask = (id, patch) => persist({ ...work, tasks: work.tasks.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const delTask = (id) => {
    const tk = (work.tasks || []).find((x) => x.id === id);
    const ids = new Set(tk ? units(tk).map((u) => String(u.id)) : [String(id)]);
    persist({ ...work, tasks: work.tasks.filter((x) => x.id !== id), results: cleanResults(work.results, ids) });
  };
  // Teilaufgaben: eine erste Teilaufgabe erbt id+max der Aufgabe (Punkte bleiben).
  const addPart = (tid) => {
    const tk = work.tasks.find((x) => x.id === tid); if (!tk) return;
    const parts = (tk.parts && tk.parts.length) ? [...tk.parts] : [{ id: tk.id, label: "a", max: Number(tk.max) > 0 ? Number(tk.max) : 1 }];
    parts.push({ id: newId(), label: partLabel(parts.length), max: 1 });
    setTask(tid, { parts });
  };
  const setPart = (tid, pid, patch) => {
    const tk = work.tasks.find((x) => x.id === tid); if (!tk) return;
    setTask(tid, { parts: units(tk).map((u) => (u.id === pid ? { ...u, ...patch } : u)) });
  };
  const delPart = (tid, pid) => {
    const tk = work.tasks.find((x) => x.id === tid); if (!tk) return;
    const parts = units(tk).filter((u) => u.id !== pid);
    const results = cleanResults(work.results, new Set([String(pid)]));
    // Bleibt nur ein Teil übrig: zurück zur „ohne Teile"-Form (Max an der Aufgabe).
    if (parts.length <= 1) { const only = parts[0]; persist({ ...work, tasks: work.tasks.map((x) => (x.id === tid ? { ...x, parts: [], max: only ? unitMax(only) : 1 } : x)), results }); }
    else persist({ ...work, tasks: work.tasks.map((x) => (x.id === tid ? { ...x, parts } : x)), results });
  };
  const maxOf = (task) => taskMax(task);
  const pointsOf = (sid, uid) => { const v = ((work.results || {})[String(sid)] || {})[uid]; return v == null ? "" : v; };
  const setPoints = (sid, uid, val) => {
    const row = { ...((work.results || {})[String(sid)] || {}) };
    if (val === "" || val == null) delete row[uid]; else row[uid] = Math.max(0, Number(val));
    const results = { ...(work.results || {}) };
    if (Object.keys(row).length) results[String(sid)] = row; else delete results[String(sid)];
    persist({ ...work, results });
  };
  const totalMax = () => (work.tasks || []).reduce((n, tk) => n + taskMax(tk), 0);
  const sumOf = (sid) => { const r = (work.results || {})[String(sid)]; if (!r || r === "abwesend") return 0; return (work.tasks || []).reduce((n, tk) => n + units(tk).reduce((m, u) => { const v = r[u.id]; return m + (v == null ? 0 : Number(v)); }, 0), 0); };
  // Abwesend ist ein eigenes Feld (work.absent) — die Punkte in results bleiben
  // erhalten, „abwesend" heisst nur „aus der Klassenstatistik raus". Alt-Marker
  // (results[sid] === "abwesend", ohne Punkte) wird weiter als abwesend erkannt.
  const isAbsent = (sid) => ((work.absent || []).map(String).includes(String(sid))) || (work.results || {})[String(sid)] === "abwesend";
  const toggleAbsent = (sid) => {
    const key = String(sid);
    const cur = new Set((work.absent || []).map(String));
    const results = { ...(work.results || {}) };
    const wasLegacy = results[key] === "abwesend";
    if (wasLegacy) delete results[key];                 // alten Marker aufloesen
    if (cur.has(key) || wasLegacy) cur.delete(key); else cur.add(key);
    persist({ ...work, results, absent: [...cur] });
  };

  // Gültiger Notenschlüssel: Override der Arbeit, sonst Profil-Voreinstellung.
  const effScale = (work && work.scale && Object.keys(work.scale).length) ? work.scale : scale;
  const setWorkScale = (next) => persist({ ...work, scale: next });

  // Auswertung LIVE aus dem Raster (kein Button, kein Server-Call): je Thema die
  // Trefferquote der Klasse + je SuS die schwachen Themen (≥ 50 % falsch).
  const analyse = useMemo(() => {
    if (!work) return null;
    const tasks = work.tasks || [];
    const results = work.results || {};
    const uMax = {}; tasks.forEach((tk) => units(tk).forEach((u) => { uMax[u.id] = unitMax(u); }));
    const topicTasks = {}; tasks.forEach((tk) => { if (tk.topic_id) (topicTasks[tk.topic_id] ||= []).push(tk); });
    const pu = (sid, uid) => { const r = results[String(sid)]; if (!r || r === "abwesend") return 0; const v = r[uid]; return v == null ? 0 : Number(v); };
    const pt = (sid, tk) => units(tk).reduce((n, u) => n + pu(sid, u.id), 0);      // Punkte einer Aufgabe
    const tkMax = (tk) => units(tk).reduce((n, u) => n + uMax[u.id], 0);
    // Zeilen ohne jeden Eintrag zählen als 0 (leere/durchgefallene Arbeit) — nur
    // „krank" (abwesend) bleibt aussen vor. Damit die Auswertung aber nicht schon
    // vor der ersten Eingabe voller Nullen steht, erst wenn irgendein Wert da ist.
    const absent = new Set([...((work.absent) || []).map(String), ...Object.entries(results).filter(([, v]) => v === "abwesend").map(([k]) => k)]);
    const hasAny = students.some((s) => { const r = results[String(s.id)]; return !absent.has(String(s.id)) && r && r !== "abwesend" && Object.keys(r).length; });
    const graded = hasAny ? students.filter((s) => !absent.has(String(s.id))) : [];
    // Gesamtpunkte je SuS (für Trennschärfe = Item-Total-Korrelation).
    const totals = graded.map((s) => tasks.reduce((n, tk) => n + pt(s.id, tk), 0));
    const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const sdOf = (arr) => { if (arr.length < 2) return 0; const m = mean(arr); return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1)); };

    const topicsOut = Object.entries(topicTasks).map(([tid, tks]) => {
      let e = 0, m = 0; graded.forEach((s) => tks.forEach((tk) => { e += pt(s.id, tk); m += tkMax(tk); }));
      return { topic_id: Number(tid), label: topicLabel(Number(tid)), pct: m ? Math.round((e / m) * 100) : 0 };
    }).sort((a, b) => a.pct - b.pct);
    const studentsOut = graded.map((s) => {
      const weak = Object.entries(topicTasks).filter(([, tks]) => { let e = 0, m = 0; tks.forEach((tk) => { e += pt(s.id, tk); m += tkMax(tk); }); return m && e / m < 0.5; }).map(([tid]) => topicLabel(Number(tid)));
      return weak.length ? { student_id: s.id, name: s.name, weak } : null;
    }).filter(Boolean);
    // je Aufgabe: Ø-Punkte (⌀/Max), Trefferquote, Trennschärfe (Item-Total-
    // Korrelation) und 95%-Konfidenzintervall der mittleren Trefferquote.
    const perTask = tasks.map((tk, i) => {
      const xs = graded.map((s) => pt(s.id, tk));
      const mx = tkMax(tk);
      const e = xs.reduce((a, b) => a + b, 0);
      const m = graded.length * mx;
      const avgP = mean(xs);
      // Trennschärfe: Korrelation Aufgabenpunkte ↔ Gesamtpunkte (−1..+1).
      let disc = null;
      if (graded.length >= 3) {
        const mxk = mean(xs), myk = mean(totals);
        let cov = 0, sx = 0, sy = 0;
        xs.forEach((x, idx) => { const dx = x - mxk, dy = totals[idx] - myk; cov += dx * dy; sx += dx * dx; sy += dy * dy; });
        disc = (sx > 0 && sy > 0) ? cov / Math.sqrt(sx * sy) : null;
      }
      // 95%-KI der mittleren Trefferquote (Prozent): Mittel ± 1,96·SE.
      let ciLow = null, ciHigh = null;
      if (graded.length >= 2 && mx > 0) {
        const pcts = xs.map((x) => (x / mx) * 100);
        const half = 1.96 * (sdOf(pcts) / Math.sqrt(pcts.length));
        ciLow = Math.max(0, Math.round(mean(pcts) - half));
        ciHigh = Math.min(100, Math.round(mean(pcts) + half));
      }
      return { id: tk.id, label: tk.label || `${i + 1}.`, pct: m ? Math.round((e / m) * 100) : 0, avgP: Math.round(avgP * 10) / 10, max: mx, disc, ciLow, ciHigh };
    });
    // Ø je Teilaufgabe (nur wo eine Aufgabe echte Teile hat) — inkl. Trennschärfe
    // (Item-Total-Korrelation) + 95%-KI, wie bei den ganzen Aufgaben.
    const perUnit = [];
    tasks.forEach((tk, i) => {
      const us = units(tk); if (us.length < 2) return;
      us.forEach((u) => {
        const xs = graded.map((s) => pu(s.id, u.id));
        const umx = uMax[u.id];
        const avgP = mean(xs);
        let disc = null;
        if (graded.length >= 3) {
          const mxk = mean(xs), myk = mean(totals);
          let cov = 0, sx = 0, sy = 0;
          xs.forEach((x, idx) => { const dx = x - mxk, dy = totals[idx] - myk; cov += dx * dy; sx += dx * dx; sy += dy * dy; });
          disc = (sx > 0 && sy > 0) ? cov / Math.sqrt(sx * sy) : null;
        }
        let ciLow = null, ciHigh = null;
        if (graded.length >= 2 && umx > 0) {
          const pcts = xs.map((x) => (x / umx) * 100);
          const half = 1.96 * (sdOf(pcts) / Math.sqrt(pcts.length));
          ciLow = Math.max(0, Math.round(mean(pcts) - half));
          ciHigh = Math.min(100, Math.round(mean(pcts) + half));
        }
        perUnit.push({ id: u.id, taskId: tk.id, label: u.label || "", avgP: Math.round(avgP * 10) / 10, max: umx, pct: umx ? Math.round((avgP / umx) * 100) : 0, disc, ciLow, ciHigh });
      });
    });

    // Endnote je SuS: Σ/Max → Note mit Tendenz + Notenwert; Verteilung + Kennzahlen.
    const tm = tasks.reduce((n, tk) => n + tkMax(tk), 0);
    const notes = graded.map((s) => { const sum = tasks.reduce((n, tk) => n + pt(s.id, tk), 0); const d = gradeDetailed(tm ? (sum / tm) * 100 : 0, effScale); return { name: s.name, note: d.note, wert: d.wert, grade: d.grade }; });
    const werte = notes.map((x) => x.wert).sort((a, b) => a - b);
    const dist = [1, 2, 3, 4, 5, 6].map((g) => notes.filter((x) => x.grade === g).length);
    // Teilnoten-Verteilung (Tendenz: 1+ 1 2+ 2 2- …) — feinere Alternative.
    const FINE = ["1+", "1", "2+", "2", "2-", "3+", "3", "3-", "4+", "4", "4-", "5+", "5", "5-", "6"];
    const distFine = FINE.map((lbl) => ({ label: lbl, grade: parseInt(lbl), count: notes.filter((x) => x.note === lbl).length }));
    const avg = werte.length ? Math.round((werte.reduce((a, b) => a + b, 0) / werte.length) * 100) / 100 : null;
    const r2 = (x) => Math.round(x * 100) / 100;
    const stats = werte.length ? { min: werte[0], q1: r2(quantile(werte, 0.25)), med: r2(quantile(werte, 0.5)), q3: r2(quantile(werte, 0.75)), max: werte[werte.length - 1], sd: r2(stdev(werte)) } : null;
    const minPts = [1, 2, 3, 4, 5].map((g) => ({ grade: g, pts: Math.ceil(((effScale[g] || 0) / 100) * tm) }));
    // Klassen-Kennzahlen wie CardVote: Ø-Prozent, Median-Prozent, 95%-KI, Anwesend.
    const pctArr = graded.map((s) => (tm ? (tasks.reduce((n, tk) => n + pt(s.id, tk), 0) / tm) * 100 : 0));
    const avgPct = pctArr.length ? Math.round(mean(pctArr)) : null;
    const medPct = pctArr.length ? Math.round(quantile([...pctArr].sort((a, b) => a - b), 0.5)) : null;
    const sdPct = pctArr.length ? Math.round(sdOf(pctArr) * 10) / 10 : null;
    let ciLow = null, ciHigh = null;
    if (pctArr.length >= 2) { const half = 1.96 * (sdOf(pctArr) / Math.sqrt(pctArr.length)); ciLow = Math.max(0, Math.round(mean(pctArr) - half)); ciHigh = Math.min(100, Math.round(mean(pctArr) + half)); }
    const present = graded.length, total = students.length;
    return { topics: topicsOut, students: studentsOut, perTask, perUnit, noten: { avg, dist, distFine, werte, n: notes.length, notes, stats, minPts, max: tm, avgPct, medPct, sdPct, ciLow, ciHigh, present, total } };
  }, [work, students, topics, scale, effScale]);
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

  const hasRoster = classId != null || subsetKurs != null;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <h1 style={{ ...pageTitle, marginBottom: 0 }}>{t("klassenarbeit.title")}</h1>
        <KursKlasseSelect value={subsetKurs ? "" : classId} onChange={(id, kid) => { setSubsetKurs(null); setClassId(id); setKursId(kid); }} onKurs={(k) => { if (!subsetKurs) setKursId(k); }} />
        {subsetKurse.length > 0 && (
          <select value={subsetKurs || ""} onChange={(e) => setSubsetKurs(e.target.value ? Number(e.target.value) : null)} style={{ ...selectStyle, fontSize: 13 }} title={t("klassenarbeit.subsetHint")}>
            <option value="">{t("klassenarbeit.subsetPick")}</option>
            {subsetKurse.map((k) => <option key={k.id} value={k.id}>{k.name} ({k.member_count})</option>)}
          </select>
        )}
      </div>

      {/* Auswahlzeile nur, wenn es schon Arbeiten gibt — sonst führt allein die
          Leerzustand-Karte zum Anlegen (kein doppeltes „keine Arbeit"). */}
      {hasRoster && works.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <select value={work?.id || ""} onChange={(e) => setWork(works.find((w) => String(w.id) === e.target.value) || null)} style={{ ...selectStyle, minWidth: 180 }}>
            {works.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <button onClick={neueArbeit} style={btnSecondary}>{t("klassenarbeit.new")}</button>
          {work && <button onClick={loeschen} className="icon-btn" style={iconBtn} title={t("common.delete")}><Icon d={ICONS.trash} color={C.danger} /></button>}
        </div>
      )}

      {hasRoster && work && students.length > 0 && (
        <>
          {/* SuS-Ansicht (Präsentation): alles über der Auswertung ausblenden —
              Aufgaben-Editor, Punkte-Raster, Aktionen. Nur die Auswertung bleibt. */}
          {!hideIndividual && (<>
          {/* Name sofort auch im Auswahl-Dropdown zeigen (nicht erst nach Reload). */}
          <input value={work.name} onChange={(e) => { const name = e.target.value; persist({ ...work, name }); setWorks((ws) => ws.map((x) => (x.id === work.id ? { ...x, name } : x))); }} placeholder={t("klassenarbeit.newName")}
            style={{ ...inputStyle, fontSize: 16, fontWeight: 600, marginBottom: 12, maxWidth: 360 }} />

          {/* 1) Aufgaben definieren: Bezeichnung + Thema + Maximalpunkte. */}
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)", margin: "4px 0 8px" }}>{t("klassenarbeit.tasksHeading")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
            {(work.tasks || []).map((task, i) => {
              const hasParts = !!(task.parts && task.parts.length);
              return (
              <div key={task.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "8px 10px", background: "var(--card)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: "var(--text3)", width: 18 }}>{i + 1}.</span>
                  <input value={task.label} onChange={(e) => setTask(task.id, { label: e.target.value })} placeholder={t("klassenarbeit.taskOptional", { n: i + 1 })} title={t("klassenarbeit.taskOptionalHint")} style={{ ...inputStyle, fontSize: 13, padding: "7px 9px", flex: 1, minWidth: 130 }} />
                  <select value={task.topic_id || ""} onChange={(e) => setTask(task.id, { topic_id: e.target.value ? Number(e.target.value) : null })} style={{ ...selectStyle, fontSize: 12.5, padding: "7px 9px", minWidth: 130 }}>
                    <option value="">{t("klassenarbeit.topicNone")}</option>
                    {topics.map((tp) => <option key={tp.id} value={tp.id}>{topicLabel(tp.id)}</option>)}
                  </select>
                  {hasParts ? (
                    <span style={{ fontSize: 12, color: "var(--text3)" }}>{t("klassenarbeit.maxPoints")}: <b>{taskMax(task)}</b></span>
                  ) : (
                    <label style={{ fontSize: 12, color: "var(--text3)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {t("klassenarbeit.maxPoints")}
                      <input type="number" min="0.5" step="0.5" value={task.max ?? 1} onChange={(e) => setTask(task.id, { max: Math.max(0.5, Number(e.target.value) || 0.5) })} style={{ ...inputStyle, fontSize: 13, padding: "6px 6px", width: 56, textAlign: "center" }} />
                    </label>
                  )}
                  <button onClick={() => addPart(task.id)} style={{ ...btnSecondary, padding: "5px 10px", fontSize: 12 }} title={t("klassenarbeit.addPartHint")}>+ {t("klassenarbeit.addPart")}</button>
                  <button onClick={() => delTask(task.id)} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("common.delete")}><Icon d={ICONS.trash} size={15} color={C.danger} /></button>
                </div>
                {hasParts && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, paddingLeft: 26 }}>
                    {units(task).map((u) => (
                      <div key={u.id} style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "var(--bg2)", borderRadius: 8, padding: "3px 6px" }}>
                        <input value={u.label} onChange={(e) => setPart(task.id, u.id, { label: e.target.value })} title={t("klassenarbeit.partLabel")} style={{ ...inputStyle, fontSize: 12, padding: "4px 4px", width: 34, textAlign: "center" }} />
                        <input type="number" min="0.5" step="0.5" value={u.max} onChange={(e) => setPart(task.id, u.id, { max: Math.max(0.5, Number(e.target.value) || 0.5) })} title={t("klassenarbeit.maxPoints")} style={{ ...inputStyle, fontSize: 12, padding: "4px 4px", width: 44, textAlign: "center" }} />
                        <button onClick={() => delPart(task.id, u.id)} className="icon-btn" style={{ ...iconBtn, padding: 2 }} title={t("common.delete")}><Icon d={ICONS.close} size={13} color={C.danger} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              );
            })}
          </div>
          <button onClick={addTask} style={{ ...btnSecondary, marginBottom: 18 }}>+ {t("klassenarbeit.addTask")}</button>

          {/* 2) Punkte-Raster: Zeilen = Schüler, Spalten = Aufgaben (0..max). */}
          {(work.tasks || []).length > 0 && (
            <div style={{ overflowX: "auto", overscrollBehaviorX: "contain", border: "1px solid var(--border)", borderRadius: 12 }}>
              <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ ...th, textAlign: "left", minWidth: 130, position: "sticky", left: 0, zIndex: 2, background: "var(--card)" }}>{t("common.name")}</th>
                    {(work.tasks || []).map((tk, i) => <th key={tk.id} colSpan={units(tk).length + (units(tk).length > 1 ? 1 : 0)} style={{ ...th, minWidth: 46, borderLeft: "1px solid var(--border)" }} title={tk.label}>{tk.label || (i + 1)}</th>)}
                    <th rowSpan={2} style={{ ...th, minWidth: 58, borderLeft: "1px solid var(--border)" }}>Σ / {totalMax()}</th>
                    {/* SuS-/Präsentationsansicht: Note oben ausblenden (nicht vor der Klasse zeigen). */}
                    {!hideIndividual && <th rowSpan={2} style={{ ...th, minWidth: 44 }}>{t("klassenarbeit.grade")}</th>}
                  </tr>
                  <tr>
                    {(work.tasks || []).flatMap((tk) => {
                      const sub = units(tk).length > 1;   // echte Teilaufgaben
                      const cols = units(tk).map((u, j) => (
                        <th key={u.id} style={{ ...th, minWidth: 44, fontWeight: 500, borderLeft: j === 0 ? "1px solid var(--border)" : undefined }}>{u.label || ""}<div style={{ fontSize: 10, color: "var(--text3)", fontWeight: 400 }}>/{unitMax(u)}</div></th>
                      ));
                      // Summe der Teilaufgaben je Aufgabe (nur wenn es Teile gibt).
                      if (sub) cols.push(<th key={tk.id + "-sum"} style={{ ...th, minWidth: 46, fontWeight: 700, background: "var(--bg2)" }}>Σ<div style={{ fontSize: 10, color: "var(--text3)", fontWeight: 400 }}>/{taskMax(tk)}</div></th>);
                      return cols;
                    })}
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => {
                    const sum = sumOf(s.id); const tm = totalMax(); const abw = isAbsent(s.id);
                    // Note auch für Abwesende zeigen (Punkte bleiben ja erhalten) — nur
                    // die Klassenstatistik unten rechnet sie raus. Anzeige umschaltbar:
                    // Tendenznote (2+) oder Notenwert in 0,3-Schritten (2,3).
                    const gd = tm ? gradeDetailed((sum / tm) * 100, effScale) : null;
                    const note = gd ? (gradeMode === "wert" ? String(gd.wert).replace(".", ",") : gd.note) : "";
                    return (
                      <tr key={s.id} style={abw ? { opacity: 0.5 } : undefined}>
                        <td style={{ ...td, textAlign: "left", padding: "4px 8px", position: "sticky", left: 0, zIndex: 1, background: "var(--card)", fontWeight: 500, whiteSpace: "nowrap" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <button onClick={() => toggleAbsent(s.id)} title={abw ? t("klassenarbeit.present") : t("klassenarbeit.absent")}
                              style={{ border: "none", background: "none", cursor: "pointer", color: abw ? C.warning : "var(--text3)", padding: 0, display: "inline-flex" }}><Icon d={abw ? ICONS.ban : ICONS.circle} size={14} /></button>
                            {s.name}
                          </span>
                        </td>
                        {(work.tasks || []).flatMap((tk) => {
                          const sub = units(tk).length > 1;
                          const cells = units(tk).map((u, j) => (
                            <td key={u.id} style={{ ...td, borderLeft: j === 0 ? "1px solid var(--border)" : undefined }}>
                              {/* Abwesende bleiben editierbar — Punkte werden nur nicht in die
                                  Klassenstatistik gerechnet, aber nicht gelöscht. */}
                              <input type="number" min="0" step="0.5" max={unitMax(u)} value={pointsOf(s.id, u.id)} onChange={(e) => setPoints(s.id, u.id, e.target.value === "" ? "" : Math.min(unitMax(u), Math.max(0, Number(e.target.value))))}
                                style={{ width: 42, height: 30, border: "none", background: "transparent", textAlign: "center", fontSize: 13, color: "var(--text)" }} />
                            </td>
                          ));
                          if (sub) { const ts = units(tk).reduce((n, u) => n + (Number(pointsOf(s.id, u.id)) || 0), 0); cells.push(<td key={tk.id + "-sum"} style={{ ...td, fontWeight: 700, background: "var(--bg2)", color: "var(--text2)" }}>{ts}</td>); }
                          return cells;
                        })}
                        <td style={{ ...td, fontWeight: 700, borderLeft: "1px solid var(--border)", color: abw ? "var(--text3)" : (tm && sum / tm < 0.5 ? C.danger : "var(--text)") }}>{`${sum}/${tm}`}{abw ? ` (${t("klassenarbeit.absentShort")})` : ""}</td>
                        {!hideIndividual && <td style={{ ...td, fontWeight: 700, color: abw ? "var(--text3)" : "var(--text)" }}>{note}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap", alignItems: "center" }}>
            {notenAktiv && (work.tasks || []).length > 0 && <button onClick={() => setNotenModal(true)} style={btnPrimary}>{t("klassenarbeit.toNoten")}</button>}
            {(kartenAktiv || lernpfadAktiv) && <button onClick={wiederholen} disabled={busy} style={{ ...btnSecondary, opacity: busy ? 0.6 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon d={ICONS.restore} size={15} /> {t("klassenarbeit.remediate")}</button>}
            {(work.tasks || []).length > 0 && (
              <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", marginLeft: "auto" }} title={t("klassenarbeit.gradeModeHint")}>
                {[["note", "2+"], ["wert", "2,3"]].map(([m, lbl]) => (
                  <button key={m} onClick={() => setGradeMode(m)} style={{ border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 700, padding: "5px 11px", background: gradeMode === m ? "var(--accent)" : "transparent", color: gradeMode === m ? "#fff" : "var(--text2)" }}>{lbl}</button>
                ))}
              </div>
            )}
            {(work.tasks || []).length > 0 && (
              <button onClick={() => setScaleOpen((v) => !v)} style={{ ...btnSecondary, display: "inline-flex", alignItems: "center", gap: 6 }}
                title={t("klassenarbeit.scaleHint")}>{t("klassenarbeit.scale")}{(work.scale && Object.keys(work.scale).length) ? " •" : ""}</button>
            )}
          </div>
          {scaleOpen && (work.tasks || []).length > 0 && (
            <div style={{ marginTop: 10, border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", background: "var(--card)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{t("klassenarbeit.scaleTitle")}</span>
                <span style={{ fontSize: 12, color: (work.scale && Object.keys(work.scale).length) ? C.warning : "var(--text3)" }}>
                  {(work.scale && Object.keys(work.scale).length) ? t("klassenarbeit.scaleOwn") : t("klassenarbeit.scaleProfile")}
                </span>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                {[1, 2, 3, 4, 5].map((g) => (
                  <label key={g} style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, color: "var(--text2)" }}>
                    <span>{t("klassenarbeit.gradeFrom", { g })}</span>
                    <input type="number" min="0" max="100" step="1" value={Math.round(effScale[g] ?? DEFAULT_SCALE[g])}
                      onChange={(e) => { const base = { ...DEFAULT_SCALE, ...effScale }; base[g] = Math.max(0, Math.min(100, Number(e.target.value) || 0)); base[6] = 0; setWorkScale(base); }}
                      style={{ ...inputStyle, width: 64, padding: "6px 8px", textAlign: "center" }} />
                  </label>
                ))}
                <span style={{ fontSize: 12, color: "var(--text3)" }}>% {t("klassenarbeit.scaleUnit")}</span>
                {(work.scale && Object.keys(work.scale).length) ? (
                  <button onClick={() => setWorkScale({})} style={{ ...btnSecondary, padding: "6px 12px", fontSize: 12.5 }}>{t("klassenarbeit.scaleReset")}</button>
                ) : null}
              </div>
            </div>
          )}
          {notenModal && <NotenUebernahme t={t} classId={subsetKurs ? repClass.current : classId} kursId={subsetKurs || kursId} students={students} work={work} scale={effScale} onClose={() => setNotenModal(false)} />}
          </>)}

          {analyse && (analyse.topics.length > 0 || analyse.students.length > 0 || analyse.perUnit.length > 0 || analyse.noten.n > 0) && (
            <div style={{ marginTop: 18, border: "1px solid var(--border)", borderRadius: 12, padding: 16, background: "var(--card)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, borderBottom: "1px solid var(--border)", paddingBottom: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 800 }}>{t("klassenarbeit.analysisTitle")}</span>
                <button onClick={() => setHideIndividual((v) => !v)} title={t("klassenarbeit.presentHint")}
                  style={{ border: "1px solid var(--border)", background: hideIndividual ? "var(--accent)" : "transparent", color: hideIndividual ? "#fff" : "var(--text2)", borderRadius: 8, padding: "5px 11px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Icon d={ICONS.eye} size={15} color={hideIndividual ? "#fff" : "var(--text2)"} /> {t("klassenarbeit.presentMode")}
                </button>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{t("klassenarbeit.byTopic")}</div>
              {analyse.topics.length === 0 ? <p style={{ fontSize: 12.5, color: "var(--text3)" }}>{t("klassenarbeit.noTopics")}</p> : analyse.topics.map((tp) => (
                <div key={tp.topic_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
                  <span style={{ flex: 1, fontSize: 13 }}>{tp.label}</span>
                  <span style={{ width: 120, height: 8, background: "var(--bg2)", borderRadius: 4, overflow: "hidden" }}><span style={{ display: "block", width: `${tp.pct}%`, height: "100%", background: tp.pct < 50 ? C.danger : tp.pct < 75 ? C.warning : C.success }} /></span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, minWidth: 38, textAlign: "right" }}>{tp.pct}%</span>
                </div>
              ))}
              {!hideIndividual && analyse.students.length > 0 && (<>
                <div style={{ fontSize: 14, fontWeight: 700, margin: "16px 0 8px" }}>{t("klassenarbeit.weakStudents")}</div>
                {analyse.students.map((s) => (
                  <div key={s.student_id} style={{ fontSize: 13, padding: "3px 0" }}><b>{s.name}:</b> <span style={{ color: C.danger }}>{s.weak.join(", ")}</span></div>
                ))}
              </>)}

              {/* je Aufgabe: Ø, Trefferquote + Trennschärfe/95%-KI. Hat eine Aufgabe
                  Teilaufgaben, lässt sich deren Auswertung darunter ausklappen. */}
              {analyse.perTask.length > 0 && (<>
                <div style={{ fontSize: 14, fontWeight: 700, margin: "16px 0 8px" }}>{t("klassenarbeit.byTask")}</div>
                {analyse.perTask.map((tk) => {
                  const parts = analyse.perUnit.filter((u) => u.taskId === tk.id);
                  const open = expandedTasks.has(tk.id);
                  const toggle = () => setExpandedTasks((prev) => { const n = new Set(prev); n.has(tk.id) ? n.delete(tk.id) : n.add(tk.id); return n; });
                  return (
                    <div key={tk.id}>
                      <StatRow row={tk} t={t} expandable={parts.length > 0} open={open} onToggle={toggle} />
                      {open && parts.length > 0 && (
                        <div style={{ marginLeft: 18, marginBottom: 5 }}>
                          {parts.map((u) => <StatRow key={u.id} row={u} t={t} small />)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>)}

              {/* Noten-Auswertung im CardVote-Design: Kennzahl-Kacheln + Panel mit
                  Notenverteilung/Boxplot-Umschalter. */}
              {analyse.noten.n > 0 && (<>
                <div style={{ fontSize: 14, fontWeight: 700, margin: "16px 0 8px" }}>{t("klassenarbeit.gradeResult")}</div>
                {/* Statistik-Kacheln (Anwesend … 95%-KI) — wie CardVote. */}
                <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                  <StatCard label={t("klassenarbeit.attendance")} value={`${analyse.noten.present} / ${analyse.noten.total}`} />
                  <StatCard label={t("klassenarbeit.avgGrade")} value={String(analyse.noten.avg).replace(".", ",")} />
                  {analyse.noten.avgPct != null && <StatCard label={t("klassenarbeit.avgPct")} value={`${analyse.noten.avgPct}%`} />}
                  {analyse.noten.medPct != null && <StatCard label={t("klassenarbeit.median")} value={`${analyse.noten.medPct}%`} />}
                  {analyse.noten.sdPct != null && <StatCard label={t("klassenarbeit.stdev")} value={`${String(analyse.noten.sdPct).replace(".", ",")}%`} />}
                  {analyse.noten.ciLow != null && <StatCard label={t("klassenarbeit.ci")} value={`${analyse.noten.ciLow}–${analyse.noten.ciHigh}%`} />}
                </div>
                {/* „Auswertung verstehen": Kennzahlen erklärt + konkrete Handlungshinweise. */}
                <button onClick={() => setInfoOpen((v) => !v)} style={{ ...btnSecondary, padding: "5px 12px", fontSize: 12.5, marginBottom: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ display: "inline-flex", transform: infoOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}><Icon d={ICONS.open} size={12} /></span>
                  {t("klassenarbeit.explain")}
                </button>
                {infoOpen && (() => {
                  const sd = analyse.noten.sdPct;
                  const sdLevel = sd == null ? null : sd < 10 ? "low" : sd <= 25 ? "mid" : "high";
                  const weak = analyse.topics.filter((tp) => tp.pct < 50).map((tp) => tp.label);
                  const lowDisc = analyse.perTask.filter((tk) => tk.disc != null && tk.disc < 0.2);
                  const Item = ({ term, children }) => (
                    <li style={{ marginBottom: 7 }}><b style={{ color: "var(--text)" }}>{term}:</b> <span style={{ color: "var(--text2)" }}>{children}</span></li>
                  );
                  return (
                    <div style={{ padding: 16, background: "var(--bg3)", borderRadius: 14, border: "1px solid var(--border)", marginBottom: 12, fontSize: 13, lineHeight: 1.55 }}>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        <Item term={t("klassenarbeit.avgGrade") + " / " + t("klassenarbeit.median")}>{t("klassenarbeit.explainAvg")}</Item>
                        {sd != null && (
                          <Item term={`${t("klassenarbeit.stdev")} (${String(sd).replace(".", ",")}%)`}>
                            {t("klassenarbeit.explainSd")} {" "}
                            <b style={{ color: sdLevel === "low" ? C.warning : sdLevel === "mid" ? C.success : C.danger }}>
                              {t(`klassenarbeit.explainSd_${sdLevel}`)}
                            </b>
                          </Item>
                        )}
                        {analyse.noten.ciLow != null && <Item term={t("klassenarbeit.ci")}>{t("klassenarbeit.explainCi")}</Item>}
                        <Item term={t("klassenarbeit.disc")}>{t("klassenarbeit.explainDisc")}</Item>
                      </ul>
                      {(weak.length > 0 || lowDisc.length > 0) && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                          <div style={{ fontWeight: 700, marginBottom: 5 }}>{t("klassenarbeit.explainActions")}</div>
                          <ul style={{ margin: 0, paddingLeft: 18 }}>
                            {weak.length > 0 && <li style={{ marginBottom: 5, color: "var(--text2)" }}>{t("klassenarbeit.explainWeak", { topics: weak.join(", ") })}</li>}
                            {lowDisc.length > 0 && <li style={{ color: "var(--text2)" }}>{t("klassenarbeit.explainLowDisc", { n: lowDisc.length })}</li>}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })()}
                {/* Verteilung / Boxplot — Panel + Pillen-Umschalter wie CardVote. */}
                <div style={{ padding: 16, background: "var(--bg3)", borderRadius: 14, border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                    {[["bar", t("klassenarbeit.distGrades")], ["box", t("klassenarbeit.distBox")]].map(([m, lbl]) => (
                      <button key={m} onClick={() => setDistMode(m)} style={{ fontSize: 13, fontWeight: 600, padding: "5px 12px", borderRadius: 980, border: "none", cursor: "pointer", background: distMode === m ? "var(--accent)" : "var(--bg2)", color: distMode === m ? "#fff" : "var(--text3)", transition: "all 0.2s" }}>{lbl}</button>
                    ))}
                    {/* Sekundär-Umschalter: Balken = Noten/Teilnoten, Boxplot = %/Noten. */}
                    <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", marginLeft: "auto" }}>
                      {(distMode === "bar"
                        ? [["whole", t("klassenarbeit.distWhole")], ["fine", t("klassenarbeit.distFine")]]
                        : [["pct", "%"], ["note", t("klassenarbeit.grade")]]
                      ).map(([m, lbl]) => {
                        const active = distMode === "bar" ? barMode === m : boxMode === m;
                        const set = distMode === "bar" ? setBarMode : setBoxMode;
                        return <button key={m} onClick={() => set(m)} style={{ border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "5px 10px", background: active ? "var(--accent)" : "transparent", color: active ? "#fff" : "var(--text2)" }}>{lbl}</button>;
                      })}
                    </div>
                  </div>
                  {distMode === "bar" ? (() => {
                    const data = barMode === "fine"
                      ? analyse.noten.distFine.map((d) => ({ count: d.count, label: d.label, grade: d.grade }))
                      : analyse.noten.dist.map((c, i) => ({ count: c, label: String(i + 1), grade: i + 1 }));
                    const mxc = Math.max(...data.map((d) => d.count), 1);
                    return (
                      <div style={{ display: "flex", alignItems: "flex-end", gap: barMode === "fine" ? 3 : 6, height: 105 }}>
                        {data.map((d, i) => (
                          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                            <div style={{ width: barMode === "fine" ? "80%" : "60%", height: `${Math.max(3, (d.count / mxc) * 75)}px`, background: d.grade <= 2 ? C.success : d.grade <= 4 ? C.warning : C.danger, borderRadius: 3 }} title={`${d.count}`} />
                            <span style={{ fontSize: 11, color: "var(--text3)" }}>{d.count}</span>
                            <span style={{ fontSize: barMode === "fine" ? 9.5 : 11, fontWeight: 700 }}>{d.label}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })() : (
                    boxMode === "note"
                      ? <Boxplot values={analyse.noten.werte} max={6} />
                      : <Boxplot values={pctList(work)} max={100} unit="%" />
                  )}
                </div>
                {/* Min-Punkte je Note entfernt — steht im Notenschlüssel. */}
              </>)}
            </div>
          )}
        </>
      )}
      {hasRoster && works.length === 0 && <Empty title={t("klassenarbeit.empty")} hint={t("klassenarbeit.emptyHint")} action={t("klassenarbeit.new")} onAction={neueArbeit} />}
      {hasRoster && work && students.length === 0 && <Empty title={t("klassenarbeit.noStudents")} />}
    </div>
  );
}

// In Noten übernehmen: aus der Trefferquote (richtige/gesamt) je SuS eine Note
// über die Notenskala der Lehrkraft, als neue Spalte im gewählten Abschnitt.
// Nur SuS mit mind. einer markierten falschen Aufgabe ODER allen richtig — die
// Spalte ist frei editierbar (Abwesende später herausnehmen).
function NotenUebernahme({ t, classId, kursId, students, work, scale = DEFAULT_SCALE, onClose }) {
  const [sections, setSections] = useState(null);
  const [sectionId, setSectionId] = useState("");
  const [name, setName] = useState(work.name || t("klassenarbeit.newName"));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const kq = `?term=all${kursId != null ? `&kurs_id=${kursId}` : ""}`;
  useEffect(() => {
    fetch(`/api/noten/classes/${classId}/sections${kq}`).then((r) => (r.ok ? r.json() : [])).then((d) => { const l = Array.isArray(d) ? d : []; setSections(l); if (l[0]) setSectionId(String(l[0].id)); }).catch(() => setSections([]));
  }, []);
  const uIds = (tk) => (tk.parts && tk.parts.length) ? tk.parts.map((u) => u.id) : [tk.id];
  const uMaxT = (tk) => (tk.parts && tk.parts.length) ? tk.parts.reduce((n, u) => n + (Number(u.max) > 0 ? Number(u.max) : 1), 0) : (Number(tk.max) > 0 ? Number(tk.max) : 1);
  const totalMax = (work.tasks || []).reduce((n, tk) => n + uMaxT(tk), 0);
  const absentU = new Set((work.absent || []).map(String));
  const grades = students
    .filter((s) => !absentU.has(String(s.id)) && (work.results || {})[String(s.id)] !== "abwesend")   // Anwesende (leer = 0); krank/abwesend raus, bekommt keine Note
    .map((s) => {
      const row = (work.results || {})[String(s.id)] || {};
      const sum = (work.tasks || []).reduce((n, tk) => n + uIds(tk).reduce((m, id) => m + (Number(row[id]) || 0), 0), 0);
      // Notenwert mit Tendenz (±0,3) — wie in der Excel-Auswertung.
      return { student_id: s.id, value: gradeDetailed(totalMax ? (sum / totalMax) * 100 : 0, scale).wert };
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
          <p style={{ fontSize: 13, color: C.danger }}>{t("karten.masteryNoSection")}</p>
        ) : (<>
          <div style={{ ...lbl, marginTop: 0 }}>{t("karten.masterySection")}</div>
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={{ ...selectStyle, width: "100%" }}>
            {(sections || []).map((s) => <option key={s.id} value={s.id}>{secLabel(s)}</option>)}
          </select>
          <div style={lbl}>{t("noten.columnName")}</div>
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, width: "100%" }} />
        </>)}
        {err && <p style={{ color: C.danger, fontSize: 12.5, marginTop: 10 }}>{err}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button onClick={submit} disabled={busy || grades.length === 0 || (sections && sections.length === 0)} style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }}>{t("common.save")}</button>
          <button onClick={onClose} style={btnSecondary}>{t("common.abort")}</button>
        </div>
      </div>
    </div>
  );
}

// ── Vergleich ────────────────────────────────────────────────────────────────
// Je Arbeit die erreichten Prozent je bewertetem (nicht abwesendem) SuS.
// Altformat (results[sid] = [falsche Aufgaben-IDs]) wird mitgerechnet.
function pctList(work) {
  const tasks = work.tasks || [];
  const uIds = (tk) => (tk.parts && tk.parts.length) ? tk.parts.map((u) => u.id) : [tk.id];
  const uMaxT = (tk) => (tk.parts && tk.parts.length) ? tk.parts.reduce((n, u) => n + (Number(u.max) > 0 ? Number(u.max) : 1), 0) : (Number(tk.max) > 0 ? Number(tk.max) : 1);
  const tm = tasks.reduce((n, tk) => n + uMaxT(tk), 0);
  if (!tm) return [];
  const absent = new Set((work.absent || []).map(String));
  const out = [];
  for (const [sid, r] of Object.entries(work.results || {})) {
    if (!r || r === "abwesend" || absent.has(String(sid))) continue;
    let e = 0;
    if (Array.isArray(r)) { const bad = new Set(r.map(String)); tasks.forEach((tk) => { if (!bad.has(String(tk.id))) e += uMaxT(tk); }); }
    else tasks.forEach((tk) => uIds(tk).forEach((id) => { const v = r[id]; e += (v == null ? 0 : Number(v)); }));
    out.push(Math.round((e / tm) * 100));
  }
  return out;
}

function quartiles(arr) {
  const a = [...arr].sort((x, y) => x - y); const n = a.length;
  if (!n) return null;
  const q = (p) => { const idx = (n - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx); return a[lo] + (a[hi] - a[lo]) * (idx - lo); };
  return { n, min: a[0], q1: q(0.25), med: q(0.5), q3: q(0.75), max: a[n - 1], avg: a.reduce((s, x) => s + x, 0) / n };
}

const boxColor = (med) => (med < 50 ? C.danger : med < 75 ? C.warning : C.success);
// Boxplot kommt zentral aus Icons.jsx (eine Quelle). Der Vergleich nutzt die
// kompakte Variante (compact) je Zeile.

export function KlassenarbeitVergleich() {
  const { t } = useLanguage();
  const [classId, setClassId] = useState(null);
  const [kursId, setKursId] = useState(null);
  const [works, setWorks] = useState([]);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  useEffect(() => { try { const u = JSON.parse(localStorage.getItem("user")); if (u?.grade_scale) setScale(u.grade_scale); } catch { /* Default */ } }, []);
  const kq = kursId != null ? `?kurs_id=${kursId}` : "";
  useEffect(() => {
    if (!classId) { setWorks([]); return; }
    fetch(`${API}/classes/${classId}/works${kq}`).then((r) => (r.ok ? r.json() : [])).then((d) => setWorks(Array.isArray(d) ? d : [])).catch(() => setWorks([]));
  }, [classId, kursId]);

  const rows = useMemo(() => works.map((w) => {
    const pl = pctList(w); const q = quartiles(pl);
    const noten = pl.map((p) => gradeFromPct(p, scale));
    const avgNote = noten.length ? noten.reduce((s, x) => s + x, 0) / noten.length : null;
    return { id: w.id, name: w.name, q, pl, avgNote };
  }).filter((r) => r.q), [works, scale]);

  const fmt = (x) => Math.round(x) + "%";
  const nt = (x) => x == null ? "–" : String(Math.round(x * 10) / 10).replace(".", ",");

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 16px 40px" }}>
      <h1 style={pageTitle}>{t("klassenarbeit.compareTitle")}</h1>
      <p style={{ fontSize: 13, color: "var(--text3)", marginTop: -4, marginBottom: 16 }}>{t("klassenarbeit.compareHint")}</p>
      <KursKlasseSelect value={classId} onChange={(id, kid) => { setClassId(id); setKursId(kid); }} onKurs={setKursId} />

      {classId && rows.length === 0 && <div style={{ marginTop: 24 }}><Empty title={t("klassenarbeit.compareEmpty")} /></div>}
      {rows.length > 0 && (
        <div style={{ marginTop: 20, border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", fontSize: 11, color: "var(--text3)", borderBottom: "1px solid var(--border)" }}>
            <span style={{ width: 150, flexShrink: 0 }}>{t("klassenarbeit.compareWork")}</span>
            <span style={{ flex: 1, minWidth: 200 }}>0 % – 100 %</span>
            <span style={{ width: 44, textAlign: "right", flexShrink: 0 }}>n</span>
            <span style={{ width: 54, textAlign: "right", flexShrink: 0 }}>⌀ %</span>
            <span style={{ width: 54, textAlign: "right", flexShrink: 0 }}>⌀ {t("klassenarbeit.grade")}</span>
          </div>
          {rows.map((r) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
              <span style={{ width: 150, flexShrink: 0, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.name}>{r.name}</span>
              <Boxplot values={r.pl} max={100} compact />
              <span style={{ width: 44, textAlign: "right", flexShrink: 0, fontSize: 12.5, color: "var(--text3)" }}>{r.q.n}</span>
              <span style={{ width: 54, textAlign: "right", flexShrink: 0, fontSize: 12.5, fontWeight: 600 }}>{fmt(r.q.avg)}</span>
              <span style={{ width: 54, textAlign: "right", flexShrink: 0, fontSize: 13, fontWeight: 700, color: boxColor(r.q.med) }}>{nt(r.avgNote)}</span>
            </div>
          ))}
          <div style={{ padding: "8px 14px", fontSize: 11, color: "var(--text3)" }}>{t("klassenarbeit.boxplotLegend")}</div>
        </div>
      )}
    </div>
  );
}
