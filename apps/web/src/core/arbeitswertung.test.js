// Spiegel von apps/api/tests/test_klassenarbeit_wahl.py — dieselben Fälle, damit
// Seite und Server dieselbe Note ausrechnen (core/arbeitswertung.js ↔
// app/arbeitswertung.py).
import { describe, it, expect } from "vitest";
import { fassung, einheitenFuer, wertung } from "./arbeitswertung.js";

const TASKS = [
  { id: "t1", max: 4, topic_id: 3 },
  { id: "t2", max: 6, topic_id: 5, e: { id: "t2e", topic_id: 7, parts: [{ id: "e1", max: 4 }, { id: "e2", max: 4 }] } },
];

describe("Wahlaufgaben E/G", () => {
  it("ohne E-Fassung rechnet wie bisher", () => {
    const r = wertung({ tasks: [{ id: "t1", max: 4 }, { id: "t2", max: 6 }], results: { 1: { t1: 2, t2: 3 } } }, 1);
    expect(r.basis).toBe(10);
    expect(r.pct).toBe(50);
    expect(r.bonusPct).toBe(0);
  });

  it("G-Kind wird an der G-Fassung gemessen", () => {
    const r = wertung({ tasks: TASKS, results: { 1: { t1: 4, t2: 6, e1: 4, e2: 4 } } }, 1);
    expect(r.erreicht).toBe(10);
    expect(r.pct).toBe(100);
  });

  it("E-Punkte über der G-Höchstzahl sind Bonus, höchstens eine Notenstufe", () => {
    const w = { tasks: TASKS, results: { 1: { t1: 2, e1: 4, e2: 4 } }, e_wahl: { 1: ["t2"] } };
    const r = wertung(w, 1);
    expect(r.basePct).toBe(80);
    expect(r.bonusPct).toBe(7);   // 80 % -> nächste Grenze 87 %
    expect(r.pct).toBe(87);
  });

  it("E-Fassung mit weniger Punkten gibt keinen Bonus", () => {
    const r = wertung({ tasks: [{ id: "t1", max: 6, e: { id: "t1e", max: 4 } }], results: { 1: { t1e: 4 } }, e_wahl: { 1: ["t1"] } }, 1);
    expect(r.erreicht).toBe(4);
    expect(r.bonusPct).toBe(0);
  });

  it("Wahl für eine Aufgabe ohne E-Fassung wirkt nicht", () => {
    expect(fassung({ tasks: TASKS, e_wahl: { 1: ["t1"] } }, 1, TASKS[0])).toBe("G");
  });

  it("Themen kommen aus der geschriebenen Fassung", () => {
    const w = { tasks: TASKS, e_wahl: { 2: ["t2"] } };
    expect(einheitenFuer(w, 2, TASKS[1]).map((u) => [u.id, u.topic])).toEqual([["e1", 7], ["e2", 7]]);
    expect(einheitenFuer(w, 1, TASKS[1]).map((u) => [u.id, u.topic])).toEqual([["t2", 5]]);
  });
});
