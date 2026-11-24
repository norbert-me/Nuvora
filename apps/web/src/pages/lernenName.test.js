import { describe, expect, it } from "vitest";
import { ohneKlasse } from "./Lernen.jsx";

describe("ohneKlasse", () => {
  it("nimmt die Klasse vorn weg", () => {
    expect(ohneKlasse("7.5 — 1 Rationale Zahlen – Vergleichen & Ordnen")).toBe("1 Rationale Zahlen – Vergleichen & Ordnen");
  });
  it("lässt Namen ohne Klasse und ohne Rest unangetastet", () => {
    expect(ohneKlasse("Test Bruchrechnung")).toBe("Test Bruchrechnung");
    expect(ohneKlasse("7.5 — ")).toBe("7.5 — ");
    expect(ohneKlasse("")).toBe("");
  });
  it("kürzt nicht mitten im Namen, wenn der Trenner weit hinten steht", () => {
    const lang = "Ein sehr langer Testname ohne Klasse vorn — mit Gedankenstrich";
    expect(ohneKlasse(lang)).toBe(lang);
  });
});
