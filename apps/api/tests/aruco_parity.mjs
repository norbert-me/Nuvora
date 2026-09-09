// Treiber für den Paritätstest (tests/test_aruco_parity.py): liest Fälle als
// JSON aus der Datei in argv[2], rechnet sie mit der ECHTEN Frontend-Quelle
// apps/web/src/cardvote/aruco.js und gibt die Ergebnisse als JSON aus.
// Aufruf:  node aruco_parity.mjs faelle.json
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../web/src/cardvote/aruco.js");
const { winkelAusEcken, antwortAusWinkel, zuversicht } = await import(pathToFileURL(src).href);

const faelle = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out = faelle.map((f) => {
  if (f.fn === "winkel") return winkelAusEcken(f.ecken);
  return { antwort: antwortAusWinkel(f.grad), zuversicht: zuversicht(f.grad) };
});
process.stdout.write(JSON.stringify(out));
