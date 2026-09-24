import { describe, expect, it } from "vitest";

import { themenIndex, themenVergleich } from "./topics.js";

const T = [
  { id: 1, name: "Netzwerk", parent_id: null, fach: "Informatik", jahrgang: "9", nummer: "9.1", position: 5 },
  { id: 2, name: "IP-Adressen", parent_id: 1, jahrgang: "9", nummer: "2", position: 1 },
  { id: 3, name: "Vermittlung", parent_id: 1, jahrgang: "9", nummer: "4", position: 2 },
  { id: 4, name: "Komponenten", parent_id: 1, jahrgang: "9", nummer: "1", position: 3 },
  { id: 5, name: "Trennung", parent_id: 1, jahrgang: "9", nummer: "3", position: 4 },
  { id: 6, name: "Algorithmen", parent_id: null, fach: "Informatik", jahrgang: "7", nummer: "7.2", position: 9 },
  { id: 7, name: "Brüche", parent_id: null, fach: "Mathematik", jahrgang: "6", nummer: "", position: 0 },
  { id: 8, name: "Daten", parent_id: null, fach: "Informatik", jahrgang: "9", nummer: "9.10", position: 1 },
];

describe("themenIndex", () => {
  it("ordnet nach Fach, Stufe und Nummer, Unterthemen nach Nummer", () => {
    const { geordnet } = themenIndex(T);
    expect(geordnet.map((t) => t.id)).toEqual([6, 1, 4, 2, 5, 3, 8, 7]);
  });

  it("zeigt Nummer im Namen und Stufe in der Auswahl", () => {
    const idx = themenIndex(T);
    expect(idx.label(T[1])).toBe("9.1 Netzwerk / 2 IP-Adressen");
    expect(idx.auswahlLabel(T[1])).toBe("Stufe 9 · 9.1 Netzwerk / 2 IP-Adressen");
    expect(idx.auswahlLabel(T[6])).toBe("Stufe 6 · Brüche");
  });

  it("ohne Nummer entscheidet die gezogene Reihenfolge", () => {
    const a = { id: 1, name: "B", parent_id: 9, nummer: "", position: 1 };
    const b = { id: 2, name: "A", parent_id: 9, nummer: "", position: 2 };
    expect([b, a].sort(themenVergleich).map((t) => t.id)).toEqual([1, 2]);
  });
});
