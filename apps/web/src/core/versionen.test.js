// Welchen Stand hat die Oberflaeche gelesen?
//
// Der Schluessel ist der Pfad der EINZELRESSOURCE — genau der, den das spaetere
// PUT nimmt. Faellt das auseinander, schickt der Client die Version einer
// fremden Zeile mit, und der Server lehnt Aenderungen ab, die in Ordnung sind.
import { beforeEach, describe, expect, it } from "vitest";
import { _leeren, fuer, merke, vergiss } from "./versionen.js";

globalThis.location = { origin: "https://example.test" };

describe("Versionen merken", () => {
  beforeEach(() => _leeren());

  it("lernt aus einer Liste den Pfad jedes Eintrags", () => {
    merke("/api/notizblock", [{ id: 12, version: 3 }, { id: 13, version: 1 }]);
    expect(fuer("/api/notizblock/12")).toBe(3);
    expect(fuer("/api/notizblock/13")).toBe(1);
  });

  it("lernt aus einer Einzelantwort — der Pfad traegt die ID schon", () => {
    merke("/api/notizblock/12", { id: 12, version: 7 });
    expect(fuer("/api/notizblock/12")).toBe(7);
  });

  it("kennt nichts, wo nichts gelesen wurde", () => {
    expect(fuer("/api/notizblock/99")).toBe(null);
  });

  it("ignoriert Antworten ohne Version (alle nicht versionierten Tabellen)", () => {
    merke("/api/classes", [{ id: 5, name: "7.5" }]);
    expect(fuer("/api/classes/5")).toBe(null);
  });

  it("vergisst nach dem Loeschen — sonst zeigt die Nummer auf eine Zeile, die es nicht mehr gibt", () => {
    merke("/api/notizblock", [{ id: 12, version: 3 }]);
    vergiss("/api/notizblock/12");
    expect(fuer("/api/notizblock/12")).toBe(null);
  });

  it("nimmt eine Absolutadresse genauso wie einen Pfad", () => {
    merke("https://example.test/api/todo", [{ id: 4, version: 2 }]);
    expect(fuer("https://example.test/api/todo/4")).toBe(2);
  });

  it("lernt NICHT aus verschachtelten Objekten — deren Pfad ist ein anderer", () => {
    // Die Karten eines Stapels liegen unter /api/karten/cards/{id}, nicht unter
    // /api/karten/decks/{id}. Ein geratener Schluessel zeigte auf eine fremde Zeile.
    merke("/api/karten/decks", [{ id: 1, version: 2, cards: [{ id: 99, version: 5 }] }]);
    expect(fuer("/api/karten/decks/1")).toBe(2);
    expect(fuer("/api/karten/decks/99")).toBe(null);
  });
});
