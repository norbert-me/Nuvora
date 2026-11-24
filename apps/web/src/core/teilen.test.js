import { describe, it, expect } from "vitest";
import { teilen } from "./teilen.js";

describe("teilen", () => {
  const id = (x) => x.id;
  it("gleicher Inhalt: dieselbe Liste und dieselben Objekte", () => {
    const alt = [{ id: 1, a: [1, 2] }, { id: 2, a: [] }];
    const neu = JSON.parse(JSON.stringify(alt));
    expect(teilen(alt, neu, id)).toBe(alt);
  });
  it("ein Objekt geaendert: nur dieses ist neu, die anderen bleiben dieselben", () => {
    const alt = [{ id: 1, v: 1 }, { id: 2, v: 2 }, { id: 3, v: 3 }];
    const neu = [{ id: 1, v: 1 }, { id: 2, v: 99 }, { id: 3, v: 3 }];
    const r = teilen(alt, neu, id);
    expect(r).not.toBe(alt);
    expect(r[0]).toBe(alt[0]);
    expect(r[1]).toBe(neu[1]);
    expect(r[2]).toBe(alt[2]);
  });
  it("neue und weggefallene Eintraege werden uebernommen", () => {
    const alt = [{ id: 1 }, { id: 2 }];
    expect(teilen(alt, [{ id: 2 }, { id: 3 }], id).map((x) => x.id)).toEqual([2, 3]);
    expect(teilen(alt, [{ id: 1 }], id)).toHaveLength(1);
  });
  it("geaenderte Reihenfolge gilt als Aenderung der Liste, die Objekte bleiben", () => {
    const alt = [{ id: 1 }, { id: 2 }];
    const r = teilen(alt, [{ id: 2 }, { id: 1 }], id);
    expect(r).not.toBe(alt);
    expect(r[0]).toBe(alt[1]);
  });
  it("leere oder keine Liste: die neue gilt", () => {
    expect(teilen([], [{ id: 1 }], id)).toEqual([{ id: 1 }]);
    expect(teilen(null, [{ id: 1 }], id)).toEqual([{ id: 1 }]);
  });
});
