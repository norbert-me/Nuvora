import { describe, expect, it } from "vitest";

import { hatTabelle, spalteAnhaengen, tabelleEinfuegen, teileText, zeileAnhaengen } from "./texttabelle.js";

describe("teileText", () => {
  it("trennt Text und Tabelle, Trennzeile faellt weg, kurze Zeilen werden aufgefuellt", () => {
    const t = "Einstieg\n| Gruppe | Aufgabe |\n|---|---|\n| A | 1 |\n| B |\nDanach";
    expect(teileText(t)).toEqual([
      { art: "text", text: "Einstieg" },
      { art: "tabelle", zeilen: [["Gruppe", "Aufgabe"], ["A", "1"], ["B", ""]] },
      { art: "text", text: "Danach" },
    ]);
  });
  it("Text ohne Tabelle bleibt ein Abschnitt", () => {
    expect(teileText("a\nb")).toEqual([{ art: "text", text: "a\nb" }]);
    expect(hatTabelle("a\nb")).toBe(false);
  });
});

describe("Tabelle bearbeiten", () => {
  it("fuegt ein Geruest auf eigenen Zeilen ein", () => {
    const r = tabelleEinfuegen("Hallo", 5);
    expect(r.text).toBe("Hallo\n|  |  |\n|  |  |");
    expect(hatTabelle(r.text)).toBe(true);
  });
  it("haengt Zeile und Spalte an die Tabelle unter der Schreibstelle", () => {
    const t = "x\n| a | b |\n| c | d |\ny";
    const z = zeileAnhaengen(t, 4);
    expect(teileText(z.text)[1].zeilen).toEqual([["a", "b"], ["c", "d"], ["", ""]]);
    const s = spalteAnhaengen(t, 4);
    expect(teileText(s.text)[1].zeilen).toEqual([["a", "b", ""], ["c", "d", ""]]);
    expect(zeileAnhaengen(t, 0)).toBeNull();
  });
});
