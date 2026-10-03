// Geometrische Körper — Rechnung ohne Oberfläche (Modul „Körper").
//
// Ein Körper ist hier zweierlei:
//   1. seine FERTIGE Form: Flächen als 3D-Vielecke (`flaechen`), dazu
//   2. ein Baum, welche Fläche an welcher Kante an welcher hängt (`eltern`).
// Daraus entsteht alles andere. Das Netz wird nicht gezeichnet, sondern
// ausgerechnet: jede Fläche dreht sich um die Kante zu ihrer Elternfläche, bis
// sie mit ihr in einer Ebene liegt. Der Regler „Auffalten" ist genau dieser
// Drehwinkel (t = 1 geschlossen, t = 0 flaches Netz) — für den Quader wie für
// den Kegel, ohne je Körper eine eigene Faltlogik.
//
// Runde Körper (Zylinder, Kegel, Kugel) sind aus vielen schmalen Flächen
// angenähert; sie tragen eine `gruppe` (z. B. „Mantel"), und Färben, Beschriften
// und Flächeninhalt gelten der Gruppe. Oberfläche und Volumen kommen aus den
// exakten Formeln, nicht aus der Näherung.

const V = {
  plus: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  minus: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mal: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  kreuz: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  laenge: (a) => Math.hypot(a[0], a[1], a[2]),
};
V.einheit = (a) => { const l = V.laenge(a) || 1; return V.mal(a, 1 / l); };

const mitte = (pts) => V.mal(pts.reduce((s, p) => V.plus(s, p), [0, 0, 0]), 1 / pts.length);

// Normale nach Newell — robust auch fuer Vielecke mit vielen Ecken.
function normale(pts) {
  let n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n = V.plus(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
  }
  return V.einheit(n);
}

// ── 4×4-Matrizen (Zeilenform) ──
const EINS = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function matMal(A, B) {
  const C = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) C[r * 4 + c] += A[r * 4 + k] * B[k * 4 + c];
  return C;
}
function anwenden(M, p) {
  return [M[0] * p[0] + M[1] * p[1] + M[2] * p[2] + M[3], M[4] * p[0] + M[5] * p[1] + M[6] * p[2] + M[7], M[8] * p[0] + M[9] * p[1] + M[10] * p[2] + M[11]];
}
// Drehung um die Gerade durch o mit Richtung u (Einheitsvektor) um den Winkel w.
function drehungUm(o, u, w) {
  const [x, y, z] = u, c = Math.cos(w), s = Math.sin(w), C = 1 - c;
  const R = [
    c + x * x * C, x * y * C - z * s, x * z * C + y * s, 0,
    y * x * C + z * s, c + y * y * C, y * z * C - x * s, 0,
    z * x * C - y * s, z * y * C + x * s, c + z * z * C, 0,
    0, 0, 0, 1,
  ];
  const T = [1, 0, 0, o[0], 0, 1, 0, o[1], 0, 0, 1, o[2], 0, 0, 0, 1];
  const Tm = [1, 0, 0, -o[0], 0, 1, 0, -o[1], 0, 0, 1, -o[2], 0, 0, 0, 1];
  return matMal(T, matMal(R, Tm));
}

const gleich = (a, b) => V.laenge(V.minus(a, b)) < 1e-6;
// Die gemeinsame Kante zweier Flaechen (zwei gemeinsame Ecken).
function gemeinsameKante(a, b) {
  const g = a.filter((p) => b.some((q) => gleich(p, q)));
  return g.length >= 2 ? [g[0], g[1]] : null;
}

// ── Die Koerper ──
// Jede Fabrik liefert { flaechen: [{ id, gruppe, pts }], eltern: {id: elternId},
// gruppen: [{ id, name, inhalt }], gegenueber: [[g1, g2], …], oberflaeche, volumen, faltbar }.

