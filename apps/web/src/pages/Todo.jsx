// Modul To-do — einfache Aufgabenliste. Ein Eintrag kann Datum + Uhrzeit tragen;
// datierte Einträge erscheinen zusätzlich im Kalender (Regel 3: reine Zusatz-
// Brücke, die Liste läuft eigenständig).
import { useState, useEffect, useRef } from "react";
import { pageTitle, btnPrimary, btnSecondary, inputStyle, Icon, ICONS, iconBtn, COLORS as C, Empty } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

const API = "/api/todo";

export default function Todo({ embedded } = {}) {
  const { t } = useLanguage();
  const [items, setItems] = useState([]);
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [editId, setEditId] = useState(null);
  const [eText, setEText] = useState("");
  const [eDate, setEDate] = useState("");
  const [eTime, setETime] = useState("");

  const load = () => fetch(API).then((r) => (r.ok ? r.json() : [])).then((d) => setItems(Array.isArray(d) ? d : [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const add = async () => {
    const v = text.trim();
    if (!v) return;
    await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: v, due_date: date || null, due_time: date ? (time || "") : "" }) }).catch(() => {});
    setText(""); setDate(""); setTime(""); load();
  };
  const toggle = async (it) => { await fetch(`${API}/${it.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ done: !it.done }) }).catch(() => {}); load(); };
  const del = async (id) => { await fetch(`${API}/${id}`, { method: "DELETE" }).catch(() => {}); load(); };
  const startEdit = (it) => { setEditId(it.id); setEText(it.text); setEDate(it.due_date || ""); setETime(it.due_time || ""); };
  const saveEdit = async () => {
    if (!eText.trim()) return;
    await fetch(`${API}/${editId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: eText.trim(), due_date: eDate || "", due_time: eDate ? (eTime || "") : "" }) }).catch(() => {});
    setEditId(null); load();
  };

  const fmtDate = (iso) => { try { return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "2-digit", month: "short" }); } catch { return iso; } };
  const offen = items.filter((i) => !i.done);
  const erledigt = items.filter((i) => i.done);

  // Drag&Drop der offenen To-dos mit Live-Vorschau (stabile Arbeits-Liste im Ref,
  // damit das Ablegen genau die vorgeschaute Reihenfolge speichert).
  const dragIdx = useRef(null);
  const dragWork = useRef(null);
  const [previewOpen, setPreviewOpen] = useState(null);
  const reorderPreview = (from, to) => {
    if (from == null || from === to || !dragWork.current) return;
    const a = dragWork.current;
    const [m] = a.splice(from, 1);
    a.splice(to, 0, m);
    setPreviewOpen([...a]);
  };
  const commitOrder = async () => {
    const arr = dragWork.current;
    if (!arr) return;
    setItems((prev) => [...arr, ...prev.filter((x) => x.done)]);  // offen neu, erledigt hinten
    setPreviewOpen(null);
    const ids = arr.map((x) => x.id);
    dragIdx.current = null; dragWork.current = null;
    await fetch(`${API}/reorder`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => {});
  };
  const dndFor = (idx) => ({
    draggable: editId == null,
    onDragStart: () => { dragWork.current = [...(previewOpen || offen)]; dragIdx.current = idx; },
    onDragOver: (e) => { if (dragIdx.current == null) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (idx !== dragIdx.current) { reorderPreview(dragIdx.current, idx); dragIdx.current = idx; } },
    onDrop: (e) => { e.preventDefault(); commitOrder(); },
    onDragEnd: () => { setPreviewOpen(null); dragIdx.current = null; dragWork.current = null; },
  });

  const Row = (it, dnd) => {
    if (editId === it.id) {
      return (
        <div key={it.id} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "8px 10px", border: "1px solid var(--accent)", borderRadius: 10, marginBottom: 6 }}>
          <input value={eText} onChange={(e) => setEText(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditId(null); }} style={{ ...inputStyle, flex: 1, minWidth: 140 }} />
          <input type="date" value={eDate} onChange={(e) => setEDate(e.target.value)} style={{ ...inputStyle, padding: "8px 8px" }} />
          {eDate && <input type="time" value={eTime} onChange={(e) => setETime(e.target.value)} style={{ ...inputStyle, padding: "8px 8px" }} />}
          <button onClick={saveEdit} style={{ ...btnPrimary, padding: "6px 12px" }}>{t("common.save")}</button>
          <button onClick={() => setEditId(null)} style={{ ...btnSecondary, padding: "6px 12px" }}>{t("common.abort")}</button>
        </div>
      );
    }
    return (
      <div key={it.id} {...(dnd || {})} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--card)", marginBottom: 6, cursor: dnd ? "grab" : "default" }}>
        {dnd && <span className="drag-handle" title={t("todo.reorderHint")} style={{ color: "var(--text3)", flexShrink: 0, display: "inline-flex", cursor: "grab" }}><Icon d={ICONS.grip} size={15} /></span>}
        <input type="checkbox" checked={it.done} onChange={() => toggle(it)} style={{ width: 18, height: 18, cursor: "pointer", flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, textDecoration: it.done ? "line-through" : "none", color: it.done ? "var(--text3)" : "var(--text)" }}>{it.text}</span>
        {it.due_date && (
          <span style={{ fontSize: 12, fontWeight: 600, padding: "2px 9px", borderRadius: 980, background: "var(--accent-bg, rgba(10,132,255,0.12))", color: "var(--accent)", flexShrink: 0, whiteSpace: "nowrap" }}>
            {fmtDate(it.due_date)}{it.due_time ? ` · ${it.due_time}` : ""}
          </span>
        )}
        <button onClick={() => startEdit(it)} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("common.edit")}><Icon d={ICONS.edit} size={15} /></button>
        <button onClick={() => del(it.id)} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("common.delete")}><Icon d={ICONS.trash} size={15} color={C.danger} /></button>
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 640, margin: embedded ? 0 : "0 auto" }}>
      {!embedded && <h1 style={pageTitle}>{t("todo.title")}</h1>}

      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 18 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder={t("todo.placeholder")} style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} title={t("todo.dateHint")} style={{ ...inputStyle, padding: "9px 8px" }} />
        {date && <input type="time" value={time} onChange={(e) => setTime(e.target.value)} title={t("todo.timeHint")} style={{ ...inputStyle, padding: "9px 8px" }} />}
        <button onClick={add} disabled={!text.trim()} style={{ ...btnPrimary, opacity: text.trim() ? 1 : 0.5 }}>{t("common.add")}</button>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--text3)", marginTop: -10, marginBottom: 16 }}>{t("todo.calHint")}</p>

      {items.length === 0 ? (
        <Empty title={t("todo.empty")} hint={t("todo.emptyHint")} />
      ) : (
        <>
          {(previewOpen || offen).map((it, idx) => Row(it, dndFor(idx)))}
          {erledigt.length > 0 && (
            <>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.4, margin: "18px 0 8px" }}>{t("todo.done")} ({erledigt.length})</div>
              {erledigt.map((it) => Row(it, null))}
            </>
          )}
        </>
      )}
    </div>
  );
}
