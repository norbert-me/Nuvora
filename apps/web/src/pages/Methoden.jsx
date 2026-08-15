// Modul Einstiege — Sammlung von Ideen fuer den Unterrichtseinstieg.
// Je Einstieg: Idee (Text), Ablauf mit Material, Materialliste, ca. Dauer.
// Wiederverwendbar; im Kalender einer Stunde zuweisbar.
import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { askConfirm } from "../core/dialog.jsx";
import { undoDelete } from "../core/undo.jsx";
import { alsJson, hol, sende } from "../core/melden.js";
import { useAblegeZiel } from "../core/ziehsortieren.js";
import { AddButton, badge, cardStyle, CONTROL_H, CONTROL_R, dateiWaehlen, Icon, ICONS, iconBtn, btnPrimary, btnSecondary, menuRow, pageTitle, sectionLabel, toolbarBtn, toolbarBtnPrimary, toolbarInput, COLORS as C, Modal, inputStyle, Popover, LoadError} from "../components/Icons.jsx";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import { DialogFuss, useEntwurf } from "../components/Speichern.jsx";
import SpeicherBalken from "../components/SpeicherBalken.jsx";
import { themenIndex, useThemen } from "../core/topics.js";
import { useAktiv } from "../core/modules.js";
import PublishModal from "../components/PublishModal.jsx";
import MaterialPanel from "../components/MaterialPanel.jsx";
import { useLanguage } from "../i18n/index.jsx";

const API = "/api/methoden";