function quader(a, b, c, name = "quader") {
  const P = (x, y, z) => [x, y, z];
  const fl = [
    { id: "boden", pts: [P(0, 0, 0), P(0, b, 0), P(a, b, 0), P(a, 0, 0)] },
    { id: "deckel", pts: [P(0, 0, c), P(a, 0, c), P(a, b, c), P(0, b, c)] },
    { id: "vorne", pts: [P(0, 0, 0), P(a, 0, 0), P(a, 0, c), P(0, 0, c)] },
    { id: "hinten", pts: [P(0, b, 0), P(0, b, c), P(a, b, c), P(a, b, 0)] },
    { id: "links", pts: [P(0, 0, 0), P(0, 0, c), P(0, b, c), P(0, b, 0)] },
    { id: "rechts", pts: [P(a, 0, 0), P(a, b, 0), P(a, b, c), P(a, 0, c)] },
  ].map((f) => ({ ...f, gruppe: f.id }));
  return {
    art: name, flaechen: fl,
    eltern: { vorne: "boden", hinten: "boden", links: "boden", rechts: "boden", deckel: "hinten" },
    gruppen: [
      { id: "boden", inhalt: a * b }, { id: "deckel", inhalt: a * b },
      { id: "vorne", inhalt: a * c }, { id: "hinten", inhalt: a * c },
      { id: "links", inhalt: b * c }, { id: "rechts", inhalt: b * c },
    ],
    gegenueber: [["boden", "deckel"], ["vorne", "hinten"], ["links", "rechts"]],
    oberflaeche: 2 * (a * b + b * c + a * c), volumen: a * b * c, faltbar: true,
  };
}

function prisma(a, hoehe) {
  // Gleichseitiges Dreieck (Kante a) als Grundflaeche, aufrecht stehend, Hoehe
  // nach oben — wie die anderen Koerper steht es auf seiner Grundflaeche (sie
  // liegt auf dem Bodenraster). Vorher lag es auf einer Rechteckseite, und die
  // Grundflaeche war die Stirnseite.
  const d = (Math.sqrt(3) / 2) * a;
  const v = [[0, 0, 0], [a, 0, 0], [a / 2, d, 0]];
  const w = v.map(([x, y]) => [x, y, hoehe]);
  const fl = [
    { id: "boden", pts: [v[0], v[2], v[1]] },
    { id: "deckel", pts: [w[0], w[1], w[2]] },
    { id: "seite1", pts: [v[0], v[1], w[1], w[0]] },
    { id: "seite2", pts: [v[1], v[2], w[2], w[1]] },
    { id: "seite3", pts: [v[2], v[0], w[0], w[2]] },
  ].map((f) => ({ ...f, gruppe: f.id }));
  const dreieck = (Math.sqrt(3) / 4) * a * a;
  return {
    art: "prisma", flaechen: fl,
    eltern: { seite1: "boden", seite2: "boden", seite3: "boden", deckel: "seite1" },
    gruppen: [
      { id: "boden", inhalt: dreieck }, { id: "deckel", inhalt: dreieck },
      { id: "seite1", inhalt: a * hoehe }, { id: "seite2", inhalt: a * hoehe }, { id: "seite3", inhalt: a * hoehe },
    ],
    gegenueber: [["boden", "deckel"]],
    oberflaeche: 2 * dreieck + 3 * a * hoehe, volumen: dreieck * hoehe, faltbar: true,
  };
}

function pyramide(a, h) {
  const s = [a / 2, a / 2, h];
  const b = [[0, 0, 0], [0, a, 0], [a, a, 0], [a, 0, 0]];
  const fl = [{ id: "boden", gruppe: "boden", pts: b }];
  ["seite1", "seite2", "seite3", "seite4"].forEach((id, i) => fl.push({ id, gruppe: id, pts: [b[(i + 1) % 4], b[i], s] }));
  const hs = Math.sqrt(h * h + (a / 2) * (a / 2));
  return {
    art: "pyramide", flaechen: fl,
    eltern: { seite1: "boden", seite2: "boden", seite3: "boden", seite4: "boden" },
    gruppen: [{ id: "boden", inhalt: a * a }, ...["seite1", "seite2", "seite3", "seite4"].map((id) => ({ id, inhalt: (a * hs) / 2 }))],
    gegenueber: [],
    oberflaeche: a * a + 2 * a * hs, volumen: (a * a * h) / 3, faltbar: true,
  };
}

