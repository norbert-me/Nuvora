import { Children, Fragment, useEffect, useId, useLayoutEffect, useRef } from "react";

import { kommaRund } from "../core/zahl.js";
import { quantil } from "../core/statistik.js";

const iconSvg = { fill: "none", stroke: "var(--text3)", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" };

// Icon skaliert standardmäßig mit der Schriftgröße (1em) und sitzt auf der
// Textlinie — so bleibt jedes Symbol im Verhältnis zum umgebenden Text. Eine
// feste Größe (px als Zahl oder z.B. "1.2em") bleibt möglich, wo gewollt.
export function Icon({ d, color, size, style, ...props }) {
  // Default 18px statt 1em: die feinen Strich-Icons wirkten bei 1em (~14px)
  // durchgehend zu klein. Explizite size-Angaben bleiben unberuehrt.
  //
  // style wird GEMERGT, nicht ersetzt: ein `style={{ transform: … }}` von aussen
  // hat vorher width/height/fill mitgeloescht — das Icon wurde dann so breit wie
  // seine Zelle und schwarz gefuellt (der Pfeil im Notenbuch war ein Dreieck
  // ueber die halbe Zeile).
  const s = size || 18;
  return (
    <svg style={{ ...iconSvg, width: s, height: s, stroke: color || iconSvg.stroke, verticalAlign: "-0.125em", flexShrink: 0, ...style }} viewBox="0 0 20 20" {...props}>
      {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
    </svg>
  );
}

// Icon je Modul (Schluessel = Modul-Key aus REGISTRY). Genutzt in Modul-Auswahl
// und Dashboard, damit beide dasselbe Bild zeigen.
export const MODULE_ICONS = {
  cardvote: ["M3 5h14v10H3z", "M6.5 10l2 2 3.5-4"],
  karten: ["M7 6h8a1 1 0 011 1v7a1 1 0 01-1 1H7a1 1 0 01-1-1V7a1 1 0 011-1z", "M4 5v8a1 1 0 001 1"],
  lernpfad: ["M6 3v14", "M14 3v14", "M6 6h8", "M6 10h8", "M6 14h8"],
  auswertung: ["M3 16h14", "M5 16V9", "M10 16V4", "M15 16v-5"],
  "code-detektiv": ["M9 3a5.5 5.5 0 100 11 5.5 5.5 0 000-11z", "M13.5 13l3 3", "M7.3 7.5L6 8.8l1.3 1.3", "M10.7 7.5L12 8.8l-1.3 1.3"],
  kalender: ["M4 5h12v11H4z", "M4 8h12", "M7 3v3", "M13 3v3"],
  orga: ["M7 4h6v2H7z", "M6 5H5a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1V6a1 1 0 00-1-1h-1", "M7 10h6", "M7 13h4"],
  zufall: ["M4 6h3l7 8h3", "M4 14h3l2-2.5", "M12 8l2-2.5", "M14 4l2.5 2-2.5 2", "M14 12l2.5 2-2.5 2"],
  unterrichtsplanung: ["M4 4h9l3 3v9a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z", "M13 4v3h3", "M6 10h6", "M6 13l1.2 1.2 2.3-2.4"],
  sitzplan: ["M4 5h5v4H4z", "M11 5h5v4h-5z", "M4 11h5v4H4z", "M11 11h5v4h-5z"],
  ausleihe: ["M4 7l6-3 6 3v6l-6 3-6-3z", "M4 7l6 3 6-3", "M10 10v6"],
  material: ["M4 6a1 1 0 011-1h3l1.5 2H15a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1z"],
  notizbrett: ["M4 4h12v12H4z", "M7 8h6", "M7 11h5", "M7.5 14l1.3 1.3 2.4-2.6"],
  notizen: ["M6 4h8a1 1 0 011 1v11l-2.5-1.5L10 17l-2.5-1.5L5 17V5a1 1 0 011-1z", "M8 8h4", "M8 11h4"],
  klassenleitung: ["M7 4a2.5 2.5 0 100 5 2.5 2.5 0 000-5z", "M3 16c0-2.5 1.8-4 4-4s4 1.5 4 4", "M13 9h4", "M13 12h4", "M12 6h5a1 1 0 011 1v3"],
  mathespiele: ["M10 3a7 7 0 100 14 7 7 0 000-14z", "M10 6.5l2.5 1.8-1 3h-3l-1-3z"],
  tafel: ["M3 4h14v10H3z", "M7 8h6", "M7 11h4", "M8 17l2-3 2 3"],
};

export const ICONS = {
  trash: ["M4 6h12", "M8 6V4.6a1.4 1.4 0 011.4-1.4h1.2A1.4 1.4 0 0112 4.6V6", "M6 6l.7 9.6a1.6 1.6 0 001.6 1.5h3.4a1.6 1.6 0 001.6-1.5L14 6", "M8.6 9v4.4M11.4 9v4.4"],
  fit: ["M4 7V4h3", "M13 4h3v3", "M16 13v3h-3", "M7 16H4v-3"],
  duplicate: ["M7 3h8a2 2 0 012 2v8", "M3 7h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"],
  download: ["M10 3v10M6 9l4 4 4-4", "M3 15v1a2 2 0 002 2h10a2 2 0 002-2v-1"],
  edit: ["M13.5 3.5l3 3L7 16H4v-3L13.5 3.5z"],
  move: ["M5 10h10M12 6l4 4-4 4", "M3 4v12"],
  // Verschieben in alle Richtungen: Kreuz mit vier Pfeilspitzen (weit gespreizt,
  // damit sich die Spitzen nicht überlappen).
  moveAll: ["M10 2v16", "M2 10h16", "M7.5 4.5L10 2l2.5 2.5", "M7.5 15.5L10 18l2.5-2.5", "M4.5 7.5L2 10l2.5 2.5", "M15.5 7.5L18 10l-2.5 2.5"],
  shuffle: ["M3 6h2l4 8h2l4-8h2M3 14h2l2-3M13 6h2l-2 3"],
  open: ["M10 3L17 10L10 17", "M17 10H3"],
  pdf: ["M5 2h7l4 4v11a2 2 0 01-2 2H5a2 2 0 01-2-2V4a2 2 0 012-2z", "M12 2v4h4"],
  // Matched Paar Export/Import: gleiche Box + gleicher Schaft, nur die Pfeilspitze
  // wechselt die Seite (raus = export, rein = import). IMMER dieses Paar für
  // Datei-Export/-Import verwenden — modulübergreifend einheitlich.
  export: ["M12 3h5v5", "M17 3L9 11", "M15 11v5a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h5"],
  import: ["M9 6v5h5", "M17 3L9 11", "M15 11v5a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h5"],
  // Pfeil nach oben auf eine Grundlinie — reines Hochladen (Datei o.ä.).
  // Fürs „Teilen/Veröffentlichen zum Marktplatz" gilt jetzt `share` (einheitlich).
  upload: ["M12 16V4M12 4L7 9M12 4l5 5", "M4 20h16"],
  chart: ["M3 17h14", "M5 13v4M9 9v8M13 11v6M17 7v10"],
  archive: ["M3 5a2 2 0 012-2h10a2 2 0 012 2v1H3V5z", "M4 6h12v11a2 2 0 01-2 2H6a2 2 0 01-2-2V6z", "M8 10h4"],
  restore: ["M10 3L3 10L10 17", "M3 10H17"],
  grip: ["M7 5.5h.01M7 10h.01M7 14.5h.01M13 5.5h.01M13 10h.01M13 14.5h.01"],
  close: ["M5 5l10 10M15 5L5 15"],
  plus: ["M10 4v12M4 10h12"],
  refresh: ["M15.5 9A5.5 5.5 0 0 0 6 5.5", "M15.5 4.5V9H11", "M4.5 11A5.5 5.5 0 0 0 14 14.5", "M4.5 15.5V11H9"],
  folder: ["M3 5.5A1.5 1.5 0 014.5 4h3l1.5 2h6.5A1.5 1.5 0 0117 7.5v7A1.5 1.5 0 0115.5 16h-11A1.5 1.5 0 013 14.5z"],
  note: ["M6 3h5l3 3v10a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z", "M11 3v3h3", "M7.5 10h5M7.5 13h4"],
  minus: ["M4 10h12"],
  more: ["M5 10h.01M10 10h.01M15 10h.01"],
  // Info: Kreis mit „i" (Erklär-Popup der Modulauswahl).
  info: ["M10 3a7 7 0 100 14 7 7 0 000-14z", "M10 9v4.5", "M10 6.6v.01"],
  // Teilen: drei verbundene Knoten. EINHEITLICH fuer „Teilen/Veroeffentlichen".
  share: ["M14.5 3a2 2 0 100 4 2 2 0 100-4z", "M5.5 8a2 2 0 100 4 2 2 0 100-4z", "M14.5 13a2 2 0 100 4 2 2 0 100-4z", "M7.3 9.1l5.9 3.3M13.2 6.6L7.3 9.9"],
  calendar: ["M4 5h12v11H4z", "M4 8h12M7 3v4M13 3v4"],
  clock: ["M10 4a6 6 0 100 12 6 6 0 000-12z", "M10 7v3.2l2.2 1.3"],
  // Auge (Ansicht/Präsentation), Kreis (neutrale Markierung), ban (gesperrt).
  eye: ["M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z", "M10 7.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z"],
  // Durchgestrichenes Auge: „zaehlt nicht mit" / „bleibt draussen".
  eyeOff: ["M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z", "M10 7.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z", "M3.5 3.5l13 13"],
  circle: ["M10 3.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13z"],
  ban: ["M10 3a7 7 0 100 14 7 7 0 000-14z", "M5.5 5.5l9 9"],
  // Kette (externe Quelle/Verknuepfung) — ersetzt das Emoji 🔗, das je nach
  // System und Theme anders aussieht und sich nicht einfaerben laesst.
  link: ["M8.5 11.5a3 3 0 004.2 0l2.6-2.6a3 3 0 10-4.2-4.2l-.9.9",
         "M11.5 8.5a3 3 0 00-4.2 0l-2.6 2.6a3 3 0 104.2 4.2l.9-.9"],
  // Sonne = unterrichtsfrei (Ferien/Feiertag). Ersetzt 🌴.
  sun: ["M10 6.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z",
        "M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6L16 16M16 4l-1.4 1.4M5.4 14.6L4 16"],
  // Gluehbirne = Vorschlag/Idee (Einstieg). Ersetzt 💡.
  bulb: ["M7.5 12.5a4.5 4.5 0 115 0V14h-5v-1.5z", "M8 16h4", "M8.8 17.5h2.4"],
  // Zahnrad: Mittelkreis + 8 Speichen (Ansicht-/Einstellungen-Menü).
  // Lupe, Personen, Etikett — fuer die globale Suche (Seiten, Klassen, Themen).
  search: ["M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11z", "M13.2 13.2L17 17"],
  users: ["M7.5 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5z", "M3 16c0-2.2 2-3.6 4.5-3.6S12 13.8 12 16",
          "M13.5 8.6a2 2 0 100-4", "M14 12.6c1.9.2 3 1.5 3 3.4"],
  tag: ["M10.6 3H16a1 1 0 011 1v5.4a1 1 0 01-.3.7l-6.6 6.6a1 1 0 01-1.4 0l-5.4-5.4a1 1 0 010-1.4l6.6-6.6a1 1 0 01.7-.3z",
        "M13.4 6.6h.01"],
  // Nachgetragen, weil Seiten sonst Unicode-Zeichen oder Emoji als Bedien-
  // Symbol benutzt haben (↑ ↓ ▲ ▾ ⚠️ 🖼️ ▶ ❚❚ 🔇 🔊). Alles hier, damit es
  // genau eine Quelle gibt.
  arrowUp: ["M10 16V4", "M5 9l5-5 5 5"],
  arrowDown: ["M10 4v12", "M5 11l5 5 5-5"],
  arrowLeft: ["M16 10H4", "M9 5l-5 5 5 5"],
  arrowRight: ["M4 10h12", "M11 5l5 5-5 5"],
  check: ["M4 10.5l4 4 8-9"],
  flame: ["M10 2c0 3.3-3.3 5-3.3 8.3a3.3 3.3 0 006.6 0C13.3 7 10 5.3 10 2z"],
  // Offener Kreisbogen — dreht sich als Endlos-Animation sauber. `refresh`
  // (Doppelpfeil-Kreislauf) sieht dabei aus, als haenge er.
  spinner: ["M17.5 10a7.5 7.5 0 1 1-5.2-7.1"],
  // Drehen (Griff an Tisch und Tafel). Nicht `refresh` — das meint neu laden.
  rotate: ["M15.5 8A6 6 0 1 0 16 11", "M15.5 3.5V8H11"],
  menu: ["M3 6h14", "M3 10h14", "M3 14h14"],
  moon: ["M16 12.2A6.5 6.5 0 017.8 4a6.5 6.5 0 108.2 8.2z"],
  // EINE Person (Profil). `users` ist die Gruppe und waere hier das falsche Bild.
  user: ["M10 4a3 3 0 100 6 3 3 0 000-6z", "M4 17c0-3 2.7-4.6 6-4.6s6 1.6 6 4.6"],
  // Aus dem Code-Detektiv hochgezogen: die Regel ist eine Design-Quelle, und
  // ein Modul mit eigenem Icon-Satz ist der Anfang von zwei Saetzen.
  puzzle: ["M4 4h3.6a1.6 1.6 0 013.2 0H14v3.6a1.6 1.6 0 000 3.2V16h-3.2a1.6 1.6 0 00-3.2 0H4v-3.4a1.6 1.6 0 000-3.2V4z"],
  map: ["M2 5.5l4-2 4 2 4-2 4 2v11l-4 2-4-2-4 2-4-2z", "M6 3.5v11", "M14 5.5v11"],
  gamepad: ["M6.5 6h7a4.5 4.5 0 014.5 4.5v1.6a2 2 0 01-3.6 1.2L13 12H7l-1.4 1.3A2 2 0 012 12.1v-1.6A4.5 4.5 0 016.5 6z", "M5 8.8v2.4", "M3.8 10h2.4", "M13.6 9.2h.01", "M15.4 11h.01"],
  trophy: ["M6 3h8v4.5a4 4 0 01-8 0V3z", "M6 4.6H4.4A2 2 0 006.6 8", "M14 4.6h1.6A2 2 0 0113.4 8", "M10 11.5V14", "M7 17h6l-.7-3h-4.6z"],
  star: ["M10 3l2.1 4.3 4.7.7-3.4 3.3.8 4.7L10 13.8 5.8 16l.8-4.7L3.2 8l4.7-.7z"],
  party: ["M3 17l4-9 5.5 5z", "M12 3v2.2", "M16.4 5.6l-1.5 1.5", "M17 10.2h-2.2", "M9.6 6.4l1.2 1.2"],
  hourglass: ["M6 3h8", "M6 17h8", "M6.8 3v3.2L10 10l-3.2 3.8V17", "M13.2 3v3.2L10 10l3.2 3.8V17"],
  undo: ["M7 6L4 9l3 3", "M4 9h7.5a4 4 0 010 8H9"],
  checkCircle: ["M16.5 9.3V10a6.5 6.5 0 11-3.9-6", "M7 9.8l2.6 2.6L17 5"],
  swap: ["M4 7.5h11l-2.5-2.5", "M16 12.5H5l2.5 2.5"],
  print: ["M6 7.5V3.5h8v4", "M4.5 7.5h11v6h-2.5", "M7 13.5H4.5", "M6.5 11.5h7v5h-7z"],
  camera: ["M3.5 6.5h3l1.5-2h4l1.5 2h3v9h-13z", "M10 13a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"],
  chevronUp: ["M5 12.5l5-5 5 5"],
  chevronLeft: ["M12.5 5l-5 5 5 5"],
  chevronRight: ["M7.5 5l5 5-5 5"],
  chevronDown: ["M5 7.5l5 5 5-5"],
  image: ["M3.5 4.5h13v11h-13z", "M3.5 12.5l3.5-3.5 3 3 2.5-2.5 4 4", "M7 8h.01"],
  warn: ["M10 3.2L2.8 16h14.4L10 3.2z", "M10 8.2v3.4", "M10 13.6h.01"],
  play: ["M6.5 4.5l8 5.5-8 5.5z"],
  pause: ["M7.5 4.5v11", "M12.5 4.5v11"],
  volume: ["M4 8v4h3l3.5 3V5L7 8H4z", "M13.5 7.5a3.5 3.5 0 010 5", "M15.8 5.4a6.5 6.5 0 010 9.2"],
  volumeOff: ["M4 8v4h3l3.5 3V5L7 8H4z", "M13.5 8l4 4", "M17.5 8l-4 4"],
  textSmaller: ["M3 15L7 5l4 10", "M4.3 12h5.4", "M13 10h4"],
  textLarger: ["M3 15L7 5l4 10", "M4.3 12h5.4", "M13 10h4", "M15 8v4"],
  settings: ["M10 7.6a2.4 2.4 0 100 4.8 2.4 2.4 0 000-4.8z",
    "M10 2v2.2M10 15.8V18M2 10h2.2M15.8 10H18M4.4 4.4l1.6 1.6M14 14l1.6 1.6M15.6 4.4L14 6M6 14l-1.6 1.6"],
};

// ─── Seiten-Shells ───
// Genau DREI Seitenbreiten für die ganze App, alle zentriert. Jede Seite nutzt
// eine davon per Spread am Wurzel-Container — keine Seite definiert mehr eine
// eigene Breite. So springt beim Wechsel nichts mehr.
//   pageApp  — jede eingeloggte Modul-/Kernseite (Standard).
//   pageForm — Formular-/Auth-/Bestätigungsseiten (Login, Kontakt, Profil …).
//   pageFull — Vollbild-Flächen (Tafel, Sitzplan-Canvas, Live-Session/Beamer).
export const pageApp = { maxWidth: 960, margin: "0 auto", width: "100%", boxSizing: "border-box" };
export const pageForm = { maxWidth: 480, margin: "0 auto", width: "100%", boxSizing: "border-box" };
export const pageFull = { maxWidth: "100%", margin: "0 auto", width: "100%", boxSizing: "border-box" };

export const iconBtn = { cursor: "pointer", padding: "6px", border: "none", background: "transparent", borderRadius: 6, display: "inline-flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s" };

// ─── EINE Hoehe fuer alles, was in einer Werkzeugleiste nebeneinander steht ───
// Reiter, Hinzufuegen-Knopf, Auge, Datumsfeld: jedes Element hatte seine Hoehe
// selbst gesetzt (Reiter ~30 aus Polsterung, Auge 34, Plus 36, Datumsfeld 38).
// Nebeneinander sah das aus wie drei verschiedene Groessen — am deutlichsten am
// Plus, das ueber den Reitern stand. Wer eine Leiste baut, nimmt diese Hoehe;
// abweichen nur mit Grund.
export const CONTROL_H = 34;

// … und EINE Form. Nebeneinander standen zuletzt eine Pille (Reiter), ein
// Rechteck mit Radius 10 (Plus) und ein Kreis (⋯) — drei Formen fuer drei
// gleichrangige Knoepfe. Wer eine Leiste baut, nimmt beides: `CONTROL_H` und
// `CONTROL_R`.
// Eckig mit runden Ecken (10) — nicht Kreis, nicht Pille. Nebeneinander lagen
// zuletzt ein Rechteck, ein Kreis und ein Knopf ganz ohne Rahmen; drei Formen
// fuer drei gleichrangige Knoepfe.
export const CONTROL_R = 10;

// Icon-Knopf in einer Werkzeugleiste: quadratisch auf Leistenhoehe. `iconBtn`
// bleibt daneben stehen — der wird auch in Tabellenzeilen benutzt, und dort
// waeren 34 px zu wuchtig.
// Icon-Knopf einer Werkzeugleiste: quadratisch auf Leistenhoehe, MIT Rahmen.
// Der Rahmen gehoert dazu — ein Knopf ohne ihn sieht neben den anderen aus wie
// ein vergessenes Bild.
export const toolbarIconBtn = {
  ...iconBtn, width: CONTROL_H, height: CONTROL_H, borderRadius: CONTROL_R,
  border: "1px solid var(--border2)", background: "var(--bg)", boxSizing: "border-box",
  // Ein Icon-Knopf ist quadratisch — und bleibt es. Ohne `flexShrink: 0` quetscht
  // ihn eine enge Zeile zusammen (auf schmalen Geraeten aus 34 mal 34 ein
  // 19 mal 36 grosses Oval), und ohne `alignSelf` zieht ihn ein Elternteil mit
  // `align-items: stretch` in die Laenge. `AddButton` hatte das laengst, die
  // uebrigen Icon-Knoepfe nicht.
  flexShrink: 0, alignSelf: "center",
};

// EINHEITLICHER Hinzufügen-Knopf: quadratisch, nur ein „+" (Akzentfarbe), das
// Label steckt in title/aria-label. So sehen ALLE „Hinzufügen"-Aktionen gleich
// aus — nicht mal Text, mal btnPrimary. Abweichung nur per Spread ableiten.
export function AddButton({ onClick, title, size = CONTROL_H, style, ...rest }) {
  return (
    <button onClick={onClick} title={title} aria-label={title} className="icon-btn"
      style={{ ...iconBtn, width: size, height: size, border: "1px solid var(--border2)", borderRadius: CONTROL_R, flexShrink: 0, ...style }} {...rest}>
      <Icon d={ICONS.plus} size={20} color="var(--accent)" />
    </button>
  );
}

// Einheitliche Erkennbarkeit für alles, was eine Datei herunterlädt: Icon + Label,
// immer gleiche Pille — ersetzt uneinheitliche reine Textlinks / "↓"-Zeichen.
export const downloadBtn = {
  display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
  padding: "6px 14px", border: "1px solid var(--border2)", borderRadius: CONTROL_R,
  background: "var(--card)", color: "var(--text2)", fontSize: 13, fontWeight: 500,
  textDecoration: "none", transition: "all 0.15s",
};

export function DownloadLink({ children, style, ...props }) {
  const Tag = props.href ? "a" : "button";
  return (
    <Tag {...props} style={{ ...downloadBtn, ...style }}>
      <Icon d={ICONS.download} size={14} />
      {children}
    </Tag>
  );
}

// ─── Buttons ───
// Lagen frueher in jeder Seite einzeln und sind auseinandergelaufen: vier
// Varianten von btnPrimary, fuenf von btnSecondary — mal 14px, mal 13.5px,
// mal mit, mal ohne letterSpacing. Verbindlich ist ab hier diese eine Quelle.
export const btnPrimary = {
  padding: "9px 18px", cursor: "pointer", fontSize: 14, border: "none",
  borderRadius: CONTROL_R, background: "var(--text)", color: "var(--bg)",
  fontWeight: 600, letterSpacing: "-0.1px",
};

export const btnSecondary = {
  padding: "9px 18px", cursor: "pointer", fontSize: 14,
  border: "1px solid var(--border2)", borderRadius: CONTROL_R,
  background: "var(--card)", color: "var(--text)",
  fontWeight: 500, letterSpacing: "-0.1px",
};

// Kleinere Variante fuer Knoepfe in Zeilen und Tabellen.
export const btnSmall = { padding: "5px 12px", fontSize: 13 };

// Einheitliche Export-/Import-Knoepfe (Icon + Label) — moduluebergreifend
// dasselbe Aussehen und Verhalten. Nie je Seite nachbauen.
export function ExportButton({ label, onClick, style, iconOnly, ...props }) {
  if (iconOnly)
    return (
      <button onClick={onClick} className="icon-btn" style={{ ...iconBtn, ...style }} {...props}>
        <Icon d={ICONS.export} size={18} />
      </button>
    );
  return (
    <button onClick={onClick} style={{ ...btnSecondary, display: "inline-flex", alignItems: "center", gap: 6, ...style }} {...props}>
      <Icon d={ICONS.export} size={15} /> {label}
    </button>
  );
}
/**
 * Datei-Auswahl per Aufruf statt per `<label>`.
 *
 * Der Import steht jetzt im „Mehr"-Menue, und ein Menueeintrag ist ein Knopf,
 * kein Label — er kann kein verstecktes `<input type=file>` umschliessen. Also
 * eins auf Zuruf bauen, oeffnen, wieder wegwerfen.
 */
export function dateiWaehlen(onFile, accept = ".json,application/json") {
  const feld = document.createElement("input");
  feld.type = "file";
  feld.accept = accept;
  feld.style.display = "none";
  feld.addEventListener("change", () => {
    if (feld.files[0]) onFile(feld.files[0]);
    feld.remove();
  });
  document.body.appendChild(feld);
  feld.click();
}

export function ImportButton({ label, onFile, accept = ".json,application/json", style, iconOnly, ...props }) {
  if (iconOnly)
    return (
      <label className="icon-btn" style={{ ...iconBtn, cursor: "pointer", ...style }} {...props}>
        <Icon d={ICONS.import} size={18} />
        <input type="file" accept={accept} style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) onFile(e.target.files[0]); e.target.value = ""; }} />
      </label>
    );
  return (
    <label style={{ ...btnSecondary, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, ...style }} {...props}>
      <Icon d={ICONS.import} size={15} /> {label}
      <input type="file" accept={accept} style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) onFile(e.target.files[0]); e.target.value = ""; }} />
    </label>
  );
}

