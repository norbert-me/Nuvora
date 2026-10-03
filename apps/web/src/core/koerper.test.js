import { describe, it, expect } from "vitest";
import { KOERPER, baue, gefaltet, gegenueberVon, projiziere } from "./koerper.js";

const nah = (a, b, e = 1e-6) => Math.abs(a - b) < e;

describe("Körper: falten und Netz", () => {
  for (const art of Object.keys(KOERPER).filter((a) => a !== "kugel")) {
    it(`${art}: geschlossen ist der Körper selbst`, () => {
      const k = baue(art, {});
      const zu = gefaltet(k, 1);
      zu.forEach((f, i) => f.pts.forEach((p, j) => p.forEach((x, d) => expect(nah(x, k.flaechen[i].pts[j][d])).toBe(true))));
    });
    it(`${art}: aufgefaltet liegt alles flach in einer Ebene`, () => {
      const k = baue(art, {});
      const netz = gefaltet(k, 0);
      // Alle Punkte auf derselben Hoehe wie der Boden (die Wurzel liegt bei z = 0).
      netz.forEach((f) => f.pts.forEach((p) => expect(Math.abs(p[2])).toBeLessThan(1e-6)));
    });
  }

  it("Quader: Seitenflächen klappen nach außen, nicht auf den Boden", () => {
    const k = baue("quader", { a: 6, b: 4, c: 3 });
    const vorne = gefaltet(k, 0).find((f) => f.id === "vorne");
    // Boden liegt bei y in [0, 4]; vorne muss davor liegen (y <= 0).
    vorne.pts.forEach((p) => expect(p[1]).toBeLessThanOrEqual(1e-6));
    expect(Math.min(...vorne.pts.map((p) => p[1]))).toBeCloseTo(-3);
  });
});

describe("Körper: Maße", () => {
  it("Quader", () => {
    const k = baue("quader", { a: 6, b: 4, c: 3 });
    expect(k.oberflaeche).toBe(2 * (24 + 12 + 18));
    expect(k.volumen).toBe(72);
    expect(k.gruppen.reduce((s, g) => s + g.inhalt, 0)).toBeCloseTo(k.oberflaeche);
  });
  it("Zylinder, Kegel, Kugel exakt", () => {
    expect(baue("zylinder", { r: 2, h: 5 }).volumen).toBeCloseTo(Math.PI * 20);
    expect(baue("kegel", { r: 3, h: 4 }).oberflaeche).toBeCloseTo(Math.PI * 9 + Math.PI * 3 * 5);
    expect(baue("kugel", { r: 3 }).volumen).toBeCloseTo(36 * Math.PI);
  });
  it("gegenüberliegende Flächen", () => {
    const k = baue("wuerfel", {});
    expect(gegenueberVon(k, "vorne")).toBe("hinten");
    expect(gegenueberVon(k, "deckel")).toBe("boden");
    expect(gegenueberVon(baue("pyramide", {}), "seite1")).toBe(null);
  });
  it("Projektion passt ins Bild", () => {
    const k = baue("quader", {});
    const p = projiziere(gefaltet(k, 1), { gier: 0.6, nick: 0.5, breite: 800, hoehe: 500 });
    p.forEach((f) => f.bild.forEach(([x, y]) => { expect(x).toBeGreaterThanOrEqual(39); expect(x).toBeLessThanOrEqual(761); expect(y).toBeGreaterThanOrEqual(39); expect(y).toBeLessThanOrEqual(461); }));
  });
});
