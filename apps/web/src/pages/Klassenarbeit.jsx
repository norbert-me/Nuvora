// Modul „Klassenarbeit auswerten": Aufgaben mit Thema + Maximalpunkten, dann ein
// Punkte-Raster (Zeilen = SuS, Spalten = Aufgaben, Zelle = erreichte Punkte).
// Daraus LIVE je SuS ein Fehlerprofil nach Thema, eine Note (Punkte/Max → Skala)
// und gezielte Wiederholung (Karten des schwachen Themas wieder fällig).
import { useState, useEffect, useRef, useMemo, Fragment } from "react";
import { useSearchParams } from "react-router-dom";
import { Boxplot, COLORS as C, CONTROL_R, Empty, ICONS, Icon, Modal, StatCard, Tabs, btnPrimary, btnSecondary, cardStyle, chipStyle, iconBtn, inputStyle, klebtLinks, pageApp, panelStyle, selectStyle, td as tdBase, th as thBase, toolbarBtn, toolbarIconBtn } from "../components/Icons.jsx";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import { DialogFuss, useEntwurf } from "../components/Speichern.jsx";
import SpeicherBalken from "../components/SpeicherBalken.jsx";
import FruehwarnPanel from "../components/Fruehwarnung.jsx";
import MaterialPanel from "../components/MaterialPanel.jsx";
import Themenstand from "../components/Themenstand.jsx";
import { themenIndex, useThemen } from "../core/topics.js";
import KursKlasseSelect from "../components/KursKlasseSelect.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { useAktiv } from "../core/modules.js";
import { askConfirm, showAlert } from "../core/dialog.jsx";
import { rememberClass } from "../core/cache.js";
import { gradeFromPct, gradeDetailed, quantile, stdev, DEFAULT_SCALE } from "../core/grades.js";
import { useKlassenListe, useUrlClass } from "../core/klassenwahl.js";
import { alsJson, hol } from "../core/melden.js";
import NotenUebernahme from "../components/NotenUebernahme.jsx";
import { konfidenzProzent, mittel, streuung, trennschaerfe } from "../core/aufgabenstatistik.js";
import { komma, kommaRund, prozent, rund } from "../core/zahl.js";

const API = "/api/klassenarbeit";

// ─── Fehlerarten ───
// Wortgleich mit FEHLER_VALUES in klassenarbeit.py — der Server nimmt nichts
// anderes an. Reihenfolge = Klick-Kreislauf in der Zelle (leer → … → leer).
// Die Kuerzel stehen in der Zelle, der ganze Name im Titel: das Raster ist
// ohnehin breiter als der Bildschirm.
const FEHLER = [
  { key: "ansatz", ab: "A", color: C.danger },
  { key: "rechnen", ab: "R", color: C.warning },
  { key: "fluechtig", ab: "F", color: C.info },
  { key: "darstellung", ab: "D", color: "#7c3aed" },
  { key: "leer", ab: "–", color: "var(--text3)" },
];
const FEHLER_CYCLE = ["", ...FEHLER.map((f) => f.key)];
// Das Kuerzel in der Zelle: abgeleitet aus chipStyle (dieselbe Pillenform wie
// ueberall), nur schmaler — es steht unter einem 42 px breiten Zahlenfeld.
const fehlerChip = { ...chipStyle, fontSize: 11, fontWeight: 700, padding: "1px 6px", minWidth: 20, textAlign: "center" };
const newId = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Eine Zeile „je Aufgabe/Teilaufgabe": Label, Ø-Punkte, farbige %-Zahl, Balken
// auf eigener Zeile und (optional) Trennschärfe + 95%-KI darunter. Gemeinsam für
// „je Aufgabe" und „je Teilaufgabe", damit beide gleich aussehen.
// Was folgt aus den Zahlen? Die Reihenfolge ist die Reihenfolge der Dringlichkeit,
// und jeder Satz nennt den Wert, aus dem er stammt — eine Empfehlung ohne Beleg
// waere ein Orakel, und die Lehrkraft muss sie gegen ihre Klasse pruefen koennen.
//
// Der Kern der Sache: eine niedrige Trefferquote allein sagt nur „schwer". Erst
// zusammen mit der Trennschaerfe wird daraus eine Handlung — trennt die Aufgabe
// gut, kann die Klasse den Stoff nicht (also: wiederholen); trennt sie nicht,
// liegt es an der Aufgabe (also: Formulierung und Erwartungshorizont ansehen).
function schluss(row, t) {
  if (row.form) return null;                       // Darstellung: keine Sachaussage
  const d = row.disc, p = row.pct, n = row.nullAnteil;
  if (d != null && d < 0.1 && p < 75) return { art: "aufgabe", text: t("klassenarbeit.tipTask", { d: kommaRund(d, 2) }) };
  if (n != null && n >= 40 && p < 60) return { art: "aufgabe", text: t("klassenarbeit.tipEmpty", { n }) };
  if (p < 50 && (d == null || d >= 0.3)) return { art: "stoff", text: t("klassenarbeit.tipRepeat", { p }) };
  if (p >= 90 && row.vollAnteil != null && row.vollAnteil >= 70) return { art: "leicht", text: t("klassenarbeit.tipEasy", { v: row.vollAnteil }) };
  return null;
}

function StatRow({ row, t, expandable, open, onToggle, small }) {
  const col = row.pct < 50 ? C.danger : row.pct < 75 ? C.warning : C.success;
  const dc = row.disc == null ? "var(--text3)" : row.disc >= 0.4 ? C.success : row.disc >= 0.2 ? C.warning : C.danger;
  const rat = small ? null : schluss(row, t);
  return (
    <div onClick={expandable ? onToggle : undefined} style={{ padding: small ? "6px 9px" : "8px 10px", borderRadius: panelStyle.borderRadius, background: small ? "var(--bg3)" : "var(--bg2)", marginBottom: 4, cursor: expandable ? "pointer" : "default" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {expandable && <span style={{ display: "inline-flex", color: "var(--text3)", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}><Icon d={ICONS.open} size={12} /></span>}
        <span style={{ flex: 1, fontSize: small ? 12 : 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: small ? "var(--text2)" : "var(--text)" }}>{small ? `${t("klassenarbeit.part")} ${row.label}` : row.label}</span>
        <span style={{ fontSize: 12, color: "var(--text3)", whiteSpace: "nowrap" }}>⌀ {komma(row.avgP)}/{row.max}</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: col, minWidth: 40, textAlign: "right" }}>{row.pct}%</span>
      </div>
      {/* Balken: Radius = halbe Hoehe (Balken-Kappe), reine Grafik. */}
      <div style={{ marginTop: 4, height: 8, background: "var(--card)", borderRadius: 5, overflow: "hidden" }}>
        <span style={{ display: "block", width: `${row.pct}%`, height: "100%", background: col, borderRadius: 5 }} />
      </div>
      {(row.disc != null || row.ciLow != null || row.nullAnteil != null) && (
        <div style={{ display: "flex", gap: 14, fontSize: 11, color: "var(--text3)", marginTop: 4, flexWrap: "wrap" }}>
          {row.disc != null && <span title={t("klassenarbeit.discHint")}>{t("klassenarbeit.disc")}: <b style={{ color: dc }}>{kommaRund(row.disc, 2)}</b></span>}
          {row.ciLow != null && <span title={t("klassenarbeit.ciHint")}>{t("klassenarbeit.ci")}: <b style={{ color: "var(--text2)" }}>{row.ciLow}–{row.ciHigh}%</b></span>}
          {row.nullAnteil != null && <span title={t("klassenarbeit.cmpEmptyHint")}>{t("klassenarbeit.cmpEmpty")}: <b style={{ color: row.nullAnteil >= 40 ? C.danger : "var(--text2)" }}>{row.nullAnteil}%</b></span>}
          {row.vollAnteil != null && <span title={t("klassenarbeit.cmpFullHint")}>{t("klassenarbeit.cmpFull")}: <b style={{ color: "var(--text2)" }}>{row.vollAnteil}%</b></span>}
        </div>
      )}
      {/* Der Schluss aus den Zahlen — nicht nur die Zahlen. */}
      {rat && (
        <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.45, padding: "6px 8px", borderRadius: panelStyle.borderRadius,
          background: rat.art === "aufgabe" ? C.danger + "14" : rat.art === "stoff" ? C.warning + "1a" : "var(--card)",
          color: rat.art === "leicht" ? "var(--text3)" : "var(--text2)" }}>
          {rat.text}
        </div>
      )}
    </div>
  );
}