// Bewusst NICHT vereinheitlicht, weil kontextgebunden und je Gruppe stimmig:
//   Formularseiten (Login, Contact, ResetPassword) — volle Breite, 15px
//   Bestaetigungsseiten (VerifyEmail, ConfirmEmailChange) — inline, 12px 24px
//   Session — 15px in Akzentfarbe, weil vom Beamer aus lesbar
// Wer eine dieser Seiten anfasst, bleibt bei der Gruppe statt hierher zu greifen.

// ─── Seitenkopf ───
// 22px, wie in CardVote seit jeher. Neuere Seiten hatten 24 und 26.
// Einheitlicher Select-Look: eigener Chevron statt des eckigen OS-Selects.
// caretSvg ist ein grauer Chevron als Hintergrundbild (currentColor geht in
// background-image nicht, Grau liest sich in Hell wie Dunkel).
const caretSvg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238a8a8a' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E";
export const selectStyle = {
  appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
  // Hoehe und Form wie jedes andere Bedienelement einer Leiste (CONTROL_H /
  // CONTROL_R): das Klassen-Auswahlfeld war sichtbar hoeher als die Reiter
  // daneben.
  height: CONTROL_H, padding: "0 30px 0 12px", borderRadius: CONTROL_R, border: "1px solid var(--border2)",
  background: `var(--bg) url("${caretSvg}") no-repeat right 9px center`,
  color: "var(--text)", fontSize: 13, cursor: "pointer", lineHeight: 1.3, boxSizing: "border-box",
};

