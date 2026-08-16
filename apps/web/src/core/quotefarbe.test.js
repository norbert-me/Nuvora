// Die 80/50-Schwelle stand achtmal im Code — als Funktion und als Bedingung
// mitten in einem style-Objekt. Sie liegt jetzt bei den Farben (Icons.jsx),
// weil sie eine Setzung ist und keine Rechnung; geprüft wird sie hier, weil
// eine verschobene Schwelle sonst niemandem auffällt: dieselbe 79 % war in der
// Klassenauswertung gelb und in der Schülerauswertung grün.
import { describe, expect, it } from "vitest";

import { COLORS, quoteFarbe, quoteFlaeche, QUOTE_GUT, QUOTE_MITTEL } from "../components/Icons.jsx";

describe("quoteFarbe", () => {
  it("grün ab der guten Schwelle, einschließlich", () => {
    expect(quoteFarbe(QUOTE_GUT)).toBe(COLORS.success);
    expect(quoteFarbe(100)).toBe(COLORS.success);
  });
  it("gelb dazwischen, rot darunter", () => {
    expect(quoteFarbe(QUOTE_GUT - 1)).toBe(COLORS.warning);
    expect(quoteFarbe(QUOTE_MITTEL)).toBe(COLORS.warning);
    expect(quoteFarbe(QUOTE_MITTEL - 1)).toBe(COLORS.danger);
    expect(quoteFarbe(0)).toBe(COLORS.danger);
  });
  it("keine Angabe ist nicht rot, sondern grau", () => {
    // Vorher lief `null >= 80` und `null >= 50` beide ins Leere und färbte die
    // Zelle rot — „nicht geschrieben" sah aus wie „durchgefallen".
    expect(quoteFarbe(null)).toBe("var(--text3)");
    expect(quoteFarbe(undefined)).toBe("var(--text3)");
  });
});

describe("quoteFlaeche", () => {
  it("färbt Fläche und Schrift zur selben Aussage", () => {
    expect(quoteFlaeche(90)).toEqual({ background: "var(--success-bg)", color: COLORS.success });
    expect(quoteFlaeche(60)).toEqual({ background: "var(--warn-bg)", color: COLORS.warning });
    expect(quoteFlaeche(10)).toEqual({ background: "var(--danger-bg)", color: COLORS.danger });
  });
  it("stimmt an jeder Stufe mit der Schriftfarbe überein", () => {
    for (const p of [0, 49, 50, 79, 80, 100]) {
      expect(quoteFlaeche(p).color).toBe(quoteFarbe(p));
    }
  });
  it("keine Angabe bleibt neutral", () => {
    expect(quoteFlaeche(null)).toEqual({ background: "var(--bg2)", color: "var(--text3)" });
  });
});