export default function Klassenarbeit() {
  const { t } = useLanguage();
  const aktiv = useAktiv();
  const kartenAktiv = aktiv("karten");
  const lernpfadAktiv = aktiv("lernpfad");
  const notenAktiv = aktiv("auswertung");
  const [notenModal, setNotenModal] = useState(false);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  useEffect(() => { try { const u = JSON.parse(localStorage.getItem("user")); if (u?.grade_scale) setScale(u.grade_scale); } catch { /* Default */ } }, []);
  const [hideIndividual, setHideIndividual] = useState(false); // #55: SuS-Ansicht — einzelne Leistungen + Noten aus
  const [fehlerModus, setFehlerModus] = useState(false);      // Fehlerart je Zelle erfassen (aus)
  const [scaleOpen, setScaleOpen] = useState(false); // Notenschlüssel-Editor auf/zu
  const [expandedTasks, setExpandedTasks] = useState(() => new Set()); // aufgeklappte Teilaufgaben-Auswertung
  const [infoOpen, setInfoOpen] = useState(false); // „Auswertung verstehen"
  const [distMode, setDistMode] = useState("bar");   // Notenverteilung: "bar" | "box"
  const [barMode, setBarMode] = useState("whole");   // Balken: "whole" (1..6) | "fine" (Teilnoten)
  const [boxMode, setBoxMode] = useState("pct");     // Boxplot: "pct" (%) | "note" (Noten)
  // Note-Anzeige NUR aus der Profil-Präferenz (eine Person, eine Präferenz —
  // kein Umschalter je Seite mehr). "note" = Symbol 2+, "wert" = Dezimal 2,3.
  const gradeMode = (() => { try { const u = JSON.parse(localStorage.getItem("user")); return u && u.grade_tendency === false ? "wert" : "note"; } catch { return "note"; } })();
  // Deep-Link aus dem Kalender: ?class=…&work=… öffnet direkt die verknüpfte
  // Auswertung. Klasse als Startwert, gewünschte Auswertung merken bis geladen.
  const [params] = useSearchParams();
  const wantWork = useRef(Number(params.get("work")) || null);
  const [classId, setClassId] = useState(Number(params.get("class")) || null);
  // Kurs aus dem Deep-Link: eine Klasse kann in mehreren Kursen liegen — ohne
  // diesen Hinweis riete die Auswahl den ersten Kurs (Bug: „7.5" gewählt, Arbeit
  // landet unter „7.5 LZ"). Als kursValue an KursKlasseSelect weitergereicht.
  const [kursId, setKursId] = useState(Number(params.get("kurs")) || null);
  // Aus dem Kurs verlinkt (?class=&kurs=): dann diesen Inhalt zeigen.
  useUrlClass(setClassId, setKursId);
  const [subsetKurs, setSubsetKurs] = useState(null); // gewählter Teilkurs (Kurs aus Teilen von Klassen) oder null
  const [subsetKurse, setSubsetKurse] = useState([]); // Kurse mit einzeln hinzugefügten SuS
  const [students, setStudents] = useState([]);
  // Kern-Themen aus core/topics.js — dieselbe Zeile stand auf sechs Seiten.
  const topics = useThemen();
  const [works, setWorks] = useState([]);
  // Serverstand der Arbeit (Basis) — die Arbeitskopie liegt im Entwurf.
  const [savedWork, setSavedWork] = useState(null);
  // Eine andere Arbeit (oder ein Neuladen) beendet die Arbeitskopie: `useEntwurf`
  // haelt sonst an ihr fest und zeigte die Punkte der vorigen Arbeit weiter.
  const frisch = useRef(false);
  const zeigeArbeit = (w) => { frisch.current = true; setSavedWork(w); }; // { id, name, tasks:[{id,label,topic_id}], results:{sid:[taskId]} }
  const [busy, setBusy] = useState(false);
  const kq = kursId != null ? `?kurs_id=${kursId}` : "";

  // Teilkurse (Kurse aus Teilen von Klassen = einzeln hinzugefügte SuS) laden.
  useEffect(() => { hol("/api/kurse").then((d) => setSubsetKurse((Array.isArray(d) ? d : []).filter((k) => k.member_count > 0))); }, []);
  // Beim ersten Besuch gleich eine Klasse wählen (zuletzt genutzte, sonst erste),
  // damit die Arbeitsauswahl nicht ausgeblendet bleibt, bis man von Hand klickt.
  // Dieselbe Vorwahl wie ueberall (core/klassenwahl.js). Sie lief hier als
  // einzige mit rohem `fetch` statt `swr` — ohne Cache und ohne Grund.
  useKlassenListe(null, setClassId);
  const repClass = useRef(null); // Referenz-Klasse eines Teilkurses (für work.class_id, FK)
  // Laufende Nummer je Ladevorgang. Der Effekt feuert zweimal kurz nacheinander:
  // erst mit kursId = null (Anfangszustand), dann mit dem Kurs aus der Adresse.
  // Ohne kurs_id liefert list_works nur die KURSLOSEN Arbeiten (klassenarbeit.py,
  // `kurs_id.is_(None)`) — also meist eine leere Liste. Kommt diese veraltete
  // Antwort als zweite an, loescht sie die eben geladene Auswahl, und mit ihr
  // verschwinden alle Knoepfe, die an einer gewaehlten Arbeit haengen. Das war
  // reines Glueck: in drei von fuenf Laeufen ging das Rennen falsch aus.
  const ladenr = useRef(0);
  useEffect(() => {
    // Teilkurs (Kurs aus Teilen von Klassen): Roster + Arbeiten über den Kurs.
    if (subsetKurs) {
      fetch(`${API}/kurse/${subsetKurs}/students`).then((r) => (r.ok ? r.json() : [])).then((list) => {
        const studs = Array.isArray(list) ? list : []; setStudents(studs);
        const rep = studs[0]?.class_id || null; repClass.current = rep;
        if (rep) hol(`${API}/classes/${rep}/works?kurs_id=${subsetKurs}`).then((d) => { const l = Array.isArray(d) ? d : []; setWorks(l); zeigeArbeit(l[0] || null); });
        else { setWorks([]); zeigeArbeit(null); }
      }).catch(() => { setStudents([]); setWorks([]); zeigeArbeit(null); });
      return;
    }
    repClass.current = null;
    if (classId) rememberClass(classId);
    if (!classId) { setStudents([]); setWorks([]); zeigeArbeit(null); return; }
    const meine = ++ladenr.current;   // nur die jüngste Antwort darf schreiben
    hol(`${API}/classes/${classId}/students`).then((d) => {
      if (meine === ladenr.current) setStudents(Array.isArray(d) ? d : []);
    });
    hol(`${API}/classes/${classId}/works${kq}`).then((d) => {
      if (meine !== ladenr.current) return;
      const l = Array.isArray(d) ? d : [];
      setWorks(l);
      // Deep-Link: gewünschte Auswertung wählen, sonst die neueste.
      const target = wantWork.current ? l.find((x) => x.id === wantWork.current) : null;
      if (target) wantWork.current = null;
      zeigeArbeit(target || l[0] || null);
    });
  }, [classId, kursId, subsetKurs]);

  // Beschriftung UND Reihenfolge aus core/topics.js — die eine Quelle. Die
  // frueher hier nachgebaute Fassung konnte nur beschriften; die Auswahl stand
  // dann in der Reihenfolge des Servers (position, name), also alphabetisch
  // nach dem UNTERthema: „… / 1 Kreis" landete zwischen fremden Oberthemen.
  const themen = themenIndex(topics);
  const topicLabel = (id) => themen.labelFuerId(id);

  // ── Ein Entwurf für die ganze Arbeit ──
  // Vorher schrieb ein Zeitgeber 600 ms nach dem letzten Tastendruck — man sah
  // nie, ob etwas drin ist. Jetzt sammelt der Entwurf Aufgaben, Punkte,
  // Notenschlüssel und „krank"; geschrieben wird mit der Leiste unten.
  const entwurf = useEntwurf(savedWork, async (next) => {
    if (!next || !next.id) return false;
    // scale: echtes dict = Override, sonst {} (Server setzt zurueck auf Profil).
    const scaleOut = (next.scale && Object.keys(next.scale).length) ? next.scale : {};
    const r = await fetch(`${API}/works/${next.id}`, alsJson("PUT", { name: next.name, tasks: next.tasks, results: next.results, scale: scaleOut, absent: next.absent || [], fehler: next.fehler || {} })).catch(() => null);
    if (!r || !r.ok) { showAlert(t("common.notWork")); return false; }
    setSavedWork(next);
    setWorks((ws) => ws.map((x) => (x.id === next.id ? { ...x, name: next.name } : x)));
    return true;
  });
  useEffect(() => { if (frisch.current) { frisch.current = false; entwurf.verwerfen(); } });
  const work = entwurf.wert;
  // Der Name bleibt: jede Geste geht weiter denselben einen Weg — nur endet er
  // jetzt im Entwurf statt beim Server.
  const persist = (next) => entwurf.setz(next);
  // Andere Arbeit / andere Klasse gewählt: nachfragen, sonst wäre die
  // Arbeitskopie still weg.
  const wechseln = (fn) => { if (entwurf.geaendert && !window.confirm(t("speichern.verlassen"))) return; fn(); };

  const neueArbeit = async () => {
    // Teilkurs: class_id = Referenz-Klasse (FK), kurs_id = Teilkurs (Roster kommt daraus).
    const cid = subsetKurs ? repClass.current : classId;
    const kid = subsetKurs || kursId;
    if (!cid) return;
    // Datum mitgeben: der Server markiert daraus die Kinder, die heute fehlen,
    // gleich als abwesend (nur mit Modul Orga). Vergisst man das von Hand,
    // rutschen Nullen in die Wertung.
    const res = await fetch(`${API}/works`,
      alsJson("POST", { class_id: cid, kurs_id: kid, name: t("klassenarbeit.newName"), datum: new Date().toISOString() })).catch(() => null);
    if (res && res.ok) { const w = await res.json(); setWorks((p) => [w, ...p]); zeigeArbeit(w); }
  };
  const [kopieOffen, setKopieOffen] = useState(false);
  // Kopie in eine andere Klasse: Aufgaben, Themen, Notenschluessel und die
  // Anhaenge kommen mit, die Punkte NICHT — sie gehoeren zu Kindern, die es in
  // der anderen Klasse nicht gibt.
  const kopieren = async (zielClassId, zielKursId, name) => {
    const r = await fetch(`${API}/works/${work.id}/copy`, alsJson("POST", { class_id: zielClassId, kurs_id: zielKursId ?? null, name })).catch(() => null);
    if (!r || !r.ok) return false;
    const neu = await r.json();
    setKopieOffen(false);
    // Direkt hinspringen: die Kopie ist das, womit weitergearbeitet wird.
    setClassId(zielClassId); setKursId(zielKursId ?? null); setSubsetKurs(null);
    setWorks((ws) => [neu, ...ws]); zeigeArbeit(neu);
    return true;
  };

  const loeschen = async () => {
    if (!work || !(await askConfirm(t("klassenarbeit.delConfirm", { name: work.name })))) return;
    await fetch(`${API}/works/${work.id}`, { method: "DELETE" }).catch(() => {});
    setWorks((p) => p.filter((x) => x.id !== work.id)); zeigeArbeit(null);
  };

  // Ein „Teil" (Teilaufgabe a/b/c…) ist die kleinste Wertungseinheit. Hat eine
  // Aufgabe keine Teile, gilt sie selbst als eine Einheit (id + max) — so bleibt
  // das alte Format (Aufgabe ohne Teile) unverändert gültig.
  const units = (task) => (task.parts && task.parts.length) ? task.parts : [{ id: task.id, label: "", max: Number(task.max) > 0 ? Number(task.max) : 1 }];
  const unitMax = (u) => (Number(u.max) > 0 ? Number(u.max) : 1);
  const taskMax = (task) => units(task).reduce((n, u) => n + unitMax(u), 0);
  const partLabel = (i) => String.fromCharCode(97 + i); // a, b, c …
  const cleanResults = (results, removeIds) => Object.fromEntries(
    Object.entries(results || {})
      .map(([s, m]) => (m === "abwesend" ? [s, m] : [s, Object.fromEntries(Object.entries(m || {}).filter(([k]) => !removeIds.has(String(k))))]))
      .filter(([, m]) => m === "abwesend" || Object.keys(m).length));

  // Dieselbe Saeuberung fuer die Fehlerarten: verschwindet eine Teilaufgabe,
  // darf ihre Fehlerangabe nicht als Waise stehenbleiben (der Server wirft sie
  // beim naechsten Speichern ohnehin weg — dann aber ohne dass die Seite es
  // zeigt, und die Auswertung waere bis zum Neuladen zu hoch).
  const cleanFehler = (fehler, removeIds) => Object.fromEntries(
    Object.entries(fehler || {})
      .map(([sid, m]) => [sid, Object.fromEntries(Object.entries(m || {}).filter(([k]) => !removeIds.has(String(k))))])
      .filter(([, m]) => Object.keys(m).length));

  const addTask = () => persist({ ...work, tasks: [...(work.tasks || []), { id: newId(), label: "", topic_id: null, max: 1, form: false, parts: [] }] });
  const setTask = (id, patch) => persist({ ...work, tasks: work.tasks.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const delTask = (id) => {
    const tk = (work.tasks || []).find((x) => x.id === id);
    const ids = new Set(tk ? units(tk).map((u) => String(u.id)) : [String(id)]);
    persist({ ...work, tasks: work.tasks.filter((x) => x.id !== id), results: cleanResults(work.results, ids), fehler: cleanFehler(work.fehler, ids) });
  };
  // Teilaufgaben: eine erste Teilaufgabe erbt id+max der Aufgabe (Punkte bleiben).
  const addPart = (tid) => {
    const tk = work.tasks.find((x) => x.id === tid); if (!tk) return;
    const parts = (tk.parts && tk.parts.length) ? [...tk.parts] : [{ id: tk.id, label: "a", max: Number(tk.max) > 0 ? Number(tk.max) : 1 }];
    parts.push({ id: newId(), label: partLabel(parts.length), max: 1, topic_id: null });
    setTask(tid, { parts });
  };
  const setPart = (tid, pid, patch) => {
    const tk = work.tasks.find((x) => x.id === tid); if (!tk) return;
    setTask(tid, { parts: units(tk).map((u) => (u.id === pid ? { ...u, ...patch } : u)) });
  };
  const delPart = (tid, pid) => {
    const tk = work.tasks.find((x) => x.id === tid); if (!tk) return;
    const parts = units(tk).filter((u) => u.id !== pid);
    const weg = new Set([String(pid)]);
    const results = cleanResults(work.results, weg);
    const fehler = cleanFehler(work.fehler, weg);
    // Bleibt nur ein Teil übrig: zurück zur „ohne Teile"-Form (Max an der Aufgabe).
    if (parts.length <= 1) { const only = parts[0]; persist({ ...work, tasks: work.tasks.map((x) => (x.id === tid ? { ...x, parts: [], max: only ? unitMax(only) : 1 } : x)), results, fehler }); }
    else persist({ ...work, tasks: work.tasks.map((x) => (x.id === tid ? { ...x, parts } : x)), results, fehler });
  };
  // Fehlerart je Zelle: leer → ansatz → rechnen → … → leer. Ein Klick statt
  // eines Auswahlfelds, weil beim Korrigieren jede Zelle einmal angefasst wird
  // und ein Dropdown je Zelle drei Handgriffe braucht statt einem.
  const fehlerOf = (sid, uid) => ((work.fehler || {})[String(sid)] || {})[uid] || "";
  const cycleFehler = (sid, uid) => {
    const cur = fehlerOf(sid, uid);
    const naechste = FEHLER_CYCLE[(FEHLER_CYCLE.indexOf(cur) + 1) % FEHLER_CYCLE.length];
    const zeile = { ...((work.fehler || {})[String(sid)] || {}) };
    if (naechste) zeile[uid] = naechste; else delete zeile[uid];
    const fehler = { ...(work.fehler || {}) };
    if (Object.keys(zeile).length) fehler[String(sid)] = zeile; else delete fehler[String(sid)];
    persist({ ...work, fehler });
  };

  const pointsOf = (sid, uid) => { const v = ((work.results || {})[String(sid)] || {})[uid]; return v == null ? "" : v; };
  const setPoints = (sid, uid, val) => {
    const row = { ...((work.results || {})[String(sid)] || {}) };
    if (val === "" || val == null) delete row[uid]; else row[uid] = Math.max(0, Number(val));
    const results = { ...(work.results || {}) };
    if (Object.keys(row).length) results[String(sid)] = row; else delete results[String(sid)];
    persist({ ...work, results });
  };
  const totalMax = () => (work.tasks || []).reduce((n, tk) => n + taskMax(tk), 0);
  // Ist zu diesem Kind ueberhaupt etwas erfasst? Eine eingetragene 0 zaehlt,
  // ein leeres Feld nicht — genau darin unterscheiden sich „hat nichts
  // geloest" und „ist noch nicht korrigiert".
  const hatPunkte = (sid) => {
    const r = (work.results || {})[String(sid)];
    if (!r) return false;
    if (r === "abwesend") return true;
    if (Array.isArray(r)) return true;                       // Altformat
    return Object.values(r).some((v) => v != null && v !== "");
  };

  const sumOf = (sid) => { const r = (work.results || {})[String(sid)]; if (!r || r === "abwesend") return 0; return (work.tasks || []).reduce((n, tk) => n + units(tk).reduce((m, u) => { const v = r[u.id]; return m + (v == null ? 0 : Number(v)); }, 0), 0); };
  // Abwesend ist ein eigenes Feld (work.absent) — die Punkte in results bleiben
  // erhalten, „abwesend" heisst nur „aus der Klassenstatistik raus". Alt-Marker
  // (results[sid] === "abwesend", ohne Punkte) wird weiter als abwesend erkannt.
  const isAbsent = (sid) => ((work.absent || []).map(String).includes(String(sid))) || (work.results || {})[String(sid)] === "abwesend";
  const toggleAbsent = (sid) => {
    const key = String(sid);
    const cur = new Set((work.absent || []).map(String));
    const results = { ...(work.results || {}) };
    const wasLegacy = results[key] === "abwesend";
    if (wasLegacy) delete results[key];                 // alten Marker aufloesen
    if (cur.has(key) || wasLegacy) cur.delete(key); else cur.add(key);
    persist({ ...work, results, absent: [...cur] });
  };

  // Gültiger Notenschlüssel: Override der Arbeit, sonst Profil-Voreinstellung.
  const effScale = (work && work.scale && Object.keys(work.scale).length) ? work.scale : scale;
  const setWorkScale = (next) => persist({ ...work, scale: next });

  // Auswertung LIVE aus dem Raster (kein Button, kein Server-Call): je Thema die
  // Trefferquote der Klasse + je SuS die schwachen Themen (≥ 50 % falsch).
  const analyse = useMemo(() => {
    if (!work) return null;
    const tasks = work.tasks || [];
    const results = work.results || {};
    const uMax = {}; tasks.forEach((tk) => units(tk).forEach((u) => { uMax[u.id] = unitMax(u); }));
    // Themen je WERTUNGSEINHEIT, nicht je Aufgabe: eine Teilaufgabe kann ein
    // eigenes Thema tragen und erbt sonst das der Aufgabe. Dieselbe Regel wie im
    // Server (_units_mit_thema in klassenarbeit.py) — beide Seiten müssen hier
    // dasselbe rechnen, sonst zeigt die Seite andere Zahlen als die Auswertung.
    const topicUnits = {};
    const unitTopic = {};   // Einheit → Thema (fuer die Fehlerarten weiter unten)
    tasks.forEach((tk) => units(tk).forEach((u) => {
      const tid = u.topic_id || tk.topic_id;
      if (tid) { (topicUnits[tid] ||= []).push(u); unitTopic[u.id] = tid; }
    }));
    const pu = (sid, uid) => { const r = results[String(sid)]; if (!r || r === "abwesend") return 0; const v = r[uid]; return v == null ? 0 : Number(v); };
    const pt = (sid, tk) => units(tk).reduce((n, u) => n + pu(sid, u.id), 0);      // Punkte einer Aufgabe
    const tkMax = (tk) => units(tk).reduce((n, u) => n + uMax[u.id], 0);
    // Zeilen ohne jeden Eintrag zählen als 0 (leere/durchgefallene Arbeit) — nur
    // „krank" (abwesend) bleibt aussen vor. Damit die Auswertung aber nicht schon
    // vor der ersten Eingabe voller Nullen steht, erst wenn irgendein Wert da ist.
    const absent = new Set([...((work.absent) || []).map(String), ...Object.entries(results).filter(([, v]) => v === "abwesend").map(([k]) => k)]);
    // Gewertet wird, wer erfasst IST — nicht die ganze Klasse, sobald das erste
    // Kind korrigiert ist. Sonst zieht jede noch leere Zeile den Schnitt mit
    // einer 0 nach unten, und die Notenverteilung zeigt eine Wand aus Sechsen,
    // waehrend man noch am Korrigieren ist. Eine bewusst eingetragene 0 zaehlt,
    // ein leeres Feld nicht.
    const erfasstIst = (s) => {
      const r = results[String(s.id)];
      if (absent.has(String(s.id)) || !r || r === "abwesend") return false;
      if (Array.isArray(r)) return true;                 // Altformat
      return Object.values(r).some((v) => v != null && v !== "");
    };
    const graded = students.filter(erfasstIst);
    // Gesamtpunkte je SuS (für Trennschärfe = Item-Total-Korrelation).
    const totals = graded.map((s) => tasks.reduce((n, tk) => n + pt(s.id, tk), 0));
    const mean = mittel, sdOf = streuung;   // beide aus core/aufgabenstatistik.js

    const topicsOut = Object.entries(topicUnits).map(([tid, us]) => {
      let e = 0, m = 0; graded.forEach((s) => us.forEach((u) => { e += pu(s.id, u.id); m += uMax[u.id]; }));
      return { topic_id: Number(tid), label: topicLabel(Number(tid)), pct: m ? Math.round((e / m) * 100) : 0 };
    }).sort((a, b) => a.pct - b.pct);
    // Nach Thema gruppiert: {label, namen[], anteil}. Sortiert nach Anzahl —
    // das Thema, an dem die halbe Klasse haengt, gehoert nach oben, nicht das
    // erste im Alphabet.
    const weakGroups = (() => {
      const map = new Map();
      graded.forEach((s) => {
        Object.entries(topicUnits).forEach(([tid, us]) => {
          let e = 0, m = 0; us.forEach((u) => { e += pu(s.id, u.id); m += uMax[u.id]; });
          if (m && e / m < 0.5) {
            const label = topicLabel(Number(tid));
            if (!map.has(label)) map.set(label, []);
            map.get(label).push(s.name);
          }
        });
      });
      return [...map.entries()]
        .map(([label, namen]) => ({ label, namen, anteil: graded.length ? Math.round(namen.length / graded.length * 100) : 0 }))
        .sort((a, b) => b.namen.length - a.namen.length);
    })();

    const studentsOut = graded.map((s) => {
      const weak = Object.entries(topicUnits).filter(([, us]) => { let e = 0, m = 0; us.forEach((u) => { e += pu(s.id, u.id); m += uMax[u.id]; }); return m && e / m < 0.5; }).map(([tid]) => topicLabel(Number(tid)));
      return weak.length ? { student_id: s.id, name: s.name, weak } : null;
    }).filter(Boolean);
    // je Aufgabe: Ø-Punkte (⌀/Max), Trefferquote, Trennschärfe (Item-Total-
    // Korrelation) und 95%-Konfidenzintervall der mittleren Trefferquote.
    const perTask = tasks.map((tk, i) => {
      const xs = graded.map((s) => pt(s.id, tk));
      const mx = tkMax(tk);
      const e = xs.reduce((a, b) => a + b, 0);
      const m = graded.length * mx;
      const avgP = mean(xs);
      // Trennschärfe und 95%-KI rechnet core/aufgabenstatistik.js — dieselben
      // vierzehn Zeilen standen hier und gleich noch einmal bei den Teilaufgaben.
      const disc = trennschaerfe(xs, totals);
      const { ciLow, ciHigh } = konfidenzProzent(xs, mx);
      const nullAnteil = xs.length ? Math.round(xs.filter((x) => x === 0).length / xs.length * 100) : null;
      const vollAnteil = xs.length ? Math.round(xs.filter((x) => x >= mx).length / xs.length * 100) : null;
      return { id: tk.id, label: tk.label || `${i + 1}.`, pct: m ? Math.round((e / m) * 100) : 0,
               avgP: Math.round(avgP * 10) / 10, max: mx, disc, ciLow, ciHigh,
               nullAnteil, vollAnteil, form: !!tk.form };
    });
    // Ø je Teilaufgabe (nur wo eine Aufgabe echte Teile hat) — inkl. Trennschärfe
    // (Item-Total-Korrelation) + 95%-KI, wie bei den ganzen Aufgaben.
    const perUnit = [];
    tasks.forEach((tk, i) => {
      const us = units(tk); if (us.length < 2) return;
      us.forEach((u) => {
        const xs = graded.map((s) => pu(s.id, u.id));
        const umx = uMax[u.id];
        const avgP = mean(xs);
        const disc = trennschaerfe(xs, totals);
        const { ciLow, ciHigh } = konfidenzProzent(xs, umx);
        perUnit.push({ id: u.id, taskId: tk.id, label: u.label || "", avgP: Math.round(avgP * 10) / 10, max: umx, pct: umx ? Math.round((avgP / umx) * 100) : 0, disc, ciLow, ciHigh });
      });
    });

    // Endnote je SuS: Σ/Max → Note mit Tendenz + Notenwert; Verteilung + Kennzahlen.
    const tm = tasks.reduce((n, tk) => n + tkMax(tk), 0);
    const notes = graded.map((s) => { const sum = tasks.reduce((n, tk) => n + pt(s.id, tk), 0); const d = gradeDetailed(tm ? (sum / tm) * 100 : 0, effScale); return { name: s.name, note: d.note, wert: d.wert, grade: d.grade }; });
    const werte = notes.map((x) => x.wert).sort((a, b) => a - b);
    const dist = [1, 2, 3, 4, 5, 6].map((g) => notes.filter((x) => x.grade === g).length);
    // Teilnoten-Verteilung (Tendenz: 1+ 1 2+ 2 2- …) — feinere Alternative.
    // Kein "1+": im Einserband vergibt gradeDetailed keine Tendenz (siehe dort).
    const FINE = ["1", "2+", "2", "2-", "3+", "3", "3-", "4+", "4", "4-", "5+", "5", "5-", "6"];
    const distFine = FINE.map((lbl) => ({ label: lbl, grade: parseInt(lbl), count: notes.filter((x) => x.note === lbl).length }));
    const avg = werte.length ? Math.round((werte.reduce((a, b) => a + b, 0) / werte.length) * 100) / 100 : null;
    const r2 = (x) => rund(x, 2);
    const stats = werte.length ? { min: werte[0], q1: r2(quantile(werte, 0.25)), med: r2(quantile(werte, 0.5)), q3: r2(quantile(werte, 0.75)), max: werte[werte.length - 1], sd: r2(stdev(werte)) } : null;
    const minPts = [1, 2, 3, 4, 5].map((g) => ({ grade: g, pts: Math.ceil(((effScale[g] || 0) / 100) * tm) }));
    // Klassen-Kennzahlen wie CardVote: Ø-Prozent, Median-Prozent, 95%-KI, Anwesend.
    const pctArr = graded.map((s) => (tm ? (tasks.reduce((n, tk) => n + pt(s.id, tk), 0) / tm) * 100 : 0));
    const avgPct = pctArr.length ? Math.round(mean(pctArr)) : null;
    const medPct = pctArr.length ? Math.round(quantile([...pctArr].sort((a, b) => a - b), 0.5)) : null;
    const sdPct = pctArr.length ? Math.round(sdOf(pctArr) * 10) / 10 : null;
    let ciLow = null, ciHigh = null;
    if (pctArr.length >= 2) { const half = 1.96 * (sdOf(pctArr) / Math.sqrt(pctArr.length)); ciLow = Math.max(0, Math.round(mean(pctArr) - half)); ciHigh = Math.min(100, Math.round(mean(pctArr) + half)); }
    const present = graded.length, total = students.length;
    // ── Fehlerarten ──
    // Dieselben zwei Regeln wie im Server (_fehler_gezaehlt in
    // klassenarbeit.py): nur gewertete Kinder, und nur Zellen, in denen
    // wirklich Punkte fehlen. Beide Seiten muessen hier dasselbe rechnen, sonst
    // zeigt die Seite andere Zahlen als die API.
    const fehlerRoh = [];
    graded.forEach((s) => {
      const zeile = (work.fehler || {})[String(s.id)] || {};
      Object.entries(zeile).forEach(([uid, art]) => {
        if (!(uid in uMax)) return;
        if (pu(s.id, uid) >= uMax[uid]) return;
        fehlerRoh.push({ sid: s.id, name: s.name, uid, art, topic: unitTopic[uid] || null });
      });
    });
    const zaehl = (arten) => arten.reduce((d, a2) => ({ ...d, [a2]: (d[a2] || 0) + 1 }), {});
    const fehlerStat = fehlerRoh.length ? (() => {
      const proThema = new Map();
      fehlerRoh.forEach((f) => { if (f.topic) { if (!proThema.has(f.topic)) proThema.set(f.topic, []); proThema.get(f.topic).push(f.art); } });
      const proKind = new Map();
      fehlerRoh.forEach((f) => { if (!proKind.has(f.sid)) proKind.set(f.sid, { name: f.name, arten: [] }); proKind.get(f.sid).arten.push(f.art); });
      return {
        gesamt: zaehl(fehlerRoh.map((f) => f.art)),
        n: fehlerRoh.length,
        topics: [...proThema.entries()]
          .map(([tid, arten]) => ({ label: topicLabel(Number(tid)), typen: zaehl(arten), n: arten.length }))
          .sort((a2, b2) => b2.n - a2.n),
        students: [...proKind.entries()]
          .map(([sid, v]) => ({ student_id: sid, name: v.name, typen: zaehl(v.arten),
            haupt: Object.entries(zaehl(v.arten)).sort((a2, b2) => b2[1] - a2[1] || (a2[0] < b2[0] ? -1 : 1))[0][0] }))
          .sort((a2, b2) => (a2.name < b2.name ? -1 : 1)),
      };
    })() : null;

    return { topics: topicsOut, students: studentsOut, weakGroups, fehlerStat, gradedCount: graded.length, perTask, perUnit, noten: { avg, dist, distFine, werte, n: notes.length, notes, stats, minPts, max: tm, avgPct, medPct, sdPct, ciLow, ciHigh, present, total } };
  }, [work, students, topics, scale, effScale]);
  const wiederholen = async () => {
    if (!work) return;
    setBusy(true);
    const res = await fetch(`${API}/works/${work.id}/remediate`, alsJson("POST", { threshold: 0.5, cards: kartenAktiv, exercises: lernpfadAktiv })).catch(() => null);
    setBusy(false);
    if (res && res.ok) { const j = await res.json(); showAlert(t("klassenarbeit.remediateDone", { students: j.students, cards: j.cards_requeued, exercises: j.exercises_created || 0 })); }
    else showAlert(t("common.notWork"));
  };

  // Aus den zentralen Tabellenstilen abgeleitet, nicht daneben neu gebaut: nur
  // die kraeftigere Kopf-Trennlinie und die polsterlose Zelle (die Eingabefelder
  // fuellen sie selbst) weichen ab.
  const th = { ...thBase, padding: "6px 8px", borderBottom: "2px solid var(--border)" };
  const td = { ...tdBase, padding: 0 };

  const hasRoster = classId != null || subsetKurs != null;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <span data-tour="ka-class" style={{ display: "inline-flex" }}><KursKlasseSelect value={subsetKurs ? "" : classId} kursValue={subsetKurs ? null : kursId} onChange={(id, kid) => wechseln(() => { setSubsetKurs(null); setClassId(id); setKursId(kid); })} onKurs={(k) => { if (!subsetKurs) setKursId(k); }} /></span>
        {subsetKurse.length > 0 && (
          <select value={subsetKurs || ""} onChange={(e) => { const v = e.target.value ? Number(e.target.value) : null; wechseln(() => setSubsetKurs(v)); }} style={{ ...selectStyle, fontSize: 13 }} title={t("klassenarbeit.subsetHint")}>
            <option value="">{t("klassenarbeit.subsetPick")}</option>
            {subsetKurse.map((k) => <option key={k.id} value={k.id}>{k.name} ({k.member_count})</option>)}
          </select>
        )}
      </div>

      {/* Frühwarnung: eine einzelne Arbeit zeigt den Stand, nicht die Richtung.
          Dieselbe Auswertung wie auf der Startseite — sie rechnet über alle
          Arbeiten dieser Klasse und, falls CardVote läuft, über die Quizze mit. */}
      {classId && <FruehwarnPanel classId={classId} />}

      {/* Auswahlzeile nur, wenn es schon Arbeiten gibt — sonst führt allein die
          Leerzustand-Karte zum Anlegen (kein doppeltes „keine Arbeit"). */}
      {hasRoster && works.length > 0 && (
        /* Eine Leiste, eine Hoehe: das Auswahlfeld (34), „Neu" und das Kopieren
           standen vorher als 34 / ~38 / ~30 nebeneinander, jedes mit eigenem
           Radius. Das Loeschen sass ungeschuetzt neben dem Kopieren — es gehoert
           ins Mehr-Menue, wo Gefaehrliches selbst nach unten sortiert. */
        <Werkzeugleiste style={{ marginBottom: 16 }}
          links={(
            <select value={work?.id || ""} onChange={(e) => { const w = works.find((x) => String(x.id) === e.target.value) || null; wechseln(() => zeigeArbeit(w)); }} style={{ ...selectStyle, minWidth: 180 }}>
              {works.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
          mehr={work ? [{ key: "loeschen", label: t("common.delete"), icon: ICONS.trash, gefahr: true, onClick: loeschen }] : []}>
          <button data-tour="ka-new" onClick={neueArbeit} style={toolbarBtn}>{t("klassenarbeit.new")}</button>
          {/* Parallelklassen schreiben dieselbe Arbeit — sie zweimal einzutippen
              ist dieselbe Arbeit zweimal. */}
          {work && <button onClick={() => setKopieOffen(true)} className="icon-btn" style={toolbarIconBtn} title={t("klassenarbeit.copyTo")} aria-label={t("klassenarbeit.copyTo")}><Icon d={ICONS.duplicate} /></button>}
        </Werkzeugleiste>
      )}

      {hasRoster && work && students.length > 0 && (
        <>
          {/* SuS-Ansicht (Präsentation): alles über der Auswertung ausblenden —
              Aufgaben-Editor, Punkte-Raster, Aktionen. Nur die Auswertung bleibt. */}
          {!hideIndividual && (<>
          {/* Name sofort auch im Auswahl-Dropdown zeigen (nicht erst nach Reload). */}
          {/* Der Name geht in den Entwurf; im Auswahlfeld oben steht er nach dem
              Speichern (vorher wäre dort ein Name, den es serverseitig nicht gibt). */}
          <input value={work.name} onChange={(e) => persist({ name: e.target.value })} placeholder={t("klassenarbeit.newName")}
            style={{ ...inputStyle, fontSize: 16, fontWeight: 600, marginBottom: 12, maxWidth: 360 }} />

          {/* Anhänge: die Arbeit selbst und ihr Erwartungshorizont. Zwei
              benannte Plätze statt einer namenlosen Liste — beim Nachkorrigieren
              im nächsten Jahr sucht niemand, welche der vier PDFs der
              Erwartungshorizont war. Mehrere Dateien je Platz bleiben möglich
              (A- und B-Gruppe). Die Ablage ist dieselbe wie bei Themen und
              Stunden (Kern), nur mit einem Bezug mehr. */}
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", marginBottom: 12 }}>
            <MaterialPanel workId={work.id} rolle="arbeit" titel={t("klassenarbeit.fileWork")} />
            <MaterialPanel workId={work.id} rolle="erwartung" titel={t("klassenarbeit.fileExpect")} />
          </div>

          {/* 1) Aufgaben definieren: Bezeichnung + Thema + Maximalpunkte. */}
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)", margin: "4px 0 8px" }}>{t("klassenarbeit.tasksHeading")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
            {(work.tasks || []).map((task, i) => {
              const hasParts = !!(task.parts && task.parts.length);
              return (
              <div key={task.id} style={{ border: "1px solid var(--border)", borderRadius: CONTROL_R, padding: "8px 10px", background: "var(--card)" }}>
                {/* Eine Zeile, solange die Breite reicht: Name und Thema teilen
                    sich den Platz, alles Weitere behält seine Größe. Der
                    Themen-Select wuchs vorher mit dem längsten Optionstext
                    („Mathe 6.8 Daten darstellen und auswerten / 2 Kreisdiagramme
                    zeichnen") und schob den Mülleimer in die nächste Zeile —
                    `minWidth: 0` erlaubt dem Flex-Element, kleiner zu werden als
                    sein Inhalt. */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: "var(--text3)", width: 24, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{i + 1}.</span>
                  <input value={task.label} onChange={(e) => setTask(task.id, { label: e.target.value })} placeholder={t("klassenarbeit.taskOptional", { n: i + 1 })} title={t("klassenarbeit.taskOptionalHint")} style={{ ...inputStyle, fontSize: 13, padding: "7px 9px", flex: "1 1 150px", minWidth: 0 }} />
                  <select value={task.topic_id || ""} onChange={(e) => setTask(task.id, { topic_id: e.target.value ? Number(e.target.value) : null })}
                    style={{ ...selectStyle, fontSize: 13, padding: "7px 9px", flex: "1 1 180px", minWidth: 0, maxWidth: 340 }}>
                    <option value="">{t("klassenarbeit.topicNone")}</option>
                    {themen.geordnet.map((tp) => <option key={tp.id} value={tp.id}>{themen.label(tp)}</option>)}
                  </select>
                  {hasParts ? (
                    <span style={{ fontSize: 12, color: "var(--text3)", whiteSpace: "nowrap", flexShrink: 0 }}>{t("klassenarbeit.maxPoints")}: <b>{taskMax(task)}</b></span>
                  ) : (
                    <label style={{ fontSize: 12, color: "var(--text3)", display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", flexShrink: 0 }}>
                      {t("klassenarbeit.maxPoints")}
                      <input type="number" min="0.5" step="0.5" value={task.max ?? 1} onChange={(e) => setTask(task.id, { max: Math.max(0.5, Number(e.target.value) || 0.5) })} style={{ ...inputStyle, fontSize: 13, padding: "6px 6px", width: 56, textAlign: "center" }} />
                    </label>
                  )}
                  {/* Darstellungsleistung: zaehlt zur Note, aber nicht zur
                      inhaltlichen Auswertung. Sie misst keine Kompetenz in einem
                      Thema — im Aufgabenvergleich stuende sie sonst neben
                      Sachaufgaben und wuerde mit ihnen verglichen. */}
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: task.form ? "var(--accent)" : "var(--text3)", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
                    title={t("klassenarbeit.formHint")}>
                    {/* Ein Haken, zwei Wirkungen — und beide gehoeren zusammen:
                        die Aufgabe faellt aus dem inhaltlichen Vergleich heraus
                        UND heisst „Darstellung". Den Namen nur setzen, wenn das
                        Feld leer ist: einen selbst getippten Namen wegzuwerfen
                        waere eine Ueberraschung, keine Hilfe. */}
                    <input type="checkbox" checked={!!task.form}
                      onChange={(e) => {
                        const an = e.target.checked;
                        const patch = { form: an };
                        if (an && !(task.label || "").trim()) patch.label = t("klassenarbeit.form");
                        else if (!an && (task.label || "").trim() === t("klassenarbeit.form")) patch.label = "";
                        setTask(task.id, patch);
                      }} />
                    {t("klassenarbeit.form")}
                  </label>
                  <button onClick={() => addPart(task.id)} className="icon-btn" style={{ ...iconBtn, padding: 4, flexShrink: 0 }}
                    title={t("klassenarbeit.addPartHint")} aria-label={t("klassenarbeit.addPart")}>
                    <Icon d={ICONS.plus} size={15} color="var(--accent)" />
                  </button>
                  <button onClick={() => delTask(task.id)} className="icon-btn" style={{ ...iconBtn, padding: 4, flexShrink: 0 }} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={15} color={C.danger} /></button>
                </div>
                {hasParts && (
                  /* Eine Zeile je Teilaufgabe statt Chips nebeneinander: jede
                     bekommt ein eigenes Thema, und dafür ist in einem Chip kein
                     Platz. „Aufgabe 1: Wiederholung" prüft in a) Kopfrechnen,
                     in b) Umwandeln, in c) Runden — hängt das Thema nur oben an
                     der Aufgabe, wird daraus ein Topf, und die Auswertung sagt
                     „Wiederholung schwach" statt „Runden schwach". */
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8, paddingLeft: 26 }}>
                    {units(task).map((u) => (
                      <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", background: "var(--bg2)", borderRadius: CONTROL_R, padding: "4px 6px" }}>
                        <input value={u.label} onChange={(e) => setPart(task.id, u.id, { label: e.target.value })} title={t("klassenarbeit.partLabel")} style={{ ...inputStyle, fontSize: 12, padding: "4px 4px", width: 34, textAlign: "center" }} />
                        <select value={u.topic_id || ""} onChange={(e) => setPart(task.id, u.id, { topic_id: e.target.value ? Number(e.target.value) : null })}
                          title={t("klassenarbeit.partTopicHint")} style={{ ...selectStyle, fontSize: 12, padding: "5px 7px", flex: 1, minWidth: 120 }}>
                          <option value="">{t("klassenarbeit.partTopicInherit")}</option>
                          {themen.geordnet.map((tp) => <option key={tp.id} value={tp.id}>{themen.label(tp)}</option>)}
                        </select>
                        <input type="number" min="0.5" step="0.5" value={u.max} onChange={(e) => setPart(task.id, u.id, { max: Math.max(0.5, Number(e.target.value) || 0.5) })} title={t("klassenarbeit.maxPoints")} style={{ ...inputStyle, fontSize: 12, padding: "4px 4px", width: 48, textAlign: "center" }} />
                        <button onClick={() => delPart(task.id, u.id)} className="icon-btn" style={{ ...iconBtn, padding: 3 }} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={14} color={C.danger} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              );
            })}
          </div>
          <button onClick={addTask} style={{ ...btnSecondary, marginBottom: 16 }}>+ {t("klassenarbeit.addTask")}</button>

          {/* 2) Punkte-Raster: Zeilen = Schüler, Spalten = Aufgaben (0..max). */}
          {(work.tasks || []).length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
              {/* Aus, bis jemand ihn anmacht: die Fehlerart ist eine freiwillige
                  Zusatzangabe. Wer sie nicht braucht, soll kein zweites Feld je
                  Zelle sehen — das Raster ist ohnehin breiter als der Schirm. */}
              <button onClick={() => setFehlerModus((v) => !v)}
                style={{ ...toolbarBtn, background: fehlerModus ? "var(--accent)" : "transparent", color: fehlerModus ? C.aufAkzent : "var(--text2)" }}
                title={t("klassenarbeit.fehlerHint")}>
                <Icon d={ICONS.tag || ICONS.bulb} size={15} color={fehlerModus ? C.aufAkzent : "var(--text2)"} /> {t("klassenarbeit.fehlerMode")}
              </button>
              {fehlerModus && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12, color: "var(--text3)" }}>
                  {FEHLER.map((f) => (
                    <span key={f.key} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <span style={{ ...fehlerChip, background: f.color, color: C.aufAkzent }}>{f.ab}</span>
                      {t(`klassenarbeit.fehler.${f.key}`)}
                    </span>
                  ))}
                  <span>· {t("klassenarbeit.fehlerCycle")}</span>
                </span>
              )}
            </div>
          )}
          {(work.tasks || []).length > 0 && (
            <div style={{ overflowX: "auto", overscrollBehaviorX: "contain", border: "1px solid var(--border)", borderRadius: panelStyle.borderRadius }}>
              <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ ...th, ...klebtLinks, textAlign: "left", minWidth: 130, zIndex: 2 }}>{t("common.name")}</th>
                    {(work.tasks || []).map((tk, i) => <th key={tk.id} colSpan={units(tk).length + (units(tk).length > 1 ? 1 : 0)} style={{ ...th, minWidth: 46, borderLeft: "1px solid var(--border)" }} title={tk.label}>{tk.label || (i + 1)}</th>)}
                    <th rowSpan={2} style={{ ...th, minWidth: 58, borderLeft: "1px solid var(--border)" }}>Σ / {totalMax()}</th>
                    {/* Note: in der SuS-/Präsentationsansicht unsichtbar, weil das
                        ganze Raster oben schon hinter !hideIndividual haengt. */}
                    <th rowSpan={2} style={{ ...th, minWidth: 44 }}>{t("klassenarbeit.grade")}</th>
                  </tr>
                  <tr>
                    {(work.tasks || []).flatMap((tk) => {
                      const sub = units(tk).length > 1;   // echte Teilaufgaben
                      const cols = units(tk).map((u, j) => (
                        <th key={u.id} style={{ ...th, minWidth: 44, fontWeight: 500, borderLeft: j === 0 ? "1px solid var(--border)" : undefined }}>{u.label || ""}<div style={{ fontSize: 11, color: "var(--text3)", fontWeight: 400 }}>/{unitMax(u)}</div></th>
                      ));
                      // Summe der Teilaufgaben je Aufgabe (nur wenn es Teile gibt).
                      if (sub) cols.push(<th key={tk.id + "-sum"} style={{ ...th, minWidth: 46, fontWeight: 700, background: "var(--bg2)" }}>Σ<div style={{ fontSize: 11, color: "var(--text3)", fontWeight: 400 }}>/{taskMax(tk)}</div></th>);
                      return cols;
                    })}
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => {
                    const sum = sumOf(s.id); const tm = totalMax(); const abw = isAbsent(s.id);
                    // Nichts eingetragen heisst NICHT „null Punkte". Vor dem
                    // Korrigieren stand in jeder Zeile 0/59 und eine 6 — eine
                    // Wand aus roten Sechsen fuer eine Arbeit, die noch niemand
                    // angesehen hat. Erst wenn zu diesem Kind ein Wert erfasst
                    // ist, gibt es Summe und Note; eine bewusst eingetragene 0
                    // zaehlt dabei als Wert.
                    const erfasst = hatPunkte(s.id);
                    // Note auch für Abwesende zeigen (Punkte bleiben ja erhalten) — nur
                    // die Klassenstatistik unten rechnet sie raus. Anzeige umschaltbar:
                    // Tendenznote (2+) oder Notenwert in 0,3-Schritten (2,3).
                    const gd = (erfasst && tm) ? gradeDetailed((sum / tm) * 100, effScale) : null;
                    const note = gd ? (gradeMode === "wert" ? komma(gd.wert) : gd.note) : "";
                    return (
                      <tr key={s.id} style={abw ? { opacity: 0.5 } : undefined}>
                        <td style={{ ...td, ...klebtLinks, textAlign: "left", padding: "4px 8px", fontWeight: 500, whiteSpace: "nowrap" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            {/* Anwesenheit: Auge / durchgestrichenes Auge —
                                „zaehlt in der Auswertung mit" bzw. „bleibt
                                draussen". Der leere Kreis vorher sah nach
                                „auswaehlen" aus. */}
                            <button onClick={() => toggleAbsent(s.id)} title={abw ? t("klassenarbeit.present") : t("klassenarbeit.absent")}
                              aria-label={abw ? t("klassenarbeit.present") : t("klassenarbeit.absent")} aria-pressed={abw}
                              style={{ border: "none", background: "none", cursor: "pointer", color: abw ? C.warning : "var(--text3)", padding: 0, display: "inline-flex" }}><Icon d={abw ? ICONS.eyeOff : ICONS.eye} size={15} /></button>
                            {s.name}
                          </span>
                        </td>
                        {(work.tasks || []).flatMap((tk) => {
                          const sub = units(tk).length > 1;
                          const cells = units(tk).map((u, j) => (
                            <td key={u.id} style={{ ...td, borderLeft: j === 0 ? "1px solid var(--border)" : undefined }}>
                              {/* Abwesende bleiben editierbar — Punkte werden nur nicht in die
                                  Klassenstatistik gerechnet, aber nicht gelöscht. */}
                              <input type="number" min="0" step="0.5" max={unitMax(u)} value={pointsOf(s.id, u.id)} onChange={(e) => setPoints(s.id, u.id, e.target.value === "" ? "" : Math.min(unitMax(u), Math.max(0, Number(e.target.value))))}
                                style={{ width: 42, height: 30, border: "none", background: "transparent", textAlign: "center", fontSize: 13, color: "var(--text)" }} />
                              {/* Die Fehlerart steht nur da, wo Punkte fehlen —
                                  an einer Aufgabe mit voller Punktzahl gibt es
                                  keinen Fehler zu benennen. Genau dieselbe
                                  Regel rechnet der Server (_fehler_gezaehlt). */}
                              {fehlerModus && (() => {
                                const p = pointsOf(s.id, u.id);
                                if (p === "" || Number(p) >= unitMax(u)) return null;
                                const f = FEHLER.find((x) => x.key === fehlerOf(s.id, u.id));
                                return (
                                  <button onClick={() => cycleFehler(s.id, u.id)}
                                    title={f ? t(`klassenarbeit.fehler.${f.key}`) : t("klassenarbeit.fehlerSet")}
                                    style={{ ...fehlerChip, display: "block", margin: "0 auto 2px", cursor: "pointer",
                                      background: f ? f.color : "transparent", color: f ? C.aufAkzent : "var(--text3)",
                                      border: f ? "none" : "1px dashed var(--border2)" }}>
                                    {f ? f.ab : "+"}
                                  </button>
                                );
                              })()}
                            </td>
                          ));
                          if (sub) { const ts = units(tk).reduce((n, u) => n + (Number(pointsOf(s.id, u.id)) || 0), 0); cells.push(<td key={tk.id + "-sum"} style={{ ...td, fontWeight: 700, background: "var(--bg2)", color: "var(--text2)" }}>{kommaRund(ts, 2)}</td>); }
                          return cells;
                        })}
                        <td style={{ ...td, fontWeight: 700, borderLeft: "1px solid var(--border)", color: !erfasst ? "var(--text3)" : abw ? "var(--text3)" : (tm && sum / tm < 0.5 ? C.danger : "var(--text)") }}>{erfasst ? `${kommaRund(sum, 2)}/${tm}` : `–/${tm}`}{abw ? ` (${t("klassenarbeit.absentShort")})` : ""}</td>
                        <td style={{ ...td, fontWeight: 700, color: abw ? "var(--text3)" : "var(--text)" }}>{note}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
            {notenAktiv && (work.tasks || []).length > 0 && <button onClick={() => setNotenModal(true)} style={btnPrimary}>{t("klassenarbeit.toNoten")}</button>}
            {(kartenAktiv || lernpfadAktiv) && <button onClick={wiederholen} disabled={busy} style={{ ...btnSecondary, opacity: busy ? 0.6 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon d={ICONS.restore} size={15} /> {t("klassenarbeit.remediate")}</button>}
            {(work.tasks || []).length > 0 && (
              <button onClick={() => setScaleOpen((v) => !v)} style={{ ...btnSecondary, marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}
                title={t("klassenarbeit.scaleHint")}>{t("klassenarbeit.scale")}{(work.scale && Object.keys(work.scale).length) ? " •" : ""}</button>
            )}
          </div>
          {scaleOpen && (work.tasks || []).length > 0 && (
            <div style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: panelStyle.borderRadius, padding: "12px 14px", background: "var(--card)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{t("klassenarbeit.scaleTitle")}</span>
                <span style={{ fontSize: 12, color: (work.scale && Object.keys(work.scale).length) ? C.warning : "var(--text3)" }}>
                  {(work.scale && Object.keys(work.scale).length) ? t("klassenarbeit.scaleOwn") : t("klassenarbeit.scaleProfile")}
                </span>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                {[1, 2, 3, 4, 5].map((g) => (
                  <label key={g} style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, color: "var(--text2)" }}>
                    <span>{t("klassenarbeit.gradeFrom", { g })}</span>
                    <input type="number" min="0" max="100" step="1" value={Math.round(effScale[g] ?? DEFAULT_SCALE[g])}
                      onChange={(e) => { const base = { ...DEFAULT_SCALE, ...effScale }; base[g] = Math.max(0, Math.min(100, Number(e.target.value) || 0)); base[6] = 0; setWorkScale(base); }}
                      style={{ ...inputStyle, width: 64, padding: "6px 8px", textAlign: "center" }} />
                  </label>
                ))}
                <span style={{ fontSize: 12, color: "var(--text3)" }}>% {t("klassenarbeit.scaleUnit")}</span>
                {(work.scale && Object.keys(work.scale).length) ? (
                  <button onClick={() => setWorkScale({})} style={{ ...btnSecondary, padding: "6px 12px", fontSize: 13 }}>{t("klassenarbeit.scaleReset")}</button>
                ) : null}
              </div>
            </div>
          )}
          {notenModal && (() => {
            const noten = notenAusArbeit(students, work, effScale);
            return <NotenUebernahme titel={t("klassenarbeit.toNoten")} hinweis={t("klassenarbeit.toNotenHint", { n: noten.length })}
              classId={subsetKurs ? repClass.current : classId} kursId={subsetKurs || kursId} grades={noten}
              quelle="klassenarbeit" notiz={t("klassenarbeit.title")} spalte={work.name || t("klassenarbeit.newName")}
              onClose={() => setNotenModal(false)} />;
          })()}
          </>)}

          {analyse && (analyse.topics.length > 0 || analyse.students.length > 0 || analyse.perUnit.length > 0 || analyse.noten.n > 0) && (
            <div style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: panelStyle.borderRadius, padding: 16, background: "var(--card)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, borderBottom: "1px solid var(--border)", paddingBottom: 10 }}>
                <span style={{ fontSize: 16, fontWeight: 800 }}>{t("klassenarbeit.analysisTitle")}</span>
                <button onClick={() => setHideIndividual((v) => !v)} title={t("klassenarbeit.presentHint")}
                  style={{ ...toolbarBtn, background: hideIndividual ? "var(--accent)" : "transparent", color: hideIndividual ? C.aufAkzent : "var(--text2)" }}>
                  <Icon d={ICONS.eye} size={15} color={hideIndividual ? C.aufAkzent : "var(--text2)"} /> {t("klassenarbeit.presentMode")}
                </button>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{t("klassenarbeit.byTopic")}</div>
              {analyse.topics.length === 0 ? <p style={{ fontSize: 13, color: "var(--text3)" }}>{t("klassenarbeit.noTopics")}</p> : analyse.topics.map((tp) => (
                <div key={tp.topic_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
                  <span style={{ flex: 1, fontSize: 13 }}>{tp.label}</span>
                  {/* Balken: Radius = halbe Hoehe (Balken-Kappe), reine Grafik. */}
                  <span style={{ width: 120, height: 8, background: "var(--bg2)", borderRadius: 4, overflow: "hidden" }}><span style={{ display: "block", width: `${tp.pct}%`, height: "100%", background: tp.pct < 50 ? C.danger : tp.pct < 75 ? C.warning : C.success }} /></span>
                  <span style={{ fontSize: 13, fontWeight: 700, minWidth: 38, textAlign: "right" }}>{tp.pct}%</span>
                </div>
              ))}
              {/* Frueher stand hier je Kind eine Zeile mit allen Themen als
                  Fliesstext — bei 28 Kindern und langen Themennamen eine Wand,
                  aus der niemand etwas ableitet. Jetzt andersherum: nach THEMA
                  gruppiert, das mit den meisten Betroffenen oben. So steht da,
                  was man am Montag tut — und wen man dazuholt. */}
              {!hideIndividual && analyse.weakGroups.length > 0 && (<>
                <div style={{ fontSize: 14, fontWeight: 700, margin: "16px 0 4px" }}>{t("klassenarbeit.weakStudents")}</div>
                <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8 }}>{t("klassenarbeit.weakHint")}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {analyse.weakGroups.map((g) => (
                    <div key={g.label} style={{ border: "1px solid var(--border)", borderRadius: CONTROL_R, padding: "8px 10px" }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{g.label}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: g.anteil >= 50 ? C.danger : C.warning }}>
                          {t("klassenarbeit.weakCount", { n: g.namen.length, all: analyse.gradedCount })}
                        </span>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {g.namen.map((n) => (
                          <span key={n} style={{ ...chipStyle, fontWeight: 500, background: "var(--bg2)" }}>{n}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>)}

              {/* Fehlerarten: die Themenquote sagt WO es klemmt, die Fehlerart
                  WORAN — und daraus folgt Verschiedenes. Nur da, wo jemand
                  wirklich etwas erfasst hat; sonst stuende hier eine Tabelle
                  aus lauter Nullen und behauptete, die Klasse mache keine
                  Fehler. */}
              {analyse.fehlerStat && (<>
                <div style={{ fontSize: 14, fontWeight: 700, margin: "16px 0 4px" }}>{t("klassenarbeit.fehlerTitle")}</div>
                <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8 }}>
                  {t("klassenarbeit.fehlerTitleHint", { n: analyse.fehlerStat.n })}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  {FEHLER.filter((f) => analyse.fehlerStat.gesamt[f.key]).map((f) => (
                    <span key={f.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--border)", borderRadius: CONTROL_R, padding: "6px 10px" }}>
                      <span style={{ ...fehlerChip, background: f.color, color: C.aufAkzent }}>{f.ab}</span>
                      <span style={{ fontSize: 13 }}>{t(`klassenarbeit.fehler.${f.key}`)}</span>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{analyse.fehlerStat.gesamt[f.key]}×</span>
                    </span>
                  ))}
                </div>
                {/* Je Thema: „an Bruchrechnung scheitert der Ansatz, an Termen
                    nur die Rechnung" — dieselbe Quote, zwei verschiedene
                    Konsequenzen. */}
                {analyse.fehlerStat.topics.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
                    {analyse.fehlerStat.topics.map((r) => (
                      <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 10px", borderRadius: panelStyle.borderRadius, background: "var(--bg2)" }}>
                        <span style={{ flex: 1, minWidth: 120, fontSize: 13, fontWeight: 600 }}>{r.label}</span>
                        {FEHLER.filter((f) => r.typen[f.key]).map((f) => (
                          <span key={f.key} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text2)" }}>
                            <span style={{ ...fehlerChip, background: f.color, color: C.aufAkzent }}>{f.ab}</span>
                            {r.typen[f.key]}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                {!hideIndividual && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {analyse.fehlerStat.students.map((st) => {
                      const f = FEHLER.find((x) => x.key === st.haupt);
                      return (
                        <span key={st.student_id} style={{ ...chipStyle, fontWeight: 500, background: "var(--bg2)", display: "inline-flex", alignItems: "center", gap: 5 }}
                          title={FEHLER.filter((x) => st.typen[x.key]).map((x) => `${t(`klassenarbeit.fehler.${x.key}`)}: ${st.typen[x.key]}`).join("\n")}>
                          <span style={{ ...fehlerChip, background: f ? f.color : "var(--bg3)", color: C.aufAkzent }}>{f ? f.ab : "?"}</span>
                          {st.name}
                        </span>
                      );
                    })}
                  </div>
                )}
              </>)}

              {/* je Aufgabe: Ø, Trefferquote + Trennschärfe/95%-KI. Hat eine Aufgabe
                  Teilaufgaben, lässt sich deren Auswertung darunter ausklappen. */}
              {analyse.perTask.length > 0 && (<>
                <div style={{ fontSize: 14, fontWeight: 700, margin: "16px 0 8px" }}>{t("klassenarbeit.byTask")}</div>
                {analyse.perTask.map((tk) => {
                  const parts = analyse.perUnit.filter((u) => u.taskId === tk.id);
                  const open = expandedTasks.has(tk.id);
                  const toggle = () => setExpandedTasks((prev) => { const n = new Set(prev); n.has(tk.id) ? n.delete(tk.id) : n.add(tk.id); return n; });
                  return (
                    <div key={tk.id}>
                      <StatRow row={tk} t={t} expandable={parts.length > 0} open={open} onToggle={toggle} />
                      {open && parts.length > 0 && (
                        <div style={{ marginLeft: 16, marginBottom: 4 }}>
                          {parts.map((u) => <StatRow key={u.id} row={u} t={t} small />)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>)}

              {/* Noten-Auswertung im CardVote-Design: Kennzahl-Kacheln + Panel mit
                  Notenverteilung/Boxplot-Umschalter. */}
              {analyse.noten.n > 0 && (<>
                <div style={{ fontSize: 14, fontWeight: 700, margin: "16px 0 8px" }}>{t("klassenarbeit.gradeResult")}</div>
                {/* Statistik-Kacheln (Anwesend … 95%-KI) — wie CardVote. */}
                <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                  <StatCard label={t("klassenarbeit.attendance")} value={`${analyse.noten.present} / ${analyse.noten.total}`} />
                  <StatCard label={t("klassenarbeit.avgGrade")} value={komma(analyse.noten.avg)} />
                  {analyse.noten.avgPct != null && <StatCard label={t("klassenarbeit.avgPct")} value={`${analyse.noten.avgPct}%`} />}
                  {analyse.noten.medPct != null && <StatCard label={t("klassenarbeit.median")} value={`${analyse.noten.medPct}%`} />}
                  {analyse.noten.sdPct != null && <StatCard label={t("klassenarbeit.stdev")} value={`${komma(analyse.noten.sdPct)}%`} />}
                  {analyse.noten.ciLow != null && <StatCard label={t("klassenarbeit.ci")} value={`${analyse.noten.ciLow}–${analyse.noten.ciHigh}%`} />}
                </div>
                {/* „Auswertung verstehen": Kennzahlen erklärt + konkrete Handlungshinweise. */}
                <button onClick={() => setInfoOpen((v) => !v)} style={{ ...btnSecondary, padding: "5px 12px", fontSize: 13, marginBottom: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ display: "inline-flex", transform: infoOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}><Icon d={ICONS.open} size={12} /></span>
                  {t("klassenarbeit.explain")}
                </button>
                {infoOpen && (() => {
                  const sd = analyse.noten.sdPct;
                  const sdLevel = sd == null ? null : sd < 10 ? "low" : sd <= 25 ? "mid" : "high";
                  const weak = analyse.topics.filter((tp) => tp.pct < 50).map((tp) => tp.label);
                  const lowDisc = analyse.perTask.filter((tk) => tk.disc != null && tk.disc < 0.2);
                  const Item = ({ term, children }) => (
                    <li style={{ marginBottom: 8 }}><b style={{ color: "var(--text)" }}>{term}:</b> <span style={{ color: "var(--text2)" }}>{children}</span></li>
                  );
                  return (
                    <div style={{ padding: 16, background: "var(--bg3)", borderRadius: cardStyle.borderRadius, border: "1px solid var(--border)", marginBottom: 12, fontSize: 13, lineHeight: 1.55 }}>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        <Item term={t("klassenarbeit.avgGrade") + " / " + t("klassenarbeit.median")}>{t("klassenarbeit.explainAvg")}</Item>
                        {sd != null && (
                          <Item term={`${t("klassenarbeit.stdev")} (${komma(sd)}%)`}>
                            {t("klassenarbeit.explainSd")} {" "}
                            <b style={{ color: sdLevel === "low" ? C.warning : sdLevel === "mid" ? C.success : C.danger }}>
                              {t(`klassenarbeit.explainSd_${sdLevel}`)}
                            </b>
                          </Item>
                        )}
                        {analyse.noten.ciLow != null && <Item term={t("klassenarbeit.ci")}>{t("klassenarbeit.explainCi")}</Item>}
                        <Item term={t("klassenarbeit.disc")}>{t("klassenarbeit.explainDisc")}</Item>
                      </ul>
                      {(weak.length > 0 || lowDisc.length > 0) && (
                        <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                          <div style={{ fontWeight: 700, marginBottom: 4 }}>{t("klassenarbeit.explainActions")}</div>
                          <ul style={{ margin: 0, paddingLeft: 18 }}>
                            {weak.length > 0 && <li style={{ marginBottom: 4, color: "var(--text2)" }}>{t("klassenarbeit.explainWeak", { topics: weak.join(", ") })}</li>}
                            {lowDisc.length > 0 && <li style={{ color: "var(--text2)" }}>{t("klassenarbeit.explainLowDisc", { n: lowDisc.length })}</li>}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })()}
                {/* Verteilung / Boxplot — Panel + Pillen-Umschalter wie CardVote. */}
                <div style={{ padding: 16, background: "var(--bg3)", borderRadius: cardStyle.borderRadius, border: "1px solid var(--border)" }}>
                  {/* Zweimal dieselbe Frage („welche Ansicht?"), also zweimal
                      dieselbe Form. Links standen vorher zwei Einzelpillen
                      (r980), rechts eine Gruppe mit r8 — nebeneinander sah das
                      aus wie zwei verschiedene Bedienarten. */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                    <Tabs value={distMode} onChange={setDistMode}
                      options={[["bar", t("klassenarbeit.distGrades")], ["box", t("klassenarbeit.distBox")]]} />
                    {/* Sekundär-Umschalter: Balken = Noten/Teilnoten, Boxplot = %/Noten. */}
                    <Tabs style={{ marginLeft: "auto" }}
                      value={distMode === "bar" ? barMode : boxMode}
                      onChange={distMode === "bar" ? setBarMode : setBoxMode}
                      options={distMode === "bar"
                        ? [["whole", t("klassenarbeit.distWhole")], ["fine", t("klassenarbeit.distFine")]]
                        : [["pct", "%"], ["note", t("klassenarbeit.grade")]]} />
                  </div>
                  {distMode === "bar" ? (() => {
                    const data = barMode === "fine"
                      ? analyse.noten.distFine.map((d) => ({ count: d.count, label: d.label, grade: d.grade }))
                      : analyse.noten.dist.map((c, i) => ({ count: c, label: String(i + 1), grade: i + 1 }));
                    const mxc = Math.max(...data.map((d) => d.count), 1);
                    return (
                      <div style={{ display: "flex", alignItems: "flex-end", gap: barMode === "fine" ? 3 : 6, height: 105 }}>
                        {data.map((d, i) => (
                          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                            {/* Saeule: Radius rundet nur die Kappe der Grafik. */}
                            <div style={{ width: barMode === "fine" ? "80%" : "60%", height: `${Math.max(3, (d.count / mxc) * 75)}px`, background: d.grade <= 2 ? C.success : d.grade <= 4 ? C.warning : C.danger, borderRadius: 3 }} title={`${d.count}`} />
                            <span style={{ fontSize: 11, color: "var(--text3)" }}>{d.count}</span>
                            <span style={{ fontSize: 11, fontWeight: 700 }}>{d.label}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })() : (
                    boxMode === "note"
                      ? <Boxplot values={analyse.noten.werte} max={6} />
                      : <Boxplot values={pctList(work)} max={100} unit="%" />
                  )}
                </div>
                {/* Min-Punkte je Note entfernt — steht im Notenschlüssel. */}
              </>)}
            </div>
          )}
        </>
      )}
      {hasRoster && works.length === 0 && <Empty title={t("klassenarbeit.empty")} hint={t("klassenarbeit.emptyHint")} action={t("klassenarbeit.new")} onAction={neueArbeit} />}
      {/* Themenstand: die Arbeit sagt „diese Klassenarbeit", der Themenstand
          „dieses Unterthema ueber die Zeit". Rechnet ueber alle Arbeiten und
          Quizze der Klasse — deshalb hier unter der Einzelauswertung. */}
      {hasRoster && !hideIndividual && classId && <Themenstand classId={classId} />}

      {hasRoster && work && students.length === 0 && <Empty title={t("klassenarbeit.noStudents")} />}

      {kopieOffen && work && (
        <KopieModal work={work} onClose={() => setKopieOffen(false)} onCopy={kopieren} t={t} />
      )}
      {/* Unten schwebend: das Punkte-Raster ist länger als der Bildschirm, oben
          wäre der Knopf nach der dritten Zeile weg. */}
      <SpeicherBalken entwurf={entwurf} />
    </div>
  );
}

// Brücke Klassenarbeit → Notenbuch. Der Dialog ist derselbe wie bei den
// Karteikarten (components/NotenUebernahme.jsx); hier steht nur, WIE aus
// Punkten eine Note wird — das ist die Fachlichkeit dieser Seite.
//
// Nur wer erfasst ist: eine noch nicht korrigierte Zeile darf keine 6 ins
// Notenbuch tragen. Eine bewusst eingetragene 0 zaehlt, ein leeres Feld nicht.
// Krank/abwesend bekommt ohnehin keine Note.
function notenAusArbeit(students, work, scale) {
  const uIds = (tk) => (tk.parts && tk.parts.length) ? tk.parts.map((u) => u.id) : [tk.id];
  const uMaxT = (tk) => (tk.parts && tk.parts.length) ? tk.parts.reduce((n, u) => n + (Number(u.max) > 0 ? Number(u.max) : 1), 0) : (Number(tk.max) > 0 ? Number(tk.max) : 1);
  const totalMax = (work.tasks || []).reduce((n, tk) => n + uMaxT(tk), 0);
  const absentU = new Set((work.absent || []).map(String));
  return students
    .filter((s) => {
      if (absentU.has(String(s.id))) return false;
      const r = (work.results || {})[String(s.id)];
      if (!r || r === "abwesend") return false;
      if (Array.isArray(r)) return true;                  // Altformat
      return Object.values(r).some((v) => v != null && v !== "");
    })
    .map((s) => {
      const row = (work.results || {})[String(s.id)] || {};
      const sum = (work.tasks || []).reduce((n, tk) => n + uIds(tk).reduce((m, id) => m + (Number(row[id]) || 0), 0), 0);
      // Notenwert mit Tendenz (±0,3) — wie in der Excel-Auswertung.
      return { student_id: s.id, value: gradeDetailed(totalMax ? (sum / totalMax) * 100 : 0, scale).wert };
    }).filter((g) => g.value >= 1 && g.value <= 6);
}

// ── Vergleich ────────────────────────────────────────────────────────────────
// Je Arbeit die erreichten Prozent je bewertetem (nicht abwesendem) SuS.
// Altformat (results[sid] = [falsche Aufgaben-IDs]) wird mitgerechnet.
function pctList(work) {
  const tasks = work.tasks || [];
  const uIds = (tk) => (tk.parts && tk.parts.length) ? tk.parts.map((u) => u.id) : [tk.id];
  const uMaxT = (tk) => (tk.parts && tk.parts.length) ? tk.parts.reduce((n, u) => n + (Number(u.max) > 0 ? Number(u.max) : 1), 0) : (Number(tk.max) > 0 ? Number(tk.max) : 1);
  const tm = tasks.reduce((n, tk) => n + uMaxT(tk), 0);
  if (!tm) return [];
  const absent = new Set((work.absent || []).map(String));
  const out = [];
  for (const [sid, r] of Object.entries(work.results || {})) {
    if (!r || r === "abwesend" || absent.has(String(sid))) continue;
    let e = 0;
    if (Array.isArray(r)) { const bad = new Set(r.map(String)); tasks.forEach((tk) => { if (!bad.has(String(tk.id))) e += uMaxT(tk); }); }
    else tasks.forEach((tk) => uIds(tk).forEach((id) => { const v = r[id]; e += (v == null ? 0 : Number(v)); }));
    out.push(Math.round((e / tm) * 100));
  }
  return out;
}

function quartiles(arr) {
  const a = [...arr].sort((x, y) => x - y); const n = a.length;
  if (!n) return null;
  const q = (p) => { const idx = (n - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx); return a[lo] + (a[hi] - a[lo]) * (idx - lo); };
  return { n, min: a[0], q1: q(0.25), med: q(0.5), q3: q(0.75), max: a[n - 1], avg: a.reduce((s, x) => s + x, 0) / n };
}

const boxColor = (med) => (med < 50 ? C.danger : med < 75 ? C.warning : C.success);
// Boxplot kommt zentral aus Icons.jsx (eine Quelle). Der Vergleich nutzt die
// kompakte Variante (compact) je Zeile.

export function KlassenarbeitVergleich() {
  const { t } = useLanguage();
  const [classId, setClassId] = useState(null);
  const [kursId, setKursId] = useState(null);
  const [works, setWorks] = useState([]);
  const [workId, setWorkId] = useState(null);     // gewählte Arbeit (Klassenvergleich)
  const [daten, setDaten] = useState(null);       // Antwort von /vergleich
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [sicht, setSicht] = useState("klassen"); // klassen | aufgaben | verlauf
  useEffect(() => { try { const u = JSON.parse(localStorage.getItem("user")); if (u?.grade_scale) setScale(u.grade_scale); } catch { /* Default */ } }, []);

  const kq = kursId != null ? `?kurs_id=${kursId}` : "";
  useEffect(() => {
    if (!classId) { setWorks([]); setWorkId(null); return; }
    fetch(`${API}/classes/${classId}/works${kq}`).then((r) => (r.ok ? r.json() : [])).then((d) => {
      const liste = Array.isArray(d) ? d : [];
      setWorks(liste);
      setWorkId((alt) => (liste.some((w) => w.id === alt) ? alt : (liste[0]?.id ?? null)));
    }).catch(() => setWorks([]));
  }, [classId, kursId]);

  // Der Klassenvergleich kommt vom Server: er kennt die Gruppe („dieselbe
  // Arbeit") über die Herkunft der Kopien und rechnet je Aufgabe mit derselben
  // Punktelogik wie die Auswertung. Zwei Fassungen derselben Rechnung liefen
  // sonst auseinander.
  useEffect(() => {
    if (!workId) { setDaten(null); return; }
    fetch(`${API}/works/${workId}/vergleich`).then((r) => (r.ok ? r.json() : null)).then(setDaten).catch(() => setDaten(null));
  }, [workId]);

  // Verlauf: alle Arbeiten dieser Klasse nacheinander (die frühere Ansicht).
  const verlauf = useMemo(() => works.map((w) => {
    const pl = pctList(w); const q = quartiles(pl);
    const noten = pl.map((p) => gradeFromPct(p, scale));
    const avgNote = noten.length ? noten.reduce((s, x) => s + x, 0) / noten.length : null;
    return { id: w.id, name: w.name, q, pl, avgNote };
  }).filter((r) => r.q), [works, scale]);

  const klassen = (daten?.arbeiten || []).filter((a) => a.n > 0);
  const fmt = (x) => (x == null ? "–" : Math.round(x) + "%");
  // Eine Nachkommastelle, deutsch, „–" wenn es nichts gibt — aus core/zahl.js.
  const nt = (x) => kommaRund(x, 1, "–");
  const noteVon = (pl) => { const n = pl.map((p) => gradeFromPct(p, scale)); return n.length ? n.reduce((s, x) => s + x, 0) / n.length : null; };
  const einheitLabel = (e, i) => [e.label || `${i + 1}`, e.teil].filter(Boolean).join(" ");

  // Aufgaben-Statistik über die Klassen: Zeilen = Aufgabe, Spalten = Klasse.
  // Verglichen wird über die Position, nicht über die unit_id — Kopien haben
  // eigene IDs, es ist aber dieselbe Aufgabe an derselben Stelle.
  const aufgaben = useMemo(() => {
    if (!klassen.length) return [];
    const gesamt = daten?.gesamt || [];
    const laenge = Math.max(...klassen.map((a) => a.einheiten.length));
    return Array.from({ length: laenge }, (_, i) => {
      const erste = klassen.find((a) => a.einheiten[i])?.einheiten[i];
      const werte = klassen.map((a) => a.einheiten[i]?.pct ?? null);
      const da = werte.filter((v) => v != null);
      return {
        i, erste, g: gesamt[i] || null,
        label: erste ? einheitLabel(erste, i) : String(i + 1),
        max: erste?.max, form: !!erste?.form,
        werte, spanne: da.length > 1 ? Math.max(...da) - Math.min(...da) : null,
        // Je Klasse die Kennzahlen, fuer die aufgeklappte Zeile.
        detail: klassen.map((a) => a.einheiten[i] || null),
      };
    });
  }, [daten]);

  // Darstellung („Form") zaehlt zur Note, aber nicht zum Aufgabenvergleich:
  // sie misst keine Kompetenz in einem Thema. Sichtbar bleibt sie als Fussnote,
  // damit niemand sie fuer vergessen haelt.
  const inhaltlich = aufgaben.filter((r) => !r.form);
  const formAufgaben = aufgaben.filter((r) => r.form);
  const [offen, setOffen] = useState(null);        // aufgeklappte Aufgabenzeile

  // Woran man eine misslungene Aufgabe erkennt — bewusst nur zwei Regeln, beide
  // mit dem Wert daneben, damit die Lehrkraft sie nachpruefen kann.
  const auffaellig = (g) => {
    if (!g) return null;
    if (g.trenn != null && g.trenn < 0.1) return t("klassenarbeit.flagTrenn", { v: komma(g.trenn) });
    if (g.null != null && g.null >= 40 && (g.pct ?? 100) < 60) return t("klassenarbeit.flagNull", { v: g.null });
    return null;
  };

  // Dritte Tabellenform in derselben Datei — jetzt aus derselben Quelle wie die
  // beiden anderen abgeleitet. Rechtsbuendig, weil hier nur Zahlen stehen; die
  // Trennlinie sitzt oben statt unten (Vergleichsliste ohne Kopf-Abschluss).
  const kopf = { ...thBase, fontSize: 11, padding: "8px 10px", textAlign: "right", borderBottom: "none" };
  const zelle = { ...tdBase, fontSize: 13, padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap", borderBottom: "none", borderTop: "1px solid var(--border)" };

  return (
    <div style={{ ...pageApp, padding: "0 16px 40px" }}>
      <p style={{ fontSize: 13, color: "var(--text3)", marginBottom: 16 }}>{t("klassenarbeit.compareHint")}</p>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <KursKlasseSelect value={classId} onChange={(id, kid) => { setClassId(id); setKursId(kid); }} onKurs={setKursId} />
        {works.length > 0 && (
          <select value={workId || ""} onChange={(e) => setWorkId(Number(e.target.value))} style={{ ...selectStyle, minWidth: 180 }}>
            {works.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        )}
      </div>

      {/* Die Arbeit selbst gehoert in den Vergleich: wer eine Zeile „26 %" liest,
          will nachsehen, was da gefragt war. Nur ansehen — hochgeladen und
          geloescht wird bei der Arbeit, nicht hier. */}
      {workId && (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", marginTop: 16 }}>
          <MaterialPanel workId={workId} rolle="arbeit" titel={t("klassenarbeit.fileWork")} nurLesen />
          <MaterialPanel workId={workId} rolle="erwartung" titel={t("klassenarbeit.fileExpect")} nurLesen />
        </div>
      )}

      {classId && (
        <div style={{ marginTop: 16 }}>
          <Tabs value={sicht} onChange={setSicht} options={[
            ["klassen", t("klassenarbeit.cmpClasses")],
            ["aufgaben", t("klassenarbeit.cmpTasks")],
            ["verlauf", t("klassenarbeit.cmpHistory")],
          ]} />
        </div>
      )}

      {/* 1) Dieselbe Arbeit über die Klassen: eine Zeile je Klasse. */}
      {sicht === "klassen" && (
        klassen.length === 0 ? (
          <div style={{ marginTop: 24 }}><Empty title={t("klassenarbeit.compareEmpty")} /></div>
        ) : (
          <div style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: cardStyle.borderRadius, background: "var(--card)", overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 620 }}>
              <thead>
                <tr>
                  <th style={{ ...kopf, textAlign: "left" }}>{t("klassenarbeit.cmpClass")}</th>
                  <th style={{ ...kopf, textAlign: "left", width: "45%" }}>0 % – 100 %</th>
                  <th style={kopf}>n</th>
                  <th style={kopf}>⌀ %</th>
                  <th style={kopf}>⌀ {t("klassenarbeit.grade")}</th>
                </tr>
              </thead>
              <tbody>
                {klassen.map((a) => {
                  const q = quartiles(a.pct_liste);
                  return (
                    <tr key={a.id} style={a.eigene ? { background: "var(--bg2)" } : undefined}>
                      <td style={{ ...zelle, textAlign: "left", fontWeight: 600 }} title={a.name}>{a.class_name || a.name}</td>
                      <td style={{ ...zelle, textAlign: "left" }}><Boxplot values={a.pct_liste} max={100} compact /></td>
                      <td style={{ ...zelle, color: "var(--text3)" }}>{a.n}</td>
                      <td style={{ ...zelle, fontWeight: 600 }}>{fmt(a.schnitt)}</td>
                      <td style={{ ...zelle, fontWeight: 700, color: q ? boxColor(q.med) : "var(--text)" }}>{nt(noteVon(a.pct_liste))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text3)" }}>
              {t("klassenarbeit.boxplotLegend")} {klassen.length === 1 && `· ${t("klassenarbeit.cmpOnlyOne")}`}
            </div>
          </div>
        )
      )}

      {/* 2) Je Aufgabe: Klassen nebeneinander, Gesamtzahlen daneben, Details
             auf Klick. Die Trefferquote allein sagt nur, wie schwer eine Aufgabe
             war — ob sie MISSLUNGEN ist, zeigen Trennschärfe und der Anteil
             leerer Abgaben. */}
      {sicht === "aufgaben" && (
        inhaltlich.length === 0 ? (
          <div style={{ marginTop: 24 }}><Empty title={t("klassenarbeit.compareEmpty")} /></div>
        ) : (
          <div style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: cardStyle.borderRadius, background: "var(--card)", overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={{ ...kopf, textAlign: "left" }}>{t("klassenarbeit.cmpTask")}</th>
                  {klassen.map((a) => <th key={a.id} style={kopf} title={a.name}>{a.class_name || "?"}</th>)}
                  {klassen.length > 1 && <th style={kopf}>{t("klassenarbeit.cmpSpread")}</th>}
                  <th style={{ ...kopf, borderLeft: "1px solid var(--border)" }}>{t("klassenarbeit.cmpAll")}</th>
                  <th style={kopf} title={t("klassenarbeit.cmpEmptyHint")}>{t("klassenarbeit.cmpEmpty")}</th>
                  <th style={kopf} title={t("klassenarbeit.cmpDiscrHint")}>{t("klassenarbeit.cmpDiscr")}</th>
                </tr>
              </thead>
              <tbody>
                {inhaltlich.map((r) => {
                  const g = r.g;
                  const hinweis = auffaellig(g);
                  const auf = offen === r.i;
                  return (
                    <Fragment key={r.i}>
                      <tr onClick={() => setOffen(auf ? null : r.i)} style={{ cursor: "pointer" }}>
                        <td style={{ ...zelle, textAlign: "left", fontWeight: 600 }}>
                          {r.label}
                          {r.max ? <span style={{ color: "var(--text3)", fontWeight: 400 }}> /{komma(r.max)}</span> : null}
                          {hinweis && <span title={hinweis} style={{ marginLeft: 8, color: C.warning, fontWeight: 700 }}>!</span>}
                        </td>
                        {r.werte.map((v, k) => (
                          <td key={k} style={{ ...zelle, fontWeight: 600, color: v == null ? "var(--text3)" : v < 50 ? C.danger : v < 75 ? C.warning : C.success }}>
                            {v == null ? "–" : `${v}%`}
                          </td>
                        ))}
                        {klassen.length > 1 && <td style={{ ...zelle, color: "var(--text3)" }}>{r.spanne == null ? "–" : `${r.spanne} Pp`}</td>}
                        <td style={{ ...zelle, fontWeight: 700, borderLeft: "1px solid var(--border)" }}>
                          {g?.pct == null ? "–" : `${g.pct}%`}
                          <span style={{ fontWeight: 400, color: "var(--text3)", fontSize: 11 }}> ({g?.n ?? 0})</span>
                        </td>
                        <td style={{ ...zelle, color: (g?.null ?? 0) >= 40 ? C.danger : "var(--text3)" }}>{g?.null == null ? "–" : `${g.null}%`}</td>
                        <td style={{ ...zelle, fontWeight: 600, color: g?.trenn == null ? "var(--text3)" : g.trenn < 0.1 ? C.danger : g.trenn < 0.2 ? C.warning : "var(--text2)" }}>
                          {g?.trenn == null ? "–" : komma(g.trenn)}
                        </td>
                      </tr>
                      {auf && (
                        <tr>
                          <td colSpan={klassen.length + (klassen.length > 1 ? 4 : 3)} style={{ padding: "0 10px 12px", borderTop: "none", background: "var(--bg2)" }}>
                            {hinweis && <div style={{ fontSize: 13, color: C.warning, padding: "8px 0 4px", fontWeight: 600 }}>{hinweis}</div>}
                            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
                              <thead>
                                <tr>
                                  <th style={{ ...kopf, textAlign: "left", padding: "6px 8px" }}>{t("klassenarbeit.cmpClass")}</th>
                                  <th style={{ ...kopf, padding: "6px 8px" }}>n</th>
                                  <th style={{ ...kopf, padding: "6px 8px" }}>⌀ {t("klassenarbeit.points")}</th>
                                  <th style={{ ...kopf, padding: "6px 8px" }}>%</th>
                                  <th style={{ ...kopf, padding: "6px 8px" }} title={t("klassenarbeit.cmpEmptyHint")}>{t("klassenarbeit.cmpEmpty")}</th>
                                  <th style={{ ...kopf, padding: "6px 8px" }} title={t("klassenarbeit.cmpFullHint")}>{t("klassenarbeit.cmpFull")}</th>
                                  <th style={{ ...kopf, padding: "6px 8px" }}>SD</th>
                                  <th style={{ ...kopf, padding: "6px 8px" }} title={t("klassenarbeit.cmpDiscrHint")}>{t("klassenarbeit.cmpDiscr")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {r.detail.map((d, k) => (
                                  <tr key={k}>
                                    <td style={{ ...zelle, textAlign: "left", padding: "6px 8px" }}>{klassen[k]?.class_name || "?"}</td>
                                    <td style={{ ...zelle, padding: "6px 8px", color: "var(--text3)" }}>{d?.n ?? "–"}</td>
                                    <td style={{ ...zelle, padding: "6px 8px" }}>{komma(d?.schnitt, "–")}</td>
                                    <td style={{ ...zelle, padding: "6px 8px", fontWeight: 600 }}>{d?.pct == null ? "–" : `${d.pct}%`}</td>
                                    <td style={{ ...zelle, padding: "6px 8px" }}>{d?.null == null ? "–" : `${d.null}%`}</td>
                                    <td style={{ ...zelle, padding: "6px 8px" }}>{d?.voll == null ? "–" : `${d.voll}%`}</td>
                                    <td style={{ ...zelle, padding: "6px 8px", color: "var(--text3)" }}>{komma(d?.sd, "–")}</td>
                                    <td style={{ ...zelle, padding: "6px 8px" }}>{komma(d?.trenn, "–")}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text3)", lineHeight: 1.5 }}>
              {t("klassenarbeit.cmpTasksLegend")}
              {formAufgaben.length > 0 && ` · ${t("klassenarbeit.cmpFormOut", { n: formAufgaben.length })}`}
            </div>
          </div>
        )
      )}

      {/* 3) Verlauf: alle Arbeiten dieser Klasse nacheinander (die frühere Sicht). */}
      {sicht === "verlauf" && (
        verlauf.length === 0 ? (
          <div style={{ marginTop: 24 }}><Empty title={t("klassenarbeit.compareEmpty")} /></div>
        ) : (
          <div style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: cardStyle.borderRadius, background: "var(--card)", overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 620 }}>
              <thead>
                <tr>
                  <th style={{ ...kopf, textAlign: "left" }}>{t("klassenarbeit.compareWork")}</th>
                  <th style={{ ...kopf, textAlign: "left", width: "45%" }}>0 % – 100 %</th>
                  <th style={kopf}>n</th>
                  <th style={kopf}>⌀ %</th>
                  <th style={kopf}>⌀ {t("klassenarbeit.grade")}</th>
                </tr>
              </thead>
              <tbody>
                {verlauf.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...zelle, textAlign: "left", fontWeight: 600, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }} title={r.name}>{r.name}</td>
                    <td style={{ ...zelle, textAlign: "left" }}><Boxplot values={r.pl} max={100} compact /></td>
                    <td style={{ ...zelle, color: "var(--text3)" }}>{r.q.n}</td>
                    <td style={{ ...zelle, fontWeight: 600 }}>{fmt(r.q.avg)}</td>
                    <td style={{ ...zelle, fontWeight: 700, color: boxColor(r.q.med) }}>{nt(r.avgNote)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text3)" }}>{t("klassenarbeit.boxplotLegend")}</div>
          </div>
        )
      )}
    </div>
  );
}

// Ziel einer Kopie waehlen. Bewusst dieselbe Auswahl wie oben in der Leiste
// (KursKlasseSelect) — eine Klasse kann in mehreren Kursen liegen, und die
// Arbeit haengt am Kurs, wenn es einen gibt.
function KopieModal({ work, onClose, onCopy, t }) {
  const [classId, setClassId] = useState(null);
  const [kursId, setKursId] = useState(null);
  const [name, setName] = useState(work.name || "");
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState("");

  const los = async () => {
    if (!classId) return;
    setBusy(true); setFehler("");
    const ok = await onCopy(classId, kursId, name.trim() || work.name);
    setBusy(false);
    if (!ok) setFehler(t("common.notWork"));
  };

  return (
    <Modal onClose={onClose} width={420} label={t("klassenarbeit.copyTo")}>
      <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 6px" }}>{t("klassenarbeit.copyTo")}</h3>
      <p style={{ fontSize: 13, color: "var(--text3)", margin: "0 0 12px", lineHeight: 1.5 }}>{t("klassenarbeit.copyHint")}</p>

      <div style={{ fontSize: 13, color: "var(--text2)", margin: "0 0 5px" }}>{t("klassenarbeit.copyTarget")}</div>
      <KursKlasseSelect value={classId} kursValue={kursId} onChange={(id, kid) => { setClassId(id); setKursId(kid); }} onKurs={setKursId} />

      <div style={{ fontSize: 13, color: "var(--text2)", margin: "12px 0 5px" }}>{t("klassenarbeit.copyName")}</div>
      <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, width: "100%" }} />

      {fehler && <p style={{ color: C.danger, fontSize: 13, margin: "10px 0 0" }}>{fehler}</p>}
      <DialogFuss onSpeichern={los} onAbbrechen={onClose} aus={!classId || busy} speichern={t("klassenarbeit.copyGo")} />
    </Modal>
  );
}
