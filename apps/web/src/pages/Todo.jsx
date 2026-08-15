// Modul To-do — einfache Aufgabenliste. Ein Eintrag kann Datum + Uhrzeit tragen;
// datierte Einträge erscheinen zusätzlich im Kalender (Regel 3: reine Zusatz-
// Brücke, die Liste läuft eigenständig).
import { useState, useEffect, useRef } from "react";
import { pageTitle, cardStyle, chipStyle, sectionLabel, toolbarBtn, toolbarBtnPrimary, toolbarInput, CONTROL_R, Icon, ICONS, iconBtn, toolbarIconBtn, COLORS as C, Empty } from "../components/Icons.jsx";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { sende } from "../core/melden.js";
import { useAktiv } from "../core/modules.js";

const API = "/api/todo";

// Eine Höhe, eine Form für die Eingabeleiste — vorher standen Textfeld (38),
// Icon-Knöpfe (30) und Datumsfeld (~36) mit drei Radien nebeneinander. Beides
// kommt aus der gemeinsamen Quelle: `dateNavInput` war hier Zeile für Zeile
// nachgebaut, und der Rahmen steckt schon in `toolbarIconBtn`.

export default function Todo({ embedded } = {}) {
  const { t } = useLanguage();
  // Regel 3: die Kalender-Brücke ist Zusatz — ohne das Modul gibt es sie nicht,
  // also darf der Hinweis darauf auch nicht erscheinen.
  const aktiv = useAktiv();
  const kalenderAktiv = aktiv("kalender");
  const [items, setItems] = useState([]);
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [editId, setEditId] = useState(null);
  const [eText, setEText] = useState("");
  const [eDate, setEDate] = useState("");
  const [eTime, setETime] = useState("");

  const heuteYmd = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const naechsteStunde = () => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return `${String(d.getHours()).padStart(2, "0")}:00`; };
  const load = () => fetch(API).then((r) => (r.ok ? r.json() : [])).then((d) => setItems(Array.isArray(d) ? d : [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const add = async () => {
    const v = text.trim();
    if (!v) return;
    // Erst leeren, wenn der Server die Aufgabe hat — sonst war der getippte
    // Text weg UND die Aufgabe nicht angelegt.
    if (!(await sende(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: v, due_date: date || null, due_time: date ? (time || "") : "" }) }, t("common.add")))) return;
    setText(""); setDate(""); setTime(""); load();
  };
  // Ein abgelehnter Haken sprang nach dem load() zurueck — das sah aus, als
  // haette man danebengeklickt.
  const toggle = async (it) => { await sende(`${API}/${it.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ done: !it.done }) }, t("todo.toggle")); load(); };
  const del = async (id) => { await sende(`${API}/${id}`, { method: "DELETE" }, t("common.delete")); load(); };
  const startEdit = (it) => { setEditId(it.id); setEText(it.text); setEDate(it.due_date || ""); setETime(it.due_time || ""); };
  const saveEdit = async () => {
    if (!eText.trim()) return;
    // Bei Ablehnung bleibt die Bearbeitung offen: die getippte Fassung steht
    // noch da, statt beim naechsten load() durch die alte ersetzt zu werden.
    if (!(await sende(`${API}/${editId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: eText.trim(), due_date: eDate || "", due_time: eDate ? (eTime || "") : "" }) }, t("common.save")))) return;
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
        <div key={it.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "8px 12px", border: "1px solid var(--accent)", borderRadius: CONTROL_R, marginBottom: 8 }}>
          <input value={eText} onChange={(e) => setEText(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditId(null); }} style={{ ...toolbarInput, flex: 1, minWidth: 140 }} />
          <input type="date" value={eDate} onChange={(e) => setEDate(e.target.value)} style={toolbarInput} />
          {eDate && <input type="time" value={eTime} onChange={(e) => setETime(e.target.value)} style={toolbarInput} />}
          <button onClick={saveEdit} style={toolbarBtnPrimary}>{t("common.save")}</button>
          <button onClick={() => setEditId(null)} style={toolbarBtn}>{t("common.abort")}</button>
        </div>
      );
    }
    return (
      <div key={it.id} {...(dnd || {})} style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", marginBottom: 8, cursor: dnd ? "grab" : "default" }}>
        {dnd && <span className="drag-handle" title={t("todo.reorderHint")} style={{ color: "var(--text3)", flexShrink: 0, display: "inline-flex", cursor: "grab" }}><Icon d={ICONS.grip} size={15} /></span>}
        <input type="checkbox" checked={it.done} onChange={() => toggle(it)} style={{ width: 18, height: 18, cursor: "pointer", flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, textDecoration: it.done ? "line-through" : "none", color: it.done ? "var(--text3)" : "var(--text)" }}>{it.text}</span>
        {it.due_date && (
          <span style={{ ...chipStyle, background: "var(--accent-bg, rgba(10,132,255,0.12))", color: "var(--accent)", flexShrink: 0, whiteSpace: "nowrap" }}>
            {fmtDate(it.due_date)}{it.due_time ? ` · ${it.due_time}` : ""}
          </span>
        )}
        <button onClick={() => startEdit(it)} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("common.edit")} aria-label={t("common.edit")}><Icon d={ICONS.edit} size={15} /></button>
        <button onClick={() => del(it.id)} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={15} color={C.danger} /></button>
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 640, margin: embedded ? 0 : "0 auto" }}>
      {!embedded && <h1 style={pageTitle}>{t("todo.title")}</h1>}

      {/* Auch die Eingabezeile ist eine Werkzeugleiste — dieselbe Komponente,
          damit Abstand, Umbruch und Ausrichtung nicht je Seite neu erfunden
          werden. `flex: 20` am Textfeld, weil die Leiste rechts einen eigenen
          Dehnraum hat: sonst teilte sich das Feld den Platz mit ihm. */}
      <Werkzeugleiste style={{ marginBottom: 16 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder={t("todo.placeholder")} style={{ ...toolbarInput, flex: 20, minWidth: 160 }} />
        {/* Datum/Uhrzeit erst per Icon dazuschalten (Default heute bzw. nächste
            volle Stunde) — kein leeres Feld, das nach nichts aussieht. */}
        {!date ? (
          <button onClick={() => setDate(heuteYmd())} className="icon-btn" title={t("todo.addDate")} aria-label={t("todo.addDate")} style={toolbarIconBtn}>
            <Icon d={ICONS.calendar} size={18} color="var(--text2)" />
          </button>
        ) : (<>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} title={t("todo.dateHint")} style={toolbarInput} />
          {!time ? (
            <button onClick={() => setTime(naechsteStunde())} className="icon-btn" title={t("todo.addTime")} aria-label={t("todo.addTime")} style={toolbarIconBtn}>
              <Icon d={ICONS.clock} size={18} color="var(--text2)" />
            </button>
          ) : (
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} title={t("todo.timeHint")} style={toolbarInput} />
          )}
          <button onClick={() => { setDate(""); setTime(""); }} className="icon-btn" title={t("common.remove") || t("common.delete")} aria-label={t("common.remove") || t("common.delete")} style={toolbarIconBtn}>
            <Icon d={ICONS.close} size={15} color="var(--text3)" />
          </button>
        </>)}
        <button onClick={add} disabled={!text.trim()} style={{ ...toolbarBtnPrimary, opacity: text.trim() ? 1 : 0.5 }}>{t("common.add")}</button>
      </Werkzeugleiste>
      {kalenderAktiv && <p style={{ fontSize: 13, color: "var(--text3)", marginTop: -8, marginBottom: 16 }}>{t("todo.calHint")}</p>}

      {items.length === 0 ? (
        <Empty title={t("todo.empty")} hint={t("todo.emptyHint")} />
      ) : (
        <>
          {(previewOpen || offen).map((it, idx) => Row(it, dndFor(idx)))}
          {erledigt.length > 0 && (
            <>
              <div style={{ ...sectionLabel, margin: "16px 0 8px" }}>{t("todo.done")} ({erledigt.length})</div>
              {erledigt.map((it) => Row(it, null))}
            </>
          )}
        </>
      )}
    </div>
  );
}
