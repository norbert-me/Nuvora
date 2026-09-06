import { describe, it, expect } from "vitest";
import { umbruch, masse } from "./PapEditor.jsx";

// Ein Symbol waechst mit seinem Text, statt ihn abzuschneiden: „Wenn die Zahl
// groesser als 100 ist" ist ein normaler Satz in einem Ablaufplan, und ein
// Kaestchen mit „Wenn die Zahl gr…" beantwortet keine Frage.
describe("PAP: Beschriftung", () => {
  it("bricht an Wortgrenzen um", () => {
    expect(umbruch("Wenn die Zahl größer als 100 ist")).toEqual([
      "Wenn die Zahl größer",
      "als 100 ist",
    ]);
  });

  it("gibt bei leerem Text eine leere Zeile — nie null", () => {
    expect(umbruch("")).toEqual([""]);
    expect(umbruch(undefined)).toEqual([""]);
  });

  it("macht das Symbol höher, nicht schmaler", () => {
    const kurz = masse({ art: "anweisung", text: "x = 1" });
    const lang = masse({ art: "anweisung", text: "Wenn die Zahl größer als 100 ist, dann rechne weiter" });
    expect(lang.h).toBeGreaterThan(kurz.h);
    expect(lang.zeilen.length).toBeGreaterThan(1);
  });

  it("gibt der Raute mehr Fläche — an den Schrägen geht Platz verloren", () => {
    const text = "Ist die Zahl größer als 100?";
    expect(masse({ art: "verzweigung", text }).w)
      .toBeGreaterThan(masse({ art: "anweisung", text }).w);
  });
});