const N_RUND = 36;
function zylinder(r, h) {
  const ring = (z) => Array.from({ length: N_RUND }, (_, i) => [r * Math.cos((2 * Math.PI * i) / N_RUND), r * Math.sin((2 * Math.PI * i) / N_RUND), z]);
  const u = ring(0), o = ring(h);
  const fl = [{ id: "boden", gruppe: "boden", pts: [...u].reverse() }, { id: "deckel", gruppe: "deckel", pts: o }];
  const eltern = {};
  for (let i = 0; i < N_RUND; i++) {
    const j = (i + 1) % N_RUND;
    fl.push({ id: `m${i}`, gruppe: "mantel", pts: [u[i], u[j], o[j], o[i]] });
    eltern[`m${i}`] = i === 0 ? "boden" : `m${i - 1}`;
  }
  eltern.deckel = "m0";
  return {
    art: "zylinder", flaechen: fl, eltern,
    gruppen: [{ id: "boden", inhalt: Math.PI * r * r }, { id: "deckel", inhalt: Math.PI * r * r }, { id: "mantel", inhalt: 2 * Math.PI * r * h }],
    gegenueber: [["boden", "deckel"]],
    oberflaeche: 2 * Math.PI * r * r + 2 * Math.PI * r * h, volumen: Math.PI * r * r * h, faltbar: true,
  };
}

function kegel(r, h) {
  const u = Array.from({ length: N_RUND }, (_, i) => [r * Math.cos((2 * Math.PI * i) / N_RUND), r * Math.sin((2 * Math.PI * i) / N_RUND), 0]);
  const s = [0, 0, h];
  const fl = [{ id: "boden", gruppe: "boden", pts: [...u].reverse() }];
  const eltern = {};
  for (let i = 0; i < N_RUND; i++) {
    fl.push({ id: `m${i}`, gruppe: "mantel", pts: [u[i], u[(i + 1) % N_RUND], s] });
    eltern[`m${i}`] = i === 0 ? "boden" : `m${i - 1}`;
  }
  const m = Math.sqrt(r * r + h * h);
  return {
    art: "kegel", flaechen: fl, eltern,
    gruppen: [{ id: "boden", inhalt: Math.PI * r * r }, { id: "mantel", inhalt: Math.PI * r * m }],
    gegenueber: [],
    oberflaeche: Math.PI * r * r + Math.PI * r * m, volumen: (Math.PI * r * r * h) / 3, faltbar: true,
  };
}

function kugel(r) {
  // Eine Kugel hat kein Netz — sie laesst sich nicht verzerrungsfrei in die
  // Ebene abwickeln (`faltbar: false`).
  const B = 24, L = 12, fl = [];
  const P = (i, j) => { const t = (Math.PI * j) / L, p = (2 * Math.PI * i) / B; return [r * Math.sin(t) * Math.cos(p), r * Math.sin(t) * Math.sin(p), r * Math.cos(t)]; };
  for (let j = 0; j < L; j++) for (let i = 0; i < B; i++) {
    const pts = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)].filter((p, k, a) => k === 0 || !gleich(p, a[k - 1]));
    if (pts.length >= 3) fl.push({ id: `k${j}-${i}`, gruppe: "oberflaeche", pts });
  }
  return {
    art: "kugel", flaechen: fl, eltern: {},
    gruppen: [{ id: "oberflaeche", inhalt: 4 * Math.PI * r * r }],
    gegenueber: [], oberflaeche: 4 * Math.PI * r * r, volumen: (4 / 3) * Math.PI * r ** 3, faltbar: false,
  };
}

