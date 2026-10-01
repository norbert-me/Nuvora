// Ein Entwurf, ein Speichern-Knopf — für die ganze Anwendung dieselbe Form.
//
// Die Regel kommt aus dem Gebrauch: „manche Dinge haben keinen Speichern-Knopf
// und speichern automatisch. Das fühlt sich komisch an, man hat das Gefühl,
// es ist nicht gespeichert. Man hat keine Kontrolle." Also gilt ab hier
// überall: **wo sich etwas ändern lässt, gibt es einen Speichern-Knopf** —
// ohne Ausnahme, auch bei Schaltern und Häkchen.
//
// Damit das nicht jede Seite anders löst (und drei Seiten es vergessen), steht
// die Mechanik hier an einer Stelle:
//
//   const e = useEntwurf(stapel, (wert) => fetch(…));
//   <input value={e.wert.name} onChange={(ev) => e.setz({ name: ev.target.value })} />
//   <Speicherleiste entwurf={e} />
//
// `useEntwurf` hält eine Arbeitskopie. Nichts davon geht zum Server, bevor
// jemand speichert; `verwerfen` stellt den letzten gespeicherten Stand wieder
// her. Solange etwas offen ist, warnt die Anwendung beim Verlassen der Seite
// und beim Schließen des Fensters.
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useBlocker } from "react-router-dom";

import { btnPrimary, btnSecondary, btnSmall, CONTROL_R, SHADOW, COLORS as C } from "./Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

/**
 * Ist der Entwurf derselbe Stand wie der gespeicherte? TIEF verglichen: wer
 * etwas aendert und es wieder zuruecknimmt, hat nichts offen — und eine
 * Speicherleiste, die dann trotzdem steht, verlangt, denselben Stand mit sich
 * selbst zu ueberschreiben. Flach verglichen war genau das der Fall, sobald
 * der Entwurf verschachtelt ist (Punkte je Kind, Aufgaben mit Teilaufgaben):
 * jede Aenderung baut dort ein neues Objekt, und das ist nie dasselbe.
 *
 * Leer ist leer: fehlt ein Feld, ist es null, {} oder [], gilt das als gleich —
 * ein geloeschter letzter Eintrag hinterlaesst oft ein leeres Objekt, wo vorher
 * gar keins stand.
 */
