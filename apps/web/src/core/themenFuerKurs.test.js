import { describe, it, expect } from "vitest";
import { themenFuerKurs, themenIndex, stufePasst } from "./topics.js";

const topics = [
  { id: 1, name: "Rechnen mit Brüchen", fach: "Mathematik", jahrgang: "7", nummer: "1" },
  { id: 2, name: "Vervielfachen", parent_id: 1, nummer: "1" },
  { id: 3, name: "Teilbarkeit", fach: "Mathematik", jahrgang: "6", nummer: "2" },
  { id: 4, name: "Coding (Python)", fach: "Informatik", jahrgang: "9" },
  { id: 5, name: "Office", fach: "Informatik" },
  { id: 6, name: "Ohne Fach" },
];
const idx = themenIndex(topics);
const ids = (l) => l.map((t) => t.id).sort((a, b) => a - b);

describe("Themen eines Kurses", () => {
  it("Fach und Stufe filtern, Unterthemen erben", () => {
    expect(ids(themenFuerKurs(idx, { fach: "Mathe", jahrgang: "7" }))).toEqual([1, 2]);
    expect(ids(themenFuerKurs(idx, { fach: "Informatik", jahrgang: "9" }))).toEqual([4, 5]);   // Office ohne Stufe gilt für alle
  });
  it("Gewähltes bleibt, ohne Angaben alles, leeres Ergebnis heißt alles", () => {
    expect(ids(themenFuerKurs(idx, { fach: "Informatik", jahrgang: "9" }, [3]))).toEqual([3, 4, 5]);
    expect(themenFuerKurs(idx, { fach: "", jahrgang: "" })).toHaveLength(6);
    expect(themenFuerKurs(idx, { fach: "Chemie" })).toHaveLength(6);
  });
  it("Kombistufen", () => {
    expect([stufePasst("7/8", "8"), stufePasst("7", "9"), stufePasst("", "9")]).toEqual([true, false, true]);
  });
});
