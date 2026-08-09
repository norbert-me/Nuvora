// Jeder Modul-Schluessel im Quelltext muss es wirklich geben.
//
// Ein Tippfehler ist hier stumm: die Abfrage liefert false, das Feature
// verschwindet, niemand sieht einen Fehler. useAktiv() meldet unbekannte
// Schluessel in der Konsole — aber nur, wenn eine Seite es auch benutzt.
// NuvoraHome hatte sich stattdessen eine eigene Zeile gebaut und fragte nach
// "methoden"; das Modul heisst unterrichtsplanung. Der Einstiegs-Vorschlag bei
// schwachen Themen war damit dauerhaft tot, ohne jede Meldung.
//
// Dieser Test liest den Quelltext, statt auf einen Klick im Browser zu warten.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { MODUL_KEYS } from "./modules.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function dateien(ordner) {
  const raus = [];
  for (const name of readdirSync(ordner)) {
    const pfad = join(ordner, name);
    if (statSync(pfad).isDirectory()) raus.push(...dateien(pfad));
    else if (/\.jsx?$/.test(name) && !/\.test\./.test(name)) raus.push(pfad);
  }
  return raus;
}

// aktiv("karten"), isOn("karten"), aktiv('karten') — die ueblichen Formen.
const AUFRUF = /\b(?:aktiv|isOn|istAktiv|modulAktiv)\(\s*["']([^"']+)["']\s*\)/g;

describe("Modul-Schluessel im Quelltext", () => {
  it("kennt keinen Schluessel, den es nicht gibt", () => {
    const falsch = [];
    for (const pfad of dateien(SRC)) {
      const text = readFileSync(pfad, "utf8");
      for (const treffer of text.matchAll(AUFRUF)) {
        if (!MODUL_KEYS.includes(treffer[1])) {
          const zeile = text.slice(0, treffer.index).split("\n").length;
          falsch.push(`${relative(SRC, pfad)}:${zeile} -> "${treffer[1]}"`);
        }
      }
    }
    expect(falsch, `unbekannte Modul-Schluessel (bekannt: ${MODUL_KEYS.join(", ")})`).toEqual([]);
  });

  it("prueft ueberhaupt etwas — sonst waere der Test eine Attrappe", () => {
    let gefunden = 0;
    for (const pfad of dateien(SRC)) {
      gefunden += [...readFileSync(pfad, "utf8").matchAll(AUFRUF)].length;
    }
    expect(gefunden).toBeGreaterThan(20);
  });
});
