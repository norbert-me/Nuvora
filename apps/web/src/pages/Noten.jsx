// Modul Noten: Notenbuch, zweistufig.
//
// ABSCHNITTE (Klassenarbeiten, Sonstige Mitarbeit) tragen das Gewicht; darunter
// liegen SPALTEN (einzelne Arbeiten). Der Gesamtschnitt wird über die Abschnitte
// gewichtet. Ohne Gewichte fällt es auf den ungewichteten Mittelwert zurück —
// so steht nie „kein Schnitt“.
//
// Klick auf einen Namen öffnet alle Infos zur Person. Beobachtungen zählen nie
// in den Schnitt — „Anstrengungsbereitschaft“ ist kein Messwert.
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { askConfirm, showAlert } from "../core/dialog.jsx";
import { undoDelete } from "../core/undo.jsx";
import { Link } from "react-router-dom";
import { swr , lastClass, rememberClass } from "../core/cache.js";
import { Icon, ICONS, iconBtn, toolbarBtn, toolbarBtnPrimary, toolbarIconBtn, toolbarInput, selectStyle, cardStyle, chipStyle, panelStyle, CONTROL_R, SHADOW, COLORS as C, btnPrimary, btnSecondary, Modal as UiModal, popoverPanel, Empty, Skeleton, inputStyle, Popover, Tabs, Toggle, nichtZiehen, dateiWaehlen, thKlebend as thBasis, td as tdBasis } from "../components/Icons.jsx";
import { themenIndex } from "../core/topics.js";
import KursKlasseSelect from "../components/KursKlasseSelect.jsx";
import { MehrMenu } from "../components/Werkzeugleiste.jsx";
import { useAktiv } from "../core/modules.js";
import { datumKurz } from "../core/grades.js";
import { useLanguage } from "../i18n/index.jsx";
import { useUrlClass } from "../core/klassenwahl.js";

const API = "/api/noten";

// Abschnittstitel bleibt im SICHTBAREN Teil seines Abschnitts mittig.
//
// Ein breiter Abschnitt ist beim Scrollen nur zum Teil zu sehen; sein Titel war
// in der ganzen (auch verdeckten) Breite zentriert und rutschte damit aus dem
// Bild — man scrollt durch Spalten und weiss nicht mehr, wo man ist. Reines CSS
// reicht nicht (sticky kennt keine Mitte), also wird die Verschiebung gerechnet:
// Mitte des sichtbaren Ausschnitts minus Mitte der Zelle, begrenzt auf die Zelle.
function StickyMitte({ children, style }) {
  // Der Titel bleibt im sichtbaren Teil seines Abschnitts.
  //
  // Reines CSS, bewusst ohne JS: die erste Fassung rechnete die Verschiebung
  // bei jedem Scroll-Ereignis und schob den Kopf per transform — ein Ziel, das
  // sich unter dem Mauszeiger wegbewegt (und im Browser-Test in einen Timeout
  // lief). `position: sticky` mit left UND right klebt den Inhalt am jeweils
  // sichtbaren Rand der Zelle fest; solange die ganze Zelle zu sehen ist, steht
  // er dank `margin: 0 auto` mittig. `width: max-content` ist noetig, sonst ist
  // das Element so breit wie die Zelle und sticky hat nichts zu tun.
  //
  // `--spalte1` ist die Breite der klebenden Namensspalte: sie liegt UEBER dem
  // Kopf, und ohne diesen Abstand rutscht der Abschnittstitel darunter — dann
  // stand da nur noch „5 % …" ohne Namen.
  return (
    <div style={{ ...style, position: "sticky", left: "calc(var(--spalte1, 0px) + 8px)", right: 8,
      width: "max-content", margin: "0 auto" }}>
      {children}
    </div>
  );
}

// Zeile im Export-Dropdown (Icon + Text, linksbündig).

function parseNote(text) {
  const n = parseFloat(String(text).replace(",", "."));
  if (Number.isNaN(n) || n < 1 || n > 6) return null;
  return Math.round(n * 100) / 100;
}
const de = (n) => (n === null || n === undefined ? "" : String(n).replace(".", ","));

