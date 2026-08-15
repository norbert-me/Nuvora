// Prozent -> Note. Haelt fest, was die Notenuebernahme voraussetzt: jeder
// Notenwert liegt in 1..6, im Einserband gibt es keine Tendenz.
//
// Anlass: gradeDetailed vergab im Einserband ein "1+" mit dem Notenwert 0,7.
// Die Uebernahme ins Notenbuch filtert auf 1..6 — STILL. Der beste Schueler
// der Klasse fiel damit aus der uebernommenen Spalte heraus, ohne Fehler.
import { describe, it, expect } from "vitest";
import { DEFAULT_SCALE, gradeFromPct, gradeDetailed, quantile, stdev, mitDatum, datumKurz } from "./grades.js";

// Eigener Schluessel einer Lehrkraft (users.grade_scale). Vom Server kommt er
// als JSON, die Schluessel sind dort Zeichenketten — genau so getestet.
const EIGEN = { "1": 90, "2": 80, "3": 65, "4": 50, "5": 25, "6": 0 };

// 0 bis 100 in Zehntelschritten — die Bandgrenzen liegen alle darin.
const SWEEP = Array.from({ length: 1001 }, (_, i) => Math.round(i) / 10);

describe("gradeFromPct — stetige Dezimalnote", () => {
  it("liefert an der Bandgrenze genau den Uebergangswert", () => {
    // Die Skala interpoliert innerhalb des Bandes: oben im Band steht die Note
    // selbst, unten die naechstschlechtere. 87 % ist der Boden des Einserbandes
    // und ergibt deshalb 2,0 — nicht 1,0 (siehe Befund im Bericht).
    expect(gradeFromPct(100, DEFAULT_SCALE)).toBe(1);
    expect(gradeFromPct(87, DEFAULT_SCALE)).toBe(2);
    expect(gradeFromPct(73, DEFAULT_SCALE)).toBe(3);
    expect(gradeFromPct(59, DEFAULT_SCALE)).toBe(4);
    expect(gradeFromPct(45, DEFAULT_SCALE)).toBe(5);
    expect(gradeFromPct(20, DEFAULT_SCALE)).toBe(6);
  });

  it("ist an der Grenze stetig — knapp darunter dasselbe Ergebnis", () => {
    for (const grenze of [87, 73, 59, 45, 20]) {
      expect(gradeFromPct(grenze - 0.001, DEFAULT_SCALE)).toBeCloseTo(gradeFromPct(grenze, DEFAULT_SCALE), 1);
    }
  });

  it("faengt die Enden ab: 100 % ist 1,0, alles unter der 5er-Grenze ist 6,0", () => {
    expect(gradeFromPct(100)).toBe(1);
    expect(gradeFromPct(19.9)).toBe(6);
    expect(gradeFromPct(0)).toBe(6);
  });

  it("bleibt ueber den ganzen Prozentbereich in 1..6 und faellt monoton", () => {
    let vorher = null;
    for (const p of SWEEP) {
      const v = gradeFromPct(p, DEFAULT_SCALE);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      if (vorher !== null) expect(v).toBeLessThanOrEqual(vorher);
      vorher = v;
    }
  });

  it("nimmt ohne Skala den DEFAULT_SCALE", () => {
    expect(gradeFromPct(75)).toBe(gradeFromPct(75, DEFAULT_SCALE));
    expect(gradeFromPct(75, null)).toBe(gradeFromPct(75, DEFAULT_SCALE));
  });

  it("rechnet mit dem eigenen Schluessel der Lehrkraft", () => {
    expect(gradeFromPct(90, EIGEN)).toBe(2);      // Boden des Einserbandes
    expect(gradeFromPct(100, EIGEN)).toBe(1);
    expect(gradeFromPct(24.9, EIGEN)).toBe(6);
    // 75 % liegt bei EIGEN im 3er-Band [65, 80): 3 + (80-75)/15 = 3,33
    expect(gradeFromPct(75, EIGEN)).toBe(3.3);
    // derselbe Prozentwert ist mit dem strengeren Schluessel schlechter
    expect(gradeFromPct(75, EIGEN)).toBeGreaterThan(gradeFromPct(75, DEFAULT_SCALE));
  });

  it("stuerzt bei unlesbarem Schluessel nicht ab und bleibt in 1..6", () => {
    // Kaputte Konfiguration (leer, Luecken, Text). Der Wert darf niemals aus
    // 1..6 herausfallen — sonst verschwindet die Note bei der Uebernahme still.
    for (const kaputt of [{}, { "1": null }, { "1": "neunzig" }]) {
      for (const p of [0, 45, 87, 100]) {
        const v = gradeFromPct(p, kaputt);
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(6);
      }
    }
  });
});

