// Prozent → Note. Geteilt zwischen CardVote-Auswertung und Karten-Meisterung,
// damit beide Brücken zum Notenbuch dieselbe Skala anwenden. Die Skala liegt
// pro Lehrkraft (users.grade_scale); ohne sie gilt DEFAULT_SCALE.
export const DEFAULT_SCALE = { 1: 87, 2: 73, 3: 59, 4: 45, 5: 20, 6: 0 };

export function gradeFromPct(pct, scale) {
  const s = scale || DEFAULT_SCALE;
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
  const s = scale || DEFAULT_SCALE;
  const ranges = [
    [1, s[1], 100], [2, s[2], s[1]], [3, s[3], s[2]],
    [4, s[4], s[3]], [5, s[5], s[4]],
  ];
  for (const [grade, lower, upper] of ranges) {
    if (pct >= lower) {
      const span = upper - lower;
      const pos = span > 0 ? (pct - lower) / span : 1;   // 0 = unten, 1 = oben im Band
      let suffix = pos >= 2 / 3 ? "+" : pos < 1 / 3 ? "-" : "";
      if (grade === 1 && suffix === "-") suffix = "";     // kein 1-
      const wert = grade + (suffix === "+" ? -0.3 : suffix === "-" ? 0.3 : 0);
      return { note: grade + suffix, wert: Math.round(wert * 10) / 10, grade };
    }
  }
  return { note: "6", wert: 6, grade: 6 };
}

// Kleine Statistik-Helfer für die Kennzahlen (Notenwert-Verteilung).
export function quantile(sortedAsc, q) {
  const n = sortedAsc.length;
  if (!n) return null;
  const idx = (n - 1) * q, lo = Math.floor(idx), hi = Math.ceil(idx);
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}
export function stdev(arr) {
  const n = arr.length;
  if (n < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1));
}