export default function Noten() {
  const { t } = useLanguage();
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState(null);
  const [kursId, setKursId] = useState(null); // Noten hängen am Kurs (Fach)
  // Aus dem Kurs verlinkt (?class=&kurs=): dann diesen Inhalt zeigen.
  useUrlClass(setClassId, setKursId);
  const kp = kursId != null ? `&kurs_id=${kursId}` : "";
  // Teilkurs (Kurse aus Teilen von Klassen): Noten-Zeilen = die Einzel-SuS des
  // Kurses. classId zeigt dann auf die Repräsentant-Klasse (erster SuS) für die
  // FK; kursId = Teilkurs, damit Spalten/Noten sauber am Kurs hängen.
  const [subsetKurs, setSubsetKurs] = useState(null);
  const [subsetKurse, setSubsetKurse] = useState([]);
  const [students, setStudents] = useState([]);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const loadedOnce = useRef(false); // Skeleton nur beim allerersten Laden, nicht bei Reloads
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState([]);
  const [error, setError] = useState("");
  const [zelle, setZelle] = useState(null);
  const [neuAbschnitt, setNeuAbschnitt] = useState(false);
  const [neuSpalteIn, setNeuSpalteIn] = useState(null);
  const [renameCol, setRenameCol] = useState(null);
  const [statsCol, setStatsCol] = useState(null); // Spalte für die zentrale Auswertung
  const [compareCat, setCompareCat] = useState(null); // Spalte für den Klassen-/Zeit-Vergleich
  const [beobFuer, setBeobFuer] = useState(null);
  const [infoFuer, setInfoFuer] = useState(null);
  const [term, setTerm] = useState("1");
  const aktiv = useAktiv();
  const cdAktiv = aktiv("code-detektiv");
  // Auch die Herkunfts-Links sind Bruecken (Regel 3): ohne das Zielmodul fuehrt
  // der Weg ins ModuleGate — der Verweis darf dann gar nicht erst dastehen.
  const cvAktiv = aktiv("cardvote");
  const kartenAktiv = aktiv("karten");
  const [cdDialog, setCdDialog] = useState(false);
  const [topics, setTopics] = useState([]); // Kern-Themen: Spalte einem Thema zuordnen (Nachholbedarf)
  useEffect(() => { fetch("/api/topics").then((r) => (r.ok ? r.json() : [])).then((d) => setTopics(Array.isArray(d) ? d : [])).catch(() => {}); }, []);
  // Wie mehrere Einzelnoten zusammengefasst werden: Mittel oder Median. Merkt
  // sich die Wahl pro Browser. Die Abschnitts-Gewichtung bleibt unberuehrt.
  const [agg, setAgg] = useState(() => { try { return localStorage.getItem("noten_agg") === "median" ? "median" : "mean"; } catch { return "mean"; } });
  const [yearData, setYearData] = useState({ sections: [], rows: [] });
  const [dividers, setDividers] = useState([]); // Quartalsstriche: after_category_id[]
  const [collapsed, setCollapsed] = useState(() => { try { return new Set(JSON.parse(localStorage.getItem("noten_collapsed") || "[]")); } catch { return new Set(); } });
  const toggleCollapse = (secId) => setCollapsed((prev) => {
    const n = new Set(prev);
    n.has(secId) ? n.delete(secId) : n.add(secId);
    localStorage.setItem("noten_collapsed", JSON.stringify([...n]));
    return n;
  });
  const [menuSec, setMenuSec] = useState(null);   // Abschnitt mit offenem Menue
  // Der Kopf hat ZWEI Zeilen (Abschnitte, dann Spalten). Beide kleben; die
  // zweite braucht die Hoehe der ersten als Abstand, sonst liegen sie
  // uebereinander. Gemessen statt geraten: die erste Zeile ist je nach Inhalt
  // unterschiedlich hoch.
  const { rahmenRef, kopf1Ref, th2 } = useKlebenderKopf();
  const [dragId, setDragId] = useState(null);
  // Vorschau beim Ziehen: auf welchem Abschnitt, und links oder rechts einfuegen.
  const [dragOver, setDragOver] = useState(null); // { id, side: "left"|"right" }

  const dragOverHeader = (e, secId) => {
    e.preventDefault();
    if (!dragId || secId === dragId) { setDragOver(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const side = e.clientX < r.left + r.width / 2 ? "left" : "right";
    setDragOver((p) => (p && p.id === secId && p.side === side ? p : { id: secId, side }));
  };

  // Spalten je Abschnitt: gleiche Mechanik wie Abschnitte, nur innerhalb eines
  // Abschnitts. dragCol haelt {catId, secId}, dragColOver die Vorschau.
  const [dragCol, setDragCol] = useState(null);
  const [dragColOver, setDragColOver] = useState(null); // { id, side }
  const dragOverCol = (e, catId, catSecId) => {
    e.preventDefault();
    if (!dragCol || dragCol.secId !== catSecId || catId === dragCol.catId) { setDragColOver(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const side = e.clientX < r.left + r.width / 2 ? "left" : "right";
    setDragColOver((p) => (p && p.id === catId && p.side === side ? p : { id: catId, side }));
  };
  const spalteDrop = async (zielId, sec) => {
    const von = dragCol, ov = dragColOver;
    setDragCol(null); setDragColOver(null);
    if (!von || von.secId !== sec.id || von.catId === zielId) return;
    const alt = sections;
    const cols = (sec.categories || []).map((c) => c.id);
    const from = cols.indexOf(von.catId);
    let to = cols.indexOf(zielId);
    if (from < 0 || to < 0) return;
    if (ov && ov.id === zielId && ov.side === "right") to += 1;
    if (from < to) to -= 1;
    const neuCols = [...(sec.categories || [])];
    neuCols.splice(to, 0, neuCols.splice(from, 1)[0]);
    const neuSections = sections.map((s) => (s.id === sec.id ? { ...s, categories: neuCols } : s));
    setSections(neuSections);
    const res = await fetch(`${API}/sections/${sec.id}/categories/reorder`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: neuCols.map((c) => c.id) }),
    }).catch(() => null);
    if (!res || !res.ok) { setSections(alt); setError(t("noten.reorderFail")); }
  };

  // Abschnitt per Drag & Drop verschieben: optimistisch umsortieren, dann speichern.
  const abschnittDrop = async (zielId) => {
    const von = dragId, ov = dragOver;
    setDragId(null); setDragOver(null);
    if (!von || von === zielId) return;
    const alt = sections;
    const ids = alt.map((s) => s.id);
    const from = ids.indexOf(von);
    let to = ids.indexOf(zielId);
    if (from < 0 || to < 0) return;
    if (ov && ov.id === zielId && ov.side === "right") to += 1;
    if (from < to) to -= 1;  // Entnahme verschiebt den Zielindex
    const neu = [...alt];
    neu.splice(to, 0, neu.splice(from, 1)[0]);
    setSections(neu);
    const res = await fetch(`${API}/classes/${classId}/sections/reorder`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: neu.map((s) => s.id) }),
    }).catch(() => null);
    if (!res || !res.ok) { setSections(alt); setError(t("noten.reorderFail")); }
  };

  // Bereichs-/Endnote manuell setzen oder zuruecksetzen.
  const overrideSetzen = async (studentId, sectionId, text) => {
    const val = parseNote(text);
    setZelle(null);
    if (val === null) return;
    // Optimistisch: Bereichs- bzw. Endnote sofort zeigen (auch offline).
    setSummary((prev) => prev.map((s) => {
      if (s.student_id !== studentId) return s;
      if (sectionId == null) return { ...s, total_override: val };
      return { ...s, section_overrides: { ...s.section_overrides, [String(sectionId)]: val },
               section_effective: { ...s.section_effective, [String(sectionId)]: val } };
    }));
    const ok = await call(() => fetch(`${API}/overrides`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ class_id: classId, kurs_id: kursId, student_id: studentId, section_id: sectionId, term, value: val }),
    }));
    if (ok === false) load(classId);
  };
  const overrideReset = async (studentId, sectionId) => {
    const q = new URLSearchParams({ class_id: classId, student_id: studentId, term, ...(kursId != null ? { kurs_id: kursId } : {}) });
    if (sectionId != null) q.set("section_id", sectionId);
    await call(() => fetch(`${API}/overrides?${q}`, { method: "DELETE" }));
  };

  useEffect(() => {
    return swr("classes", "/api/classes", (d) => {
      const list = Array.isArray(d) ? d : [];
      setClasses(list);
      if (list.length && classId === null) { const w = lastClass(); setClassId(list.some((c) => c.id === w) ? w : list[0].id); }
    });
  }, []);

  useEffect(() => { if (classId) rememberClass(classId); }, [classId]);

  // Teilkurse (nur solche mit einzeln hinzugefügten SuS) für die Auswahl.
  useEffect(() => {
    fetch("/api/kurse").then((r) => (r.ok ? r.json() : [])).then((d) => {
      setSubsetKurse((Array.isArray(d) ? d : []).filter((k) => (k.member_count || 0) > 0));
    }).catch(() => {});
  }, []);

  // Noten-Zeilen kommen aus dem KURS (dedupliziert), nicht aus der Fach-Klasse.
  // Beim Teilkurs aus der Kurs-Route (enthält auch die Einzel-SuS fremder Klassen).
  const loadRoster = (id) => {
    const url = subsetKurs ? `${API}/noten/kurse/${subsetKurs}/students` : `${API}/classes/${id}/students`;
    return fetch(url).then((r) => (r.ok ? r.json() : [])).then((d) => setStudents(Array.isArray(d) ? d : [])).catch(() => {});
  };
  const load = async (id) => {
    if (!id) return;
    setLoading(true);
    loadRoster(id);
    if (term === "year") {
      const y = await fetch(`${API}/classes/${id}/year?agg=${agg}${kp}`).then((r) => (r.ok ? r.json() : { sections: [], rows: [] }));
      setYearData(y); setLoading(false);
      return;
    }
    const [sec, ent, sum] = await Promise.all([
      fetch(`${API}/classes/${id}/sections?term=${term}${kp}`).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API}/classes/${id}/entries?x=1${kp}`).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API}/classes/${id}/summary?term=${term}&agg=${agg}${kp}`).then((r) => (r.ok ? r.json() : [])),
    ]);
    setSections(sec); setEntries(ent); setSummary(sum); setLoading(false);
    loadedOnce.current = true; // ab jetzt kein Skeleton mehr (Reloads z.B. bei Median/Mittel nicht flackern lassen)
    fetch(`${API}/classes/${id}/dividers?term=${term}${kp}`).then((r) => (r.ok ? r.json() : [])).then((d) => setDividers(Array.isArray(d) ? d : [])).catch(() => {});
  };
  const toggleDivider = async (catId) => {
    const r = await fetch(`${API}/classes/${classId}/dividers/toggle?term=${term}${kp}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ after_category_id: catId }),
    }).catch(() => null);
    if (r && r.ok) setDividers(await r.json());
  };
  useEffect(() => { if (classId) load(classId); }, [classId, kursId, subsetKurs, classes, term, agg]);
  const setAggPersist = (m) => { setAgg(m); try { localStorage.setItem("noten_agg", m); } catch { /* egal */ } };

  const doExport = async () => {
    if (!classId) return;
    // Export als ZIP: Daten (JSON, re-importierbar) + Zeugnis-PDF gebündelt.
    const r = await fetch(`${API}/classes/${classId}/export.zip?term=${term}&agg=${agg}${kp}`).catch(() => null);
    if (!r || !r.ok) return;
    const blob = await r.blob(); const cls = classes.find((c) => c.id === classId);
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `noten-${(cls?.name || "klasse")}-hj${term}.zip`; a.click(); URL.revokeObjectURL(a.href);
  };
  const doExportJson = async () => {
    if (!classId) return;
    const r = await fetch(`${API}/classes/${classId}/export?term=${term}${kp}`).catch(() => null);
    if (!r || !r.ok) return;
    const blob = await r.blob(); const cls = classes.find((c) => c.id === classId);
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `noten-${(cls?.name || "klasse")}-hj${term}.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  const doZeugnis = async () => {
    if (!classId) return;
    const r = await fetch(`${API}/classes/${classId}/zeugnis.pdf?term=${term}&agg=${agg}${kp}`).catch(() => null);
    if (!r || !r.ok) return;
    const blob = await r.blob(); const cls = classes.find((c) => c.id === classId);
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `Zeugnis_${(cls?.name || "klasse")}_hj${term}.pdf`; a.click(); URL.revokeObjectURL(a.href);
  };
  const doZeugnisStudent = async (sid) => {
    if (!classId || !sid) return;
    const r = await fetch(`${API}/classes/${classId}/zeugnis.pdf?term=${term}&agg=${agg}&student_id=${sid}${kp}`).catch(() => null);
    if (!r || !r.ok) return;
    const blob = await r.blob(); const st = students.find((x) => x.id === sid);
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `Zeugnis_${(st?.name || "schueler").replace(/[^\w-]+/g, "_")}_hj${term}.pdf`; a.click(); URL.revokeObjectURL(a.href);
  };
  const doImport = async (file) => {
    if (!classId) return;
    setError("");
    try {
      const data = JSON.parse(await file.text());
      const r = await fetch(`${API}/classes/${classId}/import?term=${term}${kp}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (r.ok) load(classId); else setError(t("noten.importError"));
    } catch { setError(t("noten.importError")); }
  };

  const call = async (fn) => {
    setError("");
    const res = await fn().catch(() => null);
    if (!res) { setError(t("common.notWork")); return false; }
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(typeof b.detail === "string" ? b.detail : t("common.notWork"));
      return false;
    }
    // Offline gepuffert (X-Nuvora-Queued): NICHT neu laden — der Reload würde
    // offline scheitern/veralten und die optimistische Anzeige zurücksetzen.
    const queued = res.headers && res.headers.get("X-Nuvora-Queued");
    if (!queued) await load(classId);
    return queued ? "queued" : true;
  };

  // Anlegen (Abschnitt/Spalte): online frisch laden; offline (X-Nuvora-Queued)
  // die zurueckgegebene Behelfs-ID optimistisch einfuegen (insert(id)), damit
  // das neue Element sofort da ist. Beim Sync wird die Behelfs-ID umgehaengt.
  const callCreate = async (fn, insert) => {
    setError("");
    const res = await fn().catch(() => null);
    if (!res || !res.ok) { setError(t("common.notWork")); return false; }
    const j = await res.json().catch(() => ({}));
    if (res.headers && res.headers.get("X-Nuvora-Queued")) insert(j.id);
    else await load(classId);
    return true;
  };

  // Nachholbedarf aus einer themen-getaggten Klassenarbeit: schwache SuS →
  // deren Karten des Themas wieder fällig setzen (im Üben tauchen sie erneut auf).
  const runNachhol = async (cat) => {
    const res = await fetch(`${API}/categories/${cat.id}/nachholbedarf`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threshold: 4.0 }),
    }).catch(() => null);
    if (!res || !res.ok) { const b = res ? await res.json().catch(() => ({})) : {}; showAlert(typeof b.detail === "string" ? b.detail : t("common.notWork")); return; }
    const j = await res.json();
    showAlert(t("noten.nachholDone", { weak: j.weak, cards: j.cards_requeued }));
  };

  // Tab springt zur naechsten Zelle rechts (Shift+Tab nach links), am Zeilenende
  // in die naechste Zeile. Ohne das endete jede Eingabe in einem Mausklick: der
  // Browser gibt den Fokus zwar weiter, aber die Zelle daneben ist ein Knopf und
  // kein Eingabefeld — man tippt ins Leere.
  const zellFolge = () => {
    const cats = sections.filter((sec) => !collapsed.has(sec.id))
      .flatMap((sec) => (sec.categories || []).map((c) => c.id));
    return { cats, kinder: (summary || []).map((s) => s.student_id) };
  };
  const nachbar = (studentId, catId, rueckwaerts) => {
    const { cats, kinder } = zellFolge();
    const sp = cats.indexOf(catId), ze = kinder.indexOf(studentId);
    if (sp < 0 || ze < 0) return null;
    // Am Zeilenende ist Schluss — KEIN stiller Sprung in die naechste Zeile.
    // Genau das hat Noten in falsche Spalten gebracht: man tippt weiter und
    // merkt erst beim Neuladen, dass man ein Kind tiefer war.
    const nsp = sp + (rueckwaerts ? -1 : 1);
    if (nsp < 0 || nsp >= cats.length) return null;
    return `${kinder[ze]}:${cats[nsp]}`;
  };
  /** Dieselbe Spalte, naechstes Kind — so arbeitet man eine Spalte ab (Enter). */
  const darunter = (studentId, catId, hoch) => {
    const { cats, kinder } = zellFolge();
    const sp = cats.indexOf(catId), ze = kinder.indexOf(studentId);
    if (sp < 0 || ze < 0) return null;
    const nze = ze + (hoch ? -1 : 1);
    if (nze < 0 || nze >= kinder.length) return null;
    return `${kinder[nze]}:${cats[sp]}`;
  };

  const noteSetzen = async (studentId, catId, text) => {
    setZelle(null);
    const wert = parseNote(text);
    // Feld leer geraeumt = Note loeschen. Vorher blieb die alte Note stehen —
    // ein Vertipper liess sich nur ueber Umwege wieder loswerden.
    if (wert === null) {
      if (String(text).trim() !== "") return;      // unlesbare Eingabe: nichts anfassen
      const alt = notenVon(studentId, catId)[0];
      if (!alt?.id) return;
      setSummary((prev) => prev.map((s) => {
        if (s.student_id !== studentId) return s;
        const rest = { ...s.per_category };
        delete rest[String(catId)];
        return { ...s, per_category: rest };
      }));
      setEntries((prev) => prev.filter((e) => e.id !== alt.id));
      const ok = await call(() => fetch(`${API}/entries/${alt.id}`, { method: "DELETE" }));
      if (ok) load(classId);
      return;
    }
    // Optimistisch lokal setzen, damit die Note auch offline sofort steht.
    setSummary((prev) => prev.map((s) => s.student_id === studentId
      ? { ...s, per_category: { ...s.per_category, [String(catId)]: wert } } : s));
    setEntries((prev) => [...prev.filter((e) => !(e.student_id === studentId && e.category_id === catId && e.kind === "grade")),
      { student_id: studentId, category_id: catId, kind: "grade", value: wert }]);
    const ok = await call(() => fetch(`${API}/entries`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category_id: catId, student_id: studentId, kind: "grade", value: wert, note: "" }),
    }));
    if (ok === false) load(classId); // echter Server-Fehler: Wahrheit zurückholen
  };

  // Kommentar an einer Zelle: „Formel vergessen", „krank, nachgeschrieben".
  // Er zaehlt nie in einen Schnitt — gerechnet wird die Note, der Text steht
  // daneben. (Das frühere Modul „Beobachtungen" lag neben dem Notenbuch; jetzt
  // haengt die Bemerkung an der Zelle, zu der sie gehoert.)
  const [kommentarFuer, setKommentarFuer] = useState(null);   // {sid, cid, text}
  const kommentarVon = (sid, cid) => (notenVon(sid, cid)[0]?.note || "");
  const kommentarSetzen = async (sid, cid, text) => {
    setKommentarFuer(null);
    setEntries((prev) => {
      const rest = prev.filter((e) => !(e.student_id === sid && e.category_id === cid && e.kind === "grade"));
      const alt = prev.find((e) => e.student_id === sid && e.category_id === cid && e.kind === "grade");
      if (!text.trim() && (!alt || alt.value == null)) return rest;
      return [...rest, { ...(alt || { student_id: sid, category_id: cid, kind: "grade", value: null }), note: text.trim() }];
    });
    const ok = await call(() => fetch(`${API}/entries/comment`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category_id: cid, student_id: sid, text }),
    }));
    if (ok !== false) load(classId);
  };

  const allCats = sections.flatMap((s) => s.categories || []);
  const gewichtSumme = sections.reduce((n, s) => n + (s.weight || 0), 0);
  const notenVon = (sid, cid) => entries.filter((e) => e.student_id === sid && e.category_id === cid && e.kind === "grade");
  // Auswertung je Spalte: Anzahl, Schnitt, Spanne über alle eingetragenen Noten.
  const colStats = (cid) => {
    const vals = entries.filter((e) => e.category_id === cid && e.kind === "grade" && e.value != null).map((e) => e.value).sort((a, b) => a - b);
    if (!vals.length) return null;
    const n = vals.length;
    const median = n % 2 ? vals[(n - 1) / 2] : (vals[n / 2 - 1] + vals[n / 2]) / 2;
    // Verteilung auf ganze Notenstufen 1–6 (2,3 zählt zu 2).
    const dist = [1, 2, 3, 4, 5, 6].map((g) => ({ g, n: vals.filter((v) => Math.floor(v) === g).length }));
    return { n, avg: Math.round((vals.reduce((a, b) => a + b, 0) / n) * 100) / 100, median: Math.round(median * 100) / 100, min: vals[0], max: vals[n - 1], dist };
  };
  const sumOf = (studentId) => summary.find((s) => s.student_id === studentId);

  // Spalten des Halbjahres in chronologischer Reihenfolge (Abschnitt, dann
  // Spalte). Grundlage fuer den Trend je SuS.
  const orderedCatIds = sections
    .flatMap((sec) => (sec.categories || []).map((c) => ({ id: c.id, sp: sec.position ?? 0, cp: c.position ?? 0 })))
    .sort((a, b) => a.sp - b.sp || a.cp - b.cp)
    .map((c) => c.id);
  // Trend je SuS: Ausgleichsgerade ueber die Notenfolge. Note niedriger = besser,
  // also Steigung < 0 = Leistung steigt. Erst ab 3 Noten aussagekraeftig.
  const trendFor = (sid) => {
    const seq = orderedCatIds
      .map((cid) => { const es = notenVon(sid, cid).filter((e) => e.value != null); return es.length ? es[es.length - 1].value : null; })
      .filter((v) => v != null);
    if (seq.length < 3) return null;
    const n = seq.length, mx = (n - 1) / 2, my = seq.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    seq.forEach((v, i) => { num += (i - mx) * (v - my); den += (i - mx) ** 2; });
    const slope = den ? num / den : 0;
    if (slope <= -0.15) return "up";     // Leistung verbessert sich
    if (slope >= 0.15) return "down";    // Leistung verschlechtert sich
    return "flat";
  };

  if (classes.length === 0) {
    return (
      <div style={{ maxWidth: 700 }}>
        <p style={{ color: "var(--text2)", fontSize: 14 }}>
          {t("noten.needClass").split("{{link}}")[0]}
          <Link to="/classes" style={{ color: "var(--accent)" }}>{t("nav.classes")}</Link>
          {t("noten.needClass").split("{{link}}")[1]}
        </p>
      </div>
    );
  }

  const cls = classes.find((c) => c.id === classId);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <label data-tour="noten-class" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text2)" }}>
          {t("nav.classes")}
          <KursKlasseSelect value={subsetKurs ? null : classId} onChange={(id, kid) => { setSubsetKurs(null); setClassId(id); setKursId(kid); }} onKurs={(k) => { if (!subsetKurs) setKursId(k); }} />
        </label>
        {subsetKurse.length > 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text2)" }}>
            {t("noten.teilkurs")}
            <select value={subsetKurs || ""} style={selectStyle}
              onChange={async (e) => {
                const kid = e.target.value ? Number(e.target.value) : null;
                if (!kid) { setSubsetKurs(null); return; }
                // Repräsentant-Klasse (erster SuS) für die FK bestimmen.
                const list = await fetch(`${API}/noten/kurse/${kid}/students`).then((r) => (r.ok ? r.json() : [])).catch(() => []);
                const rep = Array.isArray(list) && list.length ? list[0].class_id : null;
                if (!rep) return;
                setSubsetKurs(kid); setClassId(rep); setKursId(kid);
              }}>
              <option value="">{t("noten.teilkursNone")}</option>
              {subsetKurse.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </label>
        )}
        {/* Kurze Beschriftungen („1. HJ"), damit die ganze Leiste in EINE Zeile
            passt — sonst rutschen Plus und Mehr in eine zweite. Die lange Form
            steht im title. Beide Umschalter kommen aus `Tabs` (Icons.jsx):
            gleiche Hoehe, gleiche Form wie alles andere in der Leiste. */}
        <span title={t("noten.term")}>
          <Tabs value={term} onChange={setTerm}
            options={[["1", t("noten.term1Short")], ["2", t("noten.term2Short")], ["year", t("noten.year")]]} />
        </span>
        <span title={t("noten.aggHint")}>
          <Tabs value={agg} onChange={setAggPersist}
            options={[["mean", t("noten.aggMean")], ["median", t("noten.aggMedian")]]} />
        </span>
        {/* Sichtbar bleibt der Handgriff, den man staendig braucht: ein neuer
            Abschnitt. Export, Zeugnis, Import und die Code-Detektiv-Uebernahme
            stehen im Mehr-Menue — dieselbe Stelle wie auf jeder anderen Seite
            (components/Werkzeugleiste.jsx). Statt zweier eigener Klappmenues
            nebeneinander gibt es jetzt eins. */}
        {term !== "year" && classId && (
          <div style={{ display: "flex", gap: 8, marginLeft: "auto", alignItems: "center" }}>
            <button data-tour="noten-add" onClick={() => setNeuAbschnitt(true)} title={t("noten.addSection")} aria-label={t("noten.addSection")}
              className="icon-btn"
              style={toolbarIconBtn}>
              <Icon d={ICONS.plus} size={20} color="var(--accent)" />
            </button>
            <MehrMenu eintraege={[
              { key: "bundle", label: t("noten.exportBundle"), icon: ICONS.export, onClick: doExport },
              { key: "daten", label: t("noten.exportData"), icon: ICONS.export, onClick: doExportJson },
              { key: "zeugnis", label: t("noten.zeugnis"), icon: ICONS.pdf || ICONS.export, onClick: doZeugnis },
              { key: "import", label: t("noten.import"), icon: ICONS.import, onClick: () => dateiWaehlen(doImport) },
              (cdAktiv && sections.length > 0)
                && { key: "cd", label: t("noten.fromCd"), icon: ICONS.chart, onClick: () => setCdDialog(true) },
            ]} />
          </div>
        )}
      </div>

      {error && <p style={{ color: C.danger, fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {neuAbschnitt && (
        <Modal title={t("noten.addSection")} onClose={() => setNeuAbschnitt(false)}>
          <SectionForm t={t} onCancel={() => setNeuAbschnitt(false)}
            onSave={async (b) => { if (await callCreate(
              () => fetch(`${API}/classes/${classId}/sections?term=${term}${kp}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...b, position: sections.length }) }),
              (id) => setSections((prev) => [...prev, { id, name: b.name, weight: b.weight || 0, position: sections.length, term, class_id: classId, kurs_id: kursId, categories: [] }]),
            )) setNeuAbschnitt(false); }} />
        </Modal>
      )}

      {compareCat && <CompareModal t={t} cat={compareCat} onClose={() => setCompareCat(null)} />}

      {cdDialog && (
        <Modal title={t("noten.fromCd")} onClose={() => setCdDialog(false)}>
          <CodeSessionImport t={t} classId={classId} kursId={kursId} sections={sections}
            onClose={() => setCdDialog(false)} onDone={() => { setCdDialog(false); load(classId); }} />
        </Modal>
      )}

      {statsCol && (() => {
        const st = colStats(statsCol.id);
        const de1 = (n) => String(Math.round(n * 100) / 100).replace(".", ",");
        const maxN = st ? Math.max(...st.dist.map((d) => d.n), 1) : 1;
        return (
          <Modal title={t("noten.colStatsTitle", { name: statsCol.name })} onClose={() => setStatsCol(null)}>
            {!st ? <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("noten.colNoGrades")}</p> : (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 16 }}>
                  {[[t("noten.colAvg"), de1(st.avg)], [t("noten.colMedian"), de1(st.median)], [t("noten.colBest"), de1(st.min)], [t("noten.colWorst"), de1(st.max)]].map(([lbl, val], i) => (
                    <div key={i} style={{ padding: "10px 12px", borderRadius: CONTROL_R, background: "var(--bg2)" }}>
                      <div style={{ fontSize: 12, color: "var(--text3)" }}>{lbl}</div>
                      {val !== "" && <div style={{ fontSize: 22, fontWeight: 800 }}>{val}</div>}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text3)", marginBottom: 8 }}>{t("noten.colDist")}</div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 100 }}>
                  {st.dist.map((d) => (
                    <div key={d.g} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                      <div style={{ fontSize: 11, color: "var(--text3)" }}>{d.n || ""}</div>
                      {/* Saeule: Radius rundet nur die Kappe der Grafik. */}
                      <div style={{ width: "100%", height: `${(d.n / maxN) * 70}px`, minHeight: d.n ? 3 : 0, background: "var(--accent)", borderRadius: 4 }} />
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{d.g}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Modal>
        );
      })()}

      {neuSpalteIn != null && (() => {
        const sec = sections.find((s) => s.id === neuSpalteIn);
        const pos = (sec?.categories || []).length;
        return (
          <Modal title={t("noten.addColumn")} onClose={() => setNeuSpalteIn(null)}>
            <ColForm t={t} onCancel={() => setNeuSpalteIn(null)} vorschlag={t("noten.colDefault", { n: pos + 1 })}
              onSave={async (name, datum) => { if (await callCreate(
                () => fetch(`${API}/categories`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, section_id: neuSpalteIn, position: pos, date: datum }) }),
                (id) => setSections((prev) => prev.map((s) => s.id === neuSpalteIn ? { ...s, categories: [...(s.categories || []), { id, name, section_id: neuSpalteIn, position: pos, date: datum }] } : s)),
              )) setNeuSpalteIn(null); }} />
          </Modal>
        );
      })()}

      {term === "year"
        ? (yearData.rows || []).length > 0 && <NotenStatistik noten={(yearData.rows || []).map((r) => (r.year_override != null ? r.year_override : r.year))} t={t} />
        : sections.length > 0 && <NotenStatistik noten={(summary || []).map((s) => (s.total_override != null ? s.total_override : s.weighted))} t={t} />}

      {loading && !loadedOnce.current && term !== "year" ? (
        <Skeleton rows={6} height={38} />
      ) : term === "year" ? (
        <YearTable t={t} data={yearData} cls={cls}
          onSet={(sid, txt) => overrideSetzen(sid, null, txt)}
          onReset={(sid) => overrideReset(sid, null)}
          editing={zelle} setEditing={setZelle} onInfo={setInfoFuer} />
      ) : sections.length === 0 ? (
        // Noch keine Abschnitte: nur der Hinweis, NICHT die SuS-Liste (die kommt
        // erst mit einer Bewertungsstruktur — eine nackte Namensliste ohne Spalten
        // verwirrt mehr als sie hilft).
        <div style={{ marginBottom: 16 }}><Empty title={t("noten.noSections")} hint={t("noten.noSectionsHint")} /></div>
      ) : (
        // Eigener Scrollrahmen statt Seiten-Scroll: nur so kann der Kopf
        // wirklich stehen bleiben (ein Vorfahre mit overflow ist der Bezug fuer
        // `position: sticky`, und dieser Rahmen scrollt ohnehin waagerecht).
        // --tabellenkopf-top: 0 heisst „kleb am Rahmen, nicht unter der Navbar";
        // --kopf2 ist die gemessene Hoehe der ersten Kopfzeile, damit die zweite
        // darunter einrastet statt darauf.
        <div ref={rahmenRef} style={{ overflow: "auto", maxHeight: "calc(100vh - 210px)", border: "1px solid var(--border)", borderRadius: panelStyle.borderRadius, WebkitOverflowScrolling: "touch",
          "--tabellenkopf-top": "0px" }}>
          {/* borderCollapse: separate — mit „collapse" gehoeren die Rahmen der
              Tabelle, nicht den Zellen, und ein `position: sticky` an einer
              Kopfzelle bleibt in Chrome wirkungslos: der Kopf scrollte trotz
              aller Angaben weg. */}
          <table style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: 14, minWidth: "100%" }}>
            <thead>
              <tr ref={kopf1Ref}>
                <th style={{ ...th, ...stickyLh, whiteSpace: "nowrap", textAlign: "left", fontWeight: 400, fontSize: 13, color: gewichtSumme === 100 ? "var(--text3)" : C.warning }}>
                  {gewichtSumme !== 100 ? t("noten.weightNot100", { n: gewichtSumme }) : t("noten.weightSum", { n: gewichtSumme })}
                </th>
                {sections.map((sec) => {
                  const isCol = collapsed.has(sec.id);
                  const cols = isCol ? 0 : (sec.categories || []).length || 1;
                  const over = dragId && dragOver && dragOver.id === sec.id;
                  return (
                    <th key={sec.id} colSpan={cols + 1}
                      draggable
                      onDragStart={(e) => { if (nichtZiehen(e)) return; setDragId(sec.id); }}
                      onDragOver={(e) => dragOverHeader(e, sec.id)}
                      onDragEnd={() => { setDragId(null); setDragOver(null); }}
                      onDrop={() => abschnittDrop(sec.id)}
                      style={{ ...th, borderLeft: over && dragOver.side === "left" ? "3px solid var(--accent)" : "2px solid var(--border3)",
                        borderRight: over && dragOver.side === "right" ? "3px solid var(--accent)" : undefined,
                        cursor: "grab", opacity: dragId === sec.id ? 0.4 : 1,
                        zIndex: menuSec === sec.id ? 6 : th.zIndex }}>
                      <StickyMitte style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                        <span title={t("noten.dragHint")} style={{ display: "inline-flex", color: "var(--text3)" }}><Icon d={ICONS.grip} size={14} /></span>
                        <button onClick={() => toggleCollapse(sec.id)} className="icon-btn" style={{ ...iconBtn, padding: 1 }} title={isCol ? t("noten.expand") : t("noten.collapse")}>
                          <Icon d={isCol ? ICONS.plus : ICONS.minus} size={14} />
                        </button>
                        <span>{sec.name}</span>
                        <span style={{ color: "var(--text3)", fontWeight: 400 }}>{sec.weight} %</span>
                        <SectionMenu t={t} sec={sec}
                          onOpen={(auf) => setMenuSec(auf ? sec.id : null)}
                          onEdit={(b) => call(() => fetch(`${API}/sections/${sec.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }))}
                          onDelete={async () => { if (await askConfirm(t("noten.delSection", { name: sec.name }))) call(() => fetch(`${API}/sections/${sec.id}`, { method: "DELETE" })); }}
                          onAddCol={() => setNeuSpalteIn(sec.id)} />
                      </StickyMitte>
                    </th>
                  );
                })}
                <th rowSpan={2} style={{ ...th, borderLeft: "2px solid var(--border3)" }}>{t("noten.total")}</th>
                <th rowSpan={2} style={{ ...th, minWidth: 40 }} title={t("noten.obsTitle")}>{t("noten.obs")}</th>
              </tr>
              <tr>
                <th style={{ ...th2, ...stickyLh, textAlign: "left" }}>{cls?.name}</th>
                {sections.map((sec) => {
                  const cols = sec.categories || [];
                  const bereich = (
                    <th key={`sn-${sec.id}`} style={{ ...th2, borderLeft: collapsed.has(sec.id) ? "2px solid var(--border3)" : undefined, borderRight: "2px solid var(--border3)", fontWeight: 500, minWidth: 56 }} title={t("noten.sectionGradeHint")}>
                      {t("noten.sectionGrade")}
                    </th>
                  );
                  if (collapsed.has(sec.id)) return [bereich];
                  if (cols.length === 0) {
                    return [
                      <th key={`empty-${sec.id}`} style={{ ...th2, borderLeft: "2px solid var(--border3)", fontWeight: 400 }}>
                        {/* Spalte anlegen laeuft ueber das Kebab-Menue des
                            Abschnitts; ein zweiter +Spalte-Knopf war doppelt. */}
                        <span style={{ color: "var(--text3)", fontSize: 12 }}>{t("noten.noColumns")}</span>
                      </th>,
                      bereich,
                    ];
                  }
                  return [
                    ...cols.map((c, i) => {
                    const colOver = dragCol && dragColOver && dragColOver.id === c.id ? dragColOver.side : null;
                    return (
                    <th key={c.id}
                      draggable
                      onDragStart={(e) => { if (nichtZiehen(e)) return; setDragCol({ catId: c.id, secId: sec.id }); }}
                      onDragOver={(e) => dragOverCol(e, c.id, sec.id)}
                      onDrop={() => spalteDrop(c.id, sec)}
                      onDragEnd={() => { setDragCol(null); setDragColOver(null); }}
                      style={{ ...th2, padding: 0, borderLeft: i === 0 ? "2px solid var(--border3)" : "1px solid var(--border)", minWidth: 70, fontWeight: 500,
                        cursor: "grab", opacity: dragCol && dragCol.catId === c.id ? 0.4 : 1,
                        borderRight: dividers.includes(c.id) ? "3px solid var(--accent)" : undefined,
                        boxShadow: colOver === "left" ? "inset 3px 0 0 var(--accent)" : colOver === "right" ? "inset -3px 0 0 var(--accent)" : undefined }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 3, justifyContent: "center", position: "relative" }}>
                        <button onClick={() => setRenameCol(renameCol === c.id ? null : c.id)} title={t("noten.colOverview")}
                          style={{ width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", border: "none", background: "none", cursor: "pointer", color: "var(--text2)", fontWeight: 500, fontSize: 12, padding: "8px 6px" }}>{c.name}</button>
                        {c.source_session_id && cvAktiv ? (
                          <Link to={`/cardvote/evaluation/${c.source_session_id}`} title={t("noten.fromCardvote")} onClick={(e) => e.stopPropagation()}
                            style={{ display: "inline-flex", color: "var(--accent)", padding: "0 2px" }}>
                            <Icon d={ICONS.chart} size={13} />
                          </Link>
                        ) : c.source_kind === "karten" && kartenAktiv ? (
                          <Link to={`/karten?tab=progress&class=${classId}`} title={t("noten.fromKarten")} onClick={(e) => e.stopPropagation()}
                            style={{ display: "inline-flex", color: C.success, padding: "0 2px" }}>
                            <Icon d={ICONS.chart} size={13} />
                          </Link>
                        ) : c.source_kind === "codedetektiv" ? (
                          <span title={t("noten.fromCd")} style={{ display: "inline-flex", color: "var(--text3)", padding: "0 2px" }}>
                            <Icon d={ICONS.chart} size={13} />
                          </span>
                        ) : null}
                        {renameCol === c.id && (
                          <ColMenu t={t} cat={c} classId={classId} topics={topics} kartenAktiv={kartenAktiv} cvAktiv={cvAktiv} onNachhol={runNachhol} onCompare={setCompareCat} onStats={() => setStatsCol(c)} dividerOn={dividers.includes(c.id)} onToggleDivider={() => toggleDivider(c.id)}
                            onRename={async (name, topicId, datum) => { if (await call(() => fetch(`${API}/categories/${c.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, section_id: sec.id, position: c.position ?? i, topic_id: topicId, date: datum }) }))) setRenameCol(null); }}
                            onDelete={() => {
                              setRenameCol(null);
                              // Spalte sofort raus, 5 s Undo; erst dann Server-Delete.
                              setSections((prev) => prev.map((x) => ({ ...x, categories: (x.categories || []).filter((cc) => cc.id !== c.id) })));
                              undoDelete({ message: t("undo.deleted", { name: c.name }), undo: () => load(classId), commit: async () => { await fetch(`${API}/categories/${c.id}`, { method: "DELETE" }).catch(() => {}); load(classId); } });
                            }}
                            onClose={() => setRenameCol(null)} />
                        )}
                      </div>
                    </th>
                    ); }),
                    bereich,
                  ];
                })}
              </tr>
            </thead>
            <tbody>
              {summary.map((s, si) => (
                <tr key={s.student_id}>
                  <td style={{ ...td, ...stickyL, textAlign: "left", padding: 0 }}>
                    <button onClick={() => setInfoFuer(s.student_id)} title={t("noten.studentInfo")}
                      style={{ width: "100%", textAlign: "left", padding: "6px 8px", border: "none", background: "none", color: "var(--text)", fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}>
                      {/* Nummer in fester Breite, rechtsbuendig: sonst faengt
                          „10. Jamiro" weiter rechts an als „7. Selina" und die
                          Namensspalte franst aus. */}
                      <span style={{ display: "inline-block", width: 26, textAlign: "right", color: "var(--text3)", fontWeight: 400, marginRight: 8, fontVariantNumeric: "tabular-nums" }}>{si + 1}.</span>{s.name}
                      {/* Zeile mit Kommentaren: ein Punkt genuegt — die Zelle
                          selbst zeigt, wo er sitzt. */}
                      {entries.some((e) => e.student_id === s.student_id && e.kind === "grade" && (e.note || "").trim()) && (
                        /* Punkt: Radius = halbe Kante, reine Grafik. */
                        <span title={t("noten.commentRow")} style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: C.warning, marginLeft: 8, verticalAlign: "middle" }} />
                      )}
                      {(() => { const tr = trendFor(s.student_id); return tr && tr !== "flat" ? (
                        <span title={t(tr === "up" ? "noten.trendUp" : "noten.trendDown")}
                          style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, color: tr === "up" ? C.success : C.danger }}>
                          <Icon d={ICONS.open} size={11} style={{ transform: tr === "up" ? "rotate(-90deg)" : "rotate(90deg)" }} />
                        </span>
                      ) : null; })()}
                    </button>
                  </td>
                  {sections.map((sec) => {
                    const cols = sec.categories || [];
                    const bereichTd = (
                      <td key={`sn-${sec.id}`} style={{ ...td, padding: 0, borderLeft: collapsed.has(sec.id) ? "2px solid var(--border3)" : undefined, borderRight: "2px solid var(--border3)", background: "var(--bg2, rgba(0,0,0,0.02))" }}>
                        <NoteZelle t={t}
                          editing={zelle === `sec:${s.student_id}:${sec.id}`}
                          onEdit={() => setZelle(`sec:${s.student_id}:${sec.id}`)}
                          value={s.section_effective[String(sec.id)] ?? null}
                          isOverride={s.section_overrides[String(sec.id)] !== undefined}
                          onSave={(txt) => overrideSetzen(s.student_id, sec.id, txt)}
                          onCancel={() => setZelle(null)}
                          onReset={() => overrideReset(s.student_id, sec.id)} />
                      </td>
                    );
                    if (collapsed.has(sec.id)) return [bereichTd];
                    if (cols.length === 0) return [<td key={`e-${sec.id}`} style={{ ...td, borderLeft: "2px solid var(--border3)" }}></td>, bereichTd];
                    return [
                      ...cols.map((c, i) => {
                        const id = `${s.student_id}:${c.id}`;
                        const noten = notenVon(s.student_id, c.id);
                        return (
                          <td key={c.id} style={{ ...td, padding: 0, width: 56, minWidth: 56, maxWidth: 56, borderLeft: i === 0 ? "2px solid var(--border3)" : "1px solid var(--border)", borderRight: dividers.includes(c.id) ? "3px solid var(--accent)" : undefined }}>
                            {zelle === id
                              ? <Zelle initial={noten[0] ? de(noten[0].value) : ""}
                                  onSave={(txt) => noteSetzen(s.student_id, c.id, txt)}
                                  onCancel={() => setZelle(null)}
                                  // Tab geht NACH UNTEN: man traegt eine Spalte
                                  // am Stueck ein (eine Arbeit, Kind fuer Kind),
                                  // nicht eine Zeile quer durch alle Spalten.
                                  // Enter tut dasselbe; seitwaerts kommt man mit
                                  // den Pfeiltasten oder per Klick.
                                  onTab={(txt, hoch) => {
                                    const ziel = darunter(s.student_id, c.id, hoch);
                                    noteSetzen(s.student_id, c.id, txt);
                                    setZelle(ziel);
                                  }}
                                  onEnter={(txt, hoch) => {
                                    const ziel = darunter(s.student_id, c.id, hoch);
                                    noteSetzen(s.student_id, c.id, txt);
                                    setZelle(ziel);
                                  }}
                                  onPfeil={(txt, zurueck) => {
                                    const ziel = nachbar(s.student_id, c.id, zurueck);
                                    noteSetzen(s.student_id, c.id, txt);
                                    setZelle(ziel);
                                  }} />
                              : (<div style={{ position: "relative" }}>
                                  <button onClick={() => setZelle(id)}
                                    style={{ width: "100%", minHeight: 32, border: "none", background: "none", cursor: "text", color: "var(--text)", fontSize: 14, fontWeight: noten.length ? 600 : 400 }}>
                                    {s.per_category[String(c.id)] !== undefined ? de(s.per_category[String(c.id)]) : <span style={{ color: "var(--border2)" }}>·</span>}
                                  </button>
                                  {/* Ecke oben rechts. Die Trefferflaeche ist 20 px
                                      gross, das Dreieck darin nur 9 — vorher war der
                                      Knopf so gross wie das Zeichen und kaum zu
                                      treffen, erst recht nicht mit dem Finger. Das
                                      Dreieck selbst faengt keine Klicks
                                      (pointerEvents: none), sonst zielt man auf
                                      seine schraege Kante. */}
                                  <button className="komm-ecke" title={kommentarVon(s.student_id, c.id) || t("noten.commentAdd")}
                                    aria-label={t("noten.commentAdd")}
                                    onClick={(ev) => { ev.stopPropagation(); setKommentarFuer({ sid: s.student_id, cid: c.id, text: kommentarVon(s.student_id, c.id) }); }}
                                    style={{ position: "absolute", top: 0, right: 0, width: 20, height: 20, padding: 0, border: "none", cursor: "pointer",
                                      background: "transparent", lineHeight: 0,
                                      opacity: kommentarVon(s.student_id, c.id) ? 1 : 0 }}>
                                    <span style={{ display: "block", width: 0, height: 0, pointerEvents: "none",
                                      borderTop: `9px solid ${kommentarVon(s.student_id, c.id) ? C.warning : "var(--border2)"}`,
                                      borderLeft: "9px solid transparent", marginLeft: 12 }} />
                                  </button>
                                </div>)}
                          </td>
                        );
                      }),
                      bereichTd,
                    ];
                  })}
                  <td style={{ ...td, padding: 0, borderLeft: "2px solid var(--border3)" }}>
                    <NoteZelle t={t} bold
                      editing={zelle === `end:${s.student_id}`}
                      onEdit={() => setZelle(`end:${s.student_id}`)}
                      value={s.total_override ?? s.weighted}
                      isOverride={s.total_override != null}
                      onSave={(txt) => overrideSetzen(s.student_id, null, txt)}
                      onCancel={() => setZelle(null)}
                      onReset={() => overrideReset(s.student_id, null)} />
                    {s.total_override == null && s.weighted !== null && s.unweighted_fallback && (
                      <div style={{ fontWeight: 400, fontSize: 11, color: C.warning }}>{t("noten.unweighted")}</div>
                    )}
                  </td>
                  <td style={td}>
                    <button onClick={() => setBeobFuer(s.student_id)} title={t("noten.obsHeading")}
                      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", background: "none", cursor: "pointer", color: s.observations ? "var(--accent)" : "var(--text3)", fontSize: 13, padding: 4 }}>
                      {s.observations || <Icon d={ICONS.plus} size={14} />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 12, lineHeight: 1.6 }}>
        {t("noten.cellHint", { a: "2", b: "2,3" })} {t("noten.clickStudent")}
      </p>

      {beobFuer && (
        <Beobachtungen t={t} student={summary.find((s) => s.student_id === beobFuer)} cats={allCats}
          entries={entries.filter((e) => e.student_id === beobFuer && e.kind === "observation")}
          onClose={() => setBeobFuer(null)}
          onSave={(b) => call(() => fetch(`${API}/entries`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }))}
          onDelete={(id) => call(() => fetch(`${API}/entries/${id}`, { method: "DELETE" }))} />
      )}

      {kommentarFuer && (
        <Modal title={t("noten.commentTitle")} onClose={() => setKommentarFuer(null)}>
          <KommentarForm t={t} initial={kommentarFuer.text}
            onCancel={() => setKommentarFuer(null)}
            onSave={(txt) => kommentarSetzen(kommentarFuer.sid, kommentarFuer.cid, txt)} />
        </Modal>
      )}

      {infoFuer && (
        <StudentInfo t={t} student={students.find((st) => st.id === infoFuer)} summary={sumOf(infoFuer)} sections={sections} entries={entries} className={cls?.name} onZeugnis={() => doZeugnisStudent(infoFuer)} onClose={() => setInfoFuer(null)} />
      )}
    </div>
  );
}

