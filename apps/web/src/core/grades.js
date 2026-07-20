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
