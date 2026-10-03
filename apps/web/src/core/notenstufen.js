// Notenverteilung auf ganze, halbe oder Teilnoten — eine Rechnung für beide
// Diagramme des Notenbuchs (Spalten-Statistik und Halbjahres-Statistik).
//
// Die beiden rechneten vorher verschieden: die Spalte schnitt ab (2,7 fiel
// zu 2), die Halbjahresstatistik rundete (2,7 fiel zu 3). 2,7 ist „3+",
// gehört also zur 3 — gerundet wird deshalb überall.
//
// Drei Stufungen, alle nur Ansicht:
//   "ganz"  1 … 6
//   "halb"  1; 1,5; … 6 — bei Tendenznoten zeigt die ganze Stufe eine 2,3 und
//           eine 1,7 als dieselbe Säule
//   "teil"  1, 1−, 2+, 2, 2− … 6 — die Tendenz selbst: ±0,3 um die ganze Note.
//           Ab 0,15 Abstand gilt eine Note als „+" oder „−" (die Mitte
//           zwischen 2,0 und 2,3).
// Für ältere Aufrufer gilt true wie "halb" und false wie "ganz".

const art = (modus) => (modus === true ? "halb" : modus === "halb" || modus === "teil" ? modus : "ganz");

const TEIL = ["1", "1−", "2+", "2", "2−", "3+", "3", "3−", "4+", "4", "4−", "5+", "5", "5−", "6+", "6"];

/** Die Stufen, auf die verteilt wird. */
export function stufen(modus) {
  const m = art(modus);
  if (m === "halb") return Array.from({ length: 11 }, (_, i) => 1 + i / 2);
  if (m === "teil") return TEIL;
  return [1, 2, 3, 4, 5, 6];
}

/** Auf welche Stufe fällt eine Note? */
export function stufeVon(v, modus) {
  const m = art(modus);
  if (m === "halb") return Math.round(v * 2) / 2;
  if (m === "ganz") return Math.round(v);
  const g = Math.min(6, Math.max(1, Math.round(v)));
  const d = v - g;
  if (d <= -0.15 && g > 1) return `${g}+`;
  if (d >= 0.15 && g < 6) return `${g}−`;
  return String(g);
}

/** Verteilung als [{ g, n }] über alle Stufen, auch die leeren. */
export function verteilung(noten, modus) {
  const werte = (noten || []).filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
  return stufen(modus).map((g) => ({ g, n: werte.filter((v) => stufeVon(v, modus) === g).length }));
}
