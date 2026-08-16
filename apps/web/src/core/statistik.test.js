// Vier Rechnungen, die vorher siebenmal im Code standen. Der Test rechnet sie
// von Hand nach — vor allem den Median, weil zwei Auswertungen dort den oberen
// der beiden mittleren Werte zeigten.
import { describe, expect, it } from "vitest";

import { median, mittel, quantil, streuung } from "./statistik.js";

describe("mittel", () => {
  it("ist 0 statt NaN bei leerer Liste", () => {
    expect(mittel([])).toBe(0);
  });
  it("rechnet das arithmetische Mittel", () => {
    expect(mittel([2, 4, 6])).toBe(4);
    expect(mittel([1])).toBe(1);
  });
});

describe("streuung", () => {
  it("ist die Stichproben-Streuung (Nenner n−1)", () => {
    // von Hand: Mittel 5, Σ(x−m)² = 9+1+1+9 = 20, /3 = 6,667, √ = 2,582
    expect(streuung([2, 4, 6, 8])).toBeCloseTo(2.582, 3);
  });
  it("ist 0, solange es nichts zu streuen gibt", () => {
    expect(streuung([])).toBe(0);
    expect(streuung([7])).toBe(0);
    expect(streuung([3, 3, 3])).toBe(0);
  });
});

describe("quantil", () => {
  const s = [10, 20, 30, 40];
  it("trifft die Ränder genau", () => {
    expect(quantil(s, 0)).toBe(10);
    expect(quantil(s, 1)).toBe(40);
  });
  it("interpoliert linear zwischen den Nachbarn", () => {
    // idx = 0,25·3 = 0,75 → zwischen 10 und 20, drei Viertel oben
    expect(quantil(s, 0.25)).toBeCloseTo(17.5, 10);
    expect(quantil(s, 0.5)).toBeCloseTo(25, 10);
    expect(quantil(s, 0.75)).toBeCloseTo(32.5, 10);
  });
  it("gibt für die leere Liste den vereinbarten Ersatzwert", () => {
    expect(quantil([], 0.5)).toBe(null);
    expect(quantil([], 0.5, 0)).toBe(0);
  });
});

describe("median", () => {
  it("bei ungerader Anzahl der mittlere Wert", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  // Genau der Fehler, den die Zusammenführung beseitigt: `pcts[floor(n/2)]`
  // hätte hier 70 gesagt — den oberen der beiden mittleren Werte, nicht den
  // Median. Bei gerader Klassenstärke war das die Regel, nicht die Ausnahme.
  it("bei gerader Anzahl das Mittel der beiden mittleren Werte", () => {
    expect(median([50, 60, 70, 80])).toBe(65);
    expect(median([60, 70])).toBe(65);
  });

  it("sortiert selbst und lässt die übergebene Liste unberührt", () => {
    const roh = [80, 50, 70, 60];
    expect(median(roh)).toBe(65);
    expect(roh).toEqual([80, 50, 70, 60]);
  });

  it("leere Liste: 0, oder was der Aufrufer vereinbart", () => {
    expect(median([])).toBe(0);
    expect(median([], null)).toBe(null);
  });
});
