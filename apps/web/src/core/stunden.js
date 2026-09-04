// Uhrzeit einer Stundennummer — dieselbe Regel wie im Server (app/caldav.py:
// stundenzeit). Die Stunden 1..n stehen in `times` (Index = Nummer − 1), die
// **0. Stunde** hat einen eigenen Platz (`zero`): eine verschobene Liste haette
// jede gespeicherte Stundennummer um eins verrueckt.
export function stundenZeit(times, zero, p) {
  const w = p === 0 ? zero : (Array.isArray(times) ? times[p - 1] : null);
  return w && typeof w === "object" ? w : null;
}

// Die Stundennummern des Rasters, mit der 0. vorneweg, wenn es sie gibt.
export function stundenListe(anzahl, hatNull) {
  const rest = Array.from({ length: Math.max(0, anzahl) }, (_, i) => i + 1);
  return hatNull ? [0, ...rest] : rest;
}
