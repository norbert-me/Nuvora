// Kartenerkennung im Browser — dieselbe Bibliothek wie auf dem Server.
//
// Warum es das gibt: der Scanner schickte bisher JEDES Kamerabild an den Server
// (mehrere je Sekunde, eine Unterrichtsstunde lang). Faellt das Schulnetz aus,
// faellt die Abstimmung aus. opencv.js ist derselbe C++-Code nach WebAssembly
// uebersetzt — ein Machbarkeits-Spike hat ihn Karte fuer Karte gegen den Server
// gemessen: auf 912 Karten in 110 Bildern null verlorene Karten, 16 zusaetzlich
// gefundene und NULL abweichende Antworten.
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ DOPPELTE RECHNUNG — zusammen aendern!                                   │
// │ `winkelAusEcken`, `antwortAusWinkel` und `zuversicht` stehen hier UND   │
// │ in apps/api/app/routers/scan_image.py (`angle_from_corners`,           │
// │ `answer_from_angle`, `zuversicht`). Der Server bleibt der Rueckfall,    │
// │ wenn opencv.js nicht startet — dann muessen beide Wege dasselbe         │
// │ Ergebnis liefern, sonst bekaeme dieselbe Karte je nach Geraet eine      │
// │ andere Antwort. Dieselbe Lage wie bei scoring.py / scoring.js, mit      │
// │ demselben Test daneben (aruco.test.js).                                 │
// └─────────────────────────────────────────────────────────────────────────┘

// Die gedruckten Karten tragen DICT_6X6_50 — unverhandelbar: der Bestand liegt
// in Ordnern und Schubladen und wird nicht neu gedruckt.
const WOERTERBUCH = "DICT_6X6_50";
const QUELLE = "/vendor/opencv/opencv.js";

/**
 * Drehlage eines Markers aus seinen vier Ecken.
 *
 * ecken: [[x,y] ×4] — TL, TR, BR, BL in der kanonischen Lage des Markers.
 * Gemessen wird der Vektor von der Mitte der linken zur Mitte der rechten Kante.
 */
export function winkelAusEcken(ecken) {
  const [tl, tr, br, bl] = ecken;
  const rx = (tr[0] + br[0]) / 2 - (tl[0] + bl[0]) / 2;
  const ry = (tr[1] + br[1]) / 2 - (tl[1] + bl[1]) / 2;
  return (Math.atan2(ry, rx) * 180) / Math.PI;
}

/**
 * Drehlage → Antwort. 0° = A (oben), 90° = D (links), 180° = C, 270° = B.
 * atan2 rechnet in Bildkoordinaten (Y nach unten) und vertauscht dabei B und D
 * — deshalb stehen sie hier getauscht.
 */
export function antwortAusWinkel(grad) {
  const n = ((grad % 360) + 360) % 360;
  if (n < 45 || n >= 315) return "A";
  if (n < 135) return "D";
  if (n < 225) return "C";
  return "B";
}

/**
 * Wie eindeutig lag die Karte?
 *
 * Die Zuordnung viertelt den Kreis: bei 44 Grad Schieflage kommt A heraus, bei
 * 45 Grad D. Im Unterricht haelt niemand die Karte exakt gerade — eine Karte,
 * die knapp an dieser Kante lag, ist ein Kandidat fuer eine Verwechslung, und
 * die Lehrkraft soll das sehen koennen.
 *
 * 0 Grad Abweichung -> 1.0, 45 Grad (die Kante) -> 0.0.
 */
export function zuversicht(grad) {
  const n = ((grad % 360) + 360) % 360;
  const abweichung = Math.min(...[0, 90, 180, 270, 360].map((v) => Math.abs(n - v)));
  // Auf drei Stellen wie der Server (Python `round`) — sonst weicht dieselbe
  // Karte in der letzten Stelle ab, je nachdem wer gerechnet hat.
  return Math.round(Math.max(0, 1 - abweichung / 45) * 1000) / 1000;
}

// ─── Laden und Erkennen ───

let _laden = null;   // Promise, damit zwei Aufrufe nicht zwei Skripte einhaengen
let _detektor = null;
let _cv = null;

function skriptEinhaengen() {
  return new Promise((fertig, fehler) => {
    const vorhanden = document.querySelector(`script[data-nuvora-opencv]`);
    if (vorhanden) { vorhanden.addEventListener("load", () => fertig()); vorhanden.addEventListener("error", fehler); return; }
    const s = document.createElement("script");
    s.src = QUELLE;
    s.async = true;
    s.dataset.nuvoraOpencv = "1";
    s.onload = () => fertig();
    s.onerror = () => fehler(new Error("opencv.js liess sich nicht laden"));
    document.head.appendChild(s);
  });
}

