import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { askConfirm, askPrompt } from "../core/dialog.jsx";
import Latex from "../components/Latex.jsx";
import PublishModal from "../components/PublishModal.jsx";
import { AddButton, badge, btnPrimary, btnSecondary, btnSmall, cardStyle, chipStyle, COLORS as C, CONTROL_R, dateiWaehlen, DialogKopf, Icon, iconBtn, ICONS, inputStyle as inputBasis, menuRow, Modal, NiveauToggle, pageApp, pageTitle, panelStyle, Popover, quoteFarbe, sectionLabel, selectStyle, SHADOW, StatCard, Toggle, toolbarBtn, toolbarBtnPrimary, toolbarInput } from "../components/Icons.jsx";
import { dublettenZahlen, findeDubletten, istInSammlung } from "../core/dubletten.js";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import Speicherleiste, { useEntwurf } from "../components/Speichern.jsx";
import ImportMenu from "../components/ImportMenu.jsx";
import VerknuepfungDialog, { flachBaum } from "../components/Verknuepfung.jsx";
import { useLanguage } from "../i18n/index.jsx";
import TopicPicker from "../components/TopicPicker.jsx";
import ZoomImage from "../components/ZoomImage.jsx";
import { themenIndex, useThemen } from "../core/topics.js";
import { useAktiv } from "../core/modules.js";
import { useZiehVorschau } from "../core/ziehsortieren.js";
import { alsJson, hol } from "../core/melden.js";
import { formelEinfuegen, LATEX_TASTEN_LANG } from "../core/latextabelle.js";

const API = "/api";

