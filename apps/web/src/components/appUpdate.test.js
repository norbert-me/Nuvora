// Der Versionsvergleich des App-Hinweises. Ein Zeichenkettenvergleich hielte
// "4.10.0" für älter als "4.9.0" — dann bliebe genau das Update aus, auf das es
// ankommt.
import { describe, it, expect } from "vitest";
import { neuerAls } from "./AppUpdate.jsx";

describe("neuerAls", () => {
  it("vergleicht Zahl für Zahl, nicht Zeichen für Zeichen", () => {
    expect(neuerAls("4.10.0", "4.9.0")).toBe(true);
    expect(neuerAls("4.9.0", "4.10.0")).toBe(false);
    expect(neuerAls("5.0.0", "4.99.99")).toBe(true);
  });

  it("meldet nichts bei gleicher Fassung", () => {
    expect(neuerAls("4.3.0", "4.3.0")).toBe(false);
  });

  it("kommt mit fehlenden Stellen und Unsinn zurecht", () => {
    expect(neuerAls("4.3", "4.2.9")).toBe(true);
    expect(neuerAls("", "4.3.0")).toBe(false);
    expect(neuerAls("4.3.1", "")).toBe(true);
  });
});
