import { describe, expect, it } from "vitest";
import { aufgabe, bereich, berechne, leseZahl, rastern, regel, schreibe, termText } from "./zahlenstrahl.js";

describe("Zahlenstrahl: Pfeile und Ergebnis", () => {
  it("plus und minus mit positiven Zahlen", () => {
    expect(berechne(2, [{ op: "+", zahl: 3 }]).ergebnis).toBe(5);
    expect(berechne(2, [{ op: "-", zahl: 3 }]).ergebnis).toBe(-1);
  });
  it("minus eine negative Zahl ist plus: der Pfeil wird umgedreht", () => {
    const w = berechne(2, [{ op: "-", zahl: -3 }]);
    expect(w.ergebnis).toBe(5);
    expect(w.pfeile[0].richtung).toBe(1);        // nach rechts
    expect(w.pfeile[0].umgedreht).toBe(true);
    expect(w.pfeile[0].eigenBis).toBe(-1);       // (−3) selbst zeigt nach links
  });
  it("plus eine negative Zahl geht nach links", () => {
    const w = berechne(2, [{ op: "+", zahl: -3 }]);
    expect(w.ergebnis).toBe(-1);
    expect(w.pfeile[0].richtung).toBe(-1);
    expect(w.pfeile[0].umgedreht).toBe(false);
  });
  it("mehrere Schritte laufen hintereinander", () => {
    const w = berechne(0, [{ op: "+", zahl: 4 }, { op: "-", zahl: 6 }, { op: "-", zahl: -1 }]);
    expect(w.pfeile.map((p) => [p.von, p.bis])).toEqual([[0, 4], [4, -2], [-2, -1]]);
    expect(w.ergebnis).toBe(-1);
  });
  it("Dezimalzahlen ohne Rechenrauschen", () => {
    expect(berechne(0.1, [{ op: "+", zahl: 0.2 }]).ergebnis).toBe(0.3);
    expect(berechne(-0.3, [{ op: "-", zahl: -0.1 }]).ergebnis).toBe(-0.2);
  });
  it("Regeln", () => {
    expect(regel({ op: "+", zahl: 2 })).toBe("plusPlus");
    expect(regel({ op: "+", zahl: -2 })).toBe("plusMinus");
    expect(regel({ op: "-", zahl: 2 })).toBe("minusPlus");
    expect(regel({ op: "-", zahl: -2 })).toBe("minusMinus");
    expect(regel({ op: "-", zahl: 0 })).toBe("null");
  });
});

describe("Zahlenstrahl: Schreibweise und Eingabe", () => {
  it("Term mit Klammern um negative Zahlen und echtem Minus", () => {
    expect(termText(2, [{ op: "-", zahl: -3 }])).toBe("2 − (−3)");
    expect(termText(-1.5, [{ op: "+", zahl: 0.5 }])).toBe("−1,5 + 0,5");
  });
  it("Zahl lesen: Komma, Punkt, Minuszeichen; Unsinn und Zu-Grosses ergeben null", () => {
    expect(leseZahl("-2,5")).toBe(-2.5);
    expect(leseZahl("−3")).toBe(-3);
    expect(leseZahl("1.5")).toBe(1.5);
    expect(leseZahl("abc")).toBeNull();
    expect(leseZahl("")).toBeNull();
    expect(leseZahl("99")).toBeNull();
  });
  it("Einrasten auf das Raster und in die Grenzen", () => {
    expect(rastern(2.26, 0.5)).toBe(2.5);
    expect(rastern(0.34, 0.1)).toBe(0.3);
    expect(rastern(99, 1)).toBe(20);
    expect(schreibe(-0.1)).toBe("−0,1");
  });
  it("Bereich enthaelt jeden Punkt samt Rand", () => {
    const b = bereich(0, [{ op: "+", zahl: 15 }]);
    expect(b.bis).toBeGreaterThanOrEqual(16);
    expect(b.von).toBeLessThanOrEqual(-6);
  });
});

describe("Zahlenstrahl: Aufgaben", () => {
  it("minusMinus ist immer „minus eine negative Zahl“", () => {
    for (let i = 0; i < 30; i++) {
      const a = aufgabe("minusMinus");
      expect(a.schritte[0].op).toBe("-");
      expect(a.schritte[0].zahl).toBeLessThan(0);
    }
  });
  it("Dezimalaufgaben haben Zehntel, keine Rechenreste", () => {
    for (let i = 0; i < 30; i++) {
      const a = aufgabe("dezimal");
      const e = berechne(a.start, a.schritte).ergebnis;
      expect(Math.round(e * 10) / 10).toBe(e);
    }
  });
});
