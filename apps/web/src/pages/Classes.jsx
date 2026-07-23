// Klassen und Schueler sind Nuvora-Kerndaten, kein Modulbesitz — beide Module
// arbeiten darauf. Deshalb liegt diese Seite im Rahmen unter /classes.
//
// Die Kartennummer (students.card_id) ist dagegen CardVote-Zubehoer: sie ist
// die Nummer der bedruckten ArUco-Karte. Der Kern speichert sie zwar (sie
// identifiziert die Person innerhalb der Klasse), zeigt sie aber nur, wenn
// CardVote aktiviert ist — sonst traegt der Rahmen Modulwissen zur Schau.
//
// Kartendruck und Auswertung liegen NICHT hier, sondern im Modul unter
// /cardvote/cards: der Kern kennt Klassen, nicht was ein Modul damit tut.
import { useState, useEffect } from "react";
import { askConfirm, askPrompt, showAlert } from "../core/dialog.jsx";
import { undoDelete } from "../core/undo.jsx";
import { useSearchParams, Link } from "react-router-dom";
import { AddButton, Icon, ICONS, iconBtn, COLORS as C, btnPrimary, btnSecondary } from "../components/Icons.jsx";
import ImportMenu from "../components/ImportMenu.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { useModules } from "../core/modules.js";
import { peek, put } from "../core/cache.js";

const API = "/api";

// Feste Auswahl, identisch zum Backend (FOERDER_VALUES in classes.py) und
// wortgleich zur bisherigen Lernleiter-App — die Bestandsdaten benutzen genau
// diese Zeichenketten. Freitext wuerde in Lernpfads Differenzierung still zu
// Extrakategorien fuehren.
//
// Die Erklaerungen stammen ebenfalls von dort: sie sagen, was der Schwerpunkt
// im Unterricht bedeutet, statt nur ein Etikett zu vergeben.
const FOERDER = [
  ["LRS", "Schwierigkeiten beim Lesen und Schreiben"],
  ["Dyskalkulie", "Schwierigkeiten mit Zahlen, Mengen und Rechenoperationen"],
  ["Lesen", "Schwierigkeiten beim Textverständnis"],
  ["DaZ", "Deutsch als Zweitsprache – Fachsprache fällt schwer"],
  ["Lernen", "Allgemeine Lernschwierigkeiten, braucht mehr Zeit und Struktur"],
  ["Sozial-Emotional", "Schwierigkeiten in Gruppenarbeit oder bei Frustration"],
  ["Auditive Wahrnehmung", "Schwierigkeiten bei der Verarbeitung gehörter Informationen"],
  ["Motorik", "Schwierigkeiten bei feinmotorischen Aufgaben (Schreiben, Zeichnen)"],
  ["Konzentration", "Kann sich nur kurz konzentrieren, leicht ablenkbar"],
  ["Sehen", "Eingeschränktes Sehvermögen, braucht große Schrift/Kontrast"],
  ["Hören", "Eingeschränktes Hörvermögen, braucht visuelle Anweisungen"],
  ["Sprache", "Schwierigkeiten beim mündlichen Ausdruck"],
];

const EMPTY_STUDENT = { card_id: 1, name: "", niveau: "", foerder: null, notizen: "", klassenlehrer: "" };