// Eingabefeld einer Notenzelle. Nur 1–6 mit einer Nachkommastelle ist tippbar:
// vorher liess sich „42" eintragen, und das Speichern schlug still fehl.
//
// Bewegung: Tab und Enter gehen nach UNTEN (eine Spalte am Stueck eintragen —
// so arbeitet man eine Arbeit ab), mit Shift jeweils nach oben. Seitwaerts geht
// es mit den Pfeiltasten, aber erst am Rand des Feldes, damit man im Text noch
// navigieren kann.
function Zelle({ onSave, onCancel, onTab, onEnter, onPfeil, initial = "" }) {
  const ref = useRef(null);
  const weiter = useRef(false);   // Tab hat schon gespeichert — onBlur nicht doppelt
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <input ref={ref} defaultValue={initial} size={1} inputMode="decimal" maxLength={4}
      onInput={(e) => {
        let v = e.target.value.replace(".", ",").replace(/[^0-9,]/g, "");
        const teile = v.split(",");
        v = teile.length > 1 ? `${teile[0].slice(0, 1)},${teile.slice(1).join("").slice(0, 1)}` : v.slice(0, 1);
        if (v && !/^[1-6]/.test(v)) v = "";
        e.target.value = v;
      }}
      onBlur={(e) => { if (weiter.current) return; if (e.target.value.trim() || initial) onSave(e.target.value); else onCancel(); }}
      onKeyDown={(e) => {
        // Enter: dieselbe Spalte, naechstes Kind (so wird eine Spalte
        // abgearbeitet). Tab: dieselbe Zeile, naechste Spalte. Beides ohne
        // Sprung ueber den Rand hinaus — dort schliesst das Feld einfach.
        if (e.key === "Enter") {
          if (onEnter) { e.preventDefault(); weiter.current = true; onEnter(e.target.value, e.shiftKey); }
          else onSave(e.target.value);
        }
        if (e.key === "Escape") onCancel();
        if (e.key === "Tab" && onTab) { e.preventDefault(); weiter.current = true; onTab(e.target.value, e.shiftKey); }
        // Seitwaerts nur mit den Pfeiltasten — und nur, wenn der Cursor schon am
        // Rand des Feldes steht, sonst waere das Bewegen im Text unmoeglich.
        if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && onPfeil) {
          const feld = e.target;
          const amRand = e.key === "ArrowRight"
            ? feld.selectionStart === feld.value.length
            : feld.selectionStart === 0;
          if (amRand && feld.selectionStart === feld.selectionEnd) {
            e.preventDefault(); weiter.current = true; onPfeil(feld.value, e.key === "ArrowLeft");
          }
        }
      }}
      placeholder="2,3"
      style={{ width: "100%", minHeight: 32, border: "2px solid var(--accent)", borderRadius: CONTROL_R, background: "var(--input-bg, var(--bg))", color: "var(--text)", textAlign: "center", fontSize: 14, padding: 0, boxSizing: "border-box" }} />
  );
}