export default function Methoden({ embedded } = {}) {
  const { t } = useLanguage();
  const [items, setItems] = useState([]);
  const [folders, setFolders] = useState([]);
  const [current, setCurrent] = useState(null); // aktueller Ordner (id) oder null = Wurzel
  const [edit, setEdit] = useState(null); // { id?, title, ... } | null
  const [publishing, setPublishing] = useState(null);
  const [viewing, setViewing] = useState(null); // Einstieg im Detail-Popup
  const [error, setError] = useState("");
  // Kern-Themen aus core/topics.js — dieselbe Zeile stand auf sechs Seiten.
  const topics = useThemen();
  const [addOpen, setAddOpen] = useState(false);
  const [newFolder, setNewFolder] = useState(false); // Ordner-Anlege-Eingabe offen?
  const [folderName, setFolderName] = useState("");
  const [renamingFolder, setRenamingFolder] = useState(null); // Ordner-id im Inline-Umbenennen
  const [renameVal, setRenameVal] = useState("");
  const [drag, setDrag] = useState(null);       // { kind: "folder"|"method", id }

  // Ein toter Endpunkt sah aus wie eine leere Sammlung („Noch keine Einstiege")
  // — genau das Bild, das man für „nichts angelegt" hält, während in Wahrheit
  // alles noch da ist und nur die Anfrage scheitert.
  const [ladefehler, setLadefehler] = useState(false);
  const load = () => fetch(`${API}/list`)
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((d) => { setItems(Array.isArray(d) ? d : []); setLadefehler(false); })
    .catch(() => setLadefehler(true));
  const loadFolders = () => hol(`${API}/folders`).then((d) => setFolders(Array.isArray(d) ? d : []));
  useEffect(() => { load(); loadFolders(); }, []);

  // Deep-Link ?open=<id> (z. B. aus dem Kalender): den Einstieg in der ANSICHT
  // (Detail) öffnen — nicht direkt im Bearbeiten. Von dort geht Bearbeiten weiter.
  const [params, setParams] = useSearchParams();
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (opened) return;
    const id = Number(params.get("open"));
    if (!id || !items.length) return;
    const m = items.find((x) => x.id === id);
    if (m) { setCurrent(m.folder_id ?? null); setViewing(m); }
    setOpened(true);
    params.delete("open"); setParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // ── Ein Entwurf für Umbenennen und Umsortieren ──
  // Beides ließ sich bisher mit einem Zug bzw. einem Klick ins Nichts
  // festschreiben. Jetzt sammelt der Entwurf, wohin ein Ordner/Einstieg soll
  // und wie er heißt; erst „Speichern" schreibt. Flache Schlüssel
  // (`f:<id>` Elternordner, `m:<id>` Ordner des Einstiegs, `nf:<id>` Name),
  // damit der Vergleich mit dem Serverstand ohne Tiefenvergleich auskommt.
  const basis = useMemo(() => {
    const o = {};
    folders.forEach((f) => { o[`f:${f.id}`] = f.parent_id ?? null; o[`nf:${f.id}`] = f.name; });
    items.forEach((m) => { o[`m:${m.id}`] = m.folder_id ?? null; });
    return o;
  }, [folders, items]);
  const folderById = (id) => folders.find((f) => f.id === id) || null;
  const frisch = useRef(false);
  const entwurf = useEntwurf(basis, async (wert) => {
    for (const f of folders) {
      const p = wert[`f:${f.id}`] ?? null, n = (wert[`nf:${f.id}`] || "").trim() || f.name;
      if (p === (f.parent_id ?? null) && n === f.name) continue;
      if (!(await sende(`${API}/folders/${f.id}`, alsJson("PUT", { name: n, parent_id: p }), t("common.save")))) return false;
    }
    for (const m of items) {
      const fid = wert[`m:${m.id}`] ?? null;
      if (fid === (m.folder_id ?? null)) continue;
      if (!(await sende(`${API}/${m.id}`, alsJson("PUT", { title: m.title, description: m.description || "", ablauf: m.ablauf || "", material: m.material || "", dauer: m.dauer ?? null, topic_id: m.topic_id ?? null, folder_id: fid }), t("common.move")))) return false;
    }
    frisch.current = true;
    loadFolders(); load();
    return true;
  });
  // Nach dem Speichern (und nach jedem frischen Laden) gilt der Serverstand.
  useEffect(() => { if (frisch.current) { frisch.current = false; entwurf.verwerfen(); } });
  // Kennt der Entwurf den Eintrag noch nicht (gerade angelegt), gilt der
  // Serverstand — sonst läge ein neuer Einstieg plötzlich in der Wurzel.
  const ausEntwurf = (k, fallback) => (k in entwurf.wert ? entwurf.wert[k] : fallback);
  const elternVon = (id) => ausEntwurf(`f:${id}`, folderById(id)?.parent_id ?? null);
  const ordnerVon = (m) => ausEntwurf(`m:${m.id}`, m.folder_id ?? null);
  const nameVon = (f) => ausEntwurf(`nf:${f.id}`, f.name);

  // Alle Wege lesen den ENTWURF (elternVon/ordnerVon), nicht den Serverstand —
  // sonst springt ein gezogener Ordner beim Loslassen an seinen alten Platz
  // zurück, obwohl der Zug noch offen ist.
  const childFolders = (pid) => folders.filter((f) => elternVon(f.id) === pid).sort((a, b) => nameVon(a).localeCompare(nameVon(b), "de", { numeric: true }));
  const pathTo = (id) => { const out = []; let cur = folderById(id); let guard = 0; while (cur && guard++ < 50) { out.unshift(cur); const p = elternVon(cur.id); cur = p != null ? folderById(p) : null; } return out; };
  // Verhindert Zyklen: ein Ordner darf nicht in einen seiner Nachfahren wandern.
  const isDescendant = (nodeId, maybeAncestorId) => { let cur = folderById(nodeId); let guard = 0; while (cur && guard++ < 50) { const p = elternVon(cur.id); if (p === maybeAncestorId) return true; cur = p != null ? folderById(p) : null; } return false; };

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
    const res = await fetch(m.id ? `${API}/${m.id}` : `${API}/`, alsJson(m.id ? "PUT" : "POST", body)).catch(() => null);
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
    // Bei Ablehnung bleibt die Eingabe offen stehen — sonst schloss sich das
    // Feld, der Ordner fehlte, und es sah nach einem Klickfehler aus.
    if (!(await sende(`${API}/folders`, alsJson("POST", { name, parent_id: current }), t("methoden.newFolder")))) return;
    setFolderName(""); setNewFolder(false); loadFolders();
  };
  // Inline-Umbenennen (kein Popup): die Ordnerkarte wird zum Eingabefeld. Der
  // neue Name geht in den Entwurf — geschrieben wird er mit „Speichern".
  const startRename = (f) => { setRenamingFolder(f.id); setRenameVal(nameVon(f)); };
  const commitRename = (f) => {
    const name = renameVal.trim();
    setRenamingFolder(null);
    if (!name || name === nameVon(f)) return;
    entwurf.setz({ [`nf:${f.id}`]: name });
  };
  const deleteFolder = async (f) => {
    if (!(await askConfirm(t("methoden.folderDeleteConfirm", { name: f.name })))) return;
    await sende(`${API}/folders/${f.id}`, { method: "DELETE" }, t("common.delete"));
    loadFolders(); load();
  };
  // Verschieben ist Umsortieren, also ein Entwurf: der Zug landet erst im Plan,
  // gespeichert wird er mit der Leiste unten.
  const moveFolder = (id, parentId) => entwurf.setz({ [`f:${id}`]: parentId });
  const moveMethod = (id, folderId) => entwurf.setz({ [`m:${id}`]: folderId });

  // Drag & Drop: Ordner oder Einstieg auf einen Ziel-Ordner (oder die Wurzel) ziehen.
  const canDrop = (targetId) => {
    if (!drag) return false;
    if (drag.kind === "folder") return drag.id !== targetId && elternVon(drag.id) !== targetId && !isDescendant(targetId, drag.id) && targetId !== drag.id;
    const m = items.find((x) => x.id === drag.id);
    return !!m && ordnerVon(m) !== targetId; // Methode: nur wenn woanders
  };
  // Ziel-Hervorhebung und die drei Handler kommen aus core/ziehsortieren.js —
  // Karten.jsx hatte dieselbe Gruppe. Was erlaubt ist und was beim Ablegen
  // geschieht, bleibt hier: das ist je Modul etwas anderes.
  const ablage = useAblegeZiel({
    erlaubt: canDrop,
    ablegen: (targetId) => {
      if (drag.kind === "folder") moveFolder(drag.id, targetId); else moveMethod(drag.id, targetId);
      setDrag(null);
    },
  });
  const endDrag = () => { setDrag(null); ablage.zuruecksetzen(); };

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
      const r = await fetch(`${API}/import`, alsJson("POST", data));
      if (r.ok) load(); else setError(t("common.notWork"));
    } catch { setError(t("methoden.importError")); }
  };

  const subfolders = childFolders(current);
  const visible = items.filter((m) => ordnerVon(m) === current);
  const crumbs = current != null ? pathTo(current) : [];

  return (
    <div>
      {!embedded && <h1 style={pageTitle}>{t("methoden.title")}</h1>}
      {/* Eine Leiste statt dreier freistehender Knoepfe: der haeufige Handgriff
          (Neu) steht links, Export/Import/Vorlage liegen im Mehr-Menue. */}
      <Werkzeugleiste style={{ marginBottom: 8 }} mehr={[
        { key: "export", label: t("common.export"), icon: ICONS.export, onClick: doExport },
        { key: "import", label: t("methoden.importFile"), icon: ICONS.import, onClick: () => dateiWaehlen(doImport) },
        { key: "vorlage", label: t("methoden.jsonTemplate"), icon: ICONS.download, onClick: () => { const a = document.createElement("a"); a.href = "/beispiel-einstiege.json"; a.download = "beispiel-einstiege.json"; a.click(); } },
      ]}>
        <div style={{ position: "relative", display: "inline-flex" }}>
          <AddButton onClick={() => setAddOpen((v) => !v)} title={t("methoden.new")} />
          {addOpen && (
            <>
              <div onClick={() => setAddOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 20 }} />
              <Popover style={{ zIndex: 21, top: CONTROL_H + 2, padding: 4, minWidth: 150 }}>
                <button onClick={() => { setAddOpen(false); setEdit({}); }} style={menuRow}><Icon d={ICONS.plus} size={14} /> {t("methoden.new")}</button>
                <button onClick={() => { setAddOpen(false); setNewFolder(true); setFolderName(""); }} style={menuRow}><Icon d={ICONS.folder} size={14} /> {t("methoden.newFolder")}</button>
              </Popover>
            </>
          )}
        </div>
      </Werkzeugleiste>

      {/* Breadcrumb: Wurzel + Pfad. Jeder Teil ist Drop-Ziel zum Hochschieben. */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", marginBottom: 12, fontSize: 13 }}>
        <button onClick={() => setCurrent(null)} {...ablage.props(null)}
          style={{ ...crumbBtn, ...(ablage.ziel === null ? crumbDrop : {}), fontWeight: current == null ? 700 : 500 }}>{t("methoden.root")}</button>
        {crumbs.map((f) => (
          <span key={f.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ color: "var(--text3)" }}>/</span>
            <button onClick={() => setCurrent(f.id)} {...ablage.props(f.id)}
              style={{ ...crumbBtn, ...(ablage.ziel === f.id ? crumbDrop : {}), fontWeight: current === f.id ? 700 : 500 }}>{nameVon(f)}</button>
          </span>
        ))}
      </div>

      {error && <p style={{ color: C.danger, fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {newFolder && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12, maxWidth: 360 }}>
          <input value={folderName} autoFocus placeholder={t("methoden.folderName")} onChange={(e) => setFolderName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createFolder(); if (e.key === "Escape") setNewFolder(false); }}
            style={{ ...toolbarInput, flex: 1 }} />
          <button onClick={createFolder} style={toolbarBtnPrimary}>{t("common.save")}</button>
          <button onClick={() => setNewFolder(false)} style={toolbarBtn}>{t("common.abort")}</button>
        </div>
      )}

      {subfolders.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, marginBottom: 16 }}>
          {subfolders.map((f) => {
            const count = items.filter((m) => ordnerVon(m) === f.id).length + childFolders(f.id).length;
            const over = ablage.aktiv(f.id);
            const renaming = renamingFolder === f.id;
            return (
              <div key={f.id} draggable={!renaming} onDragStart={() => setDrag({ kind: "folder", id: f.id })} onDragEnd={endDrag} {...ablage.props(f.id)}
                onClick={renaming ? undefined : () => setCurrent(f.id)}
                style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 8, padding: 12, border: `1px solid ${over ? "var(--accent)" : "var(--border)"}`, background: over ? "var(--accent-bg, rgba(10,132,255,0.10))" : "var(--card)", cursor: renaming ? "default" : "pointer" }}>
                {renaming ? (
                  <>
                    <input value={renameVal} autoFocus onClick={(e) => e.stopPropagation()} onChange={(e) => setRenameVal(e.target.value)}
                      onKeyDown={(ev) => { if (ev.key === "Enter") commitRename(f); if (ev.key === "Escape") setRenamingFolder(null); }}
                      onBlur={() => commitRename(f)}
                      style={{ ...toolbarInput, flex: 1, minWidth: 0 }} />
                    <button onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); deleteFolder(f); }} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={15} color={C.danger} /></button>
                  </>
                ) : (
                  <>
                    <span style={{ color: "var(--text3)", cursor: "grab", display: "inline-flex" }} title={t("methoden.dragHint")}><Icon d={ICONS.grip} size={14} /></span>
                    <Icon d={ICONS.folder} size={18} color="var(--accent)" />
                    <span style={{ fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nameVon(f)}</span>
                    <span style={{ fontSize: 12, color: "var(--text3)" }}>{count}</span>
                    <button onClick={(e) => { e.stopPropagation(); startRename(f); }} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("common.rename")} aria-label={t("common.rename")}><Icon d={ICONS.edit} size={13} /></button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {ladefehler ? (
        <LoadError message={t("methoden.loadError")} onRetry={() => { load(); loadFolders(); }} />
      ) : visible.length === 0 && subfolders.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--text3)" }}>{t("methoden.empty")}</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
          {visible.map((m) => (
            <div key={m.id} draggable onDragStart={() => setDrag({ kind: "method", id: m.id })} onDragEnd={endDrag}
              onClick={() => setViewing(m)}
              style={{ ...cardStyle, display: "flex", alignItems: "flex-start", gap: 8, padding: 12, minHeight: 58, cursor: "pointer", opacity: drag && drag.kind === "method" && drag.id === m.id ? 0.5 : 1 }}>
              <span style={{ color: "var(--text3)", cursor: "grab", display: "inline-flex" }} title={t("methoden.dragHint")}><Icon d={ICONS.grip} size={14} /></span>
              <span style={{ fontWeight: 600, flex: 1, minWidth: 0, lineHeight: 1.35, wordBreak: "break-word" }}>{m.title}</span>
            </div>
          ))}
        </div>
      )}

      {viewing && <MethodView m={viewing} t={t}
        onEdit={() => { setEdit(viewing); setViewing(null); }}
        onPublish={() => { setPublishing(viewing); setViewing(null); }}
        onClose={() => setViewing(null)} />}
      {edit && <MethodModal m={edit} topics={topics} onSave={save} onDelete={(id) => { remove(id); setEdit(null); }} onClose={() => setEdit(null)} t={t} />}
      <SpeicherBalken entwurf={entwurf} />
      {publishing && <PublishModal name={publishing.title} onClose={() => setPublishing(null)}
        onPublish={(description) => fetch(`/api/marketplace/publish/method`, alsJson("POST", { method_id: publishing.id, description })).catch(() => null)} />}
    </div>
  );
}

