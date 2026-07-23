import { useState, useEffect, useRef } from "react";
import { askConfirm, askPrompt, showAlert } from "../core/dialog.jsx";
import Latex from "../components/Latex.jsx";
import PublishModal from "../components/PublishModal.jsx";
import { AddButton, Icon, ICONS, iconBtn, COLORS as C, btnPrimary, btnSecondary, Toggle, modalOverlay as sOverlay, modalPanel as sPanel } from "../components/Icons.jsx";
import ImportMenu from "../components/ImportMenu.jsx";
import { useLanguage } from "../i18n/index.jsx";
import TopicPicker from "../components/TopicPicker.jsx";
import { useModules } from "../core/modules.js";

const API = "/api";

export default function Dashboard() {
  const { t } = useLanguage();
  const [folders, setFolders] = useState([]);
  const [rootSets, setRootSets] = useState([]); // Fragensets ohne Ordner (Top-Level)
  const [allQuestions, setAllQuestions] = useState([]);
  const [path, setPath] = useState([]);
  const [currentFolder, setCurrentFolder] = useState(null);
  const [editingSet, setEditingSet] = useState(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  // Ein „+" mit Untermenü (Ordner/Set) statt zwei getrennter Plus-Knöpfe.
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addMode, setAddMode] = useState(null); // null | "folder" | "set"
  const [addName, setAddName] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [movingFolder, setMovingFolder] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [renamingSet, setRenamingSet] = useState(null);
  const [renameSetValue, setRenameSetValue] = useState("");
  const [publishingSet, setPublishingSet] = useState(null);
  // Import-Fortschritt: { stage: "reading"|"uploading"|"done"|"error", label }
  const [importStatus, setImportStatus] = useState(null);

  // POST mit sichtbarem Fortschritt (XHR liefert Upload-Fortschritt)
  const uploadWithProgress = (url, body, { json = true, label = "" } = {}) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      const token = localStorage.getItem("token");
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      if (json) xhr.setRequestHeader("Content-Type", "application/json");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setImportStatus({ stage: "uploading", label, pct });
        }
      };
      xhr.upload.onload = () => setImportStatus({ stage: "processing", label });
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
        else { let d = ""; try { d = JSON.parse(xhr.responseText).detail; } catch {} reject(new Error(d || `Fehler ${xhr.status}`)); }
      };
      xhr.onerror = () => reject(new Error(t("login.connectionError")));
      xhr.send(body);
    });

  const finishImport = (ok, msg) => {
    setImportStatus({ stage: ok ? "done" : "error", label: msg });
    setTimeout(() => setImportStatus(null), ok ? 2500 : 5000);
  };

  const openPublish = (qs) => setPublishingSet(qs);

  const load = async () => {
    try {
      const [fr, qr] = await Promise.all([fetch(`${API}/folders`), fetch(`${API}/questions`)]);
      if (fr.status === 401 || qr.status === 401) {
        localStorage.removeItem("token"); localStorage.removeItem("user"); location.reload(); return;
      }
      const [f, q] = await Promise.all([fr.json(), qr.json()]);
      setFolders(Array.isArray(f) ? f : []);
      setAllQuestions(Array.isArray(q) ? q : []);
      // Top-Level-Fragensets (ohne Ordner) — werden am Wurzel-Level angezeigt.
      fetch(`${API}/root-question-sets`).then((r) => (r.ok ? r.json() : [])).then((d) => setRootSets(Array.isArray(d) ? d : [])).catch(() => {});
      setLoadError(false);
    } catch { setLoadError(true); }
  };

  useEffect(() => {
    const timer = setTimeout(() => { if (folders.length === 0 && allQuestions.length === 0) setLoadError(true); }, 15000);
    load().then(() => clearTimeout(timer));
    return () => clearTimeout(timer);
  }, []);

  const countRecursive = (folder) => {
    let sets = (folder.question_sets || []).length;
    let dirs = (folder.children || []).length;
    for (const child of folder.children || []) {
      const [s, d] = countRecursive(child);
      sets += s; dirs += d;
    }
    return [sets, dirs];
  };
  const countSubItems = (folder) => {
    const [sets, dirs] = countRecursive(folder);
    const parts = [];
    if (dirs > 0) parts.push(`${dirs} ${t("dash.countFolders")}`);
    if (sets > 0) parts.push(`${sets} ${t("dash.countSets")}`);
    return parts.join(" · ");
  };

  const findNode = (tree, id) => {
    for (const node of tree) {
      if (node.id === id) return node;
      const found = findNode(node.children || [], id);
      if (found) return found;
    }
    return null;
  };

  const getAllFolderIds = (node) => {
    let ids = [node.id];
    for (const c of (node.children || [])) ids = ids.concat(getAllFolderIds(c));
    return ids;
  };

  const currentChildren = currentFolder ? (findNode(folders, currentFolder)?.children || []) : folders;
  const currentSets = currentFolder ? (findNode(folders, currentFolder)?.question_sets || []) : rootSets;

  const openFolder = (folder) => {
    setPath([...path, { id: folder.id, name: folder.name }]);
    setCurrentFolder(folder.id);
    setEditingSet(null);
  };

  const goToPath = (idx) => {
    if (idx < 0) { setPath([]); setCurrentFolder(null); }
    else { setPath(path.slice(0, idx + 1)); setCurrentFolder(path[idx].id); }
    setEditingSet(null);
  };

  const createFolder = async (nm) => {
    const name = (nm ?? newFolderName).trim();
    if (!name) return;
    await fetch(`${API}/folders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, parent_id: currentFolder }) });
    setNewFolderName(""); setShowNewFolder(false); load();
  };

  const startRenameFolder = (id, oldName) => {
    setRenamingFolder(id);
    setRenameValue(oldName);
  };

  const commitRenameFolder = async () => {
    if (!renamingFolder || !renameValue.trim()) { setRenamingFolder(null); return; }
    const node = findNode(folders, renamingFolder);
    if (!node) { setRenamingFolder(null); return; }
    await fetch(`${API}/folders/${renamingFolder}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameValue.trim(), parent_id: node.parent_id }),
    });
    setRenamingFolder(null);
    load();
  };

  const exportFolder = async (id, name) => {
    const res = await fetch(`${API}/export/folder/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.json`;
    a.click();
  };

  const importFolder = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      setImportStatus({ stage: "reading", label: file.name });
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.type === "cardvote_folder") {
          const count = (data.question_sets || []).length + (data.children || []).length;
          await uploadWithProgress(`${API}/import/folder${currentFolder ? `?folder_id=${currentFolder}` : ""}`, text, { label: data.name || file.name });
          await load();
          finishImport(true, t("dash.impFolderDone", { count }));
        } else if (data.type === "cardvote_questionset") {
          const n = (data.questions || []).length;
          await uploadWithProgress(`${API}/import/question-set`, JSON.stringify({ ...data, folder_id: currentFolder }), { label: data.name || file.name });
          await load();
          finishImport(true, t("dash.impSetDone", { name: data.name || "?", count: n }));
        } else {
          finishImport(false, t("dash.impUnknown"));
        }
      } catch (err) { finishImport(false, err.message || t("dash.impReadError")); }
    };
    input.click();
  };

  const deleteFolder = async (id) => {
    if (!await askConfirm(t("dash.deleteFolderConfirm"))) return;
    await fetch(`${API}/folders/${id}`, { method: "DELETE" }); load();
  };

  const moveFolder = async (folderId, newParentId) => {
    const node = findNode(folders, folderId);
    if (!node) return;
    await fetch(`${API}/folders/${folderId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: node.name, parent_id: newParentId }),
    });
    setMovingFolder(null); load();
  };

  const createSet = async (name) => {
    const res = await fetch(`${API}/question-sets`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, folder_id: currentFolder, question_ids: [] }),
    });
    const qs = await res.json();
    setEditingSet(qs); load();
  };

  const deleteSet = async (id) => {
    if (!await askConfirm(t("dash.deleteSetConfirm"))) return;
    await fetch(`${API}/question-sets/${id}`, { method: "DELETE" });
    setEditingSet(null); load();
  };

  const duplicateSet = async (id) => {
    const res = await fetch(`${API}/question-sets/${id}/duplicate`, { method: "POST" });
    const qs = await res.json();
    setEditingSet(qs); load();
  };

  const importXlsx = async () => {
    const setName = await askPrompt(t("dash.setNamePrompt"));
    if (!setName) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      setImportStatus({ stage: "reading", label: file.name });
      const form = new FormData();
      form.append("file", file);
      try {
        await uploadWithProgress(`${API}/import/questions-xlsx?name=${encodeURIComponent(setName)}${currentFolder ? `&folder_id=${currentFolder}` : ""}`, form, { json: false, label: file.name });
        await load();
        finishImport(true, t("dash.impSetDone", { name: setName, count: "…" }));
      } catch (err) { finishImport(false, err.message || t("dash.impError")); }
    };
    input.click();
  };

  const importSet = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      setImportStatus({ stage: "reading", label: file.name });
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.type !== "cardvote_questionset") { finishImport(false, t("dash.impInvalid")); return; }
        data.folder_id = currentFolder;
        const n = (data.questions || []).length;
        await uploadWithProgress(`${API}/import/question-set`, JSON.stringify(data), { label: data.name || file.name });
        await load();
        finishImport(true, t("dash.impSetDone", { name: data.name || "?", count: n }));
      } catch (err) { finishImport(false, err.message || t("dash.impReadError")); }
    };
    input.click();
  };

  if (editingSet) {
    return <QuestionSetEditor questionSet={editingSet} allQuestions={allQuestions} onBack={() => { setEditingSet(null); load(); }} onDelete={() => deleteSet(editingSet.id)} onQuestionsChange={load} />;
  }

  // Collect all valid move targets (excluding the folder being moved and its descendants)
  const flatFolders = (tree, depth = 0) => {
    let out = [];
    for (const f of tree) {
      out.push({ id: f.id, name: f.name, depth });
      out = out.concat(flatFolders(f.children || [], depth + 1));
    }
    return out;
  };

  const movingNode = movingFolder ? findNode(folders, movingFolder) : null;
  const excludeIds = movingNode ? new Set(getAllFolderIds(movingNode)) : new Set();
  const moveTargets = flatFolders(folders).filter((f) => !excludeIds.has(f.id));

  if (loadError && folders.length === 0) return <p style={{ color: C.danger }}>{t("common.connectionError")}</p>;

  return (
    <div>

      <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 16, fontSize: 14 }}>
        <span onClick={() => goToPath(-1)} style={{ cursor: "pointer", color: path.length === 0 ? "var(--text)" : "var(--accent)", fontWeight: path.length === 0 ? 600 : 400 }}>
          {t("dash.root")}
        </span>
        {path.map((p, idx) => (
          <span key={p.id}>
            <span style={{ color: "var(--text3)", margin: "0 4px" }}>/</span>
            <span onClick={() => goToPath(idx)} style={{ cursor: "pointer", color: idx === path.length - 1 ? "var(--text)" : "var(--accent)", fontWeight: idx === path.length - 1 ? 600 : 400 }}>{p.name}</span>
          </span>
        ))}
      </div>

      {/* Move dialog */}
      {movingFolder && (
        <div style={{ padding: 16, marginBottom: 16, background: "#fff3cd", borderRadius: 10, border: "1px solid #ffc107" }}>
          <strong>{t("dash.moveTo")}</strong>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            <button onClick={() => moveFolder(movingFolder, null)} style={btnSmall}>{t("dash.root")}</button>
            {moveTargets.map((f) => (
              <button key={f.id} onClick={() => moveFolder(movingFolder, f.id)} style={btnSmall}>
                {"—".repeat(f.depth)} {f.name}
              </button>
            ))}
            <button onClick={() => setMovingFolder(null)} style={{ ...btnSmall, color: "var(--text3)" }}>{t("common.cancel")}</button>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        {currentChildren.map((f) => (
          <div key={f.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", marginBottom: 8, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, cursor: "pointer" }}>
            <span onClick={() => renamingFolder !== f.id && openFolder(f)} style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              {renamingFolder === f.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRenameFolder}
                  onKeyDown={(e) => { if (e.key === "Enter") commitRenameFolder(); if (e.key === "Escape") setRenamingFolder(null); }}
                  onClick={(e) => e.stopPropagation()}
                  style={{ fontWeight: 700, fontSize: 15, padding: "4px 10px", border: "2px solid var(--accent)", borderRadius: 8, background: "var(--input-bg)", color: "var(--text)", outline: "none", flex: 1 }}
                />
              ) : (
                <>
                  <strong style={{ color: "var(--text)" }}>{f.name}</strong>
                  <span style={{ color: "var(--text3)", fontSize: 13 }}>{countSubItems(f)}</span>
                </>
              )}
            </span>
            {/* Löschen steckt im Bearbeiten-Modus (Umbenennen), nicht als
                dauersichtbarer Papierkorb in der Zeile. */}
            {renamingFolder !== f.id ? (
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              <button onClick={(e) => { e.stopPropagation(); exportFolder(f.id, f.name); }} className="icon-btn" style={iconBtn} title={t("classes.export")}><Icon d={ICONS.export} size={18} /></button>
              <button onClick={(e) => { e.stopPropagation(); setMovingFolder(f.id); }} className="icon-btn" style={iconBtn} title={t("dash.move")}><Icon d={ICONS.move} size={18} /></button>
              <button onClick={(e) => { e.stopPropagation(); startRenameFolder(f.id, f.name); }} className="icon-btn" style={iconBtn} title={t("dash.rename")}><Icon d={ICONS.edit} size={18} /></button>
            </div>
            ) : (
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              <button onClick={(e) => { e.stopPropagation(); deleteFolder(f.id); }} className="icon-btn" style={iconBtn} title={t("common.delete")}><Icon d={ICONS.trash} size={18} color={C.danger} /></button>
            </div>
            )}
          </div>
        ))}
      </div>

      {(currentFolder || currentSets.length > 0) && (
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ marginBottom: 8, fontSize: 16, fontWeight: 600, color: "var(--text)" }}>{t("dash.setsHeading")}</h3>
          {currentFolder && currentSets.length === 0 && <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("dash.emptySets")}</p>}
          {currentSets.map((qs) => (
            <div key={qs.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", marginBottom: 8, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, cursor: "pointer" }}>
              <span onClick={() => setEditingSet(qs)} style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <strong style={{ color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{qs.name}</strong>
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={(e) => { e.stopPropagation(); openPublish(qs); }} className="icon-btn" style={iconBtn} title={t("dash.publishTitle")}>
                  <Icon d={ICONS.share} size={18} color="var(--accent)" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); duplicateSet(qs.id); }} className="icon-btn" style={iconBtn} title={t("dash.duplicate")}><Icon d={ICONS.duplicate} size={18} /></button>
                <button onClick={async (e) => { e.stopPropagation(); const r = await fetch(`${API}/export/question-set/${qs.id}`); if (!r.ok) return; const b = await r.blob(); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `${qs.name}.json`; a.click(); URL.revokeObjectURL(a.href); }} className="icon-btn" style={iconBtn} title={t("classes.export")}><Icon d={ICONS.export} size={18} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {addMode ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder={addMode === "folder" ? t("dash.folderName") : t("dash.setName")} style={inputStyle} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && addName.trim()) { (addMode === "folder" ? createFolder(addName.trim()) : createSet(addName.trim())); setAddName(""); setAddMode(null); } if (e.key === "Escape") { setAddName(""); setAddMode(null); } }} />
            <button onClick={() => { if (addName.trim()) { (addMode === "folder" ? createFolder(addName.trim()) : createSet(addName.trim())); setAddName(""); setAddMode(null); } }} style={btnSecondary}>OK</button>
            <button onClick={() => { setAddName(""); setAddMode(null); }} style={btnSecondary}>×</button>
          </div>
        ) : (
          <div style={{ position: "relative" }}>
            <AddButton onClick={() => setAddMenuOpen((v) => !v)} title={t("common.add")} />
            {addMenuOpen && (<>
              <div onClick={() => setAddMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
              <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50, minWidth: 180, background: "var(--card)", border: "1px solid var(--border2)", borderRadius: 12, boxShadow: "0 8px 30px rgba(0,0,0,0.18)", padding: 6 }}>
                <button onClick={() => { setAddMenuOpen(false); setAddMode("folder"); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", boxSizing: "border-box", padding: "9px 12px", background: "none", border: "none", borderRadius: 8, color: "var(--text)", fontSize: 13.5, fontWeight: 500, cursor: "pointer", textAlign: "left" }}><Icon d={ICONS.plus} size={15} /> {t("dash.newFolder")}</button>
                <button onClick={() => { setAddMenuOpen(false); setAddMode("set"); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", boxSizing: "border-box", padding: "9px 12px", background: "none", border: "none", borderRadius: 8, color: "var(--text)", fontSize: 13.5, fontWeight: 500, cursor: "pointer", textAlign: "left" }}><Icon d={ICONS.plus} size={15} /> {t("dash.newSet")}</button>
              </div>
            </>)}
          </div>
        )}
        <div>
          <ImportMenu
            importItems={[
              { label: t("dash.importJsonItem"), onClick: importFolder },
              ...(currentFolder ? [{ label: t("classes.importExcel"), onClick: importXlsx }] : []),
            ]}
            templateItems={[
              { label: t("classes.templateExcel"), href: `${API}/import/questions-template.xlsx` },
              { label: t("dash.jsonExample"), href: "/beispiel-frageset.json" },
            ]}
          />
        </div>
      </div>

      {publishingSet && <PublishModal name={publishingSet.name} onClose={() => setPublishingSet(null)}
        onPublish={(description) => fetch(`${API}/marketplace/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ set_id: publishingSet.id, description }) }).catch(() => null)} />}

      {importStatus && <ImportProgress status={importStatus} />}
    </div>
  );
}