export const pageTitle = { fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 8 };
export const pageIntro = { color: "var(--text2)", fontSize: 14, marginBottom: 22, lineHeight: 1.6 };
// Kleine Abschnitts-Überschrift in Versalien (z.B. „Ganztägig", „Zusatz").
// Einheitlich aus dem Kern statt je Seite neu inlinen.
export const sectionLabel = { fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.5 };

export const COLORS = {
  danger: "#d1350f",
  success: "#0a7d3e",
  warning: "#8a6100",   // 4,7:1 auf Weiss — #b8860b lag bei 3,3:1 und wird klein gesetzt
  info: "#2563eb",       // Akzent-/Info-Blau (Badges, „entschuldigt", Standard-Klassenfarbe)
  correctBg: "#d4edda",
  incorrectBg: "#fde2d9",
  // Text auf der Akzentflaeche. Stand neunmal als "#fff" inline; als Token
  // laesst sich das an einer Stelle korrigieren, wenn der Akzent heller wird.
  aufAkzent: "#fff",
};

// ─── Wie gut ist diese Quote? EINE Schwelle, nicht sieben ───
//
// „ab 80 % grün, ab 50 % gelb, darunter rot" stand achtmal ausgeschrieben im
// Code — als Funktion (`colorForPct`, `cellStyle`, `pctStyle`) und als
// Bedingung mitten in einem style-Objekt (Auswertung dreimal, Beamer einmal).
// Acht Kopien einer Schwelle heißen: wer sie verschiebt, verschiebt sie an
// sieben Stellen und übersieht die achte — und dann ist dieselbe 79 % in der
// Klassenauswertung gelb und in der Schülerauswertung grün.
//
// Die Zahlen sind eine pädagogische Setzung, keine Rechnung; sie stehen
// deshalb hier bei den Farben und nicht in `core/`.
export const QUOTE_GUT = 80;
export const QUOTE_MITTEL = 50;

