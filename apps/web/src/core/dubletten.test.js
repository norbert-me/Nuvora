// Die Probe zur Dubletten-Erkennung.
//
// Wichtiger als die Treffer sind hier die Nicht-Treffer: was faelschlich als
// Dublette gilt, wird geloescht. Deshalb steht unten je ein Fall fuer die
// Unterschiede, die eine Normalisierung gerne wegbuegelt (Satzzeichen, Zahlen
// im Bruch, LaTeX).
import { describe, expect, it } from "vitest";
import { antwortSignatur, dublettenZahlen, findeDubletten, normalisiereFragetext } from "./dubletten.js";

const f = (id, text, choices, correct) => ({ id, text, choices, correct_answer: correct });
const abcd = (a, b, c, d) => ({ A: a, B: b, C: c, D: d });

describe("normalisiereFragetext", () => {
  it("zieht Leerraum zusammen, trimmt und schreibt klein", () => {
    expect(normalisiereFragetext("  Was ist   3 + 4?\n")).toBe("was ist 3 + 4?");
    expect(normalisiereFragetext("WAS IST 3 + 4?")).toBe(normalisiereFragetext("was ist 3 + 4?"));
  });

  it("behaelt Satzzeichen und LaTeX", () => {
    expect(normalisiereFragetext("$3 \\cdot \\frac{2}{7}$")).toBe("$3 \\cdot \\frac{2}{7}$");
    expect(normalisiereFragetext("Wie viel?")).not.toBe(normalisiereFragetext("Wie viel"));
  });

  it("vertraegt null und undefined", () => {
    expect(normalisiereFragetext(null)).toBe("");
    expect(normalisiereFragetext(undefined)).toBe("");
  });
});

describe("antwortSignatur", () => {
  it("ignoriert Gross-/Kleinschreibung und Leerraum in den Antworten", () => {
    expect(antwortSignatur(f(1, "x", abcd(" Zwei ", "drei", "", ""), "A")))
      .toBe(antwortSignatur(f(2, "x", abcd("zwei", "DREI", "", ""), "a")));
  });

  it("unterscheidet die richtige Antwort", () => {
    expect(antwortSignatur(f(1, "x", abcd("2", "3", "", ""), "A")))
      .not.toBe(antwortSignatur(f(2, "x", abcd("2", "3", "", ""), "B")));
  });

  it("unterscheidet vertauschte Antworten", () => {
    expect(antwortSignatur(f(1, "x", abcd("2", "3", "", ""), "A")))
      .not.toBe(antwortSignatur(f(2, "x", abcd("3", "2", "", ""), "A")));
  });
});

describe("findeDubletten", () => {
  it("findet gleichen Text mit gleichen Antworten als sichere Dublette", () => {
    const g = findeDubletten([
      f(7, "Was ist 3 + 4?", abcd("6", "7", "8", "9"), "B"),
      f(3, "  was ist 3 + 4?  ", abcd("6", "7", "8", "9"), "B"),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].gleicheAntworten).toBe(true);
    expect(g[0].behalten).toBe(3);                       // die aelteste bleibt
    expect(g[0].fragen.map((q) => q.id)).toEqual([3, 7]); // aufsteigend
  });

  it("markiert gleichen Text mit anderen Antworten getrennt", () => {
    const g = findeDubletten([
      f(1, "Wie viel ist die Haelfte von 10?", abcd("4", "5", "6", "7"), "B"),
      f(2, "Wie viel ist die Haelfte von 10?", abcd("5", "50", "0,5", "10"), "A"),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].gleicheAntworten).toBe(false);
  });

  it("sortiert Gruppen nach dem ersten Auftreten", () => {
    const g = findeDubletten([
      f(10, "B-Frage", abcd("", "", "", ""), "A"),
      f(11, "B-Frage", abcd("", "", "", ""), "A"),
      f(2, "A-Frage", abcd("", "", "", ""), "A"),
      f(20, "A-Frage", abcd("", "", "", ""), "A"),
    ]);
    expect(g.map((x) => x.behalten)).toEqual([2, 10]);
    expect(dublettenZahlen(g)).toEqual({ gruppen: 2, fragen: 4 });
  });

  // ─── Was KEINE Dublette sein darf ───
  it("haelt Bruchzahlen auseinander", () => {
    expect(findeDubletten([
      f(1, "Berechne $3 \\cdot \\frac{2}{7}$", abcd("", "", "", ""), "A"),
      f(2, "Berechne $3 \\cdot \\frac{2}{9}$", abcd("", "", "", ""), "A"),
    ])).toHaveLength(0);
  });

  it("haelt Satzzeichen-Unterschiede auseinander", () => {
    expect(findeDubletten([
      f(1, "Wie viel Prozent sind das?", abcd("", "", "", ""), "A"),
      f(2, "Wie viel Prozent sind das!", abcd("", "", "", ""), "A"),
    ])).toHaveLength(0);
  });

  it("meldet einzelne Fragen und leere Texte nicht", () => {
    expect(findeDubletten([f(1, "Einzeln", abcd("", "", "", ""), "A")])).toHaveLength(0);
    expect(findeDubletten([f(1, "   ", null, null), f(2, "", null, null)])).toHaveLength(0);
    expect(findeDubletten([])).toHaveLength(0);
    expect(findeDubletten(null)).toHaveLength(0);
  });
});
