// Modul Kalender — Unterrichtsplanung. Tag-, Wochen- und Monatsansicht; je Tag
// Stunden eintragen und optional Klasse + Thema (Kern-Taxonomie) zuordnen.
import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react";
import { askChoice, askConfirm, showAlert } from "../core/dialog.jsx";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AddButton, Icon, ICONS, iconBtn, btnPrimary, btnSecondary, btnSmall, cardStyle, chipStyle, panelStyle, sectionLabel, COLORS as C, selectStyle, SHADOW, Tabs, td as tdCell, th, inputStyle, menuRow, toolbarInput, toolbarBtn, toolbarBtnPrimary, DatumNavigator, Segment, segmentBtn, toolbarIconBtn, CONTROL_H, CONTROL_R, Modal, pageApp, Popover } from "../components/Icons.jsx";
import { themenIndex } from "../core/topics.js";
import ThemenWahl from "../components/ThemenWahl.jsx";
import Stoffplan from "../components/Stoffplan.jsx";
import KursKlasseSelect from "../components/KursKlasseSelect.jsx";
import Werkzeugleiste, { MehrMenu } from "../components/Werkzeugleiste.jsx";
import UntisImport from "../components/UntisImport.jsx";
import CaldavZugaenge from "../components/CaldavZugaenge.jsx";
import { kursLabel } from "../core/kurslabel.js";
import { DialogFuss, useEntwurf } from "../components/Speichern.jsx";
import SpeicherBalken from "../components/SpeicherBalken.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { swr, put } from "../core/cache.js";
import { undoDelete } from "../core/undo.jsx";
import { alsJson, hol, pruefeAntwort, sende } from "../core/melden.js";
import MaterialPanel from "../components/MaterialPanel.jsx";
import ferienDE from "../data/ferien-de.json";
import { feiertage } from "../data/feiertage.js";
// ymd/isoDay/hmToMin/startOfDay/addDays/mondayOf/isoWeek standen hier eigens —
// dieselben Zeilen lagen in Zufall, Sitzplan, Anwesenheit und feiertage.js.
import { addDays, hmToMin, isoDay, isoWeek, mondayOf, parseYmd, startOfDay, wochentagMo0, ymd } from "../core/datum.js";

// Bundeslaender fuer den Ferien-Import (Kuerzel muss zu ferien-de.json passen).
const BUNDESLAENDER = [
  ["BW", "Baden-Württemberg"], ["BY", "Bayern"], ["BE", "Berlin"], ["BB", "Brandenburg"],
  ["HB", "Bremen"], ["HH", "Hamburg"], ["HE", "Hessen"], ["MV", "Mecklenburg-Vorpommern"],
  ["NI", "Niedersachsen"], ["NW", "Nordrhein-Westfalen"], ["RP", "Rheinland-Pfalz"], ["SL", "Saarland"],
  ["SN", "Sachsen"], ["ST", "Sachsen-Anhalt"], ["SH", "Schleswig-Holstein"], ["TH", "Thüringen"],
];

const API = "/api/kalender";

// Vorgabe im Farbwaehler eines externen Kalenders. Bewusst ein Hexwert: ein
// <input type="color"> nimmt keine CSS-Variable an.
const EXT_FARBE = "#8e8e93";
// Fremde Kalender ohne eigene Farbe bekommen eine aus dieser Reihe — sonst
// standen drei abonnierte Kalender alle im selben Grau, und im Monatsraster
// war nicht zu erkennen, was aus welchem kommt. Wer eine Farbe setzt, behaelt
// sie; die Reihe ist nur die Vorgabe, keine Zuweisung.
const EXT_PALETTE = ["#ff9f0a", "#30d158", "#bf5af2", "#64d2ff", "#ff375f", "#ffd60a"];