/** Schriftfarbe zu einer Trefferquote in Prozent; `null` = keine Angabe. */
export function quoteFarbe(pct) {
  if (pct == null) return "var(--text3)";
  if (pct >= QUOTE_GUT) return COLORS.success;
  if (pct >= QUOTE_MITTEL) return COLORS.warning;
  return COLORS.danger;
}

/** Dieselbe Aussage als Tabellenzelle: getönte Fläche plus Schriftfarbe. */
export function quoteFlaeche(pct) {
  if (pct == null) return { background: "var(--bg2)", color: "var(--text3)" };
  if (pct >= QUOTE_GUT) return { background: "var(--success-bg)", color: COLORS.success };
  if (pct >= QUOTE_MITTEL) return { background: "var(--warn-bg)", color: COLORS.warning };
  return { background: "var(--danger-bg)", color: COLORS.danger };
}

// Antwortfarben A-D (CardVote: Balken, Beamer, Scanner). Lagen dreimal getrennt
// im Code — bei einer Aenderung war die Legende danach eine andere Farbe als
// das Diagramm.
export const ANTWORT_COLORS = { A: "#0066cc", B: "#5856d6", C: COLORS.warning, D: COLORS.danger };

// Podium. Die Farbe IST der Platz, darum feste Werte und keine Variablen.
export const PODIUM_COLORS = ["#FFD700", "#C0C0C0", "#CD7F32"];

// Reifegrade der Karteikarten (Lehrer-Histogramm und Schuelerseite). Stand
// zweimal wortgleich da — auseinandergelaufen waere dieselbe Karte auf beiden
// Seiten verschieden eingefaerbt.
export const REIFE_COLORS = {
  neu: "#cbd5e1", lernen: "#f59e0b", kurz: "#eab308", mittel: "#84cc16", lang: COLORS.success,
};

// ─── Gemeinsame Bausteine (EINE Quelle fürs Modul-Design) ───
// Vorher definierte jede Seite fld/inputStyle/th/td/card selbst, mit leicht
// abweichenden Werten. Ab hier zentral — nicht mehr je Seite neu erfinden.

// Texteingabe. Zeilen-Variante (Standard) und volle Breite via { ...inputStyle, width:"100%" }.
export const inputStyle = {
  padding: "9px 12px", border: "1px solid var(--border2)", borderRadius: 10,
  fontSize: 14, background: "var(--bg)", color: "var(--text)", boxSizing: "border-box",
};

// ─── Datums-Navigator: ‹ [Datum] › Heute ───
// Kalender und Anwesenheit haben dieselbe Zeile, aber jede Seite hat ihre
// Masse selbst gesetzt: die Knoepfe klein und rund, das Datumsfeld mit dem
// vollen inputStyle (9 px Polsterung, 14 px Schrift, eckige Ecken). Es stand
// dadurch sichtbar hoeher als alles daneben. Feste Hoehe statt Polsterung ist
// hier der verlaessliche Weg — ein natives Datumsfeld bringt eine eigene
// innere Hoehe mit, die sich ueber padding nicht sauber angleichen laesst.
// Hoehe kommt aus CONTROL_H (oben) — der Navigator ist eine Werkzeugleiste wie
// jede andere und soll nicht seine eigene Groesse mitbringen.
export const toolbarBtn = {
  ...btnSecondary, height: CONTROL_H, padding: "0 14px", fontSize: 13, lineHeight: 1,
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
};
export const toolbarBtnPrimary = {
  ...btnPrimary, height: CONTROL_H, padding: "0 16px", fontSize: 13, lineHeight: 1,
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
};
export const toolbarInput = {
  ...inputStyle, height: CONTROL_H, padding: "0 12px", fontSize: 13, lineHeight: 1,
  borderRadius: CONTROL_R, // dieselbe Form wie die Knoepfe daneben
};
// Die alten Namen bleiben — der Datums-Navigator war nie etwas Eigenes, nur
// derselbe Baustein unter dem Namen einer einzigen Seite. Genau deshalb hat
// ihn `Karten.jsx` noch einmal als `leisteBtn`/`leisteInput` erfunden.
export const dateNavBtn = toolbarBtn;
export const dateNavInput = toolbarInput;

// Zeile in einem Menue (MehrMenu, Verschieben-Menue, Brotkrumen-Menue). Stand
// dreimal im Code, mit drei Radien (8/7/7).
export const menuRow = {
  display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "8px 10px",
  border: "none", background: "none", cursor: "pointer", fontSize: 13, textAlign: "left",
  color: "var(--text)", borderRadius: 8,
};

