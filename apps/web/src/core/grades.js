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
  // „Note 2 ab 73 %": ab der Grenze gilt die Note — an der Grenze die schwaechste (2-, 2,3), oben im Band die
  // staerkste (2+, 1,7), dazwischen linear (entschieden 27.11.2026). Die 1 laeuft von 1,3 bis 1,0, unter der
  // 5er-Grenze die 6 von 5,7 (6+) bis 6,0. Spiegel: note_aus_pct in app/scoring.py — zusammen aendern.
  const r1 = (x) => Math.round(x * 10) / 10;
  for (const [grade, lower, upper] of ranges) {
    if (pct >= lower) {
      const span = upper - lower;
      const pos = span > 0 ? Math.min(1, Math.max(0, (pct - lower) / span)) : 1;
      return grade === 1 ? r1(1.3 - 0.3 * pos) : r1(grade + 0.3 - 0.6 * pos);
    }
  }
  const pos = s[5] > 0 ? Math.min(1, Math.max(0, pct / s[5])) : 0;
  return r1(6 - 0.3 * pos);
}

// Note MIT Tendenz und Notenwert — aus EINER Rechnung (`gradeFromPct`), die Tendenz folgt aus dem Wert.
// `grade` ist die Note des Bandes (ab welcher Grenze), nicht der gerundete Wert: 1,3 bleibt eine 1.
export function gradeDetailed(pct, scale) {
  const wert = gradeFromPct(pct, scale);
  const s = skala(scale);
  const grade = [1, 2, 3, 4, 5].find((g) => pct >= s[g]) || 6;
  // ASCII-Minus wie bisher in der Klassenarbeit (Verteilung vergleicht auf „2-").
  return { note: wertLabel(wert).replace("−", "-"), wert, grade };
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

/**
 * Notenwert -> Note mit Tendenz („2,3" -> „2+", „2,7" -> „3−"). Spiegel von
 * note_label in app/scoring.py: an der 1 nur „1−", an der 6 nur „6+".
 */
export function wertLabel(wert) {
  if (wert == null || !Number.isFinite(Number(wert))) return "";
  const w = Number(wert);
  const g = Math.min(6, Math.max(1, Math.round(w)));
  const d = w - g;
  // Die 1 kennt nur „1-" (besser als 1,0 gibt es nicht), die 6 nur „6+".
  if (g === 1) return d >= 0.15 ? "1−" : "1";
  if (g === 6) return d <= -0.15 ? "6+" : "6";
  return d <= -0.15 ? `${g}+` : d >= 0.15 ? `${g}−` : String(g);
}
