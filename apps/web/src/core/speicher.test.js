// Der Speicher-Zugang darf nie werfen — das ist sein einziger Daseinsgrund.
//
// Der Fall, der es gefunden hat: Safari im privaten Modus laesst schon den
// Zugriff auf `localStorage` werfen. Die Anmeldung legte Token und Nutzer im
// selben try-Block ab wie das fetch und meldete deshalb „Verbindungsfehler" —
// obwohl der Server die Anmeldung angenommen hatte.
//
// Frischer Import je Fall: das Modul merkt sich die Speicher-Antwort und haelt
// ein modul-globales Ausweichlager.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

async function frisch() {
  vi.resetModules();
  return import("./speicher.js");
}

// Ein brauchbarer Speicher, wie ihn ein normaler Browser hat.
function heilerSpeicher() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

function setzeSpeicher(s) {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => s });
}
function speicherWirftSchonBeimZugriff() {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => { throw new Error("SecurityError: localStorage ist gesperrt"); },
  });
}

beforeEach(() => { delete globalThis.localStorage; });
afterEach(() => { delete globalThis.localStorage; });

describe("Speicher-Zugang, heiler Browser", () => {
  it("legt ab, liest zurueck und meldet den Speicher als nutzbar", async () => {
    setzeSpeicher(heilerSpeicher());
    const s = await frisch();
    expect(s.speicherNutzbar()).toBe(true);
    expect(s.schreib("token", "abc"), "dauerhaft abgelegt").toBe(true);
    expect(s.lies("token")).toBe("abc");
    s.loesche("token");
    expect(s.lies("token")).toBe(null);
  });

  it("hinterlaesst keine Probe-Reste", async () => {
    const echt = heilerSpeicher();
    setzeSpeicher(echt);
    const s = await frisch();
    s.speicherNutzbar();
    expect(s.schluessel()).toEqual([]);
  });

  it("liest und schreibt JSON, ohne an kaputtem Inhalt zu zerbrechen", async () => {
    const echt = heilerSpeicher();
    setzeSpeicher(echt);
    const s = await frisch();
    s.schreibJson("user", { id: 7, email: "a@b.de" });
    expect(s.liesJson("user")).toEqual({ id: 7, email: "a@b.de" });
    echt.setItem("user", "{kaputt");
    expect(s.liesJson("user", "ersatz")).toBe("ersatz");
  });
});

describe("Speicher-Zugang, gesperrter Browser (privater Modus)", () => {
  it("wirft nicht, sondern MELDET, dass der Speicher nicht nutzbar ist", async () => {
    speicherWirftSchonBeimZugriff();
    const s = await frisch();
    expect(() => s.speicherNutzbar()).not.toThrow();
    expect(s.speicherNutzbar(), "gesperrter Speicher darf nicht als nutzbar gelten").toBe(false);
  });

  it("meldet beim Ablegen false, statt den Aufrufer mitzureissen", async () => {
    speicherWirftSchonBeimZugriff();
    const s = await frisch();
    let ergebnis;
    expect(() => { ergebnis = s.schreib("token", "abc"); }).not.toThrow();
    expect(ergebnis, "false = nur im Arbeitsspeicher").toBe(false);
  });

  it("traegt die Sitzung im Arbeitsspeicher weiter — der Token bleibt lesbar", async () => {
    speicherWirftSchonBeimZugriff();
    const s = await frisch();
    s.schreib("token", "abc");
    // Genau das braucht der fetch-Interceptor: ohne diese Zeile ist Nuvora
    // im privaten Fenster nach der Anmeldung sofort wieder abgemeldet.
    expect(s.lies("token")).toBe("abc");
    s.loesche("token");
    expect(s.lies("token")).toBe(null);
  });

  it("wirft auch beim Lesen und Aufzaehlen nicht", async () => {
    speicherWirftSchonBeimZugriff();
    const s = await frisch();
    expect(() => s.lies("token")).not.toThrow();
    expect(s.lies("token")).toBe(null);
    expect(() => s.loesche("token")).not.toThrow();
    expect(() => s.schluessel("nuvora_cache_")).not.toThrow();
    expect(s.schluessel("nuvora_cache_")).toEqual([]);
  });

  it("faellt auch ohne jeden localStorage nicht um (Node, alter Browser)", async () => {
    const s = await frisch(); // globalThis.localStorage existiert gar nicht
    expect(s.speicherNutzbar()).toBe(false);
    expect(s.schreib("a", "1")).toBe(false);
    expect(s.lies("a")).toBe("1");
  });
});

describe("Speicher-Zugang, Lesen geht / Schreiben wirft", () => {
  // Safaris privater Modus in der zweiten Variante: er gibt den Speicher
  // heraus, verweigert aber jede Ablage (QuotaExceededError).
  function nurLesen(vorbelegt = {}) {
    const m = new Map(Object.entries(vorbelegt));
    const nein = () => { throw new Error("QuotaExceededError"); };
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      key: (i) => [...m.keys()][i] ?? null,
      get length() { return m.size; },
      setItem: nein, removeItem: nein, clear: nein,
    };
  }

  it("meldet den Speicher als nicht nutzbar", async () => {
    setzeSpeicher(nurLesen());
    const s = await frisch();
    expect(s.speicherNutzbar()).toBe(false);
  });

  it("liest weiter aus dem Browser, haelt Neues im Arbeitsspeicher", async () => {
    setzeSpeicher(nurLesen({ user: '{"id":1}' }));
    const s = await frisch();
    expect(s.liesJson("user")).toEqual({ id: 1 });
    expect(s.schreib("token", "neu")).toBe(false);
    expect(s.lies("token"), "der neuere Stand gewinnt").toBe("neu");
    expect(s.schluessel()).toEqual(expect.arrayContaining(["token", "user"]));
  });
});
