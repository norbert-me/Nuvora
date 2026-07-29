// Modul Notizblock — freie Notizzettel (Titel + Text). Autospeichern, mehrere
// Zettel, per Drag&Drop sortierbar. Eigenständig (Regel 3), keine Schülerbindung.
import { useState, useEffect, useRef } from "react";
import { pageTitle, btnPrimary, inputStyle, Icon, ICONS, iconBtn, COLORS as C, Empty } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

const API = "/api/notizblock";

export default function Notizblock({ embedded } = {}) {
  const { t } = useLanguage();
  const [notes, setNotes] = useState([]);
  const saveTimers = useRef({});

  const load = () => fetch(API).then((r) => (r.ok ? r.json() : [])).then((d) => setNotes(Array.isArray(d) ? d : [])).catch(() => {});
  useEffect(() => { load(); return () => Object.values(saveTimers.current).forEach(clearTimeout); }, []);

  const add = async () => {
    const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "", content: "" }) }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (r) setNotes((p) => [r, ...p]);
  };
  const del = async (id) => { setNotes((p) => p.filter((n) => n.id !== id)); await fetch(`${API}/${id}`, { method: "DELETE" }).catch(() => {}); };
  // Lokal sofort ändern, Server gebündelt (debounced) nachziehen.
  const patch = (id, field, value) => {
    setNotes((p) => p.map((n) => (n.id === id ? { ...n, [field]: value } : n)));
    clearTimeout(saveTimers.current[id]);
    saveTimers.current[id] = setTimeout(() => {
      fetch(`${API}/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: value }) }).catch(() => {});
    }, 600);
  };

  // Drag&Drop mit Vorschau (stabile Arbeits-Liste im Ref).
  const dragIdx = useRef(null); const dragWork = useRef(null);
  const [preview, setPreview] = useState(null);
  const reorderPreview = (from, to) => { if (from == null || from === to || !dragWork.current) return; const a = dragWork.current; const [m] = a.splice(from, 1); a.splice(to, 0, m); setPreview([...a]); };
  const commit = async () => { const arr = dragWork.current; if (!arr) return; setNotes(arr); setPreview(null); const ids = arr.map((x) => x.id); dragIdx.current = null; dragWork.current = null; await fetch(`${API}/reorder`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => {}); };
  const dnd = (idx) => ({
    onDragStart: () => { dragWork.current = [...(preview || notes)]; dragIdx.current = idx; },
    onDragOver: (e) => { if (dragIdx.current == null) return; e.preventDefault(); if (idx !== dragIdx.current) { reorderPreview(dragIdx.current, idx); dragIdx.current = idx; } },
    onDrop: (e) => { e.preventDefault(); commit(); },
    onDragEnd: () => { setPreview(null); dragIdx.current = null; dragWork.current = null; },
  });

  const view = preview || notes;
  return (
    <div style={{ maxWidth: embedded ? "none" : 900, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        {embedded ? <span style={{ flex: 1 }} /> : <h1 style={{ ...pageTitle, marginBottom: 0, flex: 1 }}>{t("notizblock.title")}</h1>}
        <button onClick={add} style={{ ...btnPrimary, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon d={ICONS.plus} size={15} color="#fff" /> {t("notizblock.new")}</button>
      </div>

      {view.length === 0 ? (
        <Empty title={t("notizblock.empty")} hint={t("notizblock.emptyHint")} action={t("notizblock.new")} onAction={add} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
          {view.map((n, idx) => (
            <div key={n.id} draggable {...dnd(idx)}
              style={{ display: "flex", flexDirection: "column", border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)", padding: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span className="drag-handle" title={t("notizblock.reorderHint")} style={{ color: "var(--text3)", cursor: "grab", display: "inline-flex", flexShrink: 0 }}><Icon d={ICONS.grip} size={15} /></span>
                <input value={n.title} onChange={(e) => patch(n.id, "title", e.target.value)} placeholder={t("notizblock.titlePlaceholder")}
                  style={{ ...inputStyle, flex: 1, minWidth: 0, fontWeight: 700, padding: "6px 8px", border: "none", background: "transparent" }} />
                <button onClick={() => del(n.id)} className="icon-btn" style={{ ...iconBtn, padding: 4, flexShrink: 0 }} title={t("common.delete")}><Icon d={ICONS.trash} size={15} color={C.danger} /></button>
              </div>
              <textarea value={n.content} onChange={(e) => patch(n.id, "content", e.target.value)} placeholder={t("notizblock.placeholder")} rows={7}
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical", fontSize: 13.5, lineHeight: 1.5, border: "none", background: "transparent", padding: "4px 8px" }} />
            </div>
          ))}
        </div>
      )}
      <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 14 }}>{t("notizblock.autosave")}</p>
    </div>
  );
}
