// Die Beschriftung „Fach · Kursname" steht doppelt: hier in JS (Oberflaeche)
// und als `_kurs_label` in apps/api/app/routers/kalender.py (ICS-Feed). Zwei
// Fassungen hiessen, dass derselbe Termin im Handykalender anders heisst als
// im Browser — dieser Test haelt die JS-Seite fest, der Kommentar an beiden
// Stellen die Kopplung.
import { describe, expect, it } from "vitest";

import { kursLabel } from "./kurslabel.js";

describe("kursLabel", () => {
  it("stellt das Fach voran", () => {
    expect(kursLabel({ fach: "Mathe", name: "7.5" })).toBe("Mathe · 7.5");
  });

  it("wiederholt ein Fach nicht, das schon im Namen steht", () => {
    // Viele Konten benennen ihre Kurse genau so — „Mathe · Mathe 7.5" waere
    // doppelt gemoppelt und im schmalen Kalenderfeld abgeschnitten.
    expect(kursLabel({ fach: "Mathe", name: "Mathe 7.5" })).toBe("Mathe 7.5");
    expect(kursLabel({ fach: "mathe", name: "Mathe 7b" })).toBe("Mathe 7b");
  });

  it("kommt mit fehlenden Angaben aus", () => {
    // Fach ist Freitext und bei vielen Kursen leer — dann bleibt der Name.
    expect(kursLabel({ name: "7.5" })).toBe("7.5");
    expect(kursLabel({ fach: "Mathe" })).toBe("Mathe");
    expect(kursLabel(null)).toBe("");
    expect(kursLabel({})).toBe("");
  });

  it("schneidet Leerzeichen weg", () => {
    expect(kursLabel({ fach: " Mathe ", name: " 7.5 " })).toBe("Mathe · 7.5");
  });
});
