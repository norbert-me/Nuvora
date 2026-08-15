// Sicherheitsnetz für die zusammengeführten Datums-Helfer.
//
// Der teuerste Fehler hier ist unsichtbar: `toISOString().slice(0, 10)` sieht
// aus wie ein Kalenderdatum und ist in +02:00 ab 22 Uhr schon der Folgetag.
// Deshalb prüft der erste Test genau diesen Abend.
import { describe, expect, it } from "vitest";

import { addDays, heuteYmd, hmToMin, isoDay, isoWeek, mmss, mondayOf, startOfDay, wochentagMo0, ymd } from "./datum.js";

describe("ymd", () => {
  it("nullt Monat und Tag auf zwei Stellen", () => {
    expect(ymd(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(ymd(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("bleibt lokal — spätabends NICHT schon der Folgetag", () => {
    // Genau der Fall, an dem toISOString().slice(0,10) kippt.
    const spaet = new Date(2026, 7, 14, 23, 30, 0);
    expect(ymd(spaet)).toBe("2026-08-14");
  });

  it("heuteYmd ist ymd von jetzt", () => {
    expect(heuteYmd()).toBe(ymd(new Date()));
  });
});

describe("Tagesrechnung", () => {
  it("addDays geht über Monats- und Jahresgrenzen", () => {
    expect(ymd(addDays(new Date(2026, 0, 31), 1))).toBe("2026-02-01");
    expect(ymd(addDays(new Date(2026, 0, 1), -1))).toBe("2025-12-31");
  });

  it("addDays lässt das Original in Ruhe", () => {
    const d = new Date(2026, 4, 10);
    addDays(d, 5);
    expect(ymd(d)).toBe("2026-05-10");
  });

  it("startOfDay setzt auf 0:00", () => {
    const x = startOfDay(new Date(2026, 4, 10, 17, 45, 12));
    expect(x.getHours()).toBe(0);
    expect(x.getMinutes()).toBe(0);
    expect(ymd(x)).toBe("2026-05-10");
  });
});

describe("Woche", () => {
  it("wochentagMo0: Montag = 0, Sonntag = 6", () => {
    expect(wochentagMo0(new Date(2026, 7, 10))).toBe(0); // Montag
    expect(wochentagMo0(new Date(2026, 7, 16))).toBe(6); // Sonntag
  });

  it("mondayOf: der Sonntag gehört noch zur Woche davor", () => {
    expect(ymd(mondayOf(new Date(2026, 7, 16)))).toBe("2026-08-10");
    expect(ymd(mondayOf(new Date(2026, 7, 10)))).toBe("2026-08-10");
  });

  it("isoWeek zählt über die Donnerstag-Regel", () => {
    // 1.1.2026 ist ein Donnerstag → KW 1.
    expect(isoWeek(new Date(2026, 0, 1))).toEqual({ year: 2026, week: 1 });
    // Der 31.12.2025 (Mittwoch) liegt in derselben ISO-Woche.
    expect(isoWeek(new Date(2025, 11, 31))).toEqual({ year: 2026, week: 1 });
  });
});

describe("isoDay", () => {
  it("verankert auf 12:00 lokal, damit UTC den Tag nicht kippt", () => {
    const s = isoDay(new Date(2026, 8, 3, 0, 5, 0));
    // 12:00 lokal liegt in jeder gebräuchlichen Zone am selben UTC-Tag.
    expect(s.slice(0, 10)).toBe("2026-09-03");
  });
});

describe("Uhrzeit", () => {
  it("hmToMin rechnet und weist Unsinn ab", () => {
    expect(hmToMin("08:30")).toBe(510);
    expect(hmToMin("7:05")).toBe(425);
    expect(hmToMin("")).toBe(null);
    expect(hmToMin(null)).toBe(null);
    expect(hmToMin("830")).toBe(null);
  });

  it("mmss füllt die Sekunden auf", () => {
    expect(mmss(0)).toBe("0:00");
    expect(mmss(65)).toBe("1:05");
    expect(mmss(600)).toBe("10:00");
  });
});
