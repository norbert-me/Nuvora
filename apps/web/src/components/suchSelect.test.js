import { describe, it, expect } from "vitest";

// Die Filterregel des SuchSelect — hier als reine Funktion geprüft, weil sie
// der eigentliche Inhalt der Komponente ist: alle Wörter müssen vorkommen,
// Groß-/Kleinschreibung egal. „bruch 7" soll „Bruchrechnung (7)" finden, aber
// nicht „Bruchrechnung (8)".
function treffer(optionen, suche) {
  const q = suche.trim().toLowerCase();
  if (!q) return optionen;
  const worte = q.split(/\s+/);
  return optionen.filter((o) => worte.every((w) => String(o.label || "").toLowerCase().includes(w)));
}

const LISTE = [
  { wert: 1, label: "Bruchrechnung (7)" },
  { wert: 2, label: "Bruchrechnung (8)" },
  { wert: 3, label: "Prozentrechnung" },
  { wert: 4, label: "Geometrie / Winkel" },
];

describe("SuchSelect: filtern", () => {
  it("ohne Eingabe bleibt alles stehen", () => {
    expect(treffer(LISTE, "  ")).toHaveLength(4);
  });

  it("verlangt ALLE Wörter — nicht irgendeins", () => {
    expect(treffer(LISTE, "bruch 7").map((o) => o.wert)).toEqual([1]);
  });

  it("ist gegen Groß- und Kleinschreibung gleichgültig", () => {
    expect(treffer(LISTE, "PROZENT").map((o) => o.wert)).toEqual([3]);
  });

  it("findet auch mitten im Wort — Themen heißen selten so, wie man sucht", () => {
    expect(treffer(LISTE, "winkel").map((o) => o.wert)).toEqual([4]);
  });

  it("gibt bei nichts Passendem eine leere Liste, nicht alles", () => {
    expect(treffer(LISTE, "algebra")).toEqual([]);
  });
});
