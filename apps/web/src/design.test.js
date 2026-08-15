// Der Wächter über die Design-Leitern.
//
// Die Regeln stehen seit jeher als Kommentar in `components/Icons.jsx` — nur
// prüfte sie nichts. Ergebnis nach einem Jahr: rund zwanzig Schriftgrößen,
// dreizehn Radien, zweiundzwanzig Schattenformeln. So sind auch die vier
// `btnPrimary`-Varianten entstanden, die den Tokensatz überhaupt erst nötig
// gemacht haben. Ein Aufräumen ohne Wächter ist in ein paar Monaten wieder weg.
//
// Der Test ist eine **Ratsche**: er zählt, was noch nicht auf der Leiter liegt,
// und vergleicht mit einer eingecheckten Obergrenze. Mehr werden darf es nie;
// wer aufräumt, trägt die neue, kleinere Zahl ein. Das ist absichtlich kein
// Verbot bei null — ein paar Stellen sind fachlich richtig (ein Balken, dessen
// Radius die halbe Kante ist; die Beamer-Schriftgrößen), und ein Verbot mit
// zwanzig Ausnahmen liest niemand mehr.
//
// Nicht geprüft: `components/Icons.jsx` selbst (dort werden die Werte
// DEFINIERT) und `codedetektiv/**` (eigenes CSS unter `.cd-scope`).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

// Die Schriftleiter. Sechs Stufen reichen; 12.5 neben 13 kann niemand
// unterscheiden, es macht die Oberfläche nur unruhig.
const SCHRIFT = new Set([11, 12, 13, 14, 16, 22]);

// Obergrenzen. Sinken erlaubt, steigen nicht. Wer aufräumt, trägt hier die
// neue Zahl ein — das ist die halbe Minute, die den Rückfall verhindert.
// Stand nach dem grossen Aufraeumen: 252 → 39. Was uebrig ist, ist fachlich
// richtig und steht je mit Kommentar an seiner Stelle:
//
//   fontSize (7) — Projektionsflaechen. Tafel (48/28/30/32) rechnet im
//     REF-Raum 1600×900 und wird per `transform: scale` heruntergerechnet;
//     Session 28 ist der Sitzungscode am Beamer, Scanner 44 der vierstellige
//     Code, Mathefussball 32 der Ball im Spielfeld. Kein Fliesstext.
//   borderRadius (32) — reine Grafik, bei der der Radius die halbe Kante ist
//     (Balkenkappen, Punkte, Kreise, Dreh-Griffe) sowie zwei bewusste Nullen
//     (Tabs in einer Segment-Gruppe bringen keine eigenen Ecken mit).
//
// Sinken erlaubt, steigen nicht. Wer weiter aufraeumt, traegt die kleinere
// Zahl hier ein — das ist die halbe Minute, die den Rueckfall verhindert.
const GRENZE = {
  fontSize: 7,
  borderRadius: 32,
};

function dateien(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "codedetektiv") continue;
      out.push(...dateien(p));
    } else if (e.name.endsWith(".jsx") && e.name !== "Icons.jsx") {
      out.push(p);
    }
  }
  return out;
}

function zaehle() {
  const treffer = { fontSize: [], borderRadius: [] };
  for (const f of dateien(WURZEL)) {
    const text = fs.readFileSync(f, "utf8");
    const kurz = path.relative(WURZEL, f);
    for (const m of text.matchAll(/fontSize:\s*([0-9]+(?:\.[0-9]+)?)/g)) {
      if (!SCHRIFT.has(Number(m[1]))) treffer.fontSize.push(`${kurz}: ${m[1]}`);
    }
    // Ein Radius als Zahl ist immer ein Nachbau: es gibt CONTROL_R (Bedienbares),
    // cardStyle (14), panelStyle (12), modalPanel (16) und chipStyle (rund).
    for (const m of text.matchAll(/borderRadius:\s*([0-9]+)/g)) {
      treffer.borderRadius.push(`${kurz}: ${m[1]}`);
    }
  }
  return treffer;
}

describe("Design-Leitern", () => {
  const treffer = zaehle();

  it("Schriftgrößen bleiben auf der Leiter (11/12/13/14/16/22)", () => {
    const n = treffer.fontSize.length;
    expect(n, `${n} Stellen außerhalb der Leiter (erlaubt: ${GRENZE.fontSize}).\n`
      + `Entweder auf eine Stufe ziehen oder — wenn die Abweichung richtig ist —\n`
      + `die Grenze in design.test.js anheben UND begründen.\n`
      + treffer.fontSize.slice(0, 25).join("\n")).toBeLessThanOrEqual(GRENZE.fontSize);
  });

  it("Radien kommen aus den Tokens, nicht als Zahl", () => {
    const n = treffer.borderRadius.length;
    expect(n, `${n} Radien als Zahl geschrieben (erlaubt: ${GRENZE.borderRadius}).\n`
      + `CONTROL_R / cardStyle / panelStyle / modalPanel / chipStyle nehmen.\n`
      + treffer.borderRadius.slice(0, 25).join("\n")).toBeLessThanOrEqual(GRENZE.borderRadius);
  });
});
