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

// ─── Schnelltasten: Formel an der Auswahl einfügen ───────────────────────────
//
// Die Tastenreihe gab es zweimal: im Frageeditor (Dashboard.jsx) mit sechzehn
// Zeichen, im Karteneditor (Karten.jsx) mit den ersten zehn. `LATEX_TASTEN`
// sind die zehn gemeinsamen, `LATEX_TASTEN_LANG` die lange Reihe; die kurze
// bleibt kurz, der Karteneditor hat für Tabellen eigene Tasten daneben.
export const LATEX_TASTEN = [
  { label: "a/b", tex: "\\frac{}{}", cursor: -3 },
  { label: "x²", tex: "^{}", cursor: -1 },
  { label: "x₂", tex: "_{}", cursor: -1 },
  { label: "√", tex: "\\sqrt{}", cursor: -1 },
  { label: "±", tex: "\\pm " },
  { label: "·", tex: "\\cdot " },
  { label: "≠", tex: "\\neq " },
  { label: "≤", tex: "\\leq " },
  { label: "≥", tex: "\\geq " },
  { label: "π", tex: "\\pi " },
];

export const LATEX_TASTEN_LANG = [
  ...LATEX_TASTEN,
  { label: "∑", tex: "\\sum " },
  { label: "∞", tex: "\\infty " },
  // Tabelle: KaTeX kennt `array`, nicht `tabular`. Das Geruest kommt fertig
  // hin, weil kaum jemand die Spaltenangabe („{|c|c|}") aus dem Kopf schreibt
  // — und ein halb getipptes array rendert gar nichts.
  { label: "⊞ Tabelle", tex: "\\begin{array}{|c|c|}\\hline  &  \\\\ \\hline  &  \\\\ \\hline\\end{array}", cursor: -40, display: true },
];

/**
 * Eine Formel an der Auswahl einsetzen — reine Zeichenkettenrechnung.
 * Dieselben zwölf Zeilen standen als `insertLatex` in Dashboard.jsx und in
 * Karten.jsx; verschieden war nur, woher Text und Schreibpunkt kamen.
 *
 *   • markierter Text wandert in die erste Lücke `{}` der Vorlage
 *   • die `$` kommen nur dazu, wenn der Schreibpunkt nicht schon in einer
 *     Formel steht; `display` setzt `$$` (Tabelle in eigener Zeile)
 *
 * @returns { text, pos } — neuer Text und wohin der Schreibpunkt danach gehört
 */
export function formelEinfuegen(text, start, end, tex, cursor = 0, display = false) {
  const quelle = text || "";
  const markiert = quelle.slice(start, end);
  const einsatz = markiert && tex.includes("{}") ? tex.replace("{}", `{${markiert}}`) : tex;
  const davor = quelle.slice(0, start);
  const inFormel = davor.includes("$") && davor.split("$").length % 2 === 0;
  const zeichen = display ? "$$" : "$";
  const umschlossen = inFormel ? einsatz : `${zeichen}${einsatz}${zeichen}`;
  return {
    text: davor + umschlossen + quelle.slice(end),
    pos: start + umschlossen.length + (cursor || 0),
  };
}
