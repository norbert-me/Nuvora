import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { askConfirm, askPrompt } from "../core/dialog.jsx";
import Latex from "../components/Latex.jsx";
import PublishModal from "../components/PublishModal.jsx";
import { NiveauToggle, AddButton, Icon, ICONS, iconBtn, COLORS as C, btnPrimary, btnSecondary, btnSmall, Toggle, Modal, Popover,
  pageApp, pageTitle, cardStyle, panelStyle, menuRow, SHADOW, inputStyle as inputBasis, selectStyle,
  toolbarBtn, toolbarBtnPrimary, toolbarInput, StatCard, CONTROL_R } from "../components/Icons.jsx";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import ImportMenu from "../components/ImportMenu.jsx";
import { useLanguage } from "../i18n/index.jsx";
import TopicPicker from "../components/TopicPicker.jsx";
import ZoomImage from "../components/ZoomImage.jsx";
import { themenIndex } from "../core/topics.js";
import { useAktiv } from "../core/modules.js";

const API = "/api";

export default function Dashboard() {
  const { t } = useLanguage();
  const [folders, setFolders] = useState([]);
  const [rootSets, setRootSets] = useState([]); // Fragensets ohne Ordner (Top-Level)
  const [allQuestions, setAllQuestions] = useState([]);
  const [path, setPath] = useState([]);
  const [currentFolder, setCurrentFolder] = useState(null);
  const [editingSet, setEditingSet] = useState(null);
  // Ein „+" mit Untermenü (Ordner/Set) statt zwei getrennter Plus-Knöpfe.
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addMode, setAddMode] = useState(null); // null | "folder" | "set"
  const [addName, setAddName] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [movingFolder, setMovingFolder] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [publishingSet, setPublishingSet] = useState(null);
  // Import-Fortschritt: { stage: "reading"|"uploading"|"done"|"error", label }
  const [importStatus, setImportStatus] = useState(null);

  // Fragen, die in keinem Quiz mehr stecken. Sie sind ueber den Editor nicht
  // erreichbar (dorthin kommt man nur ueber ein Quiz), tauchen aber in der
  // Themen-Ansicht auf — dort sehen sie neben ihrem Zwilling aus dem Quiz aus
  // wie eine doppelte Zeile. Deshalb hier sichtbar machen und aufraeumbar.
  const [verwaist, setVerwaist] = useState(null);
  const [verwaistOffen, setVerwaistOffen] = useState(false);

  const ladeVerwaiste = () =>
    fetch(`${API}/questions/verwaist`).then((r) => (r.ok ? r.json() : null)).then(setVerwaist).catch(() => {});

  // Bei 400 Fragen ist Loeschen die falsche erste Antwort: die meisten wollen
  // zugewiesen werden, nicht weg. Deshalb Auswahl + Ziel-Quiz, und Loeschen
  // daneben statt davor.
  const [vAuswahl, setVAuswahl] = useState(() => new Set());
  const [vSuche, setVSuche] = useState("");
  const [vZiel, setVZiel] = useState("");
  const [vMeldung, setVMeldung] = useState("");

  // Alle Quizze flach, mit ihrem Ordnerpfad — sonst heissen drei Quizze
  // „Test 1" und niemand weiss, welches gemeint ist.
  const alleQuizze = (() => {
    const raus = rootSets.map((qs) => ({ id: qs.id, label: qs.name }));
    const lauf = (knoten, pfad) => {
      for (const n of knoten) {
        const hier = pfad ? `${pfad} / ${n.name}` : n.name;
        (n.question_sets || []).forEach((qs) => raus.push({ id: qs.id, label: `${hier} / ${qs.name}` }));
        lauf(n.children || [], hier);
      }
    };
    lauf(folders, "");
    return raus.sort((a, b) => a.label.localeCompare(b.label, "de", { numeric: true }));
  })();

  const vGefiltert = (verwaist?.fragen || []).filter((q) =>
    !vSuche.trim() || (q.text || "").toLowerCase().includes(vSuche.trim().toLowerCase()));

  const vUmschalten = (id) => setVAuswahl((alt) => {
    const neu = new Set(alt);
    neu.has(id) ? neu.delete(id) : neu.add(id);
    return neu;
  });

  // Die Liste zeigt nur den Fragetext — was tatsaechlich abgefragt wird, steht
  // in den Antworten und im Bild. Ohne Blick hinein weiss man nicht, wohin die
  // Frage gehoert. Also aufklappbar, direkt hier: eine Frage ohne Quiz hat
  // keinen anderen Ort, an dem man sie oeffnen koennte.
  const [vEdit, setVEdit] = useState(null);

  const vOeffnen = async (id) => {
    const r = await fetch(`${API}/questions/${id}`);
    if (r.ok) setVEdit(await r.json());
  };

  const vSpeichern = async () => {
    if (!vEdit?.text?.trim()) return;
    const r = await fetch(`${API}/questions/${vEdit.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(vEdit),
    });
    if (!r.ok) return;
    setVEdit(null);
    await ladeVerwaiste();
  };

  const vBildHochladen = (setter) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,.svg";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API}/questions/upload-image`, { method: "POST", body: form });
      setter((await res.json()).url);
    };
    input.click();
  };

  const vZuweisen = async () => {
    if (!vZiel || vAuswahl.size === 0) return;
    setVMeldung("");
    const ids = [...vAuswahl];
    const r = await fetch(`${API}/question-sets/${vZiel}/questions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question_ids: ids }),
    });
    if (!r.ok) { setVMeldung((await r.json().catch(() => ({}))).detail || t("common.error")); return; }
    setVAuswahl(new Set());
    setVMeldung(t("dash.orphansAssigned", { n: ids.length }));
    await ladeVerwaiste();
    load();
  };

  const vAuswahlLoeschen = async () => {
    const ids = [...vAuswahl].filter((id) => !(verwaist?.fragen || []).find((q) => q.id === id)?.hat_ergebnisse);
    if (!ids.length) return;
    if (!await askConfirm(t("dash.orphansCleanAsk", { n: ids.length }), { ok: t("common.delete"), danger: true })) return;
    for (const id of ids) await fetch(`${API}/questions/${id}`, { method: "DELETE" });
    setVAuswahl(new Set());
    await ladeVerwaiste();
    load();
  };

  const verwaisteAufraeumen = async () => {
    const ok = await askConfirm(t("dash.orphansCleanAsk", { n: verwaist?.loeschbar ?? 0 }),
                                { ok: t("common.delete"), danger: true });
    if (!ok) return;
    const r = await fetch(`${API}/questions/verwaist`, { method: "DELETE" });
    if (!r.ok) return;
    await ladeVerwaiste();
    setVerwaistOffen(false);
    load();
  };

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
    ladeVerwaiste();
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

  // Deep-Link ?set=<id> (z. B. aus dem Kalender): das Fragenset in seinem Ordner
  // öffnen. Einmalig, sobald die Ordner/Sets geladen sind.
  const [params, setParams] = useSearchParams();
  const [openedSet, setOpenedSet] = useState(false);
  useEffect(() => {
    if (openedSet) return;
    const sid = Number(params.get("set"));
    if (!sid) return;
    const clear = () => { setOpenedSet(true); params.delete("set"); setParams(params, { replace: true }); };
    const top = rootSets.find((s) => s.id === sid);
    if (top) { setPath([]); setCurrentFolder(null); setEditingSet(top); clear(); return; }
    const walk = (nodes, trail) => {
      for (const n of nodes) {
        const s = (n.question_sets || []).find((x) => x.id === sid);
        const here = [...trail, { id: n.id, name: n.name }];
        if (s) return { set: s, trail: here, folderId: n.id };
        const deeper = walk(n.children || [], here);
        if (deeper) return deeper;
      }
      return null;
    };
    const r = walk(folders, []);
    if (r) { setPath(r.trail); setCurrentFolder(r.folderId); setEditingSet(r.set); clear(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders, rootSets]);

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
    setNewFolderName(""); load();
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
    <div style={{ ...pageApp }}>
      <h1 style={pageTitle}>{t("nav.questions")}</h1>

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

      {/* Fragen ohne Quiz — nur wenn es welche gibt. Ein Hinweis, der immer da
          steht, wird nach zwei Tagen nicht mehr gelesen. */}
      {verwaist?.anzahl > 0 && (
        <div style={{ ...panelStyle, marginBottom: 16, padding: 12, fontSize: 13, color: "var(--text2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>{t("dash.orphans", { n: verwaist.anzahl })}</span>
            <button onClick={() => setVerwaistOffen((v) => !v)} style={{ ...btnSecondary, ...btnSmall }}>
              {verwaistOffen ? t("common.close") : t("dash.orphansShow")}
            </button>
          </div>

          {verwaistOffen && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "12px 0 8px" }}>
                {/* Suchfeld und Auswahlfeld darunter stehen in derselben Leiste:
                    eine Hoehe (CONTROL_H), eine Form — abgeleitet, nicht neu gebaut. */}
                <input value={vSuche} onChange={(e) => setVSuche(e.target.value)} placeholder={t("dash.searchQ")}
                  style={{ ...toolbarInput, flex: 1, minWidth: 160, maxWidth: 280 }} />
                <button onClick={() => setVAuswahl(new Set(vGefiltert.map((q) => q.id)))} style={toolbarBtn}>
                  {t("dash.orphansSelectAll", { n: vGefiltert.length })}
                </button>
                {vAuswahl.size > 0 && (
                  <button onClick={() => setVAuswahl(new Set())} style={toolbarBtn}>
                    {t("dash.orphansSelectNone")}
                  </button>
                )}
              </div>

              {/* Zuweisen steht VOR dem Loeschen — bei 400 Fragen ist das der
                  Normalfall, Loeschen die Ausnahme. */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                <select value={vZiel} onChange={(e) => setVZiel(e.target.value)}
                  style={{ ...selectStyle, maxWidth: 320 }}>
                  <option value="">{t("dash.orphansPickSet")}</option>
                  {alleQuizze.map((qs) => <option key={qs.id} value={String(qs.id)}>{qs.label}</option>)}
                </select>
                <button onClick={vZuweisen} disabled={!vZiel || vAuswahl.size === 0}
                  style={{ ...toolbarBtnPrimary, opacity: (!vZiel || vAuswahl.size === 0) ? 0.5 : 1 }}>
                  {t("dash.orphansAssign", { n: vAuswahl.size })}
                </button>
                <button onClick={vAuswahlLoeschen} disabled={vAuswahl.size === 0}
                  style={{ ...toolbarBtn, color: C.danger, borderColor: C.danger, opacity: vAuswahl.size === 0 ? 0.5 : 1 }}>
                  {t("dash.orphansDeleteSel", { n: vAuswahl.size })}
                </button>
                {verwaist.loeschbar > 0 && (
                  <button onClick={verwaisteAufraeumen} style={{ ...toolbarBtn, color: "var(--text3)" }}>
                    {t("dash.orphansClean", { n: verwaist.loeschbar })}
                  </button>
                )}
                {vMeldung && <span style={{ color: C.success }}>{vMeldung}</span>}
              </div>

              <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid var(--border)", borderRadius: CONTROL_R, background: "var(--card)" }}>
                {vGefiltert.map((q) => (
                  <label key={q.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--border)", cursor: "pointer", lineHeight: 1.5 }}>
                    <input type="checkbox" checked={vAuswahl.has(q.id)} onChange={() => vUmschalten(q.id)} style={{ marginTop: 3 }} />
                    <span onClick={(e) => { e.preventDefault(); vOeffnen(q.id); }}
                          title={t("dash.clickEdit")}
                          style={{ flex: 1, color: "var(--text)", cursor: "pointer" }}>
                      <Latex>{q.text}</Latex>
                      {/* Mit Ergebnissen wird nichts geloescht: daran haengen die
                          Auswertungen gehaltener Sitzungen. */}
                      {q.hat_ergebnisse && <span style={{ color: "var(--text3)" }}> · {t("dash.orphansKept")}</span>}
                    </span>
                  </label>
                ))}
                {vGefiltert.length === 0 && <p style={{ padding: 10, margin: 0, color: "var(--text3)" }}>{t("dash.noSearchHit")}</p>}
              </div>
            </>
          )}

          {/* Dieselbe Maske wie im Quiz — inklusive Thema. Eine Frage ohne Quiz
              ist sonst nirgends zu oeffnen. */}
          {vEdit && (
            <Modal onClose={() => setVEdit(null)} width={620} label={t("dash.editQ")}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <h4 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{t("dash.editQ")}</h4>
                <button onClick={() => setVEdit(null)} title={t("common.close")} className="icon-btn" aria-label={t("common.close")} style={iconBtn}>
                  <Icon d={ICONS.close} size={18} />
                </button>
              </div>
              <QuestionForm q={vEdit} setQ={setVEdit} onUpload={vBildHochladen} choiceKeys={["A", "B", "C", "D"]} />
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button onClick={vSpeichern} disabled={!vEdit.text?.trim()} style={btnPrimary}>{t("common.save")}</button>
                <button onClick={() => setVEdit(null)} style={btnSecondary}>{t("common.cancel")}</button>
              </div>
            </Modal>
          )}
        </div>
      )}

      {/* Move dialog */}
      {movingFolder && (
        // Die feste Warnfarbe (#fff3cd auf #ffc107) blieb im Dunkelmodus hell
        // und war dort ein weisser Block. Panel + Akzentrand tun dasselbe und
        // wechseln mit dem Design mit.
        <div style={{ ...panelStyle, padding: 16, marginBottom: 16, border: `1px solid ${C.warning}` }}>
          <strong>{t("dash.moveTo")}</strong>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <button onClick={() => moveFolder(movingFolder, null)} style={zielBtn}>{t("dash.root")}</button>
            {moveTargets.map((f) => (
              <button key={f.id} onClick={() => moveFolder(movingFolder, f.id)} style={zielBtn}>
                {"—".repeat(f.depth)} {f.name}
              </button>
            ))}
            <button onClick={() => setMovingFolder(null)} style={zielBtn}>{t("common.cancel")}</button>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        {currentChildren.map((f) => (
          <div key={f.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", ...cardStyle, marginBottom: 8, cursor: "pointer" }}>
            <span onClick={() => renamingFolder !== f.id && openFolder(f)} style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              {/* Ordner-Icon nur in der Ansicht — beim Umbenennen weg, sonst
                  überlappt es das Eingabefeld. */}
              {renamingFolder !== f.id && <Icon d={ICONS.folder} size={18} color="currentColor" />}
              {renamingFolder === f.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRenameFolder}
                  onKeyDown={(e) => { if (e.key === "Enter") commitRenameFolder(); if (e.key === "Escape") setRenamingFolder(null); }}
                  onClick={(e) => e.stopPropagation()}
                  style={{ ...inputBasis, fontWeight: 700, fontSize: 16, padding: "4px 10px", border: "2px solid var(--accent)", background: "var(--input-bg)", outline: "none", flex: 1, minWidth: 0 }}
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
            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              <button onClick={(e) => { e.stopPropagation(); exportFolder(f.id, f.name); }} className="icon-btn" style={iconBtn} title={t("classes.export")} aria-label={t("classes.export")}><Icon d={ICONS.export} size={18} /></button>
              <button onClick={(e) => { e.stopPropagation(); setMovingFolder(f.id); }} className="icon-btn" style={iconBtn} title={t("dash.move")} aria-label={t("dash.move")}><Icon d={ICONS.move} size={18} /></button>
              <button onClick={(e) => { e.stopPropagation(); startRenameFolder(f.id, f.name); }} className="icon-btn" style={iconBtn} title={t("dash.rename")} aria-label={t("dash.rename")}><Icon d={ICONS.edit} size={18} /></button>
            </div>
            ) : (
            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              {/* onMouseDown + preventDefault: sonst schließt das Umbenennen-Feld
                  per onBlur zuerst, der Knopf verschwindet und der Klick geht
                  ins Leere — das Löschen passierte nie. */}
              <button onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); deleteFolder(f.id); }}
                className="icon-btn" style={iconBtn} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={18} color={C.danger} /></button>
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
            <div key={qs.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", ...cardStyle, marginBottom: 8, cursor: "pointer" }}>
              <span onClick={() => setEditingSet(qs)} style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <strong style={{ color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{qs.name}</strong>
              </span>
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={(e) => { e.stopPropagation(); openPublish(qs); }} className="icon-btn" style={iconBtn} title={t("dash.publishTitle")} aria-label={t("dash.publishTitle")}>
                  <Icon d={ICONS.share} size={18} color="var(--accent)" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); duplicateSet(qs.id); }} className="icon-btn" style={iconBtn} title={t("dash.duplicate")} aria-label={t("dash.duplicate")}><Icon d={ICONS.duplicate} size={18} /></button>
                <button onClick={async (e) => { e.stopPropagation(); const r = await fetch(`${API}/export/question-set/${qs.id}`); if (!r.ok) return; const b = await r.blob(); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `${qs.name}.json`; a.click(); URL.revokeObjectURL(a.href); }} className="icon-btn" style={iconBtn} title={t("classes.export")} aria-label={t("classes.export")}><Icon d={ICONS.export} size={18} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Eine Leiste, eine Hoehe: Feld, OK, Abbrechen und der Import standen
          vorher in drei verschiedenen Groessen nebeneinander. */}
      <Werkzeugleiste style={{ marginBottom: 0 }}>
        {addMode ? (
          <>
            <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder={addMode === "folder" ? t("dash.folderName") : t("dash.setName")} style={{ ...toolbarInput, minWidth: 200 }} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && addName.trim()) { (addMode === "folder" ? createFolder(addName.trim()) : createSet(addName.trim())); setAddName(""); setAddMode(null); } if (e.key === "Escape") { setAddName(""); setAddMode(null); } }} />
            <button onClick={() => { if (addName.trim()) { (addMode === "folder" ? createFolder(addName.trim()) : createSet(addName.trim())); setAddName(""); setAddMode(null); } }} style={toolbarBtnPrimary}>OK</button>
            <button onClick={() => { setAddName(""); setAddMode(null); }} style={toolbarBtn} title={t("common.cancel")} aria-label={t("common.cancel")}>
              <Icon d={ICONS.close} size={15} />
            </button>
          </>
        ) : (
          <span style={{ position: "relative", display: "inline-flex" }}>
            <AddButton onClick={() => setAddMenuOpen((v) => !v)} title={t("common.add")} />
            {addMenuOpen && (<>
              <div onClick={() => setAddMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
              <Popover style={{ minWidth: 180, padding: 4 }}>
                <button onClick={() => { setAddMenuOpen(false); setAddMode("folder"); }} style={menuRow}><Icon d={ICONS.plus} size={15} /> {t("dash.newFolder")}</button>
                <button onClick={() => { setAddMenuOpen(false); setAddMode("set"); }} style={menuRow}><Icon d={ICONS.plus} size={15} /> {t("dash.newSet")}</button>
              </Popover>
            </>)}
          </span>
        )}
        <ImportMenu
          importItems={[
            { label: t("dash.importJsonItem"), onClick: importFolder },
            ...(currentFolder ? [{ label: t("classes.importExcel"), onClick: importXlsx }] : []),
          ]}
          templateItems={[
            { label: t("classes.templateExcel"), href: `${API}/import/questions-template.xlsx` },
            { label: t("dash.jsonExample"), href: "/beispiel-frageset.json" },
            { label: t("dash.jsonFolderExample"), href: "/beispiel-ordner.json" },
          ]}
        />
      </Werkzeugleiste>

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
      <div style={{ ...cardStyle, width: "min(420px, 92vw)", boxShadow: SHADOW.schwebend }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          {stage === "done" ? (
            <Icon d={ICONS.check} size={18} color={C.success} />
          ) : stage === "error" ? (
            <Icon d={ICONS.close} size={18} color={C.danger} />
          ) : (
            <><Icon d={ICONS.spinner} size={18} color={s.color} style={{ animation: "spin 0.9s linear infinite" }} /><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></>
          )}
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{s.title}</span>
        </div>
        {label && <div style={{ fontSize: 12, color: stage === "error" ? C.danger : "var(--text3)", marginBottom: 8, marginLeft: 24 }}>{label}</div>}
        {/* Reine Grafik: der Radius ist die halbe Kante (6/2) — der Balken ist
            rund, das ist kein Bedienelement-Radius. */}
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

// Hiess frueher `btnSmall` und ueberschattete damit das gleichnamige Token aus
// Icons.jsx — beim Lesen war nicht zu sehen, welcher gilt. (Das lokale
// `inputStyle` daneben ist ganz weg: die Felder nehmen jetzt die Leisten- bzw.
// Kern-Form.)
const zielBtn = { ...btnSecondary, ...btnSmall, background: "none", border: "none", color: "var(--text3)" };

function QuestionSetEditor({ questionSet, allQuestions, onBack, onDelete, onQuestionsChange }) {
  const [qSearch, setQSearch] = useState("");
  // Themenfilter und -sortierung der Fragenliste. Beides wirkt nur auf die
  // ANZEIGE: die gespeicherte Reihenfolge des Quiz bleibt, wie sie ist —
  // sonst haette ein Blick nach Thema die Abfolge im Unterricht umgestellt.
  const [qThema, setQThema] = useState("");      // "" = alle, "0" = ohne Thema, sonst topic_id
  const [qNachThema, setQNachThema] = useState(false);
  const [themen, setThemen] = useState([]);

  useEffect(() => {
    fetch("/api/topics").then((r) => (r.ok ? r.json() : [])).then((d) => setThemen(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);
  const themaIdx = themenIndex(themen);
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
  // E/G: alle sehen dieselben Fragen, unterschieden wird erst in der Auswertung.
  const [niveauAktiv, setNiveauAktiv] = useState(questionSet.niveau_aktiv || false);
  const [minuspunkte, setMinuspunkte] = useState(questionSet.minuspunkte || false);
  const [niveaus, setNiveaus] = useState(questionSet.niveaus || {});
  const [showAdd, setShowAdd] = useState(false);
  const [editingQ, setEditingQ] = useState(null);
  const [saving, setSaving] = useState(false);
  const EMPTY_Q = { text: "", choices: { A: "", B: "", C: "", D: "" }, correct_answer: "", num_choices: 4, image_url: null, image_layout: "above", choice_images: null, topic_id: null };
  const [newQ, setNewQ] = useState({ ...EMPTY_Q });

  const saveSet = async (updatedName, updatedQuestions, patch = {}) => {
    setSaving(true);
    await fetch(`${API}/question-sets/${questionSet.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: updatedName, folder_id: questionSet.folder_id,
        question_ids: updatedQuestions.map((q) => q.id),
        shuffle_questions: shuffleQ,
        shuffle_answers: shuffleA,
        niveau_aktiv: niveauAktiv,
        minuspunkte,
        niveaus,
        ...patch,
      }),
    });
    setSaving(false);
    onQuestionsChange();
  };

  const saveName = () => saveSet(name, questions);


  const toggleShuffleQ = () => { const v = !shuffleQ; setShuffleQ(v); saveSet(name, questions, { shuffle_questions: v }); };
  const toggleShuffleA = () => { const v = !shuffleA; setShuffleA(v); saveSet(name, questions, { shuffle_answers: v }); };
  const toggleNiveau = () => { const v = !niveauAktiv; setNiveauAktiv(v); saveSet(name, questions, { niveau_aktiv: v }); };
  const toggleMinus = () => { const v = !minuspunkte; setMinuspunkte(v); saveSet(name, questions, { minuspunkte: v }); };
  // Niveau einer Frage IN DIESEM Quiz umschalten. Ohne Eintrag gilt G.
  const toggleQNiveau = (qid) => {
    const next = { ...niveaus, [qid]: (niveaus[qid] === "E" ? "G" : "E") };
    setNiveaus(next);
    saveSet(name, questions, { niveaus: next });
  };

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
  const dragWork = useRef(null); // Arbeits-Reihenfolge während des Ziehens (stabil, kein State-Lag)
  const [previewQuestions, setPreviewQuestions] = useState(null);

  // Vorschau inkrementell: das gezogene Element in der ARBEITS-Liste von seiner
  // aktuellen Position auf die überfahrene schieben — nicht immer aus dem Original
  // (das verlor bei Mehrschritt-Drags die Identität; Ablegen speicherte falsch).
  const reorderPreview = (from, to) => {
    if (from == null || from === to || !dragWork.current) return;
    const arr = dragWork.current;
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    setPreviewQuestions([...arr]);
  };

  const uploadImage = async (setter) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,.svg";
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
      <button onClick={onBack} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", color: "var(--text3)", fontSize: 13, fontWeight: 500, padding: "4px 0", marginBottom: 16 }}>
        <Icon d={ICONS.arrowLeft} size={14} /> {t("common.back")}
      </button>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        {/* Der Quizname IST die Seitenueberschrift — deshalb 22 wie pageTitle. */}
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === "Enter" && saveName()}
          style={{ ...inputBasis, fontSize: 22, fontWeight: 700, flex: 1, maxWidth: 500 }} />
        {saving && <span style={{ color: "var(--text3)", fontSize: 13 }}>{t("dash.saving")}</span>}
        {onDelete && <button onClick={onDelete} className="icon-btn" style={{ ...iconBtn, marginLeft: "auto" }} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={18} color={C.danger} /></button>}
      </div>

      <div style={{ display: "flex", gap: 24, marginBottom: 8, flexWrap: "wrap" }}>
        <Toggle checked={shuffleQ} onChange={toggleShuffleQ} label={t("dash.shuffleQ")} />
        <Toggle checked={shuffleA} onChange={toggleShuffleA} label={t("dash.shuffleA")} />
        <Toggle checked={niveauAktiv} onChange={toggleNiveau} label={t("dash.niveauToggle")} />
        <Toggle checked={minuspunkte} onChange={toggleMinus} label={t("dash.minusToggle")} />
      </div>
      {(niveauAktiv || minuspunkte) && (
        <p style={{ fontSize: 13, color: "var(--text3)", margin: "0 0 16px", lineHeight: 1.5 }}>
          {niveauAktiv && t("dash.niveauHint")}{niveauAktiv && minuspunkte ? " " : ""}{minuspunkte && t("dash.minusHint")}
        </p>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", margin: 0 }}>{t("dash.questionsCount", { count: questions.length })}</h3>
        {questions.length > 3 && (
          <input
            value={qSearch} onChange={(e) => setQSearch(e.target.value)} placeholder={t("dash.searchQ")}
            style={{ ...toolbarInput, flex: 1, minWidth: 160, maxWidth: 320 }}
          />
        )}
        {/* Themenfilter — nur wenn es Themen gibt: ein Filter ueber eine leere
            Liste ist ein toter Kasten. */}
        {themaIdx.liste.length > 0 && (
          <>
            <select value={qThema} onChange={(e) => setQThema(e.target.value)} title={t("dash.filterTopic")}
              style={{ ...selectStyle, maxWidth: 260 }}>
              <option value="">{t("dash.allTopics")}</option>
              <option value="0">{t("dash.withoutTopic")}</option>
              {themaIdx.geordnet.map((tp) => <option key={tp.id} value={String(tp.id)}>{themaIdx.label(tp)}</option>)}
            </select>
            <Toggle checked={qNachThema} onChange={() => setQNachThema((v) => !v)} label={t("dash.sortTopic")} />
          </>
        )}
      </div>

      {(() => {
        const base = previewQuestions || questions;
        const term = qSearch.trim().toLowerCase();
        const inText = (q) => (q.text || "").toLowerCase().includes(term)
          || Object.values(q.choices || {}).some((v) => typeof v === "string" && v.toLowerCase().includes(term));
        const passtThema = (q) => (qThema === "" ? true
          : qThema === "0" ? q.topic_id == null
          : String(q.topic_id ?? "") === qThema);
        let shown = base.filter((q) => (term ? inText(q) : true) && passtThema(q));
        if (qNachThema) {
          // Ohne Thema ans Ende — die Frage „was hat noch keins?" beantwortet
          // sich sonst nur durch Suchen in der ganzen Liste.
          shown = [...shown].sort((x, y) => {
            const a1 = themaIdx.labelFuerId(x.topic_id), b1 = themaIdx.labelFuerId(y.topic_id);
            if (!a1 !== !b1) return a1 ? -1 : 1;
            return a1.localeCompare(b1, "de", { numeric: true });
          });
        }
        // Beim Suchen, Filtern oder Sortieren kein Ziehen: der Index der
        // Anzeige passt dann nicht zur echten Reihenfolge, ein Drop wuerde die
        // falsche Frage verschieben.
        const searching = term.length > 0 || qThema !== "" || qNachThema;
        if (shown.length === 0) {
          return <p style={{ fontSize: 13, color: "var(--text3)" }}>{t("dash.noSearchHit")}</p>;
        }
        return shown.map((q) => {
          const idx = base.indexOf(q);
          return (
        <div
          key={q.id}
          draggable={!searching && !isTouch}
          onDragStart={(e) => { if (searching) return; e.dataTransfer.effectAllowed = "move"; dragWork.current = [...base]; dragIdx.current = idx; }}
          onDragOver={(e) => { if (searching || dragIdx.current == null) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (idx !== dragIdx.current) { reorderPreview(dragIdx.current, idx); dragIdx.current = idx; } }}
          onDrop={(e) => { if (searching) return; e.preventDefault(); const arr = dragWork.current || previewQuestions || questions; setQuestions(arr); setPreviewQuestions(null); saveSet(name, arr); dragIdx.current = null; dragWork.current = null; }}
          onDragEnd={() => { setPreviewQuestions(null); dragIdx.current = null; dragWork.current = null; }}
          style={{
            ...cardStyle,
            display: "flex", alignItems: "center", gap: 8, padding: 12, marginBottom: 4,
            cursor: searching ? "default" : "grab", transition: "transform 0.15s ease",
          }}
        >
          {!searching && (isTouch ? (
            <span style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
              <button onClick={() => moveQuestion(idx, -1)} disabled={idx === 0} title="Nach oben" aria-label="Frage nach oben"
                style={{ border: "none", background: "none", padding: "1px 2px", color: "var(--text3)", display: "flex", lineHeight: 1, opacity: idx === 0 ? 0.25 : 1, cursor: idx === 0 ? "default" : "pointer" }}>
                <Icon d={ICONS.chevronUp} size={18} color="currentColor" />
              </button>
              <button onClick={() => moveQuestion(idx, 1)} disabled={idx === base.length - 1} title="Nach unten" aria-label="Frage nach unten"
                style={{ border: "none", background: "none", padding: "1px 2px", color: "var(--text3)", display: "flex", lineHeight: 1, opacity: idx === base.length - 1 ? 0.25 : 1, cursor: idx === base.length - 1 ? "default" : "pointer" }}>
                <Icon d={ICONS.chevronDown} size={18} color="currentColor" />
              </button>
            </span>
          ) : (
            <span className="drag-handle" style={{ color: "var(--text3)", width: 20, display: "inline-flex", justifyContent: "center", cursor: "grab", flexShrink: 0 }}><Icon d={ICONS.grip} size={15} /></span>
          ))}
          {niveauAktiv && (
            <NiveauToggle wert={niveaus[q.id] === "E" ? "E" : "G"} mitLeer={false}
              onChange={() => toggleQNiveau(q.id)} title={t("dash.niveauQHint")} />
          )}
          <span onClick={() => setEditingQ({ ...q })} style={{ flex: 1, color: "var(--text)", cursor: "pointer" }} title={t("dash.clickEdit")}>
            <Latex>{q.text}</Latex>
            {q.image_url && <Icon d={ICONS.image} size={18} color="var(--accent)" style={{ marginLeft: 4 }} />}
            {/* Das Thema an der Frage — ohne es sieht man zwei gleich
                aussehende Fragen und weiss nicht, welche wohin gehoert. */}
            {themaIdx.liste.length > 0 && (
              <span style={{ marginLeft: 8, fontSize: 12, color: q.topic_id ? "var(--text3)" : C.warning }}>
                {q.topic_id ? themaIdx.labelFuerId(q.topic_id) : t("dash.withoutTopic")}
              </span>
            )}
          </span>
          <button onClick={() => removeQuestion(idx)} style={iconBtn} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={18} color={C.danger} /></button>
        </div>
          );
        });
      })()}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <AddButton onClick={() => setShowAdd(true)} title={t("dash.newQ")} />
      </div>

      {/* Frage bearbeiten — als zentriertes Popup, damit kein Scrollen nötig ist */}
      {editingQ && (
        <Modal onClose={() => setEditingQ(null)} width={620} label={t("dash.editQ")}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h4 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{t("dash.editQ")}</h4>
              <button onClick={() => setEditingQ(null)} title={t("common.close")} className="icon-btn" aria-label={t("common.close")} style={iconBtn}>
                <Icon d={ICONS.close} size={18} />
              </button>
            </div>
            <QuestionForm q={editingQ} setQ={setEditingQ} onUpload={uploadImage} choiceKeys={CHOICE_KEYS} />
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <button onClick={updateExistingQuestion} disabled={!editingQ.text.trim()} style={btnPrimary}>{t("common.save")}</button>
              <button onClick={() => setEditingQ(null)} style={btnSecondary}>{t("common.cancel")}</button>
            </div>
            <QuestionStats questionId={editingQ.id} />
        </Modal>
      )}

      {/* Neue Frage — ebenfalls als Popup */}
      {showAdd && (
        <Modal onClose={() => setShowAdd(false)} width={620} label={t("dash.newQ")}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h4 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{t("dash.newQ")}</h4>
              <button onClick={() => setShowAdd(false)} title={t("common.close")} className="icon-btn" aria-label={t("common.close")} style={iconBtn}>
                <Icon d={ICONS.close} size={18} />
              </button>
            </div>
            <QuestionForm q={newQ} setQ={setNewQ} onUpload={uploadImage} choiceKeys={CHOICE_KEYS} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={async () => { await addNewQuestion(); setShowAdd(false); }} disabled={!newQ.text.trim()} style={btnPrimary}>{t("dash.add")}</button>
              <button onClick={() => setShowAdd(false)} style={btnSecondary}>{t("common.cancel")}</button>
            </div>
        </Modal>
      )}
    </div>
  );
}



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
  // Tabelle: KaTeX kennt `array`, nicht `tabular`. Das Geruest kommt fertig
  // hin, weil kaum jemand die Spaltenangabe („{|c|c|}") aus dem Kopf schreibt
  // — und ein halb getipptes array rendert gar nichts.
  { label: "⊞ Tabelle", tex: "\\begin{array}{|c|c|}\\hline  &  \\\\ \\hline  &  \\\\ \\hline\\end{array}", cursor: -40, display: true },
];