// Bereichs- oder Endnote: zeigt den Schnitt, per Klick ueberschreibbar, mit
// Kreuz wieder auf den Schnitt zuruecksetzbar. Ueberschriebene Note steht in
// Akzentfarbe, damit „gerechnet" und „gesetzt" unterscheidbar bleiben.
function NoteZelle({ t, editing, onEdit, value, isOverride, onSave, onCancel, onReset, bold }) {
  if (editing) return <Zelle initial={value != null ? de(value) : ""} onSave={onSave} onCancel={onCancel} />;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 2, minHeight: 32 }}>
      <button onClick={onEdit} title={t("noten.overrideHint")}
        style={{ border: "none", background: "none", cursor: "pointer", color: isOverride ? "var(--accent)" : "var(--text)", fontWeight: bold ? 700 : 600, fontSize: 14, padding: "0 2px" }}>
        {value != null ? de(value) : <span style={{ color: "var(--border2)" }}>·</span>}
      </button>
      {isOverride && (
        <button onClick={onReset} className="icon-btn" style={{ ...iconBtn, padding: 1 }} title={t("noten.overrideReset")} aria-label={t("noten.overrideReset")}>
          <Icon d={ICONS.close} color={C.danger} size={12} />
        </button>
      )}
    </div>
  );
}