function ImportProgress({ status }) {
  const { t } = useLanguage();
  const { stage, label, pct } = status;
  const map = {
    reading:    { title: t("dash.impReading"), color: "var(--accent)", bar: "indet" },
    uploading:  { title: `${t("dash.impUploading")} ${pct != null ? pct + "%" : ""}`, color: "var(--accent)", bar: "det" },
    processing: { title: t("dash.impProcessing"), color: "var(--accent)", bar: "indet" },
    done:       { title: t("dash.impDone"), color: C.success, bar: "full" },
    error:      { title: t("dash.impFailed"), color: C.danger, bar: "full" },
  };
  const s = map[stage] || map.reading;
  return (
    <div style={{ position: "fixed", left: 0, right: 0, bottom: 20, display: "flex", justifyContent: "center", zIndex: 300, pointerEvents: "none" }}>
      <style>{`@keyframes impIndet { 0%{left:-40%;} 100%{left:100%;} }`}</style>
      <div style={{ width: "min(420px, 92vw)", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "0 8px 30px rgba(0,0,0,0.18)", padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          {stage === "done" ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.success} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
          ) : stage === "error" ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.danger} strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" style={{ animation: "spin 0.9s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.2-8.5"/><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></svg>
          )}
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{s.title}</span>
        </div>
        {label && <div style={{ fontSize: 12, color: stage === "error" ? C.danger : "var(--text3)", marginBottom: 8, marginLeft: 24 }}>{label}</div>}
        <div style={{ position: "relative", height: 6, background: "var(--bg2)", borderRadius: 3, overflow: "hidden" }}>
          {s.bar === "indet" ? (
            <div style={{ position: "absolute", top: 0, height: "100%", width: "40%", borderRadius: 3, background: s.color, animation: "impIndet 1.1s ease-in-out infinite" }} />
          ) : (
            <div style={{ height: "100%", borderRadius: 3, background: s.color, width: s.bar === "full" ? "100%" : `${pct || 0}%`, transition: "width 0.2s" }} />
          )}
        </div>
      </div>
    </div>
  );
}

