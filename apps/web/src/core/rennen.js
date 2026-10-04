// KI-Rennen — der Rechenkern ohne Oberflaeche: Strecke, Fahrphysik, Sensoren,
// ein kleines neuronales Netz und die Evolution durch Mutation.
//
// Der Unterrichtsgedanke: eine KI lernt hier nicht durch Erklaeren, sondern
// durch Auswahl. Eine Generation Autos faehrt mit zufaelligen „Gehirnen" los;
// wer am weitesten kommt, darf Nachkommen haben, deren Gewichte leicht
// veraendert (mutiert) werden. Nach ein paar Generationen faehrt die beste
// sauber Runden — und niemand hat ihr gesagt, wie.
//
// Alles ist deterministisch, wenn man einen Zufallsgenerator mitgibt (Tests).

export const BREITE = 900, HOEHE = 600;
export const SPUR = 64;            // Breite der Strasse in Pixeln
export const DT = 1 / 60;          // ein Simulationsschritt
const ZELLE = 4;                   // Raster fuer „liegt das auf der Strasse?"

// Mittellinie als Stuetzpunkte; dazwischen wird glatt interpoliert.
const STUETZEN = [
  [150, 320], [150, 170], [270, 95], [430, 130], [510, 245], [620, 170], [770, 160],
  [830, 300], [760, 445], [580, 480], [450, 400], [320, 500], [180, 470],
];

// Zufall mit Startwert — fuer reproduzierbare Tests.
export function zufallsquelle(seed = Date.now()) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
function gauss(rnd) {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── Strecke ──
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1].map((i) => 0.5 * ((2 * p1[i]) + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3));
}

