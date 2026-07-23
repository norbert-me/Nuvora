// Kurse (Lerngruppen) verwalten. Klassen im selben Kurs teilen SuS + Anwesenheit
// (per Name); Karten/Noten bleiben pro Fach-Klasse. Eine Klasse darf in mehreren
// Kursen sein.
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "../i18n/index.jsx";
import { askPrompt, askConfirm } from "../core/dialog.jsx";
import { undoDelete } from "../core/undo.jsx";
import { AddButton, pageTitle, pageIntro, btnPrimary, btnSecondary, selectStyle, chipStyle, Icon, ICONS, iconBtn, COLORS as C, cardStyle, inputStyle, Toggle, Empty } from "../components/Icons.jsx";

const API = "/api";
const editLabel = { fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text3)", marginBottom: 6 };

export default function Kurse() {
  const { t } = useLanguage();
  const [kurse, setKurse] = useState([]);
  const [trash, setTrash] = useState([]);
  const [allClasses, setAllClasses] = useState([]);
  const [showTrash, setShowTrash] = useState(false);
  const [neu, setNeu] = useState("");
  const [editKurs, setEditKurs] = useState(null); // aufgeklappter Bearbeiten-Bereich (Name, E/G)
  const [editName, setEditName] = useState("");

  const load = () => fetch(`${API}/kurse`).then((r) => (r.ok ? r.json() : [])).then((d) => setKurse(Array.isArray(d) ? d : [])).catch(() => {});
  const loadTrash = () => fetch(`${API}/kurse/trash`).then((r) => (r.ok ? r.json() : [])).then((d) => setTrash(Array.isArray(d) ? d : [])).catch(() => {});
  const loadClasses = () => fetch(`${API}/classes`).then((r) => (r.ok ? r.json() : [])).then((d) => setAllClasses(Array.isArray(d) ? d : [])).catch(() => {});
  useEffect(() => { load(); loadTrash(); loadClasses(); }, []);

  const anlegen = async () => {
    const name = neu.trim(); if (!name) return;
    await fetch(`${API}/kurse`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).catch(() => {});
    setNeu(""); load();
  };
  const openEdit = (k) => { if (editKurs === k.id) { setEditKurs(null); } else { setEditKurs(k.id); setEditName(k.name); } };
  const saveName = async (k) => {
    const name = editName.trim();
    if (!name) return;
    await fetch(`${API}/kurse/${k.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).catch(() => {});
    load();
  };
  const setNiveauAktiv = async (k, val) => {
    await fetch(`${API}/kurse/${k.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: k.name, niveau_aktiv: val }) }).catch(() => {});
    load();
  };
  const addMember = async (kursId, classId) => { await fetch(`${API}/kurse/${kursId}/classes/${classId}`, { method: "POST" }).catch(() => {}); load(); };
  const removeMember = async (kursId, classId) => { await fetch(`${API}/kurse/${kursId}/classes/${classId}`, { method: "DELETE" }).catch(() => {}); load(); };
  const delKurs = (k) => {
    // Sofort aus der Liste, 5 s Undo-Toast; erst dann wirklich löschen.
    setKurse((prev) => prev.filter((x) => x.id !== k.id));
    undoDelete({
      message: t("undo.deleted", { name: k.name }),
      undo: () => load(),
      commit: async () => { await fetch(`${API}/kurse/${k.id}`, { method: "DELETE" }).catch(() => {}); loadTrash(); },
    });
  };
  const restore = async (id) => { await fetch(`${API}/kurse/${id}/restore`, { method: "POST" }).catch(() => {}); load(); loadTrash(); };
  const purge = async (id) => {
    if (!await askConfirm(t("kurse.purgeConfirm"))) return;
    await fetch(`${API}/kurse/${id}/purge`, { method: "DELETE" }).catch(() => {});
    loadTrash();
  };

  // Klassen, die (noch) nicht in diesem Kurs sind — zum Hinzufügen.
  const frei = (k) => { const drin = new Set(k.classes.map((c) => c.id)); return allClasses.filter((c) => !drin.has(c.id)); };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ ...pageTitle, marginBottom: 0, flex: 1 }}>{t("kurse.title")}</h1>
        {trash.length > 0 && <button onClick={() => setShowTrash((v) => !v)} style={btnSecondary}>{t("classes.trash")} ({trash.length})</button>}
      </div>
      <p style={pageIntro}>{t("kurse.intro")}</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <input value={neu} onChange={(e) => setNeu(e.target.value)} onKeyDown={(e) => e.key === "Enter" && anlegen()}
          placeholder={t("kurse.newPlaceholder")} style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
        <AddButton onClick={anlegen} title={t("kurse.add")} />
      </div>

      {showTrash && trash.length > 0 && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, marginBottom: 18, background: "var(--bg3)" }}>
          <p style={{ fontSize: 12.5, color: "var(--text3)", margin: "0 0 8px" }}>{t("kurse.trashHint")}</p>
          {trash.map((k) => (
            <div key={k.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: "1px solid var(--border)" }}>
              <span style={{ flex: 1, fontWeight: 500 }}>{k.name}</span>
              <button onClick={() => restore(k.id)} style={{ ...btnSecondary, padding: "4px 11px", fontSize: 12.5 }}>{t("classes.restore")}</button>
              <button onClick={() => purge(k.id)} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("classes.purge")}><Icon d={ICONS.trash} size={14} color={C.danger} /></button>
            </div>
          ))}
        </div>
      )}

      {kurse.length === 0 && <Empty title={t("kurse.emptyTitle")} hint={t("kurse.emptyHint")} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {kurse.map((k) => (
          <div key={k.id} style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <strong style={{ fontSize: 15, flex: 1 }}>{k.name}</strong>
              <button onClick={() => openEdit(k)} className="icon-btn" style={iconBtn} title={t("common.edit")}><Icon d={ICONS.edit} size={15} /></button>
            </div>
            {/* Zugeordnete Klasse wird NICHT mehr unter dem Kurs angezeigt —
                sie ist nicht nötig; Verwaltung läuft übers Bearbeiten. */}

            {/* Bearbeiten-Bereich (hinter dem Stift): klar gegliedert in Name,
                Klassen (hinzufügen/entfernen) und E/G. */}
            {editKurs === k.id && (
              <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <div style={editLabel}>{t("kurse.editName")}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={t("kurse.renamePrompt")}
                      onKeyDown={(e) => e.key === "Enter" && saveName(k)} style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
                    <button onClick={() => saveName(k)} style={btnPrimary}>{t("common.save")}</button>
                  </div>
                </div>

                <div>
                  <div style={editLabel}>{t("kurse.editClasses")}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {k.classes.map((c) => (
                      <span key={c.id} style={{ ...chipStyle, display: "inline-flex", alignItems: "center", gap: 4 }}>
                        {c.name}
                        <button onClick={() => removeMember(k.id, c.id)} title={t("kurse.unlink")}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", padding: 0, display: "flex" }}>
                          <Icon d={ICONS.close} size={12} />
                        </button>
                      </span>
                    ))}
                    {frei(k).length > 0 && (
                      <select value="" onChange={(e) => e.target.value && addMember(k.id, Number(e.target.value))} style={{ ...selectStyle, fontSize: 12.5 }}>
                        <option value="">+ {t("kurse.addClass")}</option>
                        {frei(k).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    )}
                  </div>
                </div>

                <div>
                  <div style={editLabel}>{t("kurse.editStudents")}</div>
                  <StudentMembers kursId={k.id} allClasses={allClasses} t={t} />
                </div>

                {k.classes.length > 0 && (
                  <div>
                    <div style={editLabel}>{t("kurse.editLevels")}</div>
                    <Toggle checked={!!k.niveau_aktiv} onChange={(v) => setNiveauAktiv(k, v)} label={t("kurse.niveauToggle")} />
                    {k.niveau_aktiv && <NiveauPanel kursId={k.id} t={t} />}
                  </div>
                )}
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                  <button onClick={() => delKurs(k)} style={{ ...btnSecondary, color: C.danger, display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Icon d={ICONS.trash} size={15} color={C.danger} /> {t("kurse.deleteKurs") !== "kurse.deleteKurs" ? t("kurse.deleteKurs") : t("common.delete")}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Einzelne SuS in einem Kurs (Kurs aus Teilen von Klassen): Chips der bereits
// gewählten SuS + Picker (Klasse wählen -> SuS einzeln hinzufügen).
function StudentMembers({ kursId, allClasses, t }) {
  const [members, setMembers] = useState([]);
  const [pickClass, setPickClass] = useState("");
  const load = () => fetch(`${API}/kurse/${kursId}/members`).then((r) => (r.ok ? r.json() : [])).then((d) => setMembers(Array.isArray(d) ? d : [])).catch(() => {});
  useEffect(() => { load(); }, [kursId]); // eslint-disable-line
  const memberIds = new Set(members.map((m) => m.student_id));
  const add = async (sid) => { await fetch(`${API}/kurse/${kursId}/members/${sid}`, { method: "POST" }).catch(() => {}); load(); };
  const remove = async (sid) => { await fetch(`${API}/kurse/${kursId}/members/${sid}`, { method: "DELETE" }).catch(() => {}); load(); };
  const cls = allClasses.find((c) => String(c.id) === String(pickClass));
  const candidates = cls ? (cls.students || []).filter((sname) => !memberIds.has(sname.id)) : [];
  return (
    <div>
      {members.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {members.map((m) => (
            <span key={m.student_id} style={{ ...chipStyle, display: "inline-flex", alignItems: "center", gap: 4 }}>
              {m.name} <span style={{ color: "var(--text3)", fontSize: 11 }}>· {m.class_name}</span>
              <button onClick={() => remove(m.student_id)} title={t("kurse.unlink")}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", padding: 0, display: "flex" }}>
                <Icon d={ICONS.close} size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <select value={pickClass} onChange={(e) => setPickClass(e.target.value)} style={{ ...selectStyle, fontSize: 12.5 }}>
          <option value="">{t("kurse.pickClass")}</option>
          {allClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {cls && candidates.map((sname) => (
          <button key={sname.id} onClick={() => add(sname.id)} style={{ ...chipStyle, cursor: "pointer", border: "1px dashed var(--border2)", background: "none" }}>+ {sname.name}</button>
        ))}
        {cls && candidates.length === 0 && <span style={{ fontSize: 12, color: "var(--text3)" }}>{t("kurse.allAdded")}</span>}
      </div>
    </div>
  );
}

// E/G je Person im Kurs. Setzt das Niveau kursweit (alle Fach-Klassen-Zeilen der
// Person), damit z.B. die Karteikarten-Niveaustapel überall greifen.
function NiveauPanel({ kursId, t }) {
  const [studs, setStuds] = useState(null);
  useEffect(() => {
    fetch(`${API}/kurse/${kursId}/students`).then((r) => (r.ok ? r.json() : [])).then((d) => setStuds(Array.isArray(d) ? d : [])).catch(() => setStuds([]));
  }, [kursId]);
  const setNiveau = async (name, niveau) => {
    setStuds((prev) => prev.map((s) => (s.name === name ? { ...s, niveau } : s)));
    await fetch(`${API}/kurse/${kursId}/niveau`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, niveau }) }).catch(() => {});
  };
  if (!studs) return null;
  if (studs.length === 0) return <p style={{ fontSize: 12.5, color: "var(--text3)", marginTop: 8 }}>{t("kurse.niveauNoStudents")}</p>;
  return (
    <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 6 }}>
      {studs.map((s) => (
        <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
          <select value={s.niveau || ""} onChange={(e) => setNiveau(s.name, e.target.value)}
            style={{ ...selectStyle, fontSize: 12.5, padding: "4px 24px 4px 8px" }}>
            <option value="">–</option>
            <option value="E">{t("classes.eCourse")}</option>
            <option value="G">{t("classes.gCourse")}</option>
          </select>
        </div>
      ))}
    </div>
  );
}
