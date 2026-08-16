// Zahlen so schreiben, wie sie in Deutschland gelesen werden.
//
// `String(x).replace(".", ",")` stand dreiundzwanzigmal im Code, meist als
// lokales `de`, `de1`, `nt` oder `fmt` — und jede Fassung entschied für sich,
// was bei `null` passiert (mal `""`, mal `"—"`, mal `"–"`) und auf wie viele
// Stellen gerundet wird (2 im Notenbuch, 1 im Vergleich, „ganze Zahl ohne
// Komma" im Boxplot). Dass die Klassenarbeit ihre Trennschärfe mit `.` und das
// Notenbuch seinen Schnitt mit `,` zeigte, war kein Entwurf, sondern ein
// vergessenes `replace`.
//
// Die Rundung bleibt hier eine EIGENE Funktion und wird nicht in `komma`
// versteckt: an mehreren Stellen wird erst gerundet, dann gerechnet.
//
// Regressionstest: `zahl.test.js`.

/** Kaufmännisch auf `stellen` Nachkommastellen — 2,675 → 2,68. */
export const rund = (n, stellen = 2) => {
  const f = 10 ** stellen;
  return Math.round(n * f) / f;
};

/**
 * Zahl als deutscher Text.
 *
 * `null`/`undefined`/NaN ergeben `leer` — die Aufrufer geben dort ihr eigenes
 * Zeichen an (`""` im Eingabefeld, `"–"` in einer Tabellenzelle).
 */
export function komma(n, leer = "") {
  if (n === null || n === undefined) return leer;
  if (typeof n === "number" && !Number.isFinite(n)) return leer;
  return String(n).replace(".", ",");
}

/** Erst runden, dann als deutscher Text — der häufigste Fall. */
export const kommaRund = (n, stellen = 2, leer = "") =>
  (n === null || n === undefined || (typeof n === "number" && !Number.isFinite(n))
    ? leer
    : komma(rund(Number(n), stellen), leer));

/**
 * Anteil in ganzen Prozent.
 *
 * Ohne Bezugsgröße gibt es keinen Anteil — dann `fallback` statt einer
 * Division durch null. Die Aufrufer sind sich uneins, ob das 0 (eine Aufgabe
 * ohne erreichbare Punkte gilt als „nichts erreicht") oder `null` (gar keine
 * Aussage) heißen soll, deshalb steht es im Aufruf.
 */
export const prozent = (teil, ganz, fallback = 0) =>
  (ganz > 0 ? Math.round((teil / ganz) * 100) : fallback);
