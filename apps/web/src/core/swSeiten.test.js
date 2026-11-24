// Der Service-Worker beantwortet Seiten aus dem Vorrat, wenn das Netz HAENGT (kurze Unterbrechung des
// Internets), nicht erst, wenn der Abruf mit einem Fehler endet. sw.js ist ein Skript ohne Export:
// die Funktion wird aus dem Quelltext gezogen und mit einem Nachbau von caches/fetch ausgefuehrt.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const quelle = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
const a = quelle.indexOf("const SEITEN_WARTEN_MS");
const b = quelle.indexOf('self.addEventListener("install"');
const rumpf = quelle.slice(a, b);

function bauen({ vorrat = {}, fetchFn, online = true }) {
  const speicher = new Map(Object.entries(vorrat));
  const cache = { match: async (r) => speicher.get(typeof r === "string" ? r : r.url), put: async (r, res) => { speicher.set(r.url, res); } };
  const caches = { open: async () => cache };
  const self = { navigator: { onLine: online } };
  // eslint-disable-next-line no-new-func
  const f = new Function("caches", "fetch", "self", "CACHE_NAME", `${rumpf}; return seitenAntwort;`);
  return f(caches, fetchFn, self, "nuvora-v4");
}
const antwort = (text, ok = true) => ({ ok, text, clone() { return this; } });

describe("Service-Worker: Seiten bei hängendem Netz", () => {
  it("hängt der Abruf, antwortet nach dem Zeitlimit der Vorrat", async () => {
    vi.useFakeTimers();
    const huelle = antwort("HUELLE");
    const seite = bauen({ vorrat: { "/index.html": huelle }, fetchFn: () => new Promise(() => {}) });
    const p = seite({ url: "/kurse" }, true);
    await vi.advanceTimersByTimeAsync(3100);
    expect(await p).toBe(huelle);
    vi.useRealTimers();
  });
  it("die genaue Seite im Vorrat geht vor der Hülle", async () => {
    vi.useFakeTimers();
    const genau = antwort("KURSE");
    const seite = bauen({ vorrat: { "/kurse": genau, "/index.html": antwort("HUELLE") }, fetchFn: () => new Promise(() => {}) });
    const p = seite({ url: "/kurse" }, true);
    await vi.advanceTimersByTimeAsync(3100);
    expect(await p).toBe(genau);
    vi.useRealTimers();
  });
  it("antwortet der Server rechtzeitig, gilt seine Antwort", async () => {
    const frisch = antwort("FRISCH");
    const seite = bauen({ vorrat: { "/index.html": antwort("ALT") }, fetchFn: async () => frisch });
    expect(await seite({ url: "/kurse" }, true)).toBe(frisch);
  });
  it("Fehler vom Netz: sofort der Vorrat", async () => {
    const huelle = antwort("HUELLE");
    const seite = bauen({ vorrat: { "/index.html": huelle }, fetchFn: async () => { throw new TypeError("offline"); } });
    expect(await seite({ url: "/kurse" }, true)).toBe(huelle);
  });
  it("ohne Verbindung wartet er gar nicht erst", async () => {
    const huelle = antwort("HUELLE");
    const seite = bauen({ online: false, vorrat: { "/index.html": huelle }, fetchFn: () => new Promise(() => {}) });
    expect(await seite({ url: "/kurse" }, true)).toBe(huelle);
  });
  it("ohne Vorrat wird der Abruf zu Ende gewartet", async () => {
    const spaet = antwort("SPAET");
    const seite = bauen({ fetchFn: () => new Promise((r) => setTimeout(() => r(spaet), 4000)) });
    expect(await seite({ url: "/kurse" }, true)).toBe(spaet);
  });
});
