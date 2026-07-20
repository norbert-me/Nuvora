// Kurse (Lerngruppen) verwalten. Klassen im selben Kurs teilen SuS + Anwesenheit
// (per Name); Karten/Noten bleiben pro Fach-Klasse. Eine Klasse darf in mehreren
// Kursen sein.
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "../i18n/index.jsx";
import { askPrompt, askConfirm } from "../core/dialog.jsx";
import { pageTitle, pageIntro, btnPrimary, btnSecondary, selectStyle, chipStyle, Icon, ICONS, iconBtn, COLORS as C, cardStyle, inputStyle, Toggle } from "../components/Icons.jsx";

const API = "/api";

export default function Kurse() {
  const { t } = useLanguage();
  const [kurse, setKurse] = useState([]);
  const [trash, setTrash] = useState([]);
  const [allClasses, setAllClasses] = useState([]);
  const [showTrash, setShowTrash] = useState(false);
  const [neu, setNeu] = useState("");

  const load = () => fetch(`${API}/kurse`).then((r) => (r.ok ? r.json() : [])).then((d) => setKurse(Array.isArray(d) ? d : [])).catch(() => {});
  const loadTrash = () => fetch(`${API}/kurse/trash`).then((r) => (r.ok ? r.json() : [])).then((d) => setTrash(Array.isArray(d) ? d : [])).catch(() => {});
  const loadClasses = () => fetch(`${API}/classes`).then((r) => (r.ok ? r.json() : [])).then((d) => setAllClasses(Array.isArray(d) ? d : [])).catch(() => {});
  useEffect(() => { load(); loadTrash(); loadClasses(); }, []);

  const anlegen = async () => {
    const name = neu.trim(); if (!name) return;
    await fetch(`${API}/kurse`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).catch(() => {});
    setNeu(""); load();
  };
  const rename = async (k) => {
    const name = await askPrompt(t("kurse.renamePrompt"), { initial: k.name });
    if (name == null || !name.trim()) return;
    await fetch(`${API}/kurse/${k.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) }).catch(() => {});
    load();
  };
  const setNiveauAktiv = async (k, val) => {
    await fetch(`${API}/kurse/${k.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: k.name, niveau_aktiv: val }) }).catch(() => {});
    load();
  };
  const addMember = async (kursId, classId) => { await fetch(`${API}/kurse/${kursId}/classes/${classId}`, { method: "POST" }).catch(() => {}); load(); };
  const removeMember = async (kursId, classId) => { await fetch(`${API}/kurse/${kursId}/classes/${classId}`, { method: "DELETE" }).catch(() => {}); load(); };
  const delKurs = async (k) => {
    if (!await askConfirm(t("kurse.delConfirm", { name: k.name }))) return;
    const r = await fetch(`${API}/kurse/${k.id}`, { method: "DELETE" }).catch(() => null);
    if (r && r.ok) setKurse((prev) => prev.filter((x) => x.id !== k.id)); // sofort weg
    loadTrash(); load();
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
        <Link to="/classes" style={{ ...btnSecondary, textDecoration: "none" }}>{t("nav.classes")}</Link>
      </div>
      <p style={pageIntro}>{t("kurse.intro")}</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <input value={neu} onChange={(e) => setNeu(e.target.value)} onKeyDown={(e) => e.key === "Enter" && anlegen()}
          placeholder={t("kurse.newPlaceholder")} style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
        <button onClick={anlegen} style={btnPrimary}>{t("kurse.add")}</button>
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

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {kurse.map((k) => (
          <div key={k.id} style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <strong style={{ fontSize: 15, flex: 1 }}>{k.name}</strong>
              <button onClick={() => rename(k)} className="icon-btn" style={iconBtn} title={t("common.rename")}><Icon d={ICONS.edit} size={15} /></button>
              <button onClick={() => delKurs(k)} className="icon-btn" style={iconBtn} title={t("common.delete")}><Icon d={ICONS.trash} size={15} color={C.danger} /></button>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {k.classes.length === 0 && <span style={{ fontSize: 12.5, color: "var(--text3)" }}>{t("kurse.empty")}</span>}
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
            {k.classes.length > 0 && (
              <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                <Toggle checked={!!k.niveau_aktiv} onChange={(v) => setNiveauAktiv(k, v)} label={t("kurse.niveauToggle")} />
                {k.niveau_aktiv && <NiveauPanel kursId={k.id} t={t} />}
              </div>
            )}
          </div>
        ))}
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
