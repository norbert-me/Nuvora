import { describe, it, expect } from "vitest";
import { istOeffentlich } from "./oeffentlich.js";

describe("oeffentliche Wege", () => {
  it("erkennt die ausgeteilten Zugaenge an der Adresse", () => {
    expect(istOeffentlich("/api/karten/lernen/abc123")).toBe(true);
    expect(istOeffentlich("/api/lernen/abc123/pap")).toBe(true);
    expect(istOeffentlich("/api/codedetektiv/sessions/AB12CD")).toBe(true);
  });
  it("erkennt sie auch an der geoeffneten Seite", () => {
    expect(istOeffentlich("/api/modules", "/lernen/abc123")).toBe(true);
    expect(istOeffentlich("/api/modules", "/cd/AB12CD")).toBe(true);
    expect(istOeffentlich("/api/modules", "/pap-frei")).toBe(true);
  });
  it("laesst die Wege des Kontos in Ruhe", () => {
    expect(istOeffentlich("/api/classes", "/classes")).toBe(false);
    expect(istOeffentlich("/api/karten/decks", "/karten")).toBe(false);
    // „lernen" als Wortteil ist kein ausgeteilter Zugang.
    expect(istOeffentlich("/api/lernpfad/exercises", "/lernpfad")).toBe(false);
  });
});
