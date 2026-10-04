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

// Weitere Strecken — von leicht (Oval) bis kurvig (Schikane, Haarnadel). Jede
// muss Abstand halten: liegen zwei Stellen der Strasse naeher als eine
// Spurbreite plus Rand, springt der Fortschritt zwischen ihnen, und eine KI
// lernte die Abkuerzung statt der Strecke (Test in rennen.test.js).
export const STRECKEN = {
  rundkurs: STUETZEN,
  oval: [[200, 300], [230, 165], [450, 115], [670, 165], [700, 300], [670, 435], [450, 485], [230, 435]],
  schikane: [[110, 320], [120, 140], [250, 80], [360, 110], [430, 250], [500, 110], [620, 80], [760, 110], [810, 260],
    [700, 340], [800, 440], [720, 530], [560, 520], [470, 420], [380, 520], [200, 520]],
  haarnadel: [[120, 450], [110, 160], [220, 80], [330, 150], [340, 360], [420, 420], [500, 360], [510, 150], [620, 80],
    [760, 120], [800, 300], [740, 500], [560, 540], [300, 540]],
};
const gebaut = {};
// Eine Strecke nach Namen — einmal gebaut, danach aus dem Zwischenspeicher
// (das Raster kostet einen Augenblick).
export function strecke(name) {
  const key = STRECKEN[name] ? name : "rundkurs";
  if (!gebaut[key]) gebaut[key] = baueStrecke(STRECKEN[key]);
  return gebaut[key];
}

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
  // Bei hohem Tempo lenkt das Auto etwas weniger scharf (ein Auto mit 300
  // km/h dreht nicht auf der Stelle) — Geraden werden ruhiger, und wer in die
  // Kurve will, muss vorher bremsen. Gilt fuer Mensch und KI gleich.
  const tempoAnteil = Math.min(1, Math.abs(auto.v) / P.max);
  const griff = Math.min(1, Math.abs(auto.v) / 90) * (1 - 0.35 * tempoAnteil) * Math.sign(auto.v || 1);
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

// ── Gehirn: ein neuronales Netz mit einstellbaren Schichten ──
// Eingaenge: fuenf Strahlen + Tempo. Ausgaenge: Lenken, Gas. Dazwischen
// beliebig viele versteckte Schichten mit je gleich vielen Neuronen — wie
// viele, ist eine Lernfrage: mehr Neuronen koennen mehr, brauchen aber auch
// mehr Generationen, bis sie es koennen.
// Ein Gehirn ist { form: [6, …, 2], w: Float32Array }: je Schicht erst die
// Gewichte (Zeile = Zielknoten), dann die Verschiebungen (Bias).
export const EIN = STRAHLEN.length + 1, AUS = 2;
export const netzForm = (schichten = 1, neuronen = 8) => [EIN, ...Array(Math.max(0, schichten)).fill(neuronen), AUS];
export const genAnzahl = (form) => form.slice(1).reduce((n, b, l) => n + b * form[l] + b, 0);
export const gleicheForm = (a, b) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

export function zufallsGehirn(rnd = Math.random, form = netzForm()) {
  return { form: [...form], w: Float32Array.from({ length: genAnzahl(form) }, () => rnd() * 2 - 1) };
}

// Wo die Gewichte der Schicht l beginnen.
function versatz(form, l) {
  let o = 0;
  for (let k = 0; k < l; k++) o += form[k + 1] * form[k] + form[k + 1];
  return o;
}
// Gewicht von Knoten i (Schicht l) zu Knoten j (Schicht l + 1).
export const gewicht = (g, l, i, j) => g.w[versatz(g.form, l) + j * g.form[l] + i];

// Das Netz rechnen — mit allen Zwischenwerten, damit man es zeigen kann.
export function denkeInnen(gehirn, eingaben) {
  const { form, w } = gehirn;
  const schichten = [eingaben];
  let a = eingaben, o = 0;
  for (let l = 0; l < form.length - 1; l++) {
    const n = form[l], m = form[l + 1];
    const b = new Array(m);
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += w[o + j * n + i] * a[i];
      b[j] = Math.tanh(s + w[o + m * n + j]);
    }
    o += m * n + m;
    schichten.push(b);
    a = b;
  }
  return { schichten, ein: eingaben, aus: a };
}

export function denke(gehirn, eingaben) {
  return denkeInnen(gehirn, eingaben).aus;   // [lenken, gas]
}

export function kiSchritt(auto, gehirn, strecke) {
  const e = [...sensoren(auto, strecke), auto.v / PHYSIK.max];
  const [lenk, gas] = denke(gehirn, e);
  fahre(auto, strecke, lenk, gas, true);
}

