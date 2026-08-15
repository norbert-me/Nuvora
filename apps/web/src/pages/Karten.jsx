// Modul Karten (Lehrer): Stapel & Karten verwalten, QR-Tokens drucken,
// Fortschritt sehen. Schüler lernen kontenlos über den Token (siehe Lernen.jsx).
import { useState, useEffect, useRef } from "react";
import { askConfirm, askPrompt, showAlert } from "../core/dialog.jsx";
import { Link, useSearchParams } from "react-router-dom";
import { NiveauToggle, AddButton, Icon, ICONS, iconBtn, toolbarIconBtn, toolbarBtn, toolbarBtnPrimary, toolbarInput, menuRow, CONTROL_H, CONTROL_R, COLORS as C, REIFE_COLORS, btnPrimary, btnSecondary, btnSmall, selectStyle, Modal as UiModal, overlayGuard, modalOverlay, modalPanel, Empty, Skeleton, pageApp, inputStyle, cardStyle, panelStyle, chipStyle, Popover, th as thBasis, td as tdBasis } from "../components/Icons.jsx";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import { themenIndex } from "../core/topics.js";
import KursKlasseSelect from "../components/KursKlasseSelect.jsx";
import AuthImage from "../components/AuthImage.jsx";
import AbschnittWahl from "../components/AbschnittWahl.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { useAktiv } from "../core/modules.js";
import { swr , lastClass, rememberClass } from "../core/cache.js";
import PublishModal from "../components/PublishModal.jsx";
import ImportMenu from "../components/ImportMenu.jsx";
import Latex from "../components/Latex.jsx";
import { gradeFromPct, DEFAULT_SCALE } from "../core/grades.js";
import { TABELLE_GERUEST, zeileAnhaengen, spalteAnhaengen } from "../core/latextabelle.js";
import { sende } from "../core/melden.js";

// LaTeX-Schnelltasten (wie im CardVote-Editor): fügt Formeln ins fokussierte Feld.
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
];

// Meisterung aus dem Reifegrad: gewichteter Anteil reifer Karten. Neu zählt
// nicht, langfristig voll. Ergibt 0–100 %, das die Notenskala in eine Note übersetzt.
const MASTERY_W = { neu: 0, lernen: 0.25, kurz: 0.5, mittel: 0.8, lang: 1 };
function masteryPct(hist) {
  const total = Object.values(hist || {}).reduce((a, b) => a + b, 0);
  if (!total) return null;
  const w = Object.entries(MASTERY_W).reduce((s, [k, v]) => s + ((hist[k] || 0) * v), 0);
  return (w / total) * 100;
}

const API = "/api/karten";

