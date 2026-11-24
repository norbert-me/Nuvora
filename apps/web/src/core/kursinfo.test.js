import { describe, it, expect } from "vitest";
import { wiederholungsbedarf, kursSchnitt } from "./kursinfo.js";

const kind = (themen) => ({ themen });
describe("wiederholungsbedarf", () => {
  it("meldet Themen unter der Schwelle, schwaechste zuerst, mit der Zahl der Kinder darunter", () => {
    const p = [{ schueler: [
      kind([{ topic_id: 1, name: "Brüche", pct: 30 }, { topic_id: 2, name: "Prozent", pct: 90 }]),
      kind([{ topic_id: 1, name: "Brüche", pct: 60 }, { topic_id: 2, name: "Prozent", pct: 80 }, { topic_id: 3, name: "Zinsen", pct: 55 }]),
    ] }];
    const r = wiederholungsbedarf(p);
    expect(r.datenDa).toBe(true);
    expect(r.themen.map((t) => [t.name, t.pct, t.darunter])).toEqual([["Brüche", 45, 1], ["Zinsen", 55, 0]]);
  });
  it("pct null (zu wenig Punkte) zaehlt weder als gut noch als schlecht", () => {
    const r = wiederholungsbedarf([{ schueler: [kind([{ topic_id: 1, name: "A", pct: null }])] }]);
    expect(r.datenDa).toBe(false);
    expect(r.themen).toEqual([]);
  });
  it("mehrere Klassen eines Kurses werden zusammengelegt, max begrenzt", () => {
    const k = (id, pct) => kind([{ topic_id: id, name: `T${id}`, pct }]);
    const r = wiederholungsbedarf([{ schueler: [k(1, 10), k(2, 20), k(3, 30)] }, { schueler: [k(4, 40), k(5, 50), k(6, 55), k(7, 90)] }], { max: 4 });
    expect(r.themen.map((t) => t.name)).toEqual(["T1", "T2", "T3", "T4"]);
    expect(r.kinderMitZahl).toBe(7);
  });
  it("leere Eingaben stuerzen nicht", () => {
    expect(wiederholungsbedarf(null).themen).toEqual([]);
    expect(wiederholungsbedarf([{}]).datenDa).toBe(false);
  });
});

describe("kursSchnitt", () => {
  it("mittelt die Gesamtnoten ohne LE-Kinder und ohne Kinder ohne Note", () => {
    const r = kursSchnitt([{ weighted: 2 }, { weighted: 3 }, { weighted: null }, { weighted: 1, le: true }]);
    expect(r).toEqual({ schnitt: 2.5, n: 2 });
    expect(kursSchnitt([])).toBeNull();
  });
});