// Die Masse je Koerper: Schluessel, Voreinstellung, Grenzen.
export const KOERPER = {
  quader: { masse: [["a", 6], ["b", 4], ["c", 3]], bau: (m) => quader(m.a, m.b, m.c) },
  wuerfel: { masse: [["a", 4]], bau: (m) => quader(m.a, m.a, m.a, "wuerfel") },
  prisma: { masse: [["a", 4], ["h", 6]], bau: (m) => prisma(m.a, m.h) },
  pyramide: { masse: [["a", 5], ["h", 4]], bau: (m) => pyramide(m.a, m.h) },
  zylinder: { masse: [["r", 2], ["h", 5]], bau: (m) => zylinder(m.r, m.h) },
  kegel: { masse: [["r", 2.5], ["h", 5]], bau: (m) => kegel(m.r, m.h) },
  kugel: { masse: [["r", 3]], bau: (m) => kugel(m.r) },
};

export function baue(art, masse) {
  const def = KOERPER[art] || KOERPER.quader;
  const m = Object.fromEntries(def.masse.map(([k, v]) => [k, Number(masse?.[k]) > 0 ? Number(masse[k]) : v]));
  const k = def.bau(m);
  // Aussen-Normalen: zum Schwerpunkt hin zeigende umdrehen — dann muss keine
  // Fabrik oben auf die Reihenfolge ihrer Ecken achten.
  const mittelpunkt = mitte(k.flaechen.flatMap((f) => f.pts));
  k.flaechen = k.flaechen.map((f) => {
    let n = normale(f.pts);
    if (V.dot(n, V.minus(mitte(f.pts), mittelpunkt)) < 0) n = V.mal(n, -1);
    return { ...f, n };
  });
  return k;
}

/**
 * Die Flaechen in Stellung `t` (1 = geschlossen, 0 = Netz) — als 3D-Vielecke.
 *
 * Die Wurzel (Flaeche ohne Eltern) bleibt liegen. Jede andere dreht sich um
 * die gemeinsame Kante mit ihrer Elternflaeche um (1 − t)·φ, wobei φ der Winkel
 * zwischen beiden Aussen-Normalen am fertigen Koerper ist; ihre Kinder drehen
 * sich mit. Bei t = 0 liegt damit alles in der Ebene der Wurzel.
 */
export function gefaltet(k, t) {
  const nachId = Object.fromEntries(k.flaechen.map((f) => [f.id, f]));
  const M = {};
  const matrix = (id) => {
    if (M[id]) return M[id];
    const eltern = k.eltern[id];
    if (!eltern || !nachId[eltern] || !k.faltbar) { M[id] = EINS; return M[id]; }
    const f = nachId[id], e = nachId[eltern];
    const kante = gemeinsameKante(f.pts, e.pts);
    let lokal = EINS;
    if (kante) {
      const ax = V.kreuz(f.n, e.n);
      const phi = Math.acos(Math.max(-1, Math.min(1, V.dot(f.n, e.n))));
      if (V.laenge(ax) > 1e-9 && phi > 1e-9) lokal = drehungUm(kante[0], V.einheit(ax), (1 - t) * phi);
    }
    M[id] = matMal(matrix(eltern), lokal);
    return M[id];
  };
  return k.flaechen.map((f) => {
    const m = matrix(f.id);
    const pts = f.pts.map((p) => anwenden(m, p));
    return { id: f.id, gruppe: f.gruppe, pts, n: normale(pts) };
  });
}

/**
 * Projektion fuer die Anzeige: Drehung um die Hochachse (`gier`), dann Neigung
 * (`nick`, 0 = von der Seite, π/2 = von oben). Liefert je Flaeche die
 * Bildpunkte, eine Tiefe zum Sortieren (hinten zuerst zeichnen) und die
 * Helligkeit. Mittig um den Schwerpunkt, auf `groesse` eingepasst.
 */
