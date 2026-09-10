// „Was ist neu?" zeigt die Punkte aus CHANGELOG.md — und die fangen fast alle
// mit einer fetten Aussage an („**CardVote erkennt die Karten im Geraet.** Der
// Scanner …"). Ohne Zerlegung stand im Dialog der Rohtext mit Sternchen.
import { describe, it, expect } from "vitest";
import { teileFett } from "./WasIstNeu.jsx";

describe("teileFett", () => {
  it("trennt die fette Aussage vom Rest", () => {
    expect(teileFett("**CardVote erkennt die Karten im Gerät.** Der Scanner schickte bisher jedes Bild.")).toEqual([
      { fett: true, text: "CardVote erkennt die Karten im Gerät." },
      { fett: false, text: " Der Scanner schickte bisher jedes Bild." },
    ]);
  });

  it("nimmt mehrere fette Stellen mitten im Satz", () => {
    expect(teileFett("vorne **eins** mitte **zwei** hinten")).toEqual([
      { fett: false, text: "vorne " },
      { fett: true, text: "eins" },
      { fett: false, text: " mitte " },
      { fett: true, text: "zwei" },
      { fett: false, text: " hinten" },
    ]);
  });

  it("laesst Text ohne Sternchen unangetastet", () => {
    expect(teileFett("nur Text")).toEqual([{ fett: false, text: "nur Text" }]);
    expect(teileFett("")).toEqual([]);
  });

  it("faellt bei einem einzelnen Sternchenpaar nicht auseinander", () => {
    // Ein unpaariges ** ist im Changelog ein Tippfehler, kein Grund fuer eine
    // kaputte Zeile: dann bleibt der Text stehen, wie er ist.
    expect(teileFett("halb **offen")).toEqual([{ fett: false, text: "halb **offen" }]);
  });
});
