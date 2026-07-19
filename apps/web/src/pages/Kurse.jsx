// Kurse (Lerngruppen) verwalten — Phase 1: Fach-Klassen zu einem Kurs gruppieren.
// Klassen im selben Kurs teilen später Schülerliste + Anwesenheit; Karten/Noten
// bleiben pro Fach-Klasse.
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "../i18n/index.jsx";
import { askPrompt } from "../core/dialog.jsx";
import { pageTitle, pageIntro, btnPrimary, btnSecondary, selectStyle, chipStyle, Icon, ICONS, iconBtn, COLORS as C, cardStyle } from "../components/Icons.jsx";

const API = "/api";

export default function Kurse() {
  const { t } = useLanguage();
  const [kurse, setKurse] = useState([]);
  const [neu, setNeu] = useState("");

  const load = () => fetch(`${API}/kurse`).then((r) => (r.ok ? r.json() : [])).then((d) => setKurse(Array.isArray(d) ? d : [])).catch(() => {});
  useEffect(() => { load(); }, []);

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

  // Klassen, die (noch) nicht in diesem Kurs sind — zum Hinzufügen.
  const andere = (kursId) => kurse.filter((k) => k.id !== kursId).flatMap((k) => k.classes);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ ...pageTitle, marginBottom: 0, flex: 1 }}>{t("kurse.title")}</h1>
        <Link to="/classes" style={{ ...btnSecondary, textDecoration: "none" }}>{t("nav.classes")}</Link>
      </div>
      <p style={pageIntro}>{t("kurse.intro")}</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <input value={neu} onChange={(e) => setNeu(e.target.value)} onKeyDown={(e) => e.key === "Enter" && anlegen()}
          placeholder={t("kurse.newPlaceholder")} style={{ flex: 1, minWidth: 200, padding: "9px 12px", border: "1px solid var(--border2)", borderRadius: 10, fontSize: 14, background: "var(--bg)", color: "var(--text)", boxSizing: "border-box" }} />
        <button onClick={anlegen} style={btnPrimary}>{t("kurse.add")}</button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {kurse.map((k) => (
          <div key={k.id} style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <strong style={{ fontSize: 15, flex: 1 }}>{k.name}</strong>
              <button onClick={() => rename(k)} className="icon-btn" style={iconBtn} title={t("common.rename")}><Icon d={ICONS.edit} size={15} /></button>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {k.classes.length === 0 && <span style={{ fontSize: 12.5, color: "var(--text3)" }}>{t("kurse.empty")}</span>}
              {k.classes.map((c) => (
                <span key={c.id} style={{ ...chipStyle, display: "inline-flex", alignItems: "center", gap: 4 }}>
                  {c.name}
                  {k.classes.length > 1 && (
                    <button onClick={() => unlink(c.id)} title={t("kurse.unlink")} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", padding: 0, display: "flex" }}>
                      <Icon d={ICONS.close} size={12} />
                    </button>
                  )}
                </span>
              ))}
              {andere(k.id).length > 0 && (
                <select value="" onChange={(e) => e.target.value && assign(k.id, Number(e.target.value))} style={{ ...selectStyle, fontSize: 12.5 }}>
                  <option value="">+ {t("kurse.addClass")}</option>
                  {andere(k.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
