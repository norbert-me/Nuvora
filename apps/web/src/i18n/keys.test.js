// Fehlende Übersetzung = sichtbarer Schlüssel auf der Seite.
//
// Genau das ist passiert: auf der Startseite stand „home.intro" statt eines
// Satzes, und niemandem fiel es auf — der Browser-Rundgang prüft, DASS eine
// Seite rendert, nicht WAS darauf steht. Also prüft es hier der Quelltext
// gegen die Wörterbücher.
//
// Zwei Prüfungen:
//   1. Jeder im Code fest verdrahtete `t("…")`-Schlüssel steht in de.js.
//   2. en.js und es.js kennen dieselben Schlüssel wie de.js — sonst rutscht
//      ein deutscher Satz in die englische Oberfläche (oder eben der nackte
//      Schlüssel).
//
// Bewusst NICHT geprüft: Schlüssel, die aus Variablen zusammengesetzt werden
// (`t(`mod.${key}.name`)`) — die kann nur die Laufzeit kennen.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WURZEL = path.resolve(process.cwd(), "src");
const I18N = path.join(WURZEL, "i18n");

function dateien(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (p !== I18N) out.push(...dateien(p));
    } else if (/\.(jsx?|mjs)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function schluesselAus(datei) {
  const inhalt = fs.readFileSync(datei, "utf8");
  const keys = [];
  for (const zeile of inhalt.split("\n")) {
    for (const m of zeile.matchAll(/\bt\(\s*"([\w.]+)"/g)) {
      const key = m[1];
      // Bewusstes Fallback-Muster: `t("x") !== "x" ? t("x") : "Standard"` oder
      // `t("x") || t("y")`. Dort IST das Fehlen der Übersetzung der geplante
      // Weg — der Code fängt es selbst ab.
      const faengtSelbstAb = zeile.includes(`!== "${key}"`) || new RegExp(`t\\(\\s*"${key}"\\s*\\)\\s*\\|\\|`).test(zeile);
      if (!faengtSelbstAb) keys.push(key);
    }
  }
  return keys;
}

function woerterbuch(name) {
  const inhalt = fs.readFileSync(path.join(I18N, name), "utf8");
  // Mehrere Einträge je Zeile kommen vor (Wochentage) — deshalb global über den
  // ganzen Text, nicht zeilenweise am Zeilenanfang.
  return new Set([...inhalt.matchAll(/"([\w.]+)"\s*:/g)].map((m) => m[1]));
}

describe("i18n", () => {
  it("kennt jeden fest verdrahteten Schlüssel aus dem Code", () => {
    const de = woerterbuch("de.js");
    const fehlend = new Map();
    for (const datei of dateien(WURZEL)) {
      for (const key of schluesselAus(datei)) {
        if (!de.has(key)) {
          const kurz = path.relative(WURZEL, datei);
          fehlend.set(key, [...(fehlend.get(key) || []), kurz]);
        }
      }
    }
    const bericht = [...fehlend.entries()].map(([k, wo]) => `${k} (${wo[0]})`);
    expect(bericht, `Schlüssel ohne Übersetzung in de.js:\n${bericht.join("\n")}`).toEqual([]);
  });

  // Platzhalter heissen {{name}}, nicht {name}. Mit einer Klammer steht der
  // Platzhalter woertlich in der Oberflaeche („Verlauf: {name}") — genau das
  // ist schon zweimal passiert, und auffallen kann es nur jemandem, der die
  // Stelle zufaellig oeffnet.
  it("nutzt {{doppelte}} Klammern als Platzhalter", () => {
    for (const sprache of ["de.js", "en.js", "es.js"]) {
      const inhalt = fs.readFileSync(path.join(I18N, sprache), "utf8");
      const treffer = [...inhalt.matchAll(/^\s*"([\w.]+)":\s*"([^"]*)"/gm)]
        .filter(([, , wert]) => /(?<!\{)\{[a-zA-Z_][a-zA-Z0-9_]*\}(?!\})/.test(wert))
        .map(([, key]) => key);
      expect(treffer, `${sprache}: einfache Klammern in ${treffer.join(", ")}`).toEqual([]);
    }
  });

  it("hat in en.js und es.js dieselben Schlüssel wie in de.js", () => {
    const de = woerterbuch("de.js");
    for (const sprache of ["en.js", "es.js"]) {
      const andere = woerterbuch(sprache);
      const fehlend = [...de].filter((k) => !andere.has(k)).sort();
      expect(fehlend, `${sprache} fehlen ${fehlend.length} Schlüssel: ${fehlend.slice(0, 20).join(", ")}`).toEqual([]);
    }
  });
});
