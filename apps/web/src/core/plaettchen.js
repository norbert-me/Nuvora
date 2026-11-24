// Plaettchenmodell fuer ganze Zahlen: Guthaben (+) und Schulden (−).
//
// Ein Zustand ist `{ pos, neg }` — wie viele Guthaben- und wie viele Schuldenplaettchen
// liegen. Der Wert ist pos − neg. Ein Guthaben und eine Schuld zusammen sind ein
// NULLPAAR: sie heben sich auf, der Wert aendert sich nicht. Genau das macht
// „5 − (−3)" verstehbar: wer keine Schulden hat, die er wegnehmen koennte, legt
// zuerst Nullpaare dazu (Wert bleibt), und nimmt DANN die Schulden weg.
//
// Reine Logik ohne Oberflaeche. Regressionstest: `plaettchen.test.js`.

export const MAX = 14;            // Plaettchen je Sorte, die die Oberflaeche noch ordentlich zeigt

export const wert = (z) => z.pos - z.neg;
export const start = (a) => ({ pos: Math.max(a, 0), neg: Math.max(-a, 0) });

const mehr = (z, vz, n) => (vz === "pos" ? { ...z, pos: z.pos + n } : { ...z, neg: z.neg + n });
const weniger = (z, vz, n) => (vz === "pos" ? { ...z, pos: Math.max(0, z.pos - n) } : { ...z, neg: Math.max(0, z.neg - n) });
export const nullpaare = (z) => Math.min(z.pos, z.neg);

/** Freies Legen: ein Plaettchen dazu / weg, ein Nullpaar dazu, alle Nullpaare weg. */
export const dazu = (z, vz, n = 1) => mehr(z, vz, n);
export const weg = (z, vz, n = 1) => weniger(z, vz, n);
export const paarDazu = (z, n = 1) => ({ pos: z.pos + n, neg: z.neg + n });
export const paareWeg = (z) => { const k = nullpaare(z); return { pos: z.pos - k, neg: z.neg - k }; };

/**
 * Die Schritte, in denen `a ± b` mit Plaettchen gelegt wird — jeder mit dem Zustand
 * danach. Art: "legen" | "dazu" | "nullpaare" | "weg" | "paare".
 *   vz  = Sorte, um die es geht ("pos" = Guthaben, "neg" = Schulden)
 *   n   = Anzahl
 */
export function schritte(a, op, b) {
  const aus = [];
  let z = start(a);
  aus.push({ art: "legen", vz: a < 0 ? "neg" : "pos", n: Math.abs(a), nach: z });
  if (b !== 0) {
    const vz = b > 0 ? "pos" : "neg";
    const n = Math.abs(b);
    if (op === "+") {
      z = mehr(z, vz, n);
      aus.push({ art: "dazu", vz, n, nach: z });
    } else {
      const habe = vz === "pos" ? z.pos : z.neg;
      if (habe < n) {
        // Nicht genug zum Wegnehmen: Nullpaare dazulegen — der Wert bleibt gleich.
        z = paarDazu(z, n - habe);
        aus.push({ art: "nullpaare", vz, n: n - habe, nach: z });
      }
      z = weniger(z, vz, n);
      aus.push({ art: "weg", vz, n, nach: z });
    }
  }
  const k = nullpaare(z);
  if (k > 0) {
    z = paareWeg(z);
    aus.push({ art: "paare", vz: "pos", n: k, nach: z });
  }
  return aus;
}

/** Eine Aufgabe: a ± b mit |a|, |b| ≤ 6 (so bleiben es hoechstens 12 Plaettchen je Sorte). */
export function aufgabe(art, zufall = Math.random) {
  const ganz = (lo, hi) => lo + Math.floor(zufall() * (hi - lo + 1));
  const vz = () => (zufall() < 0.5 ? 1 : -1);
  if (art === "minusMinus") return { a: ganz(-3, 6), op: "-", b: -ganz(1, 6) };       // minus eine Schuld
  if (art === "schulden") return { a: ganz(0, 6), op: "-", b: ganz(1, 6) };           // 5 − 3, auch ueber null hinaus (2 − 5)
  return { a: ganz(-6, 6), op: zufall() < 0.5 ? "+" : "-", b: ganz(1, 6) * vz() };
}
export const ARTEN = ["schulden", "minusMinus", "gemischt"];
