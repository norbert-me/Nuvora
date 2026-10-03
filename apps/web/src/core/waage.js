// Äquivalenzumformungen an der Waage — der Rechenkern, ohne Oberfläche.
// Spiegel von apps/api/app/waage.py (der Server prüft damit die Abgaben);
// wer hier eine Regel ändert, ändert sie dort mit.
//
// Eine Gleichung a·x + b = c·x + d ist eine Waage: links a Päckchen „x" und b
// Gewichte zu 1, rechts c Päckchen und d Gewichte. Daraus folgen die Grenzen
// des Modells, und sie sind Absicht:
//   • nur natürliche Zahlen — ein negatives Gewicht gibt es auf keiner Waage;
//   • die Lösung ist eine positive ganze Zahl — ein Päckchen wiegt so viel wie
//     eine Anzahl Gewichte, sonst lässt es sich nicht „ablesen“;
//   • abziehen geht nur, was auf BEIDEN Seiten liegt — man kann nichts
//     herunternehmen, was nicht da ist;
//   • teilen geht nur, wenn sich jede Sorte gleichmäßig aufteilen lässt.
//
// Ein Stand ist { l: { x, e }, r: { x, e } } (x = Päckchen, e = Einer).

export const MAX_ZAHL = 60;          // mehr passt auf keine Waagschale
export const MAX_SCHRITTE = 60;

const nat = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_ZAHL * 20;

export const stand = (a, b, c, d) => ({ l: { x: a, e: b }, r: { x: c, e: d } });
export const kopie = (s) => ({ l: { ...s.l }, r: { ...s.r } });
export const gleich = (s, t) => s.l.x === t.l.x && s.l.e === t.l.e && s.r.x === t.r.x && s.r.e === t.r.e;

// Lösung der Gleichung, oder null, wenn sie nicht auf die Waage passt.
export function loesung(s) {
  const dx = s.l.x - s.r.x;
  const de = s.r.e - s.l.e;
  if (dx === 0) return null;
  const x = de / dx;
  return Number.isInteger(x) && x > 0 ? x : null;
}

// Warum eine Gleichung (nicht) auf die Waage passt — für Eingabe und Server.
export function pruefeGleichung(s) {
  for (const v of [s.l.x, s.l.e, s.r.x, s.r.e]) {
    if (!Number.isInteger(v) || v < 0) return "ganzzahl";
    if (v > MAX_ZAHL) return "zuGross";
  }
  if (s.l.x === 0 && s.r.x === 0) return "keinX";
  if (loesung(s) == null) return "keineLoesung";
  return null;
}

export const gewicht = (seite, x) => seite.x * x + seite.e;
// −1: links schwerer, 1: rechts schwerer, 0: im Gleichgewicht.
export function neigung(s, x) {
  const d = gewicht(s.r, x) - gewicht(s.l, x);
  return d === 0 ? 0 : d > 0 ? 1 : -1;
}

// Ist die Gleichung gelöst? Eine Seite genau ein Päckchen, die andere nur
// Gewichte — dann steht „x = …“ auf der Waage.
export function geloest(s) {
  return (s.l.x === 1 && s.l.e === 0 && s.r.x === 0) || (s.r.x === 1 && s.r.e === 0 && s.l.x === 0);
}

// Eine Umformung auf BEIDEN Seiten. art: "-e" | "+e" | "-x" | "+x" | ":" | "*".
// Rückgabe { stand } oder { fehler } — der Fehler ist ein Schlüssel, die
// Oberfläche macht einen Satz daraus.
export function umformen(s, art, n) {
  if (!Number.isInteger(n) || n < 1 || n > MAX_ZAHL) return { fehler: "zahl" };
  const t = kopie(s);
  if (art === "-e" || art === "+e" || art === "-x" || art === "+x") {
    const k = art[1];
    const plus = art[0] === "+";
    if (!plus && (t.l[k] < n || t.r[k] < n)) return { fehler: k === "x" ? "zuWenigX" : "zuWenigE" };
    t.l[k] += plus ? n : -n;
    t.r[k] += plus ? n : -n;
  } else if (art === ":") {
    if (n < 2) return { fehler: "zahl" };
    if ([t.l.x, t.l.e, t.r.x, t.r.e].some((v) => v % n)) return { fehler: "teilen" };
    t.l.x /= n; t.l.e /= n; t.r.x /= n; t.r.e /= n;
  } else if (art === "*") {
    if (n < 2) return { fehler: "zahl" };
    t.l.x *= n; t.l.e *= n; t.r.x *= n; t.r.e *= n;
    if ([t.l.x, t.l.e, t.r.x, t.r.e].some((v) => v > MAX_ZAHL * 4)) return { fehler: "zuGross" };
  } else {
    return { fehler: "art" };
  }
  return { stand: t };
}