// ─── Schatten: drei, nicht zweiundzwanzig ───
// Es gab rund 22 verschiedene Formeln im Produkt. Ein Schatten sagt „wie weit
// liegt das ueber der Seite" — dafuer reichen drei Stufen, und mehr kann das
// Auge ohnehin nicht unterscheiden.
export const SHADOW = {
  ruhig: "0 1px 2px rgba(0,0,0,0.06)",       // liegt auf der Seite (Karte, Schalter)
  schwebend: "0 8px 24px rgba(0,0,0,0.18)",  // Popover, Menue, Toast
  ueber: "0 20px 50px rgba(0,0,0,0.3)",      // Modal — der ganze Bildschirm liegt darunter
};

// ─── Segment-Gruppe: mehrere Knoepfe, EIN Gedanke ───
//
// Vier Kaesten mit Luft dazwischen sind vier Dinge. Der Datums-Navigator
// (‹ [Datum] › Heute) war genau das: sechs senkrechte Rahmenlinien fuer eine
// einzige Frage — „welcher Tag?". Zusammengeschoben zu einer Gruppe sind es
// zwei Linien aussen und duenne Trenner innen; das Auge liest ein Bedienelement
// statt vier.
//
// `Tabs` macht das laengst richtig (ein Rahmen, Trenner innen) — hier ist
// dieselbe Bauform, aber offen fuer beliebige Kinder statt nur fuer Reiter.
// Die Kinder bringen KEINEN eigenen Rahmen mit: dafuer gibt es `segmentBtn`
// und `segmentInput`.
export function Segment({ children, style }) {
  const kinder = Children.toArray(children).filter(Boolean);
  return (
    <div style={{
      display: "inline-flex", alignItems: "stretch", height: CONTROL_H,
      border: "1px solid var(--border2)", borderRadius: CONTROL_R,
      // KEIN `overflow: hidden`: das schnitt jedes Popover ab, das ein Kind
      // aufmacht — im Kalender war der Sprung-Waehler fuer Monat und Woche
      // damit unsichtbar. Die Kinder sind ohnehin rahmen- und hintergrundlos,
      // es gibt also nichts, was ueber die runden Ecken laufen koennte.
      background: "var(--bg)", boxSizing: "border-box", ...style,
    }}>
      {kinder.map((k, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden style={{ width: 1, background: "var(--border2)", flexShrink: 0 }} />}
          {k}
        </Fragment>
      ))}
    </div>
  );
}

// Knopf IN einer Segment-Gruppe: kein eigener Rahmen, keine eigenen Ecken —
// die bringt die Gruppe mit. Sonst saehe man Rundung in der Rundung.
export const segmentBtn = {
  ...btnSecondary, height: "100%", padding: "0 12px", fontSize: 13, lineHeight: 1,
  border: "none", borderRadius: 0, background: "transparent",
  display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
};
export const segmentInput = {
  ...inputStyle, height: "100%", padding: "0 10px", fontSize: 13, lineHeight: 1,
  border: "none", borderRadius: 0, background: "transparent", textAlign: "center",
};

// ─── Datums-Navigator: eine Bauform fuer alle Seiten ───
//
// Kalender, Anwesenheit und das Notizbrett hatten dieselbe Zeile dreimal
// nachgebaut und waren dabei auseinandergelaufen: der Kalender zeichnete die
// Pfeile als SVG, die Anwesenheit als Textzeichen ‹ › in 17 px; der Kalender
// ueberschrieb die Polsterung der Pfeile auf 12, „Heute" behielt 14 — daher
// waren die Knoepfe verschieden breit.
//
// `mitte` ist das, was zwischen den Pfeilen steht: ein Datumsfeld
// (`segmentInput`), ein Titel mit Sprung-Popover, was die Seite braucht.
// „Heute" steht bewusst NEBEN der Gruppe: die Pfeile gehen einen Schritt,
// „Heute" springt — zwei verschiedene Dinge.
export function DatumNavigator({ onZurueck, onVor, onHeute, labelZurueck, labelVor, labelHeute, mitte, style }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", ...style }}>
      <Segment>
        <button onClick={onZurueck} title={labelZurueck} aria-label={labelZurueck} style={segmentBtn}>
          <Icon d={ICONS.chevronLeft} size={15} />
        </button>
        {mitte}
        <button onClick={onVor} title={labelVor} aria-label={labelVor} style={segmentBtn}>
          <Icon d={ICONS.chevronRight} size={15} />
        </button>
      </Segment>
      {onHeute && <button onClick={onHeute} style={dateNavBtn}>{labelHeute}</button>}
    </div>
  );
}

// Container-Karte (Listeneintrag, Modulblock).
export const cardStyle = {
  border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)", padding: 16,
};

// Zurückhaltendes Panel (Papierkorb, Hinweisblock).
export const panelStyle = {
  border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg3)", padding: 14,
};

// Tabellenkopf / -zelle (Noten, Orga …).
// Tabellenkopf: immer fixiert. Beim Scrollen durch eine Klassenliste stand
// sonst nach zehn Zeilen keine Spaltenbeschriftung mehr da, und man zaehlt
// Spalten ab. `position: sticky` braucht einen eigenen Hintergrund (sonst
// scheinen die Zeilen durch) und einen z-index ueber den Datenzellen. Zellen,
// die zusaetzlich LINKS kleben, setzen ihren z-index hoeher (siehe stickyL in
// Noten.jsx) — sonst verschwindet die Namensspalte unter dem Kopf.
export const th = {
  padding: "8px 6px", fontSize: 12, fontWeight: 600, color: "var(--text2)",
  borderBottom: "1px solid var(--border)", textAlign: "center", whiteSpace: "nowrap",
};

// Klebender Kopf — NUR fuer lange Tabellen, durch die man wirklich rollt.
//
// Er stand vorher am `th` selbst und galt damit fuer jede Tabelle. Bei einer
// Tabelle mit zwei Zeilen (Kontenverwaltung im Profil) sieht das kaputt aus:
// sobald die Karte am oberen Rand vorbeirollt, loest sich die Kopfzeile und
// legt sich ueber die erste Datenzeile — technisch richtig, optisch ein Fehler.
// Wo geklebt wird, entscheidet also die Tabelle.
//
// Wohin er klebt, sagt `--tabellenkopf-top`: Voreinstellung ist die Hoehe der
// Navigationsleiste (Seiten-Scroll); Tabellen mit eigenem Rollrahmen setzen die
// Variable bei sich auf 0 — dort ist der Rahmen der Bezug, nicht das Fenster.
export const thKlebend = {
  ...th,
  position: "sticky", top: "var(--tabellenkopf-top, 0px)",
  zIndex: 2, background: "var(--card)",
};
export const td = { padding: "4px 6px", borderBottom: "1px solid var(--border)", textAlign: "center", color: "var(--text)" };

// Erste Spalte, die beim Rollen nach rechts stehen bleibt (Namensspalte in
// Notenbuch, Klassenarbeit, Orga, Auswertungen). Sie war an sechs Stellen
// inline nachgebaut — und weil `thKlebend` schon existierte, war es reiner
// Zufall, dass alle sechs denselben Hintergrund und dieselbe Stapelhoehe
// trafen. Der z-index MUSS ueber dem der Datenzellen und unter dem des Kopfes
// liegen; wo Kopf UND Spalte kleben, gilt `thKlebendLinks` (siehe dort).
export const klebtLinks = { position: "sticky", left: 0, background: "var(--card)", zIndex: 1 };
// Ecke oben links: klebt in beide Richtungen und muss ueber dem Kopf liegen,
// sonst verschwindet die Namensspalte unter der Kopfzeile.
export const klebtLinksOben = { ...klebtLinks, zIndex: 4 };

/**
 * Zieht hier gerade jemand — oder markiert er nur Text?
 *
 * Ein ganzer Kasten mit `draggable` verschluckt jede Textmarkierung darin: wer
 * im Spaltennamen einen Tippfehler ausbessern will, schiebt stattdessen die
 * Spalte durch die Tabelle. Diese Prüfung gehört an JEDEN `onDragStart` eines
 * Containers, der Eingaben enthält (oder ein Menü öffnen kann).
 *
 *   onDragStart={(e) => { if (nichtZiehen(e)) return; … }}
 */
export function nichtZiehen(e) {
  const ziel = e.target;
  if (ziel?.closest?.("input, textarea, select, [contenteditable='true'], [data-nodrag]")) {
    e.preventDefault();
    return true;
  }
  return false;
}

