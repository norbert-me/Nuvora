// Prozent → Note. Geteilt zwischen CardVote-Auswertung und Karten-Meisterung,
// damit beide Brücken zum Notenbuch dieselbe Skala anwenden. Die Skala liegt
// pro Lehrkraft (users.grade_scale); ohne sie gilt DEFAULT_SCALE.
import { quantil, streuung } from "./statistik.js";

export const DEFAULT_SCALE = { 1: 87, 2: 73, 3: 59, 4: 45, 5: 20, 6: 0 };

// Notenschluessel pruefen: fehlt eine Stufe oder steht Unlesbares darin, gilt
// der Standard. Sonst rechnete die Seite mit NaN weiter (ein NaN-Vergleich ist
// immer falsch, die Bereichspruefung greift also nicht) oder gab allen eine 6.
// Die Python-Seite (noten.py _grade_from_pct) macht genau das schon.
function skala(scale) {
  const s = {};
  for (const stufe of [1, 2, 3, 4, 5, 6]) {
    const wert = Number(scale?.[stufe]);
    if (!Number.isFinite(wert)) return DEFAULT_SCALE;
    s[stufe] = wert;
  }
  return s;
}

export function gradeFromPct(pct, scale) {
  const s = skala(scale);
  const ranges = [
    [1, s[1], 100],
    [2, s[2], s[1]],
    [3, s[3], s[2]],
    [4, s[4], s[3]],
    [5, s[5], s[4]],
  ];
  for (const [grade, lower, upper] of ranges) {
    if (pct >= lower) {
      const span = upper - lower;
      if (span <= 0) return grade;
      return Math.round((grade + (upper - pct) / span) * 10) / 10;
    }
  }
  return 6.0;
}

// Note MIT Tendenz (1+, 2-, …) und Notenwert (Ganzzahl ∓0,3), wie in der
// Klassenarbeits-Auswertung. Basis-Note aus der Lehrer-Skala; innerhalb des
// Bandes oberes Drittel „+", unteres „-". Kein „1-", kein „6+/-".
export function gradeDetailed(pct, scale) {
  const s = skala(scale);
  const ranges = [
    [1, s[1], 100], [2, s[2], s[1]], [3, s[3], s[2]],
    [4, s[4], s[3]], [5, s[5], s[4]],
  ];
  for (const [grade, lower, upper] of ranges) {
    if (pct >= lower) {
      const span = upper - lower;
      const pos = span > 0 ? (pct - lower) / span : 1;   // 0 = unten, 1 = oben im Band
      let suffix = pos >= 2 / 3 ? "+" : pos < 1 / 3 ? "-" : "";
      // Im Einserband gibt es weder 1- noch 1+: nach unten waere es eine 2,
      // nach oben ein Notenwert von 0,7 — den weist die Notenuebernahme als
      // ausserhalb von 1..6 zurueck, und zwar STILL. Der beste Schueler der
      // Klasse fiel damit aus der uebernommenen Spalte heraus.
      if (grade === 1) suffix = "";
      const wert = grade + (suffix === "+" ? -0.3 : suffix === "-" ? 0.3 : 0);
      return { note: grade + suffix, wert: Math.round(wert * 10) / 10, grade };
    }
  }
  return { note: "6", wert: 6, grade: 6 };
}

// Die Statistik-Helfer für die Kennzahlen (Notenwert-Verteilung) standen hier
// zeichengleich noch einmal — `stdev` wie `streuung`, `quantile` wie
// `quantileOf` im Boxplot. Eine Quelle: `statistik.js`. Die alten Namen bleiben,
// damit die Aufrufstellen sich beim Zusammenführen nicht zugleich umbenennen.
export const quantile = (sortedAsc, q) => quantil(sortedAsc, q);
export const stdev = (arr) => streuung(arr);

/**
 * Datum an einen Spaltentitel haengen, statt ihn zu ersetzen.
 *
 * „Mini-Test" plus Kalenderklick ergab vorher nur noch „01.01.26" — der Name
 * war weg. Ein bereits angehaengtes Datum wird ausgetauscht, damit zweimaliges
 * Klicken nicht zwei Daten aneinanderreiht.
 */
export function mitDatum(titel, datum) {
  const rest = String(titel || "").replace(/\s*\d{1,2}\.\d{1,2}\.\d{2,4}\s*$/, "").trim();
  return rest ? `${rest} ${datum}` : datum;
}

/**
 * „2026-02-09" → „09.02.26".
 *
 * Fällt eine Notenspalte ohne Namen an, ist das Datum der Name — genau so
 * heißen die meisten Spalten ohnehin. Kein Datum, kein Name: dann greift der
 * Vorschlag („Spalte 3").
 */
export function datumKurz(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [j, m, tg] = iso.split("-");
  return `${tg}.${m}.${j.slice(2)}`;
}
