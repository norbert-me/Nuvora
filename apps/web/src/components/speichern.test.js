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
