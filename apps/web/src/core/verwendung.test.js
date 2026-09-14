// „Unbekannt" ist nicht „unbenutzt".
//
// Die Dubletten-Hilfe des Lernpfads zählt über die geladenen Lernpfade, welche
// Aufgabe in einer Lernleiter steckt. Sind die Pfade noch NICHT geladen — sie
// werden erst beim Öffnen ihres Reiters geholt —, ist die Liste leer, und dann
// sieht jede Aufgabe aus wie eine, die niemand braucht. Genau daran hing das
// Aufräumen „ohne Zuordnung": es nahm alles mit, auch das Verwendete.
//
// Der Test hält die Rechnung selbst fest (dieselbe wie in public/lp/js/app.js —
// die Datei ist ein IIFE ohne Exporte und lässt sich nicht importieren). Wer
// sie dort ändert, muss hier vorbeikommen.
import { describe, it, expect } from "vitest";

/** Wie oft steckt jede Aufgabe in einer Lernleiter? (app.js: verwendungen) */
function verwendungen(lernpfade) {
  const zaehler = new Map();
  (lernpfade || []).forEach((p) => (p.lernleitern || []).forEach((ll) => (ll.schueler || []).forEach((sch) => {
    (sch.aufgabenIds || []).forEach((id) => {
      const k = String(id);
      zaehler.set(k, (zaehler.get(k) || 0) + 1);
    });
  })));
  return zaehler;
}

const benutzt = (lernpfade, id) => (verwendungen(lernpfade).get(String(id)) || 0) > 0;

describe("Verwendung von Aufgaben", () => {
  const pfade = [{ lernleitern: [{ schueler: [{ aufgabenIds: [1, 3] }, { aufgabenIds: [3] }] }] }];

  it("zählt jede Zuweisung einzeln", () => {
    expect(verwendungen(pfade).get("3")).toBe(2);
    expect(verwendungen(pfade).get("1")).toBe(1);
    expect(verwendungen(pfade).get("2")).toBeUndefined();
  });

  // Eine leere Pfadliste sieht aus wie „nichts wird verwendet". Sie bedeutet
  // aber auch „noch nicht geladen" — deshalb prüft app.js vor jedem Löschen mit
  // `verwendungBekannt()`, ob wirklich nachgesehen werden konnte.
  it("haelt eine leere Pfadliste fuer nichts-verwendet", () => {
    expect(benutzt([], 1)).toBe(false);
    expect(benutzt(pfade, 1)).toBe(true);
  });
});