// Kleiner Chip/Tag.
export const chipStyle = {
  display: "inline-block", fontSize: 12, fontWeight: 600, padding: "2px 9px",
  borderRadius: 980, background: "var(--bg3)", color: "var(--text2)",
};

// Gefärbtes Badge (z.B. Zähler): badge("#d1350f") -> roter Hinweis.
export const badge = (color) => ({
  fontSize: 12, fontWeight: 700, padding: "2px 9px", borderRadius: 980,
  background: color + "22", color,
});

// Einheitliches Popup/Modal. EINE Quelle für alle Dialoge — vorher baute jede
// Seite Overlay + Panel selbst (leicht andere z-index/Radius/Schatten).
// Klick auf den Hintergrund schließt; Inhalt fängt den Klick ab.
export const modalOverlay = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex",
  alignItems: "center", justifyContent: "center", padding: 16, zIndex: 1000, overflowY: "auto",
};
export const modalPanel = {
  background: "var(--card)", color: "var(--text)", borderRadius: 16, width: "100%",
  padding: 22, border: "1px solid var(--border)", boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
  maxHeight: "88vh", overflow: "auto", boxSizing: "border-box",
};
// Overlay-Klick soll NUR schließen, wenn Maus-Down UND -Up wirklich auf dem
// Overlay liegen. Eine Textauswahl, die im Panel startet und außerhalb endet,
// darf das Modal nicht schließen (sonst Datenverlust). Ein Modul-Flag reicht,
// da immer nur EINE Maus-Interaktion gleichzeitig läuft.
// Nutzung: <div {...overlayGuard(onClose)} style={modalOverlay}>…</div>
let _ovDown = false;
export function overlayGuard(onClose) {
  return {
    onMouseDown: (e) => { _ovDown = e.target === e.currentTarget; },
    onClick: (e) => { if (e.target === e.currentTarget && _ovDown) onClose(); },
  };
}
// Schwebendes Panel (Dropdown, Menü, Tooltip, Sprung-Popover). NUR die Oberfläche —
// Position/zIndex/minWidth je Aufrufer per Spread ergänzen:
// { ...popoverPanel, position:"absolute", top:.., right:.., zIndex:.. }.
export const popoverPanel = {
  background: "var(--card)", color: "var(--text)", border: "1px solid var(--border)",
  borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
  // Nie breiter als der Bildschirm: auf dem Handy ragte ein Menü sonst über den
  // Rand hinaus und war halb unsichtbar.
  maxWidth: "calc(100vw - 24px)",
};

