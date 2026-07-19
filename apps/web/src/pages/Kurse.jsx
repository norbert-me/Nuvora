// Kurse (Lerngruppen) verwalten. Ein Kurs teilt SuS + Anwesenheit über seine
// Sharing-Klassen; zusätzlich kann eine Klasse als loses Tag in weitere Kurse
// (nur Gruppierung, kein Sharing). Karten/Noten bleiben pro Fach-Klasse.
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "../i18n/index.jsx";
import { askPrompt, askConfirm } from "../core/dialog.jsx";
import { pageTitle, pageIntro, btnPrimary, btnSecondary, selectStyle, chipStyle, Icon, ICONS, iconBtn, COLORS as C, cardStyle, inputStyle } from "../components/Icons.jsx";

const API = "/api";

export default function Kurse() {
  const { t } = useLanguage();
  const [kurse, setKurse] = useState([]);
  const [trash, setTrash] = useState([]);
  const [showTrash, setShowTrash] = useState(false);
  const [neu, setNeu] = useState("");

  const load = () => fetch(`${API}/kurse`).then((r) => (r.ok ? r.json() : [])).then((d) => setKurse(Array.isArray(d) ? d : [])).catch(() => {});
  const loadTrash = () => fetch(`${API}/kurse/trash`).then((r) => (r.ok ? r.json() : [])).then((d) => setTrash(Array.isArray(d) ? d : [])).catch(() => {});
  useEffect(() => { load(); loadTrash(); }, []);

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
  const assign = async (kursId, classId) => { await fetch(`${API}/kurse/${kursId}/classes/${classId}`, { method: "POST" }).catch(() => {}); load(); };
  const unlink = async (classId) => { await fetch(`${API}/kurse/classes/${classId}`, { method: "DELETE" }).catch(() => {}); load(); };
  const addTag = async (kursId, classId) => { await fetch(`${API}/kurse/${kursId}/tag/${classId}`, { method: "POST" }).catch(() => {}); load(); };
  const removeTag = async (kursId, classId) => { await fetch(`${API}/kurse/${kursId}/tag/${classId}`, { method: "DELETE" }).catch(() => {}); load(); };
  const delKurs = async (k) => {
    if (!await askConfirm(t("kurse.delConfirm", { name: k.name }))) return;
    await fetch(`${API}/kurse/${k.id}`, { method: "DELETE" }).catch(() => {});
    load(); loadTrash();
  };
  const restore = async (id) => { await fetch(`${API}/kurse/${id}/restore`, { method: "POST" }).catch(() => {}); load(); loadTrash(); };
  const purge = async (id) => {
    if (!await askConfirm(t("kurse.purgeConfirm"))) return;
    await fetch(`${API}/kurse/${id}/purge`, { method: "DELETE" }).catch(() => {});
    loadTrash();
  };

  // Alle Klassen (einmal je Klasse, über die Sharing-Zugehörigkeit).
  const alleKlassen = [];
  const gesehen = new Set();
  kurse.forEach((k) => k.classes.forEach((c) => { if (c.shared && !gesehen.has(c.id)) { gesehen.add(c.id); alleKlassen.push(c); } }));
  // Klassen, die zu einem Kurs (als Sharing ODER Tag) hinzugefügt werden können.
  const frei = (k) => { const drin = new Set(k.classes.map((c) => c.id)); return alleKlassen.filter((c) => !drin.has(c.id)); };

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
                <span key={`${c.id}-${c.shared}`} title={c.shared ? t("kurse.sharedHint") : t("kurse.tagHint")}
                  style={{ ...chipStyle, display: "inline-flex", alignItems: "center", gap: 4,
                    ...(c.shared ? {} : { background: "transparent", border: "1px dashed var(--border2)", color: "var(--text3)" }) }}>
                  {!c.shared && "# "}{c.name}
                  <button onClick={() => (c.shared ? unlink(c.id) : removeTag(k.id, c.id))} title={c.shared ? t("kurse.unlink") : t("kurse.untag")}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", padding: 0, display: "flex" }}>
                    <Icon d={ICONS.close} size={12} />
                  </button>
                </span>
              ))}
            </div>
            {frei(k).length > 0 && (
              <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                <select value="" onChange={(e) => e.target.value && assign(k.id, Number(e.target.value))} style={{ ...selectStyle, fontSize: 12.5 }}>
                  <option value="">+ {t("kurse.addShared")}</option>
                  {frei(k).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select value="" onChange={(e) => e.target.value && addTag(k.id, Number(e.target.value))} style={{ ...selectStyle, fontSize: 12.5 }}>
                  <option value="">+ {t("kurse.addTag")}</option>
                  {frei(k).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
