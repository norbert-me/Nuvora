// Die reine Rechnung der Kartenerkennung: Ecken → Winkel → Antwort → Zuversicht.
//
// Sie steht doppelt (hier und in apps/api/app/routers/scan_image.py), weil der
// Server der Rueckfall bleibt, wenn opencv.js im Browser nicht startet. Dieser
// Test haelt die JS-Seite fest; der Abgleich GEGEN die Python-Seite laeuft in
// apps/api/tests/test_aruco_parity.py mit denselben Faellen.
//
// Lauf:  cd apps/web && npx vitest run src/cardvote/aruco.test.js
import { describe, it, expect } from "vitest";
import { winkelAusEcken, antwortAusWinkel, zuversicht } from "./aruco.js";

// So steht es auf der gedruckten Karte (cards.py:41-46), im Uhrzeigersinn ab
// oben. Die Erwartung wird daraus hergeleitet, nicht aus der Fassung im Code
// abgeschrieben: wer die Karte um θ im Uhrzeigersinn dreht, bringt den
// Buchstaben nach oben, der vorher bei -θ stand.
const BESCHRIFTUNG = { 0: "A", 90: "B", 180: "C", 270: "D" };
const erwartet = (drehung) => BESCHRIFTUNG[((-drehung % 360) + 360) % 360];

/** Vier Ecken eines um θ (im Uhrzeigersinn, Bildkoordinaten) gedrehten Markers. */
function ecken(drehungGrad, groesse = 100, mx = 500, my = 300) {
  // Y zeigt nach unten, deshalb dreht ein positiver Winkel im Uhrzeigersinn,
  // wenn man ihn als Bogenmass regulaer anwendet.
  const r = (drehungGrad * Math.PI) / 180;
  const h = groesse / 2;
  // TL, TR, BR, BL in der kanonischen Lage des Markers.
  return [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, y]) => [
    mx + x * Math.cos(r) - y * Math.sin(r),
    my + x * Math.sin(r) + y * Math.cos(r),
  ]);
}

describe("winkelAusEcken", () => {
  it("liest die Drehlage aus den vier Ecken zurueck", () => {
    for (const grad of [0, 15, 44, 45, 90, 135, 180, 225, 270, 315, 359]) {
      const gemessen = winkelAusEcken(ecken(grad));
      const soll = grad > 180 ? grad - 360 : grad;
      expect(gemessen).toBeCloseTo(soll, 6);
    }
  });

  it("ist unabhaengig von Groesse und Lage im Bild", () => {
    expect(winkelAusEcken(ecken(30, 20, 5, 5))).toBeCloseTo(30, 6);
    expect(winkelAusEcken(ecken(30, 900, 1200, 700))).toBeCloseTo(30, 6);
  });
});

describe("antwortAusWinkel", () => {
  it("gibt bei den vier Kartenlagen den aufgedruckten Buchstaben", () => {
    for (const grad of [0, 90, 180, 270]) {
      expect(antwortAusWinkel(winkelAusEcken(ecken(grad)))).toBe(erwartet(grad));
    }
  });

  it("kippt genau an 45/135/225/315 — das ist die Kante", () => {
    // Vier Antworten auf 360 Grad heissen vier Grenzen; sie laesst sich nicht
    // wegkonstruieren, nur sichtbar machen (siehe zuversicht).
    expect(antwortAusWinkel(44.999)).toBe("A");
    expect(antwortAusWinkel(45)).toBe("D");
    expect(antwortAusWinkel(134.999)).toBe("D");
    expect(antwortAusWinkel(135)).toBe("C");
    expect(antwortAusWinkel(224.999)).toBe("C");
    expect(antwortAusWinkel(225)).toBe("B");
    expect(antwortAusWinkel(314.999)).toBe("B");
    expect(antwortAusWinkel(315)).toBe("A");
  });

  it("nimmt negative und ueberdrehte Winkel wie der Server", () => {
    // atan2 liefert -180..180, und niemand normiert vorher.
    expect(antwortAusWinkel(-45)).toBe("A");   // = 315, und 315 gehoert schon zu A
    expect(antwortAusWinkel(-46)).toBe("B");   // = 314
    expect(antwortAusWinkel(-90)).toBe("B");   // = 270
    expect(antwortAusWinkel(-135)).toBe("B");  // = 225, die Kante gehoert zu B
    expect(antwortAusWinkel(720)).toBe("A");
    expect(antwortAusWinkel(-360)).toBe("A");
  });
});

describe("zuversicht", () => {
  it("faellt mit der Schieflage: gerade 1.0, an der Kante 0.0", () => {
    expect(zuversicht(0)).toBe(1);
    expect(zuversicht(90)).toBe(1);
    expect(zuversicht(180)).toBe(1);
    expect(zuversicht(270)).toBe(1);
    expect(zuversicht(360)).toBe(1);
    for (const kante of [45, 135, 225, 315, -45]) expect(zuversicht(kante)).toBe(0);
  });

  it("meldet den Grenzfall, den die Lehrkraft sehen soll", () => {
    expect(zuversicht(1)).toBeGreaterThan(0.9);
    expect(zuversicht(44)).toBeLessThan(0.1);
    expect(zuversicht(44)).toBeLessThan(zuversicht(1));
  });

  it("rundet auf drei Stellen wie Python", () => {
    // Sonst weicht dieselbe Karte in der letzten Stelle ab, je nachdem, ob der
    // Browser oder der Server sie gerechnet hat.
    expect(zuversicht(10)).toBe(0.778);
    expect(zuversicht(30)).toBe(0.333);
    expect(zuversicht(100)).toBe(0.778);
  });

  it("wird nie negativ", () => {
    for (let g = -720; g <= 720; g += 7) expect(zuversicht(g)).toBeGreaterThanOrEqual(0);
  });
});