// Mutation: JEDES Gewicht wackelt ein wenig — normalverteilt, die Staerke
// sagt der Regler (1 % ein Hauch, 50 % ein kraeftiger Stoss). Das ist der
// ganze „Lernschritt". Frueher hiess der Regler „wie viele Gewichte aendern
// sich", und jede Aenderung war gross: selbst bei 1 % fuhr dann gut die
// Haelfte der Kopien einer guten KI in die Wand, und „wenig Mutation" sah aus
// wie ein Fehler. Gemessen (Rundkurs, Weiterlernen von einer guten KI): mit
// 1 % schaffen jetzt 83–100 % eine Runde, mit 50 % rund 15 %.
export const MUTATION_SKALA = 2;
export function mutiere(gehirn, rate, rnd = Math.random) {
  const s = rate * MUTATION_SKALA;
  return { form: gehirn.form, w: Float32Array.from(gehirn.w, (w) => w + gauss(rnd) * s) };
}

// Speichern und Laden. Aeltere Speicherstaende sind ein blankes Zahlenfeld
// des alten Netzes 6 → 8 → 2.
export const gehirnZuJson = (g) => ({ form: g.form, w: Array.from(g.w) });
export function gehirnAusJson(x) {
  if (Array.isArray(x)) return { form: netzForm(1, 8), w: Float32Array.from(x) };
  if (x && Array.isArray(x.form) && Array.isArray(x.w) && x.w.length === genAnzahl(x.form)) return { form: x.form, w: Float32Array.from(x.w) };
  return null;
}

// Fitness: der WEG in der Fahrzeit. Jedes Auto faehrt, bis die Zeit um ist
// oder es verunglueckt — wer am weitesten kommt, faehrt im Schnitt die
// schnellsten Runden. So zaehlt Bestaendigkeit: eine einzelne schnelle Runde
// mit Unfall danach bringt weniger als drei saubere. (Zuerst war ein Auto
// nach einer Runde fertig — dann gewann die Glueckrunde, und die Generation
// endete lange vor der eingestellten Fahrzeit.)
export function fitness(auto) {
  return auto.weg;
}

// Durchschnittliche Rundenzeit eines Autos — oder null ohne volle Runde.
export function rundenSchnitt(auto) {
  const z = auto.runden_zeiten;
  return z.length ? z.reduce((x, y) => x + y, 0) / z.length : null;
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

// ── Experiment: dieselbe Evolution ohne Bild, Generation fuer Generation ──
// Fuer den Vergleich von Einstellungen: jeder Lauf beginnt bei null (zufaellige
// Gehirne aus seinem Startwert), damit nichts Gelerntes den Vergleich
// verfaelscht. Liefert je Aufruf von `weiter()` die Werte EINER Generation —
// die Seite ruft es in kleinen Haeppchen, damit sie dabei bedienbar bleibt.
export function experimentLauf({ rate, anzahl, grenze, seed, strecke: st, schichten = 1, neuronen = 8 }) {
  const rnd = zufallsquelle(seed);
  const form = netzForm(schichten, neuronen);
  let gehirne = Array.from({ length: anzahl }, () => zufallsGehirn(rnd, form));
  return {
    weiter() {
      const autos = fahreGeneration(gehirne, st, grenze);
      const punkte = autos.map(fitness);
      let bi = 0;
      punkte.forEach((p, i) => { if (p > punkte[bi]) bi = i; });
      gehirne = naechsteGeneration(gehirne, punkte, rate, rnd);
      return {
        // Rechenaufwand: wie viele Sekunden alle Autos zusammen gefahren sind —
        // jedes simulierte Auto kostet Rechenzeit, auch wenn es auf dem
        // Bildschirm „gleichzeitig" faehrt.
        aufwand: autos.reduce((x, a) => x + a.t, 0),
        // Der Rundenschnitt des BESTEN Autos dieser Generation.
        beste: rundenSchnitt(autos[bi]),
        runden: autos[bi].runden,
        anteil: autos.filter((a) => a.runden > 0).length / autos.length,
      };
    },
  };
}

// Auswertung eines Laufs: in welcher Generation die erste Runde gelang (1-
// basiert, null = nie) und die Bestzeit am Ende.
export function laufBilanz(reihe) {
  const i = reihe.findIndex((g) => g.beste != null);
  const zeiten = reihe.map((g) => g.beste).filter((z) => z != null);
  return { ersteRunde: i < 0 ? null : i + 1, bestzeit: zeiten.length ? Math.min(...zeiten) : null, anteilEnde: reihe.length ? reihe[reihe.length - 1].anteil : 0 };
}
