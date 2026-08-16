// Kennzahlen je Aufgabe einer Klassenarbeit.
//
// Trennschärfe und Konfidenzintervall standen in `Klassenarbeit.jsx` zweimal
// zeichengleich da — einmal für die ganzen Aufgaben, einmal für die
// Teilaufgaben. Zwei Kopien einer Statistikformel sind zwei Gelegenheiten, sich
// zu verrechnen, und am Bildschirm sieht eine falsche Korrelation genauso aus
// wie eine richtige. Deshalb hier, mit Test (`aufgabenstatistik.test.js`).

// Mittel und Streuung sind keine Aufgaben-Kennzahlen, sondern die Grundrechnung
// jeder Auswertung — sie liegen in `statistik.js`. Hier nur weitergereicht,
// damit die bisherigen Aufrufstellen (und der Test) ihren Namen behalten.
import { mittel, streuung } from "./statistik.js";

export { mittel, streuung };

/**
 * Trennschärfe: Korrelation zwischen den Punkten dieser Aufgabe und der
 * Gesamtpunktzahl (−1 … +1). Sagt, ob die Aufgabe dieselben Kinder oben
 * einsortiert wie die Arbeit insgesamt.
 *
 * `null`, wenn zu wenige Arbeiten vorliegen (unter drei) oder eine der beiden
 * Reihen gar nicht streut — dann gibt es keine Korrelation, nur eine Division
 * durch null.
 */
export function trennschaerfe(punkte, gesamt, mindestens = 3) {
  if (punkte.length < mindestens || punkte.length !== gesamt.length) return null;
  const mx = mittel(punkte), my = mittel(gesamt);
  let cov = 0, sx = 0, sy = 0;
  punkte.forEach((x, i) => {
    const dx = x - mx, dy = gesamt[i] - my;
    cov += dx * dy; sx += dx * dx; sy += dy * dy;
  });
  return (sx > 0 && sy > 0) ? cov / Math.sqrt(sx * sy) : null;
}

/**
 * 95-%-Konfidenzintervall der mittleren Trefferquote in Prozent
 * (Mittel ± 1,96 · Standardfehler), auf 0…100 begrenzt und gerundet.
 *
 * `{ ciLow: null, ciHigh: null }`, solange es dafür zu wenig gibt.
 */
export function konfidenzProzent(punkte, max) {
  if (punkte.length < 2 || !(max > 0)) return { ciLow: null, ciHigh: null };
  const pcts = punkte.map((x) => (x / max) * 100);
  const halb = 1.96 * (streuung(pcts) / Math.sqrt(pcts.length));
  return {
    ciLow: Math.max(0, Math.round(mittel(pcts) - halb)),
    ciHigh: Math.min(100, Math.round(mittel(pcts) + halb)),
  };
}
