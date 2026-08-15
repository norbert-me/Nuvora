// Die Indexrechnung beim Umsortieren stand fünfmal im Code — und ein
// Rechenfehler darin verschiebt Fragen, Spalten oder Karten an die falsche
// Stelle, ohne dass irgendetwas rot wird. Deshalb hier geprüft.
import { describe, expect, it } from "vitest";

import { umsortiert, zeigerHinten } from "./ziehsortieren.js";

const L = ["a", "b", "c", "d"];

describe("umsortiert", () => {
  it("schiebt nach hinten — die Entnahme verschiebt den Zielindex", () => {
    expect(umsortiert(L, "a", "c", false)).toEqual(["b", "a", "c", "d"]);
    expect(umsortiert(L, "a", "c", true)).toEqual(["b", "c", "a", "d"]);
  });

  it("schiebt nach vorn", () => {
    expect(umsortiert(L, "d", "b", false)).toEqual(["a", "d", "b", "c"]);
    expect(umsortiert(L, "d", "b", true)).toEqual(["a", "b", "d", "c"]);
  });

  it("ans Ende und an den Anfang", () => {
    expect(umsortiert(L, "a", "d", true)).toEqual(["b", "c", "d", "a"]);
    expect(umsortiert(L, "d", "a", false)).toEqual(["d", "a", "b", "c"]);
  });

  it("Nachbartausch bleibt ein Tausch, kein Sprung", () => {
    expect(umsortiert(L, "b", "c", true)).toEqual(["a", "c", "b", "d"]);
    expect(umsortiert(L, "c", "b", false)).toEqual(["a", "c", "b", "d"]);
  });

  it("nichts zu tun: gleiches oder unbekanntes Element", () => {
    expect(umsortiert(L, "b", "b", true)).toBe(null);
    expect(umsortiert(L, "x", "b", true)).toBe(null);
    expect(umsortiert(L, "b", "x", true)).toBe(null);
  });

  it("lässt die Ursprungsliste unberührt", () => {
    umsortiert(L, "a", "d", true);
    expect(L).toEqual(["a", "b", "c", "d"]);
  });
});

describe("zeigerHinten", () => {
  const ziel = (rect) => ({ currentTarget: { getBoundingClientRect: () => rect } });
  const box = { top: 100, height: 40, left: 200, width: 80 };

  it("senkrecht: obere Hälfte = davor, untere = dahinter", () => {
    expect(zeigerHinten({ ...ziel(box), clientY: 105 })).toBe(false);
    expect(zeigerHinten({ ...ziel(box), clientY: 135 })).toBe(true);
    expect(zeigerHinten({ ...ziel(box), clientY: 120 })).toBe(true); // genau die Mitte zählt als dahinter
  });

  it("waagerecht: linke Hälfte = davor, rechte = dahinter", () => {
    expect(zeigerHinten({ ...ziel(box), clientX: 210 }, true)).toBe(false);
    expect(zeigerHinten({ ...ziel(box), clientX: 270 }, true)).toBe(true);
  });
});
