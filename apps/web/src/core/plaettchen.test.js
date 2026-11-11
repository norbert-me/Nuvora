import { describe, expect, it } from "vitest";
import { ARTEN, aufgabe, dazu, nullpaare, paarDazu, paareWeg, schritte, start, wert, weg } from "./plaettchen.js";

const ende = (a, op, b) => { const s = schritte(a, op, b); return s[s.length - 1].nach; };

describe("Plättchen: Zustand", () => {
  it("Guthaben und Schulden", () => {
    expect(start(5)).toEqual({ pos: 5, neg: 0 });
    expect(start(-3)).toEqual({ pos: 0, neg: 3 });
    expect(wert({ pos: 5, neg: 3 })).toBe(2);
  });
  it("ein Nullpaar ändert den Wert nicht", () => {
    const z = { pos: 2, neg: 1 };
    expect(wert(paarDazu(z, 3))).toBe(wert(z));
    expect(nullpaare({ pos: 5, neg: 3 })).toBe(3);
    expect(paareWeg({ pos: 5, neg: 3 })).toEqual({ pos: 2, neg: 0 });
  });
  it("freies Legen und Wegnehmen, nie unter null", () => {
    expect(dazu({ pos: 0, neg: 0 }, "neg", 2)).toEqual({ pos: 0, neg: 2 });
    expect(weg({ pos: 1, neg: 0 }, "pos", 3)).toEqual({ pos: 0, neg: 0 });
  });
});

describe("Plättchen: Schritte und Ergebnis", () => {
  it("5 − 3: fünf Guthaben, drei wegnehmen", () => {
    const s = schritte(5, "-", 3);
    expect(s.map((x) => x.art)).toEqual(["legen", "weg"]);
    expect(wert(ende(5, "-", 3))).toBe(2);
  });
  it("2 − 5: erst Nullpaare, dann wegnehmen (Schulden entstehen)", () => {
    const s = schritte(2, "-", 5);
    expect(s.map((x) => x.art)).toEqual(["legen", "nullpaare", "weg"]);
    expect(s.find((x) => x.art === "nullpaare").n).toBe(3);
    expect(wert(ende(2, "-", 5))).toBe(-3);
  });
  it("3 − (−2): Schulden wegnehmen geht nur über Nullpaare — Ergebnis 5", () => {
    const s = schritte(3, "-", -2);
    expect(s.map((x) => x.art)).toEqual(["legen", "nullpaare", "weg"]);
    expect(s[1]).toMatchObject({ vz: "neg", n: 2 });
    expect(wert(ende(3, "-", -2))).toBe(5);
  });
  it("plus eine Schuld legt Schulden dazu: 4 + (−6) = −2 mit Nullpaaren am Ende", () => {
    const s = schritte(4, "+", -6);
    expect(s.map((x) => x.art)).toEqual(["legen", "dazu", "paare"]);
    expect(wert(ende(4, "+", -6))).toBe(-2);
  });
  it("jeder Weg ergibt a ± b und der Wert bleibt in jedem Schritt erklärbar", () => {
    for (let a = -6; a <= 6; a++) for (let b = -6; b <= 6; b++) for (const op of ["+", "-"]) {
      expect(wert(ende(a, op, b))).toBe(op === "+" ? a + b : a - b);
      const s = schritte(a, op, b);
      s.forEach((x) => { expect(x.nach.pos).toBeGreaterThanOrEqual(0); expect(x.nach.neg).toBeGreaterThanOrEqual(0); });
      // Nullpaare und „paare" aendern den Wert nie
      s.forEach((x, i) => { if (x.art === "nullpaare" || x.art === "paare") expect(wert(x.nach)).toBe(wert(s[i - 1].nach)); });
    }
  });
});

describe("Plättchen: Aufgaben", () => {
  it("alle Arten bleiben in den Grenzen", () => {
    for (const art of ARTEN) for (let i = 0; i < 60; i++) {
      const t = aufgabe(art);
      expect(Math.abs(t.a)).toBeLessThanOrEqual(6);
      expect(Math.abs(t.b)).toBeLessThanOrEqual(6);
      schritte(t.a, t.op, t.b).forEach((x) => { expect(x.nach.pos).toBeLessThanOrEqual(14); expect(x.nach.neg).toBeLessThanOrEqual(14); });
    }
  });
  it("minusMinus ist immer „minus eine Schuld“", () => {
    for (let i = 0; i < 30; i++) { const t = aufgabe("minusMinus"); expect(t.op).toBe("-"); expect(t.b).toBeLessThan(0); }
  });
});
