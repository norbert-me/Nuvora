// Welche Stunde zeigt eine Seite, die gerade aufgeht?
//
// Der Anlass ist ein Fehlerbild, das nach etwas ganz anderem aussah: „die
// Anwesenheit wird nicht geladen, sondern nur gesetzt". Geladen wurde sehr
// wohl — nur immer die ERSTE Stunde des Tages, und dort stand nichts, weil die
// Lehrkraft in der 5. eingetragen hatte.
import { describe, it, expect } from "vitest";
import { laufendeStunde, slotGiltAm, stundenZeit } from "./stunden.js";

const ZEITEN = [
  { start: "08:00", end: "08:45" },  // 1.
  { start: "08:50", end: "09:35" },  // 2.
  { start: "09:55", end: "10:40" },  // 3.
];
const SLOTS = [1, 2, 3].map((p) => ({ period: p }));
const um = (h, m) => h * 60 + m;

describe("laufendeStunde", () => {
  it("nimmt die Stunde, die gerade laeuft", () => {
    expect(laufendeStunde(SLOTS, ZEITEN, null, um(9, 10))?.period).toBe(2);
  });
  it("vor dem Unterricht die erste", () => {
    expect(laufendeStunde(SLOTS, ZEITEN, null, um(7, 0))?.period).toBe(1);
  });
  it("in der Pause die naechste", () => {
    expect(laufendeStunde(SLOTS, ZEITEN, null, um(9, 45))?.period).toBe(3);
  });
  it("nach dem Unterricht die letzte — nicht wieder die erste", () => {
    expect(laufendeStunde(SLOTS, ZEITEN, null, um(15, 0))?.period).toBe(3);
  });
  it("an einem anderen Tag sagt die Uhr nichts: die erste", () => {
    expect(laufendeStunde(SLOTS, ZEITEN, null, null)?.period).toBe(1);
  });
  it("ohne gepflegte Uhrzeiten bleibt es bei der ersten", () => {
    expect(laufendeStunde(SLOTS, [], null, um(15, 0))?.period).toBe(1);
  });
  it("die 0. Stunde hat ihre eigene Zeit", () => {
    const mitNull = [{ period: 0 }, ...SLOTS];
    const zero = { start: "07:10", end: "07:55" };
    expect(laufendeStunde(mitNull, ZEITEN, zero, um(7, 30))?.period).toBe(0);
    expect(stundenZeit(ZEITEN, zero, 0)).toEqual(zero);
  });
  it("ohne Kandidaten nichts", () => {
    expect(laufendeStunde([], ZEITEN, null, um(9, 0))).toBe(null);
  });
  it("slotGiltAm bleibt unberuehrt", () => {
    expect(slotGiltAm({ valid_from: "2026-02-01" }, "2026-01-31")).toBe(false);
    expect(slotGiltAm({ valid_from: "2026-02-01" }, "2026-02-01")).toBe(true);
  });
});