export function baueStrecke(stuetzen = STUETZEN, je = 12) {
  const n = stuetzen.length;
  const mitte = [];
  for (let i = 0; i < n; i++) {
    const p0 = stuetzen[(i - 1 + n) % n], p1 = stuetzen[i], p2 = stuetzen[(i + 1) % n], p3 = stuetzen[(i + 2) % n];
    for (let k = 0; k < je; k++) mitte.push(catmull(p0, p1, p2, p3, k / je));
  }
  // Raster: je Zelle „Strasse ja/nein" und der naechste Punkt der Mittellinie
  // — einmal gerechnet, danach ist jede Abfrage ein Nachschlagen.
  const sx = Math.ceil(BREITE / ZELLE), sy = Math.ceil(HOEHE / ZELLE);
  const strasse = new Uint8Array(sx * sy);
  const naechster = new Int16Array(sx * sy);
  for (let gy = 0; gy < sy; gy++) for (let gx = 0; gx < sx; gx++) {
    const x = gx * ZELLE + ZELLE / 2, y = gy * ZELLE + ZELLE / 2;
    let best = Infinity, bi = 0;
    for (let i = 0; i < mitte.length; i++) {
      const d = (mitte[i][0] - x) ** 2 + (mitte[i][1] - y) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    strasse[gy * sx + gx] = best <= (SPUR / 2) ** 2 ? 1 : 0;
    naechster[gy * sx + gx] = bi;
  }
  const zelle = (x, y) => {
    const gx = Math.floor(x / ZELLE), gy = Math.floor(y / ZELLE);
    return gx < 0 || gy < 0 || gx >= sx || gy >= sy ? -1 : gy * sx + gx;
  };
  const [a, b] = [mitte[0], mitte[1]];
  return {
    mitte,
    n: mitte.length,
    aufStrasse: (x, y) => { const z = zelle(x, y); return z >= 0 && strasse[z] === 1; },
    index: (x, y) => { const z = zelle(x, y); return z >= 0 ? naechster[z] : 0; },
    start: { x: a[0], y: a[1], winkel: Math.atan2(b[1] - a[1], b[0] - a[0]) },
  };
}

// ── Auto ──
export const PHYSIK = { gas: 320, bremse: 520, max: 330, reibung: 1.4, lenk: 3.2, wiese: 90 };

export function neuesAuto(strecke) {
  const s = strecke.start;
  return { x: s.x, y: s.y, w: s.winkel, v: 0, lebt: true, idx: 0, weg: 0, runden: 0,
    t: 0, rundeSeit: 0, runden_zeiten: [], stillSeit: 0, bestWeg: 0 };
}

// Ein Schritt: lenk und gas je in [-1, 1]. `toetlich`: abseits der Strasse
// endet die Fahrt (KI) — sonst bremst die Wiese (Mensch).
export function fahre(auto, strecke, lenk, gas, toetlich) {
  if (!auto.lebt) return;
  const P = PHYSIK;
  if (gas >= 0) auto.v += gas * P.gas * DT; else auto.v += gas * (auto.v > 0 ? P.bremse : P.gas * 0.5) * DT;
  auto.v -= auto.v * P.reibung * DT;
  const auf = strecke.aufStrasse(auto.x, auto.y);
  const max = auf ? P.max : P.wiese;
  auto.v = Math.max(-max * 0.4, Math.min(max, auto.v));
  // Gelenkt wird mit der Fahrt: im Stand dreht sich kein Auto.
  const griff = Math.min(1, Math.abs(auto.v) / 90) * Math.sign(auto.v || 1);
  auto.w += Math.max(-1, Math.min(1, lenk)) * P.lenk * griff * DT;
  auto.x += Math.cos(auto.w) * auto.v * DT;
  auto.y += Math.sin(auto.w) * auto.v * DT;
  auto.t += DT;
  // Fortschritt entlang der Mittellinie, ueber den Rundenwechsel hinweg.
  const i = strecke.index(auto.x, auto.y);
  let d = i - auto.idx;
  if (d > strecke.n / 2) d -= strecke.n;
  if (d < -strecke.n / 2) d += strecke.n;
  auto.idx = i;
  auto.weg += d;
  // Runde: wer die ganze Strecke VORWAERTS geschafft hat (nicht: wer ueber die
  // Linie zurueck und wieder vor faehrt).
  if (auto.weg >= (auto.runden + 1) * strecke.n) {
    auto.runden_zeiten.push(auto.t - auto.rundeSeit);
    auto.rundeSeit = auto.t;
    auto.runden += 1;
  }
  if (auto.weg > auto.bestWeg + 0.5) { auto.bestWeg = auto.weg; auto.stillSeit = auto.t; }
  if (toetlich && (!strecke.aufStrasse(auto.x, auto.y) || auto.t - auto.stillSeit > 3 || auto.weg < -5)) auto.lebt = false;
}

// ── Sensoren: fuenf Strahlen nach vorn, wie weit bis zur Wiese ──
export const STRAHLEN = [-1.05, -0.5, 0, 0.5, 1.05];
export const STRAHL_MAX = 220;
export function sensoren(auto, strecke) {
  return STRAHLEN.map((a) => {
    const w = auto.w + a, c = Math.cos(w), s = Math.sin(w);
    let d = 0;
    while (d < STRAHL_MAX && strecke.aufStrasse(auto.x + c * d, auto.y + s * d)) d += 4;
    return d / STRAHL_MAX;
  });
}

// ── Gehirn: 6 Eingaenge (5 Strahlen + Tempo) → 8 versteckt → 2 (lenken, gas) ──
export const NETZ = { ein: STRAHLEN.length + 1, mitte: 8, aus: 2 };
export const GENE = NETZ.ein * NETZ.mitte + NETZ.mitte + NETZ.mitte * NETZ.aus + NETZ.aus;

export function zufallsGehirn(rnd = Math.random) {
  return Float32Array.from({ length: GENE }, () => rnd() * 2 - 1);
}

// Das Netz rechnen — mit allen Zwischenwerten, damit man es zeigen kann.
export function denkeInnen(gehirn, eingaben) {
  const { ein, mitte, aus } = NETZ;
  const h = new Array(mitte);
  for (let j = 0; j < mitte; j++) {
    let s = 0;
    for (let i = 0; i < ein; i++) s += gehirn[j * ein + i] * eingaben[i];
    h[j] = Math.tanh(s + gehirn[ein * mitte + j]);
  }
  const o = ein * mitte + mitte;
  const out = [];
  for (let k = 0; k < aus; k++) {
    let s = 0;
    for (let j = 0; j < mitte; j++) s += gehirn[o + k * mitte + j] * h[j];
    out.push(Math.tanh(s + gehirn[o + mitte * aus + k]));
  }
  return { ein: eingaben, mitte: h, aus: out };
}

// Gewicht von Eingang i zu Mittelknoten j bzw. von Mittelknoten j zu Ausgang k.
export const gewichtEin = (g, i, j) => g[j * NETZ.ein + i];
export const gewichtAus = (g, j, k) => g[NETZ.ein * NETZ.mitte + NETZ.mitte + k * NETZ.mitte + j];

export function denke(gehirn, eingaben) {
  return denkeInnen(gehirn, eingaben).aus;   // [lenken, gas]
}

export function kiSchritt(auto, gehirn, strecke) {
  const e = [...sensoren(auto, strecke), auto.v / PHYSIK.max];
  const [lenk, gas] = denke(gehirn, e);
  fahre(auto, strecke, lenk, gas, true);
}

// Mutation: jedes Gewicht mit Wahrscheinlichkeit `rate` um einen normal-
// verteilten Betrag verschoben. Das ist der ganze „Lernschritt".
export function mutiere(gehirn, rate, rnd = Math.random, staerke = 0.5) {
  const neu = Float32Array.from(gehirn);
  for (let i = 0; i < neu.length; i++) if (rnd() < rate) neu[i] += gauss(rnd) * staerke;
  return neu;
}

// Fitness: das Ziel ist die SCHNELLSTE RUNDE, nicht moeglichst viele. Wer eine
// Runde geschafft hat, wird nur nach ihrer Zeit gewertet — und steht immer
// vor jedem, der keine geschafft hat (der Sockel 1000 liegt ueber jedem Weg
// einer unvollendeten Runde). Ohne Runde zaehlt der Weg: sonst gaebe es am
// Anfang nichts, woran die Auswahl ansetzen koennte.
export function fitness(auto) {
  const zeit = auto.runden_zeiten.length ? auto.runden_zeiten[0] : null;
  return zeit ? 1000 + 10000 / zeit : auto.weg;
}

// Naechste Generation: die zwei Besten unveraendert (sonst kann das Beste
// verloren gehen), der Rest Nachkommen der oberen Haelfte, mutiert.
export function naechsteGeneration(gehirne, punkte, rate, rnd = Math.random) {
  const rang = gehirne.map((g, i) => [g, punkte[i]]).sort((a, b) => b[1] - a[1]).map(([g]) => g);
  const oben = Math.max(1, Math.floor(rang.length / 2));
  const neu = [rang[0], rang[1] || rang[0]];
  while (neu.length < gehirne.length) {
    const eltern = rang[Math.floor(rnd() * rnd() * oben)];   // die Besseren oefter
    neu.push(mutiere(eltern, rate, rnd));
  }
  return neu;
}

export const ZEITGRENZE = 30;   // Sekunden Fahrzeit je Generation

// Eine Generation ohne Bild zu Ende fahren — fuer Tests und den Schnelllauf.
export function fahreGeneration(gehirne, strecke, grenze = ZEITGRENZE) {
  const autos = gehirne.map(() => neuesAuto(strecke));
  const schritte = Math.round(grenze / DT);
  for (let s = 0; s < schritte; s++) {
    let lebend = 0;
    for (let i = 0; i < autos.length; i++) {
      if (!autos[i].lebt) continue;
      kiSchritt(autos[i], gehirne[i], strecke);
      if (autos[i].runden >= 1) autos[i].lebt = false;   // eine Runde — fertig
      lebend += autos[i].lebt ? 1 : 0;
    }
    if (!lebend) break;
  }
  return autos;
}

export function zeitText(s) {
  if (s == null) return "–";
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r.toFixed(2).padStart(5, "0")}`;
}
