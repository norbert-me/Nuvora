// Ziehen zum Umsortieren — EINE Quelle für die drei Bauformen, die es gibt.
//
// Vorher hatte jede Liste ihre eigene, zeichengleich abgeschriebene Fassung:
// Einfügemarke vor/hinter dem Ziel (Topics, Karten für Stapel und Karten,
// Noten für Abschnitte und Spalten), Live-Vorschau beim Ziehen (Dashboard,
// Todo, Notizblock) und Ablegen in einen Ordner (Karten, Methoden).
//
// Fünfmal dieselbe Indexrechnung „Entnahme verschiebt den Zielindex" ist
// fünfmal die Chance, sie an einer Stelle falsch zu haben. Sie steht jetzt
// hier und ist geprüft (`ziehsortieren.test.js`).
import { useRef, useState } from "react";

/**
 * `von` an die Stelle von `ziel` schieben — davor oder dahinter.
 *
 * Reine Rechnung auf einer ID-Liste. Gibt `null` zurück, wenn nichts zu tun
 * ist (gleiches Element, unbekannte ID) — der Aufrufer darf dann abbrechen.
 */
export function umsortiert(ids, von, ziel, dahinter = false) {
  if (von === ziel) return null;
  const from = ids.indexOf(von);
  let to = ids.indexOf(ziel);
  if (from < 0 || to < 0) return null;
  if (dahinter) to += 1;
  if (from < to) to -= 1; // die Entnahme verschiebt den Zielindex
  const neu = [...ids];
  neu.splice(to, 0, neu.splice(from, 1)[0]);
  return neu;
}

/** Zeigt der Zeiger auf die hintere Hälfte des überfahrenen Elements? */
export function zeigerHinten(e, waagerecht = false) {
  const r = e.currentTarget.getBoundingClientRect();
  return waagerecht ? e.clientX >= r.left + r.width / 2 : e.clientY >= r.top + r.height / 2;
}

/**
 * Einfügemarke: „lasse ich hier los, landet es VOR oder HINTER diesem Eintrag".
 *
 * @param waagerecht      Reihe statt Spalte (Noten: Abschnitte und Spalten)
 * @param nurGleicheGruppe  nur innerhalb derselben Gruppe umsortieren — die
 *        Gruppe gibt der Aufrufer bei `start`/`ueber` mit (Karten: Ordner,
 *        Noten: Abschnitt). Passt sie nicht, wird gar nicht erst zugelassen.
 *
 * Rückgabe: `seite(id)` ist `"vor"`, `"nach"` oder `null` — genau das, was die
 * Zeile braucht, um ihre Linie oben oder unten zu zeichnen.
 */
export function useEinfuegen({ waagerecht = false, nurGleicheGruppe = false } = {}) {
  const [zieht, setZieht] = useState(null);   // ID des gezogenen Eintrags
  const gruppeRef = useRef(null);             // Gruppe der Quelle
  const [marke, setMarke] = useState(null);   // { id, hinten }

  const beenden = () => { setZieht(null); gruppeRef.current = null; setMarke(null); };

  const start = (id, gruppe = null) => { setZieht(id); gruppeRef.current = gruppe; };

  const ueber = (e, id, gruppe = null) => {
    if (zieht == null) return;
    if (nurGleicheGruppe && gruppeRef.current !== gruppe) return;
    e.preventDefault();
    if (id === zieht) { setMarke(null); return; }
    const hinten = zeigerHinten(e, waagerecht);
    setMarke((p) => (p && p.id === id && p.hinten === hinten ? p : { id, hinten }));
  };

  /**
   * Ablegen. Gibt die neue ID-Reihenfolge zurück — oder `null`, wenn sich
   * nichts ändert. Räumt den Ziehzustand in jedem Fall auf.
   */
  const ablegen = (id, ids) => {
    const von = zieht, m = marke;
    beenden();
    if (von == null) return null;
    return umsortiert(ids, von, id, !!(m && m.id === id && m.hinten));
  };

  const seite = (id) => (marke && marke.id === id ? (marke.hinten ? "nach" : "vor") : null);

  return { zieht, marke, seite, start, ueber, ablegen, beenden };
}

