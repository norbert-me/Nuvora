// Treiber für den Paritätstest (tests/test_scoring_parity.py): liest Fälle als
// JSON aus der Datei in argv[2], rechnet sie mit der ECHTEN Frontend-Quelle
// apps/web/src/core/scoring.js und gibt die Ergebnisse als JSON aus.
// Aufruf:  node scoring_parity.mjs faelle.json
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../web/src/core/scoring.js");
const { bewerte, naechsteStufe, statusOf } = await import(pathToFileURL(src).href);

const faelle = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out = faelle.map((f) => {
  if (f.fn === "naechsteStufe") return naechsteStufe(f.pct, f.scale || null);
  if (f.fn === "statusOf") return statusOf(f.card_id, f.has_any_scan, f.config || null);
  return bewerte(f.questions, f.answers, {
    niveau: f.niveau || "",
    niveauAktiv: !!f.niveau_aktiv,
    minuspunkte: !!f.minuspunkte,
    weights: f.weights || {},
    scale: f.scale || null,
  });
});
process.stdout.write(JSON.stringify(out));
