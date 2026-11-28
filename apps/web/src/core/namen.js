// Gekürzte Namen („Anna M.") — eine Anzeigeoption je Gerät, kein Eingriff in die
// Daten. Wer Noten oder den Sitzplan am Beamer zeigt, will nicht jedem den
// vollen Namen hinhalten; im Datensatz bleibt er unverändert.
import { useSyncExternalStore } from "react";

const KEY = "nuvora_kurzname";
const hoerer = new Set();

export const kurzNameAn = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };

export function setzeKurzName(an) {
  try { localStorage.setItem(KEY, an ? "1" : "0"); } catch { /* egal */ }
  hoerer.forEach((f) => f());
}

// Reihenfolge der Kinder (Wie gepflegt / Nachname / Vorname / Klasse) — EINE Einstellung fuer alle Listen
// (Notenbuch, Klassenarbeit). Der Schluessel ist der alte des Notenbuchs, damit die Wahl erhalten bleibt.
const SORT_KEY = "noten_sort";
const sortHoerer = new Set();
const sortierungJetzt = () => { try { return localStorage.getItem(SORT_KEY) || "liste"; } catch { return "liste"; } };
export function setzeSortierung(art) {
  try { localStorage.setItem(SORT_KEY, art || "liste"); } catch { /* egal */ }
  sortHoerer.forEach((f) => f());
}
export function useSortierung() {
  const art = useSyncExternalStore((f) => { sortHoerer.add(f); return () => sortHoerer.delete(f); }, sortierungJetzt, () => "liste");
  return [art, setzeSortierung];
}

// ── Namen in Teilen: Vorname, weitere Vornamen, Nachname ──
// Gespeichert bleibt EIN Name („Alexis Kate Geraldine Klein Müller"); die Teile ergeben sich daraus: das erste
// Wort ist der Vorname, das letzte der Nachname, dazwischen die weiteren Vornamen. Ein Nachname aus mehreren
// Woertern („Klein Müller") haelt intern ein GESCHUETZTES Leerzeichen zusammen — so bleibt „letztes Wort =
// Nachname" wahr, ohne dass die Datenbank ein neues Feld braucht. Getrennt wird deshalb nur an normalen
// Leerzeichen (/\s/ wuerde auch das geschuetzte trennen).
export const NBSP = "\u00a0";
const WORT = /[ \t\r\n]+/;

/** {vorname, weitere: [], nachname} aus dem gespeicherten Namen. */
export function teileName(name) {
  const w = String(name == null ? "" : name).trim().split(WORT).filter(Boolean);
  if (w.length === 0) return { vorname: "", weitere: [], nachname: "" };
  if (w.length === 1) return { vorname: w[0].replaceAll(NBSP, " "), weitere: [], nachname: "" };
  return { vorname: w[0], weitere: w.slice(1, -1), nachname: w[w.length - 1].replaceAll(NBSP, " ") };
}

/** Gespeicherter Name aus den Teilen; Leerzeichen im Nachnamen werden geschuetzt. */
export function bauName({ vorname = "", weitere = [], nachname = "" } = {}) {
  const v = String(vorname).trim().split(WORT).filter(Boolean);
  const mitte = (weitere || []).flatMap((x) => String(x).trim().split(WORT)).filter(Boolean);
  const n = String(nachname).trim().split(WORT).filter(Boolean).join(NBSP);
  return [...v.slice(0, 1), ...v.slice(1), ...mitte, n].filter(Boolean).join(" ");
}

/**
 * Eine eingegebene oder importierte Zeile in den gespeicherten Namen:
 *   „Klein Müller, Anna Lena"  -> Nachname vor dem Komma (bleibt zusammen), dann Vornamen
 *   „Anna<TAB>Lena<TAB>Klein Müller" (aus Excel kopiert) -> erste Spalte Vorname, letzte Nachname
 *   „Anna Lena Müller"         -> wie gehabt (letztes Wort Nachname)
 */
export function nameAusEingabe(zeile) {
  const z = String(zeile == null ? "" : zeile).trim();
  if (!z) return "";
  if (z.includes("\t")) {
    const sp = z.split("\t").map((x) => x.trim()).filter(Boolean);
    if (sp.length >= 2) return bauName({ vorname: sp[0], weitere: sp.slice(1, -1), nachname: sp[sp.length - 1] });
  }
  if (z.includes(",")) {
    const [nach, ...rest] = z.split(",");
    const vor = rest.join(" ").trim().split(WORT).filter(Boolean);
    if (nach.trim() && vor.length) return bauName({ vorname: vor[0], weitere: vor.slice(1), nachname: nach });
  }
  return z.split(WORT).filter(Boolean).join(" ");
}

/** Wie das Kind ueberall heisst: 1. Vorname und (ganzer) Nachname — „Alexis Klein Müller". */
export function anzeigeName(name) {
  const { vorname, nachname } = teileName(name);
  return [vorname, nachname].filter(Boolean).join(" ");
}

/** „Anna Meier" -> „Anna M."; ein einzelnes Wort und schon Gekürztes bleiben. */
export function kurzName(name) {
  const { vorname, nachname } = teileName(name);
  if (!nachname) return vorname;
  if (nachname.endsWith(".")) return `${vorname} ${nachname}`;
  return `${vorname} ${Array.from(nachname)[0]}.`;
}

/** Hook: { an, name(n), umschalten(v) } — der Name wird nur gekürzt, wenn die Option an ist. */
export function useKurzName() {
  const an = useSyncExternalStore((f) => { hoerer.add(f); return () => hoerer.delete(f); }, kurzNameAn, () => false);
  return { an, name: (n) => (an ? kurzName(n) : anzeigeName(n)), umschalten: setzeKurzName };
}

/** Vor- und Nachname aus „Anna Maria Meier": der LETZTE Teil ist der Nachname (wie kurzName). */
export function nameTeile(name) {
  const { vorname, weitere, nachname } = teileName(name);
  if (!nachname) return { vor: "", nach: vorname };
  return { vor: [vorname, ...weitere].join(" "), nach: nachname };
}

const vgl = (a, b) => String(a || "").localeCompare(String(b || ""), "de", { sensitivity: "base", numeric: true });

/**
 * Kinder sortieren: "liste" = Reihenfolge der Liste (wie gepflegt), "nachname", "vorname",
 * "klasse" (in gemischten Kursen; dann nach Nachname, Vorname). Die Eingabe bleibt unberuehrt,
 * bei Gleichstand gilt die Reihenfolge der Liste.
 */
export function sortiereKinder(liste, art) {
  const l = liste || [];
  if (!art || art === "liste") return l;
  const mit = l.map((k, i) => ({ k, i, ...nameTeile(k.name) }));
  const schluessel = {
    nachname: (x, y) => vgl(x.nach, y.nach) || vgl(x.vor, y.vor),
    vorname: (x, y) => vgl(x.vor, y.vor) || vgl(x.nach, y.nach),
    klasse: (x, y) => vgl(x.k.klasse, y.k.klasse) || vgl(x.nach, y.nach) || vgl(x.vor, y.vor),
  }[art];
  if (!schluessel) return l;
  return mit.sort((x, y) => schluessel(x, y) || x.i - y.i).map((x) => x.k);
}
