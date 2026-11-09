import { describe, it, expect } from "vitest";
import { notenTrend, spaltenNachZeit } from "./notentrend.js";

describe("notenTrend", () => {
  it("zu wenig Noten: keine Aussage", () => {
    expect(notenTrend([])).toBeNull();
    expect(notenTrend([3])).toBeNull();
  });
  it("zwei Noten reichen für eine Richtung", () => {
    expect(notenTrend([3, 2])).toBe(1);
    expect(notenTrend([2, 3])).toBe(-1);
  });
  it("kleinere Noten später = besser", () => {
    expect(notenTrend([4, 3, 2])).toBe(1);
    expect(notenTrend([4, 4, 3, 2])).toBe(1);
  });
  it("größere Noten später = schlechter", () => {
    expect(notenTrend([2, 3, 4])).toBe(-1);
  });
  it("kleine Schwankung = gleich", () => {
    expect(notenTrend([2, 2.1, 2])).toBe(0);
  });
  it("eine einzelne schwache letzte Note kippt es nicht allein", () => {
    expect(notenTrend([2, 2, 2, 2, 2.4])).toBe(0);
  });
});

describe("spaltenNachZeit", () => {
  it("Datum schlägt Reihenfolge", () => {
    const r = spaltenNachZeit([{ id: 1, date: "2026-03-01" }, { id: 2, date: "2026-01-01" }]);
    expect(r.map((c) => c.id)).toEqual([2, 1]);
  });
  it("ohne Datum bleibt die Reihenfolge", () => {
    const r = spaltenNachZeit([{ id: 1 }, { id: 2 }]);
    expect(r.map((c) => c.id)).toEqual([1, 2]);
  });
});