// Statistische Auswertung der Halbjahresnoten — analog CardVote: Kennzahlen und
// Notenverteilung ueber die effektiven Endnoten (manuell gesetzt schlaegt
// Schnitt). Rein deskriptiv, keine Zeugnisnote.
function NotenStatistik({ noten, t }) {
  const [open, setOpen] = useState(false);
  noten = (noten || []).filter((v) => v != null);
  if (noten.length < 2) return null;
  const n = noten.length;
  const avg = noten.reduce((a, b) => a + b, 0) / n;
  const sorted = [...noten].sort((a, b) => a - b);
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const sd = Math.sqrt(noten.reduce((a, b) => a + (b - avg) ** 2, 0) / n);
  const dist = [1, 2, 3, 4, 5, 6].map((g) => noten.filter((v) => Math.round(v) === g).length);
  const maxD = Math.max(...dist, 1);
  const tile = (label, value) => (
    <div style={{ flex: "1 1 90px", minWidth: 80, padding: "10px 12px", background: "var(--bg2)", borderRadius: CONTROL_R, textAlign: "center" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)" }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>{label}</div>
    </div>
  );
  return (
    <div style={{ padding: 16, background: "var(--card)", borderRadius: cardStyle.borderRadius, border: "1px solid var(--border)", marginBottom: 16 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}>
        <Icon d={open ? ICONS.minus : ICONS.plus} size={14} />
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{t("noten.statTitle")}</span>
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {tile(t("noten.statAvg"), de(Math.round(avg * 100) / 100))}
            {tile(t("noten.statMedian"), de(Math.round(median * 100) / 100))}
            {tile(t("noten.statSd"), `±${(Math.round(sd * 100) / 100).toString().replace(".", ",")}`)}
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 90 }}>
            {dist.map((c, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ fontSize: 11, color: "var(--text3)" }}>{c || ""}</div>
                <div style={{ width: "100%", maxWidth: 44, height: `${(c / maxD) * 60}px`, minHeight: c ? 3 : 0, background: "var(--accent)", borderRadius: "5px 5px 0 0", opacity: c ? 0.85 : 0.15 }} />
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)" }}>{i + 1}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Einfaches modales Popup fuer die Anlage-Formulare (Abschnitt/Spalte).
function Modal({ title, onClose, children }) {
  return <UiModal onClose={onClose} width={400} title={title}>{children}</UiModal>;
}

function SectionForm({ t, onSave, onCancel, initial }) {
  const [name, setName] = useState(initial?.name || "");
  const [weight, setWeight] = useState(initial?.weight ?? "");
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
      <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder={t("noten.newSection")}
        style={{ flex: 1, minWidth: 220, ...inp }} onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }} />
      <input type="number" min={0} max={100} value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="%" style={{ width: 80, ...inp }} />
      <button onClick={() => name.trim() && onSave({ name: name.trim(), weight: Number(weight) || 0 })} style={btnPrimary}>{t("common.save")}</button>
      <button onClick={onCancel} style={btnSecondary}>{t("common.abort")}</button>
    </div>
  );
}

// Import einer Code-Detektiv-Session als Notenspalte: Session + Abschnitt waehlen,
// der Server matcht die (frei getippten) Spielernamen gegen die SuS des Kurses und
// rechnet geloeste Raetsel in eine Note. Nicht zuordenbare Namen werden gemeldet.
function CodeSessionImport({ t, classId, kursId, sections, onClose, onDone }) {
  const [list, setList] = useState(null);
  const [sessionId, setSessionId] = useState("");
  const [sectionId, setSectionId] = useState(sections[0] ? String(sections[0].id) : "");
  const [name, setName] = useState(`Code-Detektiv ${new Date().toLocaleDateString()}`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [unmatched, setUnmatched] = useState(null);

  useEffect(() => {
    fetch("/api/noten/code-sessions").then((r) => (r.ok ? r.json() : [])).then((d) => {
      const l = Array.isArray(d) ? d : [];
      setList(l);
      if (l[0]) setSessionId(String(l[0].id));
    }).catch(() => setList([]));
  }, []);

  const submit = async () => {
    if (!sessionId) { setErr(t("noten.fromCdNoSession")); return; }
    if (!sectionId || !name.trim()) { setErr(t("noten.columnName")); return; }
    setBusy(true); setErr("");
    const res = await fetch("/api/noten/import-code-session", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code_session_id: Number(sessionId), class_id: classId, kurs_id: kursId, section_id: Number(sectionId), column_name: name.trim() }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.ok) {
      const b = await res.json().catch(() => ({}));
      if ((b.unmatched || []).length) { setUnmatched(b.unmatched); return; }
      onDone();
    } else { const b = res ? await res.json().catch(() => ({})) : {}; setErr(typeof b.detail === "string" ? b.detail : t("common.notWork")); }
  };

  if (unmatched) return (
    <div>
      <p style={{ fontSize: 14, color: "var(--text2)", marginBottom: 12 }}>{t("noten.fromCdDone", { n: unmatched.length })}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
        {unmatched.map((n) => <span key={n} style={{ ...chipStyle, fontSize: 13, padding: "3px 9px", background: "var(--bg2)", color: "var(--text3)" }}>{n}</span>)}
      </div>
      <button onClick={onDone} style={btnPrimary}>{t("common.ok")}</button>
    </div>
  );

  if (list === null) return <p style={{ fontSize: 13, color: "var(--text3)" }}>…</p>;
  if (list.length === 0) return (
    <div><p style={{ fontSize: 14, color: "var(--text2)" }}>{t("noten.fromCdEmpty")}</p>
      <button onClick={onClose} style={{ ...btnSecondary, marginTop: 12 }}>{t("common.abort")}</button></div>
  );

  const lbl = { fontSize: 13, color: "var(--text2)", margin: "12px 0 5px" };
  return (
    <div>
      <div style={{ ...lbl, marginTop: 0 }}>{t("noten.fromCdSession")}</div>
      <select value={sessionId} onChange={(e) => setSessionId(e.target.value)} style={inp}>
        {list.map((s) => <option key={s.id} value={s.id}>{s.code} · {t("noten.fromCdMeta", { players: s.players, puzzles: s.puzzles })}</option>)}
      </select>
      <div style={lbl}>{t("karten.masterySection")}</div>
      <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={inp}>
        {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <div style={lbl}>{t("noten.columnName")}</div>
      <input value={name} onChange={(e) => setName(e.target.value)} style={inp} />
      {err && <p style={{ color: C.danger, fontSize: 13, marginTop: 12 }}>{err}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button onClick={submit} disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }}>{t("common.save")}</button>
        <button onClick={onClose} style={btnSecondary}>{t("common.abort")}</button>
      </div>
    </div>
  );
}

// Kompaktes Kebab-Menue: haelt Spalte-hinzufuegen, Umbenennen und Loeschen,
// damit der Abschnittskopf schmal bleibt.
function SectionMenu({ t, sec, onEdit, onDelete, onAddCol, onOpen }) {
  const [open, setOpenRoh] = useState(false);
  // Nach oben melden: die Kopfzelle muss sich ueber ihre Nachbarn legen,
  // solange das Menue offen ist. Alle Kopfzellen kleben (z-index 2) und bilden
  // damit eigene Stapel — ohne das lag der Text der Nachbarzelle ueber dem
  // Menue und schluckte die Klicks.
  const setOpen = (v) => { setOpenRoh(v); onOpen?.(typeof v === "function" ? v(open) : v); };
  const [edit, setEdit] = useState(false);
  if (edit) {
    return (
      <span onClick={(e) => e.stopPropagation()} style={{ ...popoverPanel, position: "absolute", zIndex: 10, top: 50, left: 0, padding: 8 }}>
        <SectionForm t={t} initial={sec} onCancel={() => setEdit(false)} onSave={(b) => { onEdit(b); setEdit(false); }} />
      </span>
    );
  }
  const item = { display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 10px", border: "none", background: "none", cursor: "pointer", color: "var(--text)", fontSize: 13, textAlign: "left", fontWeight: 400 };
  return (
    <span style={{ position: "relative", display: "inline-flex" }} onClick={(e) => e.stopPropagation()}>
      <button onClick={() => setOpen((o) => !o)} className="icon-btn" style={{ ...iconBtn, padding: 1 }} title={t("common.options")} aria-label={t("common.options")}><Icon d={ICONS.more} size={15} /></button>
      {open && (
        <>
          <span onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 9 }} />
          <Popover align="right" style={{ zIndex: 10, top: 24, minWidth: 168, padding: 4 }}>
            <button style={item} onClick={() => { setOpen(false); onAddCol(); }}><Icon d={ICONS.plus} size={14} color="var(--accent)" /> {t("noten.addColumn")}</button>
            <button style={item} onClick={() => { setOpen(false); setEdit(true); }}><Icon d={ICONS.edit} size={14} /> {t("common.edit")}</button>
            <button style={{ ...item, color: C.danger }} onClick={() => { setOpen(false); onDelete(); }}><Icon d={ICONS.trash} size={14} color={C.danger} /> {t("common.delete")}</button>
          </Popover>
        </>
      )}
    </span>
  );
}

