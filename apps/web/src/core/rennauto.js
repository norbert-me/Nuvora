// Das Rennauto von oben — EINE Form fuer die Strecke (Canvas, ueber Path2D)
// und die Bilder der Erklaerung (SVG). Laenge etwa 30, Breite 16, die Nase
// zeigt nach +x. Farbe der Karosserie kommt vom Aufrufer (Mensch rot, KI blau).
export const AUTO = {
  schatten: "M -13 -6 Q -14 0 -13 6 L 12 5 Q 16 0 12 -5 Z",
  reifen: [
    "M -11 -9 h 6 a 1.5 1.5 0 0 1 1.5 1.5 v 1 a 1.5 1.5 0 0 1 -1.5 1.5 h -6 a 1.5 1.5 0 0 1 -1.5 -1.5 v -1 a 1.5 1.5 0 0 1 1.5 -1.5 Z",
    "M -11 5 h 6 a 1.5 1.5 0 0 1 1.5 1.5 v 1 a 1.5 1.5 0 0 1 -1.5 1.5 h -6 a 1.5 1.5 0 0 1 -1.5 -1.5 v -1 a 1.5 1.5 0 0 1 1.5 -1.5 Z",
    "M 5 -8.5 h 5 a 1.5 1.5 0 0 1 1.5 1.5 v 0.5 a 1.5 1.5 0 0 1 -1.5 1.5 h -5 a 1.5 1.5 0 0 1 -1.5 -1.5 v -0.5 a 1.5 1.5 0 0 1 1.5 -1.5 Z",
    "M 5 5 h 5 a 1.5 1.5 0 0 1 1.5 1.5 v 0.5 a 1.5 1.5 0 0 1 -1.5 1.5 h -5 a 1.5 1.5 0 0 1 -1.5 -1.5 v -0.5 a 1.5 1.5 0 0 1 1.5 -1.5 Z",
  ],
  heckfluegel: "M -16 -8 h 3.5 v 16 h -3.5 Z",
  frontfluegel: "M 12 -7 h 2.5 v 14 h -2.5 Z",
  // Karosserie: breites Heck, schmale Nase
  karosserie: "M -13 -4.5 Q -13 -6 -11 -6 L -2 -5.5 Q 4 -4 9 -2.5 Q 15 -1.5 15.5 0 Q 15 1.5 9 2.5 Q 4 4 -2 5.5 L -11 6 Q -13 6 -13 4.5 Z",
  streifen: "M -12 0 L 14 0",
  cockpit: "M -6 -2.6 Q -1 -3.2 2 -1.8 Q 3 0 2 1.8 Q -1 3.2 -6 2.6 Q -7 0 -6 -2.6 Z",
  helm: { x: -2.5, y: 0, r: 1.9 },
};

// Auf ein Canvas zeichnen (Ursprung = Automitte, schon gedreht).
export function zeichneAuto(g, farbe, alpha = 1) {
  const P = (d) => new Path2D(d);
  g.save();
  g.globalAlpha = alpha * 0.35;
  g.translate(1.5, 2); g.fillStyle = "#000"; g.fill(P(AUTO.schatten)); g.translate(-1.5, -2);
  g.globalAlpha = alpha;
  g.fillStyle = "#1b1b1b";
  AUTO.reifen.forEach((d) => g.fill(P(d)));
  g.fill(P(AUTO.heckfluegel)); g.fill(P(AUTO.frontfluegel));
  g.fillStyle = farbe; g.fill(P(AUTO.karosserie));
  g.strokeStyle = "rgba(255,255,255,0.75)"; g.lineWidth = 1.4; g.stroke(P(AUTO.streifen));
  g.fillStyle = "rgba(20,30,40,0.85)"; g.fill(P(AUTO.cockpit));
  g.beginPath(); g.arc(AUTO.helm.x, AUTO.helm.y, AUTO.helm.r, 0, Math.PI * 2); g.fillStyle = "#ffd54f"; g.fill();
  g.restore();
}
