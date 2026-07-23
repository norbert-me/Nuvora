// Modul Einstiege — Sammlung von Ideen fuer den Unterrichtseinstieg.
// Je Einstieg: Idee (Text), Ablauf mit Material, Materialliste, ca. Dauer.
// Wiederverwendbar; im Kalender einer Stunde zuweisbar.
import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { askConfirm, askPrompt, showAlert } from "../core/dialog.jsx";
import { undoDelete } from "../core/undo.jsx";
import { AddButton, Icon, ICONS, iconBtn, btnPrimary, btnSecondary, pageTitle, COLORS as C, modalOverlay, modalPanel, inputStyle, ExportButton, ImportButton } from "../components/Icons.jsx";
import PublishModal from "../components/PublishModal.jsx";
import { useLanguage } from "../i18n/index.jsx";

const API = "/api/methoden";

export default function Methoden() {
  const { t } = useLanguage();
  const [items, setItems] = useState([]);
  const [folders, setFolders] = useState([]);
  const [current, setCurrent] = useState(null); // aktueller Ordner (id) oder null = Wurzel
  const [edit, setEdit] = useState(null); // { id?, title, ... } | null
  const [publishing, setPublishing] = useState(null);
  const [error, setError] = useState("");
  const [topics, setTopics] = useState([]);
  const [addOpen, setAddOpen] = useState(false);
  const [newFolder, setNewFolder] = useState(false); // Ordner-Anlege-Eingabe offen?
  const [folderName, setFolderName] = useState("");
  const [drag, setDrag] = useState(null);       // { kind: "folder"|"method", id }
  const [dropTarget, setDropTarget] = useState(undefined); // Ziel-Ordner-id | null (Wurzel) | undefined

  const load = () => fetch(`${API}/list`).then((r) => (r.ok ? r.json() : [])).then((d) => setItems(Array.isArray(d) ? d : [])).catch(() => {});
  const loadFolders = () => fetch(`${API}/folders`).then((r) => (r.ok ? r.json() : [])).then((d) => setFolders(Array.isArray(d) ? d : [])).catch(() => {});
  useEffect(() => { load(); loadFolders(); }, []);
  useEffect(() => { fetch("/api/topics").then((r) => (r.ok ? r.json() : [])).then((d) => setTopics(Array.isArray(d) ? d : [])).catch(() => {}); }, []);

  // Deep-Link ?open=<id> (z. B. aus dem Kalender): den Einstieg direkt öffnen und
  // in seinen Ordner springen. Einmalig, sobald die Einträge geladen sind.
  const [params, setParams] = useSearchParams();
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (opened) return;
    const id = Number(params.get("open"));
    if (!id || !items.length) return;
    const m = items.find((x) => x.id === id);
    if (m) { setCurrent(m.folder_id ?? null); setEdit(m); }
    setOpened(true);
    params.delete("open"); setParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const folderById = (id) => folders.find((f) => f.id === id) || null;
  const childFolders = (pid) => folders.filter((f) => (f.parent_id ?? null) === pid).sort((a, b) => a.name.localeCompare(b.name, "de", { numeric: true }));
  const pathTo = (id) => { const out = []; let cur = folderById(id); let guard = 0; while (cur && guard++ < 50) { out.unshift(cur); cur = cur.parent_id != null ? folderById(cur.parent_id) : null; } return out; };
  // Verhindert Zyklen: ein Ordner darf nicht in einen seiner Nachfahren wandern.
  const isDescendant = (nodeId, maybeAncestorId) => { let cur = folderById(nodeId); let guard = 0; while (cur && guard++ < 50) { if (cur.parent_id === maybeAncestorId) return true; cur = cur.parent_id != null ? folderById(cur.parent_id) : null; } return false; };

  const save = async (m) => {
    setError("");
    const body = {
      title: (m.title || "").trim(), description: m.description || "",
      ablauf: m.ablauf || "", material: m.material || "",
      dauer: m.dauer === "" || m.dauer == null ? null : Number(m.dauer),
      topic_id: m.topic_id ?? null,
      folder_id: m.id ? (m.folder_id ?? null) : current, // neuer Einstieg landet im offenen Ordner
    };
    if (!body.title) { setError(t("methoden.titleRequired")); return; }
    const res = await fetch(m.id ? `${API}/${m.id}` : `${API}/`, {
      method: m.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).catch(() => null);
    if (res && res.ok) { setEdit(null); load(); } else setError(t("common.notWork"));
  };
  const remove = (id) => {
    const it = items.find((x) => x.id === id);
    setItems((prev) => prev.filter((x) => x.id !== id));
    undoDelete({
      message: t("undo.deleted", { name: it?.title || "" }),
      undo: () => load(),
      commit: async () => { await fetch(`${API}/${id}`, { method: "DELETE" }).catch(() => {}); },
    });
  };

  const createFolder = async () => {
    const name = folderName.trim();
    if (!name) { setNewFolder(false); return; }
    await fetch(`${API}/folders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, parent_id: current }) }).catch(() => {});
    setFolderName(""); setNewFolder(false); loadFolders();
  };
  const renameFolder = async (f) => {
    const name = await askPrompt(t("methoden.folderRename"), f.name);
    if (name == null || !name.trim()) return;
    await fetch(`${API}/folders/${f.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), parent_id: f.parent_id ?? null }) }).catch(() => {});
    loadFolders();
  };
  const deleteFolder = async (f) => {
    if (!(await askConfirm(t("methoden.folderDeleteConfirm", { name: f.name })))) return;
    await fetch(`${API}/folders/${f.id}`, { method: "DELETE" }).catch(() => {});
    loadFolders(); load();
  };
  const moveFolder = async (id, parentId) => {
    const f = folderById(id); if (!f) return;
    await fetch(`${API}/folders/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: f.name, parent_id: parentId }) }).catch(() => {});
    loadFolders();
  };
  const moveMethod = async (id, folderId) => {
    const m = items.find((x) => x.id === id); if (!m) return;
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, folder_id: folderId } : x))); // sofort
    await fetch(`${API}/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: m.title, description: m.description || "", ablauf: m.ablauf || "", material: m.material || "", dauer: m.dauer ?? null, topic_id: m.topic_id ?? null, folder_id: folderId }) }).catch(() => {});
    load();
  };

  // Drag & Drop: Ordner oder Einstieg auf einen Ziel-Ordner (oder die Wurzel) ziehen.
  const canDrop = (targetId) => {
    if (!drag) return false;
    if (drag.kind === "folder") return drag.id !== targetId && folderById(drag.id)?.parent_id !== targetId && !isDescendant(targetId, drag.id) && targetId !== drag.id;
    return items.find((x) => x.id === drag.id)?.folder_id !== targetId; // Methode: nur wenn woanders
  };
  const doDrop = (targetId) => {
    if (!canDrop(targetId)) { setDrag(null); setDropTarget(undefined); return; }
    if (drag.kind === "folder") moveFolder(drag.id, targetId); else moveMethod(drag.id, targetId);
    setDrag(null); setDropTarget(undefined);
  };
  const endDrag = () => { setDrag(null); setDropTarget(undefined); };
  // Props für ein Drop-Ziel (Ordnerkarte oder Breadcrumb).
  const dropProps = (targetId) => ({
    onDragOver: (e) => { if (canDrop(targetId)) { e.preventDefault(); if (dropTarget !== targetId) setDropTarget(targetId); } },
    onDragLeave: () => setDropTarget((cur) => (cur === targetId ? undefined : cur)),
    onDrop: (e) => { e.preventDefault(); doDrop(targetId); },
  });

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

  const subfolders = childFolders(current);
  const visible = items.filter((m) => (m.folder_id ?? null) === current);
  const crumbs = current != null ? pathTo(current) : [];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <h1 style={pageTitle}>{t("methoden.title")}</h1>
        <span style={{ flex: 1 }} />
        <a href="/beispiel-einstiege.json" download style={{ fontSize: 12.5, color: "var(--accent)", textDecoration: "none", whiteSpace: "nowrap" }}>{t("methoden.jsonTemplate")}</a>
        <ExportButton label="" title={t("common.export")} onClick={doExport} />
        <ImportButton label="" title={t("common.import")} onFile={doImport} />
        <div style={{ position: "relative" }}>
          <AddButton onClick={() => setAddOpen((v) => !v)} title={t("methoden.new")} />
          {addOpen && (
            <>
              <div onClick={() => setAddOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 20 }} />
              <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 21, background: "var(--card)", border: "1px solid var(--border2)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.18)", padding: 4, minWidth: 150 }}>
                <button onClick={() => { setAddOpen(false); setEdit({}); }} style={menuItem}><Icon d={ICONS.plus} size={14} /> {t("methoden.new")}</button>
                <button onClick={() => { setAddOpen(false); setNewFolder(true); setFolderName(""); }} style={menuItem}><Icon d={ICONS.folder} size={14} /> {t("methoden.newFolder")}</button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Breadcrumb: Wurzel + Pfad. Jeder Teil ist Drop-Ziel zum Hochschieben. */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", marginBottom: 12, fontSize: 13 }}>
        <button onClick={() => setCurrent(null)} {...dropProps(null)}
          style={{ ...crumbBtn, ...(dropTarget === null ? crumbDrop : {}), fontWeight: current == null ? 700 : 500 }}>{t("methoden.root")}</button>
        {crumbs.map((f) => (
          <span key={f.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ color: "var(--text3)" }}>/</span>
            <button onClick={() => setCurrent(f.id)} {...dropProps(f.id)}
              style={{ ...crumbBtn, ...(dropTarget === f.id ? crumbDrop : {}), fontWeight: current === f.id ? 700 : 500 }}>{f.name}</button>
          </span>
        ))}
      </div>

      {error && <p style={{ color: C.danger, fontSize: 13, marginBottom: 10 }}>{error}</p>}

      {newFolder && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12, maxWidth: 360 }}>
          <input value={folderName} autoFocus placeholder={t("methoden.folderName")} onChange={(e) => setFolderName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createFolder(); if (e.key === "Escape") setNewFolder(false); }}
            style={{ ...inputStyle, flex: 1 }} />
          <button onClick={createFolder} style={btnPrimary}>{t("common.save")}</button>
          <button onClick={() => setNewFolder(false)} style={btnSecondary}>{t("common.abort")}</button>
        </div>
      )}

      {subfolders.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10, marginBottom: 14 }}>
          {subfolders.map((f) => {
            const count = items.filter((m) => m.folder_id === f.id).length + childFolders(f.id).length;
            const over = dropTarget === f.id && canDrop(f.id);
            return (
              <div key={f.id} draggable onDragStart={() => setDrag({ kind: "folder", id: f.id })} onDragEnd={endDrag} {...dropProps(f.id)}
                onClick={() => setCurrent(f.id)}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", border: `1px solid ${over ? "var(--accent)" : "var(--border)"}`, borderRadius: 12, background: over ? "var(--accent-bg, rgba(10,132,255,0.10))" : "var(--card)", cursor: "pointer" }}>
                <span style={{ color: "var(--text3)", cursor: "grab", fontSize: 13 }} title={t("methoden.dragHint")}>⠿</span>
                <Icon d={ICONS.folder} size={18} color="var(--accent)" />
                <span style={{ fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                <span style={{ fontSize: 12, color: "var(--text3)" }}>{count}</span>
                <button onClick={(e) => { e.stopPropagation(); renameFolder(f); }} className="icon-btn" style={{ ...iconBtn, padding: 3 }} title={t("common.rename")}><Icon d={ICONS.edit} size={13} /></button>
                <button onClick={(e) => { e.stopPropagation(); deleteFolder(f); }} className="icon-btn" style={{ ...iconBtn, padding: 3 }} title={t("common.delete")}><Icon d={ICONS.trash} size={13} color={C.danger} /></button>
              </div>
            );
          })}
        </div>
      )}

      {visible.length === 0 && subfolders.length === 0 ? (
        <p style={{ fontSize: 13.5, color: "var(--text3)" }}>{t("methoden.empty")}</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {visible.map((m) => (
            <div key={m.id} draggable onDragStart={() => setDrag({ kind: "method", id: m.id })} onDragEnd={endDrag}
              style={{ padding: 16, border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)", opacity: drag && drag.kind === "method" && drag.id === m.id ? 0.5 : 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ color: "var(--text3)", cursor: "grab", fontSize: 13 }} title={t("methoden.dragHint")}>⠿</span>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{m.title}</div>
                {m.dauer != null && <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 980, background: "rgba(37,99,235,0.12)", color: C.info }}>{t("methoden.dauerBadge", { n: m.dauer })}</span>}
                <span style={{ flex: 1 }} />
                <button onClick={() => setPublishing(m)} className="icon-btn" style={{ ...iconBtn, padding: 3 }} title={t("methoden.publish")}><Icon d={ICONS.share} size={17} color="var(--accent)" /></button>
                <button onClick={() => setEdit(m)} className="icon-btn" style={{ ...iconBtn, padding: 3 }} title={t("common.edit")}><Icon d={ICONS.edit} size={14} /></button>
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

      {edit && <MethodModal m={edit} topics={topics} onSave={save} onDelete={(id) => { remove(id); setEdit(null); }} onClose={() => setEdit(null)} t={t} />}
      {publishing && <PublishModal name={publishing.title} onClose={() => setPublishing(null)}
        onPublish={(description) => fetch(`/api/marketplace/publish/method`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method_id: publishing.id, description }) }).catch(() => null)} />}
    </div>
  );
}

