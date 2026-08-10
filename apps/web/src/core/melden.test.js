// Eine abgelehnte Speicherung muss zu sehen sein.
//
// Der Fehler, den dieser Test festhält: 64 Aufrufe im Frontend schluckten die
// Antwort (`.catch(() => {})`, kein `res.ok`) und luden danach neu — die
// getippte Änderung war weg, ohne dass irgendwo stand, warum. Bricht die
// Prüfung hier, kommt genau dieses Verhalten zurück.
import { describe, it, expect, vi, beforeEach } from "vitest";

const gemeldet = [];
vi.mock("./undo.jsx", () => ({
  zeigeFehler: (m) => gemeldet.push(m),
}));

const { sende, pruefeAntwort, fehlerText } = await import("./melden.js");

const antwort = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  clone() { return this; },
  json: async () => { if (body === undefined) throw new Error("kein JSON"); return body; },
});

beforeEach(() => { gemeldet.length = 0; vi.restoreAllMocks(); });

describe("sende()", () => {
  it("meldet nichts, wenn der Server gespeichert hat", async () => {
    globalThis.fetch = vi.fn(async () => antwort(200, {}));
    expect(await sende("/api/kurse/1", { method: "PUT" }, "Kurs umbenennen")).toBe(true);
    expect(gemeldet).toEqual([]);
  });

  it("meldet die Ablehnung und sagt Nein, statt still neu zu laden", async () => {
    globalThis.fetch = vi.fn(async () => antwort(403));
    expect(await sende("/api/kurse/1", { method: "PUT" }, "Kurs umbenennen")).toBe(false);
    expect(gemeldet).toHaveLength(1);
    expect(gemeldet[0]).toContain("Kurs umbenennen");
    expect(gemeldet[0]).toContain("Berechtigung");
  });

  it("nennt den Grund des Servers im Klartext, wenn er einen schickt", async () => {
    globalThis.fetch = vi.fn(async () => antwort(409, { detail: "Name ist schon vergeben" }));
    await sende("/api/kurse", { method: "POST" }, "Kurs anlegen");
    expect(gemeldet[0]).toBe("Kurs anlegen: Name ist schon vergeben");
  });

  it("behandelt einen Netzabbruch wie eine Ablehnung — nicht wie Erfolg", async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    expect(await sende("/api/todo/1", { method: "PUT" }, "Aufgabe ändern")).toBe(false);
    expect(gemeldet[0]).toContain("Keine Verbindung");
  });

  it("nimmt auch eine Antwort ohne JSON-Körper an (500 vom Proxy)", async () => {
    globalThis.fetch = vi.fn(async () => antwort(502));
    expect(await sende("/api/todo/1", { method: "PUT" })).toBe(false);
    expect(gemeldet[0]).toContain("502");
  });
});

describe("pruefeAntwort()", () => {
  it("wertet eine fehlende Antwort als Fehler", async () => {
    expect(await pruefeAntwort(null, "Speichern")).toBe(false);
    expect(gemeldet).toHaveLength(1);
  });
});

describe("fehlerText()", () => {
  it("erklärt statt zu nummerieren", () => {
    expect(fehlerText(401)).toContain("Anmeldung");
    expect(fehlerText(429)).toContain("warten");
    expect(fehlerText(503)).toContain("503");
    expect(fehlerText(0)).toContain("Verbindung");
  });
});
