// Modul Methoden — Sammlung von Unterrichtseinstiegen und -methoden.
// Wiederverwendbar; im Kalender einer Stunde zuweisbar.
import { useState, useEffect } from "react";
import { Icon, ICONS, iconBtn, btnPrimary, btnSecondary, pageTitle, COLORS as C } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

const API = "/api/methoden";

export default function Methoden() {
  const { t } = useLanguage();
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("all"); // all | einstieg | methode
  const [edit, setEdit] = useState(null); // { id?, kind, title, description, phase } | null
  const [error, setError] = useState("");

  const load = () => fetch(`${API}/list`).then((r) => (r.ok ? r.json() : [])).then((d) => setItems(Array.isArray(d) ? d : [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async (m) => {
    setError("");
    const body = { kind: m.kind || "einstieg", title: (m.title || "").trim(), description: m.description || "", phase: m.phase || "" };
    if (!body.title) { setError(t("methoden.titleRequired")); return; }
    const res = await fetch(m.id ? `${API}/${m.id}` : `${API}/`, {
      method: m.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).catch(() => null);
    if (res && res.ok) { setEdit(null); load(); } else setError(t("common.notWork"));
  };
  const remove = async (id) => { await fetch(`${API}/${id}`, { method: "DELETE" }).catch(() => {}); load(); };

  const shown = items.filter((m) => filter === "all" || m.kind === filter);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <h1 style={pageTitle}>{t("methoden.title")}</h1>
        <div style={{ display: "inline-flex", border: "1px solid var(--border2)", borderRadius: 980, overflow: "hidden" }}>
          {[["all", t("methoden.all")], ["einstieg", t("methoden.einstiege")], ["methode", t("methoden.methoden")]].map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)} style={{ padding: "6px 14px", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", background: filter === v ? "var(--accent)" : "transparent", color: filter === v ? "#fff" : "var(--text2)" }}>{l}</button>
          ))}
        </div>
        <button onClick={() => setEdit({ kind: filter === "methode" ? "methode" : "einstieg" })} style={{ ...btnPrimary, marginLeft: "auto" }}>{t("methoden.new")}</button>
      </div>

      {error && <p style={{ color: "var(--danger, #dc2626)", fontSize: 13, marginBottom: 10 }}>{error}</p>}

      {shown.length === 0 ? (
        <p style={{ fontSize: 13.5, color: "var(--text3)" }}>{t("methoden.empty")}</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {shown.map((m) => (
            <div key={m.id} style={{ padding: 16, border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 980, background: m.kind === "einstieg" ? "rgba(37,99,235,0.12)" : "rgba(10,125,62,0.12)", color: m.kind === "einstieg" ? "#2563eb" : "#0a7d3e" }}>
                  {m.kind === "einstieg" ? t("methoden.einstieg") : t("methoden.methode")}
                </span>
                {m.phase && <span style={{ fontSize: 11, color: "var(--text3)" }}>{m.phase}</span>}
                <span style={{ flex: 1 }} />
                <button onClick={() => setEdit(m)} className="icon-btn" style={{ ...iconBtn, padding: 3 }} title={t("common.edit")}><Icon d={ICONS.edit} size={14} /></button>
                <button onClick={() => { if (confirm(t("methoden.delConfirm", { title: m.title }))) remove(m.id); }} className="icon-btn" style={{ ...iconBtn, padding: 3 }} title={t("common.delete")}><Icon d={ICONS.trash} color={C.danger} size={14} /></button>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{m.title}</div>
              {m.description && <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{m.description}</div>}
            </div>
          ))}
        </div>
      )}

      {edit && <MethodModal m={edit} onSave={save} onClose={() => setEdit(null)} t={t} />}
    </div>
  );
}

function MethodModal({ m, onSave, onClose, t }) {
  const [kind, setKind] = useState(m.kind || "einstieg");
  const [title, setTitle] = useState(m.title || "");
  const [description, setDescription] = useState(m.description || "");
  const [phase, setPhase] = useState(m.phase || "");
  const fld = { width: "100%", padding: 9, border: "1px solid var(--border2)", borderRadius: 8, fontSize: 14, background: "var(--bg)", color: "var(--text)", boxSizing: "border-box" };
  const lbl = { fontSize: 12.5, color: "var(--text2)", margin: "12px 0 5px" };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 200 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--card)", borderRadius: 16, maxWidth: 460, width: "100%", padding: 22, border: "1px solid var(--border)", maxHeight: "85vh", overflow: "auto" }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{m.id ? t("methoden.edit") : t("methoden.new")}</h3>
        <div style={{ ...lbl, marginTop: 0 }}>{t("methoden.kind")}</div>
        <div style={{ display: "inline-flex", border: "1px solid var(--border2)", borderRadius: 980, overflow: "hidden" }}>
          {[["einstieg", t("methoden.einstieg")], ["methode", t("methoden.methode")]].map(([v, l]) => (
            <button key={v} onClick={() => setKind(v)} style={{ padding: "6px 14px", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", background: kind === v ? "var(--accent)" : "transparent", color: kind === v ? "#fff" : "var(--text2)" }}>{l}</button>
          ))}
        </div>
        <div style={lbl}>{t("methoden.titleField")}</div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus style={fld} />
        <div style={lbl}>{t("methoden.phase")}</div>
        <input value={phase} onChange={(e) => setPhase(e.target.value)} placeholder={t("methoden.phasePlaceholder")} style={fld} />
        <div style={lbl}>{t("methoden.description")}</div>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} style={{ ...fld, resize: "vertical" }} />
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button onClick={() => onSave({ id: m.id, kind, title, description, phase })} style={btnPrimary}>{t("common.save")}</button>
          <button onClick={onClose} style={btnSecondary}>{t("common.abort")}</button>
        </div>
      </div>
    </div>
  );
}
