// useAktiv(): laeuft dieses Modul fuer diese Lehrkraft?
//
// Der teure Fehler ist nicht die Abfrage, sondern der Tippfehler im Schluessel:
// "noten" statt "auswertung" liefert einfach false, das Feature verschwindet
// stillschweigend, und niemand sieht einen Fehler (so waren die Noten-
// Uebernahme und der Code-Detektiv-Import monatelang tot). Genau das ist hier
// festgehalten: unbekannter Schluessel meldet sich laut.
//
// Gerendert wird mit renderToString aus react-dom/server — der Hook braucht
// eine echte React-Umgebung, aber kein DOM. Damit bleibt der Aufbau bei
// environment "node"; jsdom und eine Testing-Library waeren nur Ballast.
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { useAktiv, MODUL_KEYS, fetchModules } from "./modules.js";

const MODULE = [
  { key: "cardvote", active: true },
  { key: "karten", active: true },
  { key: "lernpfad", active: false },
];

// Eine Sonde, die das Ergebnis von useAktiv() in den gerenderten Text schreibt.
function Sonde({ keys }) {
  const aktiv = useAktiv();
  return <span>{keys.map((k) => `${k}=${aktiv(k)}`).join(" ")}</span>;
}

function frage(...keys) {
  return renderToString(<Sonde keys={keys} />);
}

beforeAll(async () => {
  // Der Modul-Stand kommt vom Backend und wird im Modul gecacht; useModules
  // liest beim ersten Rendern genau diesen Cache.
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => MODULE }));
  await fetchModules({ frisch: true });
});

afterEach(() => vi.restoreAllMocks());

describe("useAktiv", () => {
  it("meldet true fuer ein bekanntes, aktives Modul", () => {
    expect(frage("cardvote")).toContain("cardvote=true");
    expect(frage("karten")).toContain("karten=true");
  });

  it("meldet false fuer ein bekanntes, nicht aktiviertes Modul — ohne Fehler", () => {
    const konsole = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(frage("lernpfad")).toContain("lernpfad=false");
    expect(frage("kalender")).toContain("kalender=false");   // gar nicht in der Antwort
    expect(konsole).not.toHaveBeenCalled();
  });

  it("meldet den unbekannten Schluessel in der Konsole und liefert false", () => {
    const konsole = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(frage("noten")).toContain("noten=false");         // heisst wirklich "auswertung"
    expect(konsole).toHaveBeenCalledTimes(1);
    expect(String(konsole.mock.calls[0][0])).toContain("noten");
    expect(String(konsole.mock.calls[0][0])).toContain("Unbekannter Modul-Schluessel");
  });

  it("kennt keinen Schluessel doppelt und keinen leer", () => {
    expect(new Set(MODUL_KEYS).size).toBe(MODUL_KEYS.length);
    expect(MODUL_KEYS.every((k) => typeof k === "string" && k.trim() === k && k.length > 0)).toBe(true);
  });
});
