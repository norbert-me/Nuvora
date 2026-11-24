// Bilder fuer Fragen: was der Server nicht annimmt, wird vorher im Browser passend gemacht.
//
// Der Server nimmt nur JPEG, PNG, GIF und WebP an. SVG ist bewusst verboten (ein SVG laeuft als Dokument auf
// Nuvoras eigener Herkunft und kann Skripte tragen; ein Filter dafuer wurde schon einmal umgangen) — aber
// genau SVG ist, was aus GeoGebra, Mathe-Werkzeugen und Schulbuch-PDFs kommt. Statt es auf dem Server
// zuzulassen, wird es hier zu einem PNG gerendert: im <img> laufen keine Skripte, und hochgeladen wird nur Pixel.
export const istSvg = (datei) => !!datei && (datei.type === "image/svg+xml" || /\.svg$/i.test(datei.name || ""));

/** SVG-Datei -> PNG-Datei (transparent, hoechstens `maxKante` Pixel); null, wenn sich das nicht rendern laesst. */
export async function svgZuPng(datei, maxKante = 2000) {
  let url = null;
  try {
    const text = await datei.text();
    url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
    const bild = await new Promise((ok, fehl) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fehl(new Error("svg")); i.src = url; });
    // Ein SVG ohne feste Groesse meldet 0 — dann eine ordentliche Standardgroesse nehmen.
    let w = bild.naturalWidth || 800, h = bild.naturalHeight || 600;
    // Klein gezeichnete SVG werden scharf: bis zum Doppelten, aber nie ueber `maxKante`.
    const f = Math.min(2, maxKante / Math.max(w, h));
    w = Math.max(1, Math.round(w * f)); h = Math.max(1, Math.round(h * f));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(bild, 0, 0, w, h);
    const blob = await new Promise((ok) => c.toBlob(ok, "image/png"));
    return blob ? new File([blob], String(datei.name || "bild").replace(/\.svg$/i, "") + ".png", { type: "image/png" }) : null;
  } catch {
    return null;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}