// Aufklappmenü an einem Knopf. Die Ausrichtung (links/rechts/mittig) ist nur
// der Wunsch — nach dem Öffnen schiebt sich das Panel in den sichtbaren
// Bereich zurück. Auf dem Handy hing ein Menü sonst halb außerhalb, je nachdem
// wo sein Knopf stand. Der Elternknoten braucht position: relative.
export function Popover({ align = "left", style, children, ...rest }) {
  const ref = useRef(null);
  const basis = align === "center" ? "translateX(-50%)" : "";
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Naechster waagerecht scrollbarer Vorfahre — in einer breiten Tabelle wird
    // dort abgeschnitten, nicht am Fensterrand.
    const scrollElter = () => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if ((o === "auto" || o === "scroll") && p.scrollWidth > p.clientWidth + 1) return p;
      }
      return null;
    };
    const schieben = () => {
      el.style.transform = basis;
      const rand = 12;
      // Erst den Container mitziehen: ein Menue am rechten Rand einer breiten
      // Tabelle stand sonst halb ausserhalb — verschoben werden soll die
      // Tabelle, nicht das Menue aus seiner Zelle heraus.
      const box = scrollElter();
      if (box) {
        const r0 = el.getBoundingClientRect(), c = box.getBoundingClientRect();
        let ds = 0;
        if (r0.right > c.right - rand) ds = r0.right - (c.right - rand);
        else if (r0.left < c.left + rand) ds = r0.left - (c.left + rand);
        if (ds) box.scrollLeft += ds;
      }
      const r = el.getBoundingClientRect();
      let dx = 0;
      if (r.right > window.innerWidth - rand) dx = window.innerWidth - rand - r.right;
      if (r.left + dx < rand) dx = rand - r.left;
      el.style.transform = dx ? `${basis} translateX(${dx}px)`.trim() : basis;
    };
    schieben();
    window.addEventListener("resize", schieben);
    return () => window.removeEventListener("resize", schieben);
  });
  const pos = align === "center" ? { left: "50%", transform: basis } : { [align]: 0 };
  return (
    <div ref={ref} data-nodrag style={{ ...popoverPanel, position: "absolute", top: "calc(100% + 6px)", zIndex: 50, ...pos, ...style }} {...rest}>
      {children}
    </div>
  );
}
// Statistik-Kachel (Auswertungen): großer Wert + Label. EINE Quelle, damit die
// Auswertungen (CardVote, Klassenarbeit) gleich aussehen.
export function StatCard({ label, value, color, sub }) {
  return (
    <div style={{ padding: "10px 16px", background: "var(--bg2)", borderRadius: 12, textAlign: "center", minWidth: 80 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || "var(--text)" }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--text3)" }}>{label}</div>
      {sub != null && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

// ─── Boxplot (EINE Quelle) ───────────────────────────────────────────────────
// Horizontaler Boxplot mit Markierungen (Min · Q1 · Median · Q3 · Max) und
// Ausreißern (1,5·IQR). Vorher hatte jede Auswertung ihren eigenen — CardVote,
// Klassen-Auswertung, Klassenarbeit. Ab hier zentral: values + Skala (max).
// Das Quantil selbst ist Rechnung, keine Gestaltung — es liegt in
// `core/statistik.js` (dieselbe Formel stand als `quantile` noch einmal in
// `core/grades.js`). Der Name bleibt, damit die Aufrufer sich nicht ändern.
export const quantileOf = (sorted, p) => quantil(sorted, p, 0);
export function Boxplot({ values, max = 100, label, unit = "", compact = false }) {
  if (!values || values.length < 3) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantileOf(sorted, 0.25), med = quantileOf(sorted, 0.5), q3 = quantileOf(sorted, 0.75);
  const iqr = q3 - q1, loBound = q1 - 1.5 * iqr, hiBound = q3 + 1.5 * iqr;
  const inliers = sorted.filter((v) => v >= loBound && v <= hiBound);
  const lo = inliers.length ? inliers[0] : sorted[0];
  const hi = inliers.length ? inliers[inliers.length - 1] : sorted[sorted.length - 1];
  const outliers = sorted.filter((v) => v < loBound || v > hiBound);
  const pct = (v) => (max > 0 ? (v / max) * 100 : 0);
  // Eine Nachkommastelle, ganze Zahlen ohne Komma, deutsch geschrieben —
  // dieselbe Regel wie im Notenbuch, deshalb aus `core/zahl.js`.
  const fmt = (n) => kommaRund(n, 1);
  // Kompakt (Listenzeile im Vergleich): nur die Grafik, keine Beschriftungen.
  if (compact) {
    const mittel = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    return (
      <div style={{ position: "relative", height: 26, flex: 1, minWidth: 160 }}>
        {/* Gitter bei 0/25/50/75/100: ohne Bezugspunkte liest das Auge zwei
            Zeilen als „dramatisch verschieden", obwohl die Mittelwerte zwei
            Prozentpunkte auseinanderliegen. Die Skala ist fuer alle Zeilen
            dieselbe (0..max) — das Gitter macht sie sichtbar. */}
        {[0, 25, 50, 75, 100].map((g) => (
          <div key={g} style={{ position: "absolute", top: 3, left: `${g}%`, width: 1, height: 20,
            background: g === 50 ? "var(--border2)" : "var(--border)" }} />
        ))}
        <div style={{ position: "absolute", top: 12, left: `${pct(lo)}%`, width: `${pct(hi - lo)}%`, height: 3, background: "var(--border3)" }} />
        <div style={{ position: "absolute", top: 7, left: `${pct(lo)}%`, width: 2, height: 12, background: "var(--text3)" }} />
        <div style={{ position: "absolute", top: 7, left: `${pct(hi)}%`, width: 2, height: 12, background: "var(--text3)" }} />
        <div style={{ position: "absolute", top: 4, left: `${pct(q1)}%`, width: `${pct(q3 - q1)}%`, height: 18, background: "rgba(10,132,255,0.15)", border: "2px solid var(--accent)", borderRadius: 4 }} />
        <div style={{ position: "absolute", top: 2, left: `${pct(med)}%`, width: 3, height: 22, background: "var(--accent)", borderRadius: 2, transform: "translateX(-1.5px)" }} />
        {outliers.map((v, i) => (
          <div key={i} style={{ position: "absolute", top: 9, left: `${pct(v)}%`, width: 8, height: 8, borderRadius: 4, background: COLORS.danger, transform: "translateX(-4px)" }} />
        ))}
        {/* Der Mittelwert als Punkt: die Tabelle nennt ihn in der Spalte
            daneben, in der Grafik war er vorher gar nicht zu sehen — der
            Kasten zeigt die mittlere Haelfte, nicht den Schnitt. */}
        <div title={`⌀ ${fmt(mittel)}${unit}`}
          style={{ position: "absolute", top: 9, left: `${pct(mittel)}%`, width: 8, height: 8, borderRadius: 4,
            background: "var(--card)", border: "2px solid var(--accent)", transform: "translateX(-4px)" }} />
      </div>
    );
  }
  return (
    <div style={{ padding: 16 }}>
      {label && <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text3)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>}
      <div style={{ position: "relative", height: 48, margin: "0 20px" }}>
        <div style={{ position: "absolute", top: 22, left: `${pct(lo)}%`, width: `${pct(hi - lo)}%`, height: 4, background: "var(--border3)" }} />
        <div style={{ position: "absolute", top: 14, left: `${pct(lo)}%`, width: 2, height: 20, background: "var(--text3)" }} />
        <div style={{ position: "absolute", top: 14, left: `${pct(hi)}%`, width: 2, height: 20, background: "var(--text3)" }} />
        <div style={{ position: "absolute", top: 8, left: `${pct(q1)}%`, width: `${pct(q3 - q1)}%`, height: 32, background: "rgba(10,132,255,0.15)", border: "2px solid var(--accent)", borderRadius: 6 }} />
        <div style={{ position: "absolute", top: 6, left: `${pct(med)}%`, width: 3, height: 36, background: "var(--accent)", borderRadius: 2, transform: "translateX(-1.5px)" }} />
        {outliers.map((v, i) => (
          <div key={i} style={{ position: "absolute", top: 19, left: `${pct(v)}%`, width: 10, height: 10, borderRadius: 5, background: COLORS.danger, transform: "translateX(-5px)" }} />
        ))}
      </div>
      {(() => {
        // Beschriftungen kollisionsfrei: jede in die erste Zeile, in der sie
        // MINGAP hinter der letzten liegt — sonst neue Zeile. So überlagert nichts,
        // auch auf schmalen Handy-Displays (dort werden einfach mehr Zeilen genutzt).
        const MINGAP = 18; const rows = [];
        const items = [["Min", sorted[0]], ["Q1", q1], ["Median", med], ["Q3", q3], ["Max", sorted[sorted.length - 1]]].map(([lbl, v]) => {
          const x = pct(v);
          let row = rows.findIndex((lastX) => x - lastX >= MINGAP);
          if (row === -1) row = rows.length;
          rows[row] = x;
          return { lbl, v, x, row };
        });
        const nRows = Math.max(1, rows.length);
        return (
          <div style={{ position: "relative", height: nRows * 14 + 2, margin: "4px 20px 0", fontSize: 10.5, color: "var(--text3)" }}>
            {items.map((it, i) => (
              <span key={i} style={{ position: "absolute", top: it.row * 14, left: `${it.x}%`, transform: "translateX(-50%)", whiteSpace: "nowrap" }}>{it.lbl}: {fmt(it.v)}{unit}</span>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

// Was innerhalb des Panels per Tab erreichbar ist. Reihenfolge = DOM-Reihenfolge,
// negative tabIndex und versteckte Elemente fallen raus.
const FOKUSSIERBAR =
  'a[href],area[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),' +
  'button:not([disabled]),iframe,object,embed,summary,[contenteditable="true"],[tabindex]';
function fokusZiele(wurzel) {
  if (!wurzel) return [];
  // Versteckt = irgendein Vorfahre (oder das Element selbst) ist ausgeblendet.
  // Bewusst über den Elternweg statt offsetParent: das läuft nur beim Tab-Druck
  // und ist unabhängig vom Layout-Zustand.
  const sicht = wurzel.ownerDocument.defaultView;
  const versteckt = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const st = sicht?.getComputedStyle(n);
      if (st && (st.display === "none" || st.visibility === "hidden")) return true;
      if (n === wurzel) break;
    }
    return false;
  };
  return Array.from(wurzel.querySelectorAll(FOKUSSIERBAR)).filter(
    (el) => el.tabIndex >= 0 && !el.hasAttribute("disabled")
      && el.getAttribute("aria-hidden") !== "true" && !versteckt(el),
  );
}
// Nur der oberste Dialog reagiert auf Escape und fängt den Fokus — sonst würde
// bei verschachtelten Dialogen der untere mitschließen. Ein Modul-Stapel reicht,
// da Dialoge immer streng übereinander liegen.
const _dialogStapel = [];
// Der Hintergrund darf nicht mitscrollen. Zähler, weil mehrere Dialoge offen
// sein können und der letzte den Scroll zurückgeben muss.
let _scrollSperre = 0;

// Zugänglicher Dialog. EINE Quelle für alle Modals: role="dialog", Fokus-Fang,
// Fokus-Rückgabe auf das auslösende Element, Escape, Klick auf die Fläche.
// Optik bleibt modalOverlay/modalPanel.
// title: sichtbare Überschrift (wird zugleich Beschriftung). Wer die Überschrift
// selbst rendert, gibt stattdessen label (aria-label) oder labelledby an.
export function Modal({ children, onClose, width = 480, style, title, titleStyle, label, labelledby, overlayStyle }) {
  const panelRef = useRef(null);
  const titelId = useId();
  const beschriftet = labelledby || (title ? titelId : undefined);
  // onClose ist bei fast jedem Aufrufer eine Inline-Funktion und damit bei jedem
  // Rendern neu. Läge sie in den Abhängigkeiten, würde der Dialog bei jedem
  // Rendern der Seite auf- und wieder zugebaut: Fokus spränge zurück und die
  // Stapel-Reihenfolge (verschachtelte Dialoge) drehte sich um. Deshalb Ref.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Das auslösende Element beim ERSTEN Rendern merken: React setzt autoFocus
  // schon beim Einhängen, im Effekt wäre der Fokus also womöglich längst im
  // Dialog und die Rückgabe liefe ins Leere.
  const vorherRef = useRef(undefined);
  if (vorherRef.current === undefined) vorherRef.current = typeof document !== "undefined" ? document.activeElement : null;

  useEffect(() => {
    const marke = {};
    _dialogStapel.push(marke);
    const oben = () => _dialogStapel[_dialogStapel.length - 1] === marke;

    // Fokus in den Dialog setzen — außer ein Feld hat sich per autoFocus schon
    // selbst geholt (dann ist das der gewollte Startpunkt).
    const vorher = vorherRef.current;
    const panel = panelRef.current;
    if (!panel?.contains(document.activeElement)) (fokusZiele(panel)[0] || panel)?.focus?.();

    // Hintergrund festhalten.
    const altOverflow = document.body.style.overflow;
    if (_scrollSperre++ === 0) document.body.style.overflow = "hidden";

    const onKey = (e) => {
      if (!oben()) return;
      // Kein stopPropagation: Felder mit eigenem Escape (Inline-Abbruch) sollen
      // wie bisher zusätzlich reagieren.
      if (e.key === "Escape") { closeRef.current?.(); return; }
      if (e.key !== "Tab") return;
      const ziele = fokusZiele(panelRef.current);
      if (!ziele.length) { e.preventDefault(); panelRef.current?.focus(); return; }
      const ersteZ = ziele[0], letzteZ = ziele[ziele.length - 1];
      const aktiv = document.activeElement;
      const drin = panelRef.current?.contains(aktiv);
      if (e.shiftKey && (aktiv === ersteZ || !drin)) { e.preventDefault(); letzteZ.focus(); }
      else if (!e.shiftKey && (aktiv === letzteZ || !drin)) { e.preventDefault(); ersteZ.focus(); }
    };
    // Capture: der Dialog sieht die Taste vor allen Feld-Handlern der Seite.
    window.addEventListener("keydown", onKey, true);

    return () => {
      window.removeEventListener("keydown", onKey, true);
      const i = _dialogStapel.indexOf(marke);
      if (i >= 0) _dialogStapel.splice(i, 1);
      if (--_scrollSperre <= 0) { _scrollSperre = 0; document.body.style.overflow = altOverflow; }
      // Fokus zurück auf das auslösende Element, falls es noch im Dokument steht.
      if (vorher && vorher.isConnected && vorher.focus) vorher.focus();
    };
  }, []);

  return (
    <div {...overlayGuard(onClose)} style={overlayStyle ? { ...modalOverlay, ...overlayStyle } : modalOverlay}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={beschriftet ? undefined : label}
        aria-labelledby={beschriftet}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{ ...modalPanel, maxWidth: width, outline: "none", ...style }}
      >
        {title ? <h3 id={titelId} style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, ...titleStyle }}>{title}</h3> : null}
        {children}
      </div>
    </div>
  );
}

// Überschrift eines Dialogs. 16/700 — dieselbe Größe, die `Modal` für sein
// `title` benutzt. Sie stand achtundzwanzigmal ausgeschrieben im Code.
export const dialogTitel = { fontSize: 16, fontWeight: 700, margin: 0 };

/**
 * Kopfzeile eines Dialogs: Überschrift links, Schließkreuz rechts, dazwischen
 * Platz für das, was diese eine Maske braucht (ein Reifegrad-Abzeichen, ein
 * Stift, ein Zähler).
 *
 * `Modal` kann eine Überschrift selbst setzen (`title`) — aber nur eine nackte.
 * Sobald ein Dialog ein Kreuz oder ein zweites Element in der Kopfzeile wollte,
 * baute die Seite die Zeile neu: sieben Dialoge, sieben Fassungen derselben
 * vier Zeilen. Wer `title` reicht, nimmt weiter `title`.
 */
export function DialogKopf({ titel, onClose, schliessenLabel = "Schließen", children, style, id }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, ...style }}>
      <h3 id={id} style={{ ...dialogTitel, flex: 1, minWidth: 0 }}>{titel}</h3>
      {children}
      {onClose && (
        <button onClick={onClose} className="icon-btn" style={{ ...iconBtn, padding: 6 }}
          title={schliessenLabel} aria-label={schliessenLabel}>
          <Icon d={ICONS.close} size={18} />
        </button>
      )}
    </div>
  );
}

// Pillen-Umschalter (Tabs/Ansichten). options: [[value, label], …].
export function Tabs({ value, onChange, options, style }) {
  return (
    <div style={{ display: "inline-flex", border: "1px solid var(--border2)", borderRadius: CONTROL_R, overflow: "hidden",
      height: CONTROL_H, boxSizing: "border-box", ...style }}>
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} style={{
          padding: "0 14px", height: "100%", display: "inline-flex", alignItems: "center",
          fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
          background: value === v ? "var(--accent)" : "transparent",
          color: value === v ? "#fff" : "var(--text2)",
        }}>{label}</button>
      ))}
    </div>
  );
}

