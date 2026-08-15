// Die Tabellen-Tasten schieben Backslashes und `&` in einer Zeichenkette
// herum. Geht dabei etwas daneben, sieht die Lehrkraft keine Fehlermeldung,
// sondern eine rote Formel — deshalb hier nachgerechnet statt nachgeschaut.
import { describe, expect, it } from "vitest";
import { formelEinfuegen, spalteAnhaengen, TABELLE_GERUEST, zeileAnhaengen } from "./latextabelle.js";

// Zellen einer Zeile zählen: alles zwischen den Zeilentrennern `\\`.
function zeilen(tex) {
  const koerper = tex.slice(tex.indexOf("}", tex.indexOf("\\begin{array}")) + 1, tex.indexOf("\\end{array}"));
  return koerper.split("\\\\").map((z) => z.replace(/\\hline/g, "").trim())
    .filter((z, i, a) => !(i === a.length - 1 && z === ""));
}
const spalten = (tex) => (tex.match(/\\begin\{array\}\{([^}]*)\}/)[1].match(/[clr]/g) || []).length;
const zellen = (zeile) => zeile.split("&").length;

describe("LaTeX-Tabellen", () => {
  it("das Gerüst ist eine gültige 2x2-Tabelle in abgesetztem Formelsatz", () => {
    expect(TABELLE_GERUEST.startsWith("$$")).toBe(true);
    expect(TABELLE_GERUEST.endsWith("$$")).toBe(true);
    expect(spalten(TABELLE_GERUEST)).toBe(2);
    const z = zeilen(TABELLE_GERUEST);
    expect(z).toHaveLength(2);
    z.forEach((r) => expect(zellen(r)).toBe(2));
  });

  it("Zeile + hängt eine Zeile an, mit der richtigen Zahl Zellen", () => {
    const { text } = zeileAnhaengen(TABELLE_GERUEST, 30);
    const z = zeilen(text);
    expect(z).toHaveLength(3);
    z.forEach((r) => expect(zellen(r)).toBe(2));
    expect(spalten(text)).toBe(2);
    // Der Abschluss bleibt: ohne ihn fehlt der Tabelle die untere Linie.
    expect(text.trimEnd().endsWith("\\end{array}$$")).toBe(true);
  });

  it("Spalte + erweitert Angabe UND jede Zeile — sonst kippt die Tabelle", () => {
    const { text } = spalteAnhaengen(TABELLE_GERUEST, 30);
    expect(spalten(text)).toBe(3);
    const z = zeilen(text);
    expect(z).toHaveLength(2);
    z.forEach((r) => expect(zellen(r)).toBe(3));
  });

  it("beides zusammen bleibt rechteckig (3x3)", () => {
    let text = TABELLE_GERUEST;
    ({ text } = zeileAnhaengen(text, 30));
    ({ text } = spalteAnhaengen(text, 30));
    expect(spalten(text)).toBe(3);
    const z = zeilen(text);
    expect(z).toHaveLength(3);
    z.forEach((r) => expect(zellen(r)).toBe(3));
  });

  it("der Schreibpunkt landet in einer leeren Zelle, nicht mitten im Befehl", () => {
    // Links vom Schreibpunkt darf nur Weißraum bis zum letzten Trenner stehen,
    // rechts nur Weißraum bis zum nächsten — sonst tippt man in einen Befehl.
    const inLeererZelle = ({ text, pos }) => {
      const links = text.slice(0, pos).match(/(?:^|&|\\hline|\\\\)([^&\\]*)$/);
      const rechts = text.slice(pos).match(/^([^&\\]*)/);
      return links !== null && links[1].trim() === "" && rechts[1].trim() === "";
    };
    expect(inLeererZelle(zeileAnhaengen(TABELLE_GERUEST, 30))).toBe(true);
    expect(inLeererZelle(spalteAnhaengen(TABELLE_GERUEST, 30))).toBe(true);
  });

  it("ohne Tabelle am Schreibpunkt passiert nichts", () => {
    expect(zeileAnhaengen("nur Text", 3)).toBe(null);
    expect(spalteAnhaengen("nur Text", 3)).toBe(null);
    // Hinter dem Ende der Tabelle gilt sie nicht mehr als „hier".
    expect(zeileAnhaengen(`${TABELLE_GERUEST} und Text`, TABELLE_GERUEST.length + 8)).toBe(null);
  });

  it("auch eine Tabelle ohne Striche (`{cc}`) wird richtig erweitert", () => {
    const ohne = "$$\\begin{array}{cc} a & b \\\\ c & d \\end{array}$$";
    const { text } = spalteAnhaengen(ohne, 25);
    expect(text).toContain("\\begin{array}{ccc}");
    zeilen(text).forEach((r) => expect(zellen(r)).toBe(3));
  });
});

// ─── Schnelltasten ───────────────────────────────────────────────────────────
// Zusammengefuehrt aus zwei gleichlautenden `insertLatex` (Dashboard, Karten).
// Ohne Test ist die Dollarzeichen-Regel genau die Art Rechnung, die man beim
// Zusammenlegen still verdreht.
describe("formelEinfuegen", () => {
  it("setzt Dollarzeichen, wenn der Schreibpunkt ausserhalb einer Formel steht", () => {
    expect(formelEinfuegen("Rechne ", 7, 7, "\\pi ")).toEqual({ text: "Rechne $\\pi $", pos: 13 });
  });

  it("setzt KEINE Dollarzeichen INNERHALB einer Formel", () => {
    // Ein einzelnes offenes „$" davor heisst: wir stehen mitten in der Formel.
    const r = formelEinfuegen("a $x", 4, 4, "\\pi ");
    expect(r.text).toBe("a $x\\pi ");
  });

  it("setzt wieder Dollarzeichen hinter einer abgeschlossenen Formel", () => {
    const r = formelEinfuegen("a $x$ b", 7, 7, "\\pi ");
    expect(r.text).toBe("a $x$ b$\\pi $");
  });

  it("nimmt markierten Text in die erste Luecke", () => {
    const r = formelEinfuegen("ab", 0, 2, "\\sqrt{}", -1);
    expect(r.text).toBe("$\\sqrt{ab}$");
    expect(r.pos).toBe("$\\sqrt{ab}$".length - 1);
  });

  it("display setzt doppelte Dollarzeichen (Tabelle in eigener Zeile)", () => {
    const r = formelEinfuegen("", 0, 0, "T", 0, true);
    expect(r.text).toBe("$$T$$");
  });

  it("der Schreibpunkt landet um `cursor` versetzt hinter dem Eingesetzten", () => {
    const r = formelEinfuegen("", 0, 0, "\\frac{}{}", -3);
    expect(r.text).toBe("$\\frac{}{}$");
    expect(r.pos).toBe("$\\frac{}{}$".length - 3);
  });
});
