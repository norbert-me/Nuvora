import { describe, it, expect } from "vitest";
import { experimentLauf, laufBilanz, STRECKEN, SPUR, strecke as streckeVon, baueStrecke, neuesAuto, fahre, sensoren, zufallsGehirn, mutiere, naechsteGeneration, fahreGeneration, fitness, zufallsquelle, genAnzahl, netzForm, denkeInnen, gehirnAusJson, gehirnZuJson, zeitText } from "./rennen.js";

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
    const anders = g.w.filter((w, i) => w !== m.w[i]).length;
    const n = genAnzahl(g.form);
    expect(anders).toBeGreaterThan(n * 0.05);
    expect(anders).toBeLessThan(n * 0.45);
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

describe("KI-Rennen: alle Strecken", () => {
  it.each(Object.keys(STRECKEN))("%s: liegt im Bild, Start auf der Strasse, Fahrbahnen halten Abstand", (name) => {
    const s = streckeVon(name);
    const m = s.mitte, n = m.length;
    expect(s.aufStrasse(s.start.x, s.start.y)).toBe(true);
    expect(m.every(([x, y]) => x > SPUR / 2 && x < 900 - SPUR / 2 && y > SPUR / 2 && y < 600 - SPUR / 2)).toBe(true);
    let min = Infinity;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (Math.min(Math.abs(i - j), n - Math.abs(i - j)) < 25) continue;
      min = Math.min(min, Math.hypot(m[i][0] - m[j][0], m[i][1] - m[j][1]));
    }
    expect(min).toBeGreaterThan(SPUR + 30);
  });
});

describe("KI-Rennen: Experiment", () => {
  it("ein Lauf ist mit gleichem Startwert reproduzierbar und liefert je Generation Werte", () => {
    const st = streckeVon("oval");
    const a = experimentLauf({ rate: 0.15, anzahl: 12, grenze: 10, seed: 5, strecke: st });
    const b = experimentLauf({ rate: 0.15, anzahl: 12, grenze: 10, seed: 5, strecke: st });
    const ra = [a.weiter(), a.weiter(), a.weiter()], rb = [b.weiter(), b.weiter(), b.weiter()];
    expect(ra).toEqual(rb);
    expect(ra[0]).toHaveProperty("anteil");
  });
  it("Bilanz: erste Runde und Bestzeit", () => {
    expect(laufBilanz([{ beste: null, anteil: 0 }, { beste: 12, anteil: 0.1 }, { beste: 10, anteil: 0.3 }]))
      .toEqual({ ersteRunde: 2, bestzeit: 10, anteilEnde: 0.3 });
    expect(laufBilanz([{ beste: null, anteil: 0 }]).ersteRunde).toBe(null);
  });
});

describe("KI-Rennen: Netzform", () => {
  it("Schichten und Neuronen bestimmen die Zahl der Gewichte und die Zwischenwerte", () => {
    expect(genAnzahl(netzForm(1, 8))).toBe(6 * 8 + 8 + 8 * 2 + 2);
    expect(genAnzahl(netzForm(0, 8))).toBe(6 * 2 + 2);
    const g = zufallsGehirn(zufallsquelle(1), netzForm(2, 4));
    const r = denkeInnen(g, [0.5, 0.5, 1, 0.5, 0.5, 0.3]);
    expect(r.schichten.map((x) => x.length)).toEqual([6, 4, 4, 2]);
    expect(r.aus.every((v) => v >= -1 && v <= 1)).toBe(true);
  });
  it("Speichern und Laden, alter Speicherstand wird zum Netz 6-8-2", () => {
    const g = zufallsGehirn(zufallsquelle(2), netzForm(2, 5));
    const z = gehirnAusJson(JSON.parse(JSON.stringify(gehirnZuJson(g))));
    expect(z.form).toEqual(g.form);
    expect(Array.from(z.w)).toEqual(Array.from(g.w));
    expect(gehirnAusJson(new Array(74).fill(0)).form).toEqual([6, 8, 2]);
    expect(gehirnAusJson({ form: [6, 2], w: [1] })).toBe(null);
  });
});