// Gilt die (versionierte) Stundenplan-Stunde am Tag d? valid_from/valid_to sind
// "YYYY-MM-DD" oder null (offen). Änderungen am Plan wirken ab heute, ältere Tage
// zeigen weiter die damalige Stunde.
const slotActiveOn = (s, d) => {
  const dd = ymd(d);
  if (s.valid_from && dd < s.valid_from) return false;
  if (s.valid_to && dd > s.valid_to) return false;
  return true;
};
// Auswahl-Dropdowns alphabetisch aufsteigend (A→Z / 1→2→3, zahlenbewusst) sortieren.
const byLabel = (label) => (a, b) => String(label(a)).localeCompare(String(label(b)), "de", { numeric: true });
// Ein Eintrag ist ganztägig, wenn er weder an einer Stunde noch an einer freien Uhrzeit hängt.
const isAllDayEntry = (e) => e.period == null && hmToMin(e.start_time) == null;
// Schmaler Viewport (Handy hochkant): kompaktere Darstellung (Monat mit Punkten).
function useNarrow(bp = 640) {
  const [n, setN] = useState(() => typeof window !== "undefined" && window.innerWidth < bp);
  useEffect(() => {
    const on = () => setN(window.innerWidth < bp);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [bp]);
  return n;
}
const weekValToDate = (s) => { const [y, w] = s.split("-W").map(Number); return addDays(mondayOf(new Date(y, 0, 4)), (w - 1) * 7); };

// Auswahlfeld in einem Dialog. `selectStyle` bringt CONTROL_H (34) mit — das
// ist die Hoehe einer WERKZEUGLEISTE. Mit 14px Schrift und 10px Polsterung oben
// und unten braucht die Zeile aber rund 38px: der Text wurde oben und unten
// beschnitten. Im Dialog gibt die Hoehe deshalb der Inhalt vor. Stand zweimal
// wortgleich in dieser Datei (Termin- und Slot-Dialog).
const dialogSelect = { ...selectStyle, width: "100%", height: "auto", fontSize: 14, padding: "10px 34px 10px 12px" };

export default function Kalender() {
  const { t } = useLanguage();
  const nav = useNavigate();
  // Ansicht in der URL (?view=), damit der Stundenplan aus dem Navbar-Menü
  // ansteuerbar ist. Ohne Parameter = Monat. Andere Query-Params bleiben.
  const [params, setParams] = useSearchParams();
  // „today" gibt es als Ansicht nicht mehr — alte Lesezeichen und Deep-Links
  // landen auf dem Tag, statt auf einer leeren Seite.
  // Welche Ansicht ohne ?view= erscheint, entscheidet die Lehrkraft: wer den
  // Kalender taeglich zum Planen der naechsten Stunde aufmacht, will nicht
  // jedes Mal erst vom Monat auf den Tag klicken. Im Browser gemerkt und nicht
  // am Konto — es ist eine Ansicht, kein Inhalt.
  const [startAnsicht, setStartAnsicht] = useState(() => {
    try { const v = localStorage.getItem("kal_view_start"); return ["month", "week", "day"].includes(v) ? v : "month"; } catch { return "month"; }
  });
  const setzeStartAnsicht = (v) => { setStartAnsicht(v); try { localStorage.setItem("kal_view_start", v); } catch { /* egal */ } };
  const view = (params.get("view") === "today" ? "day" : params.get("view")) || startAnsicht;
  const setView = (v) => setParams((p) => { const n = new URLSearchParams(p); if (v === startAnsicht) n.delete("view"); else n.set("view", v); return n; }, { replace: true });
  // Startdatum optional per ?date=YYYY-MM-DD (Deep-Link, z.B. aus den Einstiegen).
  const [cursor, setCursor] = useState(() => parseYmd(params.get("date")) || startOfDay(new Date()));
  const [abo, setAbo] = useState(null); // Abo-URLs { url, webcal }
  const [viewMenuOpen, setViewMenuOpen] = useState(false); // „Auge"-Menü (was ein-/ausblenden)
  const [showAllDay, setShowAllDay] = useState(() => { try { return localStorage.getItem("kal_allday") !== "0"; } catch { return true; } });
  const toggleAllDay = () => setShowAllDay((v) => { const n = !v; try { localStorage.setItem("kal_allday", n ? "1" : "0"); } catch { /* egal */ } return n; });
  const [showExt, setShowExt] = useState(() => { try { return localStorage.getItem("kal_ext") !== "0"; } catch { return true; } });
  const toggleExt = () => setShowExt((v) => { const n = !v; try { localStorage.setItem("kal_ext", n ? "1" : "0"); } catch { /* egal */ } return n; });
  // Einzelne externe Kalender ausblenden. Der Schalter darüber blendet ALLE
  // aus; wer drei Feeds abonniert hat (Schule, Verein, Familie), will aber
  // meistens genau einen davon loswerden. Gemerkt wird die URL, nicht die
  // Position: eine Position verschiebt sich, sobald jemand einen Kalender
  // ergänzt oder entfernt, und dann wäre plötzlich der falsche unsichtbar.
  // Im Browser und nicht am Konto — es ist eine Ansicht, kein Inhalt.
  const [extAus, setExtAus] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("kal_ext_aus") || "[]")); } catch { return new Set(); }
  });
  const toggleExtCal = (url) => setExtAus((v) => {
    const n = new Set(v);
    if (n.has(url)) n.delete(url); else n.add(url);
    try { localStorage.setItem("kal_ext_aus", JSON.stringify([...n])); } catch { /* egal */ }
    return n;
  });
  // Mehrere externe Kalender (read-only): je Kalender URL + Farbe. Einzelne
  // Ereignisse lassen sich ausblenden (external_hidden, Schlüssel uid|Datum).
  const [extCals, setExtCals] = useState([]); // [{url,color,name}]
  const [extEvents, setExtEvents] = useState([]); // [{date,title,color,key,…}]
  const [todoEvents, setTodoEvents] = useState([]); // datierte To-dos [{id,date,time,text,done}]
  // Farbe je Kalender: die eigene, sonst eine aus der Reihe — nach der
  // POSITION in der Liste, damit derselbe Kalender seine Farbe behaelt,
  // solange die Liste steht.
  const extFarbe = (url) => {
    const i = extCals.findIndex((c) => c.url === url);
    if (i < 0) return EXT_FARBE;
    return extCals[i].color || EXT_PALETTE[i % EXT_PALETTE.length];
  };
  // Fallback fuer Termine ohne zuordenbaren Kalender.
  const extColor = EXT_FARBE;
  const openAbo = async () => {
    const r = await fetch(`${API}/subscribe`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (r) { const ex = await fetch(`${API}/external`).then((x) => (x.ok ? x.json() : {})).catch(() => ({})); setAbo({ ...r, cals: (ex.calendars || []), mit: !!ex.mitschicken }); }
  };
  // Force-Resync: neues Abo-Token holen. Die alte URL wird sofort ungueltig —
  // damit behandelt Apple/Google das Abo als neu und laedt alles einmal frisch.
  // Danach muss der alte Kalender entfernt und die neue URL abonniert werden.
  const [resyncing, setResyncing] = useState(false);
  const resyncAbo = async () => {
    if (!(await askConfirm(t("kalender.resyncConfirm")))) return;
    setResyncing(true);
    const r = await fetch(`${API}/subscribe/resync`, { method: "POST" }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    setResyncing(false);
    if (r) { setAbo((a) => ({ ...a, url: r.url, webcal: r.webcal })); showAlert(t("kalender.resyncDone")); }
  };
  const [extBusy, setExtBusy] = useState(false);
  const loadExt = (force = false) => { if (force) setExtBusy(true); return hol(`${API}/external-events${force ? "?refresh=1" : ""}`).then((d) => setExtEvents(Array.isArray(d) ? d : [])).finally(() => force && setExtBusy(false)); };
  // Kalenderliste speichern (URL/Farbe je Kalender) und Events neu ziehen.
  const saveCals = async (cals, mitschicken) => {
    const clean = cals.filter((c) => (c.url || "").trim());
    await fetch(`${API}/external`, alsJson("PUT", { calendars: clean, mitschicken })).catch(() => {});
    setExtCals(clean); loadExt(true);
  };
  // Ein externes Ereignis aus-/wieder einblenden (Schlüssel uid|Datum).
  const hideExtEvent = async (key) => {
    if (!key) return;
    setExtEvents((evs) => evs.filter((e) => e.key !== key));  // sofort raus
    await fetch(`${API}/external/hide`, alsJson("POST", { key })).catch(() => {});
    loadHidden();
  };
  // Ausgeblendete fremde Termine MIT Titel und Datum — der Reiter zeigt sie,
  // und eine Liste aus Schlüsseln beantwortet nicht, was da weg ist.
  const [extHiddenList, setExtHiddenList] = useState([]);
  const loadHidden = useCallback(() => {
    hol(`${API}/external-hidden`).then((d) => setExtHiddenList(Array.isArray(d) ? d : []));
  }, []);
  const unhideExtEvent = async (key) => {
    await fetch(`${API}/external/unhide`, alsJson("POST", { key })).catch(() => {});
    loadHidden();
    loadExt(true);
  };
  useEffect(() => { hol(`${API}/external`, {}).then((d) => { setExtCals(d.calendars || []); if ((d.calendars || []).length) loadExt(); }); }, []);
  const extByDay = (d) => extEvents.filter((e) => e.date === ymd(d));
  const [entries, setEntries] = useState([]);
  const [classes, setClasses] = useState([]);
  const [kurse, setKurse] = useState([]); // Fächer — die Anzeige zeigt den Kurs, nicht die Klasse
  const [topics, setTopics] = useState([]);
  const [methods, setMethods] = useState([]); // aus Modul Methoden (falls aktiv)
  const [quizze, setQuizze] = useState([]); // CardVote-Quizze (falls aktiv), flach
  const [ladders, setLadders] = useState([]); // Lernpfad-Lernleitern (falls aktiv), flach
  const [puzzles, setPuzzles] = useState([]); // Code-Detektiv-Rätsel (falls aktiv)
  const [aktiv, setAktiv] = useState({}); // { cardvote, karten, lernpfad } aktiv?
  const [editing, setEditing] = useState(null); // { date, ...entry } oder null
  const [tt, setTt] = useState({ periods: 6, slots: [] }); // Stundenplan
  // Fuer welchen Zeitraum der Stundenplan bearbeitet wird: "1", "2", "jahr"
  // oder "" (laufendes Halbjahr). Schulen machen den Plan je Halbjahr neu; der
  // alte bleibt stehen (valid_from/valid_to je Stunde).
  const [term, setTerm] = useState("");
  const sj = (tt && tt.schuljahr) || {};
  // Auf welchen Tag der Editor schaut. Ohne Schuljahr im Profil: heute.
  const stichtag = (() => {
    const d = term === "2" ? sj.hj2 : (term === "1" || term === "jahr") ? sj.hj1 : "";
    return d ? new Date(d + "T00:00:00") : new Date();
  })();
  const [showTimes, setShowTimes] = useState(false); // Uhrzeiten-Spalte im Stundenplan
  // WebUntis-Import: der Stundenplan der Schule steht schon in Untis — ihn
  // hier ein zweites Mal einzutragen ist die Arbeit, die dieses Modul
  // abnehmen soll. Der Dialog schreibt nichts, bevor jemand bestaetigt.
  const [untisOffen, setUntisOffen] = useState(false);
  const [breaks, setBreaks] = useState([]); // unterrichtsfreie Zeitraeume (Ferien/Feiertage)
  const [examOverview, setExamOverview] = useState([]); // Klassenarbeiten-Übersicht (kommend + Reststunden)
  const loadExams = () => hol(`${API}/klassenarbeiten/uebersicht`).then((d) => setExamOverview(Array.isArray(d) ? d : []));
  // Nach jeder Änderung auch die Kalender-Einträge neu laden — die Klassenarbeit
  // erzeugt/ändert/löscht serverseitig einen ganztägigen Eintrag.
  // Klassenarbeiten: hier tippt die Lehrkraft Termin und Bezeichnung. Ohne
  // Prüfung holte loadExams() den alten Stand zurück — der Termin war weg, und
  // der Kalender zeigte am Tag der Arbeit nichts an.
  const addExam = async (body) => { await sende(`${API}/klassenarbeiten`, alsJson("POST", body), t("common.save")); loadExams(); load(); };
  const updExam = async (id, body) => { await sende(`${API}/klassenarbeiten/${id}`, alsJson("PUT", body), t("common.save")); loadExams(); load(); };
  const delExam = async (id) => { await sende(`${API}/klassenarbeiten/${id}`, { method: "DELETE" }, t("common.delete")); loadExams(); load(); };
  useEffect(() => { if (view === "klassenarbeit") loadExams(); /* eslint-disable-next-line */ }, [view]);
  useEffect(() => { loadHidden(); }, [loadHidden]);
  const [wdhVorschlag, setWdhVorschlag] = useState([]); // schwache Themen der Vorwoche
  const [slotEdit, setSlotEdit] = useState(null); // { weekday, period, ...slot } oder null
  const [extInfo, setExtInfo] = useState(null); // angeklickter externer (abonnierter) Termin
  const [jumpOpen, setJumpOpen] = useState(false); // Datums-Sprung-Popover (Klick aufs Datum)
  // Suche im ganzen Kalender (nicht nur im sichtbaren Zeitraum) — wer
  // „Noteneingabe" sucht, weiss ja gerade nicht, in welcher Woche das steht.
  const [sucheOffen, setSucheOffen] = useState(false);
  const [suchText, setSuchText] = useState("");
  const [treffer, setTreffer] = useState([]);
  const [suchLaeuft, setSuchLaeuft] = useState(false);
  // Nach dem Sprung soll der getroffene Eintrag aufgehen — er steckt aber im
  // Zeitraum, der erst nachgeladen wird. Also merken und oeffnen, sobald er da
  // ist.
  const [springZu, setSpringZu] = useState(null); // { art, id } oder null

  useEffect(() => {
    swr("classes", "/api/classes", (d) => setClasses(Array.isArray(d) ? d : []));
    // Kurse (Fächer) laden: der Stundenplan/Kalender denkt in Kursen, nicht in
    // Fach-Klassen — die Anzeige nutzt darum den Kurs-Namen (siehe className).
    hol("/api/kurse").then((d) => setKurse(Array.isArray(d) ? d : []));
    swr("topics", "/api/topics", (d) => setTopics(Array.isArray(d) ? d : []));
    // Regel 3: Modul-Objekte nur laden/anbieten, wenn das Modul aktiviert ist.
    hol("/api/modules").then((mods) => {
      const on = {};
      (Array.isArray(mods) ? mods : []).forEach((m) => { if (m.active) on[m.key] = true; });
      setAktiv(on);
      // Einstiege wie alles andere erst nach der Modulfrage. Vorher lief der
      // Aufruf bedingungslos: ohne das Modul antwortete der Server mit 403 und
      // auf JEDER Kalenderseite stand ein Fehler in der Konsole.
      if (on.unterrichtsplanung) hol("/api/methoden/list").then((d) => setMethods(Array.isArray(d) ? d : []));
      if (on.cardvote) hol("/api/folders").then((tree) => {
        // Quizze aus dem (rekursiven) Ordnerbaum flach ziehen, Ordnername als Kontext.
        const flat = [];
        const walk = (f) => { (f.question_sets || []).forEach((q) => flat.push({ id: q.id, name: q.name, folder: f.name })); (f.children || []).forEach(walk); };
        (Array.isArray(tree) ? tree : []).forEach(walk);
        setQuizze(flat);
      });
      if (on.lernpfad) hol("/api/lernpfad/paths").then((paths) => {
        const flat = [];
        // LadderOut hat kein name, nur topic_id — Thema/Unterthema wird per topicName aufgelöst.
        (Array.isArray(paths) ? paths : []).forEach((p) => (p.ladders || []).forEach((l) => flat.push({ id: l.id, topic_id: l.topic_id, path: p.name })));
        setLadders(flat);
      });
      if (on["code-detektiv"]) hol("/api/codedetektiv/puzzles").then((d) => setPuzzles(Array.isArray(d) ? d : []));
    });
  }, []);

  const loadTt = useCallback(() => {
    hol(`${API}/timetable`, null).then((d) => { if (d) setTt(d); });
  }, []);
  useEffect(() => { loadTt(); }, [loadTt]);

  const loadBreaks = useCallback(() => {
    hol(`${API}/breaks`).then((d) => setBreaks(Array.isArray(d) ? d : []));
  }, []);
  useEffect(() => { loadBreaks(); }, [loadBreaks]);

  // Ausgefallene Stundenplan-Stunden (Datum + Stunde). Eine einzelne Stunde an
  // einem Tag entfällt, ohne den ganzen Tag (freie Tage) auszublenden.
  const [slotCancels, setSlotCancels] = useState([]);
  const loadCancels = useCallback(() => {
    hol(`${API}/slot-cancellations`).then((d) => setSlotCancels(Array.isArray(d) ? d : []));
  }, []);
  useEffect(() => { loadCancels(); }, [loadCancels]);
  const cancelSet = new Set(slotCancels.map((c) => `${ymd(new Date(c.date))}|${c.period}`));
  const isCancelled = (d, period) => cancelSet.has(`${ymd(d)}|${period}`);
  const cancelSlot = async (d, period) => {
    await fetch(`${API}/slot-cancellations`, alsJson("POST", { date: isoDay(d), period })).catch(() => {});
    loadCancels();
  };
  const restoreSlot = async (d, period) => {
    await fetch(`${API}/slot-cancellations`, alsJson("DELETE", { date: isoDay(d), period })).catch(() => {});
    loadCancels();
  };

  // Wochenansicht: schwache Themen der Vorwoche als Wiederholungs-Vorschlag.
  useEffect(() => {
    if (view !== "week" || !aktiv.cardvote) { setWdhVorschlag([]); return; }
    const vorMo = addDays(mondayOf(cursor), -7);
    const vorSo = addDays(vorMo, 6);
    hol(`/api/weak-topics?frm=${vorMo.toISOString()}&to=${addDays(vorSo, 1).toISOString()}`, null).then((d) => setWdhVorschlag(d && Array.isArray(d.topics) ? d.topics : []));
  }, [view, cursor, aktiv.cardvote]);
  // Ist der Tag unterrichtsfrei (in einem Ferien-/Feiertags-Zeitraum)?
  const frei = (d) => breaks.find((b) => ymd(d) >= ymd(new Date(b.start_date)) && ymd(d) <= ymd(new Date(b.end_date)));

  const addBreak = async (b) => {
    const res = await fetch(`${API}/breaks`, alsJson("POST", b)).catch(() => null);
    if (res && res.ok) loadBreaks();
  };
  const delBreak = (id) => {
    setBreaks((prev) => prev.filter((b) => b.id !== id)); // sofort weg
    undoDelete({
      message: t("undo.deletedGeneric"),
      undo: () => loadBreaks(),
      commit: async () => { await fetch(`${API}/breaks/${id}`, { method: "DELETE" }).catch(() => {}); },
    });
  };

  // Kalender-Export/-Import gibt es in der Oberflaeche nicht mehr: eine
  // JSON-Datei, die niemand oeffnen kann, beantwortet keine Frage, die jemand
  // an einen Kalender stellt — dafuer gibt es das Abo (und CalDAV). Die
  // Endpunkte bleiben: an ihnen haengt die Kontosicherung.

  // Sichtbarer Zeitraum je Ansicht.
  const range = (() => {
    if (view === "day") return [startOfDay(cursor), startOfDay(cursor)];
    if (view === "week") { const s = mondayOf(cursor); return [s, addDays(s, 6)]; }
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    return [mondayOf(first), addDays(mondayOf(last), 6)];
  })();

  const load = useCallback(() => {
    const [a, b] = range;
    hol(`${API}/entries?frm=${a.toISOString()}&to=${addDays(b, 1).toISOString()}`).then((d) => setEntries(Array.isArray(d) ? d : []));
    // Datierte To-dos (nur bei aktivem Modul) mit anzeigen — Regel-3-Zusatz.
    if (aktiv.notizbrett) {
      hol(`/api/todo/calendar?frm=${ymd(a)}&to=${ymd(b)}`).then((d) => setTodoEvents(Array.isArray(d) ? d : []));
    } else setTodoEvents([]);
  }, [view, cursor, aktiv.notizbrett]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);

  // Suchen mit kurzer Verzoegerung: ein Aufruf je Tastendruck waere ein
  // Serverlauf je Buchstabe, und die Antwort des vorletzten kaeme zuletzt.
  useEffect(() => {
    const q = suchText.trim();
    if (!sucheOffen || q.length < 2) { setTreffer([]); setSuchLaeuft(false); return; }
    setSuchLaeuft(true);
    let gilt = true;
    const timer = setTimeout(() => {
      hol(`${API}/suche?q=${encodeURIComponent(q)}`).then((d) => {
        if (!gilt) return;
        setTreffer(Array.isArray(d) ? d : []);
        setSuchLaeuft(false);
      });
    }, 250);
    return () => { gilt = false; clearTimeout(timer); };
  }, [suchText, sucheOffen]);

  // Ist der Zeitraum des Treffers geladen, den Eintrag oeffnen. Nur Eintraege:
  // ein Klassenarbeitstermin und ein freier Zeitraum haben im Tag keine eigene
  // Maske, dort ist der Sprung selbst die Antwort.
  useEffect(() => {
    if (!springZu) return;
    if (springZu.art === "entry") {
      const treffer_ = entries.find((e) => e.id === springZu.id);
      if (treffer_) { setEditing(treffer_); setSpringZu(null); }
      return;
    }
    if (springZu.art === "extern") {
      // Externe Termine liegen nicht in `entries`, sondern in `extEvents` —
      // ihr Schluessel ist uid|Datum.
      const ev = extEvents.find((x) => x.key === springZu.key);
      if (ev) { setExtInfo(ev); setSpringZu(null); }
      return;
    }
    setSpringZu(null);
  }, [entries, extEvents, springZu]);

  const springeZuTreffer = (tr) => {
    setSucheOffen(false);
    setCursor(parseYmd(tr.date) || startOfDay(new Date()));
    setView("day");
    setSpringZu({ art: tr.art, id: tr.id, key: tr.key || "" });
  };
  const todoByDay = (d) => todoEvents.filter((e) => e.date === ymd(d));

  const topicName = (id) => {
    const tp = topics.find((x) => x.id === id);
    if (!tp) return "";
    const p = tp.parent_id ? topics.find((x) => x.id === tp.parent_id) : null;
    return p ? `${p.name} / ${tp.name}` : tp.name;
  };
  // Ein mehrtaegiger Eintrag gehoert an JEDEN Tag seines Zeitraums, nicht nur
  // an den ersten — sonst waere die Klassenfahrt ab Dienstag unsichtbar.
  const byDay = (d) => entries.filter((e) => {
    const tag = ymd(d);
    const von = ymd(new Date(e.date));
    const bis = e.end_date ? ymd(new Date(e.end_date)) : von;
    return tag >= von && tag <= bis;
  });
  // Ganztägig ein/ausblenden: filtert ganztägige Einträge bzw. externe Termine
  // ohne Uhrzeit aus den Kalenderansichten (Stundenplan-Slots bleiben).
  const byDayV = (d) => showAllDay ? byDay(d) : byDay(d).filter((e) => !isAllDayEntry(e));
  const extByDayV = (d) => {
    if (!showExt) return [];
    const list = extByDay(d).filter((ev) => !extAus.has(ev.cal || ""))
      .map((ev) => ({ ...ev, color: ev.color || extFarbe(ev.cal || "") }));
    return showAllDay ? list : list.filter((ev) => hmToMin(ev.time) != null);
  };

  const move = (dir) => {
    if (view === "day") setCursor(addDays(cursor, dir));
    else if (view === "week") setCursor(addDays(cursor, dir * 7));
    else setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1));
  };
  // Pfeiltasten ←/→ blättern (nur in Monat/Woche/Tag, nicht beim Tippen).
  useEffect(() => {
    const onKey = (e) => {
      if (["timetable", "breaks", "klassenarbeit", "stoffplan", "today"].includes(view)) return;
      const el = document.activeElement;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      if (e.key === "ArrowLeft") move(-1);
      else if (e.key === "ArrowRight") move(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, cursor]); // eslint-disable-line

  // Eine Serie beruehrt mehr als den Tag, den man vor sich hat. Deshalb wird
  // gefragt, bevor etwas passiert — und zwar nur dann, wenn es wirklich eine
  // Serie ist und man an einem ihrer Vorkommen steht.
  const serienFrage = async (e, art) => {
    if (!e.rrule || !e.occ || !e.id) return "alle";
    return askChoice(t(art === "del" ? "kalender.serieDelFrage" : "kalender.serieSaveFrage"), [
      { key: "einer", label: t("kalender.serieNurDieser"), danger: art === "del" },
      { key: "alle", label: t("kalender.serieGanze"), danger: art === "del" },
    ]);
  };

  const save = async (e) => {
    const wahl = await serienFrage(e, "save");
    if (!wahl) return;
    if (wahl === "einer") {
      // Diesen einen Tag aus der Serie loesen: der Server nimmt ihn auf die
      // EXDATE-Liste und legt eine eigenstaendige Kopie an. Weiter geht es mit
      // der Kopie — die traegt keine Regel mehr, sonst haetten wir zwei Serien.
      const r = await fetch(`${API}/entries/${e.id}/ausnahme`, alsJson("POST", { date: isoDay(e.date), loesen: true })).catch(() => null);
      if (!(await pruefeAntwort(r, t("common.save")))) return;
      let kopie = null; try { kopie = await r.json(); } catch { /* egal */ }
      if (!kopie || !kopie.id) return;
      e = { ...e, id: kopie.id, rrule: "", exdate: [], occ: "" };
    }
    const body = { date: isoDay(e.date), title: e.title || "", notes: e.notes || "", location: e.location || "", rrule: e.rrule || "", exdate: Array.isArray(e.exdate) ? e.exdate : [], verlaufsplan: Array.isArray(e.verlaufsplan) ? e.verlaufsplan : [], class_id: e.class_id || null, kurs_id: e.kurs_id ?? null, topic_id: e.topic_id || null, method_id: e.method_id || null, period: e.period ?? null, start_time: e.start_time || "", end_time: e.end_time || "", cardvote_set_id: e.cardvote_set_id || null, karten_deck_id: e.karten_deck_id || null, lernpfad_ladder_id: e.lernpfad_ladder_id || null, codedetektiv_puzzle: e.codedetektiv_puzzle || null };
    const res = await fetch(e.id ? `${API}/entries/${e.id}` : `${API}/entries`, alsJson(e.id ? "PUT" : "POST", body)).catch(() => null);
    // Lehnte der Server ab, passierte bisher NICHTS: das Modal blieb offen, der
    // getippte Verlaufsplan stand noch da, und nur ein späterer Blick auf den
    // Tag verriet, dass die Stunde nie gespeichert wurde.
    if (!(await pruefeAntwort(res, t("common.save")))) return;
    if (res && res.ok) {
      // Nach dem Speichern den Eintrag ANZEIGEN (nicht schließen). _justSaved lässt
      // das Modal in die Ansicht wechseln; date wieder als Date, id vom Server.
      let saved = null; try { saved = await res.json(); } catch { /* egal */ }
      load();
      setEditing({ ...e, ...(saved || {}), date: saved && saved.date ? new Date(saved.date) : e.date, _justSaved: Date.now() });
    }
  };
  const remove = async (id, ev = null) => {
    const wahl = await serienFrage(ev || { id }, "del");
    if (!wahl) return;
    const tag = ev && ev.date ? isoDay(ev.date) : null;
    setEditing(null);
    // Bei "nur dieser" faellt genau ein Tag weg, sonst der ganze Eintrag.
    setEntries((prev) => prev.filter((e) => e.id !== id || (wahl === "einer" && ymd(new Date(e.date)) !== ymd(new Date(ev.date)))));
    undoDelete({
      message: t("undo.deletedGeneric"),
      undo: () => load(),
      commit: async () => {
        if (wahl === "einer") await fetch(`${API}/entries/${id}/ausnahme`, alsJson("POST", { date: tag, loesen: false })).catch(() => {});
        else await fetch(`${API}/entries/${id}`, { method: "DELETE" }).catch(() => {});
        load();
      },
    });
  };

  // Anzeige-Name eines Slots/Eintrags: der KURS, zu dem die Klasse gehört; nur
  // wenn keine Kurs-Zuordnung existiert, der Klassenname als Fallback.
  //
  // Beschriftet wird „Fach · Kursname" (core/kurslabel.js) — im Kalender kommt
  // die Frage „was habe ich jetzt?" vor „mit wem?", und der Kursname allein
  // beantwortet sie nicht: er ist frei gewählt („7.5", „Gruppe rot") und nennt
  // oft gar kein Fach. Dieselbe Regel gilt im ICS-Feed, damit ein Termin im
  // Handykalender nicht anders heißt als im Browser.
  const className = (id) => {
    const k = kurse.find((k) => (k.classes || []).some((c) => c.id === id));
    if (k) return kursLabel(k);
    return (classes.find((c) => c.id === id) || {}).name || "";
  };
  const kursName = (id) => kursLabel(kurse.find((k) => k.id === id));
  // Stundenplan-Label: den GEWÄHLTEN Kurs zeigen (eindeutig gespeichert), sonst
  // per className raten. Eine Klasse kann in mehreren Kursen liegen — nur kurs_id
  // weiß, welcher gemeint war.
  const slotName = (s) => (s && s.kurs_id && kursName(s.kurs_id)) || className(s && s.class_id);

  // Ausgeblendetes im SICHTBAREN Zeitraum. Der Zeitraum ist der Punkt: im
  // Tagesblick interessiert nicht, was im November weggeblendet wurde.
  const [hiddenOffen, setHiddenOffen] = useState(false);
  const ausgeblendet = (() => {
    const [a, b] = range;
    const von = ymd(a), bis = ymd(b);
    const ext = (extHiddenList || []).filter((e) => e.date >= von && e.date <= bis);
    const stunden = (slotCancels || []).map((c) => {
      const d = new Date(c.date);
      const s = tt.slots.find((x) => x.weekday === wochentagMo0(d) && x.period === c.period && slotActiveOn(x, d));
      return { ...c, d, name: (s && (slotName(s) || s.title)) || "" };
    }).filter((c) => ymd(c.d) >= von && ymd(c.d) <= bis)
      .sort((x, y) => (x.d - y.d) || (x.period - y.period));
    return { ext, stunden, anzahl: ext.length + stunden.length };
  })();

  // Farbe gehört dem KURS (das, was im Slot gewählt wurde) — nicht der dahinter
  // liegenden Fach-Klasse. Sonst teilen sich mehrere Kurse mit derselben Klasse
  // (geteilte SuS) DIESELBE Farbe. Am slot.kurs_id (eindeutig), nicht per class_id.
  const classColor = (id) => (classes.find((c) => c.id === id) || {}).color || C.info; // Fallback (Einträge ohne Kurs)
  const kursColor = (id) => (kurse.find((k) => k.id === id) || {}).color || "";
  const slotColor = (s) => (s && s.kurs_id && kursColor(s.kurs_id)) || (s && s.class_id ? classColor(s.class_id) : C.info);
  const slotsFor = (d) => tt.slots.filter((s) => s.weekday === wochentagMo0(d) && slotActiveOn(s, d) && !isCancelled(d, s.period)).sort((a, b) => a.period - b.period);
  // Klick auf eine Stundenplan-Vorlage: gibt es an dem Tag schon einen Eintrag
  // dieser Klasse, wird der bearbeitet; sonst ein neuer aus der Vorlage.
  const fromSlot = (day, s) => {
    // Eindeutig ueber Tag + Stunde: ein zweiter Klick auf dieselbe Stunde
    // bearbeitet den vorhandenen Eintrag statt einen neuen anzulegen.
    const vorhanden = entries.find((e) => ymd(new Date(e.date)) === ymd(day) && e.period != null && e.period === s.period);
    if (vorhanden) setEditing({ ...vorhanden, date: new Date(vorhanden.date) });
    else {
      // Ort vorbelegen: der Stammraum des Kurses. Er ist die Regel, der
      // Raumtausch die Ausnahme — und die laesst sich am Eintrag ueberschreiben.
      const kid = s.kurs_id ?? (classes.find((c) => c.id === s.class_id) || {}).kurs_id ?? null;
      const raum = (kurse.find((k) => k.id === kid) || {}).raum || "";
      setEditing({ date: startOfDay(day), period: s.period, title: s.title || "", class_id: s.class_id || null, kurs_id: s.kurs_id ?? null, topic_id: s.topic_id || null, location: raum });
    }
  };

  // Farbe aus dem Stundenplan setzen: am FACH (Fach-Klasse), damit verschiedene
  // Fächer derselben Lerngruppe eigene Farben behalten. Sofort lokal, dann speichern.
  const setSlotColor = async (kursId, classId, color) => {
    // Bevorzugt am KURS (kurs_id) — so hat jeder Kurs seine eigene Farbe, auch
    // wenn mehrere Kurse dieselbe Fach-Klasse teilen. Nur ohne Kurs an der Klasse.
    if (kursId) {
      setKurse((prev) => prev.map((k) => (k.id === kursId ? { ...k, color } : k)));
      const r = await fetch(`/api/kurse/${kursId}/color`, alsJson("PUT", { color })).catch(() => null);
      // Die Farbe steht sofort lokal; scheiterte das Speichern, war sie nach
      // dem nächsten Laden wieder weg — bisher nur in der Konsole zu sehen.
      await pruefeAntwort(r, t("kalender.colorSave"));
    } else if (classId) {
      setClasses((prev) => { const next = prev.map((c) => (c.id === classId ? { ...c, color } : c)); put("classes", next); return next; });
      const r = await fetch(`/api/classes/${classId}/color`, alsJson("PUT", { color })).catch(() => null);
      await pruefeAntwort(r, t("kalender.colorSave"));
    }
  };

  // Raum des Kurses aus dem Stundenplan heraus setzen. Wie die Farbe: die
  // Angabe gehoert dem Kurs, die Gelegenheit sie einzutragen ist der
  // Stundenplan. PUT /api/kurse/{id} braucht den Namen mit — er bleibt, wie
  // er ist.
  const setKursRaum = async (kursId, raum) => {
    const k = kurse.find((x) => x.id === kursId);
    if (!k) return;
    setKurse((prev) => prev.map((x) => (x.id === kursId ? { ...x, raum } : x)));
    const r = await fetch(`/api/kurse/${kursId}`, alsJson("PUT", { name: k.name, raum })).catch(() => null);
    await pruefeAntwort(r, t("kurse.raum"));
  };

  const saveSlot = async (s) => {
    const body = { weekday: s.weekday, period: s.period, title: s.title || "", class_id: s.class_id || null, kurs_id: s.kurs_id ?? null, topic_id: s.topic_id || null, term };
    const res = await fetch(`${API}/timetable/slot`, alsJson("PUT", body)).catch(() => null);
    // Bisher blieb die Maske bei Ablehnung einfach offen stehen — nicht von
    // „ich habe den Knopf verfehlt" zu unterscheiden.
    if (!(await pruefeAntwort(res, t("common.save")))) return;
    if (res && res.ok) { setSlotEdit(null); loadTt(); }
  };
  const removeSlot = async (id) => { await fetch(`${API}/timetable/slot/${id}?term=${term}`, { method: "DELETE" }).catch(() => {}); setSlotEdit(null); loadTt(); };
  const setPeriods = async (n) => {
    const res = await fetch(`${API}/timetable/periods`, alsJson("PUT", { periods: n })).catch(() => null);
    if (res && res.ok) setTt(await res.json());
  };
  const setTimes = async (times) => {
    const res = await fetch(`${API}/timetable/times`, alsJson("PUT", { times })).catch(() => null);
    if (res && res.ok) setTt(await res.json());
  };

  const title = view === "month"
    ? cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : view === "week"
    ? `${mondayOf(cursor).toLocaleDateString()} – ${addDays(mondayOf(cursor), 6).toLocaleDateString()}`
    : cursor.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  // Stundenplan UND Freie Tage sind in die Navbar ausgelagert (?view=…) — beides
  // Konfiguration. Werkzeugleiste und Datums-Navigator gehören nur zu den
  // eigentlichen Kalenderansichten.
  const kalAnsicht = view !== "timetable" && view !== "breaks" && view !== "klassenarbeit" && view !== "stoffplan";

  // Der Plus-Knopf legt im SICHTBAREN Zeitraum an, nicht immer heute: wer im
  // März blättert und etwas einträgt, meint den März. Tag = der gezeigte Tag,
  // Woche = Wochenanfang, Monat = Monatserster; „Heute" heißt heute.
  const neuesDatum = () => {
    if (view === "day") return startOfDay(cursor);
    if (view === "week") return mondayOf(cursor);
    if (view === "month") return startOfDay(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
    return startOfDay(new Date());
  };

  return (
    <div style={{ ...pageApp }}>
      {/* Kein Titel — die Navbar zeigt den Bereich (auch die Konfig-Reiter).
          Bauform wie überall: [ Auswahl ] [ Alltag ] … [ Ansicht ] [ ⋯ ]
          (components/Werkzeugleiste.jsx) statt einer von Hand gebauten Reihe. */}
      {kalAnsicht && (
        <Werkzeugleiste
          links={(
            <span data-tour="kal-views" style={{ display: "inline-flex" }}>
              {/* Kein eigener Reiter „Heute" mehr: er zeigte dasselbe wie der
                  Tag, nur an einem anderen Ort. Ein Klick auf „Tag" springt
                  jetzt auf heute — das war ohnehin der Grund, warum man ihn
                  angetippt hat. */}
              <Tabs value={view} onChange={(v) => { if (v === "day") setCursor(startOfDay(new Date())); setView(v); }}
                options={[["month", t("kalender.month")], ["week", t("kalender.week")], ["day", t("kalender.day")]]} />
            </span>
          )}
          ansicht={(<>
            <div style={{ position: "relative" }}>
            {/* Lupe = „wo steht das nochmal?": sucht im ganzen Kalender, nicht
                im gezeigten Zeitraum — ein Klick auf einen Treffer springt zu
                seinem Tag und oeffnet ihn. */}
            <button onClick={() => setSucheOffen((v) => !v)} className="icon-btn" style={toolbarIconBtn}
              title={t("kalender.search")} aria-label={t("kalender.search")}>
              <Icon d={ICONS.search} size={18} />
            </button>
            {sucheOffen && (<>
              <div onClick={() => setSucheOffen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
              <Popover align="right" style={{ width: 320, padding: 8 }}>
                <input autoFocus value={suchText} onChange={(e) => setSuchText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") setSucheOffen(false); if (e.key === "Enter" && treffer[0]) springeZuTreffer(treffer[0]); }}
                  placeholder={t("kalender.searchPlaceholder")} style={{ ...inputStyle, width: "100%", marginBottom: 6 }} />
                {suchText.trim().length < 2 ? null : suchLaeuft ? (
                  <div style={{ padding: "8px 10px", fontSize: 13, color: "var(--text3)" }}>{t("common.loading")}</div>
                ) : treffer.length === 0 ? (
                  <div style={{ padding: "8px 10px", fontSize: 13, color: "var(--text3)" }}>{t("kalender.searchNone")}</div>
                ) : (
                  <div style={{ maxHeight: 300, overflow: "auto" }}>
                    {treffer.map((tr) => (
                      <button key={`${tr.art}-${tr.id}-${tr.date}`} onClick={() => springeZuTreffer(tr)}
                        style={{ ...menuRow, boxSizing: "border-box", width: "100%", textAlign: "left", display: "block" }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{tr.title}</span>
                        <span style={{ display: "block", fontSize: 12, color: "var(--text3)" }}>
                          {new Date(tr.date + "T00:00:00").toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })}
                          {tr.serie ? ` · ${t("kalender.searchSeries")}` : ""}
                          {tr.sub ? ` · ${tr.sub}` : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </Popover>
            </>)}
            </div>
            <div style={{ position: "relative" }}>
            {/* Auge = „was anzeigen?": Ganztägige/Externe ein-/ausblenden + Farbe. */}
            <button data-tour="kal-view-menu" onClick={() => setViewMenuOpen((v) => !v)} className="icon-btn" style={{ ...toolbarIconBtn, opacity: (showAllDay && showExt && extAus.size === 0) ? 1 : 0.55 }} title={t("kalender.viewMenu")} aria-label={t("kalender.viewMenu")}>
              <Icon d={ICONS.eye} size={18} />
            </button>
            {viewMenuOpen && (<>
              <div onClick={() => setViewMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
              {/* Am rechten Rand ausgerichtet — der Knopf steht jetzt rechts in der
                  Leiste, links ausgerichtet liefe das Menü aus dem Bild. */}
              <Popover align="right" style={{ minWidth: 220, padding: 6 }}>
                <div style={{ ...sectionLabel, padding: "8px 12px 4px" }}>{t("kalender.showHide")}</div>
                <label style={{ ...menuRow, boxSizing: "border-box", fontWeight: 500 }}>
                  <input type="checkbox" checked={showAllDay} onChange={toggleAllDay} />
                  {t("kalender.allDay")}
                </label>
                {extEvents.length > 0 && (
                  <label style={{ ...menuRow, boxSizing: "border-box", fontWeight: 500 }}>
                    <input type="checkbox" checked={showExt} onChange={toggleExt} />
                    {t("kalender.extEvents")}
                  </label>
                )}
                {/* Je Kalender einer — aber erst ab zwei: bei einem einzigen
                    wäre es derselbe Schalter zweimal. Eingerückt und mit
                    Farbpunkt, damit sichtbar ist, wozu sie gehören. */}
                {showExt && extCals.length > 1 && extCals.map((c) => (
                  <label key={c.url} style={{ ...menuRow, boxSizing: "border-box", fontWeight: 500, paddingLeft: 26 }}>
                    <input type="checkbox" checked={!extAus.has(c.url)} onChange={() => toggleExtCal(c.url)} />
                    <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                      background: extFarbe(c.url) }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.name || c.url.replace(/^\w+:\/\//, "").slice(0, 28)}
                    </span>
                  </label>
                ))}
                {/* Welche Ansicht beim Aufschlagen erscheint. Eine Auswahl und
                    keine drei Schalter: es ist eine Frage mit genau einer
                    Antwort (siehe ViewMenu, art "wahl"). */}
                <div style={{ ...sectionLabel, padding: "10px 12px 4px" }}>{t("kalender.startView")}</div>
                <div style={{ padding: "0 12px 8px" }}>
                  <select value={startAnsicht} onChange={(e) => setzeStartAnsicht(e.target.value)} style={{ ...selectStyle, width: "100%" }}>
                    <option value="month">{t("kalender.month")}</option>
                    <option value="week">{t("kalender.week")}</option>
                    <option value="day">{t("kalender.day")}</option>
                  </select>
                </div>
                {extCals.length > 0 && (
                  <button onClick={() => loadExt(true)} disabled={extBusy}
                    style={{ ...menuRow, boxSizing: "border-box", fontWeight: 500, cursor: extBusy ? "default" : "pointer", opacity: extBusy ? 0.6 : 1 }}
                    title={t("kalender.extRefreshHint")}>
                    <Icon d={ICONS.refresh} size={15} color="var(--text2)" />
                    {extBusy ? t("kalender.extRefreshing") : t("kalender.extRefresh")}
                  </button>
                )}
              </Popover>
            </>)}
            </div>
          </>)}
          mehr={[
            { key: "abo", label: t("kalender.subscribe"), icon: ICONS.share, onClick: openAbo },
            // WebUntis steht hier und nicht mehr am Stundenplan: es bringt
            // nicht nur die wiederkehrenden Stunden mit, sondern auch Ausfall
            // und Ferien — und die gehoeren an den Kalender, nicht an die
            // Vorlage. Am Stundenplan sah es aus, als ginge es nur um ihn.
            { key: "untis", label: t("untis.menu"), icon: ICONS.import, onClick: () => setUntisOffen(true) },
          ]}
        >
          <AddButton data-tour="kal-new" onClick={() => setEditing({ date: neuesDatum() })} title={t("kalender.newEntry")} />
        </Werkzeugleiste>
      )}
      {view === "timetable" && (
        <Werkzeugleiste links={sj.hj1 || sj.hj2 ? (
          <Segment>
            {[["", t("kalender.termNow")], ["1", t("kalender.term1")], ["2", t("kalender.term2")], ["jahr", t("kalender.termYear")]]
              .map(([k, label]) => (
                <button key={k || "now"} onClick={() => setTerm(k)}
                  style={{ ...segmentBtn, fontWeight: term === k ? 700 : 500,
                    color: term === k ? "var(--accent)" : "var(--text2)" }}>{label}</button>
              ))}
          </Segment>
        ) : null}>
          <button onClick={() => setShowTimes((v) => !v)} className="icon-btn" title={t("kalender.timesShow")} aria-label={t("kalender.timesShow")}
            style={{ ...toolbarIconBtn, border: showTimes ? "1px solid var(--accent)" : "1px solid var(--border2)" }}>
            <Icon d={ICONS.clock} size={18} color={showTimes ? "var(--accent)" : "var(--text2)"} />
          </button>
        </Werkzeugleiste>
      )}
      {/* Datums-Navigator: ‹ [Auswahl] › Heute — in ALLEN Ansichten dieselbe
          Form. Der Tag zeigte frueher ein nacktes Datumsfeld, Woche und Monat
          einen fetten Titel mit Pfeil; nebeneinander sah das aus wie zwei
          verschiedene Bedienelemente. Jetzt ueberall der Titel mit Pfeil, und
          was im Waehler steht, richtet sich nach der Ansicht: beim Tag ein
          Datumsfeld, sonst Monat/Woche und Jahr. */}
      {kalAnsicht && view !== "today" && (
        <DatumNavigator style={{ justifyContent: "center", marginBottom: 16, position: "relative" }}
          onZurueck={() => move(-1)} labelZurueck={t("kalender.prev")}
          onVor={() => move(1)} labelVor={t("kalender.next")}
          onHeute={() => setCursor(startOfDay(new Date()))} labelHeute={t("kalender.today")}
          mitte={(
            <div style={{ position: "relative", display: "inline-flex" }}>
              {/* Titel mit Sprung-Popover: sitzt IN der Gruppe, traegt darum
                  keinen eigenen Rahmen mehr (frueher rahmenlos mit gepunkteter
                  Unterlinie — mitten zwischen zwei umrandeten Knoepfen). */}
              <button onClick={() => setJumpOpen((v) => !v)} title={t("kalender.jumpToDay")}
                style={{ ...segmentBtn, fontWeight: 700, color: "var(--text)", minWidth: 170, gap: 6 }}>{title} <Icon d={ICONS.chevronDown} size={11} /></button>
              {jumpOpen && (<>
                <div onClick={() => setJumpOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                <Popover align="center" style={{ padding: 8, display: "flex", gap: 8, alignItems: "center" }}>
                  {/* parseYmd statt new Date(): ein Datumsfeld liefert beim
                      Tippen im Jahr auch „275760-09-13" — daraus wurde ein
                      Invalid Date, und die naechste toISOString() nahm die ganze
                      Seite mit. Unfertiges wird ignoriert, nicht uebernommen. */}
                  {view === "day" && (
                    <input type="date" value={ymd(cursor)} autoFocus style={selectStyle}
                      onChange={(e) => { const d = parseYmd(e.target.value); if (d) { setCursor(d); setJumpOpen(false); } }} />
                  )}
                  {view === "month" && (
                    <select value={cursor.getMonth()} onChange={(e) => { setCursor(startOfDay(new Date(cursor.getFullYear(), Number(e.target.value), 1))); setJumpOpen(false); }} style={selectStyle}>
                      {Array.from({ length: 12 }, (_, m) => <option key={m} value={m}>{new Date(2000, m, 1).toLocaleDateString(undefined, { month: "long" })}</option>)}
                    </select>
                  )}
                  {view === "week" && (
                    <select value={isoWeek(cursor).week} onChange={(e) => { setCursor(weekValToDate(`${isoWeek(cursor).year}-W${String(e.target.value).padStart(2, "0")}`)); setJumpOpen(false); }} style={selectStyle}>
                      {Array.from({ length: 53 }, (_, i) => i + 1).map((w) => <option key={w} value={w}>{t("kalender.kw")} {w}</option>)}
                    </select>
                  )}
                  {view !== "day" && (() => {
                    const y0 = new Date().getFullYear();
                    const cy = view === "week" ? isoWeek(cursor).week : cursor.getMonth();
                    return (
                      <select value={cursor.getFullYear()} onChange={(e) => { const y = Number(e.target.value); setCursor(view === "week" ? weekValToDate(`${y}-W${String(cy).padStart(2, "0")}`) : startOfDay(new Date(y, cy, 1))); setJumpOpen(false); }} style={selectStyle}>
                        {Array.from({ length: 7 }, (_, i) => y0 - 3 + i).map((y) => <option key={y} value={y}>{y}</option>)}
                      </select>
                    );
                  })()}
                </Popover>
              </>)}
            </div>
          )} />
      )}
      {view === "breaks" && <BreaksPanel breaks={breaks} onAdd={addBreak} onDel={delBreak} t={t} standalone />}
      {view === "stoffplan" && <Stoffplan />}
      {view === "klassenarbeit" && <ExamPanel overview={examOverview} periods={tt.periods} aktiv={aktiv} topics={topics} onAdd={addExam} onUpd={updExam} onDel={delExam} t={t} />}

      {/* Was im ANGEZEIGTEN Zeitraum ausgeblendet ist — eine Fläche über dem
          Kalender, kein eigener Reiter: die Frage „was sehe ich hier gerade
          nicht?" stellt sich am Kalender, nicht daneben. Sie erscheint nur,
          wenn wirklich etwas fehlt; eine dauerhafte leere Zeile über dem Monat
          wäre Rauschen. */}
      {["month", "week", "day"].includes(view) && ausgeblendet.anzahl > 0 && (
        <button onClick={() => setHiddenOffen(true)}
          style={{ ...panelStyle, width: "100%", textAlign: "left", marginBottom: 12,
            padding: "8px 12px", display: "flex", alignItems: "center", gap: 8,
            fontSize: 13, color: "var(--text2)", cursor: "pointer" }}>
          <Icon d={ICONS.eye} size={15} color="var(--text3)" />
          <span style={{ flex: 1 }}>{t("kalender.hiddenBar", { n: ausgeblendet.anzahl })}</span>
          <span style={{ color: "var(--accent)", fontWeight: 600 }}>{t("kalender.hiddenOpen")}</span>
        </button>
      )}
      {hiddenOffen && (
        <AusgeblendetModal ext={ausgeblendet.ext} cancels={ausgeblendet.stunden}
          onExtBack={unhideExtEvent} onSlotBack={restoreSlot}
          onClose={() => setHiddenOffen(false)} t={t} />
      )}

      {view === "month" && <MonthGrid extColor={extColor} range={range} cursor={cursor} byDay={byDayV} extByDay={extByDayV} todoByDay={todoByDay} onTodo={(td) => nav(td?.id ? `/notizbrett?todo=${td.id}` : "/notizbrett")} slotsFor={slotsFor} onSlot={fromSlot} frei={frei} className={className} kursName={kursName} slotName={slotName} topicName={topicName} classColor={classColor} onAdd={(d) => setEditing({ date: startOfDay(d) })} onOpen={setEditing} onExt={setExtInfo} onDayView={(d) => { setCursor(startOfDay(d)); setView("day"); }} onWeekView={(d) => { setCursor(startOfDay(d)); setView("week"); }} t={t} />}
      {view === "week" && wdhVorschlag.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 12, padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{t("kalender.wdhTitle")}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {wdhVorschlag.map((tp) => (
              <button key={tp.topic_id} onClick={() => setEditing({ date: startOfDay(mondayOf(cursor)), title: `${t("kalender.wdhPrefix")}: ${tp.name}`, topic_id: tp.topic_id })}
                style={{ ...chipStyle, display: "inline-flex", alignItems: "center", gap: 8, padding: "4px 12px", border: "1px solid var(--border2)", background: "var(--bg)", cursor: "pointer", fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{tp.name}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: tp.pct < 40 ? C.danger : C.warning }}>{tp.pct}%</span>
                <span style={{ color: "var(--accent)" }}>+</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {view === "week" && <WeekView extColor={extColor} range={range} byDay={byDayV} extByDay={extByDayV} todoByDay={todoByDay} onTodo={(td) => nav(td?.id ? `/notizbrett?todo=${td.id}` : "/notizbrett")} slotsFor={slotsFor} frei={frei} className={className} kursName={kursName} slotName={slotName} classColor={classColor} topicName={topicName} onAdd={(d) => setEditing({ date: startOfDay(d) })} onOpen={setEditing} onExt={setExtInfo} onSlot={fromSlot} onDayView={(d) => { setCursor(startOfDay(d)); setView("day"); }} t={t} />}
      {view === "day" && <DayView extColor={extColor} day={cursor} tt={tt} byDay={byDayV} extByDay={extByDayV} todoByDay={todoByDay} onTodo={(td) => nav(td?.id ? `/notizbrett?todo=${td.id}` : "/notizbrett")} slotsFor={slotsFor} onCancelSlot={cancelSlot} frei={frei} className={className} slotName={slotName} slotColor={slotColor} classColor={classColor} topicName={topicName} onAdd={(d) => setEditing({ date: startOfDay(d) })} onOpen={setEditing} onExt={setExtInfo} onSlot={fromSlot} t={t} />}
      {untisOffen && (
        <UntisImport onClose={() => setUntisOffen(false)} kurse={kurse} klassen={classes} periods={tt.periods}
          onFertig={() => { loadTt(); loadBreaks(); loadCancels(); }} />
      )}
      {view === "timetable" && <TimetableView tt={tt} showTimes={showTimes} stichtag={stichtag} className={className} slotName={slotName} slotColor={slotColor} classColor={classColor} topicName={topicName} onEdit={setSlotEdit} onPeriods={setPeriods} onTimes={setTimes} t={t} />}

      {editing && <EntryModal entry={editing} zeiten={tt.times || []} classes={classes} topics={topics} methods={methods} quizze={quizze} ladders={ladders} puzzles={puzzles} aktiv={aktiv} topicName={topicName} kursName={kursName} onSave={save} onDelete={remove} onClose={() => setEditing(null)} t={t} />}
      {abo && (
        <Modal onClose={() => setAbo(null)} width={500} label={t("kalender.subscribeTitle")}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>{t("kalender.subscribeTitle")}</h3>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <a href={abo.webcal} style={{ ...btnPrimary, display: "inline-block", textDecoration: "none" }}>{t("kalender.subscribeNow")}</a>
              {/* Der Hinweis steht im title: er wird einmal gebraucht, kostet
                  daneben aber dauerhaft eine Zeile. */}
              <button onClick={resyncAbo} disabled={resyncing} title={t("kalender.resyncHint")}
                style={{ ...btnSecondary, display: "inline-flex", alignItems: "center", gap: 6, opacity: resyncing ? 0.6 : 1 }}>
                <Icon d={ICONS.refresh} size={15} /> {resyncing ? t("kalender.resyncing") : t("kalender.resync")}
              </button>
            </div>
            {/* Schreibend: CalDAV. Steht bewusst NEBEN dem Abo und nicht
                statt seiner — das Abo zeigt alles (auch Ferien und
                Stundenplan-Stunden) und ist mit einem Klick eingerichtet,
                CalDAV kann dafuer schreiben. Wer nur lesen will, braucht es
                nicht. */}
            <CaldavZugaenge />

            {/* Andere Richtung: MEHRERE externe Kalender (ICS-URL) read-only einblenden. */}
            <div style={{ borderTop: "1px solid var(--border)", marginTop: 24, paddingTop: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t("kalender.extTitle")}</div>
              <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8 }}>{t("kalender.extText")}</div>
              <ExtCalEditor cals={abo.cals || []} mit={!!abo.mit}
                onChange={(cals) => setAbo((a) => ({ ...a, cals }))}
                onMit={(v) => setAbo((a) => ({ ...a, mit: v }))}
                onSave={(cals, mit) => { saveCals(cals, mit); setAbo((a) => ({ ...a, cals, mit })); }} t={t} />
            </div>

            <div style={{ marginTop: 16, textAlign: "right" }}>
              <button onClick={() => setAbo(null)} style={btnSecondary}>{t("common.close")}</button>
            </div>
        </Modal>
      )}
      {slotEdit && <SlotModal slot={slotEdit} classes={classes} kurse={kurse} topics={topics} onSave={saveSlot} onDelete={removeSlot} onColor={setSlotColor} onRaum={setKursRaum} onClose={() => setSlotEdit(null)} t={t} />}
      {extInfo && <ExtInfoModal ev={extInfo} onClose={() => setExtInfo(null)} onHide={(k) => { hideExtEvent(k); setExtInfo(null); }} t={t} />}
    </div>
  );
}

// ─── Was hier gerade nicht zu sehen ist ───
//
// Ein Popup ueber dem Kalender, kein eigener Reiter und keine Chips ueber jedem
// Tag: die Frage „was fehlt hier?" stellt sich AM Kalender, und sie stellt sich
// fuer den Zeitraum, den man gerade ansieht — im Tagesblick interessiert nicht,
// was im November weggeblendet wurde. Zwei Sorten, eine Liste: entfallene
// Stunden und ausgeblendete fremde Termine.
function AusgeblendetModal({ ext, cancels, onExtBack, onSlotBack, onClose, t }) {
  const fmt = (iso) => { try { return new Date(iso + "T00:00:00").toLocaleDateString(); } catch { return iso; } };
  const zeile = (links, mitte, kursiv, zurueck, key) => (
    <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "6px 0",
      borderBottom: "1px solid var(--border)" }}>
      <span style={{ color: "var(--text3)", flexShrink: 0, fontSize: 12 }}>{links}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        color: kursiv ? "var(--text3)" : "var(--text)", fontStyle: kursiv ? "italic" : "normal" }}>{mitte}</span>
      <button onClick={zurueck} style={{ ...btnSecondary, ...btnSmall, borderRadius: CONTROL_R, flexShrink: 0 }}>
        {t("kalender.hiddenBack")}
      </button>
    </div>
  );
  return (
    <Modal onClose={onClose} width={480} title={t("kalender.hiddenTitle")}>
      {cancels.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ ...sectionLabel, marginBottom: 4 }}>{t("kalender.hiddenSlots")}</div>
          {cancels.map((c) => zeile(c.d.toLocaleDateString(),
            `${c.period}. ${t("kalender.period")}${c.name ? ` · ${c.name}` : ""}`,
            false, () => onSlotBack(c.d, c.period), `${c.date}|${c.period}`))}
        </div>
      )}
      {ext.length > 0 && (
        <div>
          <div style={{ ...sectionLabel, marginBottom: 4 }}>{t("kalender.hiddenExt")}</div>
          {/* Ein Schluessel ohne Ereignis: der Termin ist im fremden Kalender
              geloescht oder der Feed abgemeldet. Er steht trotzdem hier, sonst
              liesse er sich nie wieder loswerden. */}
          {ext.map((e) => zeile(fmt(e.date), e.title || t("kalender.hiddenGone"),
            !!e.verwaist, () => onExtBack(e.key), e.key))}
        </div>
      )}
      <div style={{ marginTop: 16, textAlign: "right" }}>
        <button onClick={onClose} style={btnSecondary}>{t("common.close")}</button>
      </div>
    </Modal>
  );
}

// Read-only-Info zu einem angeklickten externen (abonnierten) Termin. Nicht
// editierbar — fremder Kalender; nur Anzeige der ICS-Felder.
function ExtInfoModal({ ev, onClose, onHide, t }) {
  const fmt = (iso) => { try { return new Date(iso + "T00:00:00").toLocaleDateString(); } catch { return iso; } };
  const zeitraum = ev.end && ev.end !== ev.start ? `${fmt(ev.start)} – ${fmt(ev.end)}` : fmt(ev.start || ev.date);
  const Zeile = ({ label, children }) => (
    <div style={{ display: "flex", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ width: 96, flexShrink: 0, fontSize: 12, color: "var(--text3)" }}>{label}</span>
      <span style={{ fontSize: 14, color: "var(--text)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{children}</span>
    </div>
  );
  return (
    <Modal onClose={onClose} width={440} label={ev.title || t("kalender.entry")}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <Icon d={ICONS.link} size={14} />
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, flex: 1 }}>{ev.title || "—"}</h3>
        </div>
        <p style={{ fontSize: 12, color: "var(--text3)", margin: "0 0 12px" }}>{t("kalender.extEventNote")}</p>
        <Zeile label={t("kalender.extDate")}>{zeitraum}</Zeile>
        {ev.time && <Zeile label={t("kalender.extTime")}>{ev.endtime && ev.endtime !== ev.time ? `${ev.time} – ${ev.endtime}` : ev.time}</Zeile>}
        {ev.location && <Zeile label={t("kalender.extLocation")}>{ev.location}</Zeile>}
        {ev.description && <Zeile label={t("kalender.extDesc")}>{ev.description}</Zeile>}
        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 8 }}>
          {onHide && ev.key && (
            <button onClick={() => onHide(ev.key)} style={{ ...btnSecondary, display: "inline-flex", alignItems: "center", gap: 6 }} title={t("kalender.extHideHint")}>
              <Icon d={ICONS.eye} size={15} /> {t("kalender.extHide")}
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={btnSecondary}>{t("common.close")}</button>
        </div>
    </Modal>
  );
}

// Editor für mehrere externe Kalender: je Zeile URL + Farbe + Löschen. „Speichern"
// schreibt die ganze Liste (leere URLs fallen weg).
function ExtCalEditor({ cals, mit, onChange, onMit, onSave, t }) {
  const rows = cals.length ? cals : [{ url: "", color: "", name: "" }];
  const setRow = (i, patch) => { const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r)); onChange(next); };
  const addRow = () => onChange([...rows, { url: "", color: "", name: "" }]);
  const delRow = (i) => { const next = rows.filter((_, j) => j !== i); onChange(next.length ? next : [{ url: "", color: "", name: "" }]); };
  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((c, i) => (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="color" value={c.color || EXT_PALETTE[i % EXT_PALETTE.length]} onChange={(e) => setRow(i, { color: e.target.value })}
              title={t("kalender.extColor")} style={{ width: 26, height: 26, padding: 0, border: "none", background: "none", cursor: "pointer", flexShrink: 0 }} />
            <input value={c.url || ""} onChange={(e) => setRow(i, { url: e.target.value })} placeholder="https://…/basic.ics"
              style={{ ...inputStyle, flex: 1, fontSize: 12, minWidth: 0 }} />
            <button onClick={() => delRow(i)} className="icon-btn" style={{ ...iconBtn, padding: 4, flexShrink: 0 }} title={t("common.delete")} aria-label={t("common.delete")}>
              <Icon d={ICONS.trash} size={15} color={C.danger} />
            </button>
          </div>
        ))}
      </div>
      {/* Die fremden Termine im eigenen Export mitschicken. Aus als Vorgabe,
          und der Hinweis bleibt trotz der Regel gegen Erklärtexte stehen: dass
          derselbe Termin dann auf einem Gerät doppelt steht, das die Kalender
          selbst abonniert hat, sieht man dem Schalter nicht an — man sieht es
          erst im Handy. */}
      <label style={{ ...menuRow, boxSizing: "border-box", fontWeight: 500, marginTop: 12, paddingLeft: 0 }}>
        <input type="checkbox" checked={!!mit} onChange={(e) => onMit(e.target.checked)} />
        {t("kalender.extShare")}
      </label>
      <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2, marginBottom: 4, lineHeight: 1.4 }}>{t("kalender.extShareHint")}</div>
      <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={addRow} style={{ ...btnSecondary, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon d={ICONS.plus} size={14} /> {t("kalender.extAdd")}
        </button>
        <span style={{ flex: 1 }} />
        <button onClick={() => onSave(rows, !!mit)} style={btnPrimary}>{t("common.save")}</button>
      </div>
    </div>
  );
}

const cell = { border: "1px solid var(--border)", minHeight: 84, padding: 8, verticalAlign: "top", background: "var(--card)" };

// ── Mehrtaegige Termine: EIN Balken statt eines Chips je Tag ─────────────────
//
// Apple zeichnet eine Klassenfahrt als durchgehenden Streifen ueber die Woche;
// sieben gleich aussehende Chips untereinander beantworten die Frage „wie lange
// dauert das?" gar nicht. Umgesetzt ohne Umbau des Tabellenrasters: der Chip
// verliert an der fortgesetzten Seite seine Rundung und ragt per negativem
// Rand ueber die Zellgrenze, sodass er am Nachbartag anschliesst. Beschriftet
// wird nur der Anfang — und der Wochenanfang, sonst laeuft ein Streifen ohne
// Text durch die zweite Zeile.
//
// EINE Quelle fuer eigene Eintraege, externe Termine und Ferien: drei Kopien
// waeren nach der ersten Aenderung drei verschiedene Streifen.
const spanneVon = (start, ende, tag, { imRaster = true } = {}) => {
  if (!ende || ende <= start) return null;          // eintaegig
  const montag = wochentagMo0(new Date(tag + "T00:00:00")) === 0;
  const istStart = tag === start;
  const istEnde = tag === ende;
  return {
    istStart, istEnde,
    zeigtText: istStart || montag || !imRaster,
    stil: imRaster ? {
      borderTopLeftRadius: istStart ? undefined : 0,
      borderBottomLeftRadius: istStart ? undefined : 0,
      borderTopRightRadius: istEnde ? undefined : 0,
      borderBottomRightRadius: istEnde ? undefined : 0,
      marginLeft: istStart ? undefined : -9,
      marginRight: istEnde ? undefined : -9,
      width: "auto",
    } : {},
  };
};

/** „‹" / „›" an einem Balken, der vor- oder nachher weitergeht. */
const spannePfeile = (sp, titel) => {
  if (!sp) return titel;
  return `${sp.istStart ? "" : "‹ "}${titel}${sp.istEnde ? "" : " ›"}`;
};
const chip = { display: "block", width: "100%", textAlign: "left", fontSize: 12, padding: "2px 8px", borderRadius: CONTROL_R, background: "var(--accent-bg, rgba(10,132,255,0.12))", color: "var(--accent)", border: "none", cursor: "pointer", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
// Vorlage aus dem Stundenplan: gestrichelt, gedaempft — anklicken macht daraus einen Termin.
const ghost = { ...chip, background: "transparent", color: "var(--text3)", border: "1px dashed var(--border2)" };

function SlotGhosts({ list, entries, className, slotName, topicName, onSlot, day, t }) {
  // Vorlagen ausblenden, sobald an dem Tag schon ein Eintrag dieser Klasse
  // existiert — der wird dann als Chip gezeigt und dort bearbeitet, statt
  // dass ein Klick auf die Geister-Vorlage einen zweiten Eintrag anlegt.
  const belegt = new Set((entries || []).filter((e) => e.period != null).map((e) => e.period));
  return list.filter((s) => !belegt.has(s.period)).map((s) => {
    const label = [s.period + ". " + t("kalender.period"), (slotName ? slotName(s) : className(s.class_id)) || s.title || topicName(s.topic_id)].filter(Boolean).join(" · ");
    return (
      <button key={s.id} onClick={(e) => { e.stopPropagation(); onSlot(day, s); }} style={ghost} title={label + " — " + t("kalender.fromTimetable")}>{label}</button>
    );
  });
}

// Eintrags-Chip: öffnet den Eintrag im Popup. Die Verweise zum verknüpften
// Modul-Objekt (Deck/Quiz/Lernleiter) liegen dort — kein Inline-↗ mehr im
// Kalenderraster (war Doppelung und Unruhe).
// Externe (abonnierte) Termine — read-only, grau, nicht klickbar.
function ExtChips({ list, onOpen, extColor, tag = null, imRaster = true }) {
  const colOf = (ev) => ev.color || extColor;
  if (!list || !list.length) return null;
  return list.map((ev, i) => {
    // Ein mehrtaegiger Termin aus dem Abo kommt je Tag einmal an, traegt aber
    // seinen Zeitraum mit (start/end) — daraus wird derselbe Balken wie bei
    // eigenen Eintraegen.
    const sp = tag ? spanneVon(ev.start || tag, ev.end || null, tag, { imRaster }) : null;
    const titel = ev.title || "—";
    return (
      <button key={`ext-${i}`} onClick={onOpen ? (e) => { e.stopPropagation(); onOpen(ev); } : undefined} title={titel}
        style={{ display: "block", width: "100%", textAlign: "left", fontSize: 11, color: colOf(ev) || "var(--text3)", background: colOf(ev) ? colOf(ev) + "1e" : "var(--bg2)", border: `1px dashed ${colOf(ev) || "var(--border2)"}`, borderRadius: CONTROL_R, padding: "2px 8px", margin: "4px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: onOpen ? "pointer" : "default",
          ...(sp ? { ...sp.stil, borderLeftStyle: sp.istStart ? "dashed" : "none", borderRightStyle: sp.istEnde ? "dashed" : "none" } : {}) }}>
        {sp && !sp.zeigtText ? "\u00a0" : <>{(ev.time ? ev.time + " " : "")}<Icon d={ICONS.link} size={11} /> {sp ? spannePfeile(sp, titel) : titel}</>}
      </button>
    );
  });
}

// Datierte To-dos als Chip (Modul To-do). Erledigte durchgestrichen. Klick führt
// in die To-do-Liste (Link kommt vom Aufrufer via onOpen).
function TodoChips({ list, onOpen }) {
  if (!list || !list.length) return null;
  return list.map((td) => (
    // Der Klick fuehrt zu GENAU dieser Aufgabe (?todo=<id>), nicht nur in die
    // Liste: wer im Kalender auf „Elternbriefe" tippt, sucht danach nicht noch
    // einmal zwischen dreissig Zeilen.
    <button key={`todo-${td.id}`} onClick={onOpen ? (e) => { e.stopPropagation(); onOpen(td); } : undefined} title={td.text}
      style={{ display: "block", width: "100%", textAlign: "left", fontSize: 11, color: "var(--text)", background: "rgba(52,199,89,0.12)", border: "1px solid rgba(52,199,89,0.5)", borderRadius: CONTROL_R, padding: "2px 8px", margin: "4px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: onOpen ? "pointer" : "default", textDecoration: td.done ? "line-through" : "none", opacity: td.done ? 0.6 : 1 }}>
      {(td.time ? td.time + " " : "")}✓ {td.text}
    </button>
  ));
}

function EntryChips({ list, className, kursName = () => "", topicName, onOpen, classColor, tag = null, imRaster = true }) {
  // Anzeige denkt in Kursen: liegt ein Kurs am Eintrag, dessen Namen (Fach) zeigen,
  // sonst die Fach-Klasse.
  const nameOf = (e) => (e.kurs_id && kursName(e.kurs_id)) || (className && className(e.class_id)) || "";
  return list.map((e) => {
    const col = e.class_id && classColor ? classColor(e.class_id) : null;
    // Zweizeilig: Titel oben, darunter Uhrzeit + Kurs/Klasse gedaempft.
    const titel = e.title || topicName(e.topic_id) || nameOf(e) || "—";
    const meta = [e.start_time || null, nameOf(e) || null].filter(Boolean).join(" · ");
    const sp = tag ? spanneVon(ymd(new Date(e.date)), e.end_date ? ymd(new Date(e.end_date)) : null, tag, { imRaster }) : null;
    const text = sp ? (sp.zeigtText ? spannePfeile(sp, titel) : "\u00a0") : titel;
    return (
      <button key={e.id} onClick={(ev) => { ev.stopPropagation(); onOpen({ ...e, date: new Date(e.date) }); }}
        style={{ ...chip, whiteSpace: "normal", marginTop: 4, width: "100%", lineHeight: 1.25, ...(col ? { background: col + "22", color: "var(--text)", borderLeft: `3px solid ${col}` } : {}), ...(sp ? { ...sp.stil, ...(sp.istStart ? {} : { borderLeft: "none" }) } : {}) }}
        title={[titel, meta].filter(Boolean).join(" — ")}>
        <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", fontWeight: 600 }}>{text}</span>
        {/* Bei einem Balken steht die Zeile nur am Anfang: sonst wiederholt sich
            „Mathe · 7.5" fuenfmal quer durch die Woche. */}
        {meta && (!sp || sp.zeigtText) && <span style={{ display: "block", fontSize: 11, opacity: 0.72, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{meta}</span>}
      </button>
    );
  });
}


function MonthGrid({ extColor, range, cursor, byDay, extByDay, todoByDay, onTodo, slotsFor, onSlot, frei, className, kursName, slotName, topicName, classColor, onAdd, onOpen, onExt, onDayView, onWeekView, t }) {
  const days = [];
  for (let d = new Date(range[0]); d <= range[1]; d = addDays(d, 1)) days.push(new Date(d));
  const wdays = [t("kalender.mon"), t("kalender.tue"), t("kalender.wed"), t("kalender.thu"), t("kalender.fri"), t("kalender.sat"), t("kalender.sun")];
  const heute = ymd(new Date());
  const narrow = useNarrow();
  // Handy hochkant: nur Punkte je Tag (voll wird die Woche/der Tag angetippt).
  const dotsFor = (d) => {
    const own = byDay(d).map((e) => (e.class_id ? classColor(e.class_id) : "var(--accent)"));
    const ext = (extByDay ? extByDay(d) : []).map((ev) => ev.color || extColor || "var(--text3)");
    return [...own, ...ext];
  };
  return (
    <div>
      <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
        <thead><tr>
          <th style={{ ...th, width: 34 }}>{t("kalender.kw")}</th>
          {wdays.map((w) => <th key={w} style={{ ...th, textAlign: "left" }}>{w}</th>)}
        </tr></thead>
        <tbody>
          {Array.from({ length: days.length / 7 }).map((_, r) => {
            const rowMonday = days[r * 7];
            const kw = isoWeek(rowMonday).week;
            return (
            <tr key={r}>
              <td style={{ ...cell, padding: 0, textAlign: "center", verticalAlign: "middle", background: "var(--bg)" }}>
                <button onClick={() => onWeekView(rowMonday)} title={t("kalender.toWeek")}
                  style={{ border: "none", background: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "var(--text3)", width: "100%", height: "100%", padding: "8px 4px" }}>{kw}</button>
              </td>
              {days.slice(r * 7, r * 7 + 7).map((d) => {
                const other = d.getMonth() !== cursor.getMonth();
                const f = frei && frei(d);
                return (
                  <td key={ymd(d)} onClick={(e) => { if (!e.target.closest("button")) onDayView(d); }} title={t("kalender.toDay")}
                    style={{ ...cell, cursor: "pointer", opacity: other ? 0.5 : 1, verticalAlign: "top",
                      padding: narrow ? 4 : cell.padding, minHeight: narrow ? 46 : cell.minHeight, height: narrow ? 46 : undefined,
                      background: f ? "rgba(184,134,11,0.09)" : undefined, outline: ymd(d) === heute ? "2px solid var(--accent)" : "none", outlineOffset: -2 }}>
                    {narrow ? (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                        <span style={{ fontSize: 12, fontWeight: ymd(d) === heute ? 700 : 500, color: "var(--text2)" }}>{d.getDate()}</span>
                        {/* Der Ferien-Punkt kommt ZU den Termin-Punkten, nicht
                            statt ihnen — sonst verschwindet ein Termin in den
                            Ferien auch aus der schmalen Monatsansicht. */}
                        <div style={{ display: "flex", gap: 2, flexWrap: "wrap", justifyContent: "center", maxWidth: "100%" }}>
                          {f && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "rgba(184,134,11,0.7)" }} />}
                          {dotsFor(d).slice(0, 4).map((c, i) => <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: c }} />)}
                          {dotsFor(d).length > 4 && <span style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1 }}>+{dotsFor(d).length - 4}</span>}
                        </div>
                      </div>
                    ) : (<>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <button onClick={() => onDayView(d)} title={t("kalender.toDay")} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--text2)", padding: 0 }}>{d.getDate()}</button>
                      <button onClick={(e) => { e.stopPropagation(); onAdd(d); }} className="icon-btn" style={{ ...iconBtn, padding: 0 }} title={t("kalender.add")} aria-label={t("kalender.add")}><Icon d={ICONS.plus} size={13} color="var(--accent)" /></button>
                    </div>
                    {/* Siehe WeekView: frei blendet nur den Stundenplan aus. */}
                    {f && <FreiMarker label={f.label} t={t} />}
                    <EntryChips list={byDay(d)} className={className} kursName={kursName} topicName={topicName} onOpen={onOpen} classColor={classColor} tag={ymd(d)} />
                    <ExtChips list={extByDay && extByDay(d)} onOpen={onExt} extColor={extColor} tag={ymd(d)} />
                    {!f && slotsFor && <SlotGhosts list={slotsFor(d)} entries={byDay(d)} className={className} slotName={slotName} topicName={topicName} onSlot={onSlot} day={d} t={t} />}
                    {/* To-dos zeigen auch an freien Tagen (Ferien/Feiertag). */}
                    <TodoChips list={todoByDay && todoByDay(d)} onOpen={onTodo} />
                    </>)}
                  </td>
                );
              })}
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WeekView({ extColor, range, byDay, extByDay, todoByDay, onTodo, slotsFor, frei, className, kursName, slotName, classColor, topicName, onAdd, onOpen, onExt, onSlot, onDayView, t }) {
  const days = [];
  for (let d = new Date(range[0]); d <= range[1]; d = addDays(d, 1)) days.push(new Date(d));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, overflowX: "auto" }}>
      {days.map((d) => {
        const f = frei && frei(d);
        return (
        <div key={ymd(d)} onClick={(e) => { if (!e.target.closest("button")) onDayView(d); }} title={t("kalender.toDay")}
          style={{ border: "1px solid var(--border)", borderRadius: CONTROL_R, padding: 8, minHeight: 160, background: f ? "rgba(184,134,11,0.09)" : "var(--card)", minWidth: 90, cursor: "pointer" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <button onClick={() => onDayView(d)} title={t("kalender.toDay")} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--text)", padding: 0 }}>{d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}</button>
            <button onClick={(e) => { e.stopPropagation(); onAdd(d); }} className="icon-btn" style={{ ...iconBtn, padding: 0 }}><Icon d={ICONS.plus} size={13} color="var(--accent)" /></button>
          </div>
          {/* Ferien blenden den STUNDENPLAN aus, nicht die Termine: in den
              Sommerferien lagen ein Vorbereitungstag und ein Teamtag im
              Kalender und waren nirgends zu sehen, weil der freie Zeitraum den
              ganzen Tag leergeraeumt hat — auch die externen Termine aus dem
              Abo. Ferien heissen „kein Unterricht", nicht „keine Termine". */}
          {f && <FreiMarker label={f.label} t={t} />}
          {!f && <SlotGhosts list={slotsFor(d)} entries={byDay(d)} className={className} slotName={slotName} topicName={topicName} onSlot={onSlot} day={d} t={t} />}
          {/* In der Woche stehen die Tage als eigene Karten mit Abstand — ein
              durchgehender Streifen ginge dort ins Leere. Also dieselbe
              Information mit Pfeilen: „‹ Klassenfahrt ›" heisst, dass es davor
              und danach weitergeht. */}
          <EntryChips list={byDay(d)} className={className} kursName={kursName} topicName={topicName} onOpen={onOpen} classColor={classColor} tag={ymd(d)} imRaster={false} />
          <ExtChips list={extByDay && extByDay(d)} onOpen={onExt} extColor={extColor} tag={ymd(d)} imRaster={false} />
          {/* To-dos auch an freien Tagen. */}
          <TodoChips list={todoByDay && todoByDay(d)} onOpen={onTodo} />
        </div>
        );
      })}
    </div>
  );
}

function FreiMarker({ label, t }) {
  // Ferien/Feiertag deutlich hervorheben: Amber-Badge statt blasser Kursivzeile.
  // An diesen Tagen ist der Stundenplan bewusst ausgeblendet.
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700,
      color: C.warning, background: "rgba(184,134,11,0.16)", borderRadius: CONTROL_R, padding: "4px 8px", lineHeight: 1.3,
      maxWidth: "100%", boxSizing: "border-box" }}
      title={label ? `${label} — ${t("kalender.freeDay")}` : t("kalender.freeDay")}>
      <Icon d={ICONS.sun} size={13} color={C.warning} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label || t("kalender.free")}</span>
    </div>
  );
}

function DayView({ extColor, day, tt = { times: [], periods: 0 }, byDay, extByDay, todoByDay, onTodo, slotsFor, onCancelSlot, frei, className, slotName, slotColor, classColor, topicName, onAdd, onOpen, onExt, onSlot, t }) {
  const list = byDay(day);
  const f = frei && frei(day);
  // An freien Tagen faellt der Stundenplan weg — die Termine des Tages nicht.
  // Vorher stieg diese Ansicht bei einem freien Tag sofort aus und zeigte nur
  // das Ferien-Etikett; ein Vorbereitungstag in den Sommerferien war damit
  // unsichtbar, obwohl er im Kalender stand.
  const slots = f ? [] : slotsFor(day);
  const ext = extByDay ? extByDay(day) : [];
  const linked = (e) => e.cardvote_set_id || e.karten_deck_id || e.lernpfad_ladder_id || e.method_id || e.codedetektiv_puzzle;
  const pTime = (p) => { const w = (tt.times || [])[p - 1]; return w ? { s: hmToMin(w.start), e: hmToMin(w.end) } : { s: null, e: null }; };
  // Zeitleiste 0–24 Uhr, aber scrollbar. Der Blick soll da anfangen, wo der Tag
  // anfaengt — nicht um Mitternacht.
  //
  // Vorher: fester Sprung auf 6 Uhr in einem Effekt, der am Datum haengt. Faellt
  // eine Stunde aus, wechselt der Tag nicht, aber die Zeitleiste wird neu
  // aufgebaut (der Block haengt an `timed.length`) — die neue Flaeche startet
  // bei scrollTop 0, und der Effekt laeuft nicht noch einmal. Man sah 00:00 und
  // musste selbst nach unten rollen. Jetzt setzt ein Rueckruf-Ref die Position
  // JEDES MAL, wenn die Flaeche entsteht, und zwar auf die erste Stunde des
  // Tages statt auf eine feste Uhrzeit.
  const HOUR = 40;
  // Ganztägig / ohne verortbare Uhrzeit -> Banner oben (auch externe Termine).
  // Einträge mit freier Uhrzeit gehören in die Zeitspur, nicht ins Banner.
  const ganztags = list.filter((e) => e.period == null && hmToMin(e.start_time) == null);
  const belegte = new Set(slots.map((s) => s.period));

  const yOf = (min) => (min / 60) * HOUR;
  const timed = [];
  slots.forEach((s) => {
    const { s: sm, e: em } = pTime(s.period);
    if (sm == null) return;
    const eintrag = list.find((e) => e.period === s.period);
    timed.push({ key: "s" + s.id, start: sm, end: em != null ? em : sm + 45,
      col: s.class_id || s.kurs_id ? slotColor(s) : "var(--accent)",
      label: slotName(s) || s.title || topicName(s.topic_id) || "—",
      sub: eintrag ? (eintrag.title || topicName(eintrag.topic_id) || t("kalender.planned")) + (linked(eintrag) ? " ↗" : "") : "",
      // Leere Stundenplan-Stunde (kein Eintrag): kann für diesen Tag entfallen.
      onCancel: eintrag ? null : () => onCancelSlot && onCancelSlot(day, s.period),
      onClick: eintrag ? () => onOpen({ ...eintrag, date: new Date(eintrag.date) }) : () => onSlot(day, s) });
  });
  list.filter((e) => e.period != null && !belegte.has(e.period)).forEach((e) => {
    const { s: sm, e: em } = pTime(e.period);
    if (sm == null) { ganztags.push(e); return; }   // keine Uhrzeit hinterlegt -> ganztägig
    timed.push({ key: "e" + e.id, start: sm, end: em != null ? em : sm + 45, col: "var(--accent)",
      label: e.title || topicName(e.topic_id) || t("kalender.planned"), sub: "", onClick: () => onOpen({ ...e, date: new Date(e.date) }) });
  });
  // Einträge mit freier Uhrzeit (kein Stundenplan-Slot) in die Zeitspur.
  list.filter((e) => e.period == null && hmToMin(e.start_time) != null).forEach((e) => {
    const sm = hmToMin(e.start_time);
    const emv = hmToMin(e.end_time);
    timed.push({ key: "t" + e.id, start: sm, end: emv != null && emv > sm ? emv : sm + 45, col: e.class_id ? classColor(e.class_id) : "var(--accent)",
      label: e.title || topicName(e.topic_id) || t("kalender.planned"), sub: "", onClick: () => onOpen({ ...e, date: new Date(e.date) }) });
  });
  const extAllDay = ext.filter((ev) => hmToMin(ev.time) == null);
  ext.filter((ev) => hmToMin(ev.time) != null).forEach((ev, i) => {
    const sm = hmToMin(ev.time);
    const emx = hmToMin(ev.endtime); // echte Endzeit aus dem Feed, sonst 60min-Fallback
    timed.push({ key: "x" + i, start: sm, end: emx != null && emx > sm ? emx : sm + 60, col: ev.color || extColor || "var(--text3)", dashed: true,
      label: (ev.title || "—"), extern: true, sub: ev.location || "", onClick: () => onExt(ev) });
  });

  // Überlappende Termine nebeneinander: jedem Termin eine Spalte (lane) zuweisen,
  // die Breite pro Cluster durch die Spaltenzahl teilen. So verdecken sich
  // gleichzeitige Ereignisse nicht mehr.
  {
    const items = timed.slice().sort((a, b) => a.start - b.start || a.end - b.end);
    items.forEach((e) => { e.lane = 0; e.lanes = 1; });
    for (let i = 0; i < items.length; i++) {
      const used = new Set();
      for (let j = 0; j < i; j++) { const f = items[j]; if (f.start < items[i].end && items[i].start < f.end) used.add(f.lane); }
      let c = 0; while (used.has(c)) c++;
      items[i].lane = c;
    }
    // Cluster (zusammenhängende Überlappungen) → gemeinsame Spaltenzahl.
    let cStart = 0, cMax = 0, cEnd = -Infinity;
    for (let i = 0; i < items.length; i++) {
      if (i > cStart && items[i].start >= cEnd) { for (let k = cStart; k < i; k++) items[k].lanes = cMax + 1; cStart = i; cMax = 0; cEnd = -Infinity; }
      cMax = Math.max(cMax, items[i].lane); cEnd = Math.max(cEnd, items[i].end);
    }
    for (let k = cStart; k < items.length; k++) items[k].lanes = cMax + 1;
  }

  // Erste belegte Minute des Tages (halbe Stunde Vorlauf), sonst 6 Uhr.
  const ersteMinute = timed.length ? Math.max(0, Math.min(...timed.map((x) => x.start)) - 30) : 6 * 60;
  const scrollRef = useCallback((el) => { if (el) el.scrollTop = (ersteMinute / 60) * HOUR; }, [ersteMinute]);

  const hasBanner = ganztags.length > 0 || extAllDay.length > 0;
  const bannerBtn = (key, title, sub, onClick, extern, col) => {
    const c = col || extColor;
    return (
    <button key={key} onClick={onClick}
      style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 16px", borderRadius: CONTROL_R, cursor: "pointer",
        border: extern ? `1px dashed ${c || "var(--border2)"}` : "1px solid var(--accent)", background: extern ? (c ? c + "1e" : "var(--bg2)") : "var(--accent-bg, rgba(10,132,255,0.10))", color: "var(--text)" }}>
      <span style={{ fontSize: 14, fontWeight: 700 }}>{title}</span>
      {sub && <span style={{ display: "block", fontSize: 12, color: "var(--text3)", marginTop: 2 }}>{sub}</span>}
    </button>
    );
  };

  return (
    <div>
      {/* Freier Tag: als Hinweis oben, nicht als Ersatz fuer den ganzen Tag. */}
      {f && (
        <div style={{ ...panelStyle, border: "none", padding: "12px 16px", background: "rgba(184,134,11,0.12)", color: C.warning, fontSize: 14, fontWeight: 600, marginBottom: 16 }}>
          <Icon d={ICONS.sun} size={14} color={C.warning} /> {f.label ? `${f.label} — ${t("kalender.free")}` : t("kalender.free")}
        </div>
      )}
      {hasBanner && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ ...sectionLabel, marginBottom: 6 }}>{t("kalender.allDay")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {ganztags.map((e) => bannerBtn("g" + e.id, `${e.title || topicName(e.topic_id) || "—"}${linked(e) ? " ↗" : ""}`, e.notes || "", () => onOpen({ ...e, date: new Date(e.date) }), false))}
            {extAllDay.map((ev, i) => bannerBtn("xa" + i, ev.title || "—", ev.location || "", () => onExt(ev), true, ev.color))}
          </div>
        </div>
      )}

      {/* Datierte To-dos dieses Tages (Modul To-do). */}
      {todoByDay && todoByDay(day).length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...sectionLabel, marginBottom: 6 }}>{t("todo.title")}</div>
          <TodoChips list={todoByDay(day)} onOpen={onTodo} />
        </div>
      )}

      {/* Zeitleiste 0–24 Uhr: scrollbar, Start bei der ersten Stunde des Tages. */}
      {timed.length > 0 && (
        <div ref={scrollRef} style={{ ...cardStyle, padding: 0, maxHeight: "62vh", overflowY: "auto" }}>
        <div style={{ position: "relative", height: 24 * HOUR }}
          onClick={(ev) => {
            // Klick auf freie Fläche der Zeitleiste öffnet direkt den Editor mit
            // vorbelegter Uhrzeit (auf 5 Min gerundet). Klicks auf Termine nicht.
            if (ev.target.closest("button")) return;
            const y = ev.clientY - ev.currentTarget.getBoundingClientRect().top;
            // Auf die volle Stunde abrunden (Klick auf 16:20 -> 16:00).
            let h = Math.floor((y / HOUR));
            h = Math.max(0, Math.min(23, h));
            const hhmm = String(h).padStart(2, "0") + ":00";
            onOpen({ date: day, start_time: hhmm });
          }}>
          {Array.from({ length: 25 }, (_, h) => (
            <div key={h} style={{ position: "absolute", top: yOf(h * 60), left: 46, right: 0, borderTop: h === 0 || h === 24 ? "none" : "1px solid var(--border)" }}>
              {h < 24 && <span style={{ position: "absolute", top: -1, left: -44, fontSize: 11, color: "var(--text3)" }}>{String(h).padStart(2, "0")}:00</span>}
            </div>
          ))}
          {timed.map((it) => (
            <div key={it.key} style={{ position: "absolute", top: yOf(it.start) + 1, height: Math.max(22, yOf(it.end) - yOf(it.start) - 2),
              left: `calc(50px + ${it.lane || 0} * (100% - 58px) / ${it.lanes || 1})`,
              width: `calc((100% - 58px) / ${it.lanes || 1} - 3px)` }}>
              <button onClick={it.onClick} title={`${it.label}${it.sub ? " — " + it.sub : ""}`}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
                  textAlign: "left", padding: "4px 8px", borderRadius: CONTROL_R, overflow: "hidden", cursor: "pointer",
                  border: it.dashed ? "1px dashed var(--border2)" : "none", borderLeft: `3px solid ${it.col}`,
                  background: it.dashed ? "var(--bg2)" : it.col + "22", color: "var(--text)" }}>
                <div style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.label}</div>
                {it.sub && <div style={{ fontSize: 11, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.sub}</div>}
              </button>
              {it.onCancel && <button onClick={(e) => { e.stopPropagation(); it.onCancel(); }} title={t("kalender.slotCancel")}
                style={{ position: "absolute", top: 1, right: 1, width: 18, height: 18, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", border: "none", cursor: "pointer", background: "var(--card)", color: "var(--text3)", lineHeight: 1, boxShadow: SHADOW.ruhig }}>
                <Icon d={ICONS.close} size={11} /></button>}
            </div>
          ))}
        </div>
        </div>
      )}
      {!hasBanner && timed.length === 0 && <p style={{ fontSize: 14, color: "var(--text3)" }}>{t("kalender.empty")}</p>}
    </div>
  );
}

