// Regressionstest der E/G-Wertung auf der JS-Seite (core/scoring.js).
//
// Die Regeln stehen doppelt (CLAUDE.md): app/scoring.py rechnet PDF, Excel und
// die Notenbuch-Bruecke, diese Datei rechnet die Auswertungsseite live beim
// Tippen. apps/api/tests/test_scoring_parity.py vergleicht beide Fassungen
// miteinander — er faellt aber nur auf, wenn sie AUSEINANDERlaufen. Wer beide
// gleich falsch aendert, kommt dort durch. Dieser Test haelt die JS-Seite an
// den Regeln selbst fest, gespiegelt zu apps/api/tests/test_scoring.py.
import { describe, it, expect } from "vitest";
import { bewerte, statusOf, naechsteStufe } from "./scoring.js";
import { DEFAULT_SCALE } from "./grades.js";

// 4 Fragen der Anforderung (G) + 3 Zusatzfragen (E), richtig ist immer "A".
const QUESTIONS = [
  ...[1, 2, 3, 4].map((id) => ({ id, correct_answer: "A", niveau: "" })),
  ...[5, 6, 7].map((id) => ({ id, correct_answer: "A", niveau: "E" })),
];
// 3 von 4 G richtig, 2 von 3 E richtig.
const ANTWORTEN = { 1: "A", 2: "A", 3: "A", 4: "B", 5: "A", 6: "A", 7: "B" };

describe("E/G-Differenzierung", () => {
  it("zaehlt im G-Kurs nur die G-Fragen als 100 %", () => {
    const w = bewerte(QUESTIONS, ANTWORTEN, { niveau: "G", niveauAktiv: true });
    expect(w.maxScore).toBe(4);      // die E-Fragen sind nicht Teil der 100 %
    expect(w.basePct).toBe(75);
    expect(w.eTotal).toBe(3);
  });

  it("zaehlt im E-Kurs alle Fragen regulaer, ohne Bonus", () => {
    const w = bewerte(QUESTIONS, ANTWORTEN, { niveau: "E", niveauAktiv: true });
    expect(w.maxScore).toBe(7);
    expect(w.bonusPct).toBe(0);
    expect(w.eTotal).toBe(0);        // nichts ist Zusatz, alles ist Anforderung
  });

  it("zaehlt ohne Quiz-Flag alle Fragen regulaer", () => {
    const w = bewerte(QUESTIONS, ANTWORTEN, { niveau: "G", niveauAktiv: false });
    expect(w.maxScore).toBe(7);
    expect(w.bonusPct).toBe(0);
  });

  it("gibt Bonus erst ab zwei richtigen E-Antworten", () => {
    const nurEine = { ...ANTWORTEN, 6: "B" };
    expect(bewerte(QUESTIONS, nurEine, { niveau: "G", niveauAktiv: true }).bonusPct).toBe(0);
    expect(bewerte(QUESTIONS, ANTWORTEN, { niveau: "G", niveauAktiv: true }).bonusPct).toBeGreaterThan(0);
  });

  it("hebt hoechstens um eine Notenstufe", () => {
    const alleE = { 1: "A", 2: "A", 3: "A", 4: "B", 5: "A", 6: "A", 7: "A" };
    const w = bewerte(QUESTIONS, alleE, { niveau: "G", niveauAktiv: true });
    // 75 % liegt in der Stufe ab 73; voller Bonus hebt genau auf 87 (naechste Stufe).
    expect(w.pct).toBe(87);
    expect(w.bonusPct).toBe(12);
  });

  it("laesst falsche E-Antworten nur den Bonus aufzehren, nie die Basis", () => {
    const w = bewerte(QUESTIONS, ANTWORTEN, { niveau: "G", niveauAktiv: true });
    expect(w.basePct).toBe(75);      // Basis bleibt unangetastet
    expect(w.eWrong).toBe(1);
    // netto 2-1 = 1 von 3 E-Fragen · 12 Prozentpunkte bis zur naechsten Stufe
    expect(w.bonusPct).toBe(4);
    expect(w.bonusPct).toBeLessThan(12);
  });

  it("zehrt den Bonus nie unter null", () => {
    // 2 richtige, 1 falsche zaehlt schon oben; hier mehr falsch als richtig:
    const q = [
      { id: 1, correct_answer: "A", niveau: "" },
      ...[2, 3, 4, 5].map((id) => ({ id, correct_answer: "A", niveau: "E" })),
    ];
    const w = bewerte(q, { 1: "A", 2: "A", 3: "A", 4: "B", 5: "B" }, { niveau: "G", niveauAktiv: true });
    expect(w.basePct).toBe(100);
    expect(w.bonusPct).toBe(0);      // netto 0, kein Abzug von der Basis
    expect(w.pct).toBe(100);
  });

  it("haelt pct bei 100 gedeckelt", () => {
    for (const p of [bewerte(QUESTIONS, { 1: "A", 2: "A", 3: "A", 4: "A", 5: "A", 6: "A", 7: "A" },
      { niveau: "G", niveauAktiv: true })]) {
      expect(p.basePct).toBe(100);
      expect(p.pct).toBe(100);
      expect(p.pct).toBeLessThanOrEqual(100);
    }
  });

  it("hat im G-Kurs ohne einzige G-Frage keine Basis", () => {
    // Fehlkonfiguriertes Quiz: E/G aktiv, aber jede Frage ist Zusatz. Die Basis
    // ist dann leer (0 von 0 Punkten), der Bonus rechnet trotzdem — er hebt von
    // 0 % bis zur naechsten Stufe. Beide Fassungen tun das gleich (der
    // Paritaetstest fuehrt den Fall), gewollt ist es nicht: siehe Bericht.
    const nurE = [1, 2, 3].map((id) => ({ id, correct_answer: "A", niveau: "E" }));
    const w = bewerte(nurE, { 1: "A", 2: "A", 3: "A" }, { niveau: "G", niveauAktiv: true });
    expect(w.maxScore).toBe(0);
    expect(w.basePct).toBe(0);
    expect(w.pct).toBe(20);          // 3/3 · naechsteStufe(0) = 20 Prozentpunkte
  });
});

