// Zusammengeführt aus zwei gleichlautenden Blöcken in Klassenarbeit.jsx. Eine
// Korrelationsformel sieht falsch genauso plausibel aus wie richtig — deshalb
// hier nachgerechnet, inklusive der Fälle, in denen es KEINE Zahl gibt.
import { describe, expect, it } from "vitest";

import { konfidenzProzent, mittel, streuung, trennschaerfe } from "./aufgabenstatistik.js";

describe("mittel und streuung", () => {
  it("mittel über eine leere Liste ist 0, nicht NaN", () => {
    expect(mittel([])).toBe(0);
    expect(mittel([2, 4, 6])).toBe(4);
  });

  it("streuung ist die Stichproben-Streuung (n−1) und unter zwei Werten 0", () => {
    expect(streuung([])).toBe(0);
    expect(streuung([5])).toBe(0);
    expect(streuung([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
  });
});

describe("trennschaerfe", () => {
  it("gleichlaufende Reihen ergeben +1", () => {
    expect(trennschaerfe([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
  });

  it("gegenläufige Reihen ergeben −1", () => {
    expect(trennschaerfe([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 10);
  });

  it("keine Zahl, wenn eine Reihe gar nicht streut", () => {
    // Alle haben dieselbe Punktzahl — die Aufgabe trennt niemanden.
    expect(trennschaerfe([2, 2, 2, 2], [1, 5, 9, 13])).toBe(null);
    expect(trennschaerfe([1, 5, 9, 13], [3, 3, 3, 3])).toBe(null);
  });

  it("keine Zahl unter drei Arbeiten", () => {
    expect(trennschaerfe([1, 2], [2, 4])).toBe(null);
  });

  it("rechnet einen bekannten Zwischenwert nach", () => {
    // Pearson von [1,2,3] und [1,3,2]: cov = 0.5·… → 0,5
    expect(trennschaerfe([1, 2, 3], [1, 3, 2])).toBeCloseTo(0.5, 10);
  });
});

describe("konfidenzProzent", () => {
  it("ohne Streuung liegt das Intervall auf dem Mittelwert", () => {
    expect(konfidenzProzent([5, 5, 5], 10)).toEqual({ ciLow: 50, ciHigh: 50 });
  });

  it("bleibt in 0…100", () => {
    const r = konfidenzProzent([0, 10, 10, 10], 10);
    expect(r.ciLow).toBeGreaterThanOrEqual(0);
    expect(r.ciHigh).toBeLessThanOrEqual(100);
  });

  it("keine Zahl bei zu wenig Daten oder Maximum 0", () => {
    expect(konfidenzProzent([5], 10)).toEqual({ ciLow: null, ciHigh: null });
    expect(konfidenzProzent([5, 5], 0)).toEqual({ ciLow: null, ciHigh: null });
  });

  it("rechnet ein Beispiel nach: Mittel 50 % ± 1,96·SE", () => {
    // Punkte 0/10 bei Max 10 → Prozente 0/100, Mittel 50, s = 70,71, SE = 50.
    const r = konfidenzProzent([0, 10], 10);
    expect(r.ciLow).toBe(0);            // 50 − 98 → auf 0 begrenzt
    expect(r.ciHigh).toBe(100);         // 50 + 98 → auf 100 begrenzt
  });
});