export function projiziere(flaechen, { gier, nick, breite, hoehe, rand = 70, zoom = 1 }) {
  const alle = flaechen.flatMap((f) => f.pts);
  const c = mitte(alle);
  const cg = Math.cos(gier), sg = Math.sin(gier), cn = Math.cos(nick), sn = Math.sin(nick);
  const sicht = (p) => {
    const q = V.minus(p, c);
    const x1 = q[0] * cg - q[1] * sg, y1 = q[0] * sg + q[1] * cg, z1 = q[2];
    const y2 = y1 * cn - z1 * sn, z2 = y1 * sn + z1 * cn;
    return [x1, -z2, y2];   // Bild-x, Bild-y, Tiefe (groesser = weiter weg)
  };
  // Massstab aus der Kugel um den Koerper, NICHT aus dem gedrehten Umriss:
  // eingepasst auf den Umriss pumpte die Groesse bei jedem Drehschritt (ein
  // Wuerfel uebers Eck ist breiter als von vorn), und Drehen fuehlte sich an
  // wie Ringen. So bleibt der Koerper beim Drehen gleich gross.
  const R = Math.max(1e-6, ...alle.map((p) => V.laenge(V.minus(p, c))));
  const k = ((Math.min(breite, hoehe) / 2 - rand) / R) * zoom;
  const abbild = (p) => { const [x, y] = sicht(p); return [breite / 2 + x * k, hoehe / 2 + y * k]; };
  const licht = V.einheit([0.4, -0.7, 0.6]);
  const out = flaechen.map((f) => {
    const s2 = f.pts.map(sicht);
    const bild = s2.map(([x, y]) => [breite / 2 + x * k, hoehe / 2 + y * k]);
    const tiefe = s2.reduce((t, p) => t + p[2], 0) / s2.length;
    const nb = sicht(V.plus(c, f.n)), n0 = sicht(c);
    const nSicht = V.einheit(V.minus(nb, n0));
    const hell = 0.55 + 0.45 * Math.abs(V.dot(f.n, licht));
    return { ...f, bild, tiefe, hell, zugewandt: nSicht[2] < 0 };
  }).sort((a, b) => b.tiefe - a.tiefe);
  // Dieselbe Abbildung fuer alles, was mit dem Koerper dreht (Bodenraster).
  out.abbild = abbild;
  out.mitte = c;
  out.radius = R;
  out.boden = Math.min(...alle.map((p) => p[2]));
  return out;
}

/**
 * Das Bodenraster: Linien im Abstand einer Masseinheit auf der Ebene, auf der
 * der Koerper steht (tiefster Punkt). Es dreht mit — daran sieht man, wie der
 * Koerper gerade liegt, und es zeigt nebenbei die Groesse (ein Kaestchen =
 * eine Einheit). Liefert Linien als [[x1,y1],[x2,y2]] plus eine Markierung
 * „vorne".
 */
export function bodenRaster(bild) {
  const c = bild.mitte, R = bild.radius, z = bild.boden;
  const schritt = R > 12 ? 2 : 1;
  const halb = Math.max(schritt, Math.round((R * 0.9) / schritt) * schritt);
  const x0 = Math.round(c[0] / schritt) * schritt, y0 = Math.round(c[1] / schritt) * schritt;
  const linien = [];
  for (let d = -halb; d <= halb + 1e-9; d += schritt) {
    linien.push([bild.abbild([x0 + d, y0 - halb, z]), bild.abbild([x0 + d, y0 + halb, z])]);
    linien.push([bild.abbild([x0 - halb, y0 + d, z]), bild.abbild([x0 + halb, y0 + d, z])]);
  }
  const rahmen = [[-halb, -halb], [halb, -halb], [halb, halb], [-halb, halb]].map(([dx, dy]) => bild.abbild([x0 + dx, y0 + dy, z]));
  // „vorne" = Richtung −y (dort liegt die Vorderseite des Quaders).
  const vorne = [bild.abbild([x0, y0 - halb * 0.75, z]), bild.abbild([x0, y0 - halb * 1.1, z])];
  return { linien, rahmen, vorne };
}

/** Die gegenueberliegende Gruppe — oder null, wenn es keine gibt. */
export function gegenueberVon(k, gruppe) {
  for (const [a, b] of k.gegenueber) {
    if (a === gruppe) return b;
    if (b === gruppe) return a;
  }
  return null;
}

// Fuer Tests.
export const _intern = { normale, mitte, V };