export default function Karten() {
  const { t } = useLanguage();
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState(null);
  const [kursId, setKursId] = useState(null); // Karten hängen am Kurs (Fach)
  // Teilkurs (Kurse aus Teilen von Klassen): Roster/Progress/Tokens des Kurses,
  // classId = Repräsentant-Klasse für die FK, kursId = Teilkurs (für die Decks).
  const [subsetKurs, setSubsetKurs] = useState(null);
  const [subsetKurse, setSubsetKurse] = useState([]);
  // Alle Kurse der Lehrkraft: die Stapel-Sammlung wird ihnen zugewiesen, und
  // der Kurs sagt auch, ob mit E/G gearbeitet wird (niveau_aktiv).
  const [kurse, setKurse] = useState([]);
  // Filter der Sammlung: null = alle Stapel, sonst „nur Stapel dieses Kurses".
  // Bewusst ein Filter und keine Voraussetzung mehr — die Stapel liegen in der
  // Sammlung, nicht in einer Klasse.
  const [filterKurs, setFilterKurs] = useState(null);
  const [decks, setDecks] = useState([]);
  const [progress, setProgress] = useState([]);
  const [tokens, setTokens] = useState(null);
  const [params] = useSearchParams();
  const view = params.get("tab") || "cards"; // cards | progress | qr — aus der Navbar
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null); // { student, cards } — Einzelstatistik
  const [topics, setTopics] = useState([]);
  const aktiv = useAktiv();
  // Themen-Bindung ist nur mit Kalender sinnvoll (Auto-Freischaltung). Ohne das
  // Modul bleibt die Option aus (Regel 3: Zusatz, nie Voraussetzung).
  const kalenderAktiv = aktiv("kalender");
  // Brücke zum Notenbuch (Regel 3: Zusatz). Nur wenn das Modul Noten aktiv ist.
  const notenAktiv = aktiv("auswertung");
  const [gradeScale, setGradeScale] = useState(DEFAULT_SCALE);
  const [notenDialog, setNotenDialog] = useState(false);

  useEffect(() => {
    if (kalenderAktiv) return swr("topics", "/api/topics", (d) => setTopics(Array.isArray(d) ? d : []));
  }, [kalenderAktiv]);

  useEffect(() => {
    if (!notenAktiv) return;
    // Notenskala der Lehrkraft vom Server (autoritativ) — der localStorage-Cache
    // kann veraltet sein, wenn die Skala in dieser Sitzung geaendert wurde.
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((u) => {
      if (u?.grade_scale) setGradeScale(u.grade_scale);
      else { try { const c = JSON.parse(localStorage.getItem("user")); if (c?.grade_scale) setGradeScale(c.grade_scale); } catch {} }
    }).catch(() => { try { const c = JSON.parse(localStorage.getItem("user")); if (c?.grade_scale) setGradeScale(c.grade_scale); } catch {} });
  }, [notenAktiv]);

  useEffect(() => {
    return swr("classes", "/api/classes", (d) => {
      const list = Array.isArray(d) ? d : [];
      setClasses(list);
      // Vorauswahl per ?class=<id> (z. B. Link aus dem Kalender), sonst erste Klasse.
      const wanted = Number(params.get("class")) || null;
      if (classId === null) { const w = lastClass(); setClassId((wanted && list.some((c) => c.id === wanted)) ? wanted : (list.some((c) => c.id === w) ? w : (list[0]?.id ?? null))); }
    });
  }, []);

  useEffect(() => { if (classId) rememberClass(classId); }, [classId]);

  // Gelöschte Stapel und Karten liegen im gemeinsamen Papierkorb des Kerns
  // (/papierkorb) — das Modul löscht nur noch.
  const kq = kursId != null ? `?kurs_id=${kursId}` : "";
  const sq = subsetKurs ? `&subset_kurs=${subsetKurs}` : ""; // Teilkurs-Roster
  const [loadingDecks, setLoadingDecks] = useState(true);
  const decksLoadedOnce = useRef(false); // Skeleton nur beim ersten Laden, nicht bei Klassen-/Kurswechsel
  // Laufende Nummer je Ladevorgang: KursKlasseSelect meldet den Kurs bewusst
  // erst NACH dem Laden der Kursgruppen, der Effekt feuert also immer zweimal —
  // erst ohne Kurs, dann mit. Kommt die erste (klassenweite) Antwort als zweite
  // an, stehen die Stapel der ganzen Klasse statt der des Kurses da. Nur die
  // juengste Antwort darf schreiben.
  //
  // JE LADEWEG EIN EIGENER ZAEHLER. Mit einem gemeinsamen verwarfen sich die
  // beiden gegenseitig: loadDecks und loadFolders laufen im selben Effekt,
  // loadFolders zaehlte hoch, und die Antwort der Stapel galt danach als
  // veraltet — die Stapelliste blieb leer, ein neu angelegter Stapel war nach
  // dem Neuladen "verschwunden". Ein Wettlaufschutz, der selbst Daten
  // verschluckt, ist schlimmer als der Wettlauf.
  const ladenrDecks = useRef(0);
  const ladenrFolders = useRef(0);
  // Die ganze Sammlung, wahlweise auf einen Kurs gefiltert.
  const loadDecks = () => {
    const meine = ++ladenrDecks.current;
    setLoadingDecks(true);
    return fetch(`${API}/decks${filterKurs ? `?kurs_id=${filterKurs}` : ""}`).then((r) => (r.ok ? r.json() : [])).then((d) => {
      if (meine === ladenrDecks.current) setDecks(Array.isArray(d) ? d : []);
    }).catch(() => {}).finally(() => { setLoadingDecks(false); decksLoadedOnce.current = true; });
  };
  // Ordner (wie CardVote) zum Gruppieren der Stapel — pro Klasse/Kurs.
  const [cardFolders, setCardFolders] = useState([]);
  const [currentCardFolder, setCurrentCardFolder] = useState(null); // null = Wurzel
  // Ein „+" mit Untermenü (Stapel/Ordner) statt zwei getrennter Knöpfe (wie CardVote).
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addMode, setAddMode] = useState(null); // null | "deck" | "folder"
  const [addName, setAddName] = useState("");
  const loadFolders = () => {
    const meine = ++ladenrFolders.current;
    fetch(`${API}/card-folders`).then((r) => (r.ok ? r.json() : [])).then((d) => {
      if (meine === ladenrFolders.current) setCardFolders(Array.isArray(d) ? d : []);
    }).catch(() => {});
  };
  // Die Sammlung haengt an keiner Klasse mehr — neu geladen wird nur, wenn sich
  // der Kurs-Filter aendert.
  useEffect(() => { loadDecks(); loadFolders(); setCurrentCardFolder(null); }, [filterKurs]);
  // Deep-Link ?deck=<id> (aus dem Kalender): in den Ordner des Stapels springen,
  // der Stapel klappt sich per autoOpen einmalig auf und scrollt hin.
  const [autoDeck, setAutoDeck] = useState(Number(params.get("deck")) || null);
  // Kurs des verlinkten Stapels (aus dem Kalender): KursKlasseSelect wählt ihn
  // vor, damit der kursgebundene Stapel überhaupt in der Liste erscheint.
  const [wantKurs] = useState(Number(params.get("kurs")) || null);
  useEffect(() => {
    if (!autoDeck || !decks.length) return;
    const d = decks.find((x) => x.id === autoDeck);
    if (d) setCurrentCardFolder(d.folder_id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decks]);
  // Drag&Drop: Ordner in einen anderen Ordner (oder über den Breadcrumb nach oben)
  // ziehen. Das Ziel wird beim Ziehen hervorgehoben (Vorschau, wohin es landet).
  const [dragFolder, setDragFolder] = useState(null);
  const [dragDeckId, setDragDeckId] = useState(null); // Stapel-Drag (in Ordner verschieben)
  const [dropTarget, setDropTarget] = useState(undefined); // undefined = keins, null = Wurzel, id = Ordner
  const folderById = () => Object.fromEntries(cardFolders.map((f) => [f.id, f]));
  const isAncestor = (aId, bId) => { const m = folderById(); let cur = m[bId]?.parent_id ?? null; while (cur != null) { if (cur === aId) return true; cur = m[cur]?.parent_id ?? null; } return false; };
  const canDropInto = (dragId, targetId) => dragId != null && targetId !== dragId && !isAncestor(dragId, targetId) && ((folderById()[dragId]?.parent_id ?? null) !== (targetId ?? null));
  const moveFolderTo = async (fId, parentId) => { const f = folderById()[fId]; if (!f) return; await sende(`${API}/card-folders/${fId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: f.name, parent_id: parentId }) }, t("karten.moveFolder")); loadFolders(); };
  // Generisch: gilt ein Ablegen auf targetId (Ordner oder Wurzel)? Für Ordner mit
  // Zyklus-Schutz, für Stapel wenn er nicht schon dort liegt.
  const canDrop = (targetId) => {
    if (dragFolder != null) return canDropInto(dragFolder, targetId);
    if (dragDeckId != null) { const d = decks.find((x) => x.id === dragDeckId); return d && (d.folder_id ?? null) !== (targetId ?? null); }
    return false;
  };
  const doDrop = (targetId) => {
    if (dragFolder != null) moveFolderTo(dragFolder, targetId);
    else if (dragDeckId != null) { const d = decks.find((x) => x.id === dragDeckId); if (d) moveDeck(d, targetId); }
  };
  const endDrag = () => { setDragFolder(null); setDragDeckId(null); setDropTarget(undefined); setDeckDrop(null); };
  // Stapel-Reorder INNERHALB des Ordners: einen Stapel auf einen anderen ziehen.
  const [deckDrop, setDeckDrop] = useState(null); // { id, side: "above"|"below" }
  const onDeckDragOver = (e, id) => {
    if (dragDeckId == null || id === dragDeckId) return;
    // Nur reorder, wenn beide Stapel im selben Ordner liegen.
    const src = decks.find((x) => x.id === dragDeckId), tgt = decks.find((x) => x.id === id);
    if (!src || !tgt || (src.folder_id ?? null) !== (tgt.folder_id ?? null)) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const side = e.clientY < r.top + r.height / 2 ? "above" : "below";
    setDeckDrop((p) => (p && p.id === id && p.side === side ? p : { id, side }));
  };
  const dropDeck = async (targetId) => {
    const von = dragDeckId, ov = deckDrop;
    endDrag();
    if (von == null || von === targetId) return;
    const inFolder = decks.filter((d) => (d.folder_id ?? null) === currentCardFolder);
    const ids = inFolder.map((d) => d.id);
    const from = ids.indexOf(von); let to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    if (ov && ov.id === targetId && ov.side === "below") to += 1;
    if (from < to) to -= 1;
    const neu = [...ids]; neu.splice(to, 0, neu.splice(from, 1)[0]);
    await fetch(`${API}/decks/reorder`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: neu }) }).catch(() => {});
    loadDecks();
  };
  const folderPath = (fid) => { const byId = Object.fromEntries(cardFolders.map((f) => [f.id, f])); const path = []; let cur = fid; while (cur != null && byId[cur]) { path.unshift(byId[cur]); cur = byId[cur].parent_id ?? null; } return path; };
  const createFolder = async (name) => { if (!name || !name.trim()) return; await sende(`${API}/card-folders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), parent_id: currentCardFolder }) }, t("karten.newFolderItem")); loadFolders(); };
  // askPrompt nimmt ein Optionen-Objekt, keinen zweiten Text: der bisherige Name
  // gehoert unter „initial", sonst startet das Feld leer und die Lehrkraft muss
  // ihn abtippen (oder speichert versehentlich einen leeren Ordnernamen).
  const renameFolder = async (f) => { const n = await askPrompt(t("karten.renameFolder"), { initial: f.name }); if (n == null || !n.trim()) return; await sende(`${API}/card-folders/${f.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: n.trim(), parent_id: f.parent_id ?? null }) }, t("karten.renameFolder")); loadFolders(); };
  const deleteFolder = async (f) => { if (!await askConfirm(t("karten.delFolderConfirm"))) return; await sende(`${API}/card-folders/${f.id}`, { method: "DELETE" }, t("common.delete")); if (currentCardFolder === f.id) setCurrentCardFolder(f.parent_id ?? null); loadFolders(); loadDecks(); };
  // Der Stapel wandert optisch sofort; ohne Meldung sah eine abgelehnte
  // Verschiebung so aus, als wäre er beim Ziehen verlorengegangen.
  const moveDeck = async (deck, folderId) => { await sende(`${API}/decks/${deck.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: deck.name, topic_id: deck.topic_id ?? null, niveau: deck.niveau || "", folder_id: folderId }) }, t("karten.moveDeck")); loadDecks(); };
  // Aus dem „+"-Menü gewählten Typ anlegen (Stapel im aktuellen Ordner / Ordner).
  const commitAdd = async () => {
    const name = addName.trim(); if (!name) return;
    // Ohne Kurs-Filter entsteht der Stapel unzugewiesen — erlaubt, er ist dann
    // nur noch nicht ausgerollt. Mit Filter erbt er genau diesen Kurs.
    if (addMode === "deck") { await call(() => fetch(`${API}/decks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, folder_id: currentCardFolder, kurs_ids: filterKurs ? [filterKurs] : [] }) })); }
    else if (addMode === "folder") { await createFolder(name); }
    setAddName(""); setAddMode(null);
  };
  // Seitenweiter Import: eine JSON/CSV-Datei wird zu einem NEUEN Stapel im
  // aktuellen Ordner (wie CardVote-Import). Name aus JSON, sonst Dateiname.
  const importDeck = () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json,.csv,.tsv,.txt";
    input.onchange = async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      const text = await f.text();
      let name = f.name.replace(/\.[^.]+$/, "");
      try { const j = JSON.parse(text); if (j && j.name) name = String(j.name); } catch { /* CSV */ }
      const cards = parseCards(text);
      if (!cards.length) { showAlert(t("karten.importEmpty")); return; }
      const r = await fetch(`${API}/decks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, folder_id: currentCardFolder, kurs_ids: filterKurs ? [filterKurs] : [] }) }).catch(() => null);
      if (!r || !r.ok) return;
      const deck = await r.json();
      await sende(`${API}/decks/${deck.id}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cards }) }, t("common.import"));
      loadDecks();
    };
    input.click();
  };

  const call = async (fn) => {
    setError("");
    const res = await fn();
    if (!res.ok) { const b = await res.json().catch(() => ({})); setError(typeof b.detail === "string" ? b.detail : t("common.notWork")); return false; }
    await loadDecks();
    return true;
  };

  const loadProgress = () => fetch(`${API}/classes/${classId}/progress${kq}${sq}`).then((r) => (r.ok ? r.json() : [])).then(setProgress).catch(() => {});
  const openDetail = async (p) => {
    const cards = await fetch(`${API}/classes/${classId}/students/${p.student_id}/cards${kq}${sq}`).then((r) => (r.ok ? r.json() : [])).catch(() => []);
    setDetail({ student: p, cards });
  };
  const rotateTokens = async () => {
    if (!(await askConfirm(t("karten.rotateConfirm")))) return;
    const r = await fetch(`${API}/classes/${classId}/tokens/rotate${subsetKurs ? `?subset_kurs=${subsetKurs}` : ""}`,
      { method: "POST" }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (r) setTokens(r);
  };
  const loadTokens = () => fetch(`${API}/classes/${classId}/tokens${subsetKurs ? `?subset_kurs=${subsetKurs}` : ""}`, { method: "POST" }).then((r) => (r.ok ? r.json() : [])).then(setTokens).catch(() => {});
  // Daten laden, wenn der Tab (aus der Navbar) oder die Klasse wechselt.
  useEffect(() => {
    if (!classId) return;
    if (view === "progress") loadProgress(); // eslint-disable-line
    if (view === "qr") loadTokens();
  }, [view, classId, kursId, subsetKurs]);

  // Kurse: fuer den Filter, die Zuweisung UND die Frage, ob mit E/G gearbeitet
  // wird. Teilkurse sind daraus die mit einzeln hinzugefuegten SuS.
  useEffect(() => {
    fetch("/api/kurse").then((r) => (r.ok ? r.json() : [])).then((d) => {
      const list = Array.isArray(d) ? d : [];
      setKurse(list);
      setSubsetKurse(list.filter((k) => (k.member_count || 0) > 0));
    }).catch(() => {});
  }, []);

  // Name je Kurs und „arbeitet dieser Stapel mit E/G?" — ein Stapel kann in
  // mehreren Kursen liegen; sobald EINER Niveaus fuehrt, gilt die G-Vorgabe.
  const kursName = (id) => kurse.find((k) => k.id === id)?.name || "";
  const deckNiveauAktiv = (deck) => (deck.kurs_ids || []).some((id) => kurse.find((k) => k.id === id)?.niveau_aktiv);

  if (classes.length === 0) {
    return (
      <div style={{ maxWidth: 700 }}>
        <p style={{ color: "var(--text2)", fontSize: 14 }}>
          {t("karten.needClass").split("{{link}}")[0]}<Link to="/classes" style={{ color: "var(--accent)" }}>{t("nav.classes")}</Link>{t("karten.needClass").split("{{link}}")[1]}
        </p>
      </div>
    );
  }

  return (
    <div style={{ ...pageApp }}>
      <Werkzeugleiste style={{ marginBottom: 16 }} links={<>
        {/* In der Sammlung ist der Kurs ein FILTER, keine Voraussetzung: die
            Stapel liegen alle da, die Auswahl blendet nur ein. Fortschritt und
            Zugangs-Codes brauchen dagegen weiter eine Klasse (ihre SuS). */}
        {view === "cards" ? (
          <label data-tour="karten-class" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text2)" }}>
            {t("karten.filterKurs")}
            <select value={filterKurs || ""} style={selectStyle}
              onChange={(e) => setFilterKurs(e.target.value ? Number(e.target.value) : null)}>
              <option value="">{t("karten.filterAlle")}</option>
              {kurse.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </label>
        ) : (
          <span data-tour="karten-class" style={{ display: "inline-flex" }}><KursKlasseSelect value={subsetKurs ? null : classId} kursValue={wantKurs} onChange={(id, kid) => { setSubsetKurs(null); setClassId(id); setKursId(kid); setTokens(null); }} onKurs={(k) => { if (!subsetKurs) setKursId(k); }} /></span>
        )}
        {view !== "cards" && subsetKurse.length > 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text2)" }}>
            {t("noten.teilkurs")}
            {/* Gleiche Hoehe und Form wie die Klassenauswahl daneben (selectStyle). */}
            <select value={subsetKurs || ""} style={selectStyle}
              onChange={async (e) => {
                const kid = e.target.value ? Number(e.target.value) : null;
                setTokens(null);
                if (!kid) { setSubsetKurs(null); return; }
                const list = await fetch(`${API}/kurse/${kid}/members`).then((r) => (r.ok ? r.json() : [])).catch(() => []);
                const rep = Array.isArray(list) && list.length ? list[0].class_id : null;
                if (!rep) return;
                setSubsetKurs(kid); setClassId(rep); setKursId(kid);
              }}>
              <option value="">{t("noten.teilkursNone")}</option>
              {subsetKurse.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </label>
        )}
      </>} />

      {error && <p style={{ color: C.danger, fontSize: 13, marginBottom: 8 }}>{error}</p>}

      {view === "cards" && (
        <>
          {/* Brotkrume und Anlegen sind EINE Leiste: „wo bin ich" und „was lege
              ich hier an" gehoeren zusammen — vorher standen sie in zwei Zeilen
              untereinander, jede mit eigenen Massen. */}
          <Werkzeugleiste style={{ marginBottom: 16 }} links={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
              <button onClick={() => setCurrentCardFolder(null)}
                onDragOver={(e) => { if (canDrop(null)) { e.preventDefault(); if (dropTarget !== null) setDropTarget(null); } }}
                onDragLeave={() => setDropTarget((cur) => (cur === null ? undefined : cur))}
                onDrop={(e) => { e.preventDefault(); if (canDrop(null)) doDrop(null); endDrag(); }}
                style={krumeBtn(dropTarget === null && canDrop(null), currentCardFolder == null)}>{t("karten.allDecks")}</button>
              {folderPath(currentCardFolder).map((f, i, arr) => (
                <span key={f.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ color: "var(--text3)" }}>›</span>
                  <button onClick={() => setCurrentCardFolder(f.id)}
                    onDragOver={(e) => { if (canDrop(f.id)) { e.preventDefault(); if (dropTarget !== f.id) setDropTarget(f.id); } }}
                    onDragLeave={() => setDropTarget((cur) => (cur === f.id ? undefined : cur))}
                    onDrop={(e) => { e.preventDefault(); if (canDrop(f.id)) doDrop(f.id); endDrag(); }}
                    style={krumeBtn(dropTarget === f.id && canDrop(f.id), i === arr.length - 1)}>{f.name}</button>
                </span>
              ))}
            </span>
          }>
            {addMode ? (
              <>
                <input value={addName} onChange={(e) => setAddName(e.target.value)} autoFocus
                  placeholder={addMode === "deck" ? t("karten.newDeck") : t("karten.newFolder")}
                  onKeyDown={(e) => { if (e.key === "Enter") commitAdd(); if (e.key === "Escape") { setAddName(""); setAddMode(null); } }}
                  style={{ ...toolbarInput, flex: 1, minWidth: 160, maxWidth: 320 }} />
                <button onClick={commitAdd} disabled={!addName.trim()} style={{ ...toolbarBtnPrimary, opacity: addName.trim() ? 1 : 0.4 }}>{t("common.add")}</button>
                <button onClick={() => { setAddName(""); setAddMode(null); }} style={toolbarBtn}>{t("common.abort")}</button>
              </>
            ) : (
              <div data-tour="karten-new" style={{ position: "relative", display: "inline-flex" }}>
                <AddButton onClick={() => setAddMenuOpen((v) => !v)} title={t("common.add")} />
                {addMenuOpen && (<>
                  <div onClick={() => setAddMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                  <Popover style={{ minWidth: 190, padding: 4 }}>
                    <button onClick={() => { setAddMenuOpen(false); setAddMode("deck"); }} style={menuRow}><Icon d={ICONS.plus} size={15} /> {t("karten.newDeckItem")}</button>
                    <button onClick={() => { setAddMenuOpen(false); setAddMode("folder"); }} style={menuRow}><Icon d={ICONS.folder} size={15} /> {t("karten.newFolderItem")}</button>
                  </Popover>
                </>)}
              </div>
            )}
            <ImportMenu importItems={[{ label: t("karten.importDeck"), onClick: importDeck }]}
              templateItems={[{ label: t("karten.jsonTemplate"), href: "/beispiel-karten.json" }]} />
          </Werkzeugleiste>

          {/* Unterordner des aktuellen Ordners — per Drag&Drop verschiebbar. */}
          {cardFolders.filter((f) => (f.parent_id ?? null) === currentCardFolder).map((f) => {
            const isDrag = dragFolder === f.id;
            const isTarget = dropTarget === f.id && canDrop(f.id);
            return (
            <div key={f.id} draggable
              onDragStart={(e) => { setDragFolder(f.id); e.dataTransfer.effectAllowed = "move"; }}
              onDragEnd={endDrag}
              onDragOver={(e) => { if (canDrop(f.id)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dropTarget !== f.id) setDropTarget(f.id); } }}
              onDragLeave={() => setDropTarget((cur) => (cur === f.id ? undefined : cur))}
              onDrop={(e) => { e.preventDefault(); if (canDrop(f.id)) doDrop(f.id); endDrag(); }}
              style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", marginBottom: 8, opacity: isDrag ? 0.4 : 1, cursor: "grab",
                ...(isTarget ? { background: "var(--accent-bg, rgba(10,132,255,0.10))", border: "1px solid var(--accent)" } : null) }}>
              <span className="drag-handle" style={{ color: "var(--text3)", cursor: "grab", display: "inline-flex", flexShrink: 0 }}><Icon d={ICONS.grip} size={15} /></span>
              <button onClick={() => setCurrentCardFolder(f.id)} style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", textAlign: "left", minWidth: 0, color: "var(--text)" }}>
                <Icon d={ICONS.folder} size={18} />
                <strong style={{ fontSize: 16 }}>{f.name}{isTarget ? ` — ${t("karten.dropHere")}` : ""}</strong>
              </button>
              <button onClick={() => renameFolder(f)} className="icon-btn" style={iconBtn} title={t("common.edit")} aria-label={t("common.edit")}><Icon d={ICONS.edit} size={15} /></button>
              <button onClick={() => deleteFolder(f)} className="icon-btn" style={iconBtn} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={15} color={C.danger} /></button>
            </div>
            );
          })}

          {loadingDecks && !decksLoadedOnce.current ? <Skeleton rows={3} height={60} />
            : (decks.filter((d) => (d.folder_id ?? null) === currentCardFolder).length === 0 && cardFolders.filter((f) => (f.parent_id ?? null) === currentCardFolder).length === 0) ? <Empty title={t("karten.noDecks")} hint={t("karten.noDecksHint")} /> : null}
          {decks.filter((d) => (d.folder_id ?? null) === currentCardFolder).map((d) => <Deck key={d.id} deck={d} t={t} call={call} topics={topics} showTopic={kalenderAktiv} folders={cardFolders} onMove={moveDeck} kurse={kurse} kursName={kursName} niveauAktiv={deckNiveauAktiv(d)} onZuweisen={loadDecks} onDragStartDeck={() => setDragDeckId(d.id)} onDragEndDeck={endDrag} dragging={dragDeckId === d.id} autoOpen={autoDeck === d.id} onAutoOpened={() => setAutoDeck(null)} onReorderOver={(e) => onDeckDragOver(e, d.id)} onReorderDrop={() => dropDeck(d.id)} dropSide={deckDrop && deckDrop.id === d.id ? deckDrop.side : null} />)}
        </>
      )}

      {view === "progress" && (() => {
        // Die Kartenzahl gilt JE KIND: der Server filtert sie nach Niveau
        // (E-Kind sieht E- und neutrale Karten, G-Kind G- und neutrale). Hier
        // stand `progress[0].total` — die Zahl des ersten Kindes als Nenner fuer
        // alle. Ein G-Kind bekam damit Rueckstand fuer Karten angerechnet, die
        // es nie zu sehen bekommt; genau das verbietet die E/G-Regel.
        const gesamtIrgendwo = progress.some((p) => (p.total || 0) > 0);
        // Klassen-Reifegrad zeigt nur aktiv gelernte Karten — "Neu" (noch nicht
        // angefasst) bleibt aussen vor, sonst spiegelt der Balken vor allem
        // Wochenansicht: wer hat diese Woche (ab Montag) gelernt, wer noch nie.
        const wochStart = (() => { const d = new Date(); const wd = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - wd); return d.getTime(); })();
        const nStud = progress.length;
        const dieseWoche = progress.filter((p) => p.last_reviewed && new Date(p.last_reviewed).getTime() >= wochStart).length;
        const nieGelernt = progress.filter((p) => !p.last_reviewed).length;
        return (
          <>
            {!gesamtIrgendwo ? (
              <p style={{ fontSize: 14, color: "var(--text3)", marginBottom: 16 }}>{t("karten.noRolledOut")}</p>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{t("karten.progress")}</span>
                <span style={{ ...chipStyle, background: C.success + "1f", color: C.success }}>{t("karten.thisWeek")}: {dieseWoche}/{nStud}</span>
                {nieGelernt > 0 && <span style={chipStyle}>{t("karten.neverLearned")}: {nieGelernt}</span>}
                {notenAktiv && <button onClick={() => setNotenDialog(true)} style={{ ...toolbarBtn, marginLeft: "auto" }}>{t("karten.toNoten")}</button>}
              </div>
            )}
            <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                <thead><tr>
                  <th style={{ ...th, textAlign: "left" }}>{t("common.name")}</th>
                  <th style={{ ...th, textAlign: "left", minWidth: 120 }}>{t("karten.maturity")}</th>
                  <th style={th}>{t("karten.reviewed")}</th>
                  <th style={th}>{t("karten.due")}</th>
                  <th style={th}>{t("karten.lastLearned")}</th>
                </tr></thead>
                <tbody>
                  {progress.map((p) => (
                    <tr key={p.student_id}>
                      <td style={{ ...td, textAlign: "left" }}>
                        <button onClick={() => openDetail(p)} style={{ border: "none", background: "none", color: "var(--accent)", cursor: "pointer", fontWeight: 600, fontSize: 14, padding: 4, textAlign: "left" }}>{p.name}</button>
                      </td>
                      <td style={{ ...td, textAlign: "left" }}><ReifeBar hist={p.hist} /></td>
                      <td style={td}>{p.reviewed}{p.total ? ` / ${p.total}` : ""}</td>
                      <td style={{ ...td, color: p.due ? C.warning : "var(--text3)" }}>{p.due || "—"}</td>
                      <td style={{ ...td, color: "var(--text3)", fontSize: 13 }}>{p.last_reviewed ? new Date(p.last_reviewed).toLocaleDateString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        );
      })()}

      {view === "qr" && (
        <div>
          <p style={{ fontSize: 13, color: "var(--text3)", marginBottom: 12 }}>{t("karten.qrHint")}</p>
          {/* Drucken ist der Alltag, „neu vergeben" die Ausnahme mit Folgen:
              ein weitergegebener Link zeigt dauerhaft Lernstand und
              Testergebnisse eines Kindes, neu vergeben macht jeden Ausdruck
              ungueltig. Deshalb steht es im ⋯-Menue. */}
          <Werkzeugleiste style={{ marginBottom: 16 }}
            mehr={[{ key: "rotate", label: t("karten.rotate"), icon: ICONS.refresh, gefahr: true, onClick: rotateTokens }]}>
            <button onClick={() => window.print()} style={toolbarBtn}><Icon d={ICONS.print} size={15} /> {t("karten.print")}</button>
          </Werkzeugleiste>
          {/* Feste Papierfarben statt Theme-Variablen: diese Kaertchen werden
              ausgedruckt und ausgeschnitten. Papier ist immer weiss, die
              Schrift immer schwarz — im dunklen Design waeren sie sonst am
              Bildschirm richtig und auf dem Blatt unbrauchbar. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
            {(tokens || []).map((s) => (
              <div key={s.student_id} style={{ ...panelStyle, textAlign: "center", padding: 12, background: "#fff" }}>
                <img src={`${API}/qr/${s.token}.png?base=${encodeURIComponent(window.location.origin)}`} alt="" width={120} height={120} style={{ display: "block", margin: "0 auto 6px" }} />
                <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>{s.name}</div>
                <div style={{ fontSize: 11, color: "#666" }}>#{s.card_id}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {detail && <StudentDetail detail={detail} t={t} onClose={() => setDetail(null)} />}
      {notenDialog && <NotenBrueckeModal t={t} classId={classId} kursId={kursId} progress={progress} scale={gradeScale} onClose={() => setNotenDialog(false)} />}
    </div>
  );
}

// Brücke Karten → Notenbuch: rechnet je SuS die Meisterung in eine Note (über die
// Notenskala der Lehrkraft) und legt daraus eine neue Spalte an. Nur SuS, die schon
// gelernt haben — nie-Gelernte bekommen keine 6 untergeschoben. Die Spalte ist frei
// editierbar; die Note bleibt pädagogische Entscheidung.
function NotenBrueckeModal({ t, classId, kursId, progress, scale, onClose }) {
  const [sectionId, setSectionId] = useState(null);
  const [name, setName] = useState(`${t("karten.masteryColumn")} ${new Date().toLocaleDateString()}`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const grades = progress
    .filter((p) => p.reviewed > 0)
    .map((p) => ({ student_id: p.student_id, value: gradeFromPct(masteryPct(p.hist), scale) }))
    .filter((g) => g.value >= 1 && g.value <= 6);

  const submit = async () => {
    if (!sectionId) { setErr(t("notenimp.noSection")); return; }
    if (!name.trim()) { setErr(t("noten.columnName")); return; }
    setBusy(true); setErr("");
    const res = await fetch("/api/noten/import-grades", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ class_id: classId, kurs_id: kursId, section_id: Number(sectionId), column_name: name.trim(), note: t("karten.masteryNote"), source_kind: "karten", grades }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.ok) onClose();
    else { const b = res ? await res.json().catch(() => ({})) : {}; setErr(typeof b.detail === "string" ? b.detail : t("common.notWork")); }
  };

  return (
    <UiModal onClose={onClose} width={440} label={t("karten.toNoten")}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{t("karten.toNoten")}</h3>
        <p style={{ fontSize: 13, color: "var(--text3)", margin: "0 0 16px" }}>{t("karten.masteryHint", { n: grades.length })}</p>
        <AbschnittWahl classId={classId} kursId={kursId} value={sectionId} onChange={setSectionId} />
        <div style={{ fontSize: 13, color: "var(--text2)", margin: "12px 0 4px" }}>{t("noten.columnName")}</div>
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...inp, width: "100%" }} />
        {err && <p style={{ color: C.danger, fontSize: 13, marginTop: 8 }}>{err}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={submit} disabled={busy || grades.length === 0 || !sectionId} style={{ ...btnPrimary, opacity: busy || grades.length === 0 || !sectionId ? 0.6 : 1 }}>{t("common.save")}</button>
          <button onClick={onClose} style={btnSecondary}>{t("common.abort")}</button>
        </div>
    </UiModal>
  );
}

// Einzelstatistik je Schueler: alle Karten mit Reifegrad, Faelligkeit und
// Fehlversuchen. Nur Anzeige.
function StudentDetail({ detail, t, onClose }) {
  const { student, cards } = detail;
  // Nach Set/Stapel gruppieren: je Set ein Reifegrad-Balken mit der aktuellen
  // Zuordnung, statt jede einzelne Karte aufzulisten.
  const sets = {};
  for (const c of cards) {
    const key = c.deck || "—";
    (sets[key] ||= { hist: {}, learned: 0, total: 0 });
    sets[key].hist[c.bucket] = (sets[key].hist[c.bucket] || 0) + 1;
    sets[key].total += 1;
    if (c.bucket !== "neu") sets[key].learned += 1;
  }
  const rows = Object.entries(sets);
  return (
    <UiModal onClose={onClose} width={520} label={student.name}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, flex: 1 }}>{student.name}</h3>
          <button onClick={onClose} className="icon-btn" style={iconBtn} title={t("common.close")} aria-label={t("common.close")}><Icon d={ICONS.close} size={16} /></button>
        </div>
        <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 16 }}>{student.reviewed} / {student.total} {t("karten.reviewed").toLowerCase()} · {student.due || 0} {t("karten.due").toLowerCase()}</div>
        {rows.length === 0 ? (
          <p style={{ fontSize: 14, color: "var(--text3)" }}>{t("karten.noRolledOut")}</p>
        ) : rows.map(([name, s]) => (
          <div key={name} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{name}</span>
              <span style={{ fontSize: 12, color: "var(--text3)" }}>{s.learned} / {s.total} {t("karten.reviewed").toLowerCase()}</span>
            </div>
            <ReifeBar hist={s.hist} height={12} />
          </div>
        ))}
    </UiModal>
  );
}

function Deck({ deck, t, call, topics = [], showTopic = false, folders = [], onMove, kurse = [], kursName = () => "", niveauAktiv = false, onZuweisen, onDragStartDeck, onDragEndDeck, dragging = false, autoOpen = false, onAutoOpened, onReorderOver, onReorderDrop, dropSide = null }) {
  const [planDate, setPlanDate] = useState("");
  const [zuweisen, setZuweisen] = useState(false);   // Dialog „welchen Kursen?"
  const [publishing, setPublishing] = useState(false);
  const [importing, setImporting] = useState(false);
  // Standard eingeklappt: nur Kopf zeigen; ausgeklappt kommen Einstellungen,
  // Karten und Eingabe dazu. Umbenennen per Stift am Namen.
  const [collapsed, setCollapsed] = useState(true);
  const rootRef = useRef(null);
  // Deep-Link (?deck=<id> aus dem Kalender): einmalig aufklappen + hinscrollen.
  useEffect(() => {
    if (!autoOpen) return;
    setCollapsed(false);
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    onAutoOpened && onAutoOpened();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);
  const [renaming, setRenaming] = useState(false);
  const [nameVal, setNameVal] = useState(deck.name || "");
  const [moveOpen, setMoveOpen] = useState(false); // „Verschieben"-Popover (Ziel-Ordner)
  const [rollOpen, setRollOpen] = useState(false);  // Ausrollen-Untermenü
  // Deck als Ganzes ziehbar, aber nur wenn der Zug am Griff (⠿) beginnt — sonst
  // bliebe Text-/Button-Interaktion im Deck kaputt. Der Griff setzt das Flag per
  // mousedown; das Wurzel-draggable prüft es beim dragstart.
  const dragFromHandle = useRef(false);
  // folder_id IMMER mitschicken, sonst nullt ein Speichern (Name/Thema/Niveau)
  // die Ordner-Zuordnung.
  const saveDeck = (patch) => call(() => fetch(`${API}/decks/${deck.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: deck.name, topic_id: deck.topic_id ?? null, niveau: deck.niveau || "", folder_id: deck.folder_id ?? null, ...patch }) }));
  const setTopic = (tid) => saveDeck({ topic_id: tid ? Number(tid) : null });
  const setNiveau = (n) => saveDeck({ niveau: n });
  // Karten-Bilder je Seite (oben-zentral). imgVer erzwingt ein Neu-Laden der
  // Vorschau nach Upload/Löschen (gleiche URL, neuer Inhalt).
  const [imgVer, setImgVer] = useState(0);
  const uploadCardImg = (cardId, side, file) => {
    if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    call(() => fetch(`${API}/cards/${cardId}/image/${side}`, { method: "POST", body: fd })).then(() => setImgVer((v) => v + 1));
  };
  const removeCardImg = (cardId, side) => call(() => fetch(`${API}/cards/${cardId}/image/${side}`, { method: "DELETE" })).then(() => setImgVer((v) => v + 1));

  // Karten innerhalb des Stapels per Drag & Drop sortieren — mit Vorschau, wo
  // die Karte landet (Linie ober-/unterhalb der Zielzeile).
  const [cards, setCards] = useState(deck.cards);
  useEffect(() => { setCards(deck.cards); }, [deck.cards]);
  const [dragCard, setDragCard] = useState(null);
  const [cardDrop, setCardDrop] = useState(null); // { id, side: "above"|"below" }
  // Karte bearbeiten (Text + Bilder) — in einem Popup.
  const [editCard, setEditCard] = useState(null); // Karten-id im Edit
  const saveEditCard = (id, front, back, niveau) => call(() => fetch(`${API}/cards/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ front, back, niveau: niveau || "" }) })).then(() => setEditCard(null));
  // Neue Karte per Popup (wie Bearbeiten) statt Inline-Formular.
  const [newOpen, setNewOpen] = useState(false);
  const createCard = async (frontV, backV, niveauV) => {
    if (!frontV.trim() && !backV.trim()) return;
    await call(() => fetch(`${API}/decks/${deck.id}/cards`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ front: frontV.trim(), back: backV.trim(), niveau: niveauV || "" }) }));
    setNewOpen(false);
  };
  // Gelöschte Karten liegen im gemeinsamen Papierkorb des Kerns (/papierkorb).
  const [studying, setStudying] = useState(false); // Lernmodus (Karten durchgehen)
  const onCardDragOver = (e, id) => {
    e.preventDefault();
    if (dragCard == null || id === dragCard) { setCardDrop(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const side = e.clientY < r.top + r.height / 2 ? "above" : "below";
    setCardDrop((p) => (p && p.id === id && p.side === side ? p : { id, side }));
  };
  const dropCard = async (targetId) => {
    const von = dragCard, ov = cardDrop;
    setDragCard(null); setCardDrop(null);
    if (von == null || von === targetId) return;
    const ids = cards.map((c) => c.id);
    const from = ids.indexOf(von); let to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    if (ov && ov.id === targetId && ov.side === "below") to += 1;
    if (from < to) to -= 1;
    const neu = [...ids]; neu.splice(to, 0, neu.splice(from, 1)[0]);
    setCards(neu.map((id) => cards.find((c) => c.id === id))); // sofortige Vorschau
    call(() => fetch(`${API}/decks/${deck.id}/cards/reorder`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: neu }) }));
  };
  const exportDeck = () => {
    const data = { type: "nuvora_karten_deck", version: 1, name: deck.name || "", cards: deck.cards.map((c) => ({ front: c.front, back: c.back, niveau: c.niveau || "" })) };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = `${(deck.name || "stapel").replace(/[^\w-]+/g, "_")}.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  const doRename = async () => { const n = nameVal.trim(); setRenaming(false); if (n && n !== deck.name) await saveDeck({ name: n }); };
  // Siehe core/topics.js — eine Quelle fuer Beschriftung UND Reihenfolge.
  const themen = themenIndex(topics);
  const topicLabel = (tp) => themen.label(tp);
  const release = (payload) => call(() => fetch(`${API}/decks/${deck.id}/release`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }));

  const zugewiesen = deck.kurs_ids || [];
  const now = Date.now();
  const rel = deck.released_at ? new Date(deck.released_at).getTime() : null;
  const status = rel === null ? "entwurf" : rel > now ? "geplant" : "aus";
  const badge = status === "aus" ? { text: t("karten.rolledOut"), bg: C.success + "1f", col: C.success }
    : status === "geplant" ? { text: t("karten.plannedFor", { date: new Date(deck.released_at).toLocaleString() }), bg: C.warning + "1f", col: C.warning }
    : { text: t("karten.draft"), bg: "var(--bg3)", col: "var(--text3)" };

  return (
    <div ref={rootRef} draggable={!!onDragStartDeck}
      onDragStart={onDragStartDeck ? (e) => { if (!dragFromHandle.current) { e.preventDefault(); return; } e.dataTransfer.effectAllowed = "move"; onDragStartDeck(); } : undefined}
      onDragEnd={onDragStartDeck ? () => { dragFromHandle.current = false; onDragEndDeck && onDragEndDeck(); } : undefined}
      onDragOver={onReorderOver} onDrop={onReorderDrop}
      style={{ ...cardStyle, position: "relative", marginBottom: 12, opacity: dragging ? 0.4 : 1,
        // Kein Schatten, sondern die Einfuege-Marke: eine Linie oben oder unten,
        // die zeigt, wo der Stapel landet. EINE Staerke (MARKE) fuer Stapel und
        // Karten — vorher waren es 3 px hier und 2 px eine Ebene tiefer.
        boxShadow: dropSide === "above" ? `inset 0 ${MARKE}px 0 var(--accent)` : dropSide === "below" ? `inset 0 -${MARKE}px 0 var(--accent)` : undefined }}>
      {/* Kopf des Stapels als Werkzeugleiste: sichtbar bleibt, was man staendig
          braucht (Aufklappen, Name, Durchgehen) — Export, Import, Veroeffentlichen
          und Verschieben liegen im ⋯-Menue. Vorher standen hier bis zu elf
          Bedienelemente in einer Reihe. */}
      <Werkzeugleiste style={{ marginBottom: collapsed ? 0 : 10 }}
        links={<>
        {onDragStartDeck && (
          <span onMouseDown={() => { dragFromHandle.current = true; }}
            className="drag-handle" title={t("karten.moveToFolder")} style={{ color: "var(--text3)", cursor: "grab", display: "inline-flex", flexShrink: 0, userSelect: "none" }}><Icon d={ICONS.grip} size={15} /></span>
        )}
        <button onClick={() => setCollapsed((v) => !v)} className="icon-btn" style={toolbarIconBtn} title={collapsed ? t("topics.expand") : t("topics.collapse")}>
          <span style={{ display: "inline-flex", transform: collapsed ? "none" : "rotate(90deg)", transition: "transform 0.15s", color: "var(--text3)" }}><Icon d={ICONS.open} size={16} /></span>
        </button>
        {renaming ? (
          <>
            <input value={nameVal} onChange={(e) => setNameVal(e.target.value)} autoFocus onBlur={(e) => { if (!e.relatedTarget || !e.relatedTarget.dataset || e.relatedTarget.dataset.keep !== "1") doRename(); }}
              onKeyDown={(e) => { if (e.key === "Enter") doRename(); if (e.key === "Escape") { setNameVal(deck.name || ""); setRenaming(false); } }}
              style={{ ...toolbarInput, fontSize: 16, fontWeight: 700 }} />
            {/* Löschen erscheint erst im Bearbeiten-Modus (nicht dauerhaft im Kopf). */}
            <button data-keep="1" onMouseDown={(e) => e.preventDefault()} onClick={async () => { if (await askConfirm(t("karten.delDeck", { name: deck.name }))) call(() => fetch(`${API}/decks/${deck.id}`, { method: "DELETE" })); }}
              className="icon-btn" style={toolbarIconBtn} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} color={C.danger} size={16} /></button>
          </>
        ) : (
          <>
            <strong onClick={() => setCollapsed((v) => !v)} style={{ fontSize: 16, cursor: "pointer" }}>{deck.name || t("karten.deck")}</strong>
            <button onClick={() => { setNameVal(deck.name || ""); setRenaming(true); }} className="icon-btn" style={toolbarIconBtn} title={t("karten.renameDeck")} aria-label={t("karten.renameDeck")}><Icon d={ICONS.edit} size={15} /></button>
          </>
        )}
        {status !== "entwurf" && <span style={{ ...chipStyle, background: badge.bg, color: badge.col }}>{badge.text}</span>}
        {/* Wem gilt dieser Stapel? Ohne Zuweisung ist er angelegt, aber fuer
            niemanden ausgerollt — das muss man sehen, nicht suchen muessen. */}
        <button onClick={() => setZuweisen(true)} title={t("karten.assignKurse")}
          style={{ ...chipStyle, border: "none", cursor: "pointer",
            ...(zugewiesen.length ? null : { background: C.warning + "1f", color: C.warning }) }}>
          {zugewiesen.length ? zugewiesen.map(kursName).filter(Boolean).join(", ") : t("karten.noKurs")}
        </button>
        </>}
        mehr={collapsed ? [] : [
          { key: "kurse", label: t("karten.assignKurse"), icon: ICONS.users, onClick: () => setZuweisen(true) },
          deck.cards.length > 0 && { key: "export", label: t("karten.export"), icon: ICONS.export, onClick: exportDeck },
          { key: "import", label: t("karten.import"), icon: ICONS.import, onClick: () => setImporting(true) },
          deck.cards.length > 0 && { key: "publish", label: t("karten.publish"), icon: ICONS.share, onClick: () => setPublishing(true) },
          (onMove && folders.length > 0) && { key: "move", label: t("karten.moveToFolder"), icon: ICONS.moveAll, onClick: () => setMoveOpen(true) },
        ]}>
        {!collapsed && showTopic && (
          <select value={deck.topic_id ?? ""} onChange={(e) => setTopic(e.target.value)} title={t("karten.topicHint")}
            style={{ ...selectStyle, fontSize: 13, maxWidth: 180 }}>
            <option value="">– {t("karten.freeCards")} –</option>
            {themen.geordnet.map((tp) => <option key={tp.id} value={tp.id}>{topicLabel(tp)}</option>)}
          </select>
        )}
        {/* Niveau-Stapel: "E"/"G" wird automatisch nur an Schueler des jeweiligen
            Niveaus verteilt, "" an alle. Kein manuelles Zuweisen noetig. */}
        {!collapsed && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }} title={t("karten.niveauHint")}>
          <NiveauToggle wert={deck.niveau || ""} size={24} onChange={setNiveau} title={t("karten.niveauHint")} />
          <span style={{ fontSize: 12, color: "var(--text3)" }}>
            {deck.niveau === "E" ? t("karten.niveauE") : deck.niveau === "G" ? t("karten.niveauG") : t("karten.niveauAll")}
          </span>
        </span>
        )}
        <span style={{ fontSize: 13, color: "var(--text3)" }}>{deck.cards.length} {t("karten.cards")}</span>
        {!collapsed && cards.length > 0 && (
          <button onClick={() => setStudying(true)} className="icon-btn" style={toolbarIconBtn} title={t("karten.study")} aria-label={t("karten.study")}><Icon d={ICONS.eye} size={18} color="var(--accent)" /></button>
        )}
      </Werkzeugleiste>
      {/* Ziel-Ordner zum Verschieben — aus dem ⋯-Menue geoeffnet, deshalb
          rechtsbuendig unter der Leiste. */}
      {moveOpen && !collapsed && onMove && (<>
        <div onClick={() => setMoveOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
        <Popover align="right" style={{ top: CONTROL_H + 24, right: 16, minWidth: 180, maxHeight: 260, overflow: "auto", padding: 8 }}>
          {[{ id: null, name: `– ${t("karten.rootFolder")} –` }, ...folders].map((f) => {
            const active = (deck.folder_id ?? null) === f.id;
            return (
              <button key={f.id ?? "root"} onClick={() => { setMoveOpen(false); if (!active) onMove(deck, f.id); }}
                style={{ ...menuRow, fontSize: 13, background: active ? "var(--bg2)" : "none", color: active ? "var(--text3)" : "var(--text)", fontWeight: active ? 700 : 500, cursor: active ? "default" : "pointer" }}>
                <Icon d={active ? ICONS.check : ICONS.folder} size={15} />
                {f.name}
              </button>
            );
          })}
        </Popover>
      </>)}
      {zuweisen && <KursZuweisungModal deck={deck} kurse={kurse} t={t}
        onClose={() => setZuweisen(false)}
        onSave={async (ids) => {
          await sende(`${API}/decks/${deck.id}/kurse`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kurs_ids: ids }) }, t("karten.assignKurse"));
          setZuweisen(false);
          onZuweisen && onZuweisen();
        }} />}
      {publishing && <PublishModal name={deck.name || t("karten.deck")} onClose={() => setPublishing(false)}
        onPublish={(description) => fetch(`/api/marketplace/publish/deck`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deck_id: deck.id, description }) }).catch(() => null)} />}

      {!collapsed && (<>
      {/* Ausrollen gebündelt in einem Untermenü: sofort, geplant, zurückziehen. */}
      {deck.cards.length > 0 && (
        <div style={{ position: "relative", display: "inline-block", marginBottom: 12 }}>
          <button onClick={() => setRollOpen((v) => !v)} style={toolbarBtn}>
            {t("karten.rollout")} <Icon d={ICONS.open} size={10} style={{ transform: "rotate(90deg)" }} />
          </button>
          {rollOpen && (
            <>
              <div onClick={() => setRollOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 30 }} />
              <Popover style={{ zIndex: 31, padding: 8, minWidth: 240 }}>
                {status !== "aus" && <button onClick={() => { setRollOpen(false); release({ now: true }); }} style={{ ...menuRow }}><Icon d={ICONS.upload} size={15} color="var(--accent)" /> {t("karten.rollOutNow")}</button>}
                {status !== "aus" && (
                  <div style={{ padding: "8px 10px" }}>
                    <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 4 }}>{t("karten.planLabel")}</div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {/* Nur Datum wählen — freigeschaltet wird immer 07:00 morgens des Tages. */}
                      <input type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} style={{ ...toolbarInput, flex: 1, minWidth: 150 }} />
                      <button disabled={!planDate} onClick={() => { if (planDate) { const [y, mo, d] = planDate.split("-").map(Number); setRollOpen(false); release({ released_at: new Date(y, mo - 1, d, 7, 0, 0).toISOString() }); } }}
                        style={{ ...toolbarBtnPrimary, opacity: planDate ? 1 : 0.4 }}>{t("karten.plan")}</button>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>{t("karten.planTime")}</div>
                  </div>
                )}
                {status !== "entwurf" && <button onClick={() => { setRollOpen(false); release({}); }} style={{ ...menuRow, color: C.danger }}><Icon d={ICONS.ban} size={15} color={C.danger} /> {t("karten.withdraw")}</button>}
              </Popover>
            </>
          )}
        </div>
      )}
      {cards.map((c) => {
        const over = dragCard != null && cardDrop && cardDrop.id === c.id;
        return (
        <div key={c.id} onDragOver={(e) => onCardDragOver(e, c.id)} onDrop={() => dropCard(c.id)}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid var(--border)", fontSize: 14,
            opacity: dragCard === c.id ? 0.4 : 1,
            boxShadow: over && cardDrop.side === "above" ? `inset 0 ${MARKE}px 0 var(--accent)` : over && cardDrop.side === "below" ? `inset 0 -${MARKE}px 0 var(--accent)` : undefined }}>
          {/* Dieselbe Zeile wie bei einer CardVote-Frage (Dashboard.jsx): Griff,
              Niveau-Zeichen, Text — und rechts EIN Symbol. Vorher standen hier
              vier Knoepfe nebeneinander, zwei davon Bildvorschauen; in einer
              Liste, durch die man scrollt und zieht, ist das eine Reihe von
              Fallen. Das Bild meldet sich jetzt wie dort als Zeichen im Text. */}
          <span draggable onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.effectAllowed = "move"; setDragCard(c.id); }} onDragEnd={() => { setDragCard(null); setCardDrop(null); }}
            className="drag-handle" title={t("karten.reorderHint")} style={{ color: "var(--text3)", width: 20, display: "inline-flex", justifyContent: "center", cursor: "grab", flexShrink: 0, userSelect: "none" }}><Icon d={ICONS.grip} size={15} /></span>
          {/* Der EINZIGE Weg, das Niveau zu setzen — im Bearbeiten-Dialog gibt
              es ihn bewusst nicht mehr. Arbeitet der Kurs mit E/G, faellt der
              dritte Zustand („gilt fuer alle") weg. */}
          <NiveauToggle wert={c.niveau || ""} mitLeer={!niveauAktiv} title={t("karten.cardNiveauHint")}
            onChange={(v) => saveEditCard(c.id, c.front, c.back, v)} />
          <span onClick={() => setEditCard(c.id)} title={t("common.edit")} style={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
            <strong><Latex>{c.front}</Latex></strong> <span style={{ color: "var(--text3)" }}>→ <Latex>{c.back}</Latex></span>
            {(c.has_front_image || c.has_back_image) && <Icon d={ICONS.image} size={18} color="var(--accent)" style={{ marginLeft: 4 }} />}
          </span>
          <button onClick={() => setEditCard(c.id)} className="icon-btn" style={iconBtn} title={t("common.edit")} aria-label={t("common.edit")}><Icon d={ICONS.edit} size={18} /></button>
        </div>
        );
      })}
      {editCard != null && cards.find((c) => c.id === editCard) && (
        <CardEditModal card={cards.find((c) => c.id === editCard)} imgVer={imgVer} onUpload={uploadCardImg} onRemove={removeCardImg}
          onDelete={async (id) => {
            if (!await askConfirm(t("karten.delCardConfirm"))) return;
            setEditCard(null);
            call(() => fetch(`${API}/cards/${id}`, { method: "DELETE" }));
          }}
          onSave={saveEditCard} onClose={() => setEditCard(null)} t={t} />
      )}
      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button onClick={() => setNewOpen(true)} style={{ ...btnPrimary, padding: "8px 16px", display: "inline-flex", alignItems: "center", gap: 4 }}><Icon d={ICONS.plus} size={15} color="var(--bg)" /> {t("karten.newCard")}</button>
      </div>
      </>)}
      {newOpen && (
        // Karteikarten sind G, solange nicht anders gesagt — aber nur, wo der
        // Kurs mit E/G arbeitet. Sonst startet die neue Karte neutral.
        <CardEditModal card={{ id: null, front: "", back: "", niveau: niveauAktiv ? "G" : "", has_front_image: false, has_back_image: false }} imgVer={imgVer}
          onSave={(_id, f, b, n) => createCard(f, b, n)} onClose={() => setNewOpen(false)} t={t} />
      )}
      {studying && <StudyModal cards={cards} deckName={deck.name || t("karten.deck")} t={t} onClose={() => setStudying(false)} />}
      {importing && <ImportModal deckName={deck.name || t("karten.deck")} t={t}
        onClose={() => setImporting(false)}
        onImport={async (cards) => call(() => fetch(`${API}/decks/${deck.id}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cards }) }))} />}
    </div>
  );
}

// Welchen Kursen gilt dieser Stapel? Häkchenliste der eigenen Kurse — ein
// Stapel darf in mehreren liegen und in keinem (dann ist er nur nicht
// ausgerollt). Die Klasse spielt hier keine Rolle mehr.
function KursZuweisungModal({ deck, kurse, t, onClose, onSave }) {
  const [ids, setIds] = useState(() => new Set(deck.kurs_ids || []));
  const [busy, setBusy] = useState(false);
  const um = (id) => setIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <UiModal onClose={onClose} width={440} label={t("karten.assignKurse")}>
      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{t("karten.assignKurse")}</h3>
      <p style={{ fontSize: 13, color: "var(--text3)", margin: "0 0 12px" }}>{t("karten.assignHint")}</p>
      {kurse.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--text3)" }}>{t("karten.noKurseYet")}</p>
      ) : kurse.map((k) => (
        <label key={k.id} style={{ ...menuRow, cursor: "pointer" }}>
          <input type="checkbox" checked={ids.has(k.id)} onChange={() => um(k.id)} />
          {k.name}
        </label>
      ))}
      {ids.size === 0 && <p style={{ fontSize: 12, color: C.warning, marginTop: 8 }}>{t("karten.noKursWarn")}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button disabled={busy} onClick={() => { setBusy(true); onSave([...ids]); }} style={btnPrimary}>{t("common.save")}</button>
        <button onClick={onClose} style={btnSecondary}>{t("common.abort")}</button>
      </div>
    </UiModal>
  );
}

// Lernmodus: Karten des Stapels durchgehen. Vorderseite → tippen/Leertaste
// deckt die Rückseite auf → weiter. Nur zum Anschauen, speichert nichts.
function StudyModal({ cards, deckName, t, onClose }) {
  const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const [order, setOrder] = useState(() => cards.map((_, i) => i));
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const c = cards[order[pos]];
  const go = (d) => { setFlipped(false); setPos((p) => Math.min(cards.length - 1, Math.max(0, p + d))); };
  const flip = () => setFlipped((f) => !f);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { onClose(); }
      else if (e.key === " " || e.key === "Enter") { e.preventDefault(); flipped ? go(1) : setFlipped(true); }
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flipped]);
  if (!c) return null;
  const img = flipped ? (c.has_back_image ? "back" : null) : (c.has_front_image ? "front" : null);
  const txt = flipped ? c.back : c.front;
  const done = pos + 1;
  return (
    <div style={{ ...modalOverlay, background: "rgba(0,0,0,0.72)" }} {...overlayGuard(onClose)}>
      <div style={{ width: "100%", maxWidth: 640, display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Der Lernmodus liegt auf einem dunklen Vorhang (rgba(0,0,0,0.72)) —
            weisse Schrift gilt hier in beiden Designs, das ist keine
            vergessene Theme-Variable. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#fff" }}>
          <strong style={{ fontSize: 16 }}>{deckName}</strong>
          <span style={{ fontSize: 13, opacity: 0.7 }}>{done} / {cards.length}</span>
          <span style={{ flex: 1 }} />
          <button onClick={() => { setOrder(shuffle(cards.map((_, i) => i))); setPos(0); setFlipped(false); }} className="icon-btn" style={{ ...iconBtn, color: "#fff" }} title={t("zufall.reroll")} aria-label={t("zufall.reroll")}><Icon d={ICONS.shuffle} size={18} color="#fff" /></button>
          <button onClick={onClose} className="icon-btn" style={{ ...iconBtn, color: "#fff" }} title={t("common.close")} aria-label={t("common.close")}><Icon d={ICONS.close} size={18} color="#fff" /></button>
        </div>
        {/* Fortschrittsbalken */}
        {/* Reine Grafik: der Radius ist die halbe Kante (4/2) — eine runde
            Balkenkappe, kein Bedienelement. */}
        <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.18)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${(done / cards.length) * 100}%`, background: "var(--accent)", transition: "width .2s" }} />
        </div>
        {/* Karte: klick dreht */}
        <div onClick={flip}
          style={{ ...modalPanel, boxShadow: "none", maxHeight: "none", minHeight: 300, padding: 24,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, cursor: "pointer", textAlign: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: flipped ? "var(--accent)" : "var(--text3)" }}>
            {flipped ? t("karten.back") : t("karten.front")}
          </span>
          {img && <AuthImage src={`${API}/cards/${c.id}/image/${img}`} style={{ maxHeight: 200, maxWidth: "100%", objectFit: "contain", borderRadius: CONTROL_R }} />}
          <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.4 }}><Latex>{txt}</Latex></div>
          {!flipped && <span style={{ fontSize: 13, color: "var(--text3)" }}>{t("karten.tapToFlip")}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => go(-1)} disabled={pos === 0} style={{ ...btnSecondary, opacity: pos === 0 ? 0.4 : 1, display: "inline-flex", alignItems: "center", gap: 4 }}><Icon d={ICONS.arrowLeft} size={14} /> {t("karten.prev")}</button>
          <button onClick={flip} style={{ ...btnSecondary, flex: 1 }}>{flipped ? t("karten.showFront") : t("karten.reveal")}</button>
          {pos + 1 < cards.length
            ? <button onClick={() => go(1)} style={{ ...btnPrimary, display: "inline-flex", alignItems: "center", gap: 4 }}>{t("karten.next")} <Icon d={ICONS.arrowRight} size={14} color="var(--bg)" /></button>
            : <button onClick={onClose} style={{ ...btnPrimary }}>{t("karten.finish")}</button>}
        </div>
      </div>
    </div>
  );
}