// Kleine Uebersicht zur Spalte: Anlagedatum plus Umbenennen/Loeschen.
function ColMenu({ t, cat, onStats, onRename, onDelete, onClose, dividerOn, onToggleDivider, classId, topics = [], onNachhol, onCompare, kartenAktiv, cvAktiv }) {
  const [name, setName] = useState(cat.name);
  const [topicId, setTopicId] = useState(cat.topic_id ?? "");
  const [datum, setDatum] = useState(cat.date || "");
  const angelegt = cat.created_at ? new Date(cat.created_at).toLocaleDateString("de-DE") : "—";
  // Siehe core/topics.js: Beschriftung und Reihenfolge kommen von dort, damit
  // dieselbe Auswahl ueberall gleich heisst und gleich sortiert ist.
  const themen = themenIndex(topics);
  // Leerer Name ist erlaubt, WENN ein Datum dasteht: dann ist das Datum der
  // Name („09.02.26"). Vorher tat der Knopf in dem Fall gar nichts — man loescht
  // den Titel, tippt ein Datum und nichts passiert.
  const save = () => {
    const titel = name.trim() || datumKurz(datum);
    if (!titel) return;
    onRename(titel, topicId === "" ? null : Number(topicId), datum || null);
  };
  return (
    <>
      <span onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9 }} />
      <Popover align="center" onClick={(e) => e.stopPropagation()} style={{ zIndex: 10, top: 26, minWidth: 210, padding: 12, textAlign: "left", fontWeight: 400 }}>
        <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8 }}>{t("noten.colCreated")}: {angelegt}</div>
        {/* Auswertung: schlichter Details-Knopf, öffnet das zentrale Modal. */}
        <button onClick={() => { onStats(); onClose(); }} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", marginBottom: 12, padding: "7px 9px", fontSize: 13, fontWeight: 600, borderRadius: CONTROL_R, border: "1px solid var(--border2)", background: "var(--bg2)", color: "var(--text)", cursor: "pointer" }}>
          <Icon d={ICONS.chart} size={14} color="var(--accent)" />{t("noten.colDetails")}
        </button>
        <button onClick={() => { onCompare(cat); onClose(); }} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", marginBottom: 12, padding: "7px 9px", fontSize: 13, fontWeight: 600, borderRadius: CONTROL_R, border: "1px solid var(--border2)", background: "var(--bg2)", color: "var(--text)", cursor: "pointer" }}>
          <Icon d={ICONS.chart} size={14} color={C.info} />{t("noten.compare")}
        </button>
        <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 12 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
            placeholder={datumKurz(datum) || t("noten.colName")}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") onClose(); }}
            style={{ ...toolbarInput, width: "100%" }} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>{t("noten.colDate")}</div>
          <input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} style={{ ...toolbarInput, width: "100%" }} />
        </div>
        {topics.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>{t("noten.colTopic")}</div>
            <select value={topicId} onChange={(e) => setTopicId(e.target.value)} style={{ ...selectStyle, width: "100%" }}>
              <option value="">{t("noten.colTopicNone")}</option>
              {themen.geordnet.map((tp) => <option key={tp.id} value={tp.id}>{themen.label(tp)}</option>)}
            </select>
          </div>
        )}
        {cat.topic_id && kartenAktiv && (
          <button onClick={() => { onNachhol(cat); onClose(); }}
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", marginBottom: 12, padding: "7px 9px", fontSize: 13, fontWeight: 600, borderRadius: CONTROL_R, border: "1px solid var(--border2)", background: "var(--bg)", color: C.warning, cursor: "pointer" }}>
            <Icon d={ICONS.bulb} size={14} /> {t("noten.nachhol")}
          </button>
        )}
        {cat.source_session_id && cvAktiv && (
          <Link to={`/cardvote/evaluation/${cat.source_session_id}`} onClick={onClose}
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", marginBottom: 12, padding: "6px 8px", fontSize: 13, fontWeight: 600, borderRadius: CONTROL_R, border: "1px solid var(--border2)", background: "var(--bg)", color: "var(--accent)", textDecoration: "none", boxSizing: "border-box" }}>
            <Icon d={ICONS.chart} size={14} color="var(--accent)" />{t("noten.fromCardvote")}
          </Link>
        )}
        {!cat.source_session_id && cat.source_kind === "karten" && kartenAktiv && (
          <Link to={`/karten?tab=progress&class=${classId}`} onClick={onClose}
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", marginBottom: 12, padding: "6px 8px", fontSize: 13, fontWeight: 600, borderRadius: CONTROL_R, border: "1px solid var(--border2)", background: "var(--bg)", color: C.success, textDecoration: "none", boxSizing: "border-box" }}>
            <Icon d={ICONS.chart} size={14} color={C.success} />{t("noten.fromKarten")}
          </Link>
        )}
        {cat.source_kind === "codedetektiv" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", marginBottom: 12, padding: "6px 8px", fontSize: 13, fontWeight: 600, borderRadius: CONTROL_R, border: "1px solid var(--border2)", background: "var(--bg)", color: "var(--text3)", boxSizing: "border-box" }}>
            <Icon d={ICONS.chart} size={14} color="var(--text3)" />{t("noten.fromCd")}
          </div>
        )}
        {onToggleDivider && (
          <button onClick={onToggleDivider} style={{ width: "100%", marginBottom: 12, padding: "6px 8px", fontSize: 12, fontWeight: 600, borderRadius: CONTROL_R, cursor: "pointer", border: `1px solid ${dividerOn ? "var(--accent)" : "var(--border2)"}`, background: dividerOn ? "var(--accent)" : "transparent", color: dividerOn ? C.aufAkzent : "var(--text2)" }}>
            {dividerOn ? t("noten.dividerOff") : t("noten.dividerOn")}
          </button>
        )}
        <div style={{ display: "flex", gap: 6, justifyContent: "space-between", alignItems: "center" }}>
          <button onClick={save} style={{ ...btnPrimary, padding: "5px 12px", fontSize: 12 }}>{t("common.save")}</button>
          <button onClick={onDelete} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} color={C.danger} size={14} /></button>
        </div>
      </Popover>
    </>
  );
}

// Datumswahl ueber ein natives <input type=date>, transparent ueber dem
// Kalender-Icon: auf dem iPhone erscheinen so die Datumsraeder. Setzt den
// Spaltennamen auf TT.MM.JJJJ, der Name bleibt aber frei editierbar.

function ColForm({ t, onSave, onCancel, initial = "", vorschlag = "", initialDatum = "" }) {
  const [name, setName] = useState(initial);
  // Das Datum ist eine EIGENSCHAFT der Spalte, kein Namensbestandteil: „KA
  // 02.03.2026" als Zeichenkette kann niemand sortieren oder auswerten. Der
  // Kopf zeigt weiter nur den Titel.
  const [datum, setDatum] = useState(initialDatum);
  // Leer abschicken ist erlaubt. Steht ein Datum da, IST das der Name — genau
  // so heissen die meisten Spalten ohnehin („09.02.26"). Ohne beides gibt es
  // „Spalte 3" (der Vorschlag zaehlt die vorhandenen mit). Vorher passierte auf
  // OK gar nichts — ein Knopf, der stumm bleibt, sieht aus wie ein Fehler.
  // Weder Titel noch Datum: dann ist heute gemeint. Der Vorschlag „Spalte 3"
  // sagt nichts ueber die Leistung — das Datum schon, und es fuellt zugleich
  // die Eigenschaft, nach der der Verlauf sortiert.
  const nimm = () => {
    const heute = new Date().toISOString().slice(0, 10);
    const tag = datum || (name.trim() ? "" : heute);
    onSave(name.trim() || datumKurz(tag) || vorschlag || t("noten.colName"), tag || null);
  };
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 4, alignItems: "center", flexWrap: "wrap" }} onClick={(e) => e.stopPropagation()}>
      {/* data-spalte: der Platzhalter ist jetzt der Namensvorschlag („Spalte 3")
          und taugt nicht mehr als Kennzeichen fuer den Browser-Test. */}
      <input data-spalte="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder={vorschlag || t("noten.colName")}
        onKeyDown={(e) => { if (e.key === "Enter") nimm(); if (e.key === "Escape") onCancel(); }}
        style={{ ...toolbarInput, flex: 1, minWidth: 120 }} />
      <input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} title={t("noten.colDate")} aria-label={t("noten.colDate")}
        style={toolbarInput} />
      <button onClick={nimm} style={toolbarBtnPrimary}>OK</button>
      <button onClick={onCancel} className="icon-btn" style={{ ...iconBtn, padding: 6 }} title={t("common.abort")} aria-label={t("common.abort")}><Icon d={ICONS.close} size={20} /></button>
    </div>
  );
}

// Vergleich einer Klassenarbeit: dieselbe Arbeit in den anderen Fach-Klassen des
// Kurses + der Notenverlauf dieser Klasse im Halbjahr. Rein deskriptiv.
const GRADE_COL = [C.success, C.success, C.warning, C.warning, C.danger, C.danger];
function CompareModal({ t, cat, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    fetch(`/api/noten/categories/${cat.id}/compare`).then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData).catch(() => setErr(true));
  }, [cat.id]);
  const de1 = (n) => (n == null ? "—" : String(Math.round(n * 100) / 100).replace(".", ","));
  return (
    <UiModal onClose={onClose} width={520} label={`${t("noten.compare")}: ${cat.name}`}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{t("noten.compare")}: {cat.name}</h3>
        {err ? <p style={{ fontSize: 13, color: "var(--text3)" }}>{t("common.notWork")}</p> : !data ? <p style={{ fontSize: 13, color: "var(--text3)" }}>…</p> : (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text3)", margin: "12px 0 8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>{t("noten.compareClasses")}</div>
            {data.classes.length <= 1 && <p style={{ fontSize: 13, color: "var(--text3)", marginBottom: 8 }}>{t("noten.compareNoClasses")}</p>}
            {data.classes.map((c, i) => {
              const max = Math.max(...c.dist, 1);
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
                  <span style={{ flex: 1, minWidth: 90, fontSize: 13, fontWeight: c.is_self ? 700 : 500, color: c.is_self ? "var(--accent)" : "var(--text)" }}>{c.class_name}{c.is_self ? " ●" : ""}</span>
                  <span style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 30 }}>
                    {c.dist.map((n, g) => <span key={g} title={`${g + 1}: ${n}`} style={{ width: 9, height: Math.max(2, (n / max) * 30), background: GRADE_COL[g], borderRadius: 2 /* Saeulen-Kappe: reine Grafik */, opacity: n ? 1 : 0.25 }} />)}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, minWidth: 54, textAlign: "right" }}>⌀ {de1(c.avg)}</span>
                  <span style={{ fontSize: 12, color: "var(--text3)", minWidth: 30, textAlign: "right" }}>n={c.n}</span>
                </div>
              );
            })}
            {data.over_time.length > 1 && (<>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text3)", margin: "18px 0 8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>{t("noten.compareOverTime")}</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 90, paddingTop: 6 }}>
                {data.over_time.map((o, i) => (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    {/* Balken: niedrigere (bessere) Note = höher. Skala 1..6 → 6-avg. */}
                    <div title={`⌀ ${de1(o.avg)}`} style={{ width: "70%", height: `${Math.max(4, ((6 - o.avg) / 5) * 66)}px`, background: o.is_self ? "var(--accent)" : "var(--border3)", borderRadius: 3 /* Saeulen-Kappe: reine Grafik */ }} />
                    <span style={{ fontSize: 11, fontWeight: 700 }}>{de1(o.avg)}</span>
                    <span style={{ fontSize: 11, color: "var(--text3)", maxWidth: 60, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.name}</span>
                  </div>
                ))}
              </div>
            </>)}
            <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 16 }}>{t("noten.compareHint")}</p>
          </>
        )}
        <div style={{ marginTop: 16 }}><button onClick={onClose} style={btnSecondary}>{t("common.close")}</button></div>
    </UiModal>
  );
}

