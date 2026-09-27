// Tabellen im Freitext — Zeilen, die mit „|" beginnen (Markdown-Form).
//
// Ein Verlaufsplan braucht öfter eine kleine Tabelle („Gruppe | Aufgabe |
// Material"), und als eigenes Datenformat wäre sie eine zweite Ablage neben
// dem Text: der ICS-Feed, das Handy und jeder Export sehen weiter lesbaren
// Text, nur die Oberfläche zeichnet ein Raster daraus.
// Regressionstest: texttabelle.test.js.

const istTabellenZeile = (z) => z.trim().startsWith("|");
// Trennzeile aus Markdown (|---|:--:|) — trägt keine Zellen.
const istTrenner = (z) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(z);

/** Zellen einer Zeile: „| a | b |" → ["a", "b"]. */
export function zellen(zeile) {
  let z = zeile.trim();
  if (z.startsWith("|")) z = z.slice(1);
  if (z.endsWith("|")) z = z.slice(0, -1);
  return z.split("|").map((x) => x.trim());
}

/** Text in Abschnitte: [{art: "text", text} | {art: "tabelle", zeilen: [[…]]}]. */
export function teileText(text) {
  const out = [];
  const zeilen = String(text || "").split("\n");
  let i = 0;
  while (i < zeilen.length) {
    if (istTabellenZeile(zeilen[i])) {
      const tab = [];
      while (i < zeilen.length && istTabellenZeile(zeilen[i])) {
        if (!istTrenner(zeilen[i])) tab.push(zellen(zeilen[i]));
        i++;
      }
      const breite = Math.max(...tab.map((r) => r.length), 0);
      if (tab.length) out.push({ art: "tabelle", zeilen: tab.map((r) => [...r, ...Array(breite - r.length).fill("")]) });
    } else {
      const block = [];
      while (i < zeilen.length && !istTabellenZeile(zeilen[i])) block.push(zeilen[i++]);
      const t = block.join("\n");
      if (t.trim()) out.push({ art: "text", text: t.replace(/^\n+|\n+$/g, "") });
    }
  }
  return out;
}

export const hatTabelle = (text) => String(text || "").split("\n").some(istTabellenZeile);

/** Leere Tabelle 2×2, an der Schreibstelle auf eigenen Zeilen. */
export function tabelleEinfuegen(text, pos) {
  const t = String(text || "");
  const p = Math.max(0, Math.min(pos ?? t.length, t.length));
  const vor = t.slice(0, p), nach = t.slice(p);
  const kopf = vor && !vor.endsWith("\n") ? "\n" : "";
  const fuss = nach && !nach.startsWith("\n") ? "\n" : "";
  const geruest = "|  |  |\n|  |  |";
  return { text: vor + kopf + geruest + fuss + nach, pos: vor.length + kopf.length + 2 };
}

// Zeilenbereich [von, bis) der Tabelle, in der die Schreibstelle steht.
function block(text, pos) {
  const zeilen = text.split("\n");
  let start = 0, idx = -1;
  for (let k = 0; k < zeilen.length; k++) {
    if (pos <= start + zeilen[k].length) { idx = k; break; }
    start += zeilen[k].length + 1;
  }
  if (idx < 0) idx = zeilen.length - 1;
  if (!istTabellenZeile(zeilen[idx] || "")) return null;
  let von = idx, bis = idx + 1;
  while (von > 0 && istTabellenZeile(zeilen[von - 1])) von--;
  while (bis < zeilen.length && istTabellenZeile(zeilen[bis])) bis++;
  return { zeilen, von, bis };
}

const offset = (zeilen, k) => zeilen.slice(0, k).reduce((n, z) => n + z.length + 1, 0);

/** Eine leere Zeile ans Ende der Tabelle unter der Schreibstelle — oder null. */
export function zeileAnhaengen(text, pos) {
  const b = block(String(text || ""), pos);
  if (!b) return null;
  const breite = Math.max(...b.zeilen.slice(b.von, b.bis).filter((z) => !istTrenner(z)).map((z) => zellen(z).length));
  const neu = "|" + Array(breite).fill("  ").join("|") + "|";
  const zeilen = [...b.zeilen.slice(0, b.bis), neu, ...b.zeilen.slice(b.bis)];
  return { text: zeilen.join("\n"), pos: offset(zeilen, b.bis) + 2 };
}

/** Eine leere Spalte rechts an jede Zeile der Tabelle — oder null. */
export function spalteAnhaengen(text, pos) {
  const b = block(String(text || ""), pos);
  if (!b) return null;
  const zeilen = b.zeilen.map((z, k) => {
    if (k < b.von || k >= b.bis) return z;
    if (istTrenner(z)) return "|" + zellen(z).concat("---").join("|") + "|";
    return "| " + zellen(z).concat("").join(" | ") + " |";
  });
  const t = zeilen.join("\n");
  return { text: t, pos: offset(zeilen, b.von) + zeilen[b.von].length - 2 };
}