export default function Classes() {
  const { t } = useLanguage();
  const { modules } = useModules();
  const cardvote = modules.find((m) => m.key === "cardvote")?.active ?? false;
  const [classes, setClasses] = useState([]);
  const [editing, setEditing] = useState(null);
  const [params, setParams] = useSearchParams();
  const [name, setName] = useState("");
  const [color, setColor] = useState(C.info);
  const [students, setStudents] = useState([]);
  const [detailsFor, setDetailsFor] = useState(null);
  const [trash, setTrash] = useState([]);
  const [showTrash, setShowTrash] = useState(false);

  const loadTrash = () => fetch(`${API}/classes/trash`).then((r) => (r.ok ? r.json() : [])).then((d) => setTrash(Array.isArray(d) ? d : [])).catch(() => {});
  const restore = async (id) => { await fetch(`${API}/classes/${id}/restore`, { method: "POST" }).catch(() => {}); load(); loadTrash(); };
  const purge = async (id) => {
    if (!await askConfirm(t("classes.purgeConfirm"))) return;
    await fetch(`${API}/classes/${id}/purge`, { method: "DELETE" }).catch(() => {});
    loadTrash();
  };

  const [loadError, setLoadError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = () => fetch(`${API}/classes`).then((r) => {
    if (r.status === 401) { localStorage.removeItem("token"); localStorage.removeItem("user"); location.reload(); return []; }
    return r.json();
  }).then((d) => { const list = Array.isArray(d) ? d : []; setClasses(list); put("classes", list); setLoadError(false); }).catch(() => setLoadError(true)).finally(() => setLoaded(true));
  useEffect(() => {
    // Sofort den gecachten Stand zeigen (Seite wirkt instant), dann frisch laden.
    const c = peek("classes"); if (Array.isArray(c)) { setClasses(c); setLoaded(true); }
    const timer = setTimeout(() => { if (classes.length === 0) setLoadError(true); }, 15000);
    load().then(() => clearTimeout(timer));
    loadTrash();
    return () => clearTimeout(timer);
  }, []);

  const MAX_CARDS = 50;

  const startNew = () => {
    setEditing({ id: null });
    setName("");
    setColor(C.info);
    setStudents([{ ...EMPTY_STUDENT, card_id: 1 }]);
  };

  const startEdit = (cls) => {
    setEditing(cls);
    setName(cls.name);
    setColor(cls.color || C.info);
    const sorted = [...cls.students].sort((a, b) => a.card_id - b.card_id);
    // Ganzen Datensatz uebernehmen, nicht nur Nummer und Name: niveau, foerder
    // und notizen wuerden sonst bei jedem Speichern still verschwinden.
    const rows = sorted.map((s, i) => ({ ...s, card_id: i + 1 }));
    if (rows.length === 0) rows.push({ ...EMPTY_STUDENT, card_id: 1 });
    setStudents(rows);
  };

  // Direktlink ?open=<id> (z.B. aus dem Stundenplan): diese Klasse aufklappen.
  useEffect(() => {
    const oid = Number(params.get("open"));
    if (!oid || editing) return;
    const cls = classes.find((c) => c.id === oid);
    if (cls) { startEdit(cls); setParams({}, { replace: true }); }
  }, [classes, params]); // eslint-disable-line

  const save = async () => {
    const filled = students.filter((s) => s.name.trim() !== "");
    const body = {
      name,
      color,
      students: filled.map((s) => ({
        card_id: s.card_id,
        name: s.name.trim(),
        niveau: s.niveau || "",
        foerder: s.foerder || null,
        notizen: s.notizen || "",
        klassenlehrer: s.klassenlehrer || "",
      })),
    };
    if (editing.id) {
      await fetch(`${API}/classes/${editing.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } else {
      await fetch(`${API}/classes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    }
    setEditing(null);
    load();
  };

  const remove = (id) => {
    const cls = classes.find((c) => c.id === id);
    const next = classes.filter((c) => c.id !== id);
    setClasses(next); put("classes", next); // sofort weg
    undoDelete({
      message: t("undo.deleted", { name: cls?.name || "" }),
      undo: () => { load(); },
      commit: async () => { await fetch(`${API}/classes/${id}`, { method: "DELETE" }).catch(() => {}); loadTrash(); },
    });
  };

  const importJson = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.type === "cardvote_class") {
        await fetch(`${API}/import/class`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
        load();
      } else { showAlert(t("classes.invalidFormat")); }
    };
    input.click();
  };

  const importXlsx = async () => {
    const className = await askPrompt(t("classes.classNamePrompt"));
    if (!className) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API}/import/class-xlsx?name=${encodeURIComponent(className)}`, { method: "POST", body: form });
      if (res.ok) { load(); } else { const err = await res.json(); showAlert(err.detail || t("classes.importError")); }
    };
    input.click();
  };

  const updateStudent = (idx, value) => setStudentField(idx, "name", value);

  const setStudentField = (idx, field, value) => {
    const updated = [...students];
    updated[idx] = { ...updated[idx], [field]: value };
    setStudents(updated);
  };

  const toggleFoerder = (idx, wert) => {
    const cur = students[idx].foerder || [];
    setStudentField(idx, "foerder", cur.includes(wert) ? cur.filter((f) => f !== wert) : [...cur, wert]);
  };

  const removeStudent = async (idx) => {
    if (!await askConfirm(t("classes.removeCardConfirm"))) return;
    const updated = students.filter((_, i) => i !== idx);
    setStudents(updated.map((s, i) => ({ ...s, card_id: i + 1 })));
  };

  const addRow = () => {
    if (students.length >= MAX_CARDS) return;
    setStudents([...students, { ...EMPTY_STUDENT, card_id: students.length + 1 }]);
  };

  const downloadFile = async (url, filename) => {
    const res = await fetch(url);
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (editing) {
    const filled = students.filter((s) => s.name.trim() !== "").length;
    return (
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{editing.id ? t("classes.editTitle") : t("classes.newTitle")}</h2>
        <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 10 }}>
          <input placeholder={t("classes.namePlaceholder")} value={name} onChange={(e) => setName(e.target.value)}
            autoComplete="off" style={{ padding: "10px 14px", fontSize: 18, width: 300, border: "1px solid var(--border2)", borderRadius: 10 }} autoFocus />
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} title={t("classes.color")}
            style={{ width: 40, height: 40, padding: 0, border: "1px solid var(--border2)", borderRadius: 8, background: "none", cursor: "pointer" }} />
        </div>
        {!editing.id && (
          <p style={{ color: "var(--text3)", fontSize: 12.5, marginBottom: 16, maxWidth: 460 }}>{t("classes.subjectHint")}</p>
        )}
        <p style={{ color: "var(--text3)", marginBottom: 8, fontSize: 14 }}>
          {t("classes.fillHint", { filled, total: students.length })}
        </p>
        <div style={{ maxWidth: 620, marginBottom: 12 }}>
          {students.map((s, idx) => (
            <div key={idx}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span
                style={{ width: 44, textAlign: "right", fontWeight: 700, color: s.name.trim() ? "var(--text)" : "var(--border2)", fontSize: 14, flexShrink: 0 }}
                title={cardvote ? t("classes.cardNumberHint") : undefined}
              >
                {cardvote ? `#${s.card_id}` : `${idx + 1}.`}
              </span>
              <input value={s.name} onChange={(e) => updateStudent(idx, e.target.value)} placeholder={t("common.name")}
                autoComplete="off" name={`stud-${idx}`} data-lpignore="true"
                style={{ flex: 1, padding: 8, border: "1px solid var(--border2)", borderRadius: 8, fontSize: 14, background: "var(--bg)", color: "var(--text)" }} />
              {/* E/G wird nicht mehr hier gepflegt, sondern im Kurs (betrifft die
                  Person, nicht die Fach-Klasse) — siehe Kurse.jsx. */}
              <button
                type="button" onClick={() => setDetailsFor(detailsFor === idx ? null : idx)}
                title={t("classes.detailsTitle")}
                style={{
                  width: 92, flexShrink: 0, textAlign: "center",
                  border: "1px solid var(--border2)", background: (s.foerder?.length || s.notizen || s.klassenlehrer) ? "var(--accent-bg)" : "var(--card)",
                  color: "var(--text2)", cursor: "pointer", borderRadius: 8, padding: "6px 10px", fontSize: 12.5,
                }}
              >
                {s.foerder?.length ? t("classes.detailsN", { n: s.foerder.length }) : t("classes.details")}
              </button>
              <button onClick={() => removeStudent(idx)} style={{ border: "none", background: "none", cursor: "pointer", padding: 4, display: "flex", alignItems: "center", flexShrink: 0 }} title={t("classes.removeCard")}>
                <Icon d={ICONS.trash} color={C.danger} />
              </button>
            </div>

            {detailsFor === idx && (
              <div style={{ margin: "0 0 12px 52px", padding: 16, border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>{t("classes.classTeacher")}</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                  <input
                    value={s.klassenlehrer || ""} onChange={(e) => setStudentField(idx, "klassenlehrer", e.target.value)}
                    placeholder={t("classes.classTeacherPlaceholder")} maxLength={120}
                    style={{ flex: 1, minWidth: 180, padding: 8, border: "1px solid var(--border2)", borderRadius: 8, fontSize: 13, background: "var(--bg)", color: "var(--text)", boxSizing: "border-box" }}
                  />
                  {/* Bei einer echten Klasse ist die Leitung fuer alle gleich —
                      dann waere 30x tippen unsinnig. Bei einem Kurs, der Kinder
                      aus mehreren Klassen mischt, bleibt jedes Feld einzeln. */}
                  {(s.klassenlehrer || "").trim() && students.length > 1 && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!await askConfirm(t("classes.applyAllConfirm", { name: s.klassenlehrer, n: students.length }))) return;
                        setStudents(students.map((st) => ({ ...st, klassenlehrer: s.klassenlehrer })));
                      }}
                      style={{ ...btnSecondary, padding: "6px 12px", fontSize: 12.5 }}
                    >
                      {t("classes.applyAll")}
                    </button>
                  )}
                </div>

                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>{t("classes.supportNeeds")}</div>
                <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 9 }}>
                  Schwierigkeiten — steuern später die Differenzierung in Lernpfad.
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 16 }}>
                  {FOERDER.map(([wert, erklaerung]) => {
                    const on = (s.foerder || []).includes(wert);
                    return (
                      <label
                        key={wert} title={erklaerung}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6,
                          padding: "5px 11px", borderRadius: 20, fontSize: 13, cursor: "pointer",
                          userSelect: "none",
                          border: on ? "1px solid var(--accent)" : "1px solid var(--border2)",
                          background: on ? "var(--accent-bg)" : "var(--bg)",
                          color: on ? "var(--accent)" : "var(--text2)",
                        }}
                      >
                        <input
                          type="checkbox" checked={on} onChange={() => toggleFoerder(idx, wert)}
                          style={{ margin: 0, cursor: "pointer" }}
                        />
                        {wert}
                      </label>
                    );
                  })}
                </div>

                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>{t("classes.notes")}</div>
                <textarea
                  value={s.notizen || ""} onChange={(e) => setStudentField(idx, "notizen", e.target.value)}
                  rows={2} placeholder={t("classes.notesPlaceholder")} maxLength={2000}
                  style={{ width: "100%", padding: 8, border: "1px solid var(--border2)", borderRadius: 8, fontSize: 13, background: "var(--bg)", color: "var(--text)", resize: "vertical", boxSizing: "border-box" }}
                />
                <p style={{ fontSize: 11.5, color: "var(--text3)", margin: "9px 0 0" }}>
                  {t("classes.staysPrivate")}
                </p>
              </div>
            )}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
          <button onClick={addRow} disabled={students.length >= MAX_CARDS} style={{ ...btnSecondary, opacity: students.length >= MAX_CARDS ? 0.4 : 1 }}>{t("classes.addRow")}</button>
          <button onClick={save} disabled={!name.trim()} style={btnPrimary}>{t("common.save")}</button>
          <button onClick={() => setEditing(null)} style={btnSecondary}>{t("common.cancel")}</button>
          {editing.id && <button onClick={() => { remove(editing.id); setEditing(null); }} className="icon-btn" style={{ ...iconBtn, marginLeft: "auto" }} title={t("classes.delete") !== "classes.delete" ? t("classes.delete") : t("common.delete")}><Icon d={ICONS.trash} size={16} color={C.danger} /></button>}
        </div>
        {cardvote && (
          <p style={{ fontSize: 12, color: students.length >= MAX_CARDS ? C.danger : "var(--text3)", margin: 0 }}>
            {t("classes.limit", { max: MAX_CARDS, count: students.length })}
          </p>
        )}
      </div>
    );
  }

  if (loadError && classes.length === 0 && !editing) return <p style={{ color: C.danger }}>{t("common.connectionError")}</p>;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <AddButton onClick={startNew} title={t("classes.new")} />
        <div style={{ marginLeft: 8 }}>
          <ImportMenu
            importItems={[
              { label: t("classes.importExcel"), onClick: importXlsx },
              { label: t("classes.importJson"), onClick: importJson },
            ]}
            templateItems={[
              { label: t("classes.templateExcel"), href: `${API}/import/class-template.xlsx` },
            ]}
          />
        </div>
        {trash.length > 0 && (
          <button onClick={() => setShowTrash((v) => !v)} style={{ ...btnSecondary, marginLeft: "auto" }}>
            {t("classes.trash")} ({trash.length})
          </button>
        )}
      </div>

      {showTrash && trash.length > 0 && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 14, marginBottom: 18, background: "var(--bg3)" }}>
          <p style={{ fontSize: 12.5, color: "var(--text3)", margin: "0 0 10px" }}>{t("classes.trashHint")}</p>
          {trash.map((cls) => (
            <div key={cls.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--border)" }}>
              <span style={{ flex: 1, fontWeight: 500 }}>{cls.name}
                <span style={{ fontSize: 12, color: "var(--text3)", marginLeft: 8 }}>{t("classes.trashCount", { n: cls.students?.length || 0 })}</span>
              </span>
              <button onClick={() => restore(cls.id)} style={{ ...btnSecondary, padding: "5px 12px", fontSize: 13 }}>{t("classes.restore")}</button>
              <button onClick={() => purge(cls.id)} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("classes.purge")}><Icon d={ICONS.trash} size={15} color={C.danger} /></button>
            </div>
          ))}
        </div>
      )}

      {!loaded && !loadError && <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("common.loading")}</p>}
      {loaded && !loadError && classes.length === 0 && <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("classes.empty")}</p>}

      {classes.map((cls) => (
        <div key={cls.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", marginBottom: 10, border: "1px solid var(--border)", borderRadius: 16, background: "var(--card)" }}>
          <button onClick={() => startEdit(cls)} title={t("classes.open")}
            style={{ display: "flex", alignItems: "center", gap: 10, border: "none", background: "none", cursor: "pointer", padding: 0, textAlign: "left", flex: 1, minWidth: 0 }}>
            <strong style={{ fontSize: 16, color: "var(--text)" }}>{cls.name}</strong>
            <span style={{ color: "var(--text3)", fontSize: 13 }}>{cls.students.length} {t("classes.learners")}</span>
          </button>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <button onClick={() => downloadFile(`${API}/export/class/${cls.id}`, `${cls.name}.json`)} className="icon-btn" style={iconBtn} title={t("classes.export")}><Icon d={ICONS.export} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

