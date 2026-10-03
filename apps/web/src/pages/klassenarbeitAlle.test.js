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
