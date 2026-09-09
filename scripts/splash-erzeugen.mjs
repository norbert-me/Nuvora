/**
 * Startbilder fuer die installierte iPhone-App erzeugen.
 *
 * Warum es sie geben muss: Legt man Nuvora auf den Home-Bildschirm, zeigt iOS
 * beim Start eine WEISSE Flaeche, bis die App gezeichnet hat — es sei denn, im
 * <head> steht fuer genau diese Bildschirmgroesse ein `apple-touch-startup-
 * image`. Android und der Desktop brauchen das nicht (dort baut der Browser
 * den Startbildschirm aus dem Manifest), iOS wertet das Manifest dafuer nicht
 * aus. Und im dunklen Design ist die weisse Flaeche nicht nur leer, sondern
 * blendet.
 *
 * Warum ERZEUGT statt von Hand gemalt: es sind zwei Dutzend Bilder, eines je
 * Geraetegroesse und Design, und jedes ist dasselbe Bild in einer anderen
 * Aufloesung. Von Hand gepflegt waere nach dem naechsten iPhone die Haelfte
 * falsch. Gezeichnet wird mit Playwright — das liegt fuer die Browser-Tests
 * ohnehin in scripts/node_modules, eine zusaetzliche Bild-Bibliothek waere eine
 * Abhaengigkeit fuer eine Handvoll Rechtecke.
 *
 * Aufruf:  node scripts/splash-erzeugen.mjs
 * Ergebnis: apps/web/public/splash/*.png  +  die <link>-Zeilen fuer index.html
 *           (werden am Ende ausgegeben, damit man sie vergleichen kann).
 *
 * Neues Geraet: eine Zeile in GERAETE, Skript laufen lassen, die ausgegebenen
 * <link>-Zeilen nach apps/web/index.html uebernehmen.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HIER = path.dirname(fileURLToPath(import.meta.url));
const ZIEL = path.join(HIER, "..", "apps", "web", "public", "splash");

// Breite × Hoehe in CSS-Pixeln, dazu die Pixeldichte — genau die drei Werte,
// nach denen iOS das passende Bild sucht. Mehrere Geraete teilen sich eine
// Zeile (iPhone 15 und 16 sind gleich gross); der Kommentar nennt nur eins.
const GERAETE = [
  [320, 568, 2, "SE 1"],
  [375, 667, 2, "SE 2/3, 8"],
  [414, 736, 3, "8 Plus"],
  [375, 812, 3, "X, 11 Pro, 13 mini"],
  [414, 896, 2, "XR, 11"],
  [414, 896, 3, "XS Max, 11 Pro Max"],
  [390, 844, 3, "12, 13, 14"],
  [428, 926, 3, "13 Pro Max, 14 Plus"],
  [393, 852, 3, "14 Pro, 15, 16"],
  [430, 932, 3, "15 Plus, 16 Plus"],
  [402, 874, 3, "16 Pro"],
  [440, 956, 3, "16 Pro Max"],
];

// Dieselben Farben wie die Shell (apps/web/index.html): --bg und --accent.
const DESIGNS = {
  hell: { grund: "#ffffff", schrift: "#0066cc" },
  dunkel: { grund: "#000000", schrift: "#0a84ff" },
};

// Der Schriftzug, nichts weiter. Ein Startbild ist eine halbe Sekunde lang zu
// sehen; alles, was mehr sagen will als „richtige App, gleich da", liest
// ohnehin niemand.
const seite = (grund, schrift, w, h) => `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;width:${w}px;height:${h}px;background:${grund};
    display:flex;align-items:center;justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}
  div{color:${schrift};font-weight:800;letter-spacing:-0.5px;font-size:${Math.round(w * 0.16)}px;}
</style><div>Nuvora</div>`;

const browser = await chromium.launch();
fs.mkdirSync(ZIEL, { recursive: true });
const zeilen = [];

for (const [w, h, dpr, geraete] of GERAETE) {
  for (const [name, farben] of Object.entries(DESIGNS)) {
    const datei = `${w}x${h}@${dpr}-${name}.png`;
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
    await page.setContent(seite(farben.grund, farben.schrift, w, h));
    await page.screenshot({ path: path.join(ZIEL, datei) });
    await page.close();
    const schema = name === "dunkel" ? "dark" : "light";
    zeilen.push(`    <!-- ${geraete} -->\n    <link rel="apple-touch-startup-image" href="/splash/${datei}"`
      + ` media="(prefers-color-scheme: ${schema}) and (device-width: ${w}px) and (device-height: ${h}px)`
      + ` and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)">`);
  }
}
await browser.close();
console.log(zeilen.join("\n"));
console.log(`\n${zeilen.length} Bilder in ${ZIEL}`);
