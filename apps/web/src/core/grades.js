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
  // „Note 2 ab 73 %": ab der Grenze ist es eine 2 — und der Notenwert bleibt in der 2 (entschieden 27.11.2026):
  // oben im Band 2,0, an der Grenze 2,4, linear dazwischen; er rutscht nie in die Nachbarnote (34 % bei „5 ab
  // 18 %" war vorher 4,9). Unter der 5er-Grenze glatt 6,0. Spiegel: note_aus_pct in app/scoring.py.
  const r1 = (x) => Math.round(x * 10) / 10;
  for (const [grade, lower, upper] of ranges) {
    if (pct >= lower) {
      const span = upper - lower;
      const pos = span > 0 ? Math.min(1, Math.max(0, (pct - lower) / span)) : 1;
      return r1(grade + 0.4 * (1 - pos));
    }
  }
  return 6.0;
}

// Note MIT Tendenz und Notenwert. Die Tendenz kommt aus den Dritteln des Bandes (oben „+", unten „-", keine an
// der 1; die 6 unter der 5er-Grenze ebenso gedrittelt), der Wert aus `gradeFromPct` — er bleibt in derselben Note (5+ ist 5,0, 5- an der Grenze 5,4).
// Spiegel: note_mit_tendenz in app/scoring.py.
export function gradeDetailed(pct, scale) {
  const s = skala(scale);
  const wert = gradeFromPct(pct, scale);
  const ranges = [[1, s[1], 100], [2, s[2], s[1]], [3, s[3], s[2]], [4, s[4], s[3]], [5, s[5], s[4]]];
  for (const [grade, lower, upper] of ranges) {
    if (pct >= lower) {
      const span = upper - lower;
      const pos = span > 0 ? (pct - lower) / span : 1;
      const suffix = grade === 1 ? "" : pos >= 2 / 3 ? "+" : pos < 1 / 3 ? "-" : "";
      return { note: grade + suffix, wert, grade };
    }
  }
  // Unter der 5er-Grenze ist es eine 6 — auch sie gedrittelt (knapp darunter 6+, ganz unten 6-). Der Wert bleibt 6,0.
  const pos6 = s[5] > 0 ? pct / s[5] : 0;
  return { note: pos6 >= 2 / 3 ? "6+" : pos6 < 1 / 3 ? "6-" : "6", wert: 6, grade: 6 };
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
 * note_label in app/scoring.py: kein „1−", kein „6+/−".
 */
export function wertLabel(wert) {
  if (wert == null || !Number.isFinite(Number(wert))) return "";
  const w = Number(wert);
  const g = Math.min(6, Math.max(1, Math.round(w)));
  if (g === 1 || g === 6) return String(g);
  const d = w - g;
  return d <= -0.15 ? `${g}+` : d >= 0.15 ? `${g}−` : String(g);
}
