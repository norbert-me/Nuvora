// Die vier Rechnungen, die jede Auswertung braucht — an EINER Stelle.
//
// Mittel, Streuung, Median und Quantil standen im zweiten Durchgang siebenmal
// im Code, und nicht einmal gleich:
//
//   grades.js            `stdev`      — Stichprobe (n−1)
//   aufgabenstatistik.js `streuung`   — zeichengleich dieselbe Formel
//   Evaluation.jsx       `stddev`     — noch einmal dieselbe Formel
//   ClassEvaluation.jsx  inline       — und noch einmal
//   Icons.jsx            `quantileOf` — dasselbe Quantil wie `quantile`
//   ClassEvaluation/StudentEvaluation `pcts[floor(n/2)]` — KEIN Median
//
// Die letzte Zeile ist der Grund, warum das hier steht und nicht nur eine
// Aufräumarbeit ist: bei gerader Klassenstärke zeigten zwei Auswertungen unter
// der Überschrift „Median" den oberen der beiden mittleren Werte. Bei 24 Kindern
// mit 60 % und 70 % in der Mitte stand dort 70 statt 65. Sechsmal dieselbe
// Formel abtippen heißt sechs Gelegenheiten, sie falsch abzutippen.
//
// Regressionstest: `statistik.test.js`.

/** Arithmetisches Mittel; leere Liste = 0 (nicht NaN). */
export const mittel = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

/**
 * Stichproben-Standardabweichung (Nenner n−1).
 *
 * Unter zwei Werten gibt es keine Streuung — dann 0 statt NaN, damit die
 * Anzeige nicht „±NaN" schreibt.
 */
export const streuung = (arr) => {
  if (arr.length < 2) return 0;
  const m = mittel(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
};

/**
 * Quantil einer AUFSTEIGEND sortierten Liste, linear zwischen den Nachbarn
 * interpoliert (p = 0…1).
 *
 * `leer` ist der Wert für die leere Liste — die Aufrufer sind sich uneins:
 * der Boxplot will 0, die Notenkennzahlen wollen `null`.
 */
export function quantil(sortiert, p, leer = null) {
  const n = sortiert.length;
  if (!n) return leer;
  const idx = p * (n - 1), lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sortiert[lo] : sortiert[lo] + (sortiert[hi] - sortiert[lo]) * (idx - lo);
}

/**
 * Median einer beliebig sortierten Liste — bei gerader Anzahl das Mittel der
 * beiden mittleren Werte, nicht der obere davon.
 *
 * Sortiert selbst und lässt die übergebene Liste in Ruhe: an mindestens einer
 * Aufrufstelle wird dieselbe Liste danach noch für Bestes/Schlechtestes
 * gebraucht.
 */
export function median(arr, leer = 0) {
  if (!arr.length) return leer;
  return quantil([...arr].sort((a, b) => a - b), 0.5, leer);
}
