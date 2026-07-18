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
  return Math.round(n * 10) / 10;
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
  const [beobFuer, setBeobFuer] = useState(null);
  const [infoFuer, setInfoFuer] = useState(null);
  const [dragId, setDragId] = useState(null);

  // Abschnitt per Drag & Drop verschieben: optimistisch umsortieren, dann speichern.
  const abschnittDrop = async (zielId) => {
    const von = dragId;
    setDragId(null);
    if (!von || von === zielId) return;
    const alt = sections;
    const ids = alt.map((s) => s.id);
    const from = ids.indexOf(von), to = ids.indexOf(zielId);
    if (from < 0 || to < 0) return;
    const neu = [...alt];
    neu.splice(to, 0, neu.splice(from, 1)[0]);
    setSections(neu);
    const res = await fetch(`${API}/classes/${classId}/sections/reorder`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: neu.map((s) => s.id) }),
    }).catch(() => null);
    if (!res || !res.ok) { setSections(alt); setError(t("noten.reorderFail")); }
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
    const [sec, ent, sum] = await Promise.all([
      fetch(`${API}/classes/${id}/sections`).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API}/classes/${id}/entries`).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API}/classes/${id}/summary`).then((r) => (r.ok ? r.json() : [])),
    ]);
    setSections(sec); setEntries(ent); setSummary(sum);
    setStudents(classes.find((c) => c.id === id)?.students || []);
  };
  useEffect(() => { if (classId) load(classId); }, [classId, classes]);

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
    <div style={{ maxWidth: 1200 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <h1 style={pageTitle}>{t("noten.title")}</h1>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text2)" }}>
          {t("nav.classes")}
          <select value={classId ?? ""} onChange={(e) => setClassId(Number(e.target.value))}
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border2)", background: "var(--bg)", color: "var(--text)" }}>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {sections.length > 0 && (
          <span style={{ fontSize: 12.5, color: gewichtSumme === 100 ? "var(--text3)" : "#b8860b" }}>
            {gewichtSumme !== 100 ? t("noten.weightNot100", { n: gewichtSumme }) : t("noten.weightSum", { n: gewichtSumme })}
          </span>
        )}
        <button onClick={() => setNeuAbschnitt(true)} style={{ ...btnSecondary, marginLeft: "auto" }}>{t("noten.addSection")}</button>
      </div>

      {error && <p style={{ color: "var(--danger, #dc2626)", fontSize: 13, marginBottom: 10 }}>{error}</p>}

      {neuAbschnitt && (
        <SectionForm t={t} onCancel={() => setNeuAbschnitt(false)}
          onSave={async (b) => { if (await call(() => fetch(`${API}/classes/${classId}/sections`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...b, position: sections.length }) }))) setNeuAbschnitt(false); }} />
      )}

      {sections.length === 0 ? (
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
                <th style={{ ...th, ...stickyL, minWidth: 150 }}></th>
                {sections.map((sec) => {
                  const cols = (sec.categories || []).length || 1;
                  return (
                    <th key={sec.id} colSpan={cols}
                      draggable
                      onDragStart={() => setDragId(sec.id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => abschnittDrop(sec.id)}
                      style={{ ...th, borderLeft: "2px solid var(--border)", cursor: "grab", opacity: dragId === sec.id ? 0.4 : 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                        <span title={t("noten.dragHint")}>⋮⋮ {sec.name}</span>
                        <span style={{ color: "var(--text3)", fontWeight: 400 }}>{sec.weight} %</span>
                        <SectionMenu t={t} sec={sec}
                          onEdit={(b) => call(() => fetch(`${API}/sections/${sec.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }))}
                          onDelete={() => { if (confirm(t("noten.delSection", { name: sec.name }))) call(() => fetch(`${API}/sections/${sec.id}`, { method: "DELETE" })); }}
                          onAddCol={() => setNeuSpalteIn(sec.id)} />
                      </div>
                    </th>
                  );
                })}
                <th rowSpan={2} style={{ ...th, borderLeft: "2px solid var(--border)" }}>{t("noten.total")}</th>
                <th rowSpan={2} style={{ ...th, minWidth: 40 }} title={t("noten.obsTitle")}>{t("noten.obs")}</th>
              </tr>
              <tr>
                <th style={{ ...th, ...stickyL, textAlign: "left" }}>{cls?.name}</th>
                {sections.map((sec) => {
                  const cols = sec.categories || [];
                  if (cols.length === 0) {
                    return (
                      <th key={`empty-${sec.id}`} style={{ ...th, borderLeft: "2px solid var(--border)", fontWeight: 400 }}>
                        {neuSpalteIn === sec.id
                          ? <ColForm t={t} onCancel={() => setNeuSpalteIn(null)} onSave={async (name) => { if (await call(() => fetch(`${API}/categories`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, section_id: sec.id, position: 0 }) }))) setNeuSpalteIn(null); }} />
                          : <button onClick={() => setNeuSpalteIn(sec.id)} style={{ border: "none", background: "none", color: "var(--accent)", cursor: "pointer", fontSize: 12 }}>{t("noten.addColShort")}</button>}
                      </th>
                    );
                  }
                  return cols.map((c, i) => (
                    <th key={c.id} style={{ ...th, borderLeft: i === 0 ? "2px solid var(--border)" : "1px solid var(--border)", minWidth: 70, fontWeight: 500 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 3, justifyContent: "center" }}>
                        <span style={{ maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                        <button onClick={() => { if (confirm(t("noten.delColumn", { name: c.name }))) call(() => fetch(`${API}/categories/${c.id}`, { method: "DELETE" })); }}
                          className="icon-btn" style={{ ...iconBtn, padding: 1 }} title={t("noten.delColTitle")}>
                          <Icon d={ICONS.trash} color={C.danger} size={13} />
                        </button>
                        {i === cols.length - 1 && neuSpalteIn !== sec.id && (
                          <button onClick={() => setNeuSpalteIn(sec.id)} title={t("noten.addColShort")} style={{ border: "none", background: "none", color: "var(--accent)", cursor: "pointer", fontSize: 14 }}>+</button>
                        )}
                      </div>
                      {neuSpalteIn === sec.id && i === cols.length - 1 && (
                        <ColForm t={t} onCancel={() => setNeuSpalteIn(null)} onSave={async (name) => { if (await call(() => fetch(`${API}/categories`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, section_id: sec.id, position: cols.length }) }))) setNeuSpalteIn(null); }} />
                      )}
                    </th>
                  ));
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
                    if (cols.length === 0) return <td key={`e-${sec.id}`} style={{ ...td, borderLeft: "2px solid var(--border)" }}></td>;
                    return cols.map((c, i) => {
                      const id = `${s.student_id}:${c.id}`;
                      const noten = notenVon(s.student_id, c.id);
                      return (
                        <td key={c.id} style={{ ...td, padding: 0, borderLeft: i === 0 ? "2px solid var(--border)" : "1px solid var(--border)" }}>
                          {zelle === id
                            ? <Zelle initial={noten[0] ? de(noten[0].value) : ""} onSave={(txt) => noteSetzen(s.student_id, c.id, txt)} onCancel={() => setZelle(null)} />
                            : <button onClick={() => setZelle(id)}
                                style={{ width: "100%", minHeight: 32, border: "none", background: "none", cursor: "text", color: "var(--text)", fontSize: 13.5, fontWeight: noten.length ? 600 : 400 }}>
                                {s.per_category[String(c.id)] !== undefined ? de(s.per_category[String(c.id)]) : <span style={{ color: "var(--border2)" }}>·</span>}
                              </button>}
                        </td>
                      );
                    });
                  })}
                  <td style={{ ...td, borderLeft: "2px solid var(--border)", fontWeight: 700 }}>
                    {s.weighted !== null ? de(s.weighted) : <span style={{ color: "var(--border2)" }}>·</span>}
                    {s.weighted !== null && s.unweighted_fallback && (
                      <div style={{ fontWeight: 400, fontSize: 10, color: "#b8860b" }}>{t("noten.unweighted")}</div>
                    )}
                  </td>
                  <td style={td}>
                    <button onClick={() => setBeobFuer(s.student_id)} title={t("noten.obsHeading")}
                      style={{ border: "none", background: "none", cursor: "pointer", color: s.observations ? "var(--accent)" : "var(--text3)", fontSize: 12.5, padding: 4 }}>
                      {s.observations || "+"}
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

function SectionMenu({ t, sec, onEdit, onDelete, onAddCol }) {
  const [edit, setEdit] = useState(false);
  if (edit) {
    return (
      <span onClick={(e) => e.stopPropagation()} style={{ position: "absolute", zIndex: 10, top: 50, left: 0, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.2)" }}>
        <SectionForm t={t} initial={sec} onCancel={() => setEdit(false)} onSave={(b) => { onEdit(b); setEdit(false); }} />
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      <button onClick={onAddCol} title={t("noten.addColShort")} style={{ border: "none", background: "none", color: "var(--accent)", cursor: "pointer", fontSize: 14, padding: 0 }}>+</button>
      <button onClick={() => setEdit(true)} className="icon-btn" style={{ ...iconBtn, padding: 1 }} title={t("common.rename")}><Icon d={ICONS.edit} size={13} /></button>
      <button onClick={onDelete} className="icon-btn" style={{ ...iconBtn, padding: 1 }} title={t("common.delete")}><Icon d={ICONS.trash} color={C.danger} size={13} /></button>
    </span>
  );
}

function ColForm({ t, onSave, onCancel }) {
  const [name, setName] = useState("");
  return (
    <div style={{ display: "flex", gap: 4, marginTop: 4, alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
      <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder={t("noten.colName")}
        onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onSave(name.trim()); if (e.key === "Escape") onCancel(); }}
        style={{ ...inp, fontSize: 12, padding: 5, minWidth: 120 }} />
      <button onClick={() => name.trim() && onSave(name.trim())} style={{ ...btnPrimary, padding: "4px 10px", fontSize: 12 }}>OK</button>
      <button onClick={onCancel} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--text3)" }}>×</button>
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

const inp = { width: "100%", padding: 8, border: "1px solid var(--border2)", borderRadius: 8, fontSize: 14, background: "var(--bg)", color: "var(--text)", boxSizing: "border-box" };
const th = { padding: "8px 6px", borderBottom: "2px solid var(--border)", fontWeight: 600, fontSize: 12, color: "var(--text2)", textAlign: "center", whiteSpace: "nowrap", position: "relative" };
const td = { padding: "4px 6px", borderBottom: "1px solid var(--border)", textAlign: "center", color: "var(--text)" };
const stickyL = { position: "sticky", left: 0, background: "var(--card)", zIndex: 1 };
const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 200 };
const modal = { background: "var(--card)", borderRadius: 18, maxWidth: 460, width: "100%", maxHeight: "85vh", overflow: "auto", padding: 22, border: "1px solid var(--border)" };
const dtS = { color: "var(--text3)", fontWeight: 500 };
const ddS = { margin: 0, color: "var(--text)" };