function TimetableView({ tt, showTimes = false, stichtag = null, className, slotName, slotColor, classColor, topicName, onEdit, onPeriods, onTimes, breaks = [], onAddBreak, onDelBreak, t }) {
  // Uhrzeiten-Umschalter liegt jetzt oben neben Export/Import (Prop showTimes).
  const wdays = [t("kalender.mon"), t("kalender.tue"), t("kalender.wed"), t("kalender.thu"), t("kalender.fri")];
  // ── Ein Entwurf für Stundenzahl und Uhrzeiten ──
  // Beides schrieb bisher sofort: die Uhrzeit beim Verlassen des Feldes, die
  // Stundenzahl beim Klick auf + / −. Jetzt sammelt der Entwurf beides flach
  // (`periods`, `t<i>start`, `t<i>end` — Zeichenketten und Zahlen, damit ein
  // Neuladen die Arbeitskopie wieder einholt) und schreibt auf „Speichern".
  const basis = useMemo(() => {
    const o = { periods: tt.periods };
    for (let i = 0; i < tt.periods; i++) {
      o[`t${i}start`] = (tt.times && tt.times[i] && tt.times[i].start) || "";
      o[`t${i}end`] = (tt.times && tt.times[i] && tt.times[i].end) || "";
    }
    return o;
  }, [tt]);
  const frisch = useRef(false);
  const entwurf = useEntwurf(basis, async (wert) => {
    if (wert.periods !== tt.periods) await onPeriods(wert.periods);
    const arr = Array.from({ length: wert.periods }, (_, i) => ({ start: wert[`t${i}start`] || "", end: wert[`t${i}end`] || "" }));
    await onTimes(arr);
    frisch.current = true;
  });
  useEffect(() => { if (frisch.current) { frisch.current = false; entwurf.verwerfen(); } });
  const anzahl = entwurf.wert.periods;
  const periods = Array.from({ length: anzahl }, (_, i) => i + 1);
  // Der Editor zeigt den Plan des GEWÄHLTEN Zeitraums — nicht stur die
  // aktuellste Fassung. Sonst zeigte die Wahl „1. Halbjahr" den Plan des
  // zweiten und man überschriebe beim Tippen den falschen.
  const slot = (wd, p) => tt.slots.find((s) => s.weekday === wd && s.period === p
    && slotActiveOn(s, stichtag || new Date()));
  const timeVal = (i, f) => entwurf.wert[`t${i}${f}`] || "";
  const commitTime = (i, f, val) => entwurf.setz({ [`t${i}${f}`]: val });
  const timeInput = { width: "100%", boxSizing: "border-box", border: "1px solid var(--border2)", borderRadius: CONTROL_R, fontSize: 12, padding: 4, background: "var(--bg)", color: "var(--text)", marginTop: 4 };
  // Zelle des Stundenplans: aus der gemeinsamen Tabellenzelle abgeleitet, nur
  // Rahmen ringsum statt nur unten (das Raster braucht alle vier Kanten).
  const tdBase = { ...tdCell, border: "1px solid var(--border)", padding: 0, textAlign: "left", verticalAlign: "top", background: "var(--card)" };
  // Vertikal konstant: Zeilenhoehe = Dauer * px/min. Pausen zwischen den Stunden
  // erscheinen als leere Zwischenzeile derselben Skalierung.
  const PXMIN = 1.3;
  const rowH = (p) => { const a = hmToMin(timeVal(p - 1, "start")), b = hmToMin(timeVal(p - 1, "end")); return a != null && b != null && b > a ? Math.max(52, (b - a) * PXMIN) : 72; };
  const gapH = (p) => { const a = hmToMin(timeVal(p - 1, "end")), b = hmToMin(timeVal(p, "start")); return a != null && b != null && b > a ? (b - a) * PXMIN : 0; };
  return (
    <div>
      <SpeicherBalken entwurf={entwurf} />
      <div>
        <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
          <thead><tr>
            <th style={{ ...th, width: showTimes ? 96 : 26 }}></th>
            {wdays.map((w) => <th key={w} style={th}>{w}</th>)}
          </tr></thead>
          <tbody>
            {periods.map((p) => {
              const h = rowH(p);
              const gap = gapH(p); // Pause nach dieser Stunde
              return (
                <Fragment key={p}>
                  <tr>
                    {/* Senkrecht mittig: die Zahl stand oben in der Zelle,
                        waehrend die Stunde daneben mittig sitzt — bei einer
                        Doppelstunde lagen beide sichtbar auseinander. */}
                    <td style={{ ...tdBase, textAlign: "center", verticalAlign: "middle", padding: showTimes ? 4 : "4px 0", background: "transparent", border: "none", width: showTimes ? 96 : 26 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)" }}>{p}.</div>
                      {showTimes && (<>
                        <input type="time" value={timeVal(p - 1, "start")} onChange={(e) => commitTime(p - 1, "start", e.target.value)} style={timeInput} title={t("kalender.start")} />
                        <input type="time" value={timeVal(p - 1, "end")} onChange={(e) => commitTime(p - 1, "end", e.target.value)} style={timeInput} title={t("kalender.end")} />
                      </>)}
                    </td>
                    {wdays.map((_, wd) => {
                      const s = slot(wd, p);
                      const label = s ? slotName(s) : "";
                      const col = s ? slotColor(s) : null;
                      return (
                        <td key={wd} style={{ ...tdBase, padding: 0, height: h }}>
                          <button onClick={() => onEdit(s ? { ...s } : { weekday: wd, period: p })} title={s ? t("kalender.editSlot") : t("kalender.addSlot")}
                            style={{ display: "flex", alignItems: "center", justifyContent: s ? "flex-start" : "center", gap: 6, width: "100%", height: "100%", minHeight: h, textAlign: "left", padding: "8px 12px", border: "none", cursor: "pointer", boxSizing: "border-box",
                              borderLeft: col ? `4px solid ${col}` : "4px solid transparent",
                              background: col ? col + "22" : "transparent", color: col ? "var(--text)" : "var(--text3)" }}>
                            {s ? <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label || "—"}</div>
                              : <Icon d={ICONS.plus} size={16} color="var(--text3)" />}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                  {gap > 0 && (
                    <tr aria-hidden style={{ height: gap }}>
                      <td style={{ border: "none", background: "transparent" }} />
                      {wdays.map((_, wd) => <td key={wd} style={{ border: "none", background: "repeating-linear-gradient(45deg, var(--bg), var(--bg) 6px, transparent 6px, transparent 12px)" }} />)}
                    </tr>
                  )}
                </Fragment>
              );
            })}
            <tr>
              <td style={{ padding: 6, border: "none", textAlign: "center" }}>
                <div style={{ display: "inline-flex", gap: 4 }}>
                  {anzahl > 1 && <button onClick={() => entwurf.setz({ periods: anzahl - 1 })} title={t("kalender.removePeriod")} style={{ ...btnSecondary, ...btnSmall, padding: "4px 12px" }}>−</button>}
                  <button onClick={() => entwurf.setz({ periods: anzahl + 1 })} title={t("kalender.addPeriod")} style={{ ...btnSecondary, ...btnSmall, padding: "4px 12px" }}>+</button>
                </div>
              </td>
              {wdays.map((_, wd) => <td key={wd} style={{ border: "none" }} />)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Unterrichtsfreie Zeitraeume (Ferien, bewegliche Feiertage). An diesen Tagen
// blendet der Kalender Vorlagen und Eintraege aus. Eigener Tab (standalone).
// Nachteilsausgleiche zur Klassenarbeit: die Fördermaßnahmen der Klasse, die in
// Klassenarbeiten gelten (Kern: students.massnahmen mit arbeit=true). Der
// Kalender zeigt sie nur an — gepflegt werden sie unter /classes.
function ExamMassnahmen({ classId, kursId = null, t }) {
  const [rows, setRows] = useState([]);
  // Wie viele Ausgleiche es insgesamt gäbe (alle Fächer) — nur so lässt sich
  // sagen, ob wirklich nichts hinterlegt ist oder nur nichts für DIESEN Kurs.
  const [gesamt, setGesamt] = useState(0);
  const [fehler, setFehler] = useState(false);
  const [offen, setOffen] = useState(false);
  useEffect(() => {
    let alive = true;
    setFehler(false);
    // Absoluter Pfad: API zeigt hier auf /api/kalender, die Maßnahmen liegen
    // aber im Kern unter /api/classes.
    fetch(`/api/classes/${classId}/massnahmen?arbeit=true${kursId ? `&kurs_id=${kursId}` : ""}`)
      .then((r) => { if (!r.ok) { if (alive) setFehler(true); return []; } return r.json(); })
      .then((d) => { if (alive) setRows(Array.isArray(d) ? d : []); })
      .catch(() => { if (alive) setFehler(true); });
    hol(`/api/classes/${classId}/massnahmen?arbeit=true`)
      .then((d) => { if (alive) setGesamt(Array.isArray(d) ? d.length : 0); });
    return () => { alive = false; };
  }, [classId, kursId]);
  // Auch ohne Eintrag sichtbar: „nichts hinterlegt" ist eine Aussage. Sonst
  // bliebe unklar, ob es keine Ausgleiche gibt oder die Anzeige fehlt.
  // Ein Serverfehler darf nicht wie „nichts hinterlegt" aussehen — sonst sucht
  // man den Fehler in den Daten, während der Endpunkt gar nicht antwortet.
  if (fehler) {
    return (
      <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8, fontSize: 12, color: C.warning }}>
        {t("kalender.examMeasuresError")}
      </div>
    );
  }
  if (!rows.length) {
    return (
      <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8, fontSize: 12, color: "var(--text3)" }}>
        {gesamt > 0 ? t("kalender.examMeasuresOtherCourse", { n: gesamt }) : t("kalender.examMeasuresNone")}{" "}
        <Link to="/kurse" style={{ color: "var(--accent)" }}>{t("kalender.examMeasuresAdd")}</Link>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
      <button onClick={() => setOffen((v) => !v)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--accent)", fontSize: 12, fontWeight: 600 }}>
        {t("kalender.examMeasures", { n: rows.length })}
        <Icon d={ICONS.open} size={11} style={{ transform: offen ? "rotate(-90deg)" : "rotate(90deg)", marginLeft: 4 }} />
      </button>
      {offen && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {rows.map((s) => (
            <div key={s.student_id} style={{ fontSize: 12, color: "var(--text2)" }}>
              <strong style={{ color: "var(--text)" }}>{s.name}</strong>{" "}
              {s.massnahmen.map((m, i) => (
                <span key={i} style={{ marginRight: 4 }}>
                  {m.art}{m.detail ? ` (${m.detail})` : ""}{i < s.massnahmen.length - 1 ? "," : ""}
                </span>
              ))}
            </div>
          ))}
          <Link to="/kurse" style={{ fontSize: 12, color: "var(--text3)" }}>{t("kalender.examMeasuresEdit")}</Link>
        </div>
      )}
    </div>
  );
}

// Klassenarbeiten planen + Übersicht: je kommender Klassenarbeit die bis dahin
// verbleibenden Stundenplan-Stunden (freie Tage/Ausfälle bereits abgezogen).
function ExamPanel({ overview, periods = 6, aktiv = {}, topics = [], onAdd, onUpd, onDel, t }) {
  const [classId, setClassId] = useState("");
  const [kursId, setKursId] = useState(null);
  const [date, setDate] = useState("");
  const [title, setTitle] = useState("");
  const [period, setPeriod] = useState("");   // "" = ganztägig, sonst Stundennummer
  const [themen, setThemen] = useState([]);   // Themen der neuen Arbeit
  const [notiz, setNotiz] = useState("");     // freie Notiz zum Termin
  const [eNotiz, setENotiz] = useState("");
  const [eThemen, setEThemen] = useState([]);
  const [editId, setEditId] = useState(null);
  const [eDate, setEDate] = useState("");
  const [eTitle, setETitle] = useState("");
  const [eClassId, setEClassId] = useState("");
  const [eKursId, setEKursId] = useState(null);
  const [ePeriod, setEPeriod] = useState("");
  const pOpts = Array.from({ length: Math.max(1, periods) }, (_, i) => i + 1);
  // Wonach die Liste sortiert ist. Vorgabe bleibt das Datum — das ist die
  // Frage „was kommt als Naechstes?". Wer mehrere Faecher unterrichtet, plant
  // die Arbeiten dagegen fachweise; innerhalb eines Fachs zaehlt wieder das
  // Datum. Im Browser gemerkt: es ist eine Ansicht, kein Inhalt.
  const [sortierung, setSortierung] = useState(() => {
    try { return localStorage.getItem("kal_exam_sort") === "fach" ? "fach" : "datum"; } catch { return "datum"; }
  });
  const setzeSortierung = (v) => { setSortierung(v); try { localStorage.setItem("kal_exam_sort", v); } catch { /* egal */ } };
  // Suche und Kurs-Filter. Die Liste waechst mit jedem Halbjahr, und die Frage
  // ist fast immer „was steht in DIESEM Kurs an?" oder „wo war noch mal die
  // Arbeit ueber Dreiecke?". Gesucht wird in Titel, Kurs/Klasse und den Themen
  // — also in allem, was auf der Karte steht.
  const [suche, setSuche] = useState("");
  const [filterKurs, setFilterKurs] = useState("");
  const kursListe = [...new Set(overview.map((e) => e.kurs || e.klasse).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const q = suche.trim().toLowerCase();
  const gefiltert = overview.filter((e) => {
    if (filterKurs && (e.kurs || e.klasse || "") !== filterKurs) return false;
    if (!q) return true;
    const heu = [e.title, e.kurs, e.klasse, e.notiz, ...(e.topics || []).map((tp) => tp.label)]
      .filter(Boolean).join(" ").toLowerCase();
    return heu.includes(q);
  });
  const liste = sortierung === "fach"
    ? [...gefiltert].sort((a, b) => (a.fach || "\uffff").localeCompare(b.fach || "\uffff", undefined, { sensitivity: "base" })
        || new Date(a.date) - new Date(b.date))
    : gefiltert;
  const startEdit = (e) => { setEditId(e.id); setEDate(ymd(new Date(e.date))); setETitle(e.title || ""); setEClassId(e.class_id ? String(e.class_id) : ""); setEKursId(e.kurs_id ?? null); setEPeriod(e.period ? String(e.period) : ""); setENotiz(e.notiz || ""); setEThemen(e.topic_ids || []); };
  const saveEdit = (e) => {
    if (!eDate || !eClassId) return;
    const [y, m, d] = eDate.split("-").map(Number);
    onUpd(e.id, { class_id: Number(eClassId), kurs_id: eKursId ?? null, date: new Date(y, m - 1, d, 8, 0, 0).toISOString(), title: eTitle.trim(), period: ePeriod ? Number(ePeriod) : null, notiz: eNotiz, topic_ids: eThemen });
    setEditId(null);
  };
  const save = () => {
    if (!classId || !date) return;
    const [y, m, d] = date.split("-").map(Number);
    onAdd({ class_id: Number(classId), kurs_id: kursId ?? null, date: new Date(y, m - 1, d, 8, 0, 0).toISOString(), title: title.trim(), period: period ? Number(period) : null, notiz, topic_ids: themen });
    setDate(""); setTitle(""); setPeriod(""); setNotiz(""); setThemen([]);
  };
  // Eine Höhe, eine Form: Felder aus den gemeinsamen Bausteinen (CONTROL_H /
  // CONTROL_R), keine eigene Polsterung je Feld.
  const pSel = selectStyle;
  const loeschen = async (e) => {
    if (!(await askConfirm(t("kalender.examDeleteConfirm"), { danger: true, ok: t("common.delete") }))) return;
    onDel(e.id);
  };
  return (
    <div>
      {/* Anlegen in der gemeinsamen Bauform (components/Werkzeugleiste.jsx):
          links WAS (Kurs/Klasse), daneben die Felder des Alltags. */}
      <Werkzeugleiste
        links={(
          <KursKlasseSelect value={classId === "" ? "" : Number(classId)} kursValue={kursId}
            onChange={(id, kid) => { setClassId(id === "" ? "" : String(id)); setKursId(id === "" ? null : (kid ?? null)); }} onKurs={setKursId} />
        )}
        style={{ marginBottom: 16 }}
      >
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={toolbarInput} />
        <select value={period} onChange={(e) => setPeriod(e.target.value)} title={t("kalender.examPeriodHint")} style={pSel}>
          <option value="">{t("kalender.examAllDay")}</option>
          {pOpts.map((p) => <option key={p} value={p}>{p}. {t("kalender.period")}</option>)}
        </select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("kalender.examTitle")} style={{ ...toolbarInput, flex: 1, minWidth: 140 }} />
        {/* Worüber wird geschrieben? Die Themen kommen aus dem Kern (Regel 3:
            der Kalender zeigt auf sie, besitzt sie nicht). Freiwillig — ein
            Termin ohne Themen ist ein vollständiger Termin. */}
        <ThemenWahl topics={topics} value={themen} onChange={setThemen} />
        <button onClick={save} disabled={!classId || !date} style={{ ...toolbarBtnPrimary, opacity: (classId && date) ? 1 : 0.5 }}>{t("common.add")}</button>
      </Werkzeugleiste>

      {overview.length > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder={t("kalender.examSearch")}
            style={{ ...toolbarInput, flex: 1, minWidth: 160 }} />
          {kursListe.length > 1 && (
            <select value={filterKurs} onChange={(e) => setFilterKurs(e.target.value)} style={pSel}>
              <option value="">{t("kalender.examAllKurse")}</option>
              {kursListe.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          )}
          <Segment>
            {[["datum", t("kalender.sortDate")], ["fach", t("kalender.sortFach")]].map(([k, label]) => (
              <button key={k} onClick={() => setzeSortierung(k)}
                style={{ ...segmentBtn, fontWeight: sortierung === k ? 700 : 500,
                  color: sortierung === k ? "var(--accent)" : "var(--text2)" }}>{label}</button>
            ))}
          </Segment>
        </div>
      )}

      {liste.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--text3)" }}>
          {overview.length ? t("kalender.examsNoMatch") : t("kalender.examsEmpty")}
        </p>
      ) : liste.map((e) => (
        <div key={e.id} style={{ ...cardStyle, padding: 12, marginBottom: 8 }}>
         <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {editId === e.id ? (
            <>
              <div style={{ flex: 1, minWidth: 0, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <KursKlasseSelect value={eClassId === "" ? "" : Number(eClassId)} kursValue={eKursId}
                  onChange={(id, kid) => { setEClassId(id === "" ? "" : String(id)); setEKursId(id === "" ? null : (kid ?? null)); }} onKurs={setEKursId} />
                <input type="date" value={eDate} onChange={(ev) => setEDate(ev.target.value)} style={toolbarInput} />
                <select value={ePeriod} onChange={(ev) => setEPeriod(ev.target.value)} title={t("kalender.examPeriodHint")} style={pSel}>
                  <option value="">{t("kalender.examAllDay")}</option>
                  {pOpts.map((p) => <option key={p} value={p}>{p}. {t("kalender.period")}</option>)}
                </select>
                <input value={eTitle} onChange={(ev) => setETitle(ev.target.value)} placeholder={t("kalender.examTitle")} style={{ ...toolbarInput, flex: 1, minWidth: 120 }} />
                <ThemenWahl topics={topics} value={eThemen} onChange={setEThemen} />
                {/* Die Notiz steht in der Bearbeiten-Zeile und nicht in der
                    Anlegen-Leiste: beim Anlegen kennt man meist nur Datum und
                    Bezeichnung, das Merkenswerte kommt spaeter dazu. */}
                <input value={eNotiz} onChange={(ev) => setENotiz(ev.target.value)} placeholder={t("kalender.examNotiz")}
                  style={{ ...toolbarInput, flex: 1, minWidth: 160 }} />
              </div>
              <button onClick={() => saveEdit(e)} style={toolbarBtnPrimary}>{t("common.save")}</button>
              <button onClick={() => setEditId(null)} style={toolbarBtn}>{t("common.abort")}</button>
            </>
          ) : (
            <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{e.kurs || e.klasse || "—"}{e.title ? ` · ${e.title}` : ""}</div>
                {/* Die Kalenderwoche steht dabei: Schulen planen in Wochen ("die
                    Arbeit liegt in KW 9"), und aus einem Datum liest man sie
                    nicht ab. */}
                <div style={{ fontSize: 12, color: "var(--text3)" }}>{new Date(e.date).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · {t("kalender.kw")} {isoWeek(new Date(e.date)).week}{e.period ? ` · ${e.period}. ${t("kalender.period")}` : ""}</div>
                {/* Die Themen der Arbeit: beim Vorbereiten steht damit da,
                    worüber geschrieben wird — und beim Planen der letzten
                    Stunden davor, was noch drankommen muss. */}
                {e.notiz && <div style={{ fontSize: 13, color: "var(--text2)", marginTop: 4, whiteSpace: "pre-wrap" }}>{e.notiz}</div>}
                {(e.topics || []).length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                    {e.topics.map((tp) => (
                      <span key={tp.id} style={{ ...chipStyle, fontWeight: 500 }}>{tp.label}</span>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)" }}>{e.stunden}</div>
                <div style={{ fontSize: 11, color: "var(--text3)" }}>{t("kalender.examStunden")}</div>
              </div>
              {/* Auto-verknüpfte Auswertung im Modul „Klassenarbeit" öffnen —
                  nur bei aktivem Modul Auswertung (Regel 3); ohne es führte der
                  Knopf ans ModuleGate. */}
              {aktiv.auswertung && e.work_id && e.class_id && (
                <Link to={`/auswertung?tab=klassenarbeit&class=${e.class_id}${e.kurs_id ? `&kurs=${e.kurs_id}` : ""}&work=${e.work_id}`} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("kalender.openExamWork")} aria-label={t("kalender.openExamWork")}>
                  <Icon d={ICONS.chart} size={16} color="var(--accent)" />
                </Link>
              )}
              <button onClick={() => startEdit(e)} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("common.edit")} aria-label={t("common.edit")}><Icon d={ICONS.edit} size={15} /></button>
              {/* Löschen ins Menü und mit Rückfrage: es stand direkt neben
                  „Bearbeiten" und löschte den Termin ohne ein Wort. */}
              <MehrMenu eintraege={[
                { key: "del", label: t("common.delete"), icon: ICONS.trash, gefahr: true, onClick: () => loeschen(e) },
              ]} />
            </>
          )}
         </div>
         {/* Was fuer einzelne Kinder abweicht (Zeitzuschlag, abweichende
             Lernziele …) — beim Vorbereiten der Arbeit muss es sichtbar sein. */}
         {e.class_id && <ExamMassnahmen classId={e.class_id} kursId={e.kurs_id ?? null} t={t} />}
        </div>
      ))}
    </div>
  );
}

function BreaksPanel({ breaks, onAdd, onDel, t, standalone }) {
  const [von, setVon] = useState("");
  const [bis, setBis] = useState("");
  const [label, setLabel] = useState("");
  const [neuOffen, setNeuOffen] = useState(false);
  const [landOffen, setLandOffen] = useState(false);
  // Eine Höhe, eine Form — Felder einer Leiste kommen aus dem gemeinsamen
  // Baustein (CONTROL_H/CONTROL_R), nicht aus rohem inputStyle.
  const fld = toolbarInput;
  const speichern = () => {
    if (!von) return;
    const ende = bis || von;
    onAdd({ start_date: new Date(von + "T12:00:00").toISOString(), end_date: new Date(ende + "T12:00:00").toISOString(), label: label.trim() });
    setVon(""); setBis(""); setLabel("");
  };
  const fmt = (s) => new Date(s).toLocaleDateString();
  // Die Liste waechst mit jedem Schuljahr und besteht nach zwei Jahren zur
  // Haelfte aus Ferien, die vorbei sind. Vorgabe ist deshalb „Kommende";
  // Vergangenes ist nicht weg, es steht nur nicht mehr im Weg.
  const [zeitraum, setZeitraum] = useState("kommend");
  const heuteIso = ymd(new Date());
  const sichtbar = (breaks || []).filter((b) => {
    if (zeitraum === "alle") return true;
    const vorbei = ymd(new Date(b.end_date)) < heuteIso;
    return zeitraum === "vergangen" ? vorbei : !vorbei;
  });
  // Ferien-Import: statischer Datensatz (openHolidays), zwei Schuljahre. Fuegt
  // nur fehlende Zeitraeume hinzu (gleiches Startdatum + Label = schon da).
  const [land, setLand] = useState(() => localStorage.getItem("nuvora_bundesland") || "NW");
  const [importing, setImporting] = useState(false);
  const ferienImport = async () => {
    const liste = ferienDE[land] || [];
    // Bestehende nach Start|Label. Stimmt der Eintrag, aber das ENDE weicht ab
    // (z.B. alter Import vor einer Datensatz-Korrektur), wird er ersetzt — sonst
    // bliebe ein zu kurzes Ferienende stehen (Idempotenz nur über Start+Label).
    const byKey = new Map(breaks.map((b) => [`${ymd(new Date(b.start_date))}|${(b.label || "").trim()}`, b]));
    const toAdd = [];
    const toFix = [];
    for (const f of liste) {
      const ex = byKey.get(`${f.start}|${f.label.trim()}`);
      if (!ex) toAdd.push(f);
      else if (ymd(new Date(ex.end_date)) !== f.end) toFix.push({ old: ex, f });
    }
    if (toAdd.length === 0 && toFix.length === 0) { showAlert(t("kalender.ferienNothing")); return; }
    setImporting(true);
    for (const { old } of toFix) {
      await fetch(`${API}/breaks/${old.id}`, { method: "DELETE" }).catch(() => {});
    }
    for (const f of [...toFix.map((x) => x.f), ...toAdd]) {
      await onAdd({ start_date: new Date(f.start + "T12:00:00").toISOString(), end_date: new Date(f.end + "T12:00:00").toISOString(), label: f.label });
    }
    setImporting(false);
  };
  const feiertagImport = async () => {
    const jahr = new Date().getFullYear();
    const liste = [...feiertage(jahr, land), ...feiertage(jahr + 1, land)];
    const vorhanden = new Set(breaks.map((b) => `${ymd(new Date(b.start_date))}|${(b.label || "").trim()}`));
    const neu = liste.filter((f) => !vorhanden.has(`${f.start}|${f.label.trim()}`));
    if (neu.length === 0) { showAlert(t("kalender.ferienNothing")); return; }
    setImporting(true);
    for (const f of neu) {
      await onAdd({ start_date: new Date(f.start + "T12:00:00").toISOString(), end_date: new Date(f.end + "T12:00:00").toISOString(), label: f.label });
    }
    setImporting(false);
  };
  return (
    <div style={standalone ? {} : { marginTop: 24, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
      {/* Titel nur im eingebetteten Fall (im Stundenplan) — als eigene Seite trägt
          ihn schon der Abschnitts-h1 oben. */}
      {!standalone && <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{t("kalender.breaksTitle")}</h3>}
      {/* Eine Leiste statt zweier: das Anlegen ist ein Plus mit Dialog wie
          ueberall sonst, statt drei Feldern und einem Knopf, die dauerhaft
          herumstehen. Bundesland und die beiden Import-Aktionen sind seltene
          Einstellungen — sie liegen im Mehr-Menue. Das Bundesland bestimmt nur,
          WAS importiert wird; man setzt es einmal und nie wieder. */}
      <Werkzeugleiste
        style={{ marginBottom: 16 }}
        links={(
          <Segment>
            {[["kommend", t("kalender.breaksUpcoming")], ["vergangen", t("kalender.breaksPast")],
              ["alle", t("kalender.breaksAll")]].map(([k, label]) => (
                <button key={k} onClick={() => setZeitraum(k)}
                  style={{ ...segmentBtn, fontWeight: zeitraum === k ? 700 : 500,
                    color: zeitraum === k ? "var(--accent)" : "var(--text2)" }}>{label}</button>
              ))}
          </Segment>
        )}
        mehr={[
          { key: "land", label: `${t("kalender.bundesland")}: ${(BUNDESLAENDER.find(([k]) => k === land) || [])[1] || land}`, icon: ICONS.settings, onClick: () => setLandOffen(true) },
          { key: "ferien", label: importing ? t("kalender.ferienImporting") : t("kalender.ferienImport"), icon: ICONS.import, disabled: importing, onClick: ferienImport },
          { key: "feiertage", label: t("kalender.feiertagImport"), icon: ICONS.import, disabled: importing, onClick: feiertagImport },
        ]}
      >
        <AddButton onClick={() => { setVon(""); setBis(""); setLabel(""); setNeuOffen(true); }} title={t("kalender.addBreak")} />
      </Werkzeugleiste>

      {neuOffen && (
        <Modal onClose={() => setNeuOffen(false)} width={420} label={t("kalender.addBreak")} title={t("kalender.addBreak")}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text2)" }}>{t("kalender.from")}
              <input type="date" value={von} onChange={(e) => setVon(e.target.value)} autoFocus style={fld} /></label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text2)" }}>{t("kalender.to")}
              <input type="date" value={bis} onChange={(e) => setBis(e.target.value)} min={von} style={fld} /></label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text2)" }}>{t("kalender.breakLabel")}
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("kalender.breakLabelPlaceholder")} style={fld} /></label>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button onClick={() => { speichern(); setNeuOffen(false); }} disabled={!von} style={{ ...btnPrimary, opacity: von ? 1 : 0.5 }}>{t("common.add")}</button>
              <button onClick={() => setNeuOffen(false)} style={btnSecondary}>{t("common.abort")}</button>
            </div>
          </div>
        </Modal>
      )}

      {landOffen && (
        <Modal onClose={() => setLandOffen(false)} width={380} label={t("kalender.bundesland")} title={t("kalender.bundesland")}>
          <p style={{ fontSize: 12, color: "var(--text3)", margin: "0 0 12px" }}>{t("kalender.ferienHint")}</p>
          <select value={land} onChange={(e) => { setLand(e.target.value); localStorage.setItem("nuvora_bundesland", e.target.value); }}
            style={{ ...selectStyle, width: "100%" }}>
            {BUNDESLAENDER.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button onClick={() => setLandOffen(false)} style={btnSecondary}>{t("common.close")}</button>
          </div>
        </Modal>
      )}
      {sichtbar.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text3)" }}>
          {breaks.length === 0 ? t("kalender.noBreaks") : t("kalender.breaksNoneHere")}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {sichtbar.map((b) => (
            <div key={b.id} style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 8, padding: "8px 12px" }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{b.label || t("kalender.free")}</span>
              <span style={{ fontSize: 12, color: "var(--text3)" }}>{fmt(b.start_date)}{fmt(b.start_date) !== fmt(b.end_date) ? ` – ${fmt(b.end_date)}` : ""}</span>
              <button onClick={() => onDel(b.id)} className="icon-btn" style={{ ...iconBtn, marginLeft: "auto", padding: 4 }} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={16} color={C.danger} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SlotModal({ slot, classes, kurse = [], onSave, onDelete, onColor, onRaum, onClose, t }) {
  const [classId, setClassId] = useState(slot.class_id || "");
  const [kursId, setKursId] = useState(slot.kurs_id ?? null); // gewaehlter Kurs (Anzeige)
  // Farbe gehört dem KURS: aus dem gewählten Kurs, sonst (ohne Kurs) der Klasse.
  const clsColorOf = (kid, cid) => (kurse.find((k) => k.id === kid) || {}).color || (classes.find((c) => c.id === Number(cid)) || {}).color || C.info;
  const [color, setColor] = useState(clsColorOf(kursId, classId));
  useEffect(() => { setColor(clsColorOf(kursId, classId)); }, [classId, kursId]); // eslint-disable-line
  // Der Raum gehoert wie die Farbe dem KURS und nicht der einzelnen Stunde:
  // derselbe Kurs hat vier Stunden in der Woche und meist denselben Raum. Er
  // steht trotzdem hier, weil man ihn beim Eintragen des Stundenplans zur Hand
  // hat — gespeichert wird er am Kurs, wie die Farbe auch.
  const raumOf = (kid) => (kurse.find((k) => k.id === kid) || {}).raum || "";
  const [raum, setRaum] = useState(raumOf(kursId));
  useEffect(() => { setRaum(raumOf(kursId)); }, [kursId]); // eslint-disable-line
  const wdays = [t("kalender.mon"), t("kalender.tue"), t("kalender.wed"), t("kalender.thu"), t("kalender.fri"), t("kalender.sat"), t("kalender.sun")];
  const lbl = { fontSize: 12, color: "var(--text2)", margin: "12px 0 4px" };
  return (
    <Modal onClose={onClose} width={440} label={t("kalender.timetable")}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>{t("kalender.timetable")}</h3>
        <div style={{ fontSize: 12, color: "var(--text3)" }}>{wdays[slot.weekday]} · {slot.period}. {t("kalender.period")}</div>
        <div style={lbl}>{t("kalender.kursOrClass")}</div>
        <KursKlasseSelect value={classId === "" ? "" : Number(classId)} kursValue={slot.kurs_id ?? null} allowNone noneLabel={`– ${t("kalender.noClass")} –`} autoFocus
          onChange={(id, kid) => { setClassId(id === "" ? "" : String(id)); setKursId(id === "" ? null : (kid ?? null)); }}
          onKurs={setKursId} style={dialogSelect} />
        {classId && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text2)" }}>
              {t("kalender.classColor")}
              {/* Farbe NUR lokal ändern — angewendet/gespeichert wird sie erst über
                  „Speichern" (sonst schrieb jeder Zwischenwert des Farbwählers live). */}
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
                style={{ width: CONTROL_H, height: CONTROL_H, border: "1px solid var(--border2)", borderRadius: CONTROL_R, background: "none", cursor: "pointer", padding: 0 }} />
            </label>
            <Link to={`/classes?open=${classId}`} onClick={onClose} style={{ fontSize: 13, color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>{t("kalender.toClass")} ↗</Link>
          </div>
        )}
        {kursId && (<>
          <div style={lbl}>{t("kurse.raum")}</div>
          <input value={raum} maxLength={60} onChange={(e) => setRaum(e.target.value)}
            placeholder={t("kalender.placePlaceholder")} style={{ ...inputStyle, width: "100%" }} />
        </>)}
        <DialogFuss onAbbrechen={onClose} onSpeichern={() => {
            // Farbe erst beim Speichern anwenden — und nur, wenn sie sich geändert hat.
            if ((kursId || classId) && color && color !== clsColorOf(kursId, classId)) onColor && onColor(kursId, classId ? Number(classId) : null, color);
            // Der Raum geht an den Kurs — und nur, wenn er sich geaendert hat.
            if (kursId && raum !== raumOf(kursId)) onRaum && onRaum(kursId, raum.trim());
            onSave({ weekday: slot.weekday, period: slot.period, title: "", class_id: classId ? Number(classId) : null, kurs_id: classId ? kursId : null, topic_id: null });
          }}>
          {slot.id && <button onClick={() => onDelete(slot.id)} className="icon-btn" style={{ ...iconBtn, marginLeft: "auto" }} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} color={C.danger} /></button>}
        </DialogFuss>
    </Modal>
  );
}

function EntryModal({ entry, zeiten = [], classes, topics, methods = [], quizze = [], ladders = [], puzzles = [], aktiv = {}, topicName = () => "", kursName = () => "", onSave, onDelete, onClose, t }) {
  const navigate = useNavigate();
  // "Ergebnis als Note": die gelaufene Session zum verknüpften Quiz suchen und
  // deren Auswertung mit direkt geöffnetem Noten-Import ansteuern.
  const alsNote = async () => {
    const r = await fetch(`${API}/quiz-session?set_id=${entry.cardvote_set_id}&class_id=${entry.class_id}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (r && r.session_id) { onClose(); navigate(`/cardvote/evaluation/${r.session_id}?import=1`); }
    else showAlert(t("kalender.noSession"));
  };
  const [title, setTitle] = useState(entry.title || "");
  const [notes, setNotes] = useState(entry.notes || "");
  const [verlauf, setVerlauf] = useState(Array.isArray(entry.verlaufsplan) ? entry.verlaufsplan : []);
  const addPhase = () => setVerlauf((v) => [...v, { phase: "", dauer: "", text: "" }]);
  const setPhase = (i, k, val) => setVerlauf((v) => v.map((p, j) => (j === i ? { ...p, [k]: val } : p)));
  const delPhase = (i) => setVerlauf((v) => v.filter((_, j) => j !== i));
  const movePhase = (i, dir) => setVerlauf((v) => { const j = i + dir; if (j < 0 || j >= v.length) return v; const n = [...v]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const [classId, setClassId] = useState(entry.class_id || "");
  const [kursId, setKursId] = useState(entry.kurs_id ?? null); // gewaehlter Kurs — richtige Auflösung beim Bearbeiten
  const [topicId, setTopicId] = useState(entry.topic_id || "");
  const [methodId, setMethodId] = useState(entry.method_id || "");
  const [quizId, setQuizId] = useState(entry.cardvote_set_id || "");
  const [ladderId, setLadderId] = useState(entry.lernpfad_ladder_id || "");
  const [puzzleId, setPuzzleId] = useState(entry.codedetektiv_puzzle || "");
  const [deckId, setDeckId] = useState(entry.karten_deck_id || "");
  const [startTime, setStartTime] = useState(entry.start_time || "");
  const [endTime, setEndTime] = useState(entry.end_time || "");
  const [ort, setOrt] = useState(entry.location || "");
  // Wiederholung: aus der Regel nur das lesen, was der Dialog anbietet — Rest
  // (etwa eine von Apple gesetzte BYDAY-Liste) bleibt unangetastet, solange
  // niemand den Rhythmus umstellt.
  const rrTeile = Object.fromEntries((entry.rrule || "").split(";").filter((x) => x.includes("=")).map((x) => x.split("=")));
  const [rhythmus, setRhythmus] = useState(rrTeile.FREQ ? `${rrTeile.FREQ}${rrTeile.INTERVAL === "2" ? ":2" : ""}` : "");
  const [rrBis, setRrBis] = useState(rrTeile.UNTIL && rrTeile.UNTIL.length === 8
    ? `${rrTeile.UNTIL.slice(0, 4)}-${rrTeile.UNTIL.slice(4, 6)}-${rrTeile.UNTIL.slice(6, 8)}` : "");
  const rruleBauen = () => {
    if (!rhythmus) return "";
    const [freq, iv] = rhythmus.split(":");
    return [`FREQ=${freq}`, iv ? `INTERVAL=${iv}` : "", rrBis ? `UNTIL=${rrBis.replaceAll("-", "")}` : ""].filter(Boolean).join(";");
  };
  const timeInvalid = !!(startTime && endTime && endTime <= startTime); // Ende vor/gleich Start
  // Ein Eintrag an einer Stundenplan-Stunde hat eine Uhrzeit — die der Stunde.
  // Sie stand nirgends: der Dialog zeigte bei genau diesen Eintraegen gar kein
  // Zeitfeld, und im Popup fehlte die Zeile. Die eigene Zeit hat Vorrang (so
  // rechnet es auch der Tagesplan und der ICS-Feed); leer heisst „die der
  // Stunde" — genau so laesst sich eine einzelne Stunde verlegen, ohne den
  // Stundenplan anzufassen.
  const stunde = entry.period != null ? (zeiten[entry.period - 1] || null) : null;
  const stundeVon = (stunde && stunde.start) || "";
  const stundeBis = (stunde && stunde.end) || "";
  // Die Regel im Klartext. „wiederholt sich" stand da und beantwortete die
  // Frage nicht, die man an einen Serientermin stellt: WIE oft, und bis wann.
  // Was der Dialog nicht anbietet (BYDAY-Listen aus Apple), wird nicht
  // ausgedacht — dann bleibt es beim allgemeinen Satz.
  const rrText = (() => {
    if (!entry.rrule) return null;
    const teile = Object.fromEntries(entry.rrule.split(";").filter((x) => x.includes("=")).map((x) => x.split("=")));
    const iv = Number(teile.INTERVAL || 1);
    const grund = {
      DAILY: iv === 2 ? null : t("kalender.repeatDaily"),
      WEEKLY: iv === 2 ? t("kalender.repeatWeekly2") : iv > 1 ? null : t("kalender.repeatWeekly"),
      MONTHLY: iv > 1 ? null : t("kalender.repeatMonthly"),
      YEARLY: iv > 1 ? null : t("kalender.repeatYearly"),
    }[teile.FREQ];
    if (!grund) return t("kalender.repeatOn");
    if (teile.UNTIL && teile.UNTIL.length >= 8) {
      const u = teile.UNTIL;
      const d = new Date(Number(u.slice(0, 4)), Number(u.slice(4, 6)) - 1, Number(u.slice(6, 8)));
      return `${grund}, ${t("kalender.repeatUntil")} ${d.toLocaleDateString()}`;
    }
    if (teile.COUNT) return `${grund} (${teile.COUNT}×)`;
    return grund;
  })();
  const zeitText = (startTime || endTime)
    ? `${startTime || "?"}–${endTime || "?"}`
    : ((stundeVon || stundeBis) ? `${stundeVon || "?"}–${stundeBis || "?"}` : null);
  const [dateVal, setDateVal] = useState(entry.date ? ymd(new Date(entry.date)) : ymd(new Date()));
  // Letzter Tag eines mehrtaegigen Termins (Schulfahrt, Projektwoche). Leer =
  // eintaegig. Mehrtaegig ist immer ganztaegig — eine Uhrzeit gilt fuer einen
  // Tag, nicht fuer fuenf; deshalb blendet das gesetzte Enddatum die Zeitfelder
  // aus (und der Server leert sie ohnehin).
  const [endVal, setEndVal] = useState(entry.end_date ? ymd(new Date(entry.end_date)) : "");
  const mehrtaegig = !!endVal && endVal > dateVal;
  const [decks, setDecks] = useState([]); // Karten-Decks der gewaehlten Klasse
  // Decks haengen an der Klasse: neu laden, wenn Klasse wechselt und Modul aktiv.
  useEffect(() => {
    if (!aktiv.karten || !classId) { setDecks([]); return; }
    hol(`/api/karten/classes/${classId}/all-decks`).then((d) => setDecks(Array.isArray(d) ? d : []));
  }, [aktiv.karten, classId]);
  // Sofort beim Thema-Wählen das passende Deck + die passende Lernleiter
  // vorschlagen — nicht erst beim Speichern. Nur, wenn das Feld leer ist oder
  // noch den vorigen Auto-Wert traegt (manuelle Wahl bleibt unangetastet).
  const autoDeck = useRef(null);
  const autoLadder = useRef(null);
  const autoMethod = useRef(null);
  useEffect(() => {
    if (!topicId) return;
    const tid = Number(topicId);
    // Auto-Verknüpfung nur, wenn das jeweilige Modul aktiv ist.
    if (aktiv.karten) {
      const m = decks.find((d) => Number(d.topic_id) === tid);
      if (m && (!deckId || Number(deckId) === autoDeck.current)) { setDeckId(m.id); autoDeck.current = m.id; }
    }
    if (aktiv.lernpfad) {
      const m = ladders.find((l) => Number(l.topic_id) === tid);
      if (m && (!ladderId || Number(ladderId) === autoLadder.current)) { setLadderId(m.id); autoLadder.current = m.id; }
    }
    if (aktiv.unterrichtsplanung) {
      const m = methods.find((x) => Number(x.topic_id) === tid);
      if (m && (!methodId || Number(methodId) === autoMethod.current)) { setMethodId(m.id); autoMethod.current = m.id; }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicId, decks, ladders, methods, aktiv.karten, aktiv.lernpfad, aktiv.unterrichtsplanung]);
  // Dauer des verknüpften Einstiegs einmalig in den Verlaufsplan übernehmen.
  // Nur, wenn noch keine Einstieg-Phase existiert (überschreibt nichts Eigenes).
  const autoEinstieg = useRef(null);
  useEffect(() => {
    if (!methodId) return;
    const m = methods.find((x) => x.id === Number(methodId));
    if (!m || !m.dauer) return;
    if (autoEinstieg.current === m.id) return;
    autoEinstieg.current = m.id;
    setVerlauf((v) => (v.some((p) => (p.phase || "").trim().toLowerCase() === "einstieg")
      ? v
      : [{ phase: "Einstieg", dauer: String(m.dauer), text: m.title || "" }, ...v]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [methodId, methods]);
  const fld = { ...inputStyle, width: "100%" };
  const lbl = { fontSize: 12, color: "var(--text2)", margin: "12px 0 4px" };
  // Siehe core/topics.js — eine Quelle fuer Beschriftung UND Reihenfolge.
  const themen = themenIndex(topics);
  const topicLabel = (tp) => themen.label(tp);
  // Code-Detektiv ist ein Informatik-Werkzeug: die Rätsel-Auswahl nur zeigen, wenn
  // die gewählte Klasse eine Informatik-Stunde ist (bestehende Verknüpfung bleibt).
  const istInformatik = /informatik/i.test((classId && (classes.find((c) => c.id === Number(classId)) || {}).name) || "");
  // Bestehender Eintrag oeffnet zuerst als Ansicht; neuer direkt im Bearbeiten.
  const [edit, setEdit] = useState(!entry.id);
  // „Erweitert" startet offen, wenn dort schon etwas steht — sonst waere ein
  // gepflegter Eintrag beim naechsten Oeffnen zur Haelfte unsichtbar.
  const [erweitert, setErweitert] = useState(!!(entry.location || entry.rrule || entry.topic_id
    || entry.method_id || entry.cardvote_set_id || entry.karten_deck_id || entry.lernpfad_ladder_id
    || entry.codedetektiv_puzzle || (entry.verlaufsplan || []).length));
  // Nach dem Speichern (Parent setzt _justSaved) in die Ansicht wechseln, statt zu
  // schließen — so sieht man den gespeicherten Eintrag sofort.
  useEffect(() => { if (entry._justSaved) setEdit(false); }, [entry._justSaved]);
  // Anzeige denkt in Kursen: liegt ein Kurs am Eintrag, zeigen wir dessen Namen
  // (Fach), sonst die Fach-Klasse. So trägt auch der Klassenarbeit-Eintrag den Kurs.
  const clsName = (kursId && kursName(kursId)) || (classId && (classes.find((c) => c.id === Number(classId)) || {}).name);
  const topName = topicId && (() => { const tp = topics.find((x) => x.id === Number(topicId)); return tp ? topicLabel(tp) : ""; })();
  const methName = methodId && (methods.find((m) => m.id === Number(methodId)) || {}).title;
  const linkList = [
    quizId && (() => { const q = quizze.find((x) => x.id === Number(quizId)); return q && { to: `/cardvote/questions?set=${quizId}`, label: q.folder ? `${q.folder} / ${q.name}` : q.name, kind: t("kalender.planCardvote"), hideName: true }; })(),
    deckId && (() => { const d = decks.find((x) => x.id === Number(deckId)); return d && { to: `/karten?class=${d.class_id}${d.kurs_id ? `&kurs=${d.kurs_id}` : ""}&deck=${deckId}`, label: d.name, kind: t("kalender.planKarten"), hideName: true }; })(),
    ladderId && (() => { const l = ladders.find((x) => x.id === Number(ladderId)); return l && { to: `/lernpfad?ll=${ladderId}`, label: (topicName(l.topic_id) || l.path || t("kalender.planLernleiter")), kind: t("kalender.planLernleiter"), hideName: true }; })(),
    puzzleId && (() => { const p = puzzles.find((x) => x.client_id === puzzleId); return { to: `/code-detektiv/puzzle/${puzzleId}?mode=solo`, label: (p && p.title) || puzzleId, kind: t("kalender.planDetektiv") }; })(),
    methodId && methName && { to: `/unterrichtsplanung?tab=einstiege&open=${methodId}`, label: methName, kind: t("kalender.method"), hideName: true },
  ].filter(Boolean);
  const zeile = (k, v) => v ? <div style={{ display: "flex", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 14 }}><span style={{ color: "var(--text3)", minWidth: 92 }}>{k}</span><span style={{ fontWeight: 500 }}>{v}</span></div> : null;
  return (
    <Modal onClose={onClose} width={460} style={{ padding: 0 }} label={!edit ? (title || clsName || t("kalender.entry")) : ((entry.id || entry.period != null) ? t("kalender.editEntry") : t("kalender.newEntry"))}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 5 }}>{!edit ? (title || clsName || t("kalender.entry")) : ((entry.id || entry.period != null) ? t("kalender.editEntry") : t("kalender.newEntry"))}</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {entry.period != null && <span style={{ ...chipStyle, fontWeight: 700, background: "var(--accent)", color: C.aufAkzent }}>{entry.period}. {t("kalender.period")}</span>}
              <span style={{ fontSize: 12, color: "var(--text3)" }}>{new Date(entry.date).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
            </div>
          </div>
          <button onClick={onClose} className="icon-btn" style={{ ...iconBtn, padding: 6 }} title={t("common.close")} aria-label={t("common.close")}><Icon d={ICONS.close} size={18} /></button>
        </div>
        <div style={{ padding: "6px 24px 22px" }}>
        {!edit && (
          <div>
            {(clsName || topName || zeitText || ort || entry.rrule) && (
              <div style={{ marginTop: 4 }}>
                {clsName && (
                  <div style={{ display: "flex", gap: 8, fontSize: 14, padding: "3px 0" }}>
                    {/* Steht dort ein Kurs (Fach), heißt die Zeile auch so — und
                        der Link führt in den Kurs, nicht in die Klasse. */}
                    <span style={{ color: "var(--text3)", minWidth: 90 }}>{kursId ? t("kurse.one") : t("nav.classes")}</span>
                    <Link to={kursId ? "/kurse" : `/classes?open=${classId}`} onClick={onClose}
                      style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>{clsName} ↗</Link>
                  </div>
                )}
                {zeile(t("kalender.topic"), topName)}
                {/* Einstieg (Methode) steht jetzt als anklickbarer Link unter „Öffnen". */}
                {zeile(t("kalender.time"), zeitText)}
                {zeile(t("kalender.place"), ort)}
                {zeile(t("kalender.repeat"), rrText)}
              </div>
            )}
            {aktiv.orga && classId && (
              <Link to={`/orga?tab=anwesenheit&class=${classId}&date=${ymd(new Date(entry.date))}`} onClick={onClose}
                style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: CONTROL_R, border: "1px solid var(--border2)", background: "var(--bg)", textDecoration: "none", color: "var(--accent)", fontSize: 14, fontWeight: 600 }}>
                <Icon d={ICONS.open} size={15} color="var(--accent)" />
                {t("kalender.toAttendance")}
              </Link>
            )}
            {/* Klassenarbeitstermin: die Auswertung dazu ist ein Klick entfernt
                (nur bei aktivem Modul — Regel 3). */}
            {aktiv.auswertung && entry.work_id && classId && (
              <Link to={`/auswertung?tab=klassenarbeit&class=${classId}${kursId ? `&kurs=${kursId}` : ""}&work=${entry.work_id}`} onClick={onClose}
                style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: CONTROL_R, border: "1px solid var(--border2)", background: "var(--bg)", textDecoration: "none", color: "var(--accent)", fontSize: 14, fontWeight: 600 }}>
                <Icon d={ICONS.chart} size={15} color="var(--accent)" />
                {t("kalender.openExamWork")}
              </Link>
            )}
            {/* Was für einzelne Kinder in Arbeiten abweicht (Zeitzuschlag,
                abweichende Lernziele …) — beim Aufschlagen des Termins sichtbar. */}
            {entry.exam_id && classId && <ExamMassnahmen classId={Number(classId)} kursId={kursId ?? null} t={t} />}
            {aktiv.cardvote && aktiv.auswertung && entry.cardvote_set_id && classId && (
              <button onClick={alsNote}
                style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: CONTROL_R, border: "1px solid var(--border2)", background: "var(--bg)", cursor: "pointer", color: "var(--accent)", fontSize: 14, fontWeight: 600, width: "100%" }}>
                <Icon d={ICONS.chart} size={15} color="var(--accent)" />
                {t("kalender.resultAsGrade")}
              </button>
            )}
            {linkList.length > 0 && (
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={lbl}>{t("kalender.openLinked")}</div>
                {linkList.map((lk) => (
                  <Link key={lk.to} to={lk.to} onClick={onClose}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: CONTROL_R, border: "1px solid var(--border2)", background: "var(--bg)", textDecoration: "none", color: "var(--accent)", fontSize: 14 }}>
                    <Icon d={ICONS.open} size={15} color="var(--accent)" />
                    <span style={{ fontWeight: 600, fontSize: lk.hideName ? 13.5 : 11.5, color: lk.hideName ? "var(--accent)" : "var(--text3)" }}>{lk.kind}</span>
                    {!lk.hideName && <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lk.label}</span>}
                  </Link>
                ))}
              </div>
            )}
            {notes && <div style={{ marginTop: 16, fontSize: 14, whiteSpace: "pre-wrap", color: "var(--text2)" }}>{notes}</div>}
            {verlauf.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ ...sectionLabel, marginBottom: 8 }}>{t("kalender.verlauf")}</div>
                {verlauf.map((p, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, padding: "8px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
                    <div style={{ minWidth: 120, flexShrink: 0, display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{p.phase || "—"}</span>
                      {p.dauer && <span style={{ fontSize: 12, color: "var(--text3)", whiteSpace: "nowrap" }}>{p.dauer} min</span>}
                    </div>
                    <div style={{ flex: 1, fontSize: 14, color: "var(--text2)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{p.text}</div>
                  </div>
                ))}
              </div>
            )}
            {!clsName && !topName && !methName && !linkList.length && !notes && !verlauf.length && <p style={{ fontSize: 14, color: "var(--text3)", marginTop: 8 }}>{t("kalender.emptyEntry")}</p>}
            {/* Material an dieser Stunde — nur beim gespeicherten Eintrag. */}
            {entry.id && <div style={{ marginTop: 16 }}><MaterialPanel entryId={entry.id} /></div>}
            <div style={{ display: "flex", gap: 8, marginTop: 24, alignItems: "center" }}>
              <button onClick={() => setEdit(true)} style={btnPrimary}>{t("common.edit")}</button>
              <button onClick={onClose} style={btnSecondary}>{t("common.close")}</button>
              {entry.id && <button onClick={() => onDelete(entry.id, entry)} className="icon-btn" style={{ ...iconBtn, marginLeft: "auto" }} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={18} color={C.danger} /></button>}
            </div>
          </div>
        )}
        {edit && (<>
        {entry.period == null && (<>
          <div style={lbl}>{t("kalender.extDate")}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="date" value={dateVal} onChange={(e) => { const d = parseYmd(e.target.value); if (d) setDateVal(ymd(d)); }} style={{ ...fld, width: "auto" }} />
            <span style={{ color: "var(--text3)" }}>–</span>
            {/* „bis" leer heisst eintaegig — das ist der Normalfall und braucht
                keinen zweiten Schalter „geht ueber mehrere Tage". */}
            <input type="date" value={endVal} min={dateVal} onChange={(e) => { const d = parseYmd(e.target.value); setEndVal(d ? ymd(d) : ""); }}
              style={{ ...fld, width: "auto" }} title={t("kalender.entryEndDate")} />
            {endVal && <button onClick={() => setEndVal("")} className="icon-btn" style={{ ...iconBtn, padding: 6 }} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.close} size={15} /></button>}
          </div>
        </>)}
        <div style={lbl}>{t("kalender.entryTitle")}</div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder={t("kalender.entryTitlePlaceholder")} style={fld} />
        {/* Auch bei einer Stundenplan-Stunde: morgen faengt der Unterricht
            einmalig frueher an, und dafuer den ganzen Stundenplan zu aendern
            waere die falsche Ebene. Leer heisst „die Zeit der Stunde"; der
            Knopf setzt genau darauf zurueck. */}
        {mehrtaegig ? (
          <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 8 }}>{t("kalender.multiDayHint")}</div>
        ) : (<>
        <div style={lbl}>{t("kalender.entryTime")}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={{ ...fld, width: "auto" }} title={t("kalender.start")} />
          <span style={{ color: "var(--text3)" }}>–</span>
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={{ ...fld, width: "auto" }} title={t("kalender.end")} />
          {(startTime || endTime) && <button onClick={() => { setStartTime(""); setEndTime(""); }} className="icon-btn" style={{ ...iconBtn, padding: 6 }} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.close} size={15} /></button>}
        </div>
        {entry.period != null && !startTime && !endTime && (stundeVon || stundeBis) && (
          <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>
            {t("kalender.timeFromPeriod", { von: stundeVon || "?", bis: stundeBis || "?" })}
          </div>
        )}
        {timeInvalid && <div style={{ fontSize: 12, color: C.danger, marginTop: 5 }}>{t("kalender.timeInvalid")}</div>}
        </>)}
        <div style={lbl}>{t("kalender.kursOrClass")}</div>
        <KursKlasseSelect value={classId === "" ? "" : Number(classId)} kursValue={kursId} allowNone noneLabel={`– ${t("kalender.noClass")} –`}
          onChange={(id, kid) => { setClassId(id === "" ? "" : String(id)); setKursId(id === "" ? null : (kid ?? null)); }} onKurs={setKursId} style={dialogSelect} />
        {/* Der Raum steht bei einer Unterrichtsstunde oben und nicht unter
            „Erweitert": „heute in B204" ist der haeufigste Handgriff am
            fertigen Stundenplan-Eintrag. Bei allen anderen Terminen bleibt er
            unten — dort ist er die Ausnahme. */}
        {entry.period != null && (<>
          <div style={lbl}>{t("kalender.place")}</div>
          <input value={ort} onChange={(e) => setOrt(e.target.value)} placeholder={t("kalender.placePlaceholder")} style={fld} />
        </>)}
        <div style={lbl}>{t("kalender.notes")}</div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ ...fld, resize: "vertical" }} />

        {/* Alles Weitere liegt unter „Erweitert". Der Dialog hatte vierzehn
            Felder untereinander — die vier, die man bei einem normalen Termin
            wirklich braucht, gingen darin unter. Aufgeklappt startet er nur,
            wenn dort schon etwas steht: sonst waere ein gepflegter Eintrag beim
            naechsten Oeffnen halb unsichtbar. */}
        <button onClick={() => setErweitert((v) => !v)}
          style={{ ...btnSecondary, width: "100%", marginTop: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          {t("kalender.more")} <Icon d={erweitert ? ICONS.chevronUp : ICONS.chevronDown} size={12} />
        </button>
        {erweitert && (<>
        {entry.period == null && (<>
          <div style={lbl}>{t("kalender.place")}</div>
          <input value={ort} onChange={(e) => setOrt(e.target.value)} placeholder={t("kalender.placePlaceholder")} style={fld} />
        </>)}
        {entry.period == null && (<>
          <div style={lbl}>{t("kalender.repeat")}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <select value={rhythmus} onChange={(e) => setRhythmus(e.target.value)} style={{ ...dialogSelect, width: "auto", flex: 1, minWidth: 150 }}>
              <option value="">{t("kalender.repeatNone")}</option>
              <option value="DAILY">{t("kalender.repeatDaily")}</option>
              <option value="WEEKLY">{t("kalender.repeatWeekly")}</option>
              <option value="WEEKLY:2">{t("kalender.repeatWeekly2")}</option>
              <option value="MONTHLY">{t("kalender.repeatMonthly")}</option>
              <option value="YEARLY">{t("kalender.repeatYearly")}</option>
            </select>
            {rhythmus && (<>
              <span style={{ fontSize: 12, color: "var(--text3)" }}>{t("kalender.repeatUntil")}</span>
              <input type="date" value={rrBis} onChange={(e) => setRrBis(e.target.value)} style={{ ...fld, width: "auto" }} />
            </>)}
          </div>
        </>)}
        <div style={lbl}>{t("kalender.topic")}</div>
        <select value={topicId} onChange={(e) => setTopicId(e.target.value)} style={dialogSelect}>
          <option value="">– {t("kalender.noTopic")} –</option>
          {themen.geordnet.map((tp) => <option key={tp.id} value={tp.id}>{topicLabel(tp)}</option>)}
        </select>
        {aktiv.unterrichtsplanung && (
          <>
            <div style={lbl}>{t("kalender.method")}</div>
            <select value={methodId} onChange={(e) => setMethodId(e.target.value)} style={dialogSelect}>
              <option value="">– {t("kalender.noMethod")} –</option>
              {[...methods].sort(byLabel((m) => m.title)).map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
            </select>
          </>
        )}
        {(aktiv.cardvote || aktiv.karten || aktiv.lernpfad) && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 0 2px" }}>
            <span style={sectionLabel}>{t("kalender.planning")}</span>
            <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
          </div>
        )}
        {aktiv.cardvote && (
          <>
            <div style={lbl}>{t("kalender.planCardvote")}</div>
            <select value={quizId} onChange={(e) => setQuizId(e.target.value)} style={dialogSelect}>
              <option value="">– {t("kalender.none")} –</option>
              {[...quizze].sort(byLabel((q) => q.folder ? `${q.folder} / ${q.name}` : q.name)).map((q) => <option key={q.id} value={q.id}>{q.folder ? `${q.folder} / ${q.name}` : q.name}</option>)}
            </select>
          </>
        )}
        {aktiv.karten && (
          <>
            <div style={lbl}>{t("kalender.planKarten")}</div>
            <select value={deckId} onChange={(e) => setDeckId(e.target.value)} style={dialogSelect} disabled={!classId} title={!classId ? t("kalender.pickClassFirst") : undefined}>
              <option value="">– {t("kalender.none")} –</option>
              {[...decks].sort(byLabel((d) => d.name)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            {deckId && <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>{t("kalender.deckReleaseHint")}</div>}
          </>
        )}
        {aktiv.lernpfad && (
          <>
            <div style={lbl}>{t("kalender.planLernleiter")}</div>
            <select value={ladderId} onChange={(e) => setLadderId(e.target.value)} style={dialogSelect}>
              <option value="">– {t("kalender.none")} –</option>
              {[...ladders].sort(byLabel((l) => topicName(l.topic_id) || l.path || "")).map((l) => <option key={l.id} value={l.id}>{(topicName(l.topic_id) || l.path || t("kalender.planLernleiter"))}</option>)}
            </select>
          </>
        )}
        {aktiv["code-detektiv"] && (istInformatik || puzzleId) && (
          <>
            <div style={lbl}>{t("kalender.planDetektiv")}</div>
            <select value={puzzleId} onChange={(e) => setPuzzleId(e.target.value)} style={dialogSelect}>
              <option value="">– {t("kalender.none")} –</option>
              {[...puzzles].sort(byLabel((p) => p.title || p.client_id)).map((p) => <option key={p.client_id} value={p.client_id}>{p.title || p.client_id}</option>)}
            </select>
          </>
        )}
        {(() => {
          // Verknüpfte Objekte als klickbare Links (öffnet das Modul). Nur was
          // gewählt und dessen Modul aktiv ist — Name aus den geladenen Listen.
          const q = quizId && quizze.find((x) => x.id === Number(quizId));
          const d = deckId && decks.find((x) => x.id === Number(deckId));
          const l = ladderId && ladders.find((x) => x.id === Number(ladderId));
          const links = [
            q && { to: "/cardvote/questions", label: q.folder ? `${q.folder} / ${q.name}` : q.name, icon: t("kalender.planCardvote") },
            d && { to: `/karten?class=${classId}`, label: d.name, icon: t("kalender.planKarten") },
            l && { to: "/lernpfad", label: (topicName(l.topic_id) || l.path || t("kalender.planLernleiter")), icon: t("kalender.planLernleiter") },
          ].filter(Boolean);
          if (!links.length) return null;
          return (
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={lbl}>{t("kalender.openLinked")}</div>
              {links.map((lk) => (
                <Link key={lk.to} to={lk.to} onClick={onClose}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: CONTROL_R, border: "1px solid var(--border2)", background: "var(--bg)", textDecoration: "none", color: "var(--accent)", fontSize: 14 }}>
                  <Icon d={ICONS.open} size={15} color="var(--accent)" />
                  <span style={{ color: "var(--text3)", fontSize: 12 }}>{lk.icon}</span>
                  <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lk.label}</span>
                </Link>
              ))}
            </div>
          );
        })()}
        {/* Verlaufsplan: einfache Phasenliste (Phase + Dauer + Freitext). */}
        <div style={{ ...lbl, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ flex: 1 }}>{t("kalender.verlauf")}</span>
          <button onClick={addPhase} className="icon-btn" style={{ ...iconBtn, padding: 3 }} title={t("kalender.verlaufAdd")} aria-label={t("kalender.verlaufAdd")}><Icon d={ICONS.plus} size={15} color="var(--accent)" /></button>
        </div>
        {verlauf.length === 0 && <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 4 }}>{t("kalender.verlaufEmpty")}</div>}
        {verlauf.map((p, i) => (
          <div key={i} style={{ ...panelStyle, padding: 8, marginBottom: 8, background: "var(--bg)" }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
              <input value={p.phase} onChange={(e) => setPhase(i, "phase", e.target.value)} placeholder={t("kalender.verlaufPhase")} style={{ ...fld, flex: 1, padding: 8 }} />
              <input type="number" min="0" value={p.dauer} onChange={(e) => setPhase(i, "dauer", e.target.value)} placeholder={t("kalender.verlaufDauer")} style={{ ...fld, width: 56, padding: 8 }} />
              <span style={{ fontSize: 12, color: "var(--text3)", flexShrink: 0 }}>min</span>
              <button onClick={() => movePhase(i, -1)} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title="↑" disabled={i === 0}><Icon d={ICONS.arrowUp} size={14} color={i === 0 ? "var(--text3)" : "var(--text2)"} /></button>
              <button onClick={() => movePhase(i, 1)} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title="↓" disabled={i === verlauf.length - 1}><Icon d={ICONS.arrowDown} size={14} color={i === verlauf.length - 1 ? "var(--text3)" : "var(--text2)"} /></button>
              <button onClick={() => delPhase(i)} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={14} color={C.danger} /></button>
            </div>
            <textarea value={p.text} onChange={(e) => setPhase(i, "text", e.target.value)} rows={2} placeholder={t("kalender.verlaufText")} style={{ ...fld, resize: "vertical", padding: 8 }} />
          </div>
        ))}

        </>)}
        <DialogFuss onAbbrechen={onClose} aus={timeInvalid} onSpeichern={() => onSave({ ...entry, date: entry.period == null ? (() => { const [y, m, d] = dateVal.split("-").map(Number); return new Date(y, m - 1, d, 12, 0, 0); })() : entry.date, end_date: mehrtaegig ? (() => { const [y, m, d] = endVal.split("-").map(Number); return new Date(y, m - 1, d, 12, 0, 0); })() : null, title, notes, start_time: mehrtaegig ? "" : (startTime || ""), end_time: mehrtaegig ? "" : (endTime || ""), location: ort, rrule: rruleBauen(), exdate: Array.isArray(entry.exdate) ? entry.exdate : [], verlaufsplan: verlauf.filter((p) => (p.phase || p.text || p.dauer)).map((p) => ({ phase: p.phase || "", dauer: p.dauer || "", text: p.text || "" })), class_id: classId ? Number(classId) : null, kurs_id: classId ? (kursId ?? null) : null, topic_id: topicId ? Number(topicId) : null, method_id: methodId ? Number(methodId) : null, cardvote_set_id: quizId ? Number(quizId) : null, karten_deck_id: deckId ? Number(deckId) : null, lernpfad_ladder_id: ladderId ? Number(ladderId) : null, codedetektiv_puzzle: puzzleId || null })}>
          {entry.id && <button onClick={() => onDelete(entry.id, entry)} className="icon-btn" style={{ ...iconBtn, marginLeft: "auto" }} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={18} color={C.danger} /></button>}
        </DialogFuss>
        </>)}
        </div>
    </Modal>
  );
}
