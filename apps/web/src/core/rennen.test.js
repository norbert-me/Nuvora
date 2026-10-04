import { describe, it, expect } from "vitest";
import { baueStrecke, neuesAuto, fahre, sensoren, zufallsGehirn, mutiere, naechsteGeneration, fahreGeneration, fitness, zufallsquelle, GENE, zeitText } from "./rennen.js";

const strecke = baueStrecke();

describe("KI-Rennen: Strecke und Auto", () => {
  it("die Mittellinie liegt ganz auf der Strasse, der Start auch", () => {
    expect(strecke.mitte.every(([x, y]) => strecke.aufStrasse(x, y))).toBe(true);
    expect(strecke.aufStrasse(strecke.start.x, strecke.start.y)).toBe(true);
    expect(strecke.aufStrasse(5, 5)).toBe(false);
  });

  it("Vollgas geradeaus bringt Fortschritt, abseits bremst die Wiese", () => {
    const a = neuesAuto(strecke);
    for (let i = 0; i < 40; i++) fahre(a, strecke, 0, 1, false);
    expect(a.weg).toBeGreaterThan(0);
    expect(a.v).toBeGreaterThan(100);
  });

  it("eine KI, die von der Strasse faehrt, scheidet aus", () => {
    const a = neuesAuto(strecke);
    for (let i = 0; i < 600 && a.lebt; i++) fahre(a, strecke, 1, 1, true);   // stur im Kreis lenken
    expect(a.lebt).toBe(false);
  });

  it("Sensoren sehen auf der Strasse etwas Weite, Werte zwischen 0 und 1", () => {
    const s = sensoren(neuesAuto(strecke), strecke);
    expect(s).toHaveLength(5);
    expect(s.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(s[2]).toBeGreaterThan(0.1);
  });

  it("Zeit als Text", () => { expect(zeitText(63.456)).toBe("1:03.46"); expect(zeitText(null)).toBe("–"); });
});

describe("KI-Rennen: Evolution", () => {
  it("Mutation veraendert ungefaehr den eingestellten Anteil der Gewichte", () => {
    const rnd = zufallsquelle(7);
    const g = zufallsGehirn(rnd);
    const m = mutiere(g, 0.2, rnd);
    const anders = g.filter((w, i) => w !== m[i]).length;
    expect(anders).toBeGreaterThan(GENE * 0.05);
    expect(anders).toBeLessThan(GENE * 0.45);
  });

  it("die Besten werden unveraendert uebernommen", () => {
    const rnd = zufallsquelle(3);
    const g = [zufallsGehirn(rnd), zufallsGehirn(rnd), zufallsGehirn(rnd)];
    const n = naechsteGeneration(g, [1, 9, 5], 0.3, rnd);
    expect(n[0]).toBe(g[1]);
    expect(n[1]).toBe(g[2]);
    expect(n).toHaveLength(3);
  });

  it("ueber Generationen faehrt die beste KI weiter", () => {
    const rnd = zufallsquelle(42);
    let gehirne = Array.from({ length: 20 }, () => zufallsGehirn(rnd));
    const bestJe = [];
    for (let gen = 0; gen < 8; gen++) {
      const autos = fahreGeneration(gehirne, strecke, 12);
      const punkte = autos.map(fitness);
      bestJe.push(Math.max(...punkte));
      gehirne = naechsteGeneration(gehirne, punkte, 0.15, rnd);
    }
    // Die Besten bleiben erhalten — schlechter wird es nie, und am Ende besser als am Anfang.
    for (let i = 1; i < bestJe.length; i++) expect(bestJe[i]).toBeGreaterThanOrEqual(bestJe[i - 1] - 1e-9);
    expect(bestJe[bestJe.length - 1]).toBeGreaterThan(bestJe[0]);
  });
});