// Bild zu einer Frage hochladen. Stand zweimal in dieser Datei (verwaiste
// Fragen und Frageeditor) — dieselben vierzehn Zeilen. `dateiWaehlen` aus
// Icons.jsx macht den Dialog, hier bleibt nur das Hochladen.
const bildHochladen = (setter) => dateiWaehlen(async (file) => {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API}/questions/upload-image`, { method: "POST", body: form });
  if (res.ok) setter((await res.json()).url);
}, "image/*,.svg");


export default function Dashboard() {
  const { t } = useLanguage();
  const [folders, setFolders] = useState([]);
  const [rootSets, setRootSets] = useState([]); // Fragensets ohne Ordner (Top-Level)
  const [allQuestions, setAllQuestions] = useState([]);
  const [path, setPath] = useState([]);
  const [currentFolder, setCurrentFolder] = useState(null);
  const [editingSet, setEditingSet] = useState(null);
  // Zielordner eines Imports — gewaehlt, nicht geraten (components/Verknuepfung.jsx).
  const [importZiel, setImportZiel] = useState(null); // { data, text, zeilen } oder { xlsx: {...}, zeilen }
  // Ein „+" mit Untermenü (Ordner/Set) statt zwei getrennter Plus-Knöpfe.
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addMode, setAddMode] = useState(null); // null | "folder" | "set"
  const [addName, setAddName] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [movingFolder, setMovingFolder] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState(null);
  // Umbenennen ist eine Aenderung wie jede andere: sie lief vorher beim
  // Verlassen des Feldes von selbst zum Server. Jetzt haelt der Entwurf sie,
  // bis jemand speichert.
  const [renameBasis, setRenameBasis] = useState({ name: "" });
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
    hol(`${API}/questions/verwaist`, null).then(setVerwaist);

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

  // „Doppelte finden": dieselbe Liste, nur gruppiert und auf das reduziert,
  // was mehrfach vorkommt. Gerechnet wird im Browser — die Fragen liegen hier
  // vollstaendig (Text, Antworten), ein eigener Endpunkt waere derselbe
  // Datensatz ein zweites Mal.
  const [vDup, setVDup] = useState(false);

  const vTrifft = (q) => !vSuche.trim() || (q.text || "").toLowerCase().includes(vSuche.trim().toLowerCase());
  const vBasis = (verwaist?.fragen || []).filter(vTrifft);
  // Zwillinge, die in einer Sammlung stecken: nur Anzeige, nie auswaehlbar.
  // Sie beantworten die eigentliche Frage — „gibt es die schon irgendwo?".
  const vPartner = (verwaist?.partner || []).filter(vTrifft);
  const vGruppen = vDup ? findeDubletten([...vBasis, ...vPartner]) : [];
  const vZahlen = dublettenZahlen(vGruppen);
  // Was die Liste gerade zeigt — flach, inklusive Partner.
  const vAngezeigt = vDup ? vGruppen.flatMap((g) => g.fragen) : vBasis;

  // Sicherheitsnetz: auswaehlbar ist nur, was wirklich in `fragen` steht — also
  // eine Frage OHNE Quiz. Partner werden dort nie gefunden und fallen damit aus
  // Auswahl, Zuweisung und Loeschen heraus, ohne dass es eine zweite Regel
  // braucht. Geloescht wird zusaetzlich nur ohne Ergebnisse; die Pruefung sitzt
  // an der Stelle des Loeschens, das ist die einzige, die haelt.
  const vFrage = (id) => (verwaist?.fragen || []).find((q) => q.id === id);
  const vWaehlbar = (q) => !!vFrage(q.id) && !istInSammlung(q);
  const vLoeschbar = (id) => { const q = vFrage(id); return !!q && !q.hat_ergebnisse; };

  // „Alle N auswaehlen" und das Loeschen arbeiten mit dieser Teilmenge weiter
  // unveraendert; es gibt keinen zweiten Loeschweg.
  const vGefiltert = vAngezeigt.filter(vWaehlbar);

  const vDupUmschalten = () => {
    const an = !vDup;
    setVDup(an);
    if (!an) return;
    // Vorauswahl: in jeder Gruppe bleibt eine stehen (Sammlung > Thema > aelteste),
    // der Rest ist angehakt. Aendern darf das der Mensch — es ist ein Vorschlag.
    const vor = new Set();
    for (const g of findeDubletten([...vBasis, ...vPartner]))
      for (const q of g.fragen) if (q.id !== g.behalten && vWaehlbar(q) && vLoeschbar(q.id)) vor.add(q.id);
    setVAuswahl(vor);
  };

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

  // Eine Zeile der Liste — flach wie gruppiert dieselbe. `behalten` markiert in
  // einer Dubletten-Gruppe die Frage, die stehen bleiben soll. Eine Frage aus
  // einer Sammlung (Partner) hat kein Kaestchen: sie steht hier nur als Beweis,
  // dass es die Waise schon gibt, und darf nicht mitgeloescht werden.
  const vZeile = (q, behalten) => {
    const partner = istInSammlung(q);
    return (
      <label key={q.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--border)", cursor: "pointer", lineHeight: 1.5 }}>
        {partner
          ? <span aria-hidden style={{ width: 13, flexShrink: 0 }} />
          : <input type="checkbox" checked={vAuswahl.has(q.id)} onChange={() => vUmschalten(q.id)} style={{ marginTop: 3 }} />}
        <span onClick={(e) => { e.preventDefault(); vOeffnen(q.id); }}
              title={t("dash.clickEdit")}
              style={{ flex: 1, color: partner ? "var(--text2)" : "var(--text)", cursor: "pointer" }}>
          <Latex>{q.text}</Latex>
          {behalten && <span style={{ ...chipStyle, marginLeft: 8 }}>{t("cv.dup.keep")}</span>}
          {partner && (
            <span style={{ color: "var(--text3)" }}>
              {" · "}{t("cv.dup.inSet", { s: q.sammlungen.map((s) => s.name).join(", ") })}
            </span>
          )}
          {/* Mit Ergebnissen wird nichts geloescht: daran haengen die
              Auswertungen gehaltener Sitzungen. */}
          {q.hat_ergebnisse && <span style={{ color: "var(--text3)" }}> · {t("dash.orphansKept")}</span>}
        </span>
      </label>
    );
  };

  // Beim Oeffnen wird mitgegeben, in welchen Sammlungen die Frage steckt — das
  // weiss die Zeile bereits (Partner tragen es), ein zweiter Aufruf waere
  // dieselbe Auskunft ein zweites Mal.
  const vOeffnen = async (id) => {
    const r = await fetch(`${API}/questions/${id}`);
    if (!r.ok) return;
    const sammlungen = (verwaist?.partner || []).find((p) => p.id === id)?.sammlungen || [];
    setVEdit({ ...(await r.json()), sammlungen });
  };

  const vSpeichern = async () => {
    if (!vEdit?.text?.trim()) return;
    // `sammlungen` ist reine Anzeige und gehoert nicht in die Frage zurueck.
    const { sammlungen, ...frage } = vEdit;
    const r = await fetch(`${API}/questions/${vEdit.id}`, alsJson("PUT", frage));
    if (!r.ok) return;
    setVEdit(null);
    await ladeVerwaiste();
  };


  const vZuweisen = async () => {
    if (!vZiel || vAuswahl.size === 0) return;
    setVMeldung("");
    const ids = [...vAuswahl];
    const r = await fetch(`${API}/question-sets/${vZiel}/questions`, alsJson("POST", { question_ids: ids }));
    if (!r.ok) { setVMeldung((await r.json().catch(() => ({}))).detail || t("common.error")); return; }
    setVAuswahl(new Set());
    setVMeldung(t("dash.orphansAssigned", { n: ids.length }));
    await ladeVerwaiste();
    load();
  };

  // Loeschen laeuft Frage fuer Frage (jede ist ein eigener weicher Loeschgang).
  // Das dauert sichtbar — also wird es auch sichtbar: { fertig, gesamt } sperrt
  // den Knopf und beschriftet ihn mit dem Fortschritt. `vLaeuft` ist der Riegel
  // gegen den Doppelklick: der Zustand kommt erst nach dem Neuzeichnen an, ein
  // zweiter Klick waere vorher schon durch.
  const [vLoescht, setVLoescht] = useState(null);
  const vLaeuft = useRef(false);

  const vAuswahlLoeschen = async () => {
    if (vLaeuft.current) return;
    const ids = [...vAuswahl].filter(vLoeschbar);
    if (!ids.length) return;
    if (!await askConfirm(t("dash.orphansCleanAsk", { n: ids.length }), { ok: t("common.delete"), danger: true })) return;
    if (vLaeuft.current) return; // der Dialog stand offen — in der Zeit kann ein zweiter Lauf gestartet sein
    vLaeuft.current = true;
    setVLoescht({ fertig: 0, gesamt: ids.length });
    try {
      for (let i = 0; i < ids.length; i++) {
        await fetch(`${API}/questions/${ids[i]}`, { method: "DELETE" });
        setVLoescht({ fertig: i + 1, gesamt: ids.length });
      }
      setVAuswahl(new Set());
      await ladeVerwaiste();
      load();
    } finally {
      vLaeuft.current = false;
      setVLoescht(null);
    }
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
      hol(`${API}/root-question-sets`).then((d) => setRootSets(Array.isArray(d) ? d : []));
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

  // Eine Sammlung in ihrem Ordner oeffnen. Zwei Wege fuehren hierher: der
  // Deep-Link ?set=<id> (z. B. aus dem Kalender) und der Sprung aus einer
  // geoeffneten Frage („steckt in: …"). Beide dieselbe Bewegung, also eine
  // Funktion — nicht zweimal durch denselben Baum laufen.
  const sammlungOeffnen = (sid) => {
    const top = rootSets.find((s) => s.id === sid);
    if (top) { setPath([]); setCurrentFolder(null); setEditingSet(top); return true; }
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
    if (!r) return false;
    setPath(r.trail); setCurrentFolder(r.folderId); setEditingSet(r.set);
    return true;
  };

  // Deep-Link ?set=<id>: einmalig, sobald die Ordner/Sets geladen sind.
  const [params, setParams] = useSearchParams();
  const [openedSet, setOpenedSet] = useState(false);
  useEffect(() => {
    if (openedSet) return;
    const sid = Number(params.get("set"));
    if (!sid) return;
    const clear = () => { setOpenedSet(true); params.delete("set"); setParams(params, { replace: true }); };
    if (sammlungOeffnen(sid)) clear();
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
    await fetch(`${API}/folders`, alsJson("POST", { name, parent_id: currentFolder }));
    setNewFolderName(""); load();
  };

  const startRenameFolder = (id, oldName) => {
    setRenamingFolder(id);
    setRenameBasis({ name: oldName });
  };

  const umbenennen = useEntwurf(renameBasis, async (wert) => {
    const neu = wert.name.trim();
    const node = renamingFolder ? findNode(folders, renamingFolder) : null;
    if (!neu || !node) return false;
    const r = await fetch(`${API}/folders/${renamingFolder}`, alsJson("PUT", { name: neu, parent_id: node.parent_id })).catch(() => null);
    if (!r || !r.ok) return false;
    setRenameBasis({ name: neu });
    setRenamingFolder(null);
    load();
  });

  // Umbenennen abbrechen: erst den Entwurf zuruecksetzen, dann das Feld
  // schliessen — sonst bliebe die Warnung „nicht gespeichert" haengen.
  const renameAbbrechen = () => { umbenennen.verwerfen(); setRenamingFolder(null); };

  // Beim Aufklappen des Feldes die Arbeitskopie auf den Ordnernamen setzen:
  // `useEntwurf` uebernimmt einen neuen Stand nur, wenn nichts offen ist — und
  // gegenueber dem leeren Anfangswert sieht jeder Name wie eine offene
  // Aenderung aus. Ohne das stuende das Feld leer und sofort auf „nicht
  // gespeichert".
  useEffect(() => { if (renamingFolder) umbenennen.verwerfen(); }, [renamingFolder]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // `dateiWaehlen` (Icons.jsx) baut den Dateidialog — fuenf Seiten hatten ihn
  // von Hand zusammengesetzt.
  // Eine Importdatei haengt an einem Ordner. Statt sie stillschweigend in den
  // gerade offenen zu legen (oder einen zweiten gleichnamigen anzulegen), wird
  // gefragt — siehe components/Verknuepfung.jsx.
  const ordnerOptionen = () => flachBaum(folders);

  const importFolder = () => dateiWaehlen(async (file) => {
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.type !== "cardvote_folder" && data.type !== "cardvote_questionset") {
          finishImport(false, t("dash.impUnknown"));
          return;
        }
        const optionen = ordnerOptionen();
        const offen = optionen.find((o) => String(o.id) === String(currentFolder));
        setImportZiel({
          data, text, dateiname: file.name,
          zeilen: [{
            key: "folder", label: t("verkn.ordner"), optionen,
            // Vorbelegt: der offene Ordner, sonst der Name aus der Datei als
            // neuer Ordner — genau das, was vorher ungefragt passierte.
            vorschlag: offen ? offen.name : (data.name || file.name.replace(/\.json$/i, "")),
            hinweis: data.type === "cardvote_folder" ? t("dash.impFolderHint") : undefined,
          }],
        });
      } catch (err) { finishImport(false, err.message || t("dash.impReadError")); }
  }, ".json");

  /** Der Import selbst, nachdem der Zielordner feststeht. */
  const importAusfuehren = async ({ data, text }, werte) => {
    const ziel = werte.folder;
    setImportZiel(null);
    setImportStatus({ stage: "reading", label: data.name || "" });
    try {
      // "Neu anlegen" heisst bei einem Ordner-Import: den Ordner der Datei
      // unter dem gewaehlten Namen anlegen (im gerade offenen Ordner). Bei
      // einem einzelnen Set gibt es keinen Ordner in der Datei — dafuer wird
      // einer angelegt und das Set hineingelegt.
      let folderId = ziel.id;
      if (data.type === "cardvote_folder") {
        const count = (data.question_sets || []).length + (data.children || []).length;
        const rumpf = ziel.id ? text : JSON.stringify({ ...data, name: ziel.name });
        const params = new URLSearchParams();
        if (ziel.id) { params.set("folder_id", String(ziel.id)); params.set("in_folder", "true"); }
        else if (currentFolder) params.set("folder_id", String(currentFolder));
        await uploadWithProgress(`${API}/import/folder${params.toString() ? `?${params}` : ""}`, rumpf, { label: data.name || "" });
        await load();
        finishImport(true, t("dash.impFolderDone", { count }));
        return;
      }
      if (!folderId) {
        const r = await fetch(`${API}/folders`, alsJson("POST", { name: ziel.name, parent_id: currentFolder }));
        if (!r.ok) { finishImport(false, t("dash.impError")); return; }
        folderId = (await r.json()).id;
      }
      const n = (data.questions || []).length;
      await uploadWithProgress(`${API}/import/question-set`, JSON.stringify({ ...data, folder_id: folderId }), { label: data.name || "" });
      await load();
      finishImport(true, t("dash.impSetDone", { name: data.name || "?", count: n }));
    } catch (err) { finishImport(false, err.message || t("dash.impError")); }
  };

  const deleteFolder = async (id) => {
    if (!await askConfirm(t("dash.deleteFolderConfirm"))) return;
    await fetch(`${API}/folders/${id}`, { method: "DELETE" }); load();
  };

  const moveFolder = async (folderId, newParentId) => {
    const node = findNode(folders, folderId);
    if (!node) return;
    await fetch(`${API}/folders/${folderId}`, alsJson("PUT", { name: node.name, parent_id: newParentId }));
    setMovingFolder(null); load();
  };

  const createSet = async (name) => {
    const res = await fetch(`${API}/question-sets`, alsJson("POST", { name, folder_id: currentFolder, question_ids: [] }));
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
    dateiWaehlen((file) => {
      const optionen = ordnerOptionen();
      const offen = optionen.find((o) => String(o.id) === String(currentFolder));
      setImportZiel({
        xlsx: { file, setName },
        zeilen: [{ key: "folder", label: t("verkn.ordner"), optionen, vorschlag: offen ? offen.name : setName }],
      });
    }, ".xlsx");
  };

  /** Excel-Import, nachdem der Zielordner feststeht. */
  const importXlsxAusfuehren = async ({ file, setName }, werte) => {
    const ziel = werte.folder;
    setImportZiel(null);
    setImportStatus({ stage: "reading", label: file.name });
    try {
      let folderId = ziel.id;
      if (!folderId) {
        const r = await fetch(`${API}/folders`, alsJson("POST", { name: ziel.name, parent_id: currentFolder }));
        if (!r.ok) { finishImport(false, t("dash.impError")); return; }
        folderId = (await r.json()).id;
      }
      const form = new FormData();
      form.append("file", file);
      await uploadWithProgress(`${API}/import/questions-xlsx?name=${encodeURIComponent(setName)}&folder_id=${folderId}`, form, { json: false, label: file.name });
      await load();
      finishImport(true, t("dash.impSetDone", { name: setName, count: "…" }));
    } catch (err) { finishImport(false, err.message || t("dash.impError")); }
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
                <button onClick={vDupUmschalten} aria-pressed={vDup} title={t("cv.dup.hint")}
                  style={vDup ? toolbarBtnPrimary : toolbarBtn}>
                  <Icon d={ICONS.duplicate} size={15} color={vDup ? "var(--bg)" : "var(--text3)"} />
                  {t("cv.dup.find")}
                </button>
                {vDup && (
                  <span style={{ color: "var(--text3)" }}>
                    {t("cv.dup.count", { g: vZahlen.gruppen, n: vZahlen.fragen })}
                  </span>
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
                {/* Waehrend des Loeschens gesperrt UND beschriftet: bei 200
                    Fragen laeuft das eine Weile, und ohne Rueckmeldung klickt
                    man ein zweites Mal. */}
                <button onClick={vAuswahlLoeschen} disabled={vAuswahl.size === 0 || !!vLoescht}
                  style={{ ...toolbarBtn, color: C.danger, borderColor: C.danger,
                    opacity: (vAuswahl.size === 0 || vLoescht) ? 0.5 : 1,
                    cursor: vLoescht ? "progress" : "pointer" }}>
                  {vLoescht
                    ? t("cv.dup.deleting", { i: vLoescht.fertig, n: vLoescht.gesamt })
                    : t("dash.orphansDeleteSel", { n: vAuswahl.size })}
                </button>
                {verwaist.loeschbar > 0 && (
                  <button onClick={verwaisteAufraeumen} style={{ ...toolbarBtn, color: "var(--text3)" }}>
                    {t("dash.orphansClean", { n: verwaist.loeschbar })}
                  </button>
                )}
                {vMeldung && <span style={{ color: C.success }}>{vMeldung}</span>}
              </div>

              <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid var(--border)", borderRadius: CONTROL_R, background: "var(--card)" }}>
                {!vDup && vAngezeigt.map((q) => vZeile(q, false))}
                {vDup && vGruppen.map((g) => (
                  <div key={g.schluessel}>
                    {/* Kopf je Gruppe: wie viele, und WELCHE Art Dublette.
                        „gleiche Antworten" ist sicher, „andere Antworten" muss
                        ein Mensch ansehen — zwei Kennzeichnungen, damit niemand
                        die falsche loescht. */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                      padding: "8px 12px", background: "var(--bg3)", borderBottom: "1px solid var(--border)" }}>
                      <span style={sectionLabel}>{t("cv.dup.group", { n: g.fragen.length })}</span>
                      <span style={badge(g.gleicheAntworten ? C.success : C.warning)}>
                        {g.gleicheAntworten ? t("cv.dup.sameAnswers") : t("cv.dup.otherAnswers")}
                      </span>
                    </div>
                    {g.fragen.map((q) => vZeile(q, q.id === g.behalten))}
                  </div>
                ))}
                {vAngezeigt.length === 0 && (
                  <p style={{ padding: 10, margin: 0, color: "var(--text3)" }}>
                    {vDup ? t("cv.dup.none") : t("dash.noSearchHit")}
                  </p>
                )}
              </div>
            </>
          )}

          {/* Dieselbe Maske wie im Quiz — inklusive Thema. Eine Frage ohne Quiz
              ist sonst nirgends zu oeffnen. */}
          {vEdit && (
            <Modal onClose={() => setVEdit(null)} width={620} label={t("dash.editQ")}>
              <DialogKopf titel={t("dash.editQ")} onClose={() => setVEdit(null)} schliessenLabel={t("common.close")} />
              {/* Wo steckt die Frage? Ohne diese Zeile weiss man beim Bearbeiten
                  nicht, ob man gerade in ein Quiz eingreift — und kommt auch
                  nicht hin. Anklickbar: der Sprung oeffnet die Sammlung. */}
              <div style={{ marginBottom: 12, color: "var(--text2)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={sectionLabel}>{t("cv.dup.inSetLabel")}</span>
                {vEdit.sammlungen?.length
                  ? vEdit.sammlungen.map((s) => (
                      <button key={s.id} onClick={() => { setVEdit(null); sammlungOeffnen(s.id); }}
                        title={t("cv.dup.toSet")}
                        style={{ ...chipStyle, border: "none", cursor: "pointer", color: "var(--accent)" }}>
                        {s.name}
                      </button>
                    ))
                  : <span style={{ color: "var(--text3)" }}>{t("cv.dup.inNoSet")}</span>}
              </div>
              <QuestionForm q={vEdit} setQ={setVEdit} onUpload={bildHochladen} choiceKeys={["A", "B", "C", "D"]} />
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
                  value={umbenennen.wert.name}
                  onChange={(e) => umbenennen.setz({ name: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") umbenennen.speichern(); if (e.key === "Escape") renameAbbrechen(); }}
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
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0, marginLeft: 8 }} onClick={(e) => e.stopPropagation()}>
              {/* Speichern/Abbrechen stehen jetzt hier: das Feld gibt seinen
                  Inhalt nicht mehr beim Verlassen ab. */}
              <Speicherleiste entwurf={umbenennen} klein />
              {!umbenennen.geaendert && (
                <button onClick={renameAbbrechen} style={{ ...btnSecondary, ...btnSmall }}>{t("common.cancel")}</button>
              )}
              <button onClick={(e) => { e.stopPropagation(); deleteFolder(f.id); }}
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
        onPublish={(description) => fetch(`${API}/marketplace/publish`, alsJson("POST", { set_id: publishingSet.id, description })).catch(() => null)} />}

      {importStatus && <ImportProgress status={importStatus} />}

      {importZiel && (
        <VerknuepfungDialog
          titel={t("dash.impTitel")}
          zeilen={importZiel.zeilen}
          okLabel={t("dash.impStarten")}
          onAbbruch={() => setImportZiel(null)}
          onFertig={(werte) => importZiel.xlsx
            ? importXlsxAusfuehren(importZiel.xlsx, werte)
            : importAusfuehren(importZiel, werte)} />
      )}
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
  const { t } = useLanguage();
  const [qSearch, setQSearch] = useState("");
  // Themenfilter und -sortierung der Fragenliste. Beides wirkt nur auf die
  // ANZEIGE: die gespeicherte Reihenfolge des Quiz bleibt, wie sie ist —
  // sonst haette ein Blick nach Thema die Abfolge im Unterricht umgestellt.
  const [qThema, setQThema] = useState("");      // "" = alle, "0" = ohne Thema, sonst topic_id
  const [qNachThema, setQNachThema] = useState(false);
  // Kern-Themen aus core/topics.js — dieselbe Zeile stand auf sechs Seiten.
  const themen = useThemen();
  const themaIdx = themenIndex(themen);
  // Touch-Geraet? Dort funktioniert HTML5-Drag nicht (iOS Safari) — deshalb
  // dort Pfeile statt Ziehen. Desktop behaelt das Ziehen.
  const isTouch = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

  // Das ganze Quiz ist EIN Entwurf: Name, Reihenfolge, die vier Schalter und
  // das E/G je Frage. Vorher ging jeder Klick und jedes Verlassen des
  // Namensfeldes sofort zum Server — auch das Ziehen einer Frage.
  //
  // Im Entwurf stehen nur einfache Werte (Text, Wahrheitswerte, Zahlenlisten):
  // so erkennt `useEntwurf` verlaesslich, ob wirklich etwas offen ist. Die
  // Fragen selbst liegen daneben in `qMap` — ihr Inhalt gehoert der Frage, nicht
  // dem Quiz, und wird im Frage-Dialog gespeichert.
  const alsEntwurf = (qs) => ({
    name: qs.name,
    ids: (qs.questions || []).map((q) => q.id),
    shuffleQ: !!qs.shuffle_questions,
    shuffleA: !!qs.shuffle_answers,
    niveauAktiv: !!qs.niveau_aktiv,
    minuspunkte: !!qs.minuspunkte,
    eFragen: Object.entries(qs.niveaus || {}).filter(([, v]) => v === "E").map(([k]) => Number(k)).sort((a, b) => a - b),
  });
  const [gespeichert, setGespeichert] = useState(() => alsEntwurf(questionSet));
  const [qMap, setQMap] = useState(() => Object.fromEntries((questionSet.questions || []).map((q) => [q.id, q])));

  const e = useEntwurf(gespeichert, async (wert) => {
    const res = await fetch(`${API}/question-sets/${questionSet.id}`, alsJson("PUT", {
        name: wert.name, folder_id: questionSet.folder_id,
        question_ids: wert.ids,
        shuffle_questions: wert.shuffleQ,
        shuffle_answers: wert.shuffleA,
        niveau_aktiv: wert.niveauAktiv,
        minuspunkte: wert.minuspunkte,
        // Immer die VOLLE Zuordnung schicken: fehlt eine Frage im Objekt,
        // behaelt der Server ihr altes Niveau — ein Zurueckstellen auf G waere
        // dann wirkungslos.
        niveaus: Object.fromEntries(wert.ids.map((qid) => [String(qid), wert.eFragen.includes(qid) ? "E" : "G"])),
      })).catch(() => null);
    if (!res || !res.ok) return false;
    setGespeichert(wert);
    onQuestionsChange();
  });

  const { name, shuffleQ, shuffleA, niveauAktiv, minuspunkte } = e.wert;
  // Fragen in der Reihenfolge des Entwurfs.
  const questions = e.wert.ids.map((qid) => qMap[qid]).filter(Boolean);

  const [showAdd, setShowAdd] = useState(false);
  const [editingQ, setEditingQ] = useState(null);
  const EMPTY_Q = { text: "", choices: { A: "", B: "", C: "", D: "" }, correct_answer: "", num_choices: 4, image_url: null, image_layout: "above", choice_images: null, topic_id: null };
  const [newQ, setNewQ] = useState({ ...EMPTY_Q });

  const setzeReihenfolge = (arr) => e.setz({ ids: arr.map((q) => q.id) });

  // Touch-Ersatz fuer das Ziehen (Pfeiltasten in der Zeile). Waehrend eines
  // Zuges kann er nicht ausgeloest werden, deshalb reicht hier die echte Liste.
  const moveQuestion = (from, delta) => {
    const arr = [...questions];
    const to = from + delta;
    if (to < 0 || to >= arr.length) return;
    [arr[from], arr[to]] = [arr[to], arr[from]];
    setzeReihenfolge(arr);
  };

  // Niveau einer Frage IN DIESEM Quiz umschalten. Ohne Eintrag gilt G.
  const toggleQNiveau = (qid) => e.setz((v) => ({
    eFragen: (v.eFragen.includes(qid) ? v.eFragen.filter((x) => x !== qid) : [...v.eFragen, qid]).sort((a, b) => a - b),
  }));

  // Anlegen ist ein Befehl: die Frage entsteht sofort. In DIESES Quiz gehaengt
  // wird sie mit dem Speichern — wie jede andere Aenderung an der Liste.
  const addNewQuestion = async () => {
    if (!newQ.text.trim()) return;
    const res = await fetch(`${API}/questions`, alsJson("POST", newQ));
    const q = await res.json();
    setQMap((m) => ({ ...m, [q.id]: q }));
    e.setz((v) => ({ ids: [...v.ids, q.id] }));
    setNewQ({ ...EMPTY_Q });
  };

  // Der Frage-Dialog hat seinen eigenen Speichern-Knopf: er speichert die
  // FRAGE. Am Quiz aendert er nichts.
  const updateExistingQuestion = async () => {
    if (!editingQ || !editingQ.text.trim()) return;
    const res = await fetch(`${API}/questions/${editingQ.id}`, alsJson("PUT", editingQ));
    if (!res.ok) return;
    const q = await res.json();
    setQMap((m) => ({ ...m, [q.id]: q }));
    setEditingQ(null);
  };

  // Aus dem Quiz nehmen ist eine Aenderung an der Liste, kein Loeschen der
  // Frage — also in den Entwurf.
  const removeQuestion = (idx) => e.setz((v) => ({ ids: v.ids.filter((_, i) => i !== idx) }));

  // Ziehen mit Live-Vorschau — dieselbe Mechanik wie bei den To-dos und den
  // Notizzetteln, seit dem Zusammenfuehren nur noch in core/ziehsortieren.js.
  // Beim Suchen, Filtern oder Sortieren wird nicht gezogen: der Index der
  // Anzeige passt dann nicht zur echten Reihenfolge, ein Ablegen wuerde die
  // falsche Frage verschieben.
  const suchend = qSearch.trim().length > 0 || qThema !== "" || qNachThema;
  const zieh = useZiehVorschau(questions, setzeReihenfolge, !suchend && !isTouch);
  const previewQuestions = zieh.vorschau;


  const CHOICE_KEYS = ["A", "B", "C", "D"];

  return (
    <div>
      {/* „Zurueck" verlaesst die Maske, ohne dass sich die Adresse aendert —
          die Warnung des Routers greift hier nicht, also fragen wir selbst. */}
      <button onClick={() => { if (e.geaendert && !window.confirm(t("speichern.verlassen"))) return; onBack(); }}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", color: "var(--text3)", fontSize: 13, fontWeight: 500, padding: "4px 0", marginBottom: 16 }}>
        <Icon d={ICONS.arrowLeft} size={14} /> {t("common.back")}
      </button>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        {/* Der Quizname IST die Seitenueberschrift — deshalb 22 wie pageTitle. */}
        <input value={name} onChange={(ev) => e.setz({ name: ev.target.value })}
          style={{ ...inputBasis, fontSize: 22, fontWeight: 700, flex: 1, maxWidth: 500 }} />
        {/* EINE Leiste fuer die ganze Maske: Name, Reihenfolge, Schalter, E/G. */}
        <Speicherleiste entwurf={e} klein />
        {onDelete && <button onClick={onDelete} className="icon-btn" style={{ ...iconBtn, marginLeft: "auto" }} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={18} color={C.danger} /></button>}
      </div>

      <div style={{ display: "flex", gap: 24, marginBottom: 8, flexWrap: "wrap" }}>
        <Toggle checked={shuffleQ} onChange={(v) => e.setz({ shuffleQ: v })} label={t("dash.shuffleQ")} />
        <Toggle checked={shuffleA} onChange={(v) => e.setz({ shuffleA: v })} label={t("dash.shuffleA")} />
        <Toggle checked={niveauAktiv} onChange={(v) => e.setz({ niveauAktiv: v })} label={t("dash.niveauToggle")} />
        <Toggle checked={minuspunkte} onChange={(v) => e.setz({ minuspunkte: v })} label={t("dash.minusToggle")} />
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
        const searching = suchend;
        if (shown.length === 0) {
          return <p style={{ fontSize: 13, color: "var(--text3)" }}>{t("dash.noSearchHit")}</p>;
        }
        return shown.map((q) => {
          const idx = base.indexOf(q);
          return (
        <div
          key={q.id}
          {...zieh.props(idx)}
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
            <NiveauToggle wert={e.wert.eFragen.includes(q.id) ? "E" : "G"} mitLeer={false}
              onChange={() => toggleQNiveau(q.id)} title={t("dash.niveauQHint")} />
          )}
          <span onClick={() => setEditingQ({ ...q })} style={{ flex: 1, color: "var(--text)", cursor: "pointer" }} title={t("dash.clickEdit")}>
            <Latex>{q.text}</Latex>
            {q.image_url && <Icon d={ICONS.image} size={18} color="var(--accent)" style={{ marginLeft: 4 }} />}
            {/* Das Thema steht NICHT mehr in der Zeile, sondern im Editor. Es
                stand hinter jeder Frage — bei Fragen ohne Thema als gelbes
                „Ohne Thema", bei den anderen als voller Pfad („Mathe 7.1
                Rechnen mit Bruechen / 1 Vervielfachen und Teilen"). Das war
                laenger als die Frage selbst und hat die Liste unlesbar gemacht,
                obwohl man beim Durchsehen die FRAGE sucht. */}
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
            <DialogKopf titel={t("dash.editQ")} onClose={() => setEditingQ(null)} schliessenLabel={t("common.close")} />
            <QuestionForm q={editingQ} setQ={setEditingQ} onUpload={bildHochladen} choiceKeys={CHOICE_KEYS} />
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
            <DialogKopf titel={t("dash.newQ")} onClose={() => setShowAdd(false)} schliessenLabel={t("common.close")} />
            <QuestionForm q={newQ} setQ={setNewQ} onUpload={bildHochladen} choiceKeys={CHOICE_KEYS} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={async () => { await addNewQuestion(); setShowAdd(false); }} disabled={!newQ.text.trim()} style={btnPrimary}>{t("dash.add")}</button>
              <button onClick={() => setShowAdd(false)} style={btnSecondary}>{t("common.cancel")}</button>
            </div>
        </Modal>
      )}
    </div>
  );
}




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
  // Die Zeichenarbeit steht in core/latextabelle.js — Karten.jsx hatte dieselbe.
  const insertLatex = (tex, cursorOffset, display = false) => {
    const field = activeField.current || "text";
    const input = inputRefs.current[field];
    if (!input) return;
    const { text, pos } = formelEinfuegen(getVal(field), input.selectionStart || 0, input.selectionEnd || 0, tex, cursorOffset, display);
    setVal(field, text);
    setTimeout(() => { input.focus(); input.setSelectionRange(pos, pos); }, 0);
  };

  return (
    <>
      <textarea ref={(el) => (inputRefs.current.text = el)} onFocus={() => (activeField.current = "text")} rows={2}
        placeholder={t("dash.qTextPh")} value={q.text} onChange={(e) => setQ({ ...q, text: e.target.value })}
        style={{ ...inputBasis, width: "100%", marginBottom: 4, fontSize: 16, resize: "vertical", fontFamily: "inherit", lineHeight: 1.4 }} autoFocus />
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        {LATEX_TASTEN_LANG.map((b) => (
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
          color={quoteFarbe(stats.pct_correct)}
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
