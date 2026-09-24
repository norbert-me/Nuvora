// Notenverteilung auf ganze oder halbe Stufen — eine Rechnung für beide
// Diagramme des Notenbuchs (Spalten-Statistik und Halbjahres-Statistik).
//
// Die beiden rechneten vorher verschieden: die Spalte schnitt ab (2,7 fiel
// zu 2), die Halbjahresstatistik rundete (2,7 fiel zu 3). 2,7 ist „3+",
// gehört also zur 3 — gerundet wird deshalb überall.
//
// Halbe Stufen (1; 1,5; 2 …) sind eine Ansicht: bei Tendenznoten zeigt die
// ganze Stufe eine 2,3 und eine 1,7 als dieselbe Säule.

/** Die Stufen, auf die verteilt wird: 1..6 oder 1; 1,5; …; 6. */
export const stufen = (halb) => (halb
  ? Array.from({ length: 11 }, (_, i) => 1 + i / 2)
  : [1, 2, 3, 4, 5, 6]);

/** Auf welche Stufe fällt eine Note? */
export const stufeVon = (v, halb) => (halb ? Math.round(v * 2) / 2 : Math.round(v));

/** Verteilung als [{ g, n }] über alle Stufen, auch die leeren. */
export function verteilung(noten, halb) {
  const werte = (noten || []).filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
  return stufen(halb).map((g) => ({ g, n: werte.filter((v) => stufeVon(v, halb) === g).length }));
}
