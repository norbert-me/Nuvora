import { describe, expect, it } from "vitest";

import { istVorfahre, kinderVon, ordnerMitId, pfadZu } from "./ordnerbaum.js";

//   1 Mathe
//     2 Brüche
//       3 Kürzen
//   4 Deutsch
const baum = [
  { id: 1, name: "Mathe", parent_id: null },
  { id: 2, name: "Brüche", parent_id: 1 },
  { id: 3, name: "Kürzen", parent_id: 2 },
  { id: 4, name: "Deutsch", parent_id: null },
];

describe("pfadZu", () => {
  it("gibt den Weg von der Wurzel bis zum Ordner", () => {
    expect(pfadZu(baum, 3).map((f) => f.name)).toEqual(["Mathe", "Brüche", "Kürzen"]);
    expect(pfadZu(baum, 1).map((f) => f.name)).toEqual(["Mathe"]);
  });
  it("ist an der Wurzel leer", () => {
    expect(pfadZu(baum, null)).toEqual([]);
    expect(pfadZu(baum, 999)).toEqual([]);
  });
  it("hängt sich an fehlerhaften Daten nicht auf", () => {
    // Ordner 6 ist sein eigener Großvater — die alte Fassung in Karten.jsx
    // wäre hier in einer Endlosschleife gelandet.
    const zyklus = [
      { id: 5, name: "A", parent_id: 6 },
      { id: 6, name: "B", parent_id: 5 },
    ];
    expect(pfadZu(zyklus, 5).length).toBe(50);
  });
  it("liest den Elternteil, den der Aufrufer vorgibt (Entwurf statt Serverstand)", () => {
    // „Kürzen" ist gerade nach Deutsch gezogen, aber noch nicht gespeichert.
    const entwurf = (f) => (f.id === 3 ? 4 : f.parent_id ?? null);
    expect(pfadZu(baum, 3, entwurf).map((f) => f.name)).toEqual(["Deutsch", "Kürzen"]);
  });
});

describe("istVorfahre", () => {
  it("erkennt den Vorfahren über mehrere Stufen", () => {
    expect(istVorfahre(baum, 1, 3)).toBe(true);
    expect(istVorfahre(baum, 2, 3)).toBe(true);
  });
  it("kennt keine Verwandtschaft, wo keine ist", () => {
    expect(istVorfahre(baum, 4, 3)).toBe(false);
    expect(istVorfahre(baum, 3, 1)).toBe(false);   // Richtung zählt
  });
  it("ein Ordner ist nicht sein eigener Vorfahre", () => {
    expect(istVorfahre(baum, 2, 2)).toBe(false);
  });
  it("die Wurzel ist kein Ordner", () => {
    expect(istVorfahre(baum, null, 3)).toBe(false);
    expect(istVorfahre(baum, 1, null)).toBe(false);
  });
});

describe("kinderVon", () => {
  it("liefert nur die direkten Unterordner", () => {
    expect(kinderVon(baum, 1).map((f) => f.id)).toEqual([2]);
    expect(kinderVon(baum, null).map((f) => f.id)).toEqual([1, 4]);
    expect(kinderVon(baum, 3)).toEqual([]);
  });
});

describe("ordnerMitId", () => {
  it("findet den Ordner oder null", () => {
    expect(ordnerMitId(baum, 2).name).toBe("Brüche");
    expect(ordnerMitId(baum, null)).toBe(null);
    expect(ordnerMitId(baum, 99)).toBe(null);
  });
});
