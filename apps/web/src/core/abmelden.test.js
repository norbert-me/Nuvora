// Was beim Abmelden liegen bleibt, findet die naechste Person am selben
// Rechner. Der Test haelt die Liste fest — nicht ihre Vollstaendigkeit (die
// kann kein Test wissen), aber die Faelle, die einmal liegen geblieben sind.
import { describe, it, expect, beforeEach, vi } from "vitest";

function fakeSpeicher() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}

describe("raeumeBrowser", () => {
  beforeEach(() => {
    vi.resetModules();
    globalThis.localStorage = fakeSpeicher();
    globalThis.caches = undefined;
  });

  it("nimmt Token, Namen und Entwuerfe mit", async () => {
    const { raeumeBrowser } = await import("./abmelden.js");
    const ls = globalThis.localStorage;
    for (const k of ["token", "user", "ll_schueler", "nuvora_tafel_v1",
                     "code-detektiv-state", "nuvora_pap_entwurf",
                     "nuvora_outbox_fehler", "nuvora_idmap", "kal_ext_aus",
                     "nuvora_cache_classes", "sitzplan_mark_k7", "nuvora_dash_3"]) {
      ls.setItem(k, "inhalt");
    }
    // Geraete-Einstellungen: die gehoeren dem Rechner, nicht der Person.
    ls.setItem("cardvote_lang", "de");
    ls.setItem("nuvora_sparsam", "1");

    await raeumeBrowser();

    expect([...ls._map.keys()].sort()).toEqual(["cardvote_lang", "nuvora_sparsam"]);
  });

  it("wirft den API-Vorrat des Service-Workers weg — nur den", async () => {
    const geloescht = [];
    globalThis.caches = {
      keys: async () => ["nuvora-v4", "nuvora-api-v4", "fremd"],
      delete: async (n) => { geloescht.push(n); return true; },
    };
    const { apiVorratWegwerfen } = await import("./abmelden.js");
    await apiVorratWegwerfen();
    // Die Programmdateien duerfen bleiben — sonst laedt die App nach dem
    // Abmelden offline gar nicht mehr. Die DATEN muessen weg.
    expect(geloescht).toEqual(["nuvora-api-v4"]);
  });

  it("haelt aus, wenn der Browser gar keinen Speicher hergibt", async () => {
    globalThis.localStorage = undefined;
    const { raeumeBrowser } = await import("./abmelden.js");
    await expect(raeumeBrowser()).resolves.toBeUndefined();
  });
});