// Karte bearbeiten im Popup: Vorder-/Rückseite als Text + Bild-Upload je Seite.
function CardEditModal({ card, imgVer, onUpload, onRemove, onSave, onDelete, onClose, t }) {
  const [front, setFront] = useState(card.front || "");
  const [back, setBack] = useState(card.back || "");
  // Das Niveau wird an der ZEILE umgeschaltet, nicht hier. Es reist nur mit,
  // damit ein Speichern es nicht zurueckstellt — zwei Wege zu derselben Sache
  // enden damit, dass einer weniger kann als der andere.
  const niveau = card.niveau || "";
  const inpS = { ...inputStyle, width: "100%", resize: "vertical" };
  const lbl = { fontSize: 13, color: "var(--text2)", margin: "12px 0 4px" };
  // LaTeX-Schnelltasten fügen in das zuletzt fokussierte Feld ein (wie in der Anlege-Maske).
  const frontRef = useRef(null), backRef = useRef(null), activeField = useRef("front");
  const insertLatex = (tex, offset) => {
    const isBack = activeField.current === "back";
    const input = isBack ? backRef.current : frontRef.current;
    const val = isBack ? back : front;
    const setter = isBack ? setBack : setFront;
    if (!input) return;
    const start = input.selectionStart || 0, end = input.selectionEnd || 0;
    const sel = val.slice(start, end);
    let insert = tex; if (sel && tex.includes("{}")) insert = tex.replace("{}", `{${sel}}`);
    const before = val.slice(0, start);
    const needsDollar = !before.includes("$") || before.split("$").length % 2 === 1;
    const wrapped = needsDollar ? `$${insert}$` : insert;
    setter(before + wrapped + val.slice(end));
    setTimeout(() => { const pos = start + wrapped.length + (offset || 0); input.focus(); input.setSelectionRange(pos, pos); }, 0);
  };
  // Tabellen-Tasten. Sie schreiben ihr eigenes `$$…$$` — die Automatik von
  // insertLatex passt hier nicht, eine Tabelle ist abgesetzter Formelsatz.
  const tabelle = (art) => {
    const isBack = activeField.current === "back";
    const input = isBack ? backRef.current : frontRef.current;
    const val = isBack ? back : front;
    const setter = isBack ? setBack : setFront;
    if (!input) return;
    const start = input.selectionStart || 0, end = input.selectionEnd || 0;
    let neu, pos;
    if (art === "neu") {
      neu = val.slice(0, start) + TABELLE_GERUEST + val.slice(end);
      pos = start + TABELLE_GERUEST.indexOf("\\hline ") + "\\hline ".length;  // erste Zelle
    } else {
      const r = art === "zeile" ? zeileAnhaengen(val, start) : spalteAnhaengen(val, start);
      if (!r) return;
      neu = r.text; pos = r.pos;
    }
    setter(neu);
    setTimeout(() => { input.focus(); input.setSelectionRange(pos, pos); }, 0);
  };
  // Zeile/Spalte nur zeigen, wo es etwas zu erweitern gibt — sonst stünden zwei
  // Tasten herum, die nichts tun.
  const hatTabelle = /\\begin\{(array|tabular)\}/.test(`${front}\n${back}`);
  return (
    <UiModal onClose={onClose} width={480} style={{ maxHeight: "90vh", overflowY: "auto" }} label={card.id ? t("karten.editCard") : t("karten.newCard")}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, flex: 1 }}>{card.id ? t("karten.editCard") : t("karten.newCard")}</h3>
          <button onClick={onClose} className="icon-btn" style={toolbarIconBtn} title={t("common.close")} aria-label={t("common.close")}><Icon d={ICONS.close} size={18} /></button>
        </div>

        {/* LaTeX-Schnelltasten (fügen ins zuletzt fokussierte Feld). */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", margin: "4px 0 6px" }}>
          {LATEX_BUTTONS.map((b) => (
            <button key={b.label} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertLatex(b.tex, b.cursor)}
              style={{ ...btnSecondary, ...btnSmall, fontFamily: "serif" }}>{b.label}</button>
          ))}
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => tabelle("neu")}
            title={t("karten.latexTable")} aria-label={t("karten.latexTable")}
            style={{ ...btnSecondary, ...btnSmall, fontFamily: "serif" }}>⊞</button>
          {hatTabelle && (<>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => tabelle("zeile")}
              style={{ ...btnSecondary, ...btnSmall }}>{t("karten.latexRow")}</button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => tabelle("spalte")}
              style={{ ...btnSecondary, ...btnSmall }}>{t("karten.latexCol")}</button>
          </>)}
          <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: 4 }}>{t("karten.latexHint")}</span>
        </div>

        <div style={lbl}>{t("karten.front")}</div>
        <textarea ref={frontRef} onFocus={() => (activeField.current = "front")} value={front} onChange={(e) => setFront(e.target.value)} rows={2} style={inpS} />
        {card.id && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 12, color: "var(--text3)" }}>{t("karten.imgFront")}</span>
            <CardImgCtl cardId={card.id} side="front" has={card.has_front_image} imgVer={imgVer} onUpload={onUpload} onRemove={onRemove} t={t} />
          </div>
        )}

        <div style={lbl}>{t("karten.back")}</div>
        <textarea ref={backRef} onFocus={() => (activeField.current = "back")} value={back} onChange={(e) => setBack(e.target.value)} rows={2} style={inpS} />
        {card.id ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 12, color: "var(--text3)" }}>{t("karten.imgBack")}</span>
            <CardImgCtl cardId={card.id} side="back" has={card.has_back_image} imgVer={imgVer} onUpload={onUpload} onRemove={onRemove} t={t} />
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 8 }}>{t("karten.imgAfterSave")}</div>
        )}

        {(front.includes("$") || back.includes("$")) && (
          <div style={{ ...panelStyle, marginTop: 12, padding: "8px 12px", background: "var(--bg2)", fontSize: 14 }}>
            <Latex>{front}</Latex> <span style={{ color: "var(--text3)" }}>→ <Latex>{back}</Latex></span>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center" }}>
          <button onClick={() => onSave(card.id, front.trim(), back.trim(), niveau)} style={btnPrimary}>{t("common.save")}</button>
          <button onClick={onClose} style={btnSecondary}>{t("common.abort")}</button>
          {/* Loeschen liegt hier statt in der Zeile: dort lag der Papierkorb
              beim Ziehen und Scrollen unter dem Finger. Ganz rechts, in
              Gefahrenfarbe, mit Rueckfrage. */}
          {card.id && onDelete && (
            <button onClick={() => onDelete(card.id)}
              style={{ ...btnSecondary, marginLeft: "auto", color: C.danger, display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Icon d={ICONS.trash} size={15} color={C.danger} /> {t("common.delete")}
            </button>
          )}
        </div>
    </UiModal>
  );
}

// Bild-Steuerung je Kartenseite: Thumbnail + Entfernen, sonst Upload-Knopf.
function CardImgCtl({ cardId, side, has, imgVer, onUpload, onRemove, t }) {
  if (has) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        <AuthImage src={`${API}/cards/${cardId}/image/${side}`} reloadKey={imgVer}
          style={{ height: 32, width: 32, objectFit: "cover", borderRadius: CONTROL_R, border: "1px solid var(--border2)" }} />
        {/* Muelleimer, kein Minus: „−" liest sich wie „kleiner machen", nicht
            wie „weg". Ueberall dasselbe Bild fuers Loeschen. */}
        <button onClick={() => onRemove(cardId, side)} className="icon-btn" style={iconBtn} title={t("karten.imgRemove")} aria-label={t("karten.imgRemove")}><Icon d={ICONS.trash} size={14} color={C.danger} /></button>
      </span>
    );
  }
  return (
    <label className="icon-btn" style={{ ...iconBtn, cursor: "pointer", flexShrink: 0 }} title={`${t("karten.imgAdd")} (${side === "front" ? t("karten.front") : t("karten.back")})`}>
      <Icon d={ICONS.upload} size={14} color="var(--text3)" />
      <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; onUpload(cardId, side, f); }} />
    </label>
  );
}