// Das UMD-Bundle setzt `window.cv` sofort, das WebAssembly daneben braucht aber
// noch einen Moment. Es gibt keinen verlaesslichen Rueckruf ueber alle Builds
// hinweg (mal `onRuntimeInitialized`, mal ein `ready`-Promise), deshalb wird
// auf das erste wirklich gebrauchte Symbol gewartet — dasselbe Verfahren, mit
// dem der Spike gemessen hat.
//
// ACHTUNG, teuer bezahlt: `window.cv` traegt selbst ein `then` (Emscripten baut
// das Module als Thenable). Es darf deshalb NIE der Wert eines Promise werden —
// weder `fertig(cv)` noch `return cv` in einer async-Funktion noch `await cv`:
// die Promise-Aufloesung ruft dann `cv.then(...)`, das mit dem Module selbst
// antwortet, und die Kette laeuft endlos weiter. Sie wirft nichts, sie meldet
// nichts — der Hauptthread haengt in Microtasks fest, die Seite reagiert nicht
// mehr, und in der Konsole steht kein Wort. Deshalb kommt es hier in einer
// Huelle heraus.
function aufLaufzeitWarten(grenzeMs = 30000) {
  return new Promise((fertig, fehler) => {
    const anfang = Date.now();
    const schauen = () => {
      const cv = window.cv;
      if (cv && typeof cv.Mat === "function" && typeof cv.getPredefinedDictionary === "function"
          && typeof cv.aruco_ArucoDetector !== "undefined") { fertig({ cv }); return; }
      if (Date.now() - anfang > grenzeMs) { fehler(new Error("opencv.js wurde nicht rechtzeitig einsatzbereit")); return; }
      setTimeout(schauen, 50);
    };
    schauen();
  });
}

/**
 * opencv.js einmalig und traege laden und den Detektor bauen.
 * Wirft, wenn die Datei nicht laedt oder das WebAssembly nicht startet — dann
 * bleibt dem Scanner der Weg ueber den Server (siehe Scanner.jsx).
 */
export function ladeErkennung() {
  if (_laden) return _laden;
  _laden = (async () => {
    await skriptEinhaengen();
    const { cv } = await aufLaufzeitWarten();
    const woerterbuch = cv.getPredefinedDictionary(cv[WOERTERBUCH]);
    const parameter = new cv.aruco_DetectorParameters();
    // Der JS-Konstruktor verlangt ALLE drei Argumente, sonst BindingError
    // ("invalid number of parameters (2) - expected (3)"). (10, 3, true) sind
    // die C++-Vorgaben fuer RefineParameters — dieselben, die Python still nimmt.
    const verfeinerung = new cv.aruco_RefineParameters(10, 3, true);
    _detektor = new cv.aruco_ArucoDetector(woerterbuch, parameter, verfeinerung);
    _cv = cv;
    return _detektor;
  })().catch((err) => { _laden = null; throw err; });
  return _laden;
}


/**
 * Marker in einem Canvas erkennen. Liefert dieselbe Form wie der Server:
 * [{ marker_id, answer, confidence, corners }] — corners auf 0..1 normiert,
 * damit die Ueberlagerung im Scanner ohne Umrechnung dieselbe bleibt.
 *
 * `ladeErkennung()` muss vorher gelaufen sein.
 */
export function erkenne(canvas) {
  if (!_detektor || !_cv) throw new Error("Erkennung nicht geladen");
  const cv = _cv;
  // Die Erkennung arbeitet auf Graustufen; der Server dekodiert direkt grau,
  // im Browser fuehrt der Weg zwangslaeufig ueber die RGBA-Bitmap.
  const rgba = cv.imread(canvas);
  const grau = new cv.Mat();
  const ecken = new cv.MatVector();
  const ids = new cv.Mat();
  const verworfen = new cv.MatVector();
  const karten = [];
  try {
    cv.cvtColor(rgba, grau, cv.COLOR_RGBA2GRAY);
    _detektor.detectMarkers(grau, ecken, ids, verworfen);
    const w = grau.cols, h = grau.rows;
    for (let i = 0; i < ids.rows; i++) {
      const m = ecken.get(i); // 1x4 CV_32FC2
      const d = m.data32F;
      const punkte = [[d[0], d[1]], [d[2], d[3]], [d[4], d[5]], [d[6], d[7]]];
      m.delete();
      const winkel = winkelAusEcken(punkte);
      karten.push({
        marker_id: ids.intAt(i, 0),
        answer: antwortAusWinkel(winkel),
        confidence: zuversicht(winkel),
        corners: punkte.map(([x, y]) => [x / w, y / h]),
      });
    }
  } finally {
    // WebAssembly hat keine Speicherbereinigung: jede Mat, die hier liegen
    // bleibt, bleibt fuer immer liegen — und der Scanner laeuft mit mehreren
    // Bildern je Sekunde eine Unterrichtsstunde lang.
    rgba.delete(); grau.delete(); ecken.delete(); ids.delete(); verworfen.delete();
  }
  return karten;
}
