// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";

vi.mock("./i18n/index.jsx", () => ({ useLanguage: () => ({ t: (k) => k, lang: "de", setLang: () => {} }) }));
vi.mock("react-router-dom", () => ({
  useBlocker: () => ({ state: "unblocked" }),
  useSearchParams: () => [new URLSearchParams(), () => {}],
  useNavigate: () => () => {},
  Link: () => null,
}));
vi.mock("./core/modules.js", () => ({ useAktiv: () => () => true, useModulOption: () => true }));
vi.mock("./components/KursKlasseSelect.jsx", () => ({ default: () => null }));
vi.mock("./components/Werkzeugleiste.jsx", () => ({ default: ({ links, ansicht }) => <div>{links}{ansicht}</div> }));
vi.mock("./components/Portrait.jsx", () => ({ default: () => null }));

import Anwesenheit from "./pages/Anwesenheit.jsx";

const KLASSEN = [{ id: 7, name: "7.5", students: [{ id: 1, name: "Anna" }, { id: 2, name: "Ben" }] }];

function mockFetch({ verzoegert = false, slots = [], tagFn = null, tag = { 1: { status: "fehlt", note: "", period: null } } } = {}) {
  const urls = [];
  window.fetch = vi.fn((url, opt) => {
    urls.push((opt?.method || "GET") + " " + String(url));
    const u = String(url);
    const antwort = (d) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => d });
    let d = [];
    if (u.startsWith("/api/classes")) d = KLASSEN;
    else if (u.includes("/api/anwesenheit/") && u.includes("summary")) d = {};
    else if (u.includes("/api/anwesenheit/")) d = tagFn ? tagFn(u) : tag;
    else if (u.includes("timetable")) d = { slots };
    else if (u.includes("breaks")) d = [];
    const p = Promise.resolve(antwort(d));
    return verzoegert && u.includes("/api/anwesenheit/") ? new Promise((r) => setTimeout(() => r(antwort(d)), 20)) : p;
  });
  return urls;
}

function statusVon(name) {
  // Die Zeile des Kindes: der aktive Status-Knopf hat Farbe != var(--text3)
  const zeile = screen.getByText(name).closest("div");
  const knoepfe = [...zeile.querySelectorAll("button")];
  const aktiv = knoepfe.find((b) => b.style.color && b.style.color !== "var(--text3)");
  return aktiv ? aktiv.textContent : null;
}

beforeEach(() => { cleanup(); localStorage.clear(); });

describe("Anwesenheit laedt Bestand", () => {
  it("(a) sofortige Antwort", async () => {
    const urls = mockFetch();
    await act(async () => { render(<Anwesenheit />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    console.log("URLS:", urls);
    expect(statusVon("Anna")).toBe("anwesenheit.fehltShort");
    expect(statusVon("Ben")).toBe("anwesenheit.daShort");
  });

  it("(b) verzoegerte Antwort", async () => {
    mockFetch({ verzoegert: true });
    await act(async () => { render(<Anwesenheit />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
    expect(statusVon("Anna")).toBe("anwesenheit.fehltShort");
  });
});

describe("Varianten", () => {
  it("(b) Stunde gewaehlt (Stundenplan da)", async () => {
    const slots = [{ id: 1, weekday: new Date().getDay() === 0 ? 6 : new Date().getDay() - 1, period: 2, class_id: 7, valid_from: null, valid_to: null }];
    mockFetch({ slots, tagFn: (u) => (u.includes("period=2") ? { 1: { status: "fehlt", note: "", period: 2 } } : {}) });
    await act(async () => { render(<Anwesenheit />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    expect(statusVon("Anna")).toBe("anwesenheit.fehltShort");
  });

  it("(c) Tageswechsel per Navigator", async () => {
    let n = 0;
    const urls = mockFetch({ tagFn: () => (++n === 1 ? {} : { 1: { status: "fehlt", note: "", period: null } }) });
    await act(async () => { render(<Anwesenheit />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(statusVon("Anna")).toBe("anwesenheit.daShort");
    const zurueck = screen.getByTitle("kalender.prev");
    await act(async () => { zurueck.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    console.log("URLS-C:", urls);
    expect(statusVon("Anna")).toBe("anwesenheit.fehltShort");
  });

  it("(d) nach dem Speichern neu geladen", async () => {
    let stand = {};
    const urls = mockFetch({ tagFn: () => stand });
    window.fetch = new Proxy(window.fetch, {});
    await act(async () => { render(<Anwesenheit />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    // Anna auf "fehlt" klicken
    const zeile = screen.getByText("Anna").closest("div");
    const fehltBtn = [...zeile.querySelectorAll("button")].find((b) => b.textContent === "anwesenheit.fehltShort");
    await act(async () => { fehltBtn.click(); });
    expect(statusVon("Anna")).toBe("anwesenheit.fehltShort");
    stand = { 1: { status: "fehlt", note: "", period: null } };
    const save = screen.getAllByText("common.save")[0];
    await act(async () => { save.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    console.log("URLS-D:", urls.filter((u) => u.startsWith("PUT")));
    expect(statusVon("Anna")).toBe("anwesenheit.fehltShort");
  });

  it("(e) Klassen kommen aus dem swr-Cache (sofort da, tag spaeter)", async () => {
    localStorage.setItem("nuvora_cache_classes", JSON.stringify({ d: KLASSEN, e: null }));
    mockFetch({ verzoegert: true });
    await act(async () => { render(<Anwesenheit />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
    expect(statusVon("Anna")).toBe("anwesenheit.fehltShort");
  });
});

describe("Reihenfolgen", () => {
  function mockOrder({ classesMs, anwMs, slotsMs = 0, slots = [] }) {
    const urls = [];
    window.fetch = vi.fn((url) => {
      const u = String(url); urls.push(u);
      let d = [], ms = 0;
      if (u.startsWith("/api/classes")) { d = KLASSEN; ms = classesMs; }
      else if (u.includes("summary")) d = {};
      else if (u.includes("/api/anwesenheit/")) { d = { 1: { status: "fehlt", note: "", period: null } }; ms = anwMs; }
      else if (u.includes("timetable")) { d = { slots }; ms = slotsMs; }
      else if (u.includes("breaks")) d = [];
      return new Promise((r) => setTimeout(() => r({ ok: true, status: 200, headers: { get: () => null }, json: async () => d }), ms));
    });
    return urls;
  }
  const faelle = [
    ["classes zuerst", { classesMs: 0, anwMs: 30 }],
    ["anwesenheit zuerst", { classesMs: 30, anwMs: 0 }],
    ["gleichzeitig", { classesMs: 10, anwMs: 10 }],
    ["slots spaet", { classesMs: 0, anwMs: 5, slotsMs: 40, slots: [{ id: 1, weekday: (new Date().getDay() + 6) % 7, period: 2, class_id: 7 }] }],
  ];
  for (const [name, cfg] of faelle) {
    it(name, async () => {
      globalThis.__LOG = name === "classes zuerst";
      const urls = mockOrder(cfg);
      await act(async () => { render(<Anwesenheit />); });
      await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
      const z = screen.getByText("Anna").closest("div");
      console.log(name, "|", [...z.querySelectorAll("button")].map((b) => b.textContent + "=" + b.style.color).join(" "));
      expect(statusVon("Anna")).toBe("anwesenheit.fehltShort");
    });
  }
});
