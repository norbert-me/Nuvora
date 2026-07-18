// Modul Noten: Notenbuch, zweistufig.
//
// ABSCHNITTE (Klassenarbeiten, Sonstige Mitarbeit) tragen das Gewicht; darunter
// liegen SPALTEN (einzelne Arbeiten). Der Gesamtschnitt wird über die Abschnitte
// gewichtet. Ohne Gewichte fällt es auf den ungewichteten Mittelwert zurück —
// so steht nie „kein Schnitt“.
//
// Klick auf einen Namen öffnet alle Infos zur Person. Beobachtungen zählen nie
// in den Schnitt — „Anstrengungsbereitschaft“ ist kein Messwert.
import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Icon, ICONS, iconBtn, COLORS as C, btnPrimary, btnSecondary, pageTitle } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

const API = "/api/noten";

function parseNote(text) {
  const n = parseFloat(String(text).replace(",", "."));
  if (Number.isNaN(n) || n < 1 || n > 6) return null;
  return Math.round(n * 100) / 100;
}
const de = (n) => (n === null || n === undefined ? "" : String(n).replace(".", ","));

export default function Noten() {
  const { t } = useLanguage();
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState(null);
  const [students, setStudents] = useState([]);
  const [sections, setSections] = useState([]);
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState([]);
  const [error, setError] = useState("");
  const [zelle, setZelle] = useState(null);
  const [neuAbschnitt, setNeuAbschnitt] = useState(false);
  const [neuSpalteIn, setNeuSpalteIn] = useState(null);
  const [renameCol, setRenameCol] = useState(null);
  const [beobFuer, setBeobFuer] = useState(null);
  const [infoFuer, setInfoFuer] = useState(null);
  const [term, setTerm] = useState("1");
  // Wie mehrere Einzelnoten zusammengefasst werden: Mittel oder Median. Merkt
  // sich die Wahl pro Browser. Die Abschnitts-Gewichtung bleibt unberuehrt.
  const [agg, setAgg] = useState(() => { try { return localStorage.getItem("noten_agg") === "median" ? "median" : "mean"; } catch { return "mean"; } });
  const [yearData, setYearData] = useState({ sections: [], rows: [] });
  const [collapsed, setCollapsed] = useState(() => { try { return new Set(JSON.parse(localStorage.getItem("noten_collapsed") || "[]")); } catch { return new Set(); } });
  const toggleCollapse = (secId) => setCollapsed((prev) => {
    const n = new Set(prev);
    n.has(secId) ? n.delete(secId) : n.add(secId);
    localStorage.setItem("noten_collapsed", JSON.stringify([...n]));
    return n;
  });
  const [dragId, setDragId] = useState(null);
  // Vorschau beim Ziehen: auf welchem Abschnitt, und links oder rechts einfuegen.
  const [dragOver, setDragOver] = useState(null); // { id, side: "left"|"right" }

  const dragOverHeader = (e, secId) => {
    e.preventDefault();
    if (!dragId || secId === dragId) { setDragOver(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const side = e.clientX < r.left + r.width / 2 ? "left" : "right";
    setDragOver((p) => (p && p.id === secId && p.side === side ? p : { id: secId, side }));
  };

  // Spalten je Abschnitt: gleiche Mechanik wie Abschnitte, nur innerhalb eines
  // Abschnitts. dragCol haelt {catId, secId}, dragColOver die Vorschau.
  const [dragCol, setDragCol] = useState(null);
  const [dragColOver, setDragColOver] = useState(null); // { id, side }
  const dragOverCol = (e, catId, catSecId) => {
    e.preventDefault();
    if (!dragCol || dragCol.secId !== catSecId || catId === dragCol.catId) { setDragColOver(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const side = e.clientX < r.left + r.width / 2 ? "left" : "right";
    setDragColOver((p) => (p && p.id === catId && p.side === side ? p : { id: catId, side }));
  };
  const spalteDrop = async (zielId, sec) => {
    const von = dragCol, ov = dragColOver;
    setDragCol(null); setDragColOver(null);
    if (!von || von.secId !== sec.id || von.catId === zielId) return;
    const alt = sections;
    const cols = (sec.categories || []).map((c) => c.id);
    const from = cols.indexOf(von.catId);
    let to = cols.indexOf(zielId);
    if (from < 0 || to < 0) return;
    if (ov && ov.id === zielId && ov.side === "right") to += 1;
    if (from < to) to -= 1;
    const neuCols = [...(sec.categories || [])];
    neuCols.splice(to, 0, neuCols.splice(from, 1)[0]);
    const neuSections = sections.map((s) => (s.id === sec.id ? { ...s, categories: neuCols } : s));
    setSections(neuSections);
    const res = await fetch(`${API}/sections/${sec.id}/categories/reorder`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: neuCols.map((c) => c.id) }),
    }).catch(() => null);
    if (!res || !res.ok) { setSections(alt); setError(t("noten.reorderFail")); }
  };

  // Abschnitt per Drag & Drop verschieben: optimistisch umsortieren, dann speichern.
  const abschnittDrop = async (zielId) => {
    const von = dragId, ov = dragOver;
    setDragId(null); setDragOver(null);
    if (!von || von === zielId) return;
    const alt = sections;
    const ids = alt.map((s) => s.id);
    const from = ids.indexOf(von);
    let to = ids.indexOf(zielId);
    if (from < 0 || to < 0) return;
    if (ov && ov.id === zielId && ov.side === "right") to += 1;
    if (from < to) to -= 1;  // Entnahme verschiebt den Zielindex
    const neu = [...alt];
    neu.splice(to, 0, neu.splice(from, 1)[0]);
    setSections(neu);
    const res = await fetch(`${API}/classes/${classId}/sections/reorder`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: neu.map((s) => s.id) }),
    }).catch(() => null);
    if (!res || !res.ok) { setSections(alt); setError(t("noten.reorderFail")); }
  };

  // Bereichs-/Endnote manuell setzen oder zuruecksetzen.
  const overrideSetzen = async (studentId, sectionId, text) => {
    const val = parseNote(text);
    setZelle(null);
    if (val === null) return;
    await call(() => fetch(`${API}/overrides`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ class_id: classId, student_id: studentId, section_id: sectionId, term, value: val }),
    }));
  };
  const overrideReset = async (studentId, sectionId) => {
    const q = new URLSearchParams({ class_id: classId, student_id: studentId, term });
    if (sectionId != null) q.set("section_id", sectionId);
    await call(() => fetch(`${API}/overrides?${q}`, { method: "DELETE" }));
  };

  useEffect(() => {
    fetch("/api/classes").then((r) => (r.ok ? r.json() : [])).then((d) => {
      const list = Array.isArray(d) ? d : [];
      setClasses(list);
      if (list.length && classId === null) setClassId(list[0].id);
    }).catch(() => {});
  }, []);

  const load = async (id) => {
    if (!id) return;
    if (term === "year") {
      const y = await fetch(`${API}/classes/${id}/year?agg=${agg}`).then((r) => (r.ok ? r.json() : { sections: [], rows: [] }));
      setYearData(y);
      setStudents(classes.find((c) => c.id === id)?.students || []);
      return;
    }
    const [sec, ent, sum] = await Promise.all([
      fetch(`${API}/classes/${id}/sections?term=${term}`).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API}/classes/${id}/entries`).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API}/classes/${id}/summary?term=${term}&agg=${agg}`).then((r) => (r.ok ? r.json() : [])),
    ]);
    setSections(sec); setEntries(ent); setSummary(sum);
    setStudents(classes.find((c) => c.id === id)?.students || []);
  };
  useEffect(() => { if (classId) load(classId); }, [classId, classes, term, agg]);
  const setAggPersist = (m) => { setAgg(m); try { localStorage.setItem("noten_agg", m); } catch { /* egal */ } };

  const call = async (fn) => {
    setError("");
    const res = await fn();
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(typeof b.detail === "string" ? b.detail : t("common.notWork"));
      return false;
    }
    await load(classId);
    return true;
  };

  const noteSetzen = async (studentId, catId, text) => {
    setZelle(null);
    const wert = parseNote(text);
    if (wert === null) return;
    await call(() => fetch(`${API}/entries`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category_id: catId, student_id: studentId, kind: "grade", value: wert, note: "" }),
    }));
  };

  const allCats = sections.flatMap((s) => s.categories || []);
  const gewichtSumme = sections.reduce((n, s) => n + (s.weight || 0), 0);
  const notenVon = (sid, cid) => entries.filter((e) => e.student_id === sid && e.category_id === cid && e.kind === "grade");
  const sumOf = (studentId) => summary.find((s) => s.student_id === studentId);

  if (classes.length === 0) {
    return (
      <div style={{ maxWidth: 700 }}>
        <h1 style={pageTitle}>{t("noten.title")}</h1>
        <p style={{ color: "var(--text2)", fontSize: 14 }}>
          {t("noten.needClass").split("{{link}}")[0]}
          <Link to="/classes" style={{ color: "var(--accent)" }}>{t("nav.classes")}</Link>
          {t("noten.needClass").split("{{link}}")[1]}
        </p>
      </div>
    );
  }

  const cls = classes.find((c) => c.id === classId);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <h1 style={pageTitle}>{t("noten.title")}</h1>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text2)" }}>
          {t("nav.classes")}
          <select value={classId ?? ""} onChange={(e) => setClassId(Number(e.target.value))}
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border2)", background: "var(--bg)", color: "var(--text)" }}>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text2)" }}>
          {t("noten.term")}
          <select value={term} onChange={(e) => setTerm(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border2)", background: "var(--bg)", color: "var(--text)" }}>
            <option value="1">{t("noten.term1")}</option>
            <option value="2">{t("noten.term2")}</option>
            <option value="year">{t("noten.year")}</option>
          </select>
        </label>
        <div style={{ display: "inline-flex", border: "1px solid var(--border2)", borderRadius: 980, overflow: "hidden" }} title={t("noten.aggHint")}>
          {[["mean", t("noten.aggMean")], ["median", t("noten.aggMedian")]].map(([m, label]) => (
            <button key={m} onClick={() => setAggPersist(m)}
              style={{ padding: "6px 14px", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
                background: agg === m ? "var(--accent)" : "transparent", color: agg === m ? "#fff" : "var(--text2)" }}>{label}</button>
          ))}
        </div>
        {term !== "year" && sections.length > 0 && (
          <span style={{ fontSize: 12.5, color: gewichtSumme === 100 ? "var(--text3)" : "#b8860b" }}>
            {gewichtSumme !== 100 ? t("noten.weightNot100", { n: gewichtSumme }) : t("noten.weightSum", { n: gewichtSumme })}
          </span>
        )}
        {term !== "year" && (
          <button onClick={() => setNeuAbschnitt(true)} title={t("noten.addSection")} aria-label={t("noten.addSection")}
            className="icon-btn"
            style={{ ...iconBtn, marginLeft: "auto", width: 36, height: 36, border: "1px solid var(--border2)", borderRadius: 10 }}>
            <Icon d={ICONS.plus} size={20} color="var(--accent)" />
          </button>
        )}
      </div>

      {error && <p style={{ color: "var(--danger, #dc2626)", fontSize: 13, marginBottom: 10 }}>{error}</p>}

      {neuAbschnitt && (
        <SectionForm t={t} onCancel={() => setNeuAbschnitt(false)}
          onSave={async (b) => { if (await call(() => fetch(`${API}/classes/${classId}/sections?term=${term}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...b, position: sections.length }) }))) setNeuAbschnitt(false); }} />
      )}

      {term === "year" ? (
        <YearTable t={t} data={yearData} cls={cls}
          onSet={(sid, txt) => overrideSetzen(sid, null, txt)}
          onReset={(sid) => overrideReset(sid, null)}
          editing={zelle} setEditing={setZelle} onInfo={setInfoFuer} />
      ) : sections.length === 0 ? (
        <>
          <p style={{ fontSize: 13.5, color: "var(--text3)", marginTop: 8, marginBottom: 12 }}>{t("noten.noSections")}</p>
          <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 12, WebkitOverflowScrolling: "touch", maxWidth: 360 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 13.5, width: "100%" }}>
              <thead>
                <tr><th style={{ ...th, textAlign: "left" }}>{cls?.name}</th></tr>
              </thead>
              <tbody>
                {students.map((st) => (
                  <tr key={st.id}>
                    <td style={{ ...td, textAlign: "left", padding: 0 }}>
                      <button onClick={() => setInfoFuer(st.id)} title={t("noten.studentInfo")}
                        style={{ width: "100%", textAlign: "left", padding: "6px 10px", border: "none", background: "none", color: "var(--text)", fontWeight: 500, cursor: "pointer" }}>
                        {st.name}
                      </button>
                    </td>
                  </tr>
                ))}
                {students.length === 0 && (
                  <tr><td style={{ ...td, textAlign: "left", color: "var(--text3)" }}>{t("noten.noStudents")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div style={{ overflowX: "auto", overflowY: "visible", border: "1px solid var(--border)", borderRadius: 12, WebkitOverflowScrolling: "touch" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 13.5, minWidth: "100%" }}>
            <thead>
              <tr>
                <th style={{ ...th, ...stickyL, whiteSpace: "nowrap" }}></th>
                {sections.map((sec) => {
                  const isCol = collapsed.has(sec.id);
                  const cols = isCol ? 0 : (sec.categories || []).length || 1;
                  const over = dragId && dragOver && dragOver.id === sec.id;
                  return (
                    <th key={sec.id} colSpan={cols + 1}
                      draggable
                      onDragStart={() => setDragId(sec.id)}
                      onDragOver={(e) => dragOverHeader(e, sec.id)}
                      onDragEnd={() => { setDragId(null); setDragOver(null); }}
                      onDrop={() => abschnittDrop(sec.id)}
                      style={{ ...th, borderLeft: over && dragOver.side === "left" ? "3px solid var(--accent)" : "2px solid var(--border3)",
                        borderRight: over && dragOver.side === "right" ? "3px solid var(--accent)" : undefined,
                        cursor: "grab", opacity: dragId === sec.id ? 0.4 : 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                        <span title={t("noten.dragHint")} style={{ display: "inline-flex", color: "var(--text3)" }}><Icon d={ICONS.grip} size={14} /></span>
                        <button onClick={() => toggleCollapse(sec.id)} className="icon-btn" style={{ ...iconBtn, padding: 1 }} title={isCol ? t("noten.expand") : t("noten.collapse")}>
                          <Icon d={isCol ? ICONS.plus : ICONS.minus} size={14} />
                        </button>
                        <span>{sec.name}</span>
                        <span style={{ color: "var(--text3)", fontWeight: 400 }}>{sec.weight} %</span>
                        <SectionMenu t={t} sec={sec}
                          onEdit={(b) => call(() => fetch(`${API}/sections/${sec.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }))}
                          onDelete={() => { if (confirm(t("noten.delSection", { name: sec.name }))) call(() => fetch(`${API}/sections/${sec.id}`, { method: "DELETE" })); }}
                          onAddCol={() => setNeuSpalteIn(sec.id)} />
                      </div>
                    </th>
                  );
                })}
                <th rowSpan={2} style={{ ...th, borderLeft: "2px solid var(--border3)" }}>{t("noten.total")}</th>
                <th rowSpan={2} style={{ ...th, minWidth: 40 }} title={t("noten.obsTitle")}>{t("noten.obs")}</th>
              </tr>
              <tr>
                <th style={{ ...th, ...stickyL, textAlign: "left" }}>{cls?.name}</th>
                {sections.map((sec) => {
                  const cols = sec.categories || [];
                  const bereich = (
                    <th key={`sn-${sec.id}`} style={{ ...th, borderLeft: collapsed.has(sec.id) ? "2px solid var(--border3)" : undefined, borderRight: "2px solid var(--border3)", fontWeight: 500, minWidth: 56 }} title={t("noten.sectionGradeHint")}>
                      {t("noten.sectionGrade")}
                    </th>
                  );
                  if (collapsed.has(sec.id)) return [bereich];
                  if (cols.length === 0) {
                    return [
                      <th key={`empty-${sec.id}`} style={{ ...th, borderLeft: "2px solid var(--border3)", fontWeight: 400 }}>
                        {/* Spalte anlegen laeuft ueber das Kebab-Menue des
                            Abschnitts; ein zweiter +Spalte-Knopf war doppelt. */}
                        {neuSpalteIn === sec.id
                          ? <ColForm t={t} onCancel={() => setNeuSpalteIn(null)} onSave={async (name) => { if (await call(() => fetch(`${API}/categories`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, section_id: sec.id, position: 0 }) }))) setNeuSpalteIn(null); }} />
                          : <span style={{ color: "var(--text3)", fontSize: 12 }}>{t("noten.noColumns")}</span>}
                      </th>,
                      bereich,
                    ];
                  }
                  return [
                    ...cols.map((c, i) => {
                    const colOver = dragCol && dragColOver && dragColOver.id === c.id ? dragColOver.side : null;
                    return (
                    <th key={c.id}
                      draggable
                      onDragStart={() => setDragCol({ catId: c.id, secId: sec.id })}
                      onDragOver={(e) => dragOverCol(e, c.id, sec.id)}
                      onDrop={() => spalteDrop(c.id, sec)}
                      onDragEnd={() => { setDragCol(null); setDragColOver(null); }}
                      style={{ ...th, borderLeft: i === 0 ? "2px solid var(--border3)" : "1px solid var(--border)", minWidth: 70, fontWeight: 500,
                        cursor: "grab", opacity: dragCol && dragCol.catId === c.id ? 0.4 : 1,
                        boxShadow: colOver === "left" ? "inset 3px 0 0 var(--accent)" : colOver === "right" ? "inset -3px 0 0 var(--accent)" : undefined }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 3, justifyContent: "center", position: "relative" }}>
                        <button onClick={() => setRenameCol(renameCol === c.id ? null : c.id)} title={t("noten.colOverview")}
                          style={{ maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", border: "none", background: "none", cursor: "pointer", color: "var(--text2)", fontWeight: 500, fontSize: 12, padding: 0 }}>{c.name}</button>
                        {renameCol === c.id && (
                          <ColMenu t={t} cat={c}
                            onRename={async (name) => { if (await call(() => fetch(`${API}/categories/${c.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, section_id: sec.id, position: c.position ?? i }) }))) setRenameCol(null); }}
                            onDelete={() => { if (confirm(t("noten.delColumn", { name: c.name }))) { call(() => fetch(`${API}/categories/${c.id}`, { method: "DELETE" })); setRenameCol(null); } }}
                            onClose={() => setRenameCol(null)} />
                        )}
                      </div>
                      {neuSpalteIn === sec.id && i === cols.length - 1 && (
                        <ColForm t={t} onCancel={() => setNeuSpalteIn(null)} onSave={async (name) => { if (await call(() => fetch(`${API}/categories`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, section_id: sec.id, position: cols.length }) }))) setNeuSpalteIn(null); }} />
                      )}
                    </th>
                    ); }),
                    bereich,
                  ];
                })}
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.student_id}>
                  <td style={{ ...td, ...stickyL, textAlign: "left", padding: 0 }}>
                    <button onClick={() => setInfoFuer(s.student_id)} title={t("noten.studentInfo")}
                      style={{ width: "100%", textAlign: "left", padding: "6px 8px", border: "none", background: "none", color: "var(--text)", fontWeight: 500, cursor: "pointer" }}>
                      {s.name}
                    </button>
                  </td>
                  {sections.map((sec) => {
                    const cols = sec.categories || [];
                    const bereichTd = (
                      <td key={`sn-${sec.id}`} style={{ ...td, padding: 0, borderLeft: collapsed.has(sec.id) ? "2px solid var(--border3)" : undefined, borderRight: "2px solid var(--border3)", background: "var(--bg2, rgba(0,0,0,0.02))" }}>
                        <NoteZelle t={t}
                          editing={zelle === `sec:${s.student_id}:${sec.id}`}
                          onEdit={() => setZelle(`sec:${s.student_id}:${sec.id}`)}
                          value={s.section_effective[String(sec.id)] ?? null}
                          isOverride={s.section_overrides[String(sec.id)] !== undefined}
                          onSave={(txt) => overrideSetzen(s.student_id, sec.id, txt)}
                          onCancel={() => setZelle(null)}
                          onReset={() => overrideReset(s.student_id, sec.id)} />
                      </td>
                    );
                    if (collapsed.has(sec.id)) return [bereichTd];
                    if (cols.length === 0) return [<td key={`e-${sec.id}`} style={{ ...td, borderLeft: "2px solid var(--border3)" }}></td>, bereichTd];
                    return [
                      ...cols.map((c, i) => {
                        const id = `${s.student_id}:${c.id}`;
                        const noten = notenVon(s.student_id, c.id);
                        return (
                          <td key={c.id} style={{ ...td, padding: 0, borderLeft: i === 0 ? "2px solid var(--border3)" : "1px solid var(--border)" }}>
                            {zelle === id
                              ? <Zelle initial={noten[0] ? de(noten[0].value) : ""} onSave={(txt) => noteSetzen(s.student_id, c.id, txt)} onCancel={() => setZelle(null)} />
                              : <button onClick={() => setZelle(id)}
                                  style={{ width: "100%", minHeight: 32, border: "none", background: "none", cursor: "text", color: "var(--text)", fontSize: 13.5, fontWeight: noten.length ? 600 : 400 }}>
                                  {s.per_category[String(c.id)] !== undefined ? de(s.per_category[String(c.id)]) : <span style={{ color: "var(--border2)" }}>·</span>}
                                </button>}
                          </td>
                        );
                      }),
                      bereichTd,
                    ];
                  })}
                  <td style={{ ...td, padding: 0, borderLeft: "2px solid var(--border3)" }}>
                    <NoteZelle t={t} bold
                      editing={zelle === `end:${s.student_id}`}
                      onEdit={() => setZelle(`end:${s.student_id}`)}
                      value={s.total_override ?? s.weighted}
                      isOverride={s.total_override != null}
                      onSave={(txt) => overrideSetzen(s.student_id, null, txt)}
                      onCancel={() => setZelle(null)}
                      onReset={() => overrideReset(s.student_id, null)} />
                    {s.total_override == null && s.weighted !== null && s.unweighted_fallback && (
                      <div style={{ fontWeight: 400, fontSize: 10, color: "#b8860b" }}>{t("noten.unweighted")}</div>
                    )}
                  </td>
                  <td style={td}>
                    <button onClick={() => setBeobFuer(s.student_id)} title={t("noten.obsHeading")}
                      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", background: "none", cursor: "pointer", color: s.observations ? "var(--accent)" : "var(--text3)", fontSize: 12.5, padding: 4 }}>
                      {s.observations || <Icon d={ICONS.plus} size={14} />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 10, lineHeight: 1.6 }}>
        {t("noten.cellHint", { a: "2", b: "2,3" })} {t("noten.clickStudent")}
      </p>

      {beobFuer && (
        <Beobachtungen t={t} student={summary.find((s) => s.student_id === beobFuer)} cats={allCats}
          entries={entries.filter((e) => e.student_id === beobFuer && e.kind === "observation")}
          onClose={() => setBeobFuer(null)}
          onSave={(b) => call(() => fetch(`${API}/entries`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }))}
          onDelete={(id) => call(() => fetch(`${API}/entries/${id}`, { method: "DELETE" }))} />
      )}

      {infoFuer && (
        <StudentInfo t={t} student={students.find((st) => st.id === infoFuer)} summary={sumOf(infoFuer)} sections={sections} className={cls?.name} onClose={() => setInfoFuer(null)} />
      )}
    </div>
  );
}

function Zelle({ onSave, onCancel, initial = "" }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <input ref={ref} defaultValue={initial}
      onBlur={(e) => (e.target.value.trim() ? onSave(e.target.value) : onCancel())}
      onKeyDown={(e) => { if (e.key === "Enter") onSave(e.target.value); if (e.key === "Escape") onCancel(); }}
      placeholder="2,3"
      style={{ width: "100%", minHeight: 32, border: "2px solid var(--accent)", borderRadius: 4, background: "var(--input-bg, var(--bg))", color: "var(--text)", textAlign: "center", fontSize: 13.5, padding: 0, boxSizing: "border-box" }} />
  );
}

// Bereichs- oder Endnote: zeigt den Schnitt, per Klick ueberschreibbar, mit
// Kreuz wieder auf den Schnitt zuruecksetzbar. Ueberschriebene Note steht in
// Akzentfarbe, damit „gerechnet" und „gesetzt" unterscheidbar bleiben.
function NoteZelle({ t, editing, onEdit, value, isOverride, onSave, onCancel, onReset, bold }) {
  if (editing) return <Zelle initial={value != null ? de(value) : ""} onSave={onSave} onCancel={onCancel} />;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 2, minHeight: 32 }}>
      <button onClick={onEdit} title={t("noten.overrideHint")}
        style={{ border: "none", background: "none", cursor: "pointer", color: isOverride ? "var(--accent)" : "var(--text)", fontWeight: bold ? 700 : 600, fontSize: 13.5, padding: "0 2px" }}>
        {value != null ? de(value) : <span style={{ color: "var(--border2)" }}>·</span>}
      </button>
      {isOverride && (
        <button onClick={onReset} className="icon-btn" style={{ ...iconBtn, padding: 1 }} title={t("noten.overrideReset")}>
          <Icon d={ICONS.close} color={C.danger} size={12} />
        </button>
      )}
    </div>
  );
}

function SectionForm({ t, onSave, onCancel, initial }) {
  const [name, setName] = useState(initial?.name || "");
  const [weight, setWeight] = useState(initial?.weight ?? "");
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
      <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder={t("noten.newSection")}
        style={{ flex: 1, minWidth: 220, ...inp }} onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }} />
      <input type="number" min={0} max={100} value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="%" style={{ width: 80, ...inp }} />
      <button onClick={() => name.trim() && onSave({ name: name.trim(), weight: Number(weight) || 0 })} style={btnPrimary}>{t("common.save")}</button>
      <button onClick={onCancel} style={btnSecondary}>{t("common.abort")}</button>
    </div>
  );
}

// Kompaktes Kebab-Menue: haelt Spalte-hinzufuegen, Umbenennen und Loeschen,
// damit der Abschnittskopf schmal bleibt.
function SectionMenu({ t, sec, onEdit, onDelete, onAddCol }) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  if (edit) {
    return (
      <span onClick={(e) => e.stopPropagation()} style={{ position: "absolute", zIndex: 10, top: 50, left: 0, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.2)" }}>
        <SectionForm t={t} initial={sec} onCancel={() => setEdit(false)} onSave={(b) => { onEdit(b); setEdit(false); }} />
      </span>
    );
  }
  const item = { display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 10px", border: "none", background: "none", cursor: "pointer", color: "var(--text)", fontSize: 13, textAlign: "left", fontWeight: 400 };
  return (
    <span style={{ position: "relative", display: "inline-flex" }} onClick={(e) => e.stopPropagation()}>
      <button onClick={() => setOpen((o) => !o)} className="icon-btn" style={{ ...iconBtn, padding: 1 }} title={t("common.options")}><Icon d={ICONS.more} size={15} /></button>
      {open && (
        <>
          <span onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 9 }} />
          <div style={{ position: "absolute", zIndex: 10, top: 24, right: 0, minWidth: 168, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: 4, boxShadow: "0 6px 20px rgba(0,0,0,0.2)" }}>
            <button style={item} onClick={() => { setOpen(false); onAddCol(); }}><Icon d={ICONS.plus} size={14} color="var(--accent)" /> {t("noten.addColumn")}</button>
            <button style={item} onClick={() => { setOpen(false); setEdit(true); }}><Icon d={ICONS.edit} size={14} /> {t("common.rename")}</button>
            <button style={{ ...item, color: C.danger }} onClick={() => { setOpen(false); onDelete(); }}><Icon d={ICONS.trash} size={14} color={C.danger} /> {t("common.delete")}</button>
          </div>
        </>
      )}
    </span>
  );
}

// Kleine Uebersicht zur Spalte: Anlagedatum plus Umbenennen/Loeschen.
function ColMenu({ t, cat, onRename, onDelete, onClose }) {
  const [name, setName] = useState(cat.name);
  const datum = cat.created_at ? new Date(cat.created_at).toLocaleDateString("de-DE") : "—";
  return (
    <>
      <span onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9 }} />
      <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", zIndex: 10, top: 26, left: "50%", transform: "translateX(-50%)", minWidth: 210, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: 12, boxShadow: "0 6px 20px rgba(0,0,0,0.2)", textAlign: "left", fontWeight: 400 }}>
        <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8 }}>{t("noten.colCreated")}: {datum}</div>
        <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 10 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onRename(name.trim()); if (e.key === "Escape") onClose(); }}
            style={{ ...inp, fontSize: 12, padding: 5 }} />
          <DatePick onPick={setName} title={t("noten.useDate")} />
        </div>
        <div style={{ display: "flex", gap: 6, justifyContent: "space-between", alignItems: "center" }}>
          <button onClick={() => name.trim() && onRename(name.trim())} style={{ ...btnPrimary, padding: "5px 12px", fontSize: 12 }}>{t("common.save")}</button>
          <button onClick={onDelete} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("common.delete")}><Icon d={ICONS.trash} color={C.danger} size={14} /></button>
        </div>
      </div>
    </>
  );
}

// Datumswahl ueber ein natives <input type=date>, transparent ueber dem
// Kalender-Icon: auf dem iPhone erscheinen so die Datumsraeder. Setzt den
// Spaltennamen auf TT.MM.JJJJ, der Name bleibt aber frei editierbar.
function DatePick({ onPick, title }) {
  return (
    <span className="icon-btn" style={{ ...iconBtn, padding: 3, position: "relative", overflow: "hidden" }} title={title}>
      <Icon d={ICONS.calendar} size={14} />
      <input type="date" aria-label={title}
        onChange={(e) => { if (e.target.value) { const [y, m, d] = e.target.value.split("-"); onPick(`${d}.${m}.${y}`); } }}
        style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }} />
    </span>
  );
}

function ColForm({ t, onSave, onCancel, initial = "" }) {
  const [name, setName] = useState(initial);
  return (
    <div style={{ display: "flex", gap: 4, marginTop: 4, alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
      <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder={t("noten.colName")}
        onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onSave(name.trim()); if (e.key === "Escape") onCancel(); }}
        style={{ ...inp, fontSize: 12, padding: 5, minWidth: 120 }} />
      <DatePick onPick={setName} title={t("noten.useDate")} />
      <button onClick={() => name.trim() && onSave(name.trim())} style={{ ...btnPrimary, padding: "4px 10px", fontSize: 12 }}>OK</button>
      <button onClick={onCancel} className="icon-btn" style={{ ...iconBtn, padding: 1 }} title={t("common.abort")}><Icon d={ICONS.close} size={13} /></button>
    </div>
  );
}

function StudentInfo({ t, student, summary, sections, className, onClose }) {
  if (!student) return null;
  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal}>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 2 }}>{student.name}</h3>
        <p style={{ fontSize: 12.5, color: "var(--text3)", marginBottom: 16 }}>{className}</p>

        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px", fontSize: 13.5, marginBottom: 18 }}>
          <dt style={dtS}>{t("noten.course")}</dt>
          <dd style={ddS}>{student.niveau ? (student.niveau === "E" ? "E-Kurs" : "G-Kurs") : "—"}</dd>
          <dt style={dtS}>{t("noten.supportNeeds")}</dt>
          <dd style={ddS}>{student.foerder?.length ? student.foerder.join(", ") : "—"}</dd>
          {student.klassenlehrer && (<><dt style={dtS}>{t("noten.classTeacher")}</dt><dd style={ddS}>{student.klassenlehrer}</dd></>)}
          {student.notizen && (<><dt style={dtS}>{t("noten.notes")}</dt><dd style={ddS}>{student.notizen}</dd></>)}
        </dl>

        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{t("noten.gradesBySection")}</div>
        {sections.length === 0 || !summary ? (
          <p style={{ fontSize: 13, color: "var(--text3)" }}>{t("noten.noGrades")}</p>
        ) : (
          <div style={{ marginBottom: 14 }}>
            {sections.map((sec) => {
              const v = summary.per_section?.[String(sec.id)];
              return (
                <div key={sec.id} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--border)", fontSize: 13.5 }}>
                  <span><span style={{ color: "var(--text3)" }}>{sec.weight} % · </span>{sec.name}</span>
                  <strong>{v !== undefined ? de(v) : "·"}</strong>
                </div>
              );
            })}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 0", fontSize: 14, fontWeight: 700 }}>
              <span>{t("noten.total")}</span>
              <span>{summary.weighted !== null ? de(summary.weighted) : "·"}{summary.unweighted_fallback ? ` (${t("noten.unweighted")})` : ""}</span>
            </div>
          </div>
        )}

        <button onClick={onClose} style={btnSecondary}>{t("noten.close")}</button>
      </div>
    </div>
  );
}

function Beobachtungen({ t, student, cats, entries, onClose, onSave, onDelete }) {
  const [catId, setCatId] = useState(cats[0]?.id ?? null);
  const [tendency, setTendency] = useState(1);
  const [note, setNote] = useState("");
  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal}>
        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>{student?.name}</h3>
        <p style={{ fontSize: 12.5, color: "var(--text3)", marginBottom: 16 }}>{t("noten.obsSub")}</p>
        {cats.length === 0 ? (
          <p style={{ fontSize: 13.5, color: "var(--text3)" }}>{t("noten.needColumnFirst")}</p>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
              <select value={catId ?? ""} onChange={(e) => setCatId(Number(e.target.value))} style={{ ...inp, flex: 1, minWidth: 140 }}>
                {cats.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
              {[[1, "+"], [0, "·"], [-1, "−"]].map(([v, label]) => (
                <button key={v} onClick={() => setTendency(v)} style={{ width: 38, cursor: "pointer", fontSize: 15, borderRadius: 8, fontWeight: 700, border: tendency === v ? "1px solid var(--accent)" : "1px solid var(--border2)", background: tendency === v ? "var(--accent-bg)" : "var(--card)", color: tendency === v ? "var(--accent)" : "var(--text2)" }}>{label}</button>
              ))}
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder={t("noten.obsPlaceholder")}
              onKeyDown={(e) => { if (e.key === "Enter" && catId) { onSave({ category_id: catId, student_id: student.student_id, kind: "observation", tendency, note }); setNote(""); } }}
              style={{ ...inp, marginBottom: 10 }} />
            <button onClick={() => { onSave({ category_id: catId, student_id: student.student_id, kind: "observation", tendency, note }); setNote(""); }} disabled={!catId} style={{ ...btnPrimary, opacity: catId ? 1 : 0.4, marginBottom: 18 }}>{t("noten.note")}</button>
          </>
        )}
        {entries.map((e) => {
          const k = cats.find((c) => c.id === e.category_id);
          return (
            <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderTop: "1px solid var(--border)", fontSize: 12.5 }}>
              <span style={{ width: 62, color: "var(--text3)" }}>{new Date(e.date).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}</span>
              <span style={{ width: 14, fontWeight: 700, color: e.tendency > 0 ? "#0a7d3e" : e.tendency < 0 ? "var(--danger, #dc2626)" : "var(--text3)" }}>{e.tendency > 0 ? "+" : e.tendency < 0 ? "−" : "·"}</span>
              <span style={{ flex: 1, minWidth: 0 }}><span style={{ color: "var(--text3)" }}>{k?.name}: </span>{e.note}</span>
              <button onClick={() => onDelete(e.id)} className="icon-btn" style={iconBtn} title={t("common.delete")}><Icon d={ICONS.trash} color={C.danger} /></button>
            </div>
          );
        })}
        <button onClick={onClose} style={{ ...btnSecondary, marginTop: 14 }}>{t("noten.close")}</button>
      </div>
    </div>
  );
}

// Jahresuebersicht: Bereichsnoten beider Halbjahre, die zwei Halbjahresnoten
// und die Jahresnote (Mittel der beiden, per Klick ueberschreibbar).
function YearTable({ t, data, cls, onSet, onReset, editing, setEditing, onInfo }) {
  const { sections = [], rows = [] } = data || {};
  const sec1 = sections.filter((s) => s.term === "1");
  const sec2 = sections.filter((s) => s.term === "2");
  if (rows.length === 0) return <p style={{ fontSize: 13.5, color: "var(--text3)", marginTop: 8 }}>{t("noten.noStudents")}</p>;
  const grp = { ...th, borderLeft: "2px solid var(--border3)", fontSize: 12.5 };
  const secCols = (secs) => secs.map((s, i) => (
    <th key={s.id} style={{ ...th, borderLeft: i === 0 ? "2px solid var(--border3)" : "1px solid var(--border)", minWidth: 56, fontWeight: 500 }}>{s.name}</th>
  ));
  return (
    <div style={{ overflowX: "auto", overflowY: "visible", border: "1px solid var(--border)", borderRadius: 12, WebkitOverflowScrolling: "touch" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 13.5, minWidth: "100%" }}>
        <thead>
          <tr>
            <th style={{ ...th, ...stickyL, whiteSpace: "nowrap" }}></th>
            <th colSpan={sec1.length + 1} style={grp}>{t("noten.term1")}</th>
            <th colSpan={sec2.length + 1} style={grp}>{t("noten.term2")}</th>
            <th rowSpan={2} style={{ ...grp, fontWeight: 700 }}>{t("noten.yearGrade")}</th>
          </tr>
          <tr>
            <th style={{ ...th, ...stickyL, textAlign: "left" }}>{cls?.name}</th>
            {secCols(sec1)}
            <th style={{ ...th, borderLeft: "1px solid var(--border)", fontWeight: 700 }}>{t("noten.termGrade")}</th>
            {secCols(sec2)}
            <th style={{ ...th, borderLeft: "1px solid var(--border)", fontWeight: 700 }}>{t("noten.termGrade")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.student_id}>
              <td style={{ ...td, ...stickyL, textAlign: "left", padding: 0 }}>
                <button onClick={() => onInfo(r.student_id)} title={t("noten.studentInfo")}
                  style={{ width: "100%", textAlign: "left", padding: "6px 8px", border: "none", background: "none", color: "var(--text)", fontWeight: 500, cursor: "pointer" }}>
                  {r.name}
                </button>
              </td>
              {sec1.map((s, i) => (
                <td key={s.id} style={{ ...td, borderLeft: i === 0 ? "2px solid var(--border3)" : "1px solid var(--border)" }}>
                  {r.section_grades[String(s.id)] != null ? de(r.section_grades[String(s.id)]) : <span style={{ color: "var(--border2)" }}>·</span>}
                </td>
              ))}
              <td style={{ ...td, borderLeft: "1px solid var(--border)", fontWeight: 700 }}>
                {r.term_ends["1"] != null ? de(r.term_ends["1"]) : <span style={{ color: "var(--border2)" }}>·</span>}
              </td>
              {sec2.map((s, i) => (
                <td key={s.id} style={{ ...td, borderLeft: i === 0 ? "2px solid var(--border3)" : "1px solid var(--border)" }}>
                  {r.section_grades[String(s.id)] != null ? de(r.section_grades[String(s.id)]) : <span style={{ color: "var(--border2)" }}>·</span>}
                </td>
              ))}
              <td style={{ ...td, borderLeft: "1px solid var(--border)", fontWeight: 700 }}>
                {r.term_ends["2"] != null ? de(r.term_ends["2"]) : <span style={{ color: "var(--border2)" }}>·</span>}
              </td>
              <td style={{ ...td, padding: 0, borderLeft: "2px solid var(--border3)" }}>
                <NoteZelle t={t} bold
                  editing={editing === `end:${r.student_id}`}
                  onEdit={() => setEditing(`end:${r.student_id}`)}
                  value={r.year}
                  isOverride={r.year_override != null}
                  onSave={(txt) => onSet(r.student_id, txt)}
                  onCancel={() => setEditing(null)}
                  onReset={() => onReset(r.student_id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const inp = { width: "100%", padding: 8, border: "1px solid var(--border2)", borderRadius: 8, fontSize: 14, background: "var(--bg)", color: "var(--text)", boxSizing: "border-box" };
const th = { padding: "8px 6px", borderBottom: "2px solid var(--border3)", fontWeight: 600, fontSize: 12, color: "var(--text2)", textAlign: "center", whiteSpace: "nowrap", position: "relative" };
const td = { padding: "4px 6px", borderBottom: "1px solid var(--border)", textAlign: "center", color: "var(--text)" };
const stickyL = { position: "sticky", left: 0, background: "var(--card)", zIndex: 1 };
const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 200 };
const modal = { background: "var(--card)", borderRadius: 18, maxWidth: 460, width: "100%", maxHeight: "85vh", overflow: "auto", padding: 22, border: "1px solid var(--border)" };
const dtS = { color: "var(--text3)", fontWeight: 500 };
const ddS = { margin: 0, color: "var(--text)" };