const menuItem = { display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", background: "none", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 13.5, color: "var(--text)", textAlign: "left" };
const crumbBtn = { background: "none", border: "1px solid transparent", borderRadius: 7, padding: "3px 8px", cursor: "pointer", color: "var(--text)", fontSize: 13 };
const crumbDrop = { borderColor: "var(--accent)", background: "var(--accent-bg, rgba(10,132,255,0.10))" };

function MethodModal({ m, topics = [], onSave, onDelete, onClose, t }) {
  const [title, setTitle] = useState(m.title || "");
  const [dauer, setDauer] = useState(m.dauer ?? "");
  const [description, setDescription] = useState(m.description || "");
  const [ablauf, setAblauf] = useState(m.ablauf || "");
  const [material, setMaterial] = useState(m.material || "");
  const [topicId, setTopicId] = useState(m.topic_id ?? "");
  const [titleErr, setTitleErr] = useState(false);
  const topicLabel = (tp) => { const p = tp.parent_id ? topics.find((x) => x.id === tp.parent_id) : null; return p ? `${p.name} / ${tp.name}` : tp.name; };
  const fld = { ...inputStyle, width: "100%" };
  const lbl = { fontSize: 12.5, color: "var(--text2)", margin: "12px 0 5px" };
  const submit = () => {
    // Fehlender Titel wird direkt in der Maske gemeldet, nicht als Seitenfehler
    // hinter dem Modal.
    if (!title.trim()) { setTitleErr(true); return; }
    onSave({ id: m.id, title, description, ablauf, material, dauer, topic_id: topicId === "" ? null : Number(topicId), folder_id: m.folder_id ?? null });
  };
  return (
    <div onClick={onClose} style={modalOverlay}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modalPanel, maxWidth: 480 }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{m.id ? t("methoden.edit") : t("methoden.new")}</h3>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ ...lbl, marginTop: 0 }}>{t("methoden.titleField")}</div>
            <input value={title} onChange={(e) => { setTitle(e.target.value); if (titleErr) setTitleErr(false); }} autoFocus style={{ ...fld, ...(titleErr ? { borderColor: C.danger } : {}) }} />
            {titleErr && <div style={{ color: C.danger, fontSize: 12, marginTop: 4 }}>{t("methoden.titleRequired")}</div>}
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
        {topics.length > 0 && (
          <>
            <div style={lbl}>{t("methoden.topic")}</div>
            <select value={topicId} onChange={(e) => setTopicId(e.target.value)} style={fld}>
              <option value="">{t("methoden.topicNone")}</option>
              {topics.map((tp) => <option key={tp.id} value={tp.id}>{topicLabel(tp)}</option>)}
            </select>
          </>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 18, alignItems: "center" }}>
          <button onClick={submit} style={btnPrimary}>{t("common.save")}</button>
          <button onClick={onClose} style={btnSecondary}>{t("common.abort")}</button>
          {m.id && <button onClick={() => onDelete(m.id)} className="icon-btn" style={{ ...iconBtn, marginLeft: "auto" }} title={t("common.delete")}><Icon d={ICONS.trash} size={16} color={C.danger} /></button>}
        </div>
      </div>
    </div>
  );
}
