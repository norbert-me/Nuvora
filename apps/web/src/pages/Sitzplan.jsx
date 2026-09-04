// Modul Sitzplan — freie Fläche statt Raster. Tische frei platzieren und
// drehen (z.B. schräge Tische). Gespeichert wird { seats: [{sid,x,y,rot}] }.
// Schüler bleiben im Kern; hier nur ihre Positionen (Regel 3).
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { cardStyle, chipStyle, panelStyle, sectionLabel, Segment, segmentBtn, toolbarBtn, Icon, ICONS, toolbarIconBtn, CONTROL_R, SHADOW, dateiWaehlen, COLORS as C, Empty } from "../components/Icons.jsx";
import KursKlasseSelect from "../components/KursKlasseSelect.jsx";
import { useEntwurf } from "../components/Speichern.jsx";
import SpeicherBalken from "../components/SpeicherBalken.jsx";
import ViewMenu from "../components/ViewMenu.jsx";
import Portrait from "../components/Portrait.jsx";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { useModulOption } from "../core/modules.js";
import { useKlasseMerken, useKlassenListe, useUrlClass } from "../core/klassenwahl.js";
import { alsJson, hol } from "../core/melden.js";

const API = "/api/sitzplan";
const SEAT_W = 108, SEAT_H = 46;
// SEGEL-Stufen (Helios-Konzept): Boot vom Hafen bis in die Welt, zunehmende
// Selbststeuerung. Reihenfolge = Klick-Kreislauf am Platz (leer → … → leer).
const SEGEL = [
  { key: "hafen", label: "Hafen", ab: "H", color: C.danger },
  // Fester Wert: die Stufenfarben sind eine Skala (rot → grün) wie
  // REIFE_COLORS; für die Zwischenstufe gibt es keine Token-Farbe.
  { key: "kueste", label: "Küste", ab: "K", color: "#c026a3" },
  { key: "meer", label: "Meer", ab: "M", color: C.info },
  { key: "welt", label: "Welt", ab: "W", color: C.success },
];
const SEGEL_CYCLE = ["", "hafen", "kueste", "meer", "welt"];

// ── Hervorheben ──
// Am Beamer und im Gedraenge zwischen den Tischen sucht niemand eine Liste ab.
// Wer gerade gemeint ist — die E-Gruppe, alle mit LRS, die drei fuer die
// naechste Aufgabe — soll auf einen Blick zu sehen sein. Drei Arten, dieselbe
// Anzeige: farbiger Balken am Platz plus getoenter Hintergrund.
//
// Die Palette ist dieselbe wie die der Klassenfarben im Kern (_CLASS_COLORS in
// classes.py): in Hell und Dunkel lesbar und untereinander unterscheidbar.
const HERVOR_FARBEN = ["#2563eb", "#0a7d3e", "#8a6100", "#7c3aed", "#d1350f", "#0891b2", "#db2777", "#65a30d"];
// Freie Markierung: vier Farben reichen fuer „diese Gruppe, jene Gruppe" — bei
// acht faengt das Raten an, welche Farbe wofuer stand.
const MARK_CYCLE = [0, 1, 2, 3];
// E und G bekommen feste Plaetze der Palette, damit sie in jeder Klasse
// dieselbe Farbe haben — sonst haengt sie daran, wer zufaellig zuerst kommt.
const NIVEAU_FARBE = { E: HERVOR_FARBEN[3], G: HERVOR_FARBEN[0] };

// Die Zoom-Leiste sitzt direkt an der Flaeche und darf niedriger sein als die
// Haupt-Werkzeugleiste (28 statt CONTROL_H) — aber sie ist EINE Gruppe: ein
// Rahmen aussen, duenne Trenner innen. Vorher waren es fuenf freistehende
// Kaesten fuer eine einzige Frage („wie gross?").
const ZOOM_H = 28;
const zoomBtnStyle = { ...segmentBtn, padding: "0 10px", color: "var(--text2)" };

