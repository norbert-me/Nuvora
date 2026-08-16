import { describe, expect, it } from "vitest";

import { komma, kommaRund, prozent, rund } from "./zahl.js";

describe("rund", () => {
  it("rundet auf die gewünschte Stelle", () => {
    expect(rund(2.345)).toBe(2.35);
    expect(rund(2.344)).toBe(2.34);
    expect(rund(2.35, 1)).toBe(2.4);
    expect(rund(7, 2)).toBe(7);
  });
});

describe("komma", () => {
  it("macht aus dem Punkt ein Komma", () => {
    expect(komma(2.3)).toBe("2,3");
    expect(komma("2.3")).toBe("2,3");
  });
  it("lässt ganze Zahlen in Ruhe", () => {
    expect(komma(4)).toBe("4");
  });
  it("gibt für nichts das vereinbarte Zeichen", () => {
    expect(komma(null)).toBe("");
    expect(komma(undefined)).toBe("");
    expect(komma(null, "–")).toBe("–");
    expect(komma(NaN, "—")).toBe("—");
  });
  it("0 ist ein Wert und kein Nichts", () => {
    expect(komma(0, "–")).toBe("0");
  });
});

describe("kommaRund", () => {
  it("rundet und schreibt deutsch", () => {
    expect(kommaRund(2.3456)).toBe("2,35");
    expect(kommaRund(2.3456, 1)).toBe("2,3");
    expect(kommaRund(3)).toBe("3");
  });
  it("reicht das Ersatzzeichen durch", () => {
    expect(kommaRund(null, 2, "–")).toBe("–");
  });
});

describe("prozent", () => {
  it("rundet auf ganze Prozent", () => {
    expect(prozent(1, 3)).toBe(33);
    expect(prozent(2, 3)).toBe(67);
    expect(prozent(7, 7)).toBe(100);
  });
  it("ohne Bezugsgröße gibt es keinen Anteil", () => {
    expect(prozent(5, 0)).toBe(0);
    expect(prozent(5, 0, null)).toBe(null);
    expect(prozent(5, -1, null)).toBe(null);
  });
});
