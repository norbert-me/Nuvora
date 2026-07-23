// Modul Karten (Lehrer): Stapel & Karten verwalten, QR-Tokens drucken,
// Fortschritt sehen. Schüler lernen kontenlos über den Token (siehe Lernen.jsx).
import { useState, useEffect, useRef } from "react";
import { askConfirm, askPrompt, showAlert } from "../core/dialog.jsx";
import { Link, useSearchParams } from "react-router-dom";
import { AddButton, Icon, ICONS, iconBtn, COLORS as C, btnPrimary, btnSecondary, pageTitle, selectStyle, modalOverlay, modalPanel, Empty, Skeleton } from "../components/Icons.jsx";
import KursKlasseSelect from "../components/KursKlasseSelect.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { useModules } from "../core/modules.js";
import { swr , lastClass, rememberClass } from "../core/cache.js";
import PublishModal from "../components/PublishModal.jsx";
import ImportMenu from "../components/ImportMenu.jsx";
import Latex from "../components/Latex.jsx";
import { gradeFromPct, DEFAULT_SCALE } from "../core/grades.js";

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
  const [decks, setDecks] = useState([]);
  const [progress, setProgress] = useState([]);
  const [tokens, setTokens] = useState(null);
  const [params] = useSearchParams();
  const view = params.get("tab") || "cards"; // cards | progress | qr — aus der Navbar
  const [error, setError] = useState("");
  const [newDeck, setNewDeck] = useState("");
  const [addingDeck, setAddingDeck] = useState(false);
  const [detail, setDetail] = useState(null); // { student, cards } — Einzelstatistik
  const [topics, setTopics] = useState([]);
  const { modules } = useModules();
  // Themen-Bindung ist nur mit Kalender sinnvoll (Auto-Freischaltung). Ohne das
  // Modul bleibt die Option aus (Regel 3: Zusatz, nie Voraussetzung).
  const kalenderAktiv = modules.find((m) => m.key === "kalender")?.active ?? false;
  // Brücke zum Notenbuch (Regel 3: Zusatz). Nur wenn das Modul Noten aktiv ist.
  const notenAktiv = modules.find((m) => m.key === "noten")?.active ?? false;
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

  const [deckTrash, setDeckTrash] = useState([]);
  const [showTrash, setShowTrash] = useState(false);
  const kq = kursId != null ? `?kurs_id=${kursId}` : "";
  const sq = subsetKurs ? `&subset_kurs=${subsetKurs}` : ""; // Teilkurs-Roster
  const [loadingDecks, setLoadingDecks] = useState(true);
  const decksLoadedOnce = useRef(false); // Skeleton nur beim ersten Laden, nicht bei Klassen-/Kurswechsel
  const loadDecks = (id) => { if (!id) return; setLoadingDecks(true); return fetch(`${API}/classes/${id}/decks${kq}`).then((r) => (r.ok ? r.json() : [])).then(setDecks).catch(() => {}).finally(() => { setLoadingDecks(false); decksLoadedOnce.current = true; }); };
  const loadTrash = (id) => id && fetch(`${API}/classes/${id}/decks/trash${kq}`).then((r) => (r.ok ? r.json() : [])).then((d) => setDeckTrash(Array.isArray(d) ? d : [])).catch(() => {});
  // Ordner (wie CardVote) zum Gruppieren der Stapel — pro Klasse/Kurs.
  const [cardFolders, setCardFolders] = useState([]);
  const [currentCardFolder, setCurrentCardFolder] = useState(null); // null = Wurzel
  // Ein „+" mit Untermenü (Stapel/Ordner) statt zwei getrennter Knöpfe (wie CardVote).
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addMode, setAddMode] = useState(null); // null | "deck" | "folder"
  const [addName, setAddName] = useState("");
  const loadFolders = (id) => id && fetch(`${API}/classes/${id}/card-folders${kq}`).then((r) => (r.ok ? r.json() : [])).then((d) => setCardFolders(Array.isArray(d) ? d : [])).catch(() => {});
  useEffect(() => { loadDecks(classId); loadTrash(classId); loadFolders(classId); setCurrentCardFolder(null); }, [classId, kursId]);
  const folderName = (fid) => (cardFolders.find((f) => f.id === fid) || {}).name || "";
  const folderPath = (fid) => { const byId = Object.fromEntries(cardFolders.map((f) => [f.id, f])); const path = []; let cur = fid; while (cur != null && byId[cur]) { path.unshift(byId[cur]); cur = byId[cur].parent_id ?? null; } return path; };
  const createFolder = async (name) => { if (!name || !name.trim() || !classId) return; await fetch(`${API}/classes/${classId}/card-folders${kq}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), parent_id: currentCardFolder }) }).catch(() => {}); loadFolders(classId); };
  const renameFolder = async (f) => { const n = await askPrompt(t("karten.renameFolder"), f.name); if (n == null) return; await fetch(`${API}/card-folders/${f.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: n.trim(), parent_id: f.parent_id ?? null }) }).catch(() => {}); loadFolders(classId); };
  const deleteFolder = async (f) => { if (!await askConfirm(t("karten.delFolderConfirm"))) return; await fetch(`${API}/card-folders/${f.id}`, { method: "DELETE" }).catch(() => {}); if (currentCardFolder === f.id) setCurrentCardFolder(f.parent_id ?? null); loadFolders(classId); loadDecks(classId); };
  const moveDeck = async (deck, folderId) => { await fetch(`${API}/decks/${deck.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: deck.name, topic_id: deck.topic_id ?? null, niveau: deck.niveau || "", folder_id: folderId }) }).catch(() => {}); loadDecks(classId); };
  // Aus dem „+"-Menü gewählten Typ anlegen (Stapel im aktuellen Ordner / Ordner).
  const commitAdd = async () => {
    const name = addName.trim(); if (!name) return;
    if (addMode === "deck") { await call(() => fetch(`${API}/classes/${classId}/decks${kq}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, folder_id: currentCardFolder }) })); }
    else if (addMode === "folder") { await createFolder(name); }
    setAddName(""); setAddMode(null);
  };
  // Seitenweiter Import: eine JSON/CSV-Datei wird zu einem NEUEN Stapel im
  // aktuellen Ordner (wie CardVote-Import). Name aus JSON, sonst Dateiname.
  const importDeck = () => {
    if (!classId) return;
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json,.csv,.tsv,.txt";
    input.onchange = async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      const text = await f.text();
      let name = f.name.replace(/\.[^.]+$/, "");
      try { const j = JSON.parse(text); if (j && j.name) name = String(j.name); } catch { /* CSV */ }
      const cards = parseCards(text);
      if (!cards.length) { showAlert(t("karten.importEmpty")); return; }
      const r = await fetch(`${API}/classes/${classId}/decks${kq}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, folder_id: currentCardFolder }) }).catch(() => null);
      if (!r || !r.ok) return;
      const deck = await r.json();
      await fetch(`${API}/decks/${deck.id}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cards }) }).catch(() => {});
      loadDecks(classId);
    };
    input.click();
  };
  const restoreDeck = async (id) => { await fetch(`${API}/decks/${id}/restore`, { method: "POST" }).catch(() => {}); loadDecks(classId); loadTrash(classId); };
  const purgeDeck = async (id) => {
    if (!await askConfirm(t("karten.purgeConfirm"))) return;
    await fetch(`${API}/decks/${id}/purge`, { method: "DELETE" }).catch(() => {});
    loadTrash(classId);
  };

  const call = async (fn) => {
    setError("");
    const res = await fn();
    if (!res.ok) { const b = await res.json().catch(() => ({})); setError(typeof b.detail === "string" ? b.detail : t("common.notWork")); return false; }
    await loadDecks(classId);
    loadTrash(classId);
    return true;
  };

  const loadProgress = () => fetch(`${API}/classes/${classId}/progress${kq}${sq}`).then((r) => (r.ok ? r.json() : [])).then(setProgress).catch(() => {});
  const openDetail = async (p) => {
    const cards = await fetch(`${API}/classes/${classId}/students/${p.student_id}/cards${kq}${sq}`).then((r) => (r.ok ? r.json() : [])).catch(() => []);
    setDetail({ student: p, cards });
  };
  const loadTokens = () => fetch(`${API}/classes/${classId}/tokens${subsetKurs ? `?subset_kurs=${subsetKurs}` : ""}`, { method: "POST" }).then((r) => (r.ok ? r.json() : [])).then(setTokens).catch(() => {});
  // Daten laden, wenn der Tab (aus der Navbar) oder die Klasse wechselt.
  useEffect(() => {
    if (!classId) return;
    if (view === "progress") loadProgress(); // eslint-disable-line
    if (view === "qr") loadTokens();
  }, [view, classId, kursId, subsetKurs]);

  // Teilkurse (nur solche mit einzeln hinzugefügten SuS).
  useEffect(() => {
    fetch(`${API}/kurse`).then((r) => (r.ok ? r.json() : [])).then((d) => {
      setSubsetKurse((Array.isArray(d) ? d : []).filter((k) => (k.member_count || 0) > 0));
    }).catch(() => {});
  }, []);

  if (classes.length === 0) {
    return (
      <div style={{ maxWidth: 700 }}>
        <h1 style={pageTitle}>{t("karten.title")}</h1>
        <p style={{ color: "var(--text2)", fontSize: 14 }}>
          {t("karten.needClass").split("{{link}}")[0]}<Link to="/classes" style={{ color: "var(--accent)" }}>{t("nav.classes")}</Link>{t("karten.needClass").split("{{link}}")[1]}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <h1 style={{ ...pageTitle, marginBottom: 0 }}>{t("karten.title")}</h1>
        <span data-tour="karten-class" style={{ display: "inline-flex" }}><KursKlasseSelect value={subsetKurs ? null : classId} onChange={(id, kid) => { setSubsetKurs(null); setClassId(id); setKursId(kid); setTokens(null); }} onKurs={(k) => { if (!subsetKurs) setKursId(k); }} /></span>
        {subsetKurse.length > 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text2)" }}>
            {t("noten.teilkurs")}
            <select value={subsetKurs || ""} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border2)", background: "var(--bg)", color: "var(--text)" }}
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
      </div>

      {error && <p style={{ color: C.danger, fontSize: 13, marginBottom: 10 }}>{error}</p>}

      {view === "cards" && (
        <>
          {/* Breadcrumb: Wurzel › Ordner › Unterordner */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 12, fontSize: 13.5 }}>
            <button onClick={() => setCurrentCardFolder(null)} style={{ background: "none", border: "none", cursor: "pointer", color: currentCardFolder == null ? "var(--text)" : "var(--accent)", fontWeight: 600, padding: 0 }}>{t("karten.allDecks")}</button>
            {folderPath(currentCardFolder).map((f, i, arr) => (
              <span key={f.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "var(--text3)" }}>›</span>
                <button onClick={() => setCurrentCardFolder(f.id)} style={{ background: "none", border: "none", cursor: "pointer", color: i === arr.length - 1 ? "var(--text)" : "var(--accent)", fontWeight: 600, padding: 0 }}>{f.name}</button>
              </span>
            ))}
          </div>

          {/* Ein „+" mit Untermenü: Stapel oder Ordner (im aktuellen Ordner). */}
          <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
            {addMode ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1, minWidth: 240 }}>
                <input value={addName} onChange={(e) => setAddName(e.target.value)} autoFocus
                  placeholder={addMode === "deck" ? t("karten.newDeck") : t("karten.newFolder")}
                  onKeyDown={(e) => { if (e.key === "Enter") commitAdd(); if (e.key === "Escape") { setAddName(""); setAddMode(null); } }}
                  style={{ flex: 1, maxWidth: 320, padding: "8px 12px", border: "1px solid var(--border2)", borderRadius: 10, background: "var(--bg)", color: "var(--text)" }} />
                <button onClick={commitAdd} disabled={!addName.trim()} style={{ ...btnPrimary, padding: "8px 14px", opacity: addName.trim() ? 1 : 0.4 }}>{t("common.add")}</button>
                <button onClick={() => { setAddName(""); setAddMode(null); }} style={btnSecondary}>{t("common.abort")}</button>
              </div>
            ) : (
              <div data-tour="karten-new" style={{ position: "relative" }}>
                <AddButton onClick={() => setAddMenuOpen((v) => !v)} title={t("common.add")} />
                {addMenuOpen && (<>
                  <div onClick={() => setAddMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                  <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50, minWidth: 190, background: "var(--card)", border: "1px solid var(--border2)", borderRadius: 12, boxShadow: "0 8px 30px rgba(0,0,0,0.18)", padding: 6 }}>
                    <button onClick={() => { setAddMenuOpen(false); setAddMode("deck"); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", boxSizing: "border-box", padding: "9px 12px", background: "none", border: "none", borderRadius: 8, color: "var(--text)", fontSize: 13.5, fontWeight: 500, cursor: "pointer", textAlign: "left" }}><Icon d={ICONS.plus} size={15} /> {t("karten.newDeckItem")}</button>
                    <button onClick={() => { setAddMenuOpen(false); setAddMode("folder"); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", boxSizing: "border-box", padding: "9px 12px", background: "none", border: "none", borderRadius: 8, color: "var(--text)", fontSize: 13.5, fontWeight: 500, cursor: "pointer", textAlign: "left" }}><Icon d={ICONS.plus} size={15} /> {t("karten.newFolderItem")}</button>
                  </div>
                </>)}
              </div>
            )}
            <ImportMenu importItems={[{ label: t("karten.importDeck"), onClick: importDeck }]}
              templateItems={[{ label: t("karten.jsonTemplate"), href: "/beispiel-karten.json" }]} />
          </div>

          {/* Unterordner des aktuellen Ordners */}
          {cardFolders.filter((f) => (f.parent_id ?? null) === currentCardFolder).map((f) => (
            <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", marginBottom: 8, border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)" }}>
              <button onClick={() => setCurrentCardFolder(f.id)} style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", textAlign: "left", minWidth: 0, color: "var(--text)" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                <strong style={{ fontSize: 15 }}>{f.name}</strong>
              </button>
              <button onClick={() => renameFolder(f)} className="icon-btn" style={iconBtn} title={t("common.edit")}><Icon d={ICONS.edit} size={15} /></button>
              <button onClick={() => deleteFolder(f)} className="icon-btn" style={iconBtn} title={t("common.delete")}><Icon d={ICONS.trash} size={15} color={C.danger} /></button>
            </div>
          ))}

          {loadingDecks && !decksLoadedOnce.current ? <Skeleton rows={3} height={60} />
            : (decks.filter((d) => (d.folder_id ?? null) === currentCardFolder).length === 0 && cardFolders.filter((f) => (f.parent_id ?? null) === currentCardFolder).length === 0) ? <Empty title={t("karten.noDecks")} hint={t("karten.noDecksHint")} /> : null}
          {decks.filter((d) => (d.folder_id ?? null) === currentCardFolder).map((d) => <Deck key={d.id} deck={d} t={t} call={call} topics={topics} showTopic={kalenderAktiv} folders={cardFolders} onMove={moveDeck} />)}
          {deckTrash.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <button onClick={() => setShowTrash((v) => !v)} style={{ ...btnSecondary, fontSize: 13 }}>{t("karten.trash")} ({deckTrash.length})</button>
              {showTrash && (
                <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, marginTop: 8, background: "var(--bg3)" }}>
                  <p style={{ fontSize: 12.5, color: "var(--text3)", margin: "0 0 8px" }}>{t("karten.trashHint")}</p>
                  {deckTrash.map((d) => (
                    <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: "1px solid var(--border)" }}>
                      <span style={{ flex: 1, fontWeight: 500 }}>{d.name} <span style={{ fontSize: 12, color: "var(--text3)" }}>· {t("karten.cardCount", { n: d.cards?.length || 0 })}</span></span>
                      <button onClick={() => restoreDeck(d.id)} style={{ ...btnSecondary, padding: "4px 11px", fontSize: 12.5 }}>{t("classes.restore")}</button>
                      <button onClick={() => purgeDeck(d.id)} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("classes.purge")}><Icon d={ICONS.trash} size={14} color={C.danger} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {view === "progress" && (() => {
        const total = progress[0]?.total || 0;
        // Klassen-Reifegrad zeigt nur aktiv gelernte Karten — "Neu" (noch nicht
        // angefasst) bleibt aussen vor, sonst spiegelt der Balken vor allem
        // Wochenansicht: wer hat diese Woche (ab Montag) gelernt, wer noch nie.
        const wochStart = (() => { const d = new Date(); const wd = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - wd); return d.getTime(); })();
        const nStud = progress.length;
        const dieseWoche = progress.filter((p) => p.last_reviewed && new Date(p.last_reviewed).getTime() >= wochStart).length;
        const nieGelernt = progress.filter((p) => !p.last_reviewed).length;
        return (
          <>
            {total === 0 ? (
              <p style={{ fontSize: 13.5, color: "var(--text3)", marginBottom: 16 }}>{t("karten.noRolledOut")}</p>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{t("karten.progress")}</span>
                <span style={{ fontSize: 12.5, padding: "4px 10px", borderRadius: 980, background: "rgba(10,125,62,0.12)", color: C.success, fontWeight: 600 }}>{t("karten.thisWeek")}: {dieseWoche}/{nStud}</span>
                {nieGelernt > 0 && <span style={{ fontSize: 12.5, padding: "4px 10px", borderRadius: 980, background: "var(--bg2)", color: "var(--text3)", fontWeight: 600 }}>{t("karten.neverLearned")}: {nieGelernt}</span>}
                {notenAktiv && <button onClick={() => setNotenDialog(true)} style={{ ...btnSecondary, padding: "5px 12px", marginLeft: "auto" }}>{t("karten.toNoten")}</button>}
              </div>
            )}
            <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 12 }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13.5 }}>
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
                        <button onClick={() => openDetail(p)} style={{ border: "none", background: "none", color: "var(--accent)", cursor: "pointer", fontWeight: 600, fontSize: 13.5, padding: 0, textAlign: "left" }}>{p.name}</button>
                      </td>
                      <td style={{ ...td, textAlign: "left" }}><ReifeBar hist={p.hist} /></td>
                      <td style={td}>{p.reviewed}{total ? ` / ${total}` : ""}</td>
                      <td style={{ ...td, color: p.due ? C.warning : "var(--text3)" }}>{p.due || "—"}</td>
                      <td style={{ ...td, color: "var(--text3)", fontSize: 12.5 }}>{p.last_reviewed ? new Date(p.last_reviewed).toLocaleDateString() : "—"}</td>
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
          <p style={{ fontSize: 13, color: "var(--text3)", marginBottom: 14 }}>{t("karten.qrHint")}</p>
          <button onClick={() => window.print()} style={{ ...btnSecondary, marginBottom: 16 }}>{t("karten.print")}</button>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
            {(tokens || []).map((s) => (
              <div key={s.student_id} style={{ textAlign: "center", border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "#fff" }}>
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
  const [sections, setSections] = useState(null);
  const [sectionId, setSectionId] = useState("");
  const [name, setName] = useState(`${t("karten.masteryColumn")} ${new Date().toLocaleDateString()}`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // term=all: Karten hat keinen Halbjahr-Selektor — sonst waeren im 2. Halbjahr
  // keine Abschnitte waehlbar. Das Halbjahr steht als Label an der Option.
  const kq = `?term=all${kursId != null ? `&kurs_id=${kursId}` : ""}`;
  const secLabel = (s) => `${s.term === "2" ? "2. Hj · " : "1. Hj · "}${s.name}`;

  useEffect(() => {
    fetch(`/api/noten/classes/${classId}/sections${kq}`).then((r) => (r.ok ? r.json() : [])).then((d) => {
      const list = Array.isArray(d) ? d : [];
      setSections(list);
      if (list[0]) setSectionId(String(list[0].id));
    }).catch(() => setSections([]));
  }, [classId, kursId]);

  const grades = progress
    .filter((p) => p.reviewed > 0)
    .map((p) => ({ student_id: p.student_id, value: gradeFromPct(masteryPct(p.hist), scale) }))
    .filter((g) => g.value >= 1 && g.value <= 6);

  const submit = async () => {
    if (!sectionId) { setErr(t("karten.masteryNoSection")); return; }
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
    <div onClick={onClose} style={modalOverlay}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modalPanel, maxWidth: 440 }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{t("karten.toNoten")}</h3>
        <p style={{ fontSize: 12.5, color: "var(--text3)", margin: "0 0 14px" }}>{t("karten.masteryHint", { n: grades.length })}</p>
        {sections && sections.length === 0 ? (
          <p style={{ fontSize: 13, color: C.danger }}>{t("karten.masteryNoSection")}</p>
        ) : (<>
          <div style={{ fontSize: 12.5, color: "var(--text2)", margin: "0 0 5px" }}>{t("karten.masterySection")}</div>
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={{ ...selectStyle, width: "100%" }}>
            {(sections || []).map((s) => <option key={s.id} value={s.id}>{secLabel(s)}</option>)}
          </select>
          <div style={{ fontSize: 12.5, color: "var(--text2)", margin: "12px 0 5px" }}>{t("noten.columnName")}</div>
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...inp, width: "100%" }} />
        </>)}
        {err && <p style={{ color: C.danger, fontSize: 12.5, marginTop: 10 }}>{err}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button onClick={submit} disabled={busy || grades.length === 0 || (sections && sections.length === 0)} style={{ ...btnPrimary, opacity: busy || grades.length === 0 ? 0.6 : 1 }}>{t("common.save")}</button>
          <button onClick={onClose} style={btnSecondary}>{t("common.abort")}</button>
        </div>
      </div>
    </div>
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
    <div onClick={onClose} style={modalOverlay}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modalPanel, maxWidth: 520 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, flex: 1 }}>{student.name}</h3>
          <button onClick={onClose} className="icon-btn" style={iconBtn} title={t("common.close")}><Icon d={ICONS.close} size={16} /></button>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text3)", marginBottom: 16 }}>{student.reviewed} / {student.total} {t("karten.reviewed").toLowerCase()} · {student.due || 0} {t("karten.due").toLowerCase()}</div>
        {rows.length === 0 ? (
          <p style={{ fontSize: 13.5, color: "var(--text3)" }}>{t("karten.noRolledOut")}</p>
        ) : rows.map(([name, s]) => (
          <div key={name} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{name}</span>
              <span style={{ fontSize: 12, color: "var(--text3)" }}>{s.learned} / {s.total} {t("karten.reviewed").toLowerCase()}</span>
            </div>
            <ReifeBar hist={s.hist} height={12} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Deck({ deck, t, call, topics = [], showTopic = false, folders = [], onMove }) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [planDate, setPlanDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [importing, setImporting] = useState(false);
  // LaTeX-Editor: Formel ins zuletzt fokussierte Feld (Vorder-/Rückseite) einfügen.
  const frontRef = useRef(null);
  const backRef = useRef(null);
  const activeField = useRef("front");
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
    const next = before + wrapped + val.slice(end);
    setter(next);
    setTimeout(() => { const pos = start + wrapped.length + (offset || 0); input.focus(); input.setSelectionRange(pos, pos); }, 0);
  };
  // folder_id IMMER mitschicken, sonst nullt ein Speichern (Name/Thema/Niveau)
  // die Ordner-Zuordnung.
  const saveDeck = (patch) => call(() => fetch(`${API}/decks/${deck.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: deck.name, topic_id: deck.topic_id ?? null, niveau: deck.niveau || "", folder_id: deck.folder_id ?? null, ...patch }) }));
  const setTopic = (tid) => saveDeck({ topic_id: tid ? Number(tid) : null });
  const setNiveau = (n) => saveDeck({ niveau: n });
  const exportDeck = () => {
    const data = { type: "nuvora_karten_deck", version: 1, name: deck.name || "", cards: deck.cards.map((c) => ({ front: c.front, back: c.back })) };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = `${(deck.name || "stapel").replace(/[^\w-]+/g, "_")}.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  const topicLabel = (tp) => { const p = tp.parent_id ? topics.find((x) => x.id === tp.parent_id) : null; return p ? `${p.name} / ${tp.name}` : tp.name; };
  const add = async (e) => {
    e.preventDefault();
    if (busy || !front.trim() || !back.trim()) return;
    setBusy(true);
    try {
      if (await call(() => fetch(`${API}/decks/${deck.id}/cards`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ front: front.trim(), back: back.trim() }) }))) { setFront(""); setBack(""); }
    } finally { setBusy(false); }
  };
  const release = (payload) => call(() => fetch(`${API}/decks/${deck.id}/release`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }));

  const now = Date.now();
  const rel = deck.released_at ? new Date(deck.released_at).getTime() : null;
  const status = rel === null ? "entwurf" : rel > now ? "geplant" : "aus";
  const badge = status === "aus" ? { text: t("karten.rolledOut"), bg: "rgba(10,125,62,0.12)", col: C.success }
    : status === "geplant" ? { text: t("karten.plannedFor", { date: new Date(deck.released_at).toLocaleString() }), bg: "rgba(184,134,11,0.12)", col: C.warning }
    : { text: t("karten.draft"), bg: "var(--bg3)", col: "var(--text3)" };

  return (
    <div style={{ marginBottom: 14, border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 16 }}>{deck.name || t("karten.deck")}</strong>
        <span style={{ fontSize: 11.5, fontWeight: 600, padding: "2px 8px", borderRadius: 980, background: badge.bg, color: badge.col }}>{badge.text}</span>
        {showTopic && (
          <select value={deck.topic_id ?? ""} onChange={(e) => setTopic(e.target.value)} title={t("karten.topicHint")}
            style={{ ...selectStyle, fontSize: 12, padding: "4px 28px 4px 9px", maxWidth: 180 }}>
            <option value="">– {t("karten.freeCards")} –</option>
            {topics.map((tp) => <option key={tp.id} value={tp.id}>{topicLabel(tp)}</option>)}
          </select>
        )}
        {/* Niveau-Stapel: "E"/"G" wird automatisch nur an Schueler des jeweiligen
            Niveaus verteilt, "" an alle. Kein manuelles Zuweisen noetig. */}
        <select value={deck.niveau || ""} onChange={(e) => setNiveau(e.target.value)} title={t("karten.niveauHint")}
          style={{ ...selectStyle, fontSize: 12, padding: "4px 28px 4px 9px", maxWidth: 150 }}>
          <option value="">{t("karten.niveauAll")}</option>
          <option value="E">{t("karten.niveauE")}</option>
          <option value="G">{t("karten.niveauG")}</option>
        </select>
        {onMove && folders.length > 0 && (
          <select value={deck.folder_id ?? ""} onChange={(e) => onMove(deck, e.target.value ? Number(e.target.value) : null)} title={t("karten.moveToFolder")}
            style={{ ...selectStyle, fontSize: 12, padding: "4px 28px 4px 9px", maxWidth: 160 }}>
            <option value="">– {t("karten.rootFolder")} –</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12.5, color: "var(--text3)" }}>{deck.cards.length} {t("karten.cards")}</span>
        {deck.cards.length > 0 && (
          <button onClick={exportDeck} className="icon-btn" style={iconBtn} title={t("karten.export")}><Icon d={ICONS.export} size={18} /></button>
        )}
        <button onClick={() => setImporting(true)} className="icon-btn" style={iconBtn} title={t("karten.import")}><Icon d={ICONS.import} size={18} /></button>
        {deck.cards.length > 0 && (
          <button onClick={() => setPublishing(true)} className="icon-btn" style={iconBtn} title={t("karten.publish")}><Icon d={ICONS.share} size={18} color="var(--accent)" /></button>
        )}
        {publishing && <PublishModal name={deck.name || t("karten.deck")} onClose={() => setPublishing(false)}
          onPublish={(description) => fetch(`/api/marketplace/publish/deck`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deck_id: deck.id, description }) }).catch(() => null)} />}
        <button onClick={async () => { if (await askConfirm(t("karten.delDeck", { name: deck.name }))) call(() => fetch(`${API}/decks/${deck.id}`, { method: "DELETE" })); }}
          className="icon-btn" style={iconBtn} title={t("common.delete")}><Icon d={ICONS.trash} color={C.danger} /></button>
      </div>

      {/* Ausrollen: sofort, geplant oder zurueckziehen. Ohne Karten sinnlos. */}
      {deck.cards.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap", fontSize: 13 }}>
          {status !== "aus" && <button onClick={() => release({ now: true })} style={{ ...btnPrimary, padding: "5px 12px" }}>{t("karten.rollOutNow")}</button>}
          {status !== "aus" && (
            <>
              <input type="datetime-local" value={planDate} onChange={(e) => setPlanDate(e.target.value)}
                style={{ ...inp, padding: "5px 8px" }} />
              <button disabled={!planDate} onClick={() => release({ released_at: new Date(planDate).toISOString() })}
                style={{ ...btnSecondary, padding: "5px 12px", opacity: planDate ? 1 : 0.4 }}>{t("karten.plan")}</button>
            </>
          )}
          {status !== "entwurf" && <button onClick={() => release({})} style={{ ...btnSecondary, padding: "5px 12px" }}>{t("karten.withdraw")}</button>}
        </div>
      )}
      {deck.cards.map((c) => (
        <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: "1px solid var(--border)", fontSize: 13.5 }}>
          <span style={{ flex: 1, minWidth: 0 }}><strong><Latex>{c.front}</Latex></strong> <span style={{ color: "var(--text3)" }}>→ <Latex>{c.back}</Latex></span></span>
          <button onClick={() => call(() => fetch(`${API}/cards/${c.id}`, { method: "DELETE" }))} className="icon-btn" style={{ ...iconBtn, padding: 3 }} title={t("common.delete")}><Icon d={ICONS.trash} color={C.danger} size={14} /></button>
        </div>
      ))}
      <form onSubmit={add} style={{ marginTop: 10 }}>
        {/* LaTeX-Schnelltasten: fügen die Formel ins zuletzt fokussierte Feld. */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
          {LATEX_BUTTONS.map((b) => (
            <button key={b.label} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertLatex(b.tex, b.cursor)}
              style={{ padding: "3px 8px", fontSize: 13, border: "1px solid var(--border2)", borderRadius: 6, background: "var(--card)", cursor: "pointer", fontFamily: "serif", color: "var(--text)" }}>{b.label}</button>
          ))}
          <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: 4 }}>{t("karten.latexHint")}</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input ref={frontRef} onFocus={() => (activeField.current = "front")} value={front} onChange={(e) => setFront(e.target.value)} placeholder={t("karten.front")} style={{ flex: 1, minWidth: 120, ...inp }} />
          <input ref={backRef} onFocus={() => (activeField.current = "back")} value={back} onChange={(e) => setBack(e.target.value)} placeholder={t("karten.back")} style={{ flex: 1, minWidth: 120, ...inp }} />
          <button type="submit" disabled={busy || !front.trim() || !back.trim()} style={{ ...btnPrimary, padding: "6px 14px", opacity: (!busy && front.trim() && back.trim()) ? 1 : 0.4 }}>{t("common.add")}</button>
        </div>
        {(front.includes("$") || back.includes("$")) && (
          <div style={{ marginTop: 8, padding: "8px 12px", background: "var(--bg2)", borderRadius: 8, fontSize: 14 }}>
            <Latex>{front}</Latex> <span style={{ color: "var(--text3)" }}>→ <Latex>{back}</Latex></span>
          </div>
        )}
      </form>
      {importing && <ImportModal deckName={deck.name || t("karten.deck")} t={t}
        onClose={() => setImporting(false)}
        onImport={async (cards) => call(() => fetch(`${API}/decks/${deck.id}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cards }) }))} />}
    </div>
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
      return arr.map((c) => ({ front: String(c.front ?? "").trim(), back: String(c.back ?? "").trim() }))
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
    <div onClick={onClose} style={modalOverlay}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modalPanel, maxWidth: 560 }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>{t("karten.importTitle", { name: deckName })}</h3>
        <p style={{ fontSize: 12.5, color: "var(--text3)", margin: "0 0 12px" }}>{t("karten.importHint")}</p>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
          <input type="file" accept=".csv,.tsv,.txt,.json" onChange={onFile} style={{ fontSize: 13 }} />
          <a href="/beispiel-karten.json" download style={{ fontSize: 12.5, color: "var(--accent)" }}>{t("karten.jsonTemplate")}</a>
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={"Vorderseite;Rückseite  (CSV)\noder JSON: { \"cards\": [{ \"front\": \"…\", \"back\": \"$a^2$\" }] }"} rows={8}
          style={{ ...inp, width: "100%", boxSizing: "border-box", fontFamily: "monospace", fontSize: 13, resize: "vertical" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
          <button onClick={doImport} disabled={!parsed.length || busy} style={{ ...btnPrimary, opacity: (parsed.length && !busy) ? 1 : 0.4 }}>
            {busy ? t("karten.importing") : t("karten.importCount", { n: parsed.length })}
          </button>
          <button onClick={onClose} style={btnSecondary}>{t("common.abort")}</button>
        </div>
      </div>
    </div>
  );
}

// Reifegrade fuer das Histogramm — gleiche Staffelung wie in Lernen.jsx.
const REIFE = [
  ["neu", "Neu", "#cbd5e1"],
  ["lernen", "Am Lernen", "#f59e0b"],
  ["kurz", "Kurzfristig", "#eab308"],
  ["mittel", "Mittelfristig", "#84cc16"],
  ["lang", "Langfristig", C.success],
];

// Gestapelter Reifegrad-Balken aus einem hist-Objekt {neu,lernen,...}.
function ReifeBar({ hist, height = 10 }) {
  const total = REIFE.reduce((s, [k]) => s + (hist?.[k] || 0), 0);
  if (!total) return <span style={{ fontSize: 12, color: "var(--text3)" }}>—</span>;
  return (
    <div style={{ display: "flex", height, borderRadius: height / 2, overflow: "hidden", minWidth: 80 }} title={REIFE.map(([k, l]) => `${l}: ${hist[k] || 0}`).join(" · ")}>
      {REIFE.map(([k, , color]) => {
        const n = hist?.[k] || 0;
        return n > 0 ? <div key={k} style={{ width: `${(n / total) * 100}%`, background: color }} /> : null;
      })}
    </div>
  );
}

const inp = { padding: 8, border: "1px solid var(--border2)", borderRadius: 8, fontSize: 14, background: "var(--bg)", color: "var(--text)", boxSizing: "border-box" };
const th = { padding: "8px 10px", borderBottom: "2px solid var(--border)", fontWeight: 600, fontSize: 12, color: "var(--text2)", textAlign: "center" };
const td = { padding: "7px 10px", borderBottom: "1px solid var(--border)", textAlign: "center", color: "var(--text)" };