function QuestionForm({ q, setQ, onUpload, choiceKeys }) {
  const { t } = useLanguage();
  const aktiv = useAktiv();
  const lernpfad = aktiv("lernpfad");
  const activeKeys = choiceKeys.slice(0, q.num_choices || 4);
  const inputRefs = useRef({});        // { text: el, A: el, B: el, ... }
  const activeField = useRef("text");  // das zuletzt fokussierte Feld

  const getVal = (field) => field === "text" ? (q.text || "") : (q.choices[field] || "");
  const setVal = (field, val) => field === "text"
    ? setQ({ ...q, text: val })
    : setQ({ ...q, choices: { ...q.choices, [field]: val } });

  // Fügt LaTeX in das gerade aktive Feld ein (Fragetext ODER Antwort)
  const insertLatex = (tex, cursorOffset, display = false) => {
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
    // Eine Tabelle gehoert in eine eigene Zeile ($$), nicht mitten in den Satz.
    const zeichen = display ? "$$" : "$";
    const wrapped = needsDollar ? `${zeichen}${insert}${zeichen}` : insert;
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
        style={{ ...inputBasis, width: "100%", marginBottom: 4, fontSize: 16, resize: "vertical", fontFamily: "inherit", lineHeight: 1.4 }} autoFocus />
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        {LATEX_BUTTONS.map((b) => (
          <button key={b.label} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertLatex(b.tex, b.cursor, b.display)}
            style={{ ...btnSecondary, ...btnSmall, padding: "4px 8px", borderRadius: CONTROL_R, fontFamily: "serif" }}>
            {b.label}
          </button>
        ))}
        <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: 4 }}>{t("dash.latexHint")}</span>
      </div>
      {q.text && q.text.includes("$") && (
        <div style={{ padding: "8px 12px", marginBottom: 8, background: "var(--bg2)", borderRadius: CONTROL_R, fontSize: 16 }}>
          <Latex>{q.text}</Latex>
        </div>
      )}

      {/* Image */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        {q.image_url && <ZoomImage src={q.image_url} title={t("dash.zoomImg")} style={{ height: 60, borderRadius: CONTROL_R, border: "1px solid var(--border3)" }} />}
        <button onClick={() => onUpload((url) => setQ({ ...q, image_url: url }))} type="button" style={btnSecondary}>
          {q.image_url ? t("dash.changeImg") : t("dash.uploadImg")}
        </button>
        {q.image_url && <button onClick={() => setQ({ ...q, image_url: null })} title={t("dash.removeImg")} style={{ ...iconBtn, border: "1px solid var(--border2)", borderRadius: CONTROL_R }}><Icon d={ICONS.trash} size={18} color={C.danger} /></button>}
        {q.image_url && (
          <select value={q.image_layout} onChange={(e) => setQ({ ...q, image_layout: e.target.value })} style={selectStyle}>
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
            style={{ ...btnSecondary, ...btnSmall, borderRadius: CONTROL_R, border: q.num_choices === n ? "2px solid var(--accent)" : "1px solid var(--border2)", background: q.num_choices === n ? "var(--accent-bg)" : "var(--card)", fontWeight: 600 }}>
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
              {/* stretch, nicht center: das Feld ist zwei Zeilen hoch (und per
                  Ziehgriff noch hoeher), die Marke war 38 px — dann sitzt sie
                  mittig neben einem hohen Kasten, und der Rahmen des Feldes
                  laeuft ober- und unterhalb an ihr vorbei. Genau das sah aus,
                  als haenge sie nicht am Feld. */}
              <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
                {/* flexShrink: 0 ist Pflicht, nicht Kosmetik: ein <textarea>
                    bringt eine eigene Mindestbreite mit (cols), die Flexbox
                    nicht unterschreitet — ohne die beiden Angaben quetscht das
                    Antwortfeld den Buchstaben auf die halbe Breite, und A/B/C
                    sehen aus, als lägen sie unter dem Feld. */}
                <div onClick={toggle} style={{
                  width: 36, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                  background: isCorrect ? C.success : "var(--border3)", color: isCorrect ? C.aufAkzent : "var(--text3)",
                  borderRadius: `${CONTROL_R}px 0 0 ${CONTROL_R}px`, cursor: "pointer", fontWeight: 700, fontSize: 14,
                  transition: "all 0.15s ease", userSelect: "none",
                }}>{k}</div>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", border: "1px solid var(--border2)", borderLeft: "none", borderRadius: `0 ${CONTROL_R}px ${CONTROL_R}px 0`, overflow: "hidden" }}>
                  <textarea ref={(el) => (inputRefs.current[k] = el)} onFocus={() => (activeField.current = k)} rows={2}
                    placeholder={t("dash.answerPh", { k })} value={q.choices[k] || ""} onChange={(e) => setQ({ ...q, choices: { ...q.choices, [k]: e.target.value } })}
                    style={{ padding: "8px 12px", width: "100%", boxSizing: "border-box", border: "none", fontSize: 14, outline: "none", background: "transparent", color: "var(--text)", resize: "vertical", fontFamily: "inherit", lineHeight: 1.4 }} />
                  {(q.choices[k] || "").includes("$") && (
                    <div style={{ padding: "6px 12px", background: "var(--bg2)", fontSize: 14, borderTop: "1px solid var(--border3)" }}>
                      <Latex>{q.choices[k]}</Latex>
                    </div>
                  )}
                  {choiceImg && (
                    <div style={{ padding: "4px 8px", background: "var(--bg2)", display: "flex", alignItems: "center", gap: 4 }}>
                      <ZoomImage src={choiceImg} title={t("dash.zoomImg")} style={{ height: 40, borderRadius: CONTROL_R }} />
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
        aria-label={text}
        style={{ ...iconBtn, padding: 0 }}
      ><Icon d={ICONS.info} size={14} /></button>
      {open && (
        <div style={{
          position: "absolute", bottom: "140%", left: "50%", transform: "translateX(-50%)",
          width: 220, padding: 8, background: "var(--text)", color: "var(--bg)",
          borderRadius: CONTROL_R, fontSize: 11, lineHeight: 1.4, zIndex: 20, fontWeight: 400,
          boxShadow: SHADOW.schwebend,
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
    <div style={{ padding: "12px 0", color: "var(--text3)", fontSize: 13 }}>{t("dash.noStats")}</div>
  );

  // A–D fest, nicht aus answer_counts abgeleitet: eine Karte hat genau vier
  // Seiten (scans.answer ist ein Zeichen), und ungewaehlte sollen als 0 stehen.
  return (
    <div style={{ borderTop: "1px solid var(--border3)", paddingTop: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>
        {t("dash.stats", { times: stats.times_used, answers: stats.total_answers })}
      </div>
      {/* `StatCard` aus dem Kern statt eigener Kacheln — dieselbe Zahl soll in
          jeder Auswertung gleich aussehen. */}
      <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
        <StatCard
          value={`${stats.pct_correct}%`}
          color={stats.pct_correct >= 80 ? C.success : stats.pct_correct >= 50 ? C.warning : C.danger}
          label={<>{t("dash.correct")}<InfoTip text={t("dash.ciTip")} /></>}
          sub={stats.ci_low != null ? `${stats.ci_low}–${stats.ci_high}%` : undefined}
        />
        {stats.item_sd != null && <StatCard value={stats.item_sd.toFixed(2)} label={t("dash.sd")} />}
        {["A", "B", "C", "D"].map((k) => (
          <StatCard key={k} value={stats.answer_counts[k] || 0} label={k} />
        ))}
      </div>
    </div>
  );
}