/**
 * Zweizeiliger Tabellenkopf, der beim Scrollen stehen bleibt.
 *
 * `position: sticky` braucht einen Scroll-Container als Bezug — deshalb der
 * eigene Rahmen. Und die ZWEITE Kopfzeile muss um die Hoehe der ersten tiefer
 * kleben, sonst liegen beide aufeinander und die erste Datenzeile schiebt sich
 * darunter. Die Hoehe wird gemessen, nicht geraten: sie haengt am Inhalt.
 *
 * Beide Tabellen der Seite (Halbjahr und Jahr) nutzen denselben Haken — die
 * Jahresansicht hatte den Mechanismus zuerst nicht und sah genau so kaputt aus.
 */
function useKlebenderKopf() {
  const rahmenRef = useRef(null);
  const kopf1Ref = useRef(null);
  useLayoutEffect(() => {
    const zeile = kopf1Ref.current, rahmen = rahmenRef.current;
    if (!zeile || !rahmen) return undefined;
    const mess = () => {
      rahmen.style.setProperty("--kopf2", `${Math.round(zeile.getBoundingClientRect().height)}px`);
      // Breite der klebenden Namensspalte — siehe StickyMitte.
      const erste = zeile.querySelector("th");
      if (erste) rahmen.style.setProperty("--spalte1", `${Math.round(erste.getBoundingClientRect().width)}px`);
    };
    mess();
    const beob = new ResizeObserver(mess);
    beob.observe(zeile);
    return () => beob.disconnect();
  });
  return { rahmenRef, kopf1Ref, th2: { ...th, top: "var(--kopf2, 0px)" } };
}

// Notenverlauf: eine Linie über die Kategorien in Zeitreihenfolge. Deutsche Noten
// 1 (oben, best) bis 6 (unten). Einzelne Serie -> keine Legende, Titel benennt sie.
//
// `titel` und `hinweis` kommen von aussen, weil dieselbe Kurve zwei Dinge
// zeigen kann: den laufenden Gesamtschnitt (jeder Punkt = Stand nach dieser
// Note) oder die Einzelnoten eines Abschnitts. Das muss dranstehen — eine
// Kurve, die beides sein kann, ist sonst nicht zu lesen.
/**
 * Was steht an einem Punkt der Kurve?
 *
 * Datum und Spaltenname, die Note dieser Erhebung und — wenn der Punkt ein
 * laufender Schnitt ist — auch dieser. Ohne den Text ist die Kurve nur eine
 * Form: man sieht, dass es abwaerts ging, aber nicht, woran es lag.
 */
function punktText(p, t) {
  const cat = p.cat || {};
  const tag = cat.date || (cat.created_at ? String(cat.created_at).slice(0, 10) : "");
  const datum = tag ? tag.split("-").reverse().join(".") : "";
  const herkunft = cat.source_kind === "karten" ? t("noten.fromKarten")
    : cat.source_session_id ? t("noten.fromCardvote")
    : cat.source_kind === "codedetektiv" ? t("noten.fromCd") : "";
  const zeilen = [
    [datum, cat.name].filter(Boolean).join(" · "),
    p.einzeln != null ? `${t("noten.gradeShortLabel")}: ${de(Math.round(p.einzeln * 100) / 100)}` : null,
    `${p.istSchnitt ? t("noten.runningAvg") : t("noten.gradeShortLabel")}: ${de(Math.round(p.value * 100) / 100)}`,
    herkunft || null,
  ].filter(Boolean);
  return zeilen.join("\n");
}

function GradeChart({ series, t, titel, hinweis, rechts }) {
  // Eigenes Hinweisfeld statt `<title>` im SVG: das zeigt der Browser
  // unzuverlaessig (und nur einzeilig, nach Verzoegerung). Hier steht es sofort
  // und mehrzeilig — Datum, Spalte, Note.
  const [zeigt, setZeigt] = useState(null);   // { x, y, text }
  if (series.length < 2) return null;
  const W = 340, H = 170, padL = 26, padR = 12, padT = 12, padB = 20;
  const n = series.length;
  const x = (i) => padL + (n === 1 ? 0 : (i * (W - padL - padR)) / (n - 1));
  const y = (v) => padT + ((v - 1) / 5) * (H - padT - padB); // 1 oben, 6 unten
  const pts = series.map((s, i) => ({ cx: x(i), cy: y(s.value), s }));
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(" ");
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{titel || t("noten.verlauf")}</div>
        {rechts}
      </div>
      {hinweis && <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8 }}>{hinweis}</div>}
      <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} role="img" aria-label={t("noten.verlauf")}
        onMouseLeave={() => setZeigt(null)}>
        {[1, 2, 3, 4, 5, 6].map((g) => (
          <g key={g}>
            <line x1={padL} y1={y(g)} x2={W - padR} y2={y(g)} stroke="var(--border)" strokeWidth="1" />
            <text x={padL - 6} y={y(g) + 3.5} textAnchor="end" fontSize="10" fill="var(--text3)">{g}</text>
          </g>
        ))}
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <g key={i}>
            {/* Grosse, unsichtbare Trefferflaeche: der 4-px-Punkt ist mit der
                Maus kaum zu treffen. */}
            <circle cx={p.cx} cy={p.cy} r="12" fill="transparent"
              onMouseEnter={() => setZeigt({ i, text: punktText(p.s, t) })}
              onFocus={() => setZeigt({ i, text: punktText(p.s, t) })}
              tabIndex={0} style={{ cursor: "pointer", outline: "none" }} />
            <circle cx={p.cx} cy={p.cy} r={zeigt?.i === i ? 6 : 4} fill="var(--accent)"
              stroke="var(--card)" strokeWidth="1.5" style={{ pointerEvents: "none" }} />
          </g>
        ))}
      </svg>
      {zeigt && (() => {
        const p = pts[zeigt.i];
        // In Prozent umrechnen: das SVG skaliert mit der Breite, absolute
        // Pixel aus dem viewBox-System waeren daneben.
        const links = (p.cx / W) * 100;
        return (
          <div style={{ position: "absolute", left: `${links}%`, top: `${(p.cy / H) * 100}%`,
            transform: `translate(${links > 70 ? "-100%" : links < 30 ? "0" : "-50%"}, calc(-100% - 10px))`,
            background: "var(--text)", color: "var(--bg)", fontSize: 12, lineHeight: 1.45,
            padding: "6px 9px", borderRadius: popoverPanel.borderRadius, whiteSpace: "pre", pointerEvents: "none",
            boxShadow: SHADOW.schwebend, zIndex: 5 }}>
            {zeigt.text}
          </div>
        );
      })()}
      </div>
      <div style={{ fontSize: 11, color: "var(--text3)", textAlign: "right", marginTop: 4 }}>{t("noten.verlaufAxis")}</div>
    </div>
  );
}

// Kommentar an einer Zelle. Bewusst mehrzeilig: „krank, Arbeit nachgeschrieben
// am 12.03." ist ein Satz, kein Stichwort.
function KommentarForm({ t, initial = "", onSave, onCancel }) {
  const [text, setText] = useState(initial);
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <p style={{ fontSize: 13, color: "var(--text3)", margin: "0 0 8px" }}>{t("noten.commentHint")}</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} autoFocus rows={4} maxLength={2000}
        placeholder={t("noten.commentPlaceholder")}
        onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
        style={{ ...inp, width: "100%", fontSize: 14, padding: 10, resize: "vertical", boxSizing: "border-box" }} />
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={() => onSave(text)} style={btnPrimary}>{t("common.save")}</button>
        <button onClick={onCancel} style={btnSecondary}>{t("common.abort")}</button>
        {initial && (
          <button onClick={() => onSave("")} style={{ ...btnSecondary, marginLeft: "auto", color: C.danger }}>{t("common.delete")}</button>
        )}
      </div>
    </div>
  );
}