// CSV/TSV/Text in {front, back}-Paare. Trenner automatisch erkannt (Tab,
// Semikolon, Komma). Kopfzeilen (mit '#') werden uebersprungen.
function parseCards(text) {
  // JSON zuerst: { "cards": [{front, back}] } oder direktes Array [{front, back}].
  const trimmed = (text || "").trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const data = JSON.parse(trimmed);
      const arr = Array.isArray(data) ? data : (Array.isArray(data.cards) ? data.cards : []);
      // Niveau mitnehmen, damit ein Export dieser App verlustfrei zurueckkommt
      // (der Export schreibt es mit). Unbekanntes fällt auf "" zurück.
      return arr.map((c) => ({ front: String(c.front ?? "").trim(), back: String(c.back ?? "").trim(),
                               niveau: ["E", "G"].includes(c.niveau) ? c.niveau : "" }))
        .filter((c) => c.front || c.back);
    } catch { /* kein gültiges JSON — als CSV/Text weiter */ }
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (!lines.length) return [];
  // Trenner an der ersten Datenzeile bestimmen: Tab > Semikolon > Komma.
  const first = lines[0];
  const delim = first.includes("\t") ? "\t" : first.includes(";") ? ";" : ",";
  const splitLine = (line) => {
    // Einfaches CSV mit Anfuehrungszeichen: "a,b","c" bleibt zusammen.
    const out = []; let cur = ""; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === delim && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  return lines.map(splitLine).filter((c) => c.length >= 2 && (c[0].trim() || c[1].trim()))
    .map((c) => ({ front: c[0].trim(), back: c[1].trim() }));
}

