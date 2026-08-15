import { describe, expect, it } from "vitest";

import { liegtDavor, nachJahrAbsteigend, startjahr } from "./schuljahr.js";

describe("startjahr", () => {
  it("liest das Startjahr aus den üblichen Schreibweisen", () => {
    expect(startjahr("2025/26")).toBe(2025);
    expect(startjahr("2025-2026")).toBe(2025);
    expect(startjahr("2025")).toBe(2025);
  });

  it("gibt null ohne Jahresangabe", () => {
    expect(startjahr("")).toBe(null);
    expect(startjahr(null)).toBe(null);
    expect(startjahr("Halbjahr")).toBe(null);
  });
});

describe("liegtDavor", () => {
  it("nimmt frühere Jahrgänge und weist das eigene ab", () => {
    expect(liegtDavor("2025/26", "2026/27")).toBe(true);
    expect(liegtDavor("2026/27", "2026/27")).toBe(false);   // dasselbe Jahr ist nie das Vorjahr
    expect(liegtDavor("2027/28", "2026/27")).toBe(false);   // ein späteres erst recht nicht
  });

  it("lässt Kurse ohne Jahresangabe zu — sonst wären Bestandskurse unerreichbar", () => {
    expect(liegtDavor("", "2026/27")).toBe(true);
    expect(liegtDavor("2025/26", "")).toBe(true);
  });
});

describe("nachJahrAbsteigend", () => {
  it("stellt das direkt vorangehende Jahr nach oben", () => {
    const liste = ["2023/24", "2025/26", "2024/25"].sort(nachJahrAbsteigend);
    expect(liste).toEqual(["2025/26", "2024/25", "2023/24"]);
  });
});