// Aus den zentralen Stilen abgeleitet (Icons.jsx ist die einzige Design-Quelle):
// crumbBtn ist ein btnSecondary ohne sichtbaren Rahmen — dieselbe Form (CONTROL_R)
// wie alles andere Bedienbare. Das Menue der Brotkrumen ist `menuRow`.
const crumbBtn = { ...btnSecondary, background: "none", border: "1px solid transparent", borderRadius: CONTROL_R, padding: "4px 8px", fontSize: 13 };
const crumbDrop = { borderColor: "var(--accent)", background: "var(--accent-bg, rgba(10,132,255,0.10))" };

// Detail-Ansicht (Klick auf einen Einstieg): zeigt die Erklärung, mit Buttons
// zum Bearbeiten und Teilen.
function MethodView({ m, t, onEdit, onPublish, onClose }) {
  // Rückrichtung: an welche Stunden (Kalendereinträge) ist dieser Einstieg
  // gehängt? Regel 3: Zusatz-Brücke — ohne das Modul Kalender wird gar nicht
  // erst gefragt.
  const kalenderAktiv = useAktiv()("kalender");
  const [linked, setLinked] = useState([]);
  useEffect(() => {
    if (!m.id || !kalenderAktiv) { setLinked([]); return; }
    hol(`${API}/${m.id}/kalender`).then((d) => setLinked(Array.isArray(d) ? d : []));
  }, [m.id, kalenderAktiv]);
  const sec = (label, val) => val ? (
    <div style={{ marginTop: 12 }}>
      <div style={{ ...sectionLabel, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{val}</div>
    </div>
  ) : null;
  return (
    <Modal onClose={onClose} width={520} style={{ maxHeight: "86vh", overflowY: "auto" }} label={m.title}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, flex: 1 }}>{m.title}</h3>
          {m.dauer != null && <span style={badge(C.info)}>{t("methoden.dauerBadge", { n: m.dauer })}</span>}
          <button onClick={onClose} className="icon-btn" style={{ ...iconBtn, padding: 6 }} title={t("common.close")} aria-label={t("common.close")}><Icon d={ICONS.close} size={18} /></button>
        </div>
        {sec(t("methoden.idee"), m.description)}
        {sec(t("methoden.ablauf"), m.ablauf)}
        {sec(t("methoden.material"), m.material)}
        {m.id && <div style={{ marginTop: 16 }}><MaterialPanel methodId={m.id} /></div>}
        {linked.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ ...sectionLabel, marginBottom: 4 }}>{t("methoden.linkedLessons")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {linked.map((e) => (
                <Link key={e.id} to={`/kalender?view=day&date=${e.date.slice(0, 10)}`} onClick={onClose}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: CONTROL_R, border: "1px solid var(--border2)", background: "var(--bg)", textDecoration: "none", color: "var(--accent)", fontSize: 14 }}>
                  <Icon d={ICONS.calendar || ICONS.open} size={15} color="var(--accent)" />
                  <span style={{ fontWeight: 600 }}>{new Date(e.date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</span>
                  {e.period ? <span style={{ color: "var(--text3)" }}>· {e.period}. {t("kalender.period")}</span> : null}
                  {e.label ? <span style={{ color: "var(--text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>· {e.label}</span> : null}
                </Link>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center" }}>
          <button onClick={onEdit} className="icon-btn" style={{ ...iconBtn, padding: 6 }} title={t("common.edit")} aria-label={t("common.edit")}><Icon d={ICONS.edit} size={18} /></button>
          <button onClick={onPublish} className="icon-btn" style={{ ...iconBtn, padding: 6 }} title={t("methoden.publish")} aria-label={t("methoden.publish")}><Icon d={ICONS.share} size={18} color="var(--accent)" /></button>
        </div>
    </Modal>
  );
}

function MethodModal({ m, topics = [], onSave, onDelete, onClose, t }) {
  const [title, setTitle] = useState(m.title || "");
  const [dauer, setDauer] = useState(m.dauer ?? "");
  const [description, setDescription] = useState(m.description || "");
  const [ablauf, setAblauf] = useState(m.ablauf || "");
  const [material, setMaterial] = useState(m.material || "");
  const [topicId, setTopicId] = useState(m.topic_id ?? "");
  const [titleErr, setTitleErr] = useState(false);
  // Beschriftung und Reihenfolge aus core/topics.js — dieselbe Auswahl heisst
  // und sortiert sich in jeder Ansicht gleich (die Regel stand hier vorher als
  // eigene Kopie, in vier Seiten leicht verschieden).
  const themen = themenIndex(topics);
  const topicLabel = (tp) => themen.label(tp);
  const topicsSorted = themen.geordnet;
  const fld = { ...inputStyle, width: "100%" };
  const lbl = { fontSize: 13, color: "var(--text2)", margin: "12px 0 4px" };
  const submit = () => {
    // Fehlender Titel wird direkt in der Maske gemeldet, nicht als Seitenfehler
    // hinter dem Modal.
    if (!title.trim()) { setTitleErr(true); return; }
    onSave({ id: m.id, title, description, ablauf, material, dauer, topic_id: topicId === "" ? null : Number(topicId), folder_id: m.folder_id ?? null });
  };
  // Nur schließen, wenn Klick WIRKLICH auf dem Overlay begann und endete. Sonst
  // schloss eine Textauswahl, die im Feld startet und außerhalb endet, das Modal
  // (Datenverlust). e.currentTarget ist das Overlay.
  return (
    <Modal onClose={onClose} width={480} style={{ maxHeight: "90vh", overflowY: "auto" }} label={m.id ? t("methoden.edit") : t("methoden.new")}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{m.id ? t("methoden.edit") : t("methoden.new")}</h3>
        <div style={{ display: "flex", gap: 12 }}>
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
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} placeholder={t("methoden.ideePlaceholder")} style={{ ...fld, resize: "vertical" }} />
        <div style={lbl}>{t("methoden.ablauf")}</div>
        <textarea value={ablauf} onChange={(e) => setAblauf(e.target.value)} rows={8} placeholder={t("methoden.ablaufPlaceholder")} style={{ ...fld, resize: "vertical" }} />
        <div style={lbl}>{t("methoden.material")}</div>
        <textarea value={material} onChange={(e) => setMaterial(e.target.value)} rows={4} placeholder={t("methoden.materialPlaceholder")} style={{ ...fld, resize: "vertical" }} />
        {topics.length > 0 && (
          <>
            <div style={lbl}>{t("methoden.topic")}</div>
            <select value={topicId} onChange={(e) => setTopicId(e.target.value)} style={fld}>
              <option value="">{t("methoden.topicNone")}</option>
              {topicsSorted.map((tp) => <option key={tp.id} value={tp.id}>{topicLabel(tp)}</option>)}
            </select>
          </>
        )}
        {/* Datei-Upload nur beim gespeicherten Einstieg (braucht die id). */}
        {m.id && <div style={{ marginTop: 16 }}><MaterialPanel methodId={m.id} /></div>}
        <DialogFuss onSpeichern={submit} onAbbrechen={onClose}>
          {m.id && <button onClick={() => onDelete(m.id)} className="icon-btn" style={{ ...iconBtn, marginLeft: "auto", padding: 6 }} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={20} color={C.danger} /></button>}
        </DialogFuss>
    </Modal>
  );
}