function ImportModal({ deckName, onClose, onImport, t }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = parseCards(text);
  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setText(String(r.result || ""));
    r.readAsText(f);
  };
  const doImport = async () => {
    if (!parsed.length || busy) return;
    setBusy(true);
    const ok = await onImport(parsed);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <UiModal onClose={onClose} width={560} label={t("karten.importTitle", { name: deckName })}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{t("karten.importTitle", { name: deckName })}</h3>
        <p style={{ fontSize: 13, color: "var(--text3)", margin: "0 0 12px" }}>{t("karten.importHint")}</p>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
          <input type="file" accept=".csv,.tsv,.txt,.json" onChange={onFile} style={{ fontSize: 13 }} />
          <a href="/beispiel-karten.json" download style={{ fontSize: 13, color: "var(--accent)" }}>{t("karten.jsonTemplate")}</a>
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={t("karten.importPlaceholder")} rows={8}
          style={{ ...inp, width: "100%", boxSizing: "border-box", fontFamily: "monospace", fontSize: 13, resize: "vertical" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
          <button onClick={doImport} disabled={!parsed.length || busy} style={{ ...btnPrimary, opacity: (parsed.length && !busy) ? 1 : 0.4 }}>
            {busy ? t("karten.importing") : t("karten.importCount", { n: parsed.length })}
          </button>
          <button onClick={onClose} style={btnSecondary}>{t("common.abort")}</button>
        </div>
    </UiModal>
  );
}

// Reifegrade fuer das Histogramm. Die Farben kommen aus REIFE_COLORS (Icons.jsx) —
// dieselbe Karte muss hier und auf der Schuelerseite gleich eingefaerbt sein.
const REIFE = [
  ["neu", "Neu"],
  ["lernen", "Am Lernen"],
  ["kurz", "Kurzfristig"],
  ["mittel", "Mittelfristig"],
  ["lang", "Langfristig"],
];

// Gestapelter Reifegrad-Balken aus einem hist-Objekt {neu,lernen,...}.
function ReifeBar({ hist, height = 10 }) {
  const total = REIFE.reduce((s, [k]) => s + (hist?.[k] || 0), 0);
  if (!total) return <span style={{ fontSize: 12, color: "var(--text3)" }}>—</span>;
  return (
    <div style={{ display: "flex", height, borderRadius: height / 2, overflow: "hidden", minWidth: 80 }} title={REIFE.map(([k, l]) => `${l}: ${hist[k] || 0}`).join(" · ")}>
      {REIFE.map(([k]) => {
        const n = hist?.[k] || 0;
        return n > 0 ? <div key={k} style={{ width: `${(n / total) * 100}%`, background: REIFE_COLORS[k] }} /> : null;
      })}
    </div>
  );
}

const inp = { ...inputStyle };
// Einfuege-Marke beim Ziehen (kein Schatten): eine Linie ober- oder unterhalb
// der Zielzeile. EINE Staerke fuer Stapel und Karten.
const MARKE = 3;
// Stufe der Brotkrume. Sie steht in einer Werkzeugleiste, also gilt auch hier
// CONTROL_H/CONTROL_R; der Rahmen ist nur beim Ziehen sichtbar (Ablege-Ziel),
// bleibt aber immer reserviert, damit nichts springt.
const krumeBtn = (ziel, aktuell) => ({
  height: CONTROL_H, borderRadius: CONTROL_R, padding: "0 8px", fontSize: 13, fontWeight: 600,
  display: "inline-flex", alignItems: "center", cursor: "pointer", boxSizing: "border-box",
  background: ziel ? "var(--accent-bg, rgba(10,132,255,0.12))" : "none",
  border: `1px solid ${ziel ? "var(--accent)" : "transparent"}`,
  color: aktuell ? "var(--text)" : "var(--accent)",
});
// Aus dem Kern abgeleitet: nur Innenabstand und Kopflinie weichen ab.
const th = { ...thBasis, padding: "8px 10px", borderBottom: "2px solid var(--border)" };
const td = { ...tdBasis, padding: "7px 10px" };