const leer = (x) => x == null || (Array.isArray(x) ? x.length === 0 : typeof x === "object" && Object.keys(x).length === 0);
export function gleich(a, b) {
  if (a === b) return true;
  if (leer(a) && leer(b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => gleich(v, b[i]));
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (!gleich(a[k], b[k])) return false;
  return true;
}

/**
 * Arbeitskopie eines Datensatzes.
 *
 * @param gespeichert  der Stand, der auf dem Server liegt
 * @param speichernFn  async (wert) => void | false — false heißt „nicht gespeichert"
 *                     (dann bleibt der Entwurf offen, damit nichts verloren geht)
 */
export function useEntwurf(gespeichert, speichernFn) {
  const [wert, setWert] = useState(gespeichert);
  const [laeuft, setLaeuft] = useState(false);
  // „Hat hier jemand HINEINGEGRIFFEN?" — und nicht „unterscheiden sich die
  // Werte?". Der Unterschied ist der Kern: Daten kommen oft erst nach dem
  // Mounten, die Arbeitskopie startet also mit einem leeren Stand. Wer nur
  // vergleicht, haelt diesen ersten Nachschub fuer eine offene Aenderung,
  // uebernimmt ihn nie — und die Maske steht sofort auf „nicht gespeichert"
  // und zeigt leere Felder. Genau das ist beim ersten Einsatz passiert.
  const beruehrt = useRef(false);
  useEffect(() => {
    if (!beruehrt.current) setWert(gespeichert);
  }, [gespeichert]);

  const geaendert = beruehrt.current && !gleich(wert, gespeichert);

  // Zaehlt jeden Griff. Wer weitertippt, waehrend gespeichert wird (beim
  // automatischen Speichern der Normalfall), hat danach noch etwas offen — der
  // Entwurf darf dann NICHT als uebernommen gelten, sonst ueberschriebe der
  // frische Serverstand die neue Eingabe.
  const stand = useRef(0);
  const setz = useCallback((teil) => {
    beruehrt.current = true;
    stand.current += 1;
    setWert((v) => ({ ...v, ...(typeof teil === "function" ? teil(v) : teil) }));
  }, []);

  const speichern = useCallback(async () => {
    if (laeuft) return false;           // Doppelklick zählt einmal
    setLaeuft(true);
    const beginn = stand.current;
    try {
      const ok = await speichernFn(wert);
      // Nur bei Erfolg loslassen: sonst gaelte der Entwurf als uebernommen und
      // der naechste Nachschub vom Server ueberschriebe, was nie ankam. Und nur,
      // wenn in der Zwischenzeit niemand weitergetippt hat.
      if (ok !== false && stand.current === beginn) beruehrt.current = false;
      return ok !== false;
    } finally {
      setLaeuft(false);
    }
  }, [laeuft, speichernFn, wert]);

  const verwerfen = useCallback(() => { beruehrt.current = false; setWert(gespeichert); }, [gespeichert]);

  return useMemo(() => ({ wert, setz, geaendert, speichern, verwerfen, laeuft }),
    [wert, setz, geaendert, speichern, verwerfen, laeuft]);
}

/**
 * Automatisch speichern — fuer EINGABEN in einem Raster (Noten, Punkte), nicht
 * fuer den Aufbau einer Maske.
 *
 * Entschieden am 01.10.2026 auf Wunsch des Nutzers: „bei Eingaben von Noten
 * oder Klassenarbeitspunkten muss ich nicht immer speichern — dafür kann ich ja
 * zurück verwenden". Eine Notentabelle wird Zelle fuer Zelle gefuellt; nach
 * jeder dritten Zelle „Speichern" zu druecken ist Arbeit ohne Entscheidung.
 * Spalten, Aufgaben, Namen und Notenschluessel bleiben bei der Leiste: dort
 * baut man etwas, und dort gilt weiter die Regel mit dem Knopf.
 *
 * `nurEingabe(wert)` sagt, ob das Offene AUSSCHLIESSLICH Eingaben sind; nur
 * dann wird nach `ms` ohne weiteren Griff gespeichert. Schlaegt das Speichern
 * fehl, bleibt die Leiste stehen (`zeigen`), damit nichts still verloren geht.
 * Rueckgabe: `{ zeigen }` — ob die Speicherleiste sichtbar sein soll.
 */
/** Unterscheiden sich `wert` und `basis` NUR in Feldern, fuer die
 *  `istEingabe(schluessel)` ja sagt? (Fuer `useAutoSpeichern`.) */
export function nurGeaendertIn(wert, basis, istEingabe) {
  const keys = new Set([...Object.keys(wert || {}), ...Object.keys(basis || {})]);
  for (const k of keys) if (!gleich((wert || {})[k], (basis || {})[k]) && !istEingabe(k)) return false;
  return true;
}

export function useAutoSpeichern(entwurf, nurEingabe, ms = 800) {
  const [fehler, setFehler] = useState(false);
  const auto = entwurf.geaendert && !fehler && nurEingabe(entwurf.wert);
  const { wert, speichern, laeuft } = entwurf;
  useEffect(() => {
    if (!auto || laeuft) return undefined;
    const z = setTimeout(async () => { if (!(await speichern())) setFehler(true); }, ms);
    return () => clearTimeout(z);
  }, [auto, laeuft, wert, speichern, ms]);
  // Neuer Griff nach einem Fehlschlag: erneut versuchen duerfen.
  useEffect(() => { setFehler(false); }, [wert]);
  return { zeigen: entwurf.geaendert && !auto };
}

/**
 * Warnen, solange etwas offen ist.
 *
 * Zwei Wege hinaus, zwei Sperren: der Seitenwechsel INNERHALB der Anwendung
 * (React Router, deshalb liegt die Anwendung an einem Datenrouter — ohne den
 * gibt es `useBlocker` nicht) und das Schließen/Neuladen des Fensters
 * (`beforeunload`, dort bestimmt der Browser den Wortlaut).
 */
export function useVerlassenWarnung(offen, frage) {
  const sperre = useBlocker(offen);
  useEffect(() => {
    if (sperre.state !== "blocked") return;
    // `confirm` und nicht der eigene Dialog: die Sperre muss synchron
    // entscheiden, sonst ist der Seitenwechsel schon durch.
    if (window.confirm(frage)) sperre.proceed();
    else sperre.reset();
  }, [sperre, frage]);

  useEffect(() => {
    if (!offen) return;
    const anhalten = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", anhalten);
    return () => window.removeEventListener("beforeunload", anhalten);
  }, [offen]);
}

// Ueber dem Dialog-Overlay (modalOverlay liegt bei 1000). Der schwebende Knopf
// stand vorher bei 60 und war in JEDEM Dialog unsichtbar: gerendert, aber hinter
// der Verdunklung — genau der Fall „Kind im Kurs anklicken, lange Maske
// scrollen, Speichern weg".
const Z_SCHWEBEND = 1100;

// Was oben klebt, verdeckt die Leiste, ohne dass der Beobachter davon weiss:
// die Navigationsleiste liegt als `sticky` darueber (52 px plus Aussparung plus
// Offline-Balken). Ein Knopf DAHINTER ist nicht zu sehen, der Beobachter hielt
// ihn aber fuer „im Bild" — ein Streifen, in dem es gar keinen Speichern-Knopf
// gab. Gemessen statt gerechnet: die Leiste traegt ihre Hoehe selbst.
function obenVerdeckt() {
  try {
    const nav = document.querySelector('nav[data-tour="nav"]');
    return nav ? Math.max(0, Math.round(nav.getBoundingClientRect().bottom)) : 0;
  } catch { return 0; }
}

// Nur EIN schwebender Knopf. Liegt ein Dialog ueber einer offenen Maske, haben
// beide etwas Offenes — zwei Leisten am unteren Rand waeren die Frage, welche
// zu welchem Formular gehoert. Es gewinnt die zuletzt angemeldete: bei einem
// Dialog ueber der Seite ist das der Dialog.
let _schwebende = [];
const _horcher = new Set();
function _melden(id, an) {
  _schwebende = an ? [..._schwebende.filter((x) => x !== id), id] : _schwebende.filter((x) => x !== id);
  _horcher.forEach((f) => f());
}
function _abo(f) { _horcher.add(f); return () => _horcher.delete(f); }
function _oberste() { return _schwebende[_schwebende.length - 1]; }

/**
 * Speichern + Abbrechen + der Hinweis „nicht gespeichert".
 *
 * Sichtbar wird sie erst, wenn wirklich etwas offen ist — ein dauerhaft
 * ausgegrauter Knopf ist Möblierung, kein Hinweis. `immer` zeigt sie trotzdem
 * (für Formulare, in denen der Knopf am festen Platz stehen soll).
 */
/**
 * Schwebt die Leiste gerade — und zeigt sie dann NUR noch unten?
 *
 * Zwei Faelle, und der Unterschied ist eine Entscheidung der Seite:
 *
 *   normal      – angeheftet wird erst, wenn die eigentliche Leiste aus dem
 *                 Bild gescrollt ist. Solange sie zu sehen ist, waeren zwei
 *                 Speichern-Knoepfe die Frage, welcher der richtige ist.
 *   immerUnten  – die Leiste steht von Anfang an am unteren Rand, und die
 *                 inline-Fassung faellt dafuer weg. Fuer Masken, die in einer
 *                 langen Liste aufklappen (Personen, Kinder im Kurs): dort
 *                 liegt der Knopf sonst irgendwo zwischen dreissig Zeilen, und
 *                 „ist das jetzt gespeichert?" beantwortet ihn niemand.
 *
 * Als reine Funktion, damit sie ohne Browser pruefbar ist (siehe
 * speichern.test.js) — dieselbe Bauform wie `zeigenNoetig` im Installhinweis.
 */
export function sollSchweben({ angeheftet = true, geaendert, immerUnten = false, imBild = true }) {
  return !!(angeheftet && geaendert && (immerUnten || !imBild));
}

export default function Speicherleiste({ entwurf, immer = false, style, klein = false, angeheftet = true,
                                         immerUnten = false }) {
  const { t } = useLanguage();
  useVerlassenWarnung(entwurf.geaendert, t("speichern.verlassen"));
  // Steht die Leiste noch im Bild? Sonst wandert sie an den unteren
  // Bildschirmrand — der Grund kommt aus dem Gebrauch: „den Speichern-Knopf
  // uebersieht man gerne und muss suchen". Auf einer langen Seite (Kursmaske,
  // Sitzplan, Notenbuch) liegt er weit oben oder weit unten, waehrend getippt
  // wird. Angeheftet wird NUR, wenn wirklich etwas offen ist und die
  // eigentliche Leiste nicht zu sehen ist — zwei sichtbare Speichern-Knoepfe
  // nebeneinander waeren die Frage, welcher der richtige ist.
  const anker = useRef(null);
  const [imBild, setImBild] = useState(true);
  useEffect(() => {
    const el = anker.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const beobachter = new IntersectionObserver(([e]) => setImBild(e.isIntersecting),
      { threshold: 0.1, rootMargin: `-${obenVerdeckt()}px 0px 0px 0px` });
    beobachter.observe(el);
    return () => beobachter.disconnect();
  }, [entwurf.geaendert]);

  // Schweben soll sie, wenn etwas offen und die eigentliche Leiste nicht zu
  // sehen ist. Ob sie es DARF, entscheidet das Register oben — sichtbar ist
  // immer nur die oberste.
  const willSchweben = sollSchweben({ angeheftet, geaendert: entwurf.geaendert, immerUnten, imBild });
  const id = useId();
  useEffect(() => {
    if (!willSchweben) return undefined;
    _melden(id, true);
    return () => _melden(id, false);
  }, [willSchweben, id]);
  const oberste = useSyncExternalStore(_abo, _oberste, _oberste);

  if (!entwurf.geaendert && !immer) return null;
  const grund = klein ? { ...btnSmall } : null;
  const knoepfe = (
    <>
      {entwurf.geaendert && (
        <span style={{ fontSize: 12, color: C.warning, whiteSpace: "nowrap" }}>{t("speichern.offen")}</span>
      )}
      <button onClick={entwurf.speichern} disabled={!entwurf.geaendert || entwurf.laeuft}
        style={{ ...btnPrimary, ...grund, opacity: entwurf.geaendert && !entwurf.laeuft ? 1 : 0.5 }}>
        {entwurf.laeuft ? t("speichern.laeuft") : t("common.save")}
      </button>
      <button onClick={entwurf.verwerfen} disabled={!entwurf.geaendert || entwurf.laeuft}
        style={{ ...btnSecondary, ...grund, opacity: entwurf.geaendert && !entwurf.laeuft ? 1 : 0.5 }}>
        {t("common.abort")}
      </button>
    </>
  );
  const schwebt = willSchweben && oberste === id;
  // Bei `immerUnten` steht die Leiste unten — dann darf sie hier nicht noch
  // einmal stehen. Solange nichts offen ist, bleibt die Zeile an ihrem Platz
  // (sie ist dann ohnehin leer oder zeigt die abgeblendeten Knoepfe bei
  // `immer`), damit die Maske nicht bei jedem Tastendruck springt.
  const inlineAus = immerUnten && schwebt;
  return (
    <>
      <span ref={anker} style={{ display: inlineAus ? "none" : "inline-flex", alignItems: "center", gap: 8, ...style }}>
        {knoepfe}
      </span>
      {schwebt && typeof document !== "undefined" && createPortal(
        // Am body und nicht in der Seite: eine Karte mit `overflow` oder
        // `transform` darueber wuerde ein `position: fixed` darin einsperren,
        // und die Leiste stuende wieder irgendwo statt am Bildschirmrand.
        <div style={{
          position: "fixed", left: "50%", transform: "translateX(-50%)",
          bottom: "max(16px, env(safe-area-inset-bottom))", zIndex: Z_SCHWEBEND,
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 12px", borderRadius: CONTROL_R + 4,
          background: "var(--card)", border: "1px solid var(--border2)", boxShadow: SHADOW.schwebend,
        }}>
          {knoepfe}
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * Der Fuß eines Formulardialogs: Speichern, Abbrechen, dann `children`
 * (das Löschen, das sich per `marginLeft:auto` nach rechts absetzt).
 *
 * Dieselben vier Zeilen standen in sechs Dialogen (Methoden, Kalender zweimal,
 * Karten, Noten, Klassenarbeit). `Speicherleiste` daneben bleibt die Fassung
 * für einen Entwurf auf der Seite — hier geht es um einen Dialog, der mit dem
 * Speichern zugeht.
 */
export function DialogFuss({ onSpeichern, onAbbrechen, aus = false, speichern, children, style }) {
  const { t } = useLanguage();
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center", ...style }}>
      <button onClick={onSpeichern} disabled={aus} style={{ ...btnPrimary, opacity: aus ? 0.6 : 1 }}>{speichern || t("common.save")}</button>
      <button onClick={onAbbrechen} style={btnSecondary}>{t("common.abort")}</button>
      {children}
    </div>
  );
}
