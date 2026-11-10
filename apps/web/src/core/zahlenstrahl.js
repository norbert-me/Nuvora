// Zahlenstrahl: Rechnen mit Pfeilen. Reine Logik, ohne Oberflaeche.
//
// Ein Term ist ein Start und eine Liste von Schritten `{ op: "+" | "-", zahl }`.
// Jeder Schritt legt einen PFEIL: „+ b" geht um b in Richtung des Vorzeichens
// von b, „− b" geht GENAU DAS ENTGEGENGESETZTE. Daraus folgt die Regel, die
// Kinder auswendig lernen sollen und selten verstehen: „− (−3)" legt den Pfeil
// fuer (−3) — der zeigt nach links — und dreht ihn um. Er zeigt nach rechts, also
// ist „− (−3)" dasselbe wie „+ 3".
//
// Gerechnet wird auf Zehntel genau gerundet: 0,1 + 0,2 ist im Rechner
// 0,30000000000000004, und eine solche Zahl darf nie auf dem Strahl oder im
// Ergebnis stehen.
//
// Regressionstest: `zahlenstrahl.test.js`.

export const GRENZE = 20;           // groesste Zahl (Betrag), die man eintragen kann
const r = (x) => Math.round(x * 1e6) / 1e6;

/** Auf den Rasterschritt (1, 0.5, 0.1) einrasten und in die Grenzen zwingen. */
export function rastern(x, schritt = 1, grenze = GRENZE) {
  if (!Number.isFinite(x)) return 0;
  const n = Math.round(x / schritt) * schritt;
  return r(Math.max(-grenze, Math.min(grenze, n)));
}

/** „−2,5" / „2,5" → Zahl; alles Unlesbare → null. Auch Punkt und Minuszeichen (−). */
export function leseZahl(text) {
  const t = String(text ?? "").trim().replace(/[−–]/g, "-").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Math.abs(n) <= GRENZE ? r(n) : null;
}

/** Zahl wie in Deutschland geschrieben, mit echtem Minuszeichen. */
export function schreibe(n) {
  const s = String(r(n)).replace(".", ",");
  return s.startsWith("-") ? `−${s.slice(1)}` : s;
}

/** Eine Zahl in einem Term: negative stehen in Klammern, ausser ganz vorn. */
const klammer = (n) => (n < 0 ? `(${schreibe(n)})` : schreibe(n));

/** Der Weg des Terms: Pfeile samt Start- und Endpunkt. */
export function berechne(start, schritte) {
  let pos = r(start);
  const pfeile = schritte.map((s, i) => {
    const von = pos;
    const richtung = s.op === "-" ? -Math.sign(s.zahl) : Math.sign(s.zahl);   // −1 links, 0 steht, +1 rechts
    const bis = r(s.op === "-" ? von - s.zahl : von + s.zahl);
    pos = bis;
    return {
      i, op: s.op, zahl: s.zahl, von, bis, richtung,
      // Bei „−" ist die Zahl selbst ein Pfeil in eigener Richtung, der dann umgedreht wird.
      umgedreht: s.op === "-" && s.zahl !== 0,
      eigenVon: von, eigenBis: r(von + s.zahl),
    };
  });
  return { start: r(start), pfeile, ergebnis: pos };
}

export function termText(start, schritte) {
  const kopf = schreibe(start);
  return [kopf, ...schritte.map((s) => `${s.op === "-" ? "−" : "+"} ${klammer(s.zahl)}`)].join(" ");
}

/** Welche Regel steckt in diesem Schritt? Schluessel fuer die Erklaerung. */
export function regel(s) {
  if (s.zahl === 0) return "null";
  if (s.op === "+") return s.zahl > 0 ? "plusPlus" : "plusMinus";
  return s.zahl > 0 ? "minusPlus" : "minusMinus";
}

/** Zeigerbereich fuer die Achse: alles Noetige samt Rand, auf ganze Zahlen aussen. */
export function bereich(start, schritte, mindest = 6) {
  const { pfeile } = berechne(start, schritte);
  const xs = [start, ...pfeile.flatMap((p) => [p.von, p.bis, p.eigenBis])];
  return {
    von: Math.min(-mindest, Math.floor(Math.min(...xs)) - 1),
    bis: Math.max(mindest, Math.ceil(Math.max(...xs)) + 1),
  };
}

// ── Aufgaben ────────────────────────────────────────────────────────────────
// Drei Arten, weil sie drei verschiedene Fragen stellen: Rechnen mit ganzen
// Zahlen, Rechnen mit Dezimalzahlen und der Kern der Sache — „minus eine
// negative Zahl".
export const ARTEN = ["ganz", "dezimal", "minusMinus"];

/** Eine Aufgabe; `zufall` liefert Zahlen in [0, 1) (testbar). */
export function aufgabe(art, zufall = Math.random) {
  const ganz = (lo, hi) => lo + Math.floor(zufall() * (hi - lo + 1));
  const zehntel = (lo, hi) => r(ganz(lo * 10, hi * 10) / 10);
  if (art === "dezimal") {
    const a = zehntel(-4, 4), b = zehntel(1, 3) * (zufall() < 0.5 ? 1 : -1);
    return { start: a, schritte: [{ op: zufall() < 0.5 ? "+" : "-", zahl: b || 0.5 }] };
  }
  if (art === "minusMinus") {
    return { start: ganz(-3, 5), schritte: [{ op: "-", zahl: -ganz(1, 5) }] };
  }
  const a = ganz(-5, 5), b = ganz(1, 5) * (zufall() < 0.5 ? 1 : -1);
  return { start: a, schritte: [{ op: zufall() < 0.5 ? "+" : "-", zahl: b }] };
}