/**
 * Ablegen IN etwas (Ordner, Wurzel, Brotkrume) statt zwischen zwei Einträgen.
 *
 * Karten.jsx und Methoden.jsx hatten dafür beide ein `dropTarget`-State plus
 * dieselben drei Handler; in Karten.jsx stand die Dreiergruppe viermal inline
 * (Wurzel-Krume, Pfad-Krume, Ordnerkarte) und dabei jedes Mal ein bisschen
 * anders. WAS erlaubt ist und WAS beim Ablegen passiert, bleibt bei der Seite —
 * das ist je Modul etwas anderes.
 *
 * `ziel` ist `undefined` (keins), `null` (Wurzel) oder eine ID — deshalb wird
 * hier nirgends auf Wahrheitswert geprüft.
 */
export function useAblegeZiel({ erlaubt, ablegen }) {
  const [ziel, setZiel] = useState(undefined);
  const zuruecksetzen = () => setZiel(undefined);
  const props = (zielId) => ({
    onDragOver: (e) => {
      if (!erlaubt(zielId)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      setZiel((cur) => (cur === zielId ? cur : zielId));
    },
    onDragLeave: () => setZiel((cur) => (cur === zielId ? undefined : cur)),
    onDrop: (e) => { e.preventDefault(); if (erlaubt(zielId)) ablegen(zielId); zuruecksetzen(); },
  });
  /** Leuchtet dieses Ziel gerade auf? */
  const aktiv = (zielId) => ziel === zielId && erlaubt(zielId);
  return { ziel, aktiv, props, zuruecksetzen };
}

/**
 * Live-Vorschau: die Liste ordnet sich schon beim Ziehen um, das Ablegen
 * übernimmt genau das, was man sieht.
 *
 * Die Arbeitsliste liegt bewusst in einem Ref und nicht im State: bei einem
 * Zug über mehrere Zeilen hinkte der State hinterher, und das Ablegen
 * speicherte eine andere Reihenfolge als die angezeigte.
 *
 * @param liste        die Reihenfolge ohne Vorschau
 * @param uebernehmen  (neueListe) => void, beim Ablegen
 * @param aktiv        false = kein Ziehen (Suche offen, Zeile in Bearbeitung)
 * @returns { sichtbar, vorschau, props(idx) } — `props` an die Zeile spreaden
 */
export function useZiehVorschau(liste, uebernehmen, aktiv = true) {
  const idxRef = useRef(null);
  const arbeitRef = useRef(null);
  const [vorschau, setVorschau] = useState(null);
  const sichtbar = vorschau || liste;
  // Jede Liste erkennt ihre eigenen Zeilen (beim Touch-Weg sucht der Finger
  // die Zeile unter sich — eine zweite Liste auf derselben Seite darf das
  // nicht sein).
  const listeId = useRef(`z${Math.random().toString(36).slice(2, 8)}`).current;
  const touch = useRef(null);   // { timer, x, y, zieht, ab }
  const uebernehmenRef = useRef(uebernehmen);
  uebernehmenRef.current = uebernehmen;

  const ende = () => { setVorschau(null); idxRef.current = null; arbeitRef.current = null; };

  // Dieselbe Verschiebung fuer Maus und Finger.
  const ueber = (idx) => {
    const a = arbeitRef.current;
    if (idxRef.current == null || idx === idxRef.current || !a) return;
    a.splice(idx, 0, ...a.splice(idxRef.current, 1));
    idxRef.current = idx;
    setVorschau([...a]);
  };

  // ── Touch: lange druecken, dann ziehen ──
  // Safari auf dem iPhone kennt kein HTML5-Drag-and-Drop fuer Seitenelemente;
  // `draggable` tut dort schlicht nichts. Deshalb ein eigener Weg ueber
  // Touch-Ereignisse. Lange druecken (300 ms) statt sofort: ein kurzer Wisch
  // muss die Seite weiter scrollen. Die Bewegung haengt an einem eigenen,
  // NICHT passiven Horcher am Dokument — nur dort darf preventDefault das
  // Scrollen waehrend des Zugs anhalten (Reacts Touch-Horcher sind passiv).
  const touchEnde = (abbrechen) => {
    const t = touch.current;
    if (!t) return;
    clearTimeout(t.timer);
    if (t.ab) t.ab();
    touch.current = null;
    if (t.zieht && !abbrechen) {
      const arr = arbeitRef.current || sichtbar;
      ende();
      uebernehmenRef.current(arr);
    } else if (t.zieht) ende();
  };

  const props = (idx) => ({
    draggable: aktiv,
    "data-zieh-liste": listeId,
    "data-zieh-idx": idx,
    onDragStart: (e) => {
      if (!aktiv) return;
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      arbeitRef.current = [...sichtbar];
      idxRef.current = idx;
    },
    onDragOver: (e) => {
      if (!aktiv || idxRef.current == null) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      ueber(idx);
    },
    onDrop: (e) => {
      if (!aktiv) return;
      e.preventDefault();
      const arr = arbeitRef.current || vorschau || liste;
      ende();
      uebernehmen(arr);
    },
    onDragEnd: ende,
    onTouchStart: (e) => {
      if (!aktiv || e.touches.length !== 1) return;
      // In einem Eingabefeld heisst langes Druecken „Schreibmarke setzen"
      // oder „markieren" — dort wird nicht gezogen.
      if (e.target.closest && e.target.closest("input, textarea, select, button, a, [contenteditable='true']")) return;
      touchEnde(true);
      const { clientX: x, clientY: y } = e.touches[0];
      const t = { x, y, zieht: false, ab: null };
      t.timer = setTimeout(() => {
        t.zieht = true;
        arbeitRef.current = [...sichtbar];
        idxRef.current = idx;
        setVorschau([...sichtbar]);
        try { navigator.vibrate?.(15); } catch { /* egal */ }
        // Waehrend des Zugs nichts markieren: sonst zieht der Finger eine
        // Textauswahl ueber die Liste statt der Zeile.
        const vorher = document.body.style.webkitUserSelect;
        document.body.style.webkitUserSelect = "none";
        const bewegen = (ev) => {
          ev.preventDefault();
          const p = ev.touches[0];
          const el = document.elementFromPoint(p.clientX, p.clientY)?.closest?.(`[data-zieh-liste="${listeId}"]`);
          if (el) ueber(Number(el.getAttribute("data-zieh-idx")));
        };
        const loslassen = () => touchEnde(false);
        document.addEventListener("touchmove", bewegen, { passive: false });
        document.addEventListener("touchend", loslassen);
        document.addEventListener("touchcancel", loslassen);
        t.ab = () => {
          document.body.style.webkitUserSelect = vorher;
          document.removeEventListener("touchmove", bewegen);
          document.removeEventListener("touchend", loslassen);
          document.removeEventListener("touchcancel", loslassen);
        };
      }, 300);
      touch.current = t;
    },
    // Vor dem Ablauf der Frist bewegt: das war ein Scrollen, kein Zug.
    onTouchMove: (e) => {
      const t = touch.current;
      if (!t || t.zieht) return;
      const p = e.touches[0];
      if (Math.abs(p.clientX - t.x) > 8 || Math.abs(p.clientY - t.y) > 8) touchEnde(true);
    },
    onTouchEnd: () => { const t = touch.current; if (t && !t.zieht) touchEnde(true); },
  });

  return { sichtbar, vorschau, props };
}