export default function Sitzplan() {
  const { t } = useLanguage();
  // SEGEL laesst sich am Modul Orga abschalten (Modulseite → „Teile"). Nicht
  // jede Schule kennt das Konzept; wer es nicht nutzt, hat sonst einen
  // Schalter und ein Kuerzel am Platz, die ihm nichts sagen. Eingetragene
  // Stufen bleiben dabei erhalten — abgeschaltet ist die ANZEIGE.
  const segelTeil = useModulOption("orga", "segel");
  // Anwesenheit lebt im Modul „Orga" (Aufruf-Ansicht nutzt sie).
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState(null);
  const [kursId, setKursId] = useState(null); // Sitzplan hängt am Kurs (Fach)
  // Aus dem Kurs verlinkt (?class=&kurs=): dann diesen Inhalt zeigen.
  useUrlClass(setClassId, setKursId);
  // Serverstand (Basis) und Arbeitskopie sind getrennt: gezogen, gedreht und
  // gelöscht wird im Entwurf, geschrieben erst mit „Speichern".
  const [gSeats, setGSeats] = useState([]); // [{sid,x,y,rot}] — sid=String mit empty:true = leerer Platz
  // Rückgängig: vor jeder Geste (Ziehen, Drehen, Löschen, Anordnen, Import,
  // Leeren, leerer Platz) den Stand sichern; Undo stellt ihn wieder her.
  const undoStack = useRef([]);
  const [undoLen, setUndoLen] = useState(0);
  const redoStack = useRef([]);
  const [redoLen, setRedoLen] = useState(0);
  const [gTafel, setGTafel] = useState({ x: 200, y: 8 }); // bewegliche Tafel
  const tafelRef = useRef(null);
  const [zoom, setZoom] = useState(1); // Anzeige-Zoom (Positionen bleiben unskaliert gespeichert)
  const [msg, setMsg] = useState("");
  const [segelOn, setSegelOn] = useState(false);   // Voreinstellung pro Kurs (siehe unten)
  const [gSegel, setGSegel] = useState({}); // student_id → Stufe
  const [fotosOn, setFotosOn] = useState(true);     // Gesichter am Platz (an)
  // Hervorheben: "" | "niveau" | "foerder" | "mark" — und bei "foerder",
  // welcher Schwerpunkt ("" = jeder bekommt seine eigene Farbe).
  const [hervor, setHervor] = useState("");
  const [foerderArt, setFoerderArt] = useState("");
  // Freie Markierung: student_id → Farbnummer. Bewusst NUR im Browser und nur
  // fuer diesen Kurs: das ist eine Notiz fuer die naechste halbe Stunde
  // („diese vier an die Fensterreihe"), kein Merkmal des Kindes. Nichts davon
  // geht zum Server, nichts in den Export.
  const [marken, setMarken] = useState({});
  const canvasRef = useRef(null);
  const dragRef = useRef(null); // { sid, dx, dy } aktives Ziehen

  const [kurse, setKurse] = useState([]);
  useEffect(() => {
    hol("/api/kurse").then((d) => setKurse(Array.isArray(d) ? d : []));
  }, []);
  // Klassenliste, Vorwahl und „zuletzt gewaehlt" — dieselben sechs Zeilen
  // standen auf fuenf Seiten; sie liegen jetzt in core/klassenwahl.js.
  useKlassenListe(setClasses, setClassId);
  useKlasseMerken(classId);

  const cls = useMemo(() => classes.find((c) => c.id === classId), [classes, classId]);
  // Sitzplan gilt kursweit: Roster = kanonische SuS des Kurses (gleichnamige
  // Fach-Klassen-SuS = eine Person), damit die gespeicherten Sitz-IDs passen.
  const students = useMemo(() => {
    if (!cls) return [];
    const kurs = kurse.find((k) => (k.classes || []).some((c) => c.id === cls.id));
    const sib = kurs ? new Set(kurs.classes.map((c) => c.id)) : new Set([cls.id]);
    const all = classes.filter((c) => sib.has(c.id)).flatMap((c) => c.students || []);
    const canon = {};
    all.forEach((s) => { const n = s.name.trim(); if (!(n in canon)) canon[n] = s; });
    // Nach position, nicht nach card_id: die Kartennummer steht auf dem
    // gedruckten ArUco-Bogen und aendert sich nie — die Reihenfolge der Klasse
    // schon. Sonst stuende die Namensliste hier anders als unter /classes.
    return Object.values(canon).sort((a, b) => (a.position || 0) - (b.position || 0) || a.card_id - b.card_id || a.id - b.id);
  }, [cls, classes, kurse]);
  const byId = (id) => students.find((s) => s.id === id);

  // Welche Foerderschwerpunkte kommen in diesem Kurs ueberhaupt vor? Nur die
  // stehen zur Wahl — eine Liste aller zwoelf waere zu elf Dritteln leer.
  const vorhandeneFoerder = useMemo(() => {
    const set = new Set();
    students.forEach((st) => (st.foerder || []).forEach((f) => set.add(f)));
    return [...set].sort();
  }, [students]);

  // Farbe eines Platzes — eine Stelle fuer alle drei Arten, damit Legende und
  // Platz nie auseinanderlaufen.
  const farbeFuer = (st) => {
    if (!st) return null;
    if (hervor === "mark") {
      const i = marken[String(st.id)];
      return i == null ? null : HERVOR_FARBEN[i];
    }
    if (hervor === "niveau") return NIVEAU_FARBE[st.niveau] || null;
    if (hervor === "foerder") {
      const eigene = st.foerder || [];
      if (!eigene.length) return null;
      // Ein bestimmter Schwerpunkt gewaehlt: nur der zaehlt (alle anderen
      // bleiben unmarkiert — sonst ist die halbe Klasse bunt und nichts faellt
      // mehr auf). Ohne Wahl: jeder Schwerpunkt seine eigene Farbe.
      if (foerderArt) return eigene.includes(foerderArt) ? HERVOR_FARBEN[vorhandeneFoerder.indexOf(foerderArt) % HERVOR_FARBEN.length] : null;
      return HERVOR_FARBEN[vorhandeneFoerder.indexOf(eigene[0]) % HERVOR_FARBEN.length];
    }
    return null;
  };

  // Legende: ohne sie ist ein farbiger Balken nur Dekoration. Zeigt genau die
  // Gruppen, die gerade vorkommen.
  const legende = useMemo(() => {
    if (hervor === "niveau") {
      return ["E", "G"].filter((n) => students.some((st) => st.niveau === n))
        .map((n) => ({ farbe: NIVEAU_FARBE[n], text: n }));
    }
    if (hervor === "foerder") {
      const arten = foerderArt ? [foerderArt] : vorhandeneFoerder;
      return arten.map((f) => ({ farbe: HERVOR_FARBEN[vorhandeneFoerder.indexOf(f) % HERVOR_FARBEN.length], text: f }));
    }
    if (hervor === "mark") {
      const benutzt = [...new Set(Object.values(marken))].sort();
      return benutzt.map((i) => ({ farbe: HERVOR_FARBEN[i], text: `${t("sitzplan.markGroup")} ${i + 1}` }));
    }
    return [];
  }, [hervor, foerderArt, students, vorhandeneFoerder, marken, t]);

  const kursQ = kursId != null ? `?kurs_id=${kursId}` : "";
  // Laufende Nummer je Ladevorgang. KursKlasseSelect meldet den Kurs bewusst
  // erst NACH dem Laden der Kursgruppen — der Effekt feuert also immer zweimal:
  // erst ohne Kurs, dann mit. Kommt die erste (klassenweite) Antwort als zweite
  // an, steht hier der falsche Sitzplan, und der naechste Zug schreibt ihn per
  // persist() auf den Kurs zurueck. Das ist kein Anzeigefehler, das ueberschreibt
  // einen echten Sitzplan. Nur die juengste Antwort darf also schreiben.
  const ladenr = useRef(0);
  // Frische Serverdaten (anderer Kurs) beenden den Entwurf.
  const frisch = useRef(false);
  const load = useCallback((id) => {
    if (!id) return;
    const meine = ++ladenr.current;
    hol(`${API}/${id}${kursId != null ? `?kurs_id=${kursId}` : ""}`, null).then((d) => {
      if (meine !== ladenr.current) return;
      frisch.current = true;
      if (!d) { setGSeats([]); return; }
      setGTafel(d.tafel && typeof d.tafel.x === "number" ? d.tafel : { x: 200, y: 8 });
      // Altes Raster (cells) einmalig in freie Positionen umrechnen.
      if (Array.isArray(d.seats)) { setGSeats(d.seats); return; }
      if (Array.isArray(d.cells)) {
        const cols = d.cols || 6;
        const migr = [];
        d.cells.forEach((sid, i) => { if (sid != null) migr.push({ sid, x: 20 + (i % cols) * (SEAT_W + 14), y: 20 + Math.floor(i / cols) * (SEAT_H + 18), rot: 0 }); });
        setGSeats(migr);
      } else setGSeats([]);
    });
  }, [kursId]);
  useEffect(() => { load(classId); }, [classId, kursId, load]);

  // ── Ein Entwurf für den ganzen Plan ──
  // Plätze, Tafel und SEGEL-Stufen liegen in EINER Arbeitskopie mit EINER
  // Leiste: es ist ein Bild, nicht dreißig Einzelentscheidungen. Nichts davon
  // geht zum Server, bevor jemand speichert.
  const basis = useMemo(() => ({ seats: gSeats, tafel: gTafel, segel: gSegel }), [gSeats, gTafel, gSegel]);
  const e = useEntwurf(basis, async (wert) => {
    if (!classId) return false;
    const r = await fetch(`${API}/${classId}${kursQ}`, alsJson("PUT", { seats: wert.seats, tafel: wert.tafel })).catch(() => null);
    if (!r || !r.ok) { setMsg(t("common.notWork")); return false; }
    // SEGEL hängt an einem eigenen Endpunkt (je Kind eine Stufe) — nur die
    // geänderten schreiben.
    const keys = new Set([...Object.keys(gSegel), ...Object.keys(wert.segel)]);
    for (const k of keys) {
      if ((gSegel[k] || "") === (wert.segel[k] || "")) continue;
      await fetch(`${API}/${classId}/segel${kursQ}`, alsJson("PUT", { student_id: Number(k), stage: wert.segel[k] || "" })).catch(() => {});
    }
    setGSeats(wert.seats); setGTafel(wert.tafel); setGSegel(wert.segel);
    return true;
  });
  useEffect(() => { if (frisch.current) { frisch.current = false; e.verwerfen(); } });
  const seats = e.wert.seats;
  const tafel = e.wert.tafel;
  const segel = e.wert.segel;
  const setSeats = (fn) => e.setz((v) => ({ seats: typeof fn === "function" ? fn(v.seats) : fn }));
  const setTafel = (fn) => e.setz((v) => ({ tafel: typeof fn === "function" ? fn(v.tafel) : fn }));
  // Kurswechsel mit offenem Plan: nachfragen statt still verwerfen.
  const wechseln = (fn) => { if (e.geaendert && !window.confirm(t("speichern.verlassen"))) return; fn(); };

  // SEGEL-Stufen je SuS laden (pro Kurs). Toggle in localStorage merken.
  useEffect(() => {
    if (!classId) { setGSegel({}); return; }
    hol(`${API}/${classId}/segel${kursQ}`, {}).then((d) => { frisch.current = true; setGSegel(d || {}); });
  }, [classId, kursId]);
  // „Ansicht"-Voreinstellung PRO KURS (Fallback Klasse): welche Zusatz-Anzeigen
  // an sind. Beim Kurswechsel neu laden — so merkt sich jeder Kurs seine Ansicht.
  const viewKey = classId ? (kursId != null ? `k${kursId}` : `c${classId}`) : null;
  useEffect(() => {
    if (!viewKey) return;
    try {
      const v = JSON.parse(localStorage.getItem(`sitzplan_view_${viewKey}`) || "{}");
      setSegelOn(!!v.segel);
      setHervor(v.hervor || ""); setFoerderArt(v.foerderArt || "");
    } catch { setSegelOn(false); setHervor(""); setFoerderArt(""); }
    // Markierungen haengen am selben Kurs wie die Ansicht.
    try { setMarken(JSON.parse(localStorage.getItem(`sitzplan_mark_${viewKey}`) || "{}")); }
    catch { setMarken({}); }
  }, [viewKey]);

  // Markierung weiterschalten: leer → Farbe 1 … → leer. Wie der SEGEL-Kreislauf,
  // damit derselbe Handgriff dasselbe tut.
  const markSchalten = (sid) => {
    const key = String(sid);
    setMarken((prev) => {
      const cur = prev[key];
      const i = cur == null ? 0 : MARK_CYCLE.indexOf(cur) + 1;
      const naechste = { ...prev };
      if (i >= MARK_CYCLE.length) delete naechste[key];
      else naechste[key] = MARK_CYCLE[i];
      if (viewKey) { try { localStorage.setItem(`sitzplan_mark_${viewKey}`, JSON.stringify(naechste)); } catch { /* egal */ } }
      return naechste;
    });
  };
  const markenLeeren = () => {
    setMarken({});
    if (viewKey) { try { localStorage.removeItem(`sitzplan_mark_${viewKey}`); } catch { /* egal */ } }
  };
  const saveView = (patch) => {
    if (!viewKey) return;
    try { const cur = JSON.parse(localStorage.getItem(`sitzplan_view_${viewKey}`) || "{}"); localStorage.setItem(`sitzplan_view_${viewKey}`, JSON.stringify({ ...cur, ...patch })); } catch {}
  };
  const setStage = (sid, stage) => e.setz((v) => {
    const n = { ...v.segel };
    if (stage) n[String(sid)] = stage; else delete n[String(sid)];
    return { segel: n };
  });
  const cycleStage = (sid) => {
    const cur = segel[String(sid)] || "";
    setStage(sid, SEGEL_CYCLE[(SEGEL_CYCLE.indexOf(cur) + 1) % SEGEL_CYCLE.length]);
  };

  // „persist" schreibt NICHT mehr — es legt den Zug in den Entwurf. Der Name
  // bleibt, damit jede Geste (Ziehen, Drehen, Undo, Import) weiter denselben
  // einen Weg nimmt.
  const persist = (next, tf = tafel) => e.setz({ seats: next, tafel: tf });
  // Vor einer Änderung den aktuellen Stand auf den Undo-Stapel legen. Eine neue
  // Aktion macht Redo ungültig (klassisches Undo/Redo).
  // Rueckgaengig gilt nur fuer das, woran man GERADE arbeitet. Nach einer Pause
  // weiss niemand mehr, was der Pfeil zuruecknimmt — und ein Klick verschiebt
  // dann wortlos Tische, die man laengst absichtlich so gestellt hat. Deshalb
  // verfaellt der Stapel nach fuenf Minuten Ruhe, und der Klassenwechsel leert
  // ihn sofort (der Plan darunter ist ein anderer).
  const VERFALL_MS = 5 * 60 * 1000;
  const letzteAktion = useRef(0);
  useEffect(() => {
    const puls = setInterval(() => {
      if (!undoStack.current.length && !redoStack.current.length) return;
      if (Date.now() - letzteAktion.current < VERFALL_MS) return;
      undoStack.current = []; redoStack.current = [];
      setUndoLen(0); setRedoLen(0);
    }, 30000);
    return () => clearInterval(puls);
  }, []);
  useEffect(() => {
    undoStack.current = []; redoStack.current = [];
    setUndoLen(0); setRedoLen(0);
  }, [classId, kursId]);

  const snapshot = () => { undoStack.current.push({ seats, tafel }); if (undoStack.current.length > 40) undoStack.current.shift(); setUndoLen(undoStack.current.length); redoStack.current = []; setRedoLen(0); letzteAktion.current = Date.now(); };
  const undo = () => { letzteAktion.current = Date.now(); const p = undoStack.current.pop(); setUndoLen(undoStack.current.length); if (!p) return; redoStack.current.push({ seats, tafel }); setRedoLen(redoStack.current.length); setTafel(p.tafel); persist(p.seats, p.tafel); };
  const redo = () => { letzteAktion.current = Date.now(); const p = redoStack.current.pop(); setRedoLen(redoStack.current.length); if (!p) return; undoStack.current.push({ seats, tafel }); setUndoLen(undoStack.current.length); setTafel(p.tafel); persist(p.seats, p.tafel); };
  // Leerer Platz (kein Schüler): eigener String-sid + empty-Flag, versetzt abgelegt.
  const addEmpty = () => { snapshot(); const n = seats.filter((s) => s.empty).length; persist([...seats, { sid: "e" + Date.now(), x: 40 + (n % 8) * 18, y: 60 + (n % 8) * 18, rot: 0, empty: true }]); };

  // ── Nach LINKS (und oben) erweitern ──
  //
  // Die Flaeche fing bei 0 an, und jeder Zug wurde dort abgefangen: wer den
  // Raum spiegelverkehrt aufbaut, konnte links nichts mehr anlegen — er haette
  // erst alles andere nach rechts schieben muessen. Jetzt darf ein Zug ueber
  // den Rand hinaus (RAND_ZUG), und danach wird die ganze Anordnung so
  // verschoben, dass wieder alles bei >= RAND_INNEN liegt. Gespeichert werden
  // weiterhin nur positive Zahlen; das Blatt ist einfach groesser geworden.
  //
  // Der Ausschnitt zieht mit (scrollLeft/scrollTop), sonst springt der Plan
  // beim Loslassen unter der Hand weg.
  const RAND_ZUG = 600;     // so weit darf man über den Rand hinausziehen
  const RAND_INNEN = 20;    // dort liegt danach das linke/obere Element
  const normalisieren = (liste, tf) => {
    const xs = [...liste.map((s) => s.x), tf ? tf.x : Infinity];
    const ys = [...liste.map((s) => s.y), tf ? tf.y : Infinity];
    const minX = Math.min(...xs, Infinity);
    const minY = Math.min(...ys, Infinity);
    const dx = minX < 0 ? RAND_INNEN - minX : 0;
    const dy = minY < 0 ? RAND_INNEN - minY : 0;
    if (!dx && !dy) return { liste, tafel: tf, dx: 0, dy: 0 };
    return {
      liste: liste.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy })),
      tafel: tf ? { ...tf, x: tf.x + dx, y: tf.y + dy } : tf,
      dx, dy,
    };
  };
  // Nach dem Verschieben denselben Bildausschnitt behalten.
  const ausschnittNachziehen = (dx, dy) => {
    const el = scrollRef.current;
    if (!el) return;
    if (dx) el.scrollLeft += dx * zoom;
    if (dy) el.scrollTop += dy * zoom;
  };

  // Tafel ziehen (Pointer). Breite/Höhe der Tafel-Fläche.
  const TAFEL_W = 200, TAFEL_H = 30;
  const onTafelDown = (e) => {
    snapshot();
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    tafelRef.current = { dx: (e.clientX - rect.left) / zoom - tafel.x, dy: (e.clientY - rect.top) / zoom - tafel.y };
    window.addEventListener("pointermove", onTafelMove);
    window.addEventListener("pointerup", onTafelUp);
  };
  const onTafelMove = (e) => {
    const d = tafelRef.current; if (!d) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(-RAND_ZUG, Math.min((e.clientX - rect.left) / zoom - d.dx, rect.width / zoom - TAFEL_W));
    const y = Math.max(-RAND_ZUG, Math.min((e.clientY - rect.top) / zoom - d.dy, rect.height / zoom - TAFEL_H));
    // rot beibehalten — sonst verliert die Tafel beim Verschieben ihre Drehung.
    setTafel((tf) => ({ ...tf, x, y }));
  };
  const onTafelUp = () => {
    window.removeEventListener("pointermove", onTafelMove);
    window.removeEventListener("pointerup", onTafelUp);
    const norm = normalisieren(seats, tafel);
    if (norm.dx || norm.dy) {
      persist(norm.liste, norm.tafel);
      ausschnittNachziehen(norm.dx, norm.dy);
    }
    // Kein Schreiben mehr beim Loslassen: der Zug steht längst im Entwurf.
    tafelRef.current = null;
  };

  const platziert = new Set(seats.map((s) => s.sid));
  const pool = students.filter((s) => !platziert.has(s.id));

  // ── Ziehen platzierter Tische (Pointer, damit es flüssig folgt) ──
  const onSeatDown = (e, seat) => {
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    // Der Schnappschuss fuer „Rueckgaengig" entsteht erst beim ersten
    // WIRKLICHEN Zug (siehe onMove): ein blosser Klick auf einen Platz ist
    // keine Aenderung und hat den Undo-Stapel vorher mit lauter gleichen
    // Staenden gefuellt — vierzig Klicks, und das echte Verschieben davor war
    // herausgefallen.
    dragRef.current = {
      sid: seat.sid, empty: !!seat.empty,
      dx: (e.clientX - rect.left) / zoom - seat.x, dy: (e.clientY - rect.top) / zoom - seat.y,
      rot: seat.rot || 0, sx: e.clientX, sy: e.clientY, gezogen: false,
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const onMove = (e) => {
    const d = dragRef.current; if (!d) return;
    // Unter 4 px ist es ein Klick, kein Zug — auch ein ruhiger Finger wackelt.
    if (!d.gezogen) {
      if (Math.abs(e.clientX - d.sx) < 4 && Math.abs(e.clientY - d.sy) < 4) return;
      d.gezogen = true;
      snapshot();
    }
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(-RAND_ZUG, Math.min((e.clientX - rect.left) / zoom - d.dx, rect.width / zoom - SEAT_W));
    const y = Math.max(-RAND_ZUG, Math.min((e.clientY - rect.top) / zoom - d.dy, rect.height / zoom - SEAT_H));
    // rot ausdrücklich beibehalten (Drag darf die Drehung nie verwerfen).
    setSeats((prev) => prev.map((s) => (s.sid === d.sid ? { ...s, x, y, rot: s.rot ?? d.rot } : s)));
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    const d = dragRef.current;
    dragRef.current = null;
    // Wurde ueber den linken/oberen Rand hinaus gezogen, wandert die ganze
    // Anordnung zurueck ins Positive — die Flaeche ist damit nach links
    // gewachsen, ohne dass jemand Koordinaten von Hand aufraeumen muss.
    if (d?.gezogen) {
      const norm = normalisieren(seats, tafel);
      // `persist` schreibt Plaetze UND Tafel in den Entwurf — ein zweiter
      // Aufruf ueber setSeats/setTafel waere derselbe Zug zweimal.
      if (norm.dx || norm.dy) {
        persist(norm.liste, norm.tafel);
        ausschnittNachziehen(norm.dx, norm.dy);
      }
    }
    // Im Markier-Modus ist der Klick auf den Platz der Handgriff: eine Ecke
    // mehr waere die fuenfte an einem Tisch von 108 px Breite.
    if (d && !d.gezogen && !d.empty && hervor === "mark") markSchalten(d.sid);
  };

  const entfernen = (sid) => { snapshot(); persist(seats.filter((s) => s.sid !== sid)); };

  // ── Freie Drehung per Eck-Griff (oben rechts). Winkel = Richtung vom
  // Tisch-Mittelpunkt zum Zeiger. ──
  const rotRef = useRef(null);
  const _angle = (e, cx, cy) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return Math.atan2((e.clientY - rect.top) / zoom - cy, (e.clientX - rect.left) / zoom - cx) * 180 / Math.PI;
  };
  const onRotDown = (e, seat) => {
    snapshot();
    e.preventDefault(); e.stopPropagation();
    const cx = seat.x + SEAT_W / 2, cy = seat.y + SEAT_H / 2;
    // Relativ drehen: Start-Zeigerwinkel und Start-Drehung merken, damit das
    // Greifen des Griffs nicht sofort auf einen absoluten Winkel springt.
    rotRef.current = { sid: seat.sid, cx, cy, startAngle: _angle(e, cx, cy), startRot: seat.rot || 0 };
    window.addEventListener("pointermove", onRotMove);
    window.addEventListener("pointerup", onRotUp);
  };
  const onRotMove = (e) => {
    const d = rotRef.current; if (!d) return;
    let deg = Math.round(d.startRot + (_angle(e, d.cx, d.cy) - d.startAngle));
    deg = ((deg % 360) + 360) % 360;
    setSeats((prev) => prev.map((s) => (s.sid === d.sid ? { ...s, rot: deg } : s)));
  };
  const onRotUp = () => {
    window.removeEventListener("pointermove", onRotMove);
    window.removeEventListener("pointerup", onRotUp);
    rotRef.current = null;
  };

  // Tafel drehen (gleicher Eck-Griff-Mechanismus).
  const tafelRotRef = useRef(null);
  const onTafelRotDown = (e) => {
    snapshot();
    e.preventDefault(); e.stopPropagation();
    const cx = tafel.x + TAFEL_W / 2, cy = tafel.y + TAFEL_H / 2;
    tafelRotRef.current = { cx, cy, startAngle: _angle(e, cx, cy), startRot: tafel.rot || 0 };
    window.addEventListener("pointermove", onTafelRotMove);
    window.addEventListener("pointerup", onTafelRotUp);
  };
  const onTafelRotMove = (e) => {
    const d = tafelRotRef.current; if (!d) return;
    let deg = Math.round(d.startRot + (_angle(e, d.cx, d.cy) - d.startAngle));
    deg = ((deg % 360) + 360) % 360;
    setTafel((tf) => ({ ...tf, rot: deg }));
  };
  const onTafelRotUp = () => {
    window.removeEventListener("pointermove", onTafelRotMove);
    window.removeEventListener("pointerup", onTafelRotUp);
    tafelRotRef.current = null;
  };

  // Pool → Fläche (HTML5-Drop; Position aus der Cursorstelle).
  const onCanvasDrop = (e) => {
    e.preventDefault();
    const sid = Number(e.dataTransfer.getData("text/plain"));
    if (!sid || platziert.has(sid)) return;
    snapshot();
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(-RAND_ZUG, Math.min((e.clientX - rect.left) / zoom - SEAT_W / 2, rect.width / zoom - SEAT_W));
    const y = Math.max(-RAND_ZUG, Math.min((e.clientY - rect.top) / zoom - SEAT_H / 2, rect.height / zoom - SEAT_H));
    const norm = normalisieren([...seats, { sid, x, y, rot: 0 }], tafel);
    persist(norm.liste, norm.tafel);
    if (norm.dx || norm.dy) ausschnittNachziehen(norm.dx, norm.dy);
  };

  // Leeren setzt auch die Tafel zurueck — sonst blieb sie an ihrer verschobenen
  // Stelle stehen, obwohl der Plan leer ist.
  const leeren = () => { snapshot(); const tf = { x: 200, y: 8 }; setTafel(tf); persist([], tf); setMsg(t("sitzplan.cleared")); setTimeout(() => setMsg(""), 2500); };

  // Export/Import: nur das Layout (Positionen + Drehungen + Tafel), ohne feste
  // Schüler. Beim Import werden die SuS der aktuellen Klasse der Reihe nach auf
  // die Plätze gesetzt — so lässt sich eine Sitzordnung auf eine andere Klasse
  // (oder ein anderes Fach) übertragen.
  // Auto-Zoom: alle Elemente einpassen, mit ~30 % Rand ringsum.
  const fitView = () => {
    if (!seats.length) { setZoom(1); return; }
    const items = [...seats.map((s) => ({ x: s.x, y: s.y, w: SEAT_W, h: SEAT_H })), { x: tafel.x, y: tafel.y, w: TAFEL_W, h: TAFEL_H }];
    const minX = Math.min(...items.map((i) => i.x)), minY = Math.min(...items.map((i) => i.y));
    const maxX = Math.max(...items.map((i) => i.x + i.w)), maxY = Math.max(...items.map((i) => i.y + i.h));
    const cw = Math.max(1, maxX - minX), ch = Math.max(1, maxY - minY);
    const vw = scrollRef.current.clientWidth, vh = scrollRef.current.clientHeight;
    const z = Math.min(2, Math.max(0.5, Math.min(vw / (cw * 1.3), vh / (ch * 1.3))));
    setZoom(z);
    requestAnimationFrame(() => {
      if (!scrollRef.current) return;
      scrollRef.current.scrollLeft = (minX + maxX) / 2 * z - vw / 2;
      scrollRef.current.scrollTop = (minY + maxY) / 2 * z - vh / 2;
    });
  };

  const doExport = () => {
    const data = { type: "nuvora_sitzplan", slots: seats.map((s) => ({ x: s.x, y: s.y, rot: s.rot || 0 })), tafel };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
    a.download = `Sitzplan_${cls?.name || "klasse"}.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  const doImport = async (file) => {
    try {
      const data = JSON.parse(await file.text());
      if (data.type !== "nuvora_sitzplan" || !Array.isArray(data.slots)) { setMsg(t("sitzplan.importError")); return; }
      snapshot();
      const next = students.slice(0, data.slots.length).map((st, i) => ({ sid: st.id, x: data.slots[i].x, y: data.slots[i].y, rot: data.slots[i].rot || 0 }));
      const tf = data.tafel && typeof data.tafel.x === "number" ? { x: data.tafel.x, y: data.tafel.y, rot: data.tafel.rot || 0 } : tafel;
      setTafel(tf);          // lokal übernehmen (nicht nur an den Server senden)
      persist(next, tf);
      setMsg(t("sitzplan.imported")); setTimeout(() => setMsg(""), 2500);
    } catch { setMsg(t("sitzplan.importError")); }
  };

  // Ebene verschieben: leere Fläche greifen und die ganze Ansicht schieben
  // (pant den Scroll-Container). Nur wenn direkt auf die Fläche geklickt wird.
  const scrollRef = useRef(null);
  const panRef = useRef(null);
  const onCanvasDown = (e) => {
    if (e.target !== canvasRef.current) return;
    panRef.current = { x: e.clientX, y: e.clientY, l: scrollRef.current.scrollLeft, t: scrollRef.current.scrollTop };
    window.addEventListener("pointermove", onPanMove);
    window.addEventListener("pointerup", onPanUp);
  };
  const onPanMove = (e) => {
    const p = panRef.current; if (!p) return;
    scrollRef.current.scrollLeft = p.l - (e.clientX - p.x);
    scrollRef.current.scrollTop = p.t - (e.clientY - p.y);
  };
  const onPanUp = () => {
    window.removeEventListener("pointermove", onPanMove);
    window.removeEventListener("pointerup", onPanUp);
    panRef.current = null;
  };

  return (
    <div style={{ maxWidth: "none" }}>
      <Werkzeugleiste
        links={<KursKlasseSelect value={classId} kursValue={kursId} onChange={(id, kid) => wechseln(() => { setClassId(id); setKursId(kid); })} onKurs={setKursId} />}
        ansicht={(
          <ViewMenu title={t("sitzplan.view")} items={[
            { key: "fotos", label: t("sitzplan.photoToggle"), hint: t("sitzplan.photoHint"), value: fotosOn, onChange: (v) => { setFotosOn(v); saveView({ fotos: v }); } },
            ...(segelTeil ? [{ key: "segel", label: t("sitzplan.segelToggle"), hint: t("sitzplan.segelHint"), value: segelOn, onChange: (v) => { setSegelOn(v); saveView({ segel: v }); } }] : []),
            { key: "hervor", art: "wahl", label: t("sitzplan.hervorLabel"), hint: t(hervor === "foerder" ? "sitzplan.hervorHintFoerder" : "sitzplan.hervorHint"),
              value: hervor, onChange: (v) => { setHervor(v); saveView({ hervor: v }); },
              optionen: [
                { wert: "", label: t("sitzplan.hervorAus") },
                { wert: "mark", label: t("sitzplan.hervorMark") },
                { wert: "niveau", label: t("sitzplan.hervorNiveau") },
                { wert: "foerder", label: t("sitzplan.hervorFoerder") },
              ] },
            // Der Schwerpunkt steht nur zur Wahl, wenn danach gefaerbt wird —
            // sonst ist es ein Auswahlfeld ohne Wirkung.
            ...(hervor === "foerder" ? [{
              key: "foerderArt", art: "wahl", label: t("sitzplan.hervorFoerderArt"),
              value: foerderArt, onChange: (v) => { setFoerderArt(v); saveView({ foerderArt: v }); },
              optionen: [{ wert: "", label: t("sitzplan.hervorFoerderAlle") }, ...vorhandeneFoerder.map((f) => ({ wert: f, label: f }))],
            }] : []),
          ]} />
        )}
        mehr={[
          { key: "export", label: t("sitzplan.export"), icon: ICONS.export, onClick: doExport },
          { key: "import", label: t("sitzplan.import"), icon: ICONS.import, onClick: () => dateiWaehlen(doImport) },
          Object.keys(marken).length > 0 && { key: "markLeeren", label: t("sitzplan.markClear"), icon: ICONS.close || ICONS.trash, onClick: markenLeeren },
          { key: "leeren", label: t("sitzplan.clear"), icon: ICONS.trash, gefahr: true, onClick: leeren },
        ]}>
        {/* Sichtbar bleibt, was man im Unterricht wirklich braucht: einen Platz
            dazulegen und das letzte Verschieben zuruecknehmen. Alles Uebrige
            steht im Menue — vorher lag der Papierkorb direkt neben dem Plus. */}
        <button onClick={addEmpty} style={toolbarBtn} title={t("sitzplan.addEmpty")}>
          <Icon d={ICONS.plus} size={15} /> {t("sitzplan.emptySeat")}
        </button>
        {undoLen > 0 && <button onClick={undo} className="icon-btn" style={toolbarIconBtn} title={t("sitzplan.undo")} aria-label={t("sitzplan.undo")}><Icon d={ICONS.undo || ICONS.restore} size={18} /></button>}
        {redoLen > 0 && <button onClick={redo} className="icon-btn" style={toolbarIconBtn} title={t("sitzplan.redo")} aria-label={t("sitzplan.redo")}><span style={{ display: "inline-flex", transform: "scaleX(-1)" }}><Icon d={ICONS.undo || ICONS.restore} size={18} /></span></button>}
      </Werkzeugleiste>
      {segelTeil && segelOn && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "8px 0 12px", fontSize: 13, color: "var(--text3)" }}>
          <span>{t("sitzplan.segelLegend")}:</span>
          {SEGEL.map((x) => (
            <span key={x.key} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              {/* Radius = halbe Kante: reine Grafik (Punkt in der Legende). */}
              <span style={{ width: 16, height: 16, borderRadius: 8, background: x.color, color: C.aufAkzent, fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{x.ab}</span>
              {x.label}
            </span>
          ))}
        </div>
      )}
      {hervor && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "8px 0 12px", fontSize: 13, color: "var(--text3)" }}>
          <span>{t("sitzplan.hervorLegend")}:</span>
          {legende.length === 0 && <span>{t(hervor === "mark" ? "sitzplan.markNone" : "sitzplan.hervorNichts")}</span>}
          {legende.map((l) => (
            <span key={l.text} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              {/* Radius = halbe Kante: reine Grafik (Punkt in der Legende). */}
              <span style={{ width: 16, height: 16, borderRadius: 8, background: l.farbe }} />
              {l.text}
            </span>
          ))}
        </div>
      )}
      {msg && <p style={{ fontSize: 13, color: C.success, marginBottom: 12 }}>{msg}</p>}

      {students.length === 0 ? (
        <Empty title={t("sitzplan.noStudents")} hint={t("sitzplan.noStudentsHint")} />
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: "var(--text3)" }}>{t("sitzplan.zoom")}</span>
            <Segment style={{ height: ZOOM_H }}>
              <button onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))} style={zoomBtnStyle} title={t("sitzplan.zoomOut")} aria-label={t("sitzplan.zoomOut")}><Icon d={ICONS.minus} size={15} /></button>
              <span style={{ ...zoomBtnStyle, cursor: "default", minWidth: 46 }}>{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.1) * 10) / 10))} style={zoomBtnStyle} title={t("sitzplan.zoomIn")} aria-label={t("sitzplan.zoomIn")}><Icon d={ICONS.plus} size={15} /></button>
              {zoom !== 1 && <button onClick={() => setZoom(1)} style={zoomBtnStyle}>{t("sitzplan.zoomReset")}</button>}
              <button onClick={fitView} style={zoomBtnStyle} title={t("sitzplan.fitHint")} aria-label={t("sitzplan.fit")}><Icon d={ICONS.fit} size={15} /></button>
            </Segment>
          </div>
          <div ref={scrollRef} style={{ height: 520, overflow: "auto", border: "1px solid var(--border)", borderRadius: cardStyle.borderRadius, background: "var(--card)", marginBottom: 16 }}>
          <div ref={canvasRef} onPointerDown={onCanvasDown} onDragOver={(e) => e.preventDefault()} onDrop={onCanvasDrop}
            style={{ position: "relative",
              // Die Flaeche waechst mit dem, was darauf steht — sonst endet der
              // Raum am Rand des Fensters, und ein Tisch weiter rechts liesse
              // sich gar nicht erst ablegen.
              height: Math.max(760, ...seats.map((s) => s.y + SEAT_H + 60), (tafel?.y ?? 0) + TAFEL_H + 60),
              width: Math.max(720, ...seats.map((s) => s.x + SEAT_W + 60), (tafel?.x ?? 0) + TAFEL_W + 60),
              minWidth: "calc(100% - 40px)", margin: "0 20px", transform: `scale(${zoom})`, transformOrigin: "0 0",
              cursor: "grab",
              backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)", backgroundSize: "24px 24px" }}>
            {/* Bewegliche Tafel */}
            <div onPointerDown={onTafelDown}
              style={{ position: "absolute", left: tafel.x, top: tafel.y, width: TAFEL_W, height: TAFEL_H,
                transform: `rotate(${tafel.rot || 0}deg)`, transformOrigin: "center",
                display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center",
                fontSize: 12, letterSpacing: "0.1em", color: "var(--text2)", textTransform: "uppercase", fontWeight: 700,
                border: "2px solid var(--text3)", borderRadius: CONTROL_R, background: "var(--bg2)",
                cursor: "grab", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", touchAction: "none", boxShadow: SHADOW.ruhig }}
              title={t("sitzplan.board")}>{t("sitzplan.board")}
              {/* Die Griffe und Punkte an den Ecken sind reine Grafik: der
                  Radius ist immer die halbe Kante (runder Griff, runder Punkt)
                  — deshalb hier Zahlen statt CONTROL_R. */}
              {(
                <span onPointerDown={onTafelRotDown} title={t("sitzplan.rotate")}
                  style={{ position: "absolute", right: -9, top: -9, width: 18, height: 18, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center",
                    background: "var(--card)", border: "1px solid var(--border2)", color: "var(--text2)", fontSize: 12, lineHeight: 1, cursor: "grab", touchAction: "none", boxShadow: SHADOW.ruhig }}><Icon d={ICONS.rotate} size={11} /></span>
              )}
            </div>
            {seats.map((seat) => {
              const s = byId(seat.sid);
              if (!seat.empty && !s) return null;   // verwaister Platz (Schüler gelöscht) bleibt versteckt
              const hf = seat.empty ? null : farbeFuer(s);
              return (
                <div key={seat.sid} draggable={false}
                  onPointerDown={(e) => onSeatDown(e, seat)}
                  onDragStart={(e) => e.preventDefault()}
                  style={{ position: "absolute", left: seat.x, top: seat.y, width: SEAT_W, minHeight: SEAT_H,
                    transform: `rotate(${seat.rot || 0}deg)`, transformOrigin: "center",
                    display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center",
                    padding: "6px 22px 6px 8px", borderRadius: CONTROL_R,
                    // Hervorgehoben: farbiger Rahmen UND getoenter Grund. Nur
                    // der Rahmen reicht am Beamer nicht — 1 px verschwindet aus
                    // drei Metern Abstand; nur die Toenung reicht bei
                    // Sonnenlicht auf der Leinwand nicht.
                    border: `1px solid ${hf || "var(--border2)"}`,
                    background: hf ? `${hf}1f` : "var(--bg)", color: "var(--text)", fontSize: 13, fontWeight: 600,
                    cursor: hervor === "mark" && !seat.empty ? "pointer" : "grab",
                    boxShadow: SHADOW.ruhig, userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", touchAction: "none" }}>
                  {hf && (
                    // Der Balken traegt die Farbe da, wo sie auch bei
                    // uebereinanderliegenden Tischen sichtbar bleibt: an der
                    // Kante. Radius links = Radius des Platzes.
                    <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 5,
                      background: hf, borderTopLeftRadius: CONTROL_R, borderBottomLeftRadius: CONTROL_R }} />
                  )}
                  {!seat.empty && fotosOn && (
                    // Groesser und eckig: am Beamer entscheidet die Flaeche des
                    // Gesichts, ob man jemanden erkennt — ein Kreis mit 26 px
                    // war aus drei Metern ein Punkt. 32 passt in die Zeilenhoehe
                    // des Platzes (SEAT_H 46 minus Innenabstand).
                    // `pointerEvents: none`: sonst faengt das Bild den Zug ab
                    // und der Browser startet sein eigenes Bild-Ziehen — der
                    // Platz blieb stehen, das Foto hing am Zeiger. Gezogen wird
                    // der Platz, nicht sein Inhalt (beim Namen war es nie
                    // anders, der ist kein Drag-Ziel).
                    <Portrait student={s} size={32} form="eckig"
                      style={{ marginRight: 8, pointerEvents: "none", userSelect: "none" }} />
                  )}
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: seat.empty ? "var(--text3)" : undefined }}>{seat.empty ? t("sitzplan.emptySeat") : s.name}</span>
                  {!seat.empty && segelTeil && segelOn && (() => {
                    const st = SEGEL.find((x) => x.key === segel[String(seat.sid)]);
                    return (
                      <button onPointerDown={(e) => e.stopPropagation()} onClick={() => cycleStage(seat.sid)}
                        title={st ? `SEGEL: ${st.label}` : t("sitzplan.segelSet")}
                        style={{ position: "absolute", left: -9, bottom: -9, width: 20, height: 20, borderRadius: 10, cursor: "pointer", fontSize: 11, fontWeight: 700, lineHeight: 1,
                          display: "flex", alignItems: "center", justifyContent: "center", boxShadow: SHADOW.ruhig,
                          background: st ? st.color : "var(--card)", color: st ? C.aufAkzent : "var(--text3)",
                          border: st ? "none" : "1px dashed var(--border2)" }}>
                        {st ? st.ab : "+"}
                      </button>
                    );
                  })()}
                  {(
                    <>
                      {/* Dreh-Griff (Icon) an der oberen rechten Ecke: ziehen = frei drehen. */}
                      <span onPointerDown={(e) => onRotDown(e, seat)} title={t("sitzplan.rotate")}
                        style={{ position: "absolute", right: -9, top: -9, width: 18, height: 18, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center",
                          background: "var(--card)", border: "1px solid var(--border2)", color: "var(--text2)", fontSize: 12, lineHeight: 1, cursor: "grab", touchAction: "none", boxShadow: SHADOW.ruhig }}><Icon d={ICONS.rotate} size={11} /></span>
                      <button onPointerDown={(e) => e.stopPropagation()} onClick={() => entfernen(seat.sid)} title={t("sitzplan.removeSeat")}
                        style={{ position: "absolute", right: -9, bottom: -9, width: 20, height: 20, borderRadius: 10, border: "1px solid var(--border2)", background: "var(--card)", cursor: "pointer", color: C.danger, fontSize: 13, fontWeight: 700, padding: 0, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          </div>

          {/* Sitzen alle, braucht es den Pool nicht: eine leere Flaeche mit der
              Ueberschrift „Noch nicht platziert (0)" ist nur Platz. Sobald
              jemand herausfaellt (neues Kind, Platz entfernt), ist er wieder da. */}
          {pool.length > 0 && (
          <div style={{ ...panelStyle, border: "1px dashed var(--border2)", padding: 12, minHeight: 56, background: "var(--bg2)" }}>
            <div style={{ ...sectionLabel, marginBottom: 8 }}>{t("sitzplan.pool")} ({pool.length})</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {pool.map((s) => (
                <div key={s.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", String(s.id))}
                  style={{ ...chipStyle, padding: "8px 12px", border: "1px solid var(--border2)", background: "var(--card)", color: "var(--text)", fontSize: 13, cursor: "grab", display: "inline-flex", alignItems: "center", gap: 8 }}>
                  {fotosOn && <Portrait student={s} size={22} />}
                  {s.name}
                </div>
              ))}
            </div>
          </div>
          )}
        </>
      )}
      <SpeicherBalken entwurf={e} />
    </div>
  );
}
