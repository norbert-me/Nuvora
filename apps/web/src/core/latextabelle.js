// Tabellen als LaTeX — die Zeichenarbeit hinter den drei Tabellen-Tasten.
//
// Hier statt in der Seite, weil es reine Zeichenkettenrechnerei ist: ein
// verrutschtes Zeilenende fällt am Bildschirm erst auf, wenn die Formel rot wird.
// Regressionstest: latextabelle.test.js.
//
// `Latex.jsx` rendert `array` (und schreibt hereinkopiertes `tabular` darauf
// um) — es fehlte nur die Taste dafür.
export const TABELLE_GERUEST = "$$\\begin{array}{|c|c|} \\hline  &  \\\\ \\hline  &  \\\\ \\hline \\end{array}$$";

/** Der array-Block, in dem der Schreibpunkt steht — oder null. */
function arrayBlock(text, pos) {
  const auf = "\\begin{array}";
  const start = text.lastIndexOf(auf, pos);
  if (start < 0) return null;
  const ende = text.indexOf("\\end{array}", start);
  if (ende < 0 || pos > ende + "\\end{array}".length) return null; // Schreibpunkt hinter der Tabelle
  const specAuf = text.indexOf("{", start + auf.length - 1);
  const specZu = specAuf < 0 ? -1 : text.indexOf("}", specAuf);
  if (specAuf < 0 || specZu < 0 || specZu > ende) return null;
  return {
    spec: text.slice(specAuf + 1, specZu),
    specAuf, specZu,
    koerper: text.slice(specZu + 1, ende),
    koerperAuf: specZu + 1,
    koerperZu: ende,
  };
}

// Eine leere Zelle sind zwei Leerzeichen — der Schreibpunkt landet dazwischen,
// und beim Tippen bleibt links wie rechts Luft zum Trenner.
const ZELLE = "  ";

/** Leere Zellen einer Zeile: `  &    &  ` (so viele, wie die Spaltenangabe sagt). */
function leereZellen(spalten) {
  return Array(Math.max(2, spalten)).fill(ZELLE).join("&");
}

/** Eine Zeile an das Ende DIESER Tabelle hängen — vor ihrem Abschluss-`\hline`. */
export function zeileAnhaengen(text, pos) {
  const b = arrayBlock(text, pos);
  if (!b) return null;
  const zellen = leereZellen((b.spec.match(/[clr]/g) || []).length);
  const schluss = b.koerper.match(/\s*\\hline\s*$/);
  // Ohne das Abstreifen stünde der Zeilentrenner zweimal da (`\\ \\`): der
  // Rumpf endet bereits auf einem, weil danach das Abschluss-`\hline` kam.
  const rumpf = (schluss ? b.koerper.slice(0, schluss.index) : b.koerper).replace(/\s*\\\\\s*$/, "");
  const vorspann = " \\\\ \\hline ";
  const zusatz = vorspann + zellen + (schluss ? " \\\\ \\hline " : "");
  return {
    text: text.slice(0, b.koerperAuf) + rumpf + zusatz + text.slice(b.koerperZu),
    // Mitten in die erste neue Zelle.
    pos: b.koerperAuf + rumpf.length + vorspann.length + 1,
  };
}

/**
 * Eine Spalte anhängen: `c|` in die Spaltenangabe UND eine Zelle an JEDE Zeile.
 * Nur die Angabe zu ändern ergäbe eine Tabelle, deren Kopf mehr Spalten
 * verspricht als die Zeilen liefern.
 */
export function spalteAnhaengen(text, pos) {
  const b = arrayBlock(text, pos);
  if (!b) return null;
  const spec = b.spec.trim().endsWith("|") ? `${b.spec}c|` : `${b.spec}c`;
  let cursor = null;
  const zeilen = b.koerper.split("\\\\").map((z) => {
    // Der letzte Abschnitt ist oft nur noch das Abschluss-`\hline` — der bekommt
    // keine Zelle, sonst entstünde eine leere Zeile.
    if (!z.replace(/\\hline/g, "").trim() && !z.includes("&")) return z;
    const neu = `${z}&${ZELLE}`;
    if (cursor === null) cursor = neu.length - 1;   // mitten in die neue Zelle
    return neu;
  });
  const koerper = zeilen.join("\\\\");
  const vorne = text.slice(0, b.specAuf + 1) + spec + "}";
  return {
    text: vorne + koerper + text.slice(b.koerperZu),
    pos: cursor === null ? pos : vorne.length + cursor,
  };
}