const inputStyle = { padding: "10px 14px", border: "1px solid var(--border2)", borderRadius: 10, fontSize: 14, background: "var(--card)" };
const btnSmall = { background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: "4px 10px", fontWeight: 500, color: "var(--text3)" };

function NewSetButton({ onCreate }) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  if (editing) {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("dash.setName")} style={inputStyle} autoFocus
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { onCreate(name.trim()); setName(""); setEditing(false); } }} />
        <button onClick={() => { if (name.trim()) { onCreate(name.trim()); setName(""); setEditing(false); } }} style={btnSecondary}>OK</button>
        <button onClick={() => setEditing(false)} style={btnSecondary}>×</button>
      </div>
    );
  }
  return <AddButton onClick={() => setEditing(true)} title={t("dash.newSet")} />;
}


function QuestionSetEditor({ questionSet, allQuestions, onBack, onDelete, onQuestionsChange }) {
  const [qSearch, setQSearch] = useState("");
  // Touch-Geraet? Dort funktioniert HTML5-Drag nicht (iOS Safari) — deshalb
  // dort Pfeile statt Ziehen. Desktop behaelt das Ziehen.
  const isTouch = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

  const moveQuestion = (from, delta) => {
    const arr = [...(previewQuestions || questions)];
    const to = from + delta;
    if (to < 0 || to >= arr.length) return;
    [arr[from], arr[to]] = [arr[to], arr[from]];
    setQuestions(arr); setPreviewQuestions(null); saveSet(name, arr);
  };
  const { t } = useLanguage();
  const [name, setName] = useState(questionSet.name);
  const [questions, setQuestions] = useState(questionSet.questions || []);
  const [shuffleQ, setShuffleQ] = useState(questionSet.shuffle_questions || false);
  const [shuffleA, setShuffleA] = useState(questionSet.shuffle_answers || false);
  const [showAdd, setShowAdd] = useState(false);
  const [editingQ, setEditingQ] = useState(null);
  const [saving, setSaving] = useState(false);
  const EMPTY_Q = { text: "", choices: { A: "", B: "", C: "", D: "" }, correct_answer: "", num_choices: 4, image_url: null, image_layout: "above", choice_images: null, topic_id: null };
  const [newQ, setNewQ] = useState({ ...EMPTY_Q });

  const saveSet = async (updatedName, updatedQuestions, sQ, sA) => {
    setSaving(true);
    await fetch(`${API}/question-sets/${questionSet.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: updatedName, folder_id: questionSet.folder_id,
        question_ids: updatedQuestions.map((q) => q.id),
        shuffle_questions: sQ !== undefined ? sQ : shuffleQ,
        shuffle_answers: sA !== undefined ? sA : shuffleA,
      }),
    });
    setSaving(false);
    onQuestionsChange();
  };

  const saveName = () => saveSet(name, questions);


  const toggleShuffleQ = () => { const v = !shuffleQ; setShuffleQ(v); saveSet(name, questions, v, shuffleA); };
  const toggleShuffleA = () => { const v = !shuffleA; setShuffleA(v); saveSet(name, questions, shuffleQ, v); };

  const addNewQuestion = async () => {
    if (!newQ.text.trim()) return;
    const res = await fetch(`${API}/questions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newQ),
    });
    const q = await res.json();
    const updated = [...questions, q];
    setQuestions(updated);
    setNewQ({ ...EMPTY_Q });
    await saveSet(name, updated);
  };

  const updateExistingQuestion = async () => {
    if (!editingQ || !editingQ.text.trim()) return;
    const res = await fetch(`${API}/questions/${editingQ.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editingQ),
    });
    const q = await res.json();
    const updated = questions.map((x) => x.id === q.id ? q : x);
    setQuestions(updated);
    setEditingQ(null);
    await saveSet(name, updated);
  };

  const removeQuestion = async (idx) => {
    const updated = questions.filter((_, i) => i !== idx);
    setQuestions(updated);
    await saveSet(name, updated);
  };

  const dragIdx = useRef(null);
  const [previewQuestions, setPreviewQuestions] = useState(null);

  const reorderPreview = (from, to) => {
    if (from === to || from == null) return;
    const arr = [...questions];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    setPreviewQuestions(arr);
  };

  const reorderQuestion = async (from, to) => {
    if (from === to || from == null) return;
    const arr = [...questions];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    setQuestions(arr);
    setPreviewQuestions(null);
    await saveSet(name, arr);
  };

  const uploadImage = async (setter) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API}/questions/upload-image`, { method: "POST", body: form });
      const data = await res.json();
      setter(data.url);
    };
    input.click();
  };

  const CHOICE_KEYS = ["A", "B", "C", "D"];

  return (
    <div>
      <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", fontSize: 13, fontWeight: 500, padding: "4px 0", marginBottom: 16 }}>← Zurück</button>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === "Enter" && saveName()}
          style={{ padding: "10px 14px", fontSize: 20, fontWeight: 700, border: "1px solid var(--border2)", borderRadius: 10, flex: 1, maxWidth: 500, color: "var(--text)" }} />
        {saving && <span style={{ color: "var(--text3)", fontSize: 13 }}>{t("dash.saving")}</span>}
        {onDelete && <button onClick={onDelete} className="icon-btn" style={{ ...iconBtn, marginLeft: "auto" }} title={t("common.delete")}><Icon d={ICONS.trash} size={18} color={C.danger} /></button>}
      </div>

      <div style={{ display: "flex", gap: 24, marginBottom: 20, flexWrap: "wrap" }}>
        <Toggle checked={shuffleQ} onChange={toggleShuffleQ} label={t("dash.shuffleQ")} />
        <Toggle checked={shuffleA} onChange={toggleShuffleA} label={t("dash.shuffleA")} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", margin: 0 }}>{t("dash.questionsCount", { count: questions.length })}</h3>
        {questions.length > 3 && (
          <input
            value={qSearch} onChange={(e) => setQSearch(e.target.value)} placeholder={t("dash.searchQ")}
            style={{ flex: 1, minWidth: 160, maxWidth: 320, padding: "7px 12px", border: "1px solid var(--border2)", borderRadius: 980, fontSize: 13.5, background: "var(--bg)", color: "var(--text)" }}
          />
        )}
      </div>

      {(() => {
        const base = previewQuestions || questions;
        const term = qSearch.trim().toLowerCase();
        const searching = term.length > 0;
        const inText = (q) => (q.text || "").toLowerCase().includes(term)
          || Object.values(q.choices || {}).some((v) => typeof v === "string" && v.toLowerCase().includes(term));
        const shown = searching ? base.filter(inText) : base;
        if (searching && shown.length === 0) {
          return <p style={{ fontSize: 13.5, color: "var(--text3)" }}>{t("dash.noSearchHit")}</p>;
        }
        // Beim Suchen kein Ziehen: der gefilterte Index passt nicht zur echten
        // Reihenfolge, ein Drop wuerde die falsche Frage verschieben.
        return shown.map((q) => {
          const idx = base.indexOf(q);
          return (
        <div
          key={q.id}
          draggable={!searching && !isTouch}
          onDragStart={(e) => { if (searching) return; e.dataTransfer.effectAllowed = "move"; dragIdx.current = idx; }}
          onDragOver={(e) => { if (searching) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; reorderPreview(dragIdx.current, idx); dragIdx.current = idx; }}
          onDrop={(e) => { if (searching) return; e.preventDefault(); const arr = previewQuestions || questions; setQuestions(arr); setPreviewQuestions(null); saveSet(name, arr); dragIdx.current = null; }}
          onDragEnd={() => { setPreviewQuestions(null); dragIdx.current = null; }}
          style={{
            display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", marginBottom: 6,
            border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)",
            cursor: searching ? "default" : "grab", transition: "transform 0.15s ease",
          }}
        >
          {!searching && (isTouch ? (
            <span style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
              <button onClick={() => moveQuestion(idx, -1)} disabled={idx === 0} title="Nach oben" aria-label="Frage nach oben"
                style={{ border: "none", background: "none", padding: "1px 2px", color: "var(--text3)", display: "flex", lineHeight: 1, opacity: idx === 0 ? 0.25 : 1, cursor: idx === 0 ? "default" : "pointer" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 15l-6-6-6 6"/></svg>
              </button>
              <button onClick={() => moveQuestion(idx, 1)} disabled={idx === base.length - 1} title="Nach unten" aria-label="Frage nach unten"
                style={{ border: "none", background: "none", padding: "1px 2px", color: "var(--text3)", display: "flex", lineHeight: 1, opacity: idx === base.length - 1 ? 0.25 : 1, cursor: idx === base.length - 1 ? "default" : "pointer" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
              </button>
            </span>
          ) : (
            <span className="drag-handle" style={{ color: "var(--text3)", width: 20, textAlign: "center", fontSize: 18, cursor: "grab", lineHeight: 1, flexShrink: 0 }}>⠿</span>
          ))}
          <span onClick={() => setEditingQ({ ...q })} style={{ flex: 1, color: "var(--text)", cursor: "pointer" }} title={t("dash.clickEdit")}>
            <Latex>{q.text}</Latex>
            {q.image_url && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 6, verticalAlign: "middle" }}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>}
          </span>
          <button onClick={() => removeQuestion(idx)} style={iconBtn} title={t("common.delete")}><Icon d={ICONS.trash} size={18} color={C.danger} /></button>
        </div>
          );
        });
      })()}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <AddButton onClick={() => setShowAdd(true)} title={t("dash.newQ")} />
      </div>

      {/* Frage bearbeiten — als zentriertes Popup, damit kein Scrollen nötig ist */}
      {editingQ && (
        <div onMouseDown={(e) => { if (e.target === e.currentTarget) setEditingQ(null); }} style={modalOverlay}>
          <div style={modalCard}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h4 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{t("dash.editQ")}</h4>
              <button onClick={() => setEditingQ(null)} title={t("common.close")} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", padding: 4, display: "flex" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <QuestionForm q={editingQ} setQ={setEditingQ} onUpload={uploadImage} choiceKeys={CHOICE_KEYS} />
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <button onClick={updateExistingQuestion} disabled={!editingQ.text.trim()} style={btnPrimary}>{t("common.save")}</button>
              <button onClick={() => setEditingQ(null)} style={btnSecondary}>{t("common.cancel")}</button>
            </div>
            <QuestionStats questionId={editingQ.id} />
          </div>
        </div>
      )}

      {/* Neue Frage — ebenfalls als Popup */}
      {showAdd && (
        <div onMouseDown={(e) => { if (e.target === e.currentTarget) setShowAdd(false); }} style={modalOverlay}>
          <div style={modalCard}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h4 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{t("dash.newQ")}</h4>
              <button onClick={() => setShowAdd(false)} title={t("common.close")} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", padding: 4, display: "flex" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <QuestionForm q={newQ} setQ={setNewQ} onUpload={uploadImage} choiceKeys={CHOICE_KEYS} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={async () => { await addNewQuestion(); setShowAdd(false); }} disabled={!newQ.text.trim()} style={btnPrimary}>{t("dash.add")}</button>
              <button onClick={() => setShowAdd(false)} style={btnSecondary}>{t("common.cancel")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const modalOverlay = sOverlay;
const modalCard = { ...sPanel, maxWidth: 620 };


const LATEX_BUTTONS = [
  { label: "a/b", tex: "\\frac{}{}", cursor: -3 },
  { label: "x²", tex: "^{}", cursor: -1 },
  { label: "x₂", tex: "_{}", cursor: -1 },
  { label: "√", tex: "\\sqrt{}", cursor: -1 },
  { label: "±", tex: "\\pm " },
  { label: "·", tex: "\\cdot " },
  { label: "≠", tex: "\\neq " },
  { label: "≤", tex: "\\leq " },
  { label: "≥", tex: "\\geq " },
  { label: "π", tex: "\\pi " },
  { label: "∑", tex: "\\sum " },
  { label: "∞", tex: "\\infty " },
];

function QuestionForm({ q, setQ, onUpload, choiceKeys }) {
  const { t } = useLanguage();
  const { modules } = useModules();
  const lernpfad = modules.find((m) => m.key === "lernpfad")?.active ?? false;
  const activeKeys = choiceKeys.slice(0, q.num_choices || 4);
  const inputRefs = useRef({});        // { text: el, A: el, B: el, ... }
  const activeField = useRef("text");  // das zuletzt fokussierte Feld

  const getVal = (field) => field === "text" ? (q.text || "") : (q.choices[field] || "");
  const setVal = (field, val) => field === "text"
    ? setQ({ ...q, text: val })
    : setQ({ ...q, choices: { ...q.choices, [field]: val } });

  // Fügt LaTeX in das gerade aktive Feld ein (Fragetext ODER Antwort)
  const insertLatex = (tex, cursorOffset) => {
    const field = activeField.current || "text";
    const input = inputRefs.current[field];
    if (!input) return;
    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    const text = getVal(field);
    const selected = text.slice(start, end);
    let insert = tex;
    if (selected && tex.includes("{}")) {
      insert = tex.replace("{}", `{${selected}}`);
    }
    const needsDollar = !text.slice(0, start).includes("$") || text.slice(0, start).split("$").length % 2 === 1;
    const wrapped = needsDollar ? `$${insert}$` : insert;
    const newText = text.slice(0, start) + wrapped + text.slice(end);
    setVal(field, newText);
    setTimeout(() => {
      const pos = start + wrapped.length + (cursorOffset || 0);
      input.focus();
      input.setSelectionRange(pos, pos);
    }, 0);
  };

  return (
    <>
      <textarea ref={(el) => (inputRefs.current.text = el)} onFocus={() => (activeField.current = "text")} rows={2}
        placeholder={t("dash.qTextPh")} value={q.text} onChange={(e) => setQ({ ...q, text: e.target.value })}
        style={{ padding: "10px 12px", width: "100%", marginBottom: 4, fontSize: 16, border: "1px solid var(--border2)", borderRadius: 8, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", lineHeight: 1.4, color: "var(--text)", background: "var(--bg)" }} autoFocus />
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        {LATEX_BUTTONS.map((b) => (
          <button key={b.label} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertLatex(b.tex, b.cursor)}
            style={{ padding: "3px 8px", fontSize: 13, border: "1px solid var(--border2)", borderRadius: 6, background: "var(--card)", cursor: "pointer", fontFamily: "serif", color: "var(--text)" }}>
            {b.label}
          </button>
        ))}
        <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: 4 }}>{t("dash.latexHint")}</span>
      </div>
      {q.text && q.text.includes("$") && (
        <div style={{ padding: "8px 12px", marginBottom: 10, background: "var(--bg2)", borderRadius: 8, fontSize: 15 }}>
          <Latex>{q.text}</Latex>
        </div>
      )}

      {/* Image */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
        {q.image_url && <img src={q.image_url} alt="" style={{ height: 60, borderRadius: 6, border: "1px solid var(--border3)" }} />}
        <button onClick={() => onUpload((url) => setQ({ ...q, image_url: url }))} type="button" style={btnSecondary}>
          {q.image_url ? t("dash.changeImg") : t("dash.uploadImg")}
        </button>
        {q.image_url && <button onClick={() => setQ({ ...q, image_url: null })} title={t("dash.removeImg")} style={{ display: "flex", alignItems: "center", padding: 6, background: "none", border: "1px solid var(--border2)", borderRadius: 8, cursor: "pointer" }}><Icon d={ICONS.trash} size={18} color={C.danger} /></button>}
        {q.image_url && (
          <select value={q.image_layout} onChange={(e) => setQ({ ...q, image_layout: e.target.value })} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border2)", fontSize: 13 }}>
            <option value="above">{t("dash.imgAbove")}</option>
            <option value="left">{t("dash.imgLeft")}</option>
            <option value="right">{t("dash.imgRight")}</option>
            <option value="background">{t("dash.imgBg")}</option>
          </select>
        )}
      </div>

      {/* Number of choices */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 14, color: "var(--text2)" }}>{t("dash.answers")}</span>
        {[2, 3, 4].map((n) => (
          <button key={n} onClick={() => setQ({ ...q, num_choices: n, correct_answer: n <= choiceKeys.indexOf(q.correct_answer) ? "" : q.correct_answer })}
            style={{ padding: "4px 12px", borderRadius: 6, border: q.num_choices === n ? "2px solid #0066cc" : "1px solid var(--border2)", background: q.num_choices === n ? "var(--accent-bg)" : "var(--card)", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
            {n}
          </button>
        ))}
      </div>

      {/* Thema — nur sichtbar, wenn Lernpfad aktiv ist: allein fuer CardVote
          hat ein Thema keinen Nutzen, und der Rahmen soll keine Felder zeigen,
          die ins Leere laufen. Ohne Thema bleibt die Frage voll nutzbar. */}
      {lernpfad && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, color: "var(--text2)" }}>Thema</span>
          <TopicPicker value={q.topic_id ?? null} onChange={(id) => setQ({ ...q, topic_id: id })} />
          <span style={{ fontSize: 12, color: "var(--text3)" }}>optional — verbindet die Frage mit Lernpfad-Aufgaben</span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 8, marginBottom: 14 }}>
        {activeKeys.map((k) => {
          const isCorrect = (q.correct_answer || "").includes(k);
          const choiceImg = q.choice_images?.[k];
          const toggle = () => {
            const current = q.correct_answer || "";
            const next = isCorrect ? current.replace(k, "") : [...current, k].sort().join("");
            setQ({ ...q, correct_answer: next || "" });
          };
          const uploadChoiceImg = () => {
            onUpload((url) => setQ({ ...q, choice_images: { ...(q.choice_images || {}), [k]: url } }));
          };
          const removeChoiceImg = () => {
            const imgs = { ...(q.choice_images || {}) };
            delete imgs[k];
            setQ({ ...q, choice_images: Object.keys(imgs).length ? imgs : null });
          };
          return (
            <div key={k}>
              <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
                <div onClick={toggle} style={{
                  width: 36, minHeight: 38, display: "flex", alignItems: "center", justifyContent: "center",
                  background: isCorrect ? C.success : "var(--border3)", color: isCorrect ? "#fff" : "var(--text3)",
                  borderRadius: "8px 0 0 8px", cursor: "pointer", fontWeight: 700, fontSize: 14,
                  transition: "all 0.15s ease", userSelect: "none",
                }}>{k}</div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", border: "1px solid var(--border2)", borderLeft: "none", borderRadius: "0 8px 8px 0", overflow: "hidden" }}>
                  <textarea ref={(el) => (inputRefs.current[k] = el)} onFocus={() => (activeField.current = k)} rows={2}
                    placeholder={t("dash.answerPh", { k })} value={q.choices[k] || ""} onChange={(e) => setQ({ ...q, choices: { ...q.choices, [k]: e.target.value } })}
                    style={{ padding: "8px 12px", border: "none", fontSize: 14, outline: "none", background: "transparent", color: "var(--text)", resize: "vertical", fontFamily: "inherit", lineHeight: 1.4 }} />
                  {(q.choices[k] || "").includes("$") && (
                    <div style={{ padding: "6px 12px", background: "var(--bg2)", fontSize: 14, borderTop: "1px solid var(--border3)" }}>
                      <Latex>{q.choices[k]}</Latex>
                    </div>
                  )}
                  {choiceImg && (
                    <div style={{ padding: "4px 8px", background: "var(--bg2)", display: "flex", alignItems: "center", gap: 6 }}>
                      <img src={choiceImg} alt="" style={{ height: 40, borderRadius: 4 }} />
                      <button onClick={removeChoiceImg} title={t("dash.removeImg")} style={{ border: "none", background: "none", cursor: "pointer", display: "flex", alignItems: "center", padding: 2 }}><Icon d={ICONS.trash} size={18} color={C.danger} /></button>
                    </div>
                  )}
                </div>
              </div>
              {!choiceImg && (
                <button onClick={uploadChoiceImg} style={{ fontSize: 11, color: "var(--text3)", background: "none", border: "none", cursor: "pointer", marginTop: 2, marginLeft: 36, padding: "2px 4px" }}>{t("dash.addImg")}</button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function InfoTip({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex", marginLeft: 4 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        style={{
          width: 14, height: 14, borderRadius: 7, border: "1px solid var(--text3)", background: "none",
          color: "var(--text3)", fontSize: 10, lineHeight: "12px", cursor: "pointer", padding: 0,
        }}
      >i</button>
      {open && (
        <div style={{
          position: "absolute", bottom: "140%", left: "50%", transform: "translateX(-50%)",
          width: 220, padding: "8px 10px", background: "var(--text)", color: "var(--bg)",
          borderRadius: 8, fontSize: 11, lineHeight: 1.4, zIndex: 20, fontWeight: 400,
          boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
        }}>{text}</div>
      )}
    </span>
  );
}

function QuestionStats({ questionId }) {
  const { t } = useLanguage();
  const [stats, setStats] = useState(null);
  useEffect(() => {
    if (!questionId) return;
    fetch(`${API}/questions/${questionId}/stats`).then((r) => r.ok ? r.json() : null).then(setStats);
  }, [questionId]);

  if (!stats || stats.total_answers === 0) return (
    <div style={{ padding: "10px 0", color: "var(--text3)", fontSize: 13 }}>{t("dash.noStats")}</div>
  );

  const keys = Object.keys(stats.answer_counts).sort();
  return (
    <div style={{ borderTop: "1px solid var(--border3)", paddingTop: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>
        {t("dash.stats", { times: stats.times_used, answers: stats.total_answers })}
      </div>
      <div style={{ display: "flex", gap: 16, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ background: "var(--bg2)", borderRadius: 8, padding: "6px 12px", textAlign: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: stats.pct_correct >= 80 ? C.success : stats.pct_correct >= 50 ? C.warning : C.danger }}>{stats.pct_correct}%</div>
          <div style={{ fontSize: 11, color: "var(--text3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {t("dash.correct")}
            <InfoTip text={t("dash.ciTip")} />
          </div>
          {stats.ci_low != null && (
            <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>{stats.ci_low}–{stats.ci_high}%</div>
          )}
        </div>
        {stats.item_sd != null && (
          <div style={{ background: "var(--bg2)", borderRadius: 8, padding: "6px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{stats.item_sd.toFixed(2)}</div>
            <div style={{ fontSize: 11, color: "var(--text3)" }}>{t("dash.sd")}</div>
          </div>
        )}
        {["A", "B", "C", "D"].map((k) => {
          const count = stats.answer_counts[k] || 0;
          return (
            <div key={k} style={{ background: "var(--bg2)", borderRadius: 8, padding: "6px 12px", textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{count}</div>
              <div style={{ fontSize: 11, color: "var(--text3)" }}>{k}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