function StudentInfo({ t, student, summary, sections, entries = [], className, onZeugnis, onClose }) {
  // Hook vor jedem fruehen Ausstieg: sonst haengt die Hook-Reihenfolge daran,
  // ob gerade ein Kind gewaehlt ist.
  const [bereich, setBereich] = useState("gesamt");
  const [modus, setModus] = useState("schnitt");   // „schnitt" (laufend) oder „einzeln"
  if (!student) return null;
  // Verlauf der GESAMTNOTE (gewichtet) über die Zeit: nach jeder neuen Note die
  // gewichtete Gesamtnote aus allen bis dahin vorhandenen Noten. Kategorien in
  // Zeitreihenfolge (created_at, sonst Reihenfolge Abschnitt/Kategorie).
  const cats = sections.flatMap((s, si) => (s.categories || []).map((c, ci) => ({ ...c, secId: s.id, ord: si * 1000 + ci })));
  // Zeitachse: das Datum der Leistung schlaegt das Anlagedatum — eine
  // nachgetragene Arbeit vom Maerz gehoert in den Verlauf an ihren Platz, nicht
  // ans Ende, nur weil die Spalte gestern entstand.
  const wann = (c) => c.date || (c.created_at ? String(c.created_at).slice(0, 10) : "");
  cats.sort((a, b) => (wann(a) && wann(b) ? wann(a).localeCompare(wann(b)) : a.ord - b.ord));
  const gradeOf = (cid) => {
    const es = entries.filter((e) => e.student_id === student.id && e.category_id === cid && e.kind === "grade" && e.value != null);
    return es.length ? es[es.length - 1].value : null;
  };
  const overallUpTo = (prefixIds) => {
    const secAvgs = [];
    sections.forEach((sec) => {
      const vals = (sec.categories || []).filter((c) => prefixIds.has(c.id)).map((c) => gradeOf(c.id)).filter((v) => v != null);
      if (vals.length) secAvgs.push({ avg: vals.reduce((a, b) => a + b, 0) / vals.length, w: sec.weight || 0 });
    });
    if (!secAvgs.length) return null;
    const tw = secAvgs.reduce((a, s) => a + s.w, 0);
    return tw > 0 ? secAvgs.reduce((a, s) => a + s.avg * s.w, 0) / tw : secAvgs.reduce((a, s) => a + s.avg, 0) / secAvgs.length;
  };
  const prefix = new Set();
  const gesamt = [];
  cats.forEach((c) => {
    prefix.add(c.id);
    const v = overallUpTo(prefix);
    if (v != null) gesamt.push({ cat: c, value: v, istSchnitt: true, einzeln: gradeOf(c.id) });
  });
  // Je Abschnitt die EINZELNEN Noten in Zeitreihenfolge — der laufende
  // Gesamtschnitt glaettet alles weg (er mittelt ja jedes Mal neu ueber alles),
  // und genau daran war er nicht zu gebrauchen: eine 5 sieht darin aus wie eine
  // kleine Delle. Fuer „wie lief dieser Bereich?" braucht es die Rohwerte.
  const einzeln = (secId) => cats.filter((c) => c.secId === secId)
    .map((c) => ({ cat: c, value: gradeOf(c.id) }))
    .filter((p) => p.value != null);
  // Laufender Schnitt INNERHALB eines Bereichs: nach jeder Note der Mittelwert
  // aller bisherigen Noten dieses Bereichs. Das ist die Zahl, die auch in der
  // Liste unten steht — der Verlauf zeigt, wie sie dorthin gekommen ist.
  const schnittLauf = (secId) => {
    const bisher = [];
    return einzeln(secId).map((p) => {
      bisher.push(p.value);
      return { cat: p.cat, value: bisher.reduce((a, b) => a + b, 0) / bisher.length,
               istSchnitt: true, einzeln: p.value };
    });
  };
  const alleEinzeln = cats.map((c) => ({ cat: c, value: gradeOf(c.id) })).filter((p) => p.value != null);
  const waehlbar = sections.filter((sec) => einzeln(sec.id).length >= 2);
  const serie = bereich === "gesamt"
    ? (modus === "einzeln" ? alleEinzeln : gesamt)
    : (modus === "einzeln" ? einzeln(bereich) : schnittLauf(bereich));
  const secName = sections.find((x) => x.id === bereich)?.name || "";
  return (
    <UiModal onClose={onClose} width={460} label={student.name}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{student.name}</h3>
            <p style={{ fontSize: 13, color: "var(--text3)", marginBottom: 16 }}>{className}</p>
          </div>
          {onZeugnis && <button onClick={onZeugnis} style={{ ...btnSecondary, padding: "6px 12px", fontSize: 13, whiteSpace: "nowrap" }} title={t("noten.zeugnisHint")}>{t("noten.zeugnis")}</button>}
        </div>

        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px", fontSize: 14, marginBottom: 16 }}>
          {/* Nur zeigen, was es gibt: eine Zeile „Kurs —" behauptet eine
              E/G-Einteilung, die in diesem Fach gar nicht gefuehrt wird. */}
          {student.niveau && (<>
            <dt style={dtS}>{t("noten.course")}</dt>
            <dd style={ddS}>{student.niveau === "E" ? "E-Kurs" : "G-Kurs"}</dd>
          </>)}
          {student.foerder?.length > 0 && (<>
            <dt style={dtS}>{t("noten.supportNeeds")}</dt>
            <dd style={ddS}>{student.foerder.join(", ")}</dd>
          </>)}
          {student.klassenlehrer && (<><dt style={dtS}>{t("noten.classTeacher")}</dt><dd style={ddS}>{student.klassenlehrer}</dd></>)}
          {student.notizen && (<><dt style={dtS}>{t("noten.notes")}</dt><dd style={ddS}>{student.notizen}</dd></>)}
        </dl>

        <GradeChart series={serie} t={t}
          titel={bereich === "gesamt" ? t("noten.verlauf") : t("noten.verlaufSection", { name: secName })}
          hinweis={modus === "einzeln" ? t("noten.verlaufSingle")
                   : bereich === "gesamt" ? t("noten.verlaufRunning") : t("noten.verlaufRunningSection")}
          rechts={(
            /* Umschalter Schnitt/Einzelnoten — der Schnitt beantwortet „wo
               stehe ich?", die Einzelnoten „woran lag es?". */
            <Toggle checked={modus === "einzeln"} onChange={(v) => setModus(v ? "einzeln" : "schnitt")}
              label={<span style={{ fontSize: 13, color: "var(--text2)" }}>{t("noten.verlaufSingleToggle")}</span>} />
          )} />

        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{t("noten.gradesBySection")}</div>
        {sections.length === 0 || !summary ? (
          <p style={{ fontSize: 13, color: "var(--text3)" }}>{t("noten.noGrades")}</p>
        ) : (
          <div style={{ marginBottom: 16 }}>
            {/* Die Liste IST die Auswahl fuer die Kurve darueber — ein zweiter
                Chip-Streifen daneben waere dieselbe Sache zweimal. Bereiche mit
                weniger als zwei Noten bleiben unklickbar: aus einem Punkt wird
                kein Verlauf. */}
            {sections.map((sec) => {
              const v = summary.per_section?.[String(sec.id)];
              const klickbar = waehlbar.some((x) => x.id === sec.id);
              const an = bereich === sec.id;
              return (
                <div key={sec.id} onClick={() => klickbar && setBereich(an ? "gesamt" : sec.id)}
                  title={klickbar ? t("noten.verlaufPick") : undefined}
                  style={{ display: "flex", justifyContent: "space-between", padding: "5px 6px", borderBottom: "1px solid var(--border)", fontSize: 14,
                    cursor: klickbar ? "pointer" : "default", borderRadius: CONTROL_R,
                    background: an ? "var(--bg2)" : "transparent",
                    boxShadow: an ? "inset 3px 0 0 var(--accent)" : undefined }}>
                  {/* Prozente rechtsbuendig in fester Spalte: sonst enden „5 %"
                      und „50 %" an verschiedenen Stellen und die Namen springen. */}
                  <span style={{ display: "inline-flex", gap: 6, minWidth: 0 }}>
                    <span style={{ color: "var(--text3)", width: 42, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{sec.weight} %</span>
                    <span style={{ color: "var(--text3)" }}>·</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sec.name}</span>
                  </span>
                  <strong>{v !== undefined ? de(v) : "·"}</strong>
                </div>
              );
            })}
            <div onClick={() => setBereich("gesamt")} title={t("noten.verlaufPick")}
              style={{ display: "flex", justifyContent: "space-between", padding: "8px 6px 4px", fontSize: 14, fontWeight: 700,
                cursor: "pointer", borderRadius: CONTROL_R, background: bereich === "gesamt" ? "var(--bg2)" : "transparent",
                boxShadow: bereich === "gesamt" ? "inset 3px 0 0 var(--accent)" : undefined }}>
              <span>{t("noten.total")}</span>
              <span>{summary.weighted !== null ? de(summary.weighted) : "·"}{summary.unweighted_fallback ? ` (${t("noten.unweighted")})` : ""}</span>
            </div>
          </div>
        )}

        <button onClick={onClose} style={btnSecondary}>{t("noten.close")}</button>
    </UiModal>
  );
}

function Beobachtungen({ t, student, cats, entries, onClose, onSave, onDelete }) {
  const [catId, setCatId] = useState(cats[0]?.id ?? null);
  const [tendency, setTendency] = useState(1);
  const [note, setNote] = useState("");
  return (
    <UiModal onClose={onClose} width={460} label={student?.name}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{student?.name}</h3>
        <p style={{ fontSize: 13, color: "var(--text3)", marginBottom: 16 }}>{t("noten.obsSub")}</p>
        {cats.length === 0 ? (
          <p style={{ fontSize: 14, color: "var(--text3)" }}>{t("noten.needColumnFirst")}</p>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              <select value={catId ?? ""} onChange={(e) => setCatId(Number(e.target.value))} style={{ ...inp, flex: 1, minWidth: 140 }}>
                {cats.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
              {[[1, "+"], [0, "·"], [-1, "−"]].map(([v, label]) => (
                <button key={v} onClick={() => setTendency(v)} style={{ width: 38, cursor: "pointer", fontSize: 16, borderRadius: CONTROL_R, fontWeight: 700, border: tendency === v ? "1px solid var(--accent)" : "1px solid var(--border2)", background: tendency === v ? "var(--accent-bg)" : "var(--card)", color: tendency === v ? "var(--accent)" : "var(--text2)" }}>{label}</button>
              ))}
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder={t("noten.obsPlaceholder")}
              onKeyDown={(e) => { if (e.key === "Enter" && catId) { onSave({ category_id: catId, student_id: student.student_id, kind: "observation", tendency, note }); setNote(""); } }}
              style={{ ...inp, marginBottom: 12 }} />
            <button onClick={() => { onSave({ category_id: catId, student_id: student.student_id, kind: "observation", tendency, note }); setNote(""); }} disabled={!catId} style={{ ...btnPrimary, opacity: catId ? 1 : 0.4, marginBottom: 16 }}>{t("noten.note")}</button>
          </>
        )}
        {entries.map((e) => {
          const k = cats.find((c) => c.id === e.category_id);
          return (
            <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderTop: "1px solid var(--border)", fontSize: 13 }}>
              <span style={{ width: 62, color: "var(--text3)" }}>{new Date(e.date).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}</span>
              <span style={{ width: 14, fontWeight: 700, color: e.tendency > 0 ? C.success : e.tendency < 0 ? C.danger : "var(--text3)" }}>{e.tendency > 0 ? "+" : e.tendency < 0 ? "−" : "·"}</span>
              <span style={{ flex: 1, minWidth: 0 }}><span style={{ color: "var(--text3)" }}>{k?.name}: </span>{e.note}</span>
              <button onClick={() => onDelete(e.id)} className="icon-btn" style={iconBtn} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} color={C.danger} /></button>
            </div>
          );
        })}
        <button onClick={onClose} style={{ ...btnSecondary, marginTop: 16 }}>{t("noten.close")}</button>
    </UiModal>
  );
}

// Jahresuebersicht: Bereichsnoten beider Halbjahre, die zwei Halbjahresnoten
// und die Jahresnote (Mittel der beiden, per Klick ueberschreibbar).
function YearTable({ t, data, cls, onSet, onReset, editing, setEditing, onInfo }) {
  const { sections = [], rows = [] } = data || {};
  // Derselbe Kopf-Mechanismus wie in der Halbjahres-Tabelle: eigener
  // Scrollrahmen, zweite Kopfzeile klebt um die gemessene Hoehe der ersten
  // tiefer. Ohne das lagen beide Zeilen aufeinander und die erste Schuelerzeile
  // schob sich darunter — genau das war in der Jahresansicht zu sehen.
  const { rahmenRef, kopf1Ref, th2 } = useKlebenderKopf();
  const sec1 = sections.filter((s) => s.term === "1");
  const sec2 = sections.filter((s) => s.term === "2");
  if (rows.length === 0) return <p style={{ fontSize: 14, color: "var(--text3)", marginTop: 8 }}>{t("noten.noStudents")}</p>;
  const grp = { ...th, borderLeft: "2px solid var(--border3)", fontSize: 13 };
  const secCols = (secs) => secs.map((s, i) => (
    <th key={s.id} style={{ ...th2, borderLeft: i === 0 ? "2px solid var(--border3)" : "1px solid var(--border)", minWidth: 56, fontWeight: 500 }}>{s.name}</th>
  ));
  return (
    <div ref={rahmenRef} style={{ overflow: "auto", maxHeight: "calc(100vh - 210px)", border: "1px solid var(--border)", borderRadius: panelStyle.borderRadius, WebkitOverflowScrolling: "touch", "--tabellenkopf-top": "0px" }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: 14, minWidth: "100%" }}>
        <thead>
          <tr ref={kopf1Ref}>
            <th style={{ ...th, ...stickyLh, whiteSpace: "nowrap" }}></th>
            <th colSpan={sec1.length + 1} style={grp}>{t("noten.term1")}</th>
            <th colSpan={sec2.length + 1} style={grp}>{t("noten.term2")}</th>
            <th rowSpan={2} style={{ ...grp, fontWeight: 700 }}>{t("noten.yearGrade")}</th>
          </tr>
          <tr>
            <th style={{ ...th2, ...stickyLh, textAlign: "left" }}>{cls?.name}</th>
            {secCols(sec1)}
            <th style={{ ...th2, borderLeft: "1px solid var(--border)", fontWeight: 700 }}>{t("noten.termGrade")}</th>
            {secCols(sec2)}
            <th style={{ ...th2, borderLeft: "1px solid var(--border)", fontWeight: 700 }}>{t("noten.termGrade")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r.student_id}>
              <td style={{ ...td, ...stickyL, textAlign: "left", padding: 0 }}>
                <button onClick={() => onInfo(r.student_id)} title={t("noten.studentInfo")}
                  style={{ width: "100%", textAlign: "left", padding: "6px 8px", border: "none", background: "none", color: "var(--text)", fontWeight: 500, cursor: "pointer" }}>
                  <span style={{ color: "var(--text3)", fontWeight: 400, marginRight: 8 }}>{ri + 1}.</span>{r.name}
                </button>
              </td>
              {sec1.map((s, i) => (
                <td key={s.id} style={{ ...td, borderLeft: i === 0 ? "2px solid var(--border3)" : "1px solid var(--border)" }}>
                  {r.section_grades[String(s.id)] != null ? de(r.section_grades[String(s.id)]) : <span style={{ color: "var(--border2)" }}>·</span>}
                </td>
              ))}
              <td style={{ ...td, borderLeft: "1px solid var(--border)", fontWeight: 700 }}>
                {r.term_ends["1"] != null ? de(r.term_ends["1"]) : <span style={{ color: "var(--border2)" }}>·</span>}
              </td>
              {sec2.map((s, i) => (
                <td key={s.id} style={{ ...td, borderLeft: i === 0 ? "2px solid var(--border3)" : "1px solid var(--border)" }}>
                  {r.section_grades[String(s.id)] != null ? de(r.section_grades[String(s.id)]) : <span style={{ color: "var(--border2)" }}>·</span>}
                </td>
              ))}
              <td style={{ ...td, borderLeft: "1px solid var(--border)", fontWeight: 700 }}>
                {r.term_ends["2"] != null ? de(r.term_ends["2"]) : <span style={{ color: "var(--border2)" }}>·</span>}
              </td>
              <td style={{ ...td, padding: 0, borderLeft: "2px solid var(--border3)" }}>
                <NoteZelle t={t} bold
                  editing={editing === `end:${r.student_id}`}
                  onEdit={() => setEditing(`end:${r.student_id}`)}
                  value={r.year}
                  isOverride={r.year_override != null}
                  onSave={(txt) => onSet(r.student_id, txt)}
                  onCancel={() => setEditing(null)}
                  onReset={() => onReset(r.student_id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const inp = { ...inputStyle, width: "100%" };
// Aus dem Kern abgeleitet (Icons.jsx), nicht neu gebaut: die Notentabelle
// braucht nur eine kraeftigere Kopflinie und relative Zellen fuer die
// Spalten-Menues.
// position bewusst NICHT auf relative setzen: thBasis klebt (sticky), und
// „relative" hat das stillschweigend abgeschaltet — nur die Zellen mit eigenem
// sticky (die Namensspalte) blieben dann beim Scrollen stehen, der Rest lief
// weg. Als Bezug fuer die absolut gesetzten Menues taugt sticky genauso.
const th = { ...thBasis, borderBottom: "2px solid var(--border3)" };
const td = tdBasis;
// Links klebende Spalte. Der Kopf klebt oben (th in Icons.jsx, z-index 2) —
// eine Zelle, die BEIDES tut, muss darueber liegen, sonst rutscht der Name
// beim Scrollen unter die Kopfzeile.
// Links klebende Zellen. Der Kopf klebt oben (th in Icons.jsx) — eine Zelle,
// die BEIDES tut, muss ueber den Datenzellen UND ueber den uebrigen Kopfzellen
// liegen, sonst schiebt sich beim Scrollen eine Zeile darueber.
const stickyL = { position: "sticky", left: 0, background: "var(--card)", zIndex: 1 };
const stickyLh = { position: "sticky", left: 0, background: "var(--card)", zIndex: 4 };
const dtS = { color: "var(--text3)", fontWeight: 500 };
const ddS = { margin: 0, color: "var(--text)" };
