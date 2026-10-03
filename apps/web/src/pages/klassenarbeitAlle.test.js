// „Alle" legt die Auswertungen von E- und G-Blatt zu einer zusammen — mit
// derselben Rechnung wie ein einzelnes Blatt (rechneAnalyse).
import { describe, it, expect } from "vitest";
import { rechneAnalyse, vereineAnalysen } from "./Klassenarbeit.jsx";
import { DEFAULT_SCALE } from "../core/grades.js";

const label = (id) => `Thema ${id}`;
const E = { id: 1, niveau: "E", tasks: [{ id: "t1", max: 10, topic_id: 7 }], results: { 1: { t1: 9 }, 2: { t1: 4 } } };
const G = { id: 2, niveau: "G", tasks: [{ id: "t1", max: 10, topic_id: 7 }], results: { 3: { t1: 6 } } };
const kinder = { E: [{ id: 1, name: "Anna" }, { id: 2, name: "Ben" }], G: [{ id: 3, name: "Cem" }] };
const blatt = (b, anderes) => rechneAnalyse({
  work: b, wk: { ...b, _alt: anderes.tasks }, students: kinder[b.niveau], effScale: DEFAULT_SCALE,
  topicLabel: label, eigeneStufe: b.niveau, andereStufe: b.niveau === "E" ? "G" : "E",
});

describe("Klassenarbeit: Auswertung Alle", () => {
  const a = vereineAnalysen([["E", blatt(E, G)], ["G", blatt(G, E)]], label);

  it("zaehlt alle Kinder beider Blaetter", () => {
    expect(a.gradedCount).toBe(3);
    expect(a.noten.n).toBe(3);
    expect(a.noten.total).toBe(3);
  });

  it("rechnet Themen ueber die Punkte, nicht ueber gemittelte Prozente", () => {
    // 9 + 4 + 6 von 30 = 63 %
    expect(a.topics).toEqual([expect.objectContaining({ topic_id: 7, e: 19, m: 30, pct: 63 })]);
  });

  it("fuehrt die Aufgaben je Blatt getrennt", () => {
    expect(a.perTask.map((x) => x.label)).toEqual(["E · 1.", "G · 1."]);
  });

  it("Prozentschnitt aus allen Kindern", () => {
    expect(a.noten.avgPct).toBe(63);   // (90 + 40 + 60) / 3
  });
});

import { themenGewichte } from "./Klassenarbeit.jsx";

describe("Klassenarbeit: Gewichtung der Themen", () => {
  it("Punkte je Thema aus den Teilaufgaben, ohne Darstellung", () => {
    const gw = themenGewichte([
      { id: "a", topic_id: 1, parts: [{ id: "a1", max: 4 }, { id: "a2", max: 4, topic_id: 2 }] },
      { id: "b", max: 2, topic_id: 3 },
      { id: "d", max: 5, form: true },
    ]);
    expect(gw.map((x) => [x.topic, x.punkte, Math.round(x.anteil)])).toEqual([[1, 4, 40], [2, 4, 40], [3, 2, 20]]);
  });

  it("markiert deutliche Abweichung vom gleichen Anteil", () => {
    // drei Themen, gleich wären 33 %: 2 von 20 = 10 % ist zu wenig, 12 von 20 = 60 % zu viel
    const gw = themenGewichte([{ id: "a", max: 12, topic_id: 1 }, { id: "b", max: 6, topic_id: 2 }, { id: "c", max: 2, topic_id: 3 }]);
    expect(Object.fromEntries(gw.map((x) => [x.topic, x.abweichung]))).toEqual({ 1: "viel", 2: null, 3: "wenig" });
  });
});

import { aufgabenUeberAlle } from "./Klassenarbeit.jsx";

