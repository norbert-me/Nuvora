// Spiegel von apps/api/tests/test_klassenarbeit_wahl.py — dieselben Fälle, damit
// Seite und Server dieselbe Note ausrechnen.
import { describe, it, expect } from "vitest";
import { einheitenFuer, gewechselt, wertung } from "./arbeitswertung.js";

const G = [{ id: "t1", max: 4, topic_id: 3 }, { id: "t2", max: 6, topic_id: 5 }];
const E = [{ id: "t1", max: 4, topic_id: 3 }, { id: "t2", topic_id: 7, parts: [{ id: "e1", max: 4 }, { id: "e2", max: 4 }] }];

describe("Wahlaufgaben über das andere Blatt", () => {
  it("ohne Wechsel rechnet wie bisher", () => {
    const r = wertung({ tasks: G, _alt: E, results: { 1: { t1: 2, t2: 3 } } }, 1);
    expect(r.basis).toBe(10);
    expect(r.pct).toBe(50);
  });

  it("Punkte der anderen Fassung zählen nur mit Wechsel", () => {
    expect(wertung({ tasks: G, _alt: E, results: { 1: { t1: 4, t2: 6, "~e1": 4 } } }, 1).erreicht).toBe(10);
  });

  it("Punkte über der eigenen Höchstzahl sind Bonus, höchstens eine Notenstufe", () => {
    const r = wertung({ tasks: G, _alt: E, results: { 1: { t1: 2, "~e1": 4, "~e2": 4 } }, wechsel: { 1: ["t2"] } }, 1);
    expect(r.basePct).toBe(80);
    expect(r.bonusPct).toBe(7);
    expect(r.pct).toBe(87);
  });

  it("E-Kind mit der kleineren G-Fassung bekommt keinen Bonus", () => {
    const r = wertung({ tasks: E, _alt: G, results: { 1: { t1: 4, "~t2": 6 } }, wechsel: { 1: ["t2"] } }, 1);
    expect(r.erreicht).toBe(10);
    expect(r.bonusPct).toBe(0);
  });

  it("ohne Partnerblatt gilt die eigene Fassung", () => {
    expect(gewechselt({ tasks: G, wechsel: { 1: ["t2"] } }, 1, G[1])).toBe(false);
  });

  it("Themen kommen aus der geschriebenen Fassung", () => {
    const w = { tasks: G, _alt: E, wechsel: { 2: ["t2"] } };
    expect(einheitenFuer(w, 2, G[1]).map((u) => [u.id, u.topic])).toEqual([["~e1", 7], ["~e2", 7]]);
    expect(einheitenFuer(w, 1, G[1]).map((u) => [u.id, u.topic])).toEqual([["t2", 5]]);
  });
});
