// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

vi.mock("./i18n/index.jsx", () => ({ useLanguage: () => ({ t: (k) => k, lang: "de", setLang: () => {} }) }));
vi.mock("react-router-dom", () => ({
  useBlocker: () => ({ state: "unblocked" }),
  useSearchParams: () => [new URLSearchParams(), () => {}],
  Link: () => null,
  useNavigate: () => () => {},
}));

const URLS = [];
function json(d) { return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve(d), clone() { return this; } }); }

const SECTIONS = [{ id: 10, name: "SoMi", weight: 100, categories: [{ id: 100, name: "Test", weight: 100, date: "2026-09-08" }] }];
const SUMMARY = [{ student_id: 1, name: "Anna", weighted: null, section_effective: {} }];

globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

beforeEach(() => {
  URLS.length = 0;
  localStorage.clear();
  localStorage.setItem("token", "t");
  globalThis.fetch = vi.fn((u) => {
    const url = String(u);
    URLS.push(url);
    if (url.startsWith("/api/modules")) return json([{ key: "orga", active: true }, { key: "auswertung", active: true }]);
    if (url.startsWith("/api/classes")) return json([{ id: 1, name: "7a" }]);
    if (url.startsWith("/api/kurse")) return json([]);
    if (url.startsWith("/api/topics")) return json([]);
    if (url.includes("/students")) return json([{ id: 1, name: "Anna", card_id: 1 }]);
    if (url.includes("/sections")) return json(SECTIONS);
    if (url.includes("/entries")) return json([]);
    if (url.includes("/summary") && url.startsWith("/api/noten")) return json(SUMMARY);
    if (url.includes("/dividers")) return json([]);
    if (url.startsWith("/api/anwesenheit")) return json({ "2026-09-08": { "1": "fehlt" } });
    return json([]);
  });
});

describe("Noten: Fehlzeiten-Toenung", () => {
  it("faerbt die Zelle", async () => {
    const { default: Noten } = await import("./pages/Noten.jsx");
    const { container } = render(<Noten />);
    await waitFor(() => expect(container.querySelectorAll("td").length).toBeGreaterThan(1));
    await new Promise((r) => setTimeout(r, 200));
    console.log("URLS:", URLS);
    console.log("TDs:", [...container.querySelectorAll("td")].map((td) => td.getAttribute("style")));
    const gefaerbt = container.querySelector('td[style*="inset 3px"]');
    expect(gefaerbt).toBeTruthy();
  });
});
