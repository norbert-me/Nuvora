// Eine fehlgeschlagene Modulabfrage ist nicht dasselbe wie "kein Modul aktiv".
//
// Der Unterschied ist nicht akademisch: das ModuleGate leitet auf /modules um,
// wenn ein Modul nicht aktiv ist. Solange eine fehlgeschlagene Anfrage wie
// "nichts aktiv" aussah, flog die Lehrkraft bei einem kurzen 429 (Rate-Limit
// des Proxys) oder einer Sekunde ohne Netz aus ihrer Modulseite — als haette
// sie das Modul nie eingeschaltet. Gefunden hat das der Oberflaechen-
// Systemtest, dem genau das reihenweise passierte.
//
// Eigene Datei, weil der Cache in modules.js modul-global ist: jeder Fall
// braucht einen frischen Import.
import { describe, it, expect, vi, beforeEach } from "vitest";

const MODULE = [{ key: "cardvote", active: true }];

async function frischesModul() {
  vi.resetModules();
  // Kein localStorage in der node-Umgebung: die Saat bleibt leer, es gibt also
  // wirklich keinen Cache — genau der Fall des ersten Besuchs.
  return import("./modules.js");
}

beforeEach(() => vi.restoreAllMocks());

describe("Modulstand", () => {
  it("gilt nach einer erfolgreichen Abfrage als bekannt", async () => {
    const m = await frischesModul();
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => MODULE }));
    await m.fetchModules({ frisch: true });
    expect(m.modulstandBekannt()).toBe(true);
  });

  it("gilt ohne Cache als UNBEKANNT, wenn der Server nicht antwortet", async () => {
    const m = await frischesModul();
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 429 }));
    const mods = await m.fetchModules({ frisch: true });
    expect(mods).toEqual([]);
    expect(m.modulstandBekannt(), "leere Liste darf nicht als Wissen gelten").toBe(false);
  });

  it("versucht es ein zweites Mal — ein 429 ist eine Sekunde spaeter vorbei", async () => {
    const m = await frischesModul();
    let n = 0;
    globalThis.fetch = vi.fn(async () => {
      n += 1;
      return n === 1 ? { ok: false, status: 429 } : { ok: true, json: async () => MODULE };
    });
    const mods = await m.fetchModules({ frisch: true });
    expect(n).toBe(2);
    expect(mods).toEqual(MODULE);
    expect(m.modulstandBekannt()).toBe(true);
  });

  it("behaelt den bekannten Stand, wenn eine spaetere Abfrage scheitert", async () => {
    const m = await frischesModul();
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => MODULE }));
    await m.fetchModules({ frisch: true });

    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503 }));
    const mods = await m.fetchModules({ frisch: true });
    expect(mods, "der letzte bekannte Stand ist besser als eine leere Liste").toEqual(MODULE);
    expect(m.modulstandBekannt()).toBe(true);
  });
});
