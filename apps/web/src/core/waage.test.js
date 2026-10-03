import { describe, it, expect } from "vitest";
import { stand, loesung, pruefeGleichung, umformen, geloest, neigung, pruefeWeg, ablesen, gleichungText, zufall } from "./waage.js";

describe("Waage: Rechenkern", () => {
  const s = stand(3, 2, 0, 14);   // 3x + 2 = 14

  it("Lösung und Prüfung", () => {
    expect(loesung(s)).toBe(4);
    expect(pruefeGleichung(s)).toBe(null);
    expect(pruefeGleichung(stand(2, 1, 0, 6))).toBe("keineLoesung");   // x = 2,5
    expect(pruefeGleichung(stand(1, 5, 0, 3))).toBe("keineLoesung");   // x = −2
    expect(pruefeGleichung(stand(0, 1, 0, 1))).toBe("keinX");
    expect(pruefeGleichung(stand(1, 100, 0, 104))).toBe("zuGross");
  });

  it("auf beiden Seiten dasselbe", () => {
    const a = umformen(s, "-e", 2).stand;
    expect(gleichungText(a)).toBe("3x = 12");
    const b = umformen(a, ":", 3).stand;
    expect(gleichungText(b)).toBe("x = 4");
    expect(geloest(b)).toBe(true);
  });

  it("nimmt nichts weg, was nicht da ist, und teilt nur gleichmäßig", () => {
    expect(umformen(s, "-e", 3).fehler).toBe("zuWenigE");
    expect(umformen(s, "-x", 1).fehler).toBe("zuWenigX");
    expect(umformen(s, ":", 3).fehler).toBe("teilen");
  });

  it("Neigung mit dem wahren x", () => {
    expect(neigung(s, 4)).toBe(0);
    expect(neigung(stand(3, 0, 0, 14), 4)).toBe(1);   // links weggenommen → rechts schwerer
  });

  it("prüft einen Weg nach", () => {
    const w = [stand(3, 0, 0, 12), stand(1, 0, 0, 4)];
    expect(pruefeWeg(s, w)).toEqual({ gueltig: true, geloest: true });
    expect(pruefeWeg(s, [stand(3, 0, 0, 13)])).toEqual({ gueltig: false, geloest: false });
    expect(pruefeWeg(s, [stand(3, 2, 0, 14)])).toEqual({ gueltig: true, geloest: false });
  });

  it("liest Handgriffe ab", () => {
    expect(ablesen(s, stand(3, 0, 0, 12))).toEqual({ art: "-e", n: 2 });
    expect(ablesen(s, stand(2, 2, 0, 10))).toEqual({ art: "frei" });
    expect(ablesen(stand(3, 0, 0, 12), stand(1, 0, 0, 4))).toEqual({ art: ":", n: 3 });
    expect(ablesen(stand(4, 2, 0, 18), stand(2, 1, 0, 9))).toEqual({ art: ":", n: 2 });
  });

  it("Zufall liefert lösbare Gleichungen auf jeder Stufe", () => {
    for (let st = 1; st <= 4; st++) for (let i = 0; i < 50; i++) expect(pruefeGleichung(zufall(st))).toBe(null);
  });
});
