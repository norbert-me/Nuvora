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

// Die Achse ist FEST: wuchs und schrumpfte sie mit den Pfeilen, wanderte beim
// Ziehen alles unter dem Finger weg. Ganze Zahlen und Halbe laufen von −10 bis
// +10, die Version mit Zehnteln ist entsprechend kleiner (−2 bis +2).
export const RASTER = [1, 0.5, 0.1];
export const achsenRadius = (raster = 1) => (raster <= 0.1 ? 2 : 10);
const r = (x) => Math.round(x * 1e6) / 1e6;

/** Auf den Rasterschritt (1, 0.5, 0.1) einrasten und in die Grenzen zwingen. */
export function rastern(x, schritt = 1, grenze = 10) {
  if (!Number.isFinite(x)) return 0;
  const n = Math.round(x / schritt) * schritt;
  return r(Math.max(-grenze, Math.min(grenze, n)));
}

/** „−2,5" / „2,5" → Zahl; alles Unlesbare → null. Auch Punkt und Minuszeichen (−). */
export function leseZahl(text, grenze = 10) {
  const t = String(text ?? "").trim().replace(/[−–]/g, "-").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Math.abs(n) <= grenze ? r(n) : null;
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

/**
 * Haelt jeden Pfeil auf der festen Achse: Start, jede Spitze — und bei „minus"
 * auch die Spitze des Pfeils der Zahl selbst — liegen in [−R, R]. Die Schritte
 * werden der Reihe nach angepasst; eine zu grosse Zahl wird auf das gekuerzt,
 * was noch passt (statt den Pfeil aus dem Bild laufen zu lassen).
 */
export function begrenze(start, schritte, R) {
  const st = rastern(start, 0.1, R);
  let pos = st;
  const aus = schritte.map((s) => {
    let lo = -R - pos, hi = R - pos;                       // die Zahl selbst: pos + zahl in [−R, R]
    if (s.op === "-") { lo = Math.max(lo, pos - R); hi = Math.min(hi, pos + R); }   // pos − zahl in [−R, R]
    const zahl = r(Math.min(hi, Math.max(lo, s.zahl)));
    pos = r(s.op === "-" ? pos - zahl : pos + zahl);
    return { ...s, zahl };
  });
  return { start: st, schritte: aus };
}

/**
 * Die Schritte einer Aufgabe in der Reihenfolge, in der sie gezeigt werden. Ein
 * „+"-Schritt ist EIN Schritt (Pfeil legen); ein „−"-Schritt sind ZWEI: erst
 * entsteht der Pfeil der Zahl selbst, danach wird er umgedreht. Genau diese
 * Trennung zeigt, woher das Plus bei „minus eine negative Zahl" kommt.
 */
export function phasen(pfeile) {
  return pfeile.flatMap((p) => (p.umgedreht ? [{ i: p.i, art: "erzeugen" }, { i: p.i, art: "drehen" }] : [{ i: p.i, art: "erzeugen" }]));
}

// ── Aufgaben ────────────────────────────────────────────────────────────────
// Drei Arten, weil sie drei verschiedene Fragen stellen: Rechnen mit ganzen
// Zahlen, Rechnen mit Dezimalzahlen und der Kern der Sache — „minus eine
// negative Zahl".
export const ARTEN = ["ganz", "dezimal", "minusMinus"];

/** Eine Aufgabe; `zufall` liefert Zahlen in [0, 1) (testbar). Mit Raster 0,1 liegen alle Zahlen
 *  auf Zehnteln und im kleinen Bereich der Achse. */
export function aufgabe(art, zufall = Math.random, raster = 1) {
  const ganz = (lo, hi) => lo + Math.floor(zufall() * (hi - lo + 1));
  const vz = () => (zufall() < 0.5 ? 1 : -1);
  const op = () => (zufall() < 0.5 ? "+" : "-");
  if (raster <= 0.1) {
    // Zehntel: Start höchstens ±0,9, Zahl 0,1 … 0,9 — Ergebnis und Pfeil bleiben in ±2.
    const z = (lo, hi) => r(ganz(lo, hi) / 10);
    if (art === "minusMinus") return { start: z(-5, 9), schritte: [{ op: "-", zahl: -z(1, 9) }] };
    return { start: z(-9, 9), schritte: [{ op: op(), zahl: z(1, 9) * vz() }] };
  }
  const halb = (lo, hi) => r(ganz(lo * 2, hi * 2) / 2);
  if (art === "dezimal") {
    return { start: halb(-4, 4), schritte: [{ op: op(), zahl: halb(1, 4) * vz() || 0.5 }] };
  }
  if (art === "minusMinus") {
    return { start: ganz(-3, 5), schritte: [{ op: "-", zahl: -ganz(1, 5) }] };
  }
  return { start: ganz(-5, 5), schritte: [{ op: op(), zahl: ganz(1, 5) * vz() }] };
}
