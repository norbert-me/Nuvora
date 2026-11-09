import { describe, it, expect } from "vitest";
import { kurzName } from "./namen.js";

describe("kurzName", () => {
  it("kürzt den Nachnamen auf den Anfangsbuchstaben", () => {
    expect(kurzName("Anna Meier")).toBe("Anna M.");
    expect(kurzName("Anna Maria von Berg")).toBe("Anna Maria von B.");
  });
  it("lässt Einzelnes und schon Gekürztes", () => {
    expect(kurzName("Anna")).toBe("Anna");
    expect(kurzName("Clara E.")).toBe("Clara E.");
    expect(kurzName("")).toBe("");
    expect(kurzName(null)).toBe("");
  });
});
