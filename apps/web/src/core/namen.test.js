import { describe, it, expect } from "vitest";
import { kurzName } from "./namen.js";

describe("kurzName", () => {
  it("kürzt den Nachnamen auf den Anfangsbuchstaben", () => {
    expect(kurzName("Anna Meier")).toBe("Anna M.");
    // Nur der 1. Vorname (Wunsch: ueberall 1. Vorname + Nachname); „von" ist hier ein weiterer Vorname, solange
    // der Nachname nicht als „von Berg" (geschuetzt) eingetragen ist.
    expect(kurzName("Anna Maria von Berg")).toBe("Anna B.");
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

describe("Namen in Teilen", () => {
  it("erstes Wort Vorname, letztes Nachname, dazwischen weitere", async () => {
    const { teileName, anzeigeName } = await import("./namen.js");
    expect(teileName("Alexis Kate Geraldine Klein-Müller")).toEqual({ vorname: "Alexis", weitere: ["Kate", "Geraldine"], nachname: "Klein-Müller" });
    expect(anzeigeName("Alexis Kate Geraldine Klein-Müller")).toBe("Alexis Klein-Müller");
  });
  it("ein Nachname aus zwei Woertern bleibt zusammen", async () => {
    const { bauName, teileName, anzeigeName, kurzName } = await import("./namen.js");
    const n = bauName({ vorname: "Anna", weitere: ["Lena"], nachname: "Klein Müller" });
    expect(teileName(n)).toEqual({ vorname: "Anna", weitere: ["Lena"], nachname: "Klein Müller" });
    expect(anzeigeName(n)).toBe("Anna Klein Müller");
    expect(kurzName(n)).toBe("Anna K.");
  });
  it("ein einzelnes Wort ist der Vorname", async () => {
    const { teileName, anzeigeName } = await import("./namen.js");
    expect(teileName("Mia")).toEqual({ vorname: "Mia", weitere: [], nachname: "" });
    expect(anzeigeName("Mia")).toBe("Mia");
  });
});

describe("nameAusEingabe", () => {
  it("Komma, Tabulator und schlicht", async () => {
    const { nameAusEingabe, teileName } = await import("./namen.js");
    expect(teileName(nameAusEingabe("Klein Müller, Anna Lena"))).toEqual({ vorname: "Anna", weitere: ["Lena"], nachname: "Klein Müller" });
    expect(teileName(nameAusEingabe("Anna\tLena\tKlein Müller"))).toEqual({ vorname: "Anna", weitere: ["Lena"], nachname: "Klein Müller" });
    expect(nameAusEingabe("  Ben   Meier ")).toBe("Ben Meier");
  });
});