// Aus zwei ausgeglichenen Ständen die Umformung ablesen (für das Wegnehmen
// einzelner Teile von Hand): gleiche Änderung auf beiden Seiten → "−2", sonst
// eine Umformung, die nur mit dem Wissen um x stimmt — die Waage bleibt im
// Gleichgewicht, aber es war keine Äquivalenzumformung „auf beiden Seiten
// dasselbe“. Rückgabe { art, n } bzw. { art: "frei" }.
export function ablesen(vorher, nachher) {
  const dlx = nachher.l.x - vorher.l.x, dle = nachher.l.e - vorher.l.e;
  const drx = nachher.r.x - vorher.r.x, dre = nachher.r.e - vorher.r.e;
  if (dlx === drx && dle === dre) {
    if (dlx === 0 && dle !== 0) return { art: dle > 0 ? "+e" : "-e", n: Math.abs(dle) };
    if (dle === 0 && dlx !== 0) return { art: dlx > 0 ? "+x" : "-x", n: Math.abs(dlx) };
  }
  return { art: "frei" };
}

// „3x + 2“ — Einer und Päckchen als Term. Leere Seite heißt 0.
export function term(seite) {
  const teile = [];
  if (seite.x) teile.push(seite.x === 1 ? "x" : `${seite.x}x`);
  if (seite.e || !teile.length) teile.push(String(seite.e));
  return teile.join(" + ");
}
export const gleichungText = (s) => `${term(s.l)} = ${term(s.r)}`;

// Probe: x eingesetzt — „3 · 4 + 2 = 14“, beide Seiten ausgerechnet dahinter.
export function probeText(s, x) {
  const seite = (z) => {
    const teile = [];
    if (z.x) teile.push(z.x === 1 ? String(x) : `${z.x} · ${x}`);
    if (z.e || !teile.length) teile.push(String(z.e));
    return teile.join(" + ");
  };
  return `${seite(s.l)} = ${seite(s.r)}  →  ${s.l.x * x + s.l.e} = ${s.r.x * x + s.r.e}`;
}

export function opText(art, n) {
  if (art === "-e") return `| − ${n}`;
  if (art === "+e") return `| + ${n}`;
  if (art === "-x") return `| − ${n === 1 ? "" : n}x`;
  if (art === "+x") return `| + ${n === 1 ? "" : n}x`;
  if (art === ":") return `| : ${n}`;
  if (art === "*") return `| · ${n}`;
  return "";
}

// Ein Lösungsweg: Start und eine Folge von Ständen. Gültig heißt: jeder Stand
// ist natürlichzahlig und hat dieselbe Lösung wie der Start (die Waage war
// nach jedem Schritt im Gleichgewicht). Der Server rechnet genau das nach,
// statt dem Browser zu glauben.
export function pruefeWeg(start, staende) {
  const x = loesung(start);
  if (x == null) return { gueltig: false, geloest: false };
  if (!Array.isArray(staende) || staende.length > MAX_SCHRITTE) return { gueltig: false, geloest: false };
  for (const s of staende) {
    if (!s || !s.l || !s.r || ![s.l.x, s.l.e, s.r.x, s.r.e].every(nat)) return { gueltig: false, geloest: false };
    if (neigung(s, x) !== 0) return { gueltig: false, geloest: false };
  }
  const letzter = staende.length ? staende[staende.length - 1] : start;
  return { gueltig: true, geloest: geloest(letzter) };
}

// Zufällige Gleichung je Stufe — für das freie Arbeiten.
//   1: x + b = d     2: a·x = d     3: a·x + b = d     4: a·x + b = c·x + d
export function zufall(stufe, rnd = Math.random) {
  const z = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const x = z(1, stufe <= 2 ? 9 : 6);
  if (stufe === 1) { const b = z(1, 12); return stand(1, b, 0, x + b); }
  if (stufe === 2) { const a = z(2, 6); return stand(a, 0, 0, a * x); }
  if (stufe === 3) { const a = z(2, 5), b = z(1, 10); return stand(a, b, 0, a * x + b); }
  // Stufe 4: x auf beiden Seiten, Unterschied der Päckchen mindestens 1.
  // Links mehr Päckchen als rechts, dann rechnet sich d aus; Zahlen bleiben
  // klein (a ≤ 6, x ≤ 6, b ≤ 8 → d ≤ 26).
  const c = z(1, 3), a = c + z(1, 3), b = z(0, 8);
  return stand(a, b, c, (a - c) * x + b);
}
