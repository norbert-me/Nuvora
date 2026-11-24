// Wird ein Kind besser oder schlechter? Eine Rechnung für Notenbuch-Tabelle
// (Lehrkraft) und Kinder-Übersicht.
//
// Verglichen wird die erste Hälfte der Noten mit der zweiten, nie die letzte
// mit der vorletzten — sonst wäre jede einzelne schwache Arbeit ein „Abstieg"
// (dieselbe Regel wie beim Themenstand). Ab zwei Noten gibt es einen Pfeil
// (bei zweien: erste gegen zweite); unter zwei keine Aussage. Kleiner Wert = bessere Note.

export const MINDEST_NOTEN = 2;
/** Unterschied der Hälftenmittel, ab dem eine Richtung gemeldet wird: eine halbe Note. Kleinere Schwankungen
 *  (eine Tendenzstufe = 0,3) sind Rauschen, kein Auf- oder Abstieg — der Pfeil soll nur bei deutlichen Änderungen stehen. */
export const SCHWELLE = 0.5;

/**
 * @param {number[]} werte Noten in Zeitreihenfolge (älteste zuerst)
 * @returns {1|0|-1|null} 1 = besser, -1 = schlechter, 0 = gleichbleibend, null = zu wenig
 */
export function notenTrend(werte) {
  const w = (werte || []).filter((v) => typeof v === "number" && Number.isFinite(v));
  if (w.length < MINDEST_NOTEN) return null;
  const h = Math.floor(w.length / 2);
  const m = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const diff = m(w.slice(w.length - h)) - m(w.slice(0, h));
  if (diff <= -SCHWELLE) return 1;
  if (diff >= SCHWELLE) return -1;
  return 0;
}

/** Spalten eines Bereichs in Zeitreihenfolge: Datum der Leistung, sonst Anlagedatum, sonst Reihenfolge. */
export const spaltenDatum = (c) => (c && (c.date || (c.created_at ? String(c.created_at).slice(0, 10) : ""))) || "";

export function spaltenNachZeit(cats) {
  const wann = spaltenDatum;
  return (cats || []).map((c, i) => ({ c, i }))
    .sort((a, b) => (wann(a.c) && wann(b.c) ? wann(a.c).localeCompare(wann(b.c)) || a.i - b.i : a.i - b.i))
    .map((x) => x.c);
}

/**
 * Wo stehen die Quartalsstriche in einem ZEITLICH geordneten Verlauf?
 *
 * Ein Quartalsstrich steht in der Tabelle hinter einer Spalte (Reihenfolge der Spalten). Der Verlauf ordnet die
 * Noten aber nach Datum — dieselbe Position gilt dort nicht. Deshalb gilt der Strich als DATUM: das der Spalte,
 * hinter der er steht. Im Verlauf liegt er zwischen der letzten Note bis zu diesem Tag und der ersten danach.
 *
 *   punktDaten  — Datum je Punkt, aufsteigend ("JJJJ-MM-TT"; "" = unbekannt)
 *   strichDaten — Datum je Quartalsstrich
 * Rückgabe: sortierte Liste der Lücken `i` (Strich zwischen Punkt i und i + 1), ohne Doppelte; nichts am Rand
 * (vor dem ersten oder hinter dem letzten Punkt gibt es nichts zu trennen).
 */
export function strichLuecken(punktDaten, strichDaten) {
  const luecken = new Set();
  for (const d of strichDaten || []) {
    if (!d) continue;
    let letzte = -1;
    (punktDaten || []).forEach((p, i) => { if (p && p <= d) letzte = i; });
    if (letzte >= 0 && letzte < (punktDaten || []).length - 1) luecken.add(letzte);
  }
  return [...luecken].sort((a, b) => a - b);
}
