// Modul Einstiege — Sammlung von Ideen fuer den Unterrichtseinstieg.
// Je Einstieg: Idee (Text), Ablauf mit Material, Materialliste, ca. Dauer.
// Wiederverwendbar; im Kalender einer Stunde zuweisbar.
import { useState, useEffect } from "react";
import { Icon, ICONS, iconBtn, btnPrimary, btnSecondary, pageTitle, COLORS as C } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

const API = "/api/methoden";

export default function Methoden() {
  const { t } = useLanguage();
  const [items, setItems] = useState([]);
  const [edit, setEdit] = useState(null); // { id?, title, description, ablauf, material, dauer } | null
  const [error, setError] = useState("");

  const load = () => fetch(`${API}/list`).then((r) => (r.ok ? r.json() : [])).then((d) => setItems(Array.isArray(d) ? d : [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async (m) => {
    setError("");
    const body = {
      title: (m.title || "").trim(), description: m.description || "",
      ablauf: m.ablauf || "", material: m.material || "",
      dauer: m.dauer === "" || m.dauer == null ? null : Number(m.dauer),
    };
    if (!body.title) { setError(t("methoden.titleRequired")); return; }
    const res = await fetch(m.id ? `${API}/${m.id}` : `${API}/`, {
      method: m.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).catch(() => null);
    if (res && res.ok) { setEdit(null); load(); } else setError(t("common.notWork"));
  };
  const remove = async (id) => { await fetch(`${API}/${id}`, { method: "DELETE" }).catch(() => {}); load(); };

  const doExport = async () => {
    const r = await fetch(`${API}/export`).catch(() => null);
    if (!r || !r.ok) return;
    const blob = await r.blob(); const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "einstiege.json"; a.click(); URL.revokeObjectURL(a.href);
  };
  const doImport = async (file) => {
    setError("");
    try {
      const data = JSON.parse(await file.text());
      const r = await fetch(`${API}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (r.ok) load(); else setError(t("common.notWork"));
    } catch { setError(t("methoden.importError")); }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <h1 style={pageTitle}>{t("methoden.title")}</h1>
        <span style={{ flex: 1 }} />
        <button onClick={doExport} style={btnSecondary}>{t("common.export")}</button>
        <label style={{ ...btnSecondary, cursor: "pointer" }}>{t("common.import")}
          <input type="file" accept=".json,application/json" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) doImport(e.target.files[0]); e.target.value = ""; }} />
        </label>
        <button onClick={() => setEdit({})} style={btnPrimary}>{t("methoden.new")}</button>
      </div>
      <p style={{ fontSize: 13.5, color: "var(--text2)", margin: "0 0 18px", maxWidth: 640 }}>{t("methoden.intro")}</p>

      {error && <p style={{ color: "var(--danger, #dc2626)", fontSize: 13, marginBottom: 10 }}>{error}</p>}

      {items.length === 0 ? (
        <p style={{ fontSize: 13.5, color: "var(--text3)" }}>{t("methoden.empty")}</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {items.map((m) => (
            <div key={m.id} style={{ padding: 16, border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{m.title}</div>
                {m.dauer != null && <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 980, background: "rgba(37,99,235,0.12)", color: "#2563eb" }}>{t("methoden.dauerBadge", { n: m.dauer })}</span>}
                <span style={{ flex: 1 }} />
                <button onClick={async () => {
                  const description = window.prompt(t("methoden.publishPrompt")); if (description === null) return;
                  const r = await fetch(`/api/marketplace/publish/method`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method_id: m.id, description }) }).catch(() => null);
                  alert(r && r.ok ? t("methoden.published") : t("methoden.publishError"));
                }} className="icon-btn" style={{ ...iconBtn, padding: 3 }} title={t("methoden.publish")}><Icon d={ICONS.export} size={14} color="var(--accent)" /></button>
                <button onClick={() => setEdit(m)} className="icon-btn" style={{ ...iconBtn, padding: 3 }} title={t("common.edit")}><Icon d={ICONS.edit} size={14} /></button>
                <button onClick={() => { if (confirm(t("methoden.delConfirm", { title: m.title }))) remove(m.id); }} className="icon-btn" style={{ ...iconBtn, padding: 3 }} title={t("common.delete")}><Icon d={ICONS.trash} color={C.danger} size={14} /></button>
              </div>
              {m.description && <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{m.description}</div>}
              {m.ablauf && (<>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.5px", margin: "10px 0 3px" }}>{t("methoden.ablauf")}</div>
                <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{m.ablauf}</div>
              </>)}
              {m.material && (<>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.5px", margin: "10px 0 3px" }}>{t("methoden.material")}</div>
                <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{m.material}</div>
              </>)}
            </div>
          ))}
        </div>
      )}

      {edit && <MethodModal m={edit} onSave={save} onClose={() => setEdit(null)} t={t} />}
    </div>
  );
}

function MethodModal({ m, onSave, onClose, t }) {
  const [title, setTitle] = useState(m.title || "");
  const [dauer, setDauer] = useState(m.dauer ?? "");
  const [description, setDescription] = useState(m.description || "");
  const [ablauf, setAblauf] = useState(m.ablauf || "");
  const [material, setMaterial] = useState(m.material || "");
  const fld = { width: "100%", padding: 9, border: "1px solid var(--border2)", borderRadius: 8, fontSize: 14, background: "var(--bg)", color: "var(--text)", boxSizing: "border-box" };
  const lbl = { fontSize: 12.5, color: "var(--text2)", margin: "12px 0 5px" };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 200 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--card)", borderRadius: 16, maxWidth: 480, width: "100%", padding: 22, border: "1px solid var(--border)", maxHeight: "88vh", overflow: "auto" }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{m.id ? t("methoden.edit") : t("methoden.new")}</h3>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ ...lbl, marginTop: 0 }}>{t("methoden.titleField")}</div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus style={fld} />
          </div>
          <div style={{ width: 120 }}>
            <div style={{ ...lbl, marginTop: 0 }}>{t("methoden.dauer")}</div>
            <input type="number" min="0" value={dauer} onChange={(e) => setDauer(e.target.value)} placeholder={t("methoden.dauerPlaceholder")} style={fld} />
          </div>
        </div>
        <div style={lbl}>{t("methoden.idee")}</div>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder={t("methoden.ideePlaceholder")} style={{ ...fld, resize: "vertical" }} />
        <div style={lbl}>{t("methoden.ablauf")}</div>
        <textarea value={ablauf} onChange={(e) => setAblauf(e.target.value)} rows={4} placeholder={t("methoden.ablaufPlaceholder")} style={{ ...fld, resize: "vertical" }} />
        <div style={lbl}>{t("methoden.material")}</div>
        <textarea value={material} onChange={(e) => setMaterial(e.target.value)} rows={2} placeholder={t("methoden.materialPlaceholder")} style={{ ...fld, resize: "vertical" }} />
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button onClick={() => onSave({ id: m.id, title, description, ablauf, material, dauer })} style={btnPrimary}>{t("common.save")}</button>
          <button onClick={onClose} style={btnSecondary}>{t("common.abort")}</button>
        </div>
      </div>
    </div>
  );
}
