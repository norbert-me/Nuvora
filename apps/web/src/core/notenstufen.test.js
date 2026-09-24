import { describe, expect, it } from "vitest";

import { stufeVon, stufen, verteilung } from "./notenstufen.js";

describe("notenstufen", () => {
  it("ganze Stufen runden: 2,7 ist 3+, nicht 2", () => {
    expect(stufeVon(2.7, false)).toBe(3);
    expect(stufeVon(2.3, false)).toBe(2);
  });
  it("halbe Stufen: 1,7 und 2,3 landen auf 1,5 und 2,5", () => {
    expect(stufeVon(1.7, true)).toBe(1.5);
    expect(stufeVon(2.3, true)).toBe(2.5);
    expect(stufeVon(2.0, true)).toBe(2);
  });
  it("hat 6 bzw. 11 Stufen", () => {
    expect(stufen(false)).toHaveLength(6);
    expect(stufen(true)).toEqual([1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6]);
  });
  it("verteilt und lässt Leeres weg", () => {
    const d = verteilung([1, 1.7, 2.3, null, 6], true);
    expect(d.find((x) => x.g === 1).n).toBe(1);
    expect(d.find((x) => x.g === 1.5).n).toBe(1);
    expect(d.find((x) => x.g === 2.5).n).toBe(1);
    expect(d.find((x) => x.g === 6).n).toBe(1);
    expect(d.reduce((s, x) => s + x.n, 0)).toBe(4);
  });
});