// ─── E/G-Umschalter — EINE Form fuer dieselbe Funktion ───
//
// E/G taucht an vier Stellen auf (CardVote-Frage, Karteikarte, Kartenstapel,
// Kursteilnehmer) und sah an dreien verschieden aus: mal ein quadratischer
// Knopf, mal ein Auswahlfeld mit „Alle Niveaus/Nur E/Nur G", mal eines mit
// „–/E-Kurs/G-Kurs". Dieselbe Entscheidung soll ueberall gleich aussehen,
// sonst muss man sie jedes Mal neu lesen.
//
// Ein Klick schaltet weiter. `mitLeer` bestimmt, ob es einen dritten Zustand
// „gilt fuer alle" gibt (Karte, Stapel, Kursteilnehmer) oder nur E/G
// (CardVote-Frage: dort ist jede Frage entweder Grund- oder Anforderungsstoff).
export function NiveauToggle({ wert, onChange, mitLeer = true, size = 26, title }) {
  const folge = mitLeer ? ["", "E", "G"] : ["G", "E"];
  const jetzt = folge.includes(wert || "") ? (wert || "") : "";
  const weiter = () => onChange(folge[(folge.indexOf(jetzt) + 1) % folge.length]);
  const aktiv = jetzt === "E" || jetzt === "G";
  const farbe = jetzt === "E" ? COLORS.info : COLORS.success;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); weiter(); }} title={title}
      aria-label={title} style={{
        flexShrink: 0, width: size, height: size, borderRadius: 8, cursor: "pointer",
        fontSize: size <= 22 ? 11.5 : 12.5, fontWeight: 700, lineHeight: 1, padding: 0,
        border: `1px solid ${aktiv ? farbe : "var(--border2)"}`,
        background: aktiv ? farbe + "1e" : "var(--bg)",
        color: aktiv ? farbe : "var(--text3)",
      }}>
      {jetzt || "–"}
    </button>
  );
}

// Reifegrad-Badge (alpha/beta) fuer Module. beta = blau, alpha = orange-Warnung.
// Leerer Zustand: statt „keine Daten" ein Satz + optional ein erster-Schritt-
// Knopf. Macht Listen selbsterklaerend.
export function Empty({ title, hint, action, onAction }) {
  return (
    <div style={{ textAlign: "center", padding: "36px 20px", border: "1px dashed var(--border2)", borderRadius: 14, background: "var(--bg2)" }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: hint ? 6 : 0 }}>{title}</div>
      {hint && <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: action ? 16 : 0, maxWidth: 420, marginLeft: "auto", marginRight: "auto", lineHeight: 1.5 }}>{hint}</div>}
      {action && onAction && <button onClick={onAction} style={btnPrimary}>{action}</button>}
    </div>
  );
}

// Ladefehler: statt stiller Leere ein Hinweis + „Erneut versuchen".
export function LoadError({ message, onRetry, retryLabel = "Erneut versuchen" }) {
  return (
    <div style={{ textAlign: "center", padding: "28px 20px", border: "1px solid var(--border)", borderRadius: 14, background: "var(--bg2)" }}>
      <div style={{ fontSize: 14, color: COLORS.danger, fontWeight: 600, marginBottom: onRetry ? 14 : 0 }}>{message || "Konnte nicht geladen werden."}</div>
      {onRetry && <button onClick={onRetry} style={btnSecondary}>{retryLabel}</button>}
    </div>
  );
}

// Skeleton-Platzhalter: graue, pulsierende Balken in Inhaltsform statt „lädt…".
export function Skeleton({ rows = 3, height = 44, gap = 10 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }} aria-hidden="true">
      <style>{"@keyframes nuvora-pulse{0%,100%{opacity:.55}50%{opacity:1}}"}</style>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ height, borderRadius: 10, background: "var(--bg3)", border: "1px solid var(--border)", animation: "nuvora-pulse 1.2s ease-in-out infinite", animationDelay: `${i * 0.1}s` }} />
      ))}
    </div>
  );
}

export function StageBadge({ stage, title }) {
  if (!stage || stage === "stable") return null;
  const beta = stage === "beta";
  return (
    <span title={title} style={{
      display: "inline-block", fontSize: 10, fontWeight: 700, letterSpacing: "0.5px",
      textTransform: "uppercase", padding: "2px 6px", borderRadius: 6, verticalAlign: "middle",
      background: beta ? "rgba(10,132,255,0.15)" : "rgba(184,134,11,0.18)",
      color: beta ? "var(--accent)" : COLORS.warning,
    }}>{beta ? "Beta" : "Frühphase"}</span>
  );
}

// Ein-/Aus-Schalter statt Checkbox. Fuer Optionen, die sichtbar an/aus sein
// sollen (z.B. Mischen).
export function Toggle({ checked, onChange, label }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, color: "var(--text)" }}>
      <span
        onClick={() => onChange(!checked)}
        role="switch" aria-checked={checked}
        style={{
          width: 38, height: 22, borderRadius: 11, flexShrink: 0, position: "relative",
          background: checked ? "var(--accent)" : "var(--border2)", transition: "background 0.15s",
        }}
      >
        <span style={{
          position: "absolute", top: 2, left: checked ? 18 : 2, width: 18, height: 18, borderRadius: 9,
          background: "#fff", transition: "left 0.15s", boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
        }} />
      </span>
      {label}
    </label>
  );
}
