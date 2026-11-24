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

import { sortiereKinder, nameTeile } from "./namen.js";

describe("Kinder sortieren", () => {
  const kinder = [
    { id: 1, name: "Zoe Albrecht", klasse: "8b" },
    { id: 2, name: "Anna Maria Zander", klasse: "8a" },
    { id: 3, name: "Ben Meier", klasse: "10a" },
    { id: 4, name: "Anna Bauer", klasse: "8a" },
  ];
  const ids = (l) => l.map((k) => k.id);
  it("Nachname ist der letzte Teil, Vorname der Rest", () => {
    expect(nameTeile("Anna Maria Zander")).toEqual({ vor: "Anna Maria", nach: "Zander" });
    expect(nameTeile("Cher")).toEqual({ vor: "", nach: "Cher" });
  });
  it("liste laesst die Reihenfolge, die Eingabe bleibt unveraendert", () => {
    expect(sortiereKinder(kinder, "liste")).toBe(kinder);
    sortiereKinder(kinder, "nachname");
    expect(ids(kinder)).toEqual([1, 2, 3, 4]);
  });
  it("nach Nachname", () => { expect(ids(sortiereKinder(kinder, "nachname"))).toEqual([1, 4, 3, 2]); });
  it("nach Vorname, bei gleichem Vornamen nach Nachname", () => { expect(ids(sortiereKinder(kinder, "vorname"))).toEqual([4, 2, 3, 1]); });
  it("nach Klasse: 8a vor 8b vor 10a (Zahlen als Zahlen), darin nach Nachname", () => {
    expect(ids(sortiereKinder(kinder, "klasse"))).toEqual([4, 2, 1, 3]);
  });
});
