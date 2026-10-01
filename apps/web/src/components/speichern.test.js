// Wann schwebt die Speicherleiste am unteren Bildschirmrand?
//
// Die Regel ist eine Entscheidung, keine Optik: normalerweise erst, wenn die
// eigentliche Leiste aus dem Bild ist (zwei sichtbare Speichern-Knöpfe wären
// die Frage, welcher der richtige ist) — mit `immerUnten` dagegen sofort, weil
// die Maske in einer langen Liste aufklappt und der Knopf sonst zwischen
// dreißig Zeilen liegt.
import { describe, it, expect } from "vitest";
import { sollSchweben } from "./Speichern.jsx";

describe("Speicherleiste: schweben", () => {
  it("schwebt nicht, solange nichts offen ist", () => {
    expect(sollSchweben({ geaendert: false, imBild: false })).toBe(false);
    expect(sollSchweben({ geaendert: false, immerUnten: true })).toBe(false);
  });

  it("schwebt erst, wenn die Leiste aus dem Bild ist", () => {
    expect(sollSchweben({ geaendert: true, imBild: true })).toBe(false);
    expect(sollSchweben({ geaendert: true, imBild: false })).toBe(true);
  });

  it("schwebt mit immerUnten sofort — auch wenn sie noch zu sehen wäre", () => {
    expect(sollSchweben({ geaendert: true, immerUnten: true, imBild: true })).toBe(true);
  });

  it("schwebt nie, wenn die Seite es abbestellt hat", () => {
    expect(sollSchweben({ angeheftet: false, geaendert: true, imBild: false })).toBe(false);
    expect(sollSchweben({ angeheftet: false, geaendert: true, immerUnten: true })).toBe(false);
  });
});

import { gleich } from "./Speichern.jsx";

describe("Entwurf: zurückgenommen heißt nichts offen", () => {
  it("vergleicht verschachtelt", () => {
    const vorher = { name: "KA", results: { 1: { t1: 2 } }, tasks: [{ id: "t1", parts: [{ id: "a", max: 1 }] }] };
    const zurueck = { name: "KA", results: { 1: { t1: 2 } }, tasks: [{ id: "t1", parts: [{ id: "a", max: 1 }] }] };
    expect(gleich(vorher, zurueck)).toBe(true);
    expect(gleich(vorher, { ...zurueck, results: { 1: { t1: 3 } } })).toBe(false);
  });

  it("leer ist leer", () => {
    expect(gleich({ fehler: null }, { fehler: {} })).toBe(true);
    expect(gleich({ wechsel: {} }, {})).toBe(true);
    expect(gleich({ absent: [] }, { absent: ["1"] })).toBe(false);
  });

  it("0 ist nicht leer", () => {
    expect(gleich({ p: 0 }, {})).toBe(false);
    expect(gleich({ p: "" }, {})).toBe(false);
  });
});