describe("gradeDetailed — Note mit Tendenz und Notenwert", () => {
  it("vergibt im Einserband weder 1+ noch 1-", () => {
    for (const p of SWEEP) {
      const d = gradeDetailed(p, DEFAULT_SCALE);
      expect(d.note).not.toBe("1+");
      expect(d.note).not.toBe("1-");
    }
    // die drei Stellen im Band ausdruecklich: unten, Mitte, oben
    expect(gradeDetailed(87, DEFAULT_SCALE)).toEqual({ note: "1", wert: 1, grade: 1 });
    expect(gradeDetailed(93.5, DEFAULT_SCALE)).toEqual({ note: "1", wert: 1, grade: 1 });
    expect(gradeDetailed(100, DEFAULT_SCALE)).toEqual({ note: "1", wert: 1, grade: 1 });
  });

  it("jeder Notenwert kommt durch den Filter der Notenuebernahme (1..6)", () => {
    // Genau dieser Filter (Klassenarbeit.jsx: value >= 1 && value <= 6) hat den
    // besten Schueler geschluckt, als der Einser-Notenwert 0,7 war.
    for (const p of SWEEP) {
      for (const s of [DEFAULT_SCALE, EIGEN]) {
        const { wert } = gradeDetailed(p, s);
        expect(wert, `${p} % mit ${JSON.stringify(s)}`).toBeGreaterThanOrEqual(1);
        expect(wert).toBeLessThanOrEqual(6);
      }
    }
  });

  it("setzt die Tendenz an den Dritteln des Bandes", () => {
    // 2er-Band ist [73, 87), Spanne 14: "-" unter 77,67, "+" ab 82,33.
    expect(gradeDetailed(73, DEFAULT_SCALE)).toEqual({ note: "2-", wert: 2.3, grade: 2 });
    expect(gradeDetailed(77.6, DEFAULT_SCALE).note).toBe("2-");
    expect(gradeDetailed(77.7, DEFAULT_SCALE)).toEqual({ note: "2", wert: 2, grade: 2 });
    expect(gradeDetailed(82.3, DEFAULT_SCALE).note).toBe("2");
    expect(gradeDetailed(82.4, DEFAULT_SCALE)).toEqual({ note: "2+", wert: 1.7, grade: 2 });
    expect(gradeDetailed(86.9, DEFAULT_SCALE).note).toBe("2+");
  });

  it("faengt das untere Ende ab: unter der 5er-Grenze eine glatte 6", () => {
    expect(gradeDetailed(20, DEFAULT_SCALE)).toEqual({ note: "5-", wert: 5.3, grade: 5 });
    expect(gradeDetailed(19.9, DEFAULT_SCALE)).toEqual({ note: "6", wert: 6, grade: 6 });
    expect(gradeDetailed(0, DEFAULT_SCALE)).toEqual({ note: "6", wert: 6, grade: 6 });
  });

  it("vergibt an der 6 keine Tendenz", () => {
    for (const p of SWEEP) {
      const d = gradeDetailed(p, DEFAULT_SCALE);
      if (d.grade === 6) expect(d.note).toBe("6");
    }
  });

  it("rechnet mit dem eigenen Schluessel der Lehrkraft", () => {
    expect(gradeDetailed(90, EIGEN)).toEqual({ note: "1", wert: 1, grade: 1 });
    // 3er-Band bei EIGEN ist [65, 80), Spanne 15: ab 75 ist es "3+"
    expect(gradeDetailed(75, EIGEN)).toEqual({ note: "3+", wert: 2.7, grade: 3 });
    expect(gradeDetailed(24.9, EIGEN)).toEqual({ note: "6", wert: 6, grade: 6 });
  });

  it("stuerzt bei unlesbarem Schluessel nicht ab und bleibt in 1..6", () => {
    for (const kaputt of [{}, { "1": null }, { "1": "neunzig" }]) {
      for (const p of [0, 45, 87, 100]) {
        const d = gradeDetailed(p, kaputt);
        expect(Number.isFinite(d.wert)).toBe(true);
        expect(d.wert).toBeGreaterThanOrEqual(1);
        expect(d.wert).toBeLessThanOrEqual(6);
        expect(d.note).not.toBe("1+");
      }
    }
  });
});

describe("Statistik-Helfer", () => {
  it("quantile interpoliert zwischen den Nachbarn", () => {
    const s = [1, 2, 3, 4];
    expect(quantile(s, 0)).toBe(1);
    expect(quantile(s, 1)).toBe(4);
    expect(quantile(s, 0.5)).toBe(2.5);
    expect(quantile([], 0.5)).toBe(null);
  });

  it("stdev ist die Stichproben-Streuung, bei einem Wert 0", () => {
    expect(stdev([])).toBe(0);
    expect(stdev([3])).toBe(0);
    expect(stdev([2, 4])).toBeCloseTo(Math.SQRT2, 10);
  });
});

describe("mitDatum", () => {
  it("haengt das Datum an, statt den Titel zu ersetzen", () => {
    expect(mitDatum("Mini-Test", "01.01.26")).toBe("Mini-Test 01.01.26");
  });

  it("nimmt nur das Datum, wenn kein Titel dasteht", () => {
    expect(mitDatum("", "01.01.26")).toBe("01.01.26");
    expect(mitDatum("   ", "01.01.26")).toBe("01.01.26");
  });

  it("tauscht ein schon angehaengtes Datum aus, statt zwei zu sammeln", () => {
    expect(mitDatum("Mini-Test 01.01.26", "02.02.26")).toBe("Mini-Test 02.02.26");
    expect(mitDatum("01.01.26", "02.02.26")).toBe("02.02.26");
  });

  it("laesst ein Datum MITTEN im Titel in Ruhe", () => {
    expect(mitDatum("Test 1.1. Wiederholung", "05.05.26")).toBe("Test 1.1. Wiederholung 05.05.26");
  });
});

describe("datumKurz", () => {
  it("macht aus dem ISO-Datum einen Spaltennamen", () => {
    expect(datumKurz("2026-02-09")).toBe("09.02.26");
    expect(datumKurz("2025-12-31")).toBe("31.12.25");
  });

  it("gibt nichts zurueck, wenn kein Datum dasteht", () => {
    // Wichtig: der Aufrufer faellt dann auf den Vorschlag „Spalte 3" zurueck.
    expect(datumKurz("")).toBe("");
    expect(datumKurz(null)).toBe("");
    expect(datumKurz("09.02.2026")).toBe("");   // schon deutsch — nicht doppelt drehen
    expect(datumKurz("2026-2-9")).toBe("");     // unvollstaendig
  });
});