describe("Minuspunkte", () => {
  it("kosten das Gewicht der falschen Antwort, aber nie unter null", () => {
    const allesFalsch = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((i) => [i, "B"]));
    const w = bewerte(QUESTIONS, allesFalsch, { niveau: "G", niveauAktiv: true, minuspunkte: true });
    expect(w.score).toBe(0);
    expect(w.pct).toBe(0);
  });

  it("ziehen genau ein Gewicht je falscher Antwort ab", () => {
    const w = bewerte(QUESTIONS, ANTWORTEN, { niveau: "G", niveauAktiv: true, minuspunkte: true });
    expect(w.score).toBe(2);         // 3 richtig minus 1 falsch
    expect(w.basePct).toBe(50);
  });

  it("bestrafen die unbeantwortete Frage nicht", () => {
    const ohne4 = { 1: "A", 2: "A", 3: "A" };
    const mit = bewerte(QUESTIONS, ohne4, { niveau: "G", niveauAktiv: true, minuspunkte: true });
    const ohne = bewerte(QUESTIONS, ohne4, { niveau: "G", niveauAktiv: true, minuspunkte: false });
    expect(mit.score).toBe(3);
    expect(mit.score).toBe(ohne.score);
  });

  it("laesst die Karte unten = keine Antwort = 0 Punkte, kein Abzug", () => {
    const w = bewerte(QUESTIONS, {}, { niveau: "G", niveauAktiv: true, minuspunkte: true });
    expect(w.score).toBe(0);
    expect(w.pct).toBe(0);
  });
});

describe("Gewichte", () => {
  it("nehmen 1, wenn das Gewicht fehlt oder null ist", () => {
    const q = [1, 2].map((id) => ({ id, correct_answer: "A", niveau: "" }));
    expect(bewerte(q, { 1: "A", 2: "A" }, { weights: {} }).maxScore).toBe(2);
    expect(bewerte(q, { 1: "A", 2: "A" }, { weights: { 1: null } }).maxScore).toBe(2);
  });

  it("werten unlesbares Gewicht als 0, statt die Wertung abzubrechen", () => {
    const q = [1, 2].map((id) => ({ id, correct_answer: "A", niveau: "" }));
    const w = bewerte(q, { 1: "A", 2: "A" }, { weights: { 1: "zwei" } });
    expect(w.maxScore).toBe(1);
    expect(w.basePct).toBe(100);
  });

  it("lassen eine Frage mit Gewicht 0 aus der Wertung", () => {
    const q = [1, 2].map((id) => ({ id, correct_answer: "A", niveau: "" }));
    const w = bewerte(q, { 1: "A", 2: "B" }, { weights: { 1: 2, 2: 0 } });
    expect(w.maxScore).toBe(2);
    expect(w.basePct).toBe(100);
  });

  it("finden das Gewicht auch unter dem Schluessel als Zeichenkette", () => {
    const q = [{ id: 1, correct_answer: "A", niveau: "" }];
    expect(bewerte(q, { 1: "A" }, { weights: { "1": 3 } }).score).toBe(3);
  });

  it("ergeben 0 %, wenn alle Gewichte 0 sind", () => {
    const q = [1, 2].map((id) => ({ id, correct_answer: "A", niveau: "" }));
    const w = bewerte(q, { 1: "A", 2: "A" }, { weights: { 1: 0, 2: 0 } });
    expect(w.maxScore).toBe(0);
    expect(w.basePct).toBe(0);
  });
});