describe("Klassenarbeit: Aufgaben ueber beide Kurse", () => {
  // E-Blatt: 1. (10 P), 2. (4 P). G-Blatt: 1. (6 P), Darstellung, 2. (2 P).
  // Cem (G) schreibt bei 1. die E-Fassung — seine Punkte liegen im G-Blatt unter "~e1".
  const E = { id: 1, niveau: "E", tasks: [{ id: "e1", max: 10 }, { id: "e2", max: 4 }],
    results: { 1: { e1: 8, e2: 4 }, 2: { e1: 2, e2: 0 } } };
  const G = { id: 2, niveau: "G", tasks: [{ id: "g1", max: 6 }, { id: "d", max: 2, form: true }, { id: "g2", max: 2 }],
    wechsel: { 3: ["g1"] }, results: { 3: { "~e1": 5, d: 2, g2: 2 }, 4: { g1: 6, d: 1, g2: 1 } } };
  const kinder = [{ id: 1, name: "A", niveau: "E" }, { id: 2, name: "B", niveau: "E" }, { id: 3, name: "C", niveau: "G" }, { id: 4, name: "D", niveau: "G" }];
  const { perTask } = aufgabenUeberAlle([E, G], kinder);
  const z = Object.fromEntries(perTask.map((x) => [x.id, x]));

  it("die E-Aufgabe zaehlt den G-Wechsler mit", () => {
    expect(z["E · e1"].n).toBe(3);
    expect(z["E · e1"].pct).toBe(50);   // (8 + 2 + 5) / 30
  });

  it("die G-Aufgabe nur, wer sie schrieb", () => {
    expect(z["G · g1"].n).toBe(1);
    expect(z["G · g1"].pct).toBe(100);
  });

  it("Darstellung fehlt, Reihenfolge nach Position", () => {
    expect(perTask.map((x) => x.id)).toEqual(["E · e1", "G · g1", "E · e2", "G · g2"]);
  });
});

import { aufgabenDerArbeit } from "./Klassenarbeit.jsx";

describe("Klassenarbeit: Auswertung je Blatt", () => {
  it("E zeigt nur die Aufgaben des E-Blatts, alle zeigt beide", () => {
    const a = { perTask: [{ id: "E · 1" }, { id: "G · 1" }], perUnit: [{ id: "x", taskId: "G · 1" }] };
    expect(aufgabenDerArbeit(a, "E").perTask.map((x) => x.id)).toEqual(["E · 1"]);
    expect(aufgabenDerArbeit(a, "G").perUnit).toHaveLength(1);
    expect(aufgabenDerArbeit(a, "alle")).toBe(a);
  });
});

describe("Klassenarbeit: Anteil an der Note", () => {
  it("mit Darstellung bezieht sich der Anteil auf alle Punkte", () => {
    const gw = themenGewichte([{ id: "a", max: 6, topic_id: 1 }, { id: "b", max: 2, topic_id: 2 }, { id: "d", max: 2, form: true }], { mitDarstellung: true });
    expect(gw.map((x) => [x.topic, Math.round(x.anteil)])).toEqual([[1, 60], [2, 20], ["form", 20]]);
  });
});

import { gewichtGruppen } from "./Klassenarbeit.jsx";

describe("Klassenarbeit: Gewichtung nach Ober- und Unterthema", () => {
  it("Oberthema mit Summe, Unterthemen eingerueckt", () => {
    const byId = new Map([[1, { id: 1 }], [11, { id: 11, parent_id: 1 }], [12, { id: 12, parent_id: 1 }], [2, { id: 2 }]]);
    const gw = themenGewichte([{ id: "a", max: 4, topic_id: 11 }, { id: "b", max: 2, topic_id: 12 }, { id: "c", max: 4, topic_id: 2 }]);
    const z = gewichtGruppen(gw, byId);
    expect(z.map((x) => [x.topic, x.ebene, x.punkte])).toEqual([[1, 0, 6], [11, 1, 4], [12, 1, 2], [2, 0, 4]]);
    expect(Math.round(z[0].anteil)).toBe(60);
  });
});
