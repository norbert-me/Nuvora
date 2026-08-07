// Bewertung einer CardVote-Session. Spiegel von apps/api/app/scoring.py —
// gleiche Regeln, weil die Auswertungsseite die Gewichte live beim Tippen neu
// rechnet, PDF und Notenbuch-Brücke aber am Server entstehen. Wer hier etwas
// ändert, ändert es dort mit.
//
// E/G: alle sehen dieselben Fragen. Für ein Kind im G-Kurs zählen nur G-Fragen
// als 100 %; richtige E-Fragen geben Bonus — erst ab zwei richtigen, höchstens
// eine Notenstufe. Falsche E-Antworten zehren nur den Bonus auf, nie die Basis.
// Für ein Kind im E-Kurs zählt alles regulär.
//
// Minuspunkte: falsche Antwort kostet ihr Gewicht, nie unter 0. Karte unten
// lassen = keine Antwort = 0 Punkte, kein Abzug.
import { DEFAULT_SCALE } from "./grades.js";

// Prozentpunkte bis zur nächstbesseren Notenstufe — der Deckel des Bonus.
export function naechsteStufe(pct, scale) {
  const s = scale || DEFAULT_SCALE;
  const hoeher = Object.values(s).map(Number).filter((v) => v > pct).sort((a, b) => a - b);
  return hoeher.length ? Math.max(0, hoeher[0] - pct) : Math.max(0, 100 - pct);
}

// "anwesend" | "krank". Ohne jede Antwort gilt krank — außer die Lehrkraft hat
// das Kind ausdrücklich auf anwesend gestellt, dann zählt seine 0 mit.
export function statusOf(cardId, hasAnyScan, config) {
  const cfg = config || {};
  const krank = new Set((cfg.krank || []).map(String));
  const anwesend = new Set((cfg.anwesend || []).map(String));
  const key = String(cardId);
  if (anwesend.has(key)) return "anwesend";
  if (krank.has(key)) return "krank";
  return hasAnyScan ? "anwesend" : "krank";
}

// questions: [{ id, correct_answer, niveau }] · answers: { [questionId]: "A" | null }
export function bewerte(questions, answers, { niveau = "", niveauAktiv = false, minuspunkte = false, weights = {}, scale = null } = {}) {
  const s = scale || DEFAULT_SCALE;
  const gewicht = (qid) => Number(weights[String(qid)] ?? weights[qid] ?? 1) || 0;
  const gegeben = (q) => answers[q.id] ?? answers[String(q.id)] ?? null;
  const richtig = (q) => { const a = gegeben(q); return !!(a && q.correct_answer && q.correct_answer.includes(a)); };

  const zaehlend = questions.filter((q) => q.correct_answer);
  const differenziert = !!niveauAktiv && niveau !== "E";
  const basis = zaehlend.filter((q) => !differenziert || (q.niveau || "") !== "E");
  const extra = differenziert ? zaehlend.filter((q) => (q.niveau || "") === "E") : [];

  const baseMax = basis.reduce((sum, q) => sum + gewicht(q.id), 0);
  let score = basis.reduce((sum, q) => sum + (richtig(q) ? gewicht(q.id) : 0), 0);
  if (minuspunkte) score -= basis.reduce((sum, q) => sum + (gegeben(q) && !richtig(q) ? gewicht(q.id) : 0), 0);
  score = Math.max(0, score);
  const basePct = baseMax > 0 ? (score / baseMax) * 100 : 0;

  const eRichtig = extra.filter(richtig).length;
  const eFalsch = extra.filter((q) => gegeben(q) && !richtig(q)).length;
  let bonusPct = 0;
  if (extra.length && eRichtig >= 2) {
    const netto = Math.max(0, eRichtig - eFalsch);
    bonusPct = (netto / extra.length) * naechsteStufe(basePct, s);
  }

  return {
    score: Math.round(score * 100) / 100,
    maxScore: Math.round(baseMax * 100) / 100,
    basePct: Math.round(basePct * 10) / 10,
    bonusPct: Math.round(bonusPct * 10) / 10,
    pct: Math.round(Math.min(100, basePct + bonusPct) * 10) / 10,
    eCorrect: eRichtig,
    eWrong: eFalsch,
    eTotal: extra.length,
  };
}