describe("Rundung", () => {
  it("rundet Prozent kaufmaennisch auf eine Stelle (66,25 -> 66,3)", () => {
    // Die halbe Stelle geht nach oben — die Python-Seite bildet das mit
    // kaufmaennisch() nach, weil Pythons round() zur geraden Zahl rundet.
    const q = [1, 2].map((id) => ({ id, correct_answer: "A", niveau: "" }));
    const w = bewerte(q, { 1: "A", 2: "B" }, { weights: { 1: 5.3, 2: 2.7 } });
    expect(w.basePct).toBe(66.3);    // 5,3 von 8 = 66,25 %
  });

  it("rundet Punkte auf zwei Stellen (0,125 -> 0,13)", () => {
    const q = [1, 2].map((id) => ({ id, correct_answer: "A", niveau: "" }));
    const w = bewerte(q, { 1: "A" }, { weights: { 1: 0.125, 2: 1 } });
    expect(w.score).toBe(0.13);
    expect(w.maxScore).toBe(1.13);
  });
});

describe("Sonderfaelle", () => {
  it("uebergeht Fragen ohne hinterlegte Loesung", () => {
    const q = [
      { id: 1, correct_answer: "", niveau: "" },
      { id: 2, correct_answer: "A", niveau: "" },
    ];
    const w = bewerte(q, { 1: "A", 2: "A" });
    expect(w.maxScore).toBe(1);
    expect(w.score).toBe(1);
  });

  it("wertet eine Mehrfachloesung ('AB') fuer jede der Antworten als richtig", () => {
    const q = [{ id: 1, correct_answer: "AB", niveau: "" }];
    expect(bewerte(q, { 1: "A" }).score).toBe(1);
    expect(bewerte(q, { 1: "B" }).score).toBe(1);
    expect(bewerte(q, { 1: "C" }).score).toBe(0);
  });

  it("kommt ohne jede Frage zurecht", () => {
    const w = bewerte([], {});
    expect(w.maxScore).toBe(0);
    expect(w.pct).toBe(0);
  });

  it("findet die Antwort auch unter dem Schluessel als Zeichenkette", () => {
    const q = [{ id: 1, correct_answer: "A", niveau: "" }];
    expect(bewerte(q, { "1": "A" }).score).toBe(1);
  });
});

describe("naechsteStufe — der Deckel des Bonus", () => {
  it("misst bis zur naechstbesseren Grenze der Standardskala", () => {
    expect(naechsteStufe(75, DEFAULT_SCALE)).toBe(12);   // 87 - 75
    expect(naechsteStufe(0, DEFAULT_SCALE)).toBe(20);
    expect(naechsteStufe(59, DEFAULT_SCALE)).toBe(14);   // 73 - 59
  });

  it("misst in der besten Stufe bis 100 %", () => {
    expect(naechsteStufe(87, DEFAULT_SCALE)).toBe(13);
    expect(naechsteStufe(100, DEFAULT_SCALE)).toBe(0);
  });

  it("folgt dem eigenen Schluessel der Lehrkraft", () => {
    const eigen = { 1: 90, 2: 80, 3: 65, 4: 50, 5: 25, 6: 0 };
    expect(naechsteStufe(75, eigen)).toBe(5);            // 80 - 75
    expect(naechsteStufe(75)).toBe(12);                  // ohne Skala: DEFAULT_SCALE
  });

  it("deckelt den Bonus nach dem Schluessel der Lehrkraft", () => {
    const eigen = { 1: 90, 2: 80, 3: 65, 4: 50, 5: 25, 6: 0 };
    const alleE = { 1: "A", 2: "A", 3: "A", 4: "B", 5: "A", 6: "A", 7: "A" };
    const w = bewerte(QUESTIONS, alleE, { niveau: "G", niveauAktiv: true, scale: eigen });
    expect(w.basePct).toBe(75);
    expect(w.pct).toBe(80);          // strengere Skala, kleinerer Sprung
  });
});

describe("statusOf — wer nichts abgibt, gilt als krank", () => {
  it("folgt der Abgabe und der ausdruecklichen Angabe der Lehrkraft", () => {
    expect(statusOf(3, false, {})).toBe("krank");
    expect(statusOf(3, false, { anwesend: [3] })).toBe("anwesend");
    expect(statusOf(3, true, {})).toBe("anwesend");
    expect(statusOf(3, true, { krank: [3] })).toBe("krank");
  });

  it("nimmt anwesend vor krank, wenn beides eingetragen ist", () => {
    expect(statusOf(3, false, { krank: [3], anwesend: [3] })).toBe("anwesend");
  });

  it("vergleicht Zahl und Zeichenkette gleich", () => {
    expect(statusOf(3, true, { krank: ["3"] })).toBe("krank");
    expect(statusOf("3", true, { krank: [3] })).toBe("krank");
  });

  it("kommt ohne Konfiguration zurecht", () => {
    expect(statusOf(3, true, null)).toBe("anwesend");
    expect(statusOf(3, false, null)).toBe("krank");
  });
});
