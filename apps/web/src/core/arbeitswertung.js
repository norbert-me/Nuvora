// Wertung einer Klassenarbeit je Kind — Spiegel von apps/api/app/arbeitswertung.py.
// Die Seite rechnet beim Tippen live, Notenverlauf und Vergleich am Server;
// wer hier etwas ändert, ändert es dort mit.
//
// Wahlaufgaben: eine E/G-Arbeit hat zwei Blätter (partner_id). Ein Kind darf je
// Aufgabe die Fassung des ANDEREN Blatts schreiben — gleiche Position dort.
// Welche, steht in `work.wechsel` ({sid: [taskId, …]}); die Punkte liegen im
// eigenen Blatt unter den Einheiten des anderen mit Vorsatz "~". Das andere
// Blatt wird zum Rechnen angehängt (`work._alt` = seine Aufgaben).
// Basis ist die eigene Fassung; was die andere darüber hinaus bringt, ist Bonus,
// höchstens eine Notenstufe (wie beim E-Bonus im Quiz).
import { naechsteStufe } from "./scoring.js";

export const ANDERE = "~";
const maxVon = (x) => (Number(x) > 0 ? Number(x) : 1);

// Wertungseinheiten einer Aufgabe: [{ id, max, topic, label }]. Teilaufgaben,
// wenn es welche gibt, sonst die Aufgabe selbst.
export function einheiten(teil, vorsatz = "") {
  if (!teil) return [];
  const erbe = teil.topic_id || null;
  if (Array.isArray(teil.parts) && teil.parts.length) {
    return teil.parts.filter((p) => p && p.id).map((p) => ({ id: vorsatz + String(p.id), max: maxVon(p.max), topic: p.topic_id || erbe, label: p.label || "" }));
  }
  return teil.id ? [{ id: vorsatz + String(teil.id), max: maxVon(teil.max), topic: erbe, label: "" }] : [];
}

// Gezählt wird nur unter den SACHaufgaben: die Darstellung (`form`) hat keine
// E- oder G-Fassung, und steht sie in den Blättern an verschiedenen Stellen,
// verschiebt sie die Zuordnung trotzdem nicht.
export function andereFassung(work, task) {
  if (!task || task.form) return null;
  const sach = ((work && work.tasks) || []).filter((t) => t && !t.form);
  const alt = ((work && work._alt) || []).filter((t) => t && !t.form);
  const i = sach.findIndex((t) => t === task || t.id === task.id);
  return i >= 0 && i < alt.length ? alt[i] : null;
}
export const eigeneEinheiten = (task) => einheiten(task);
export const andereEinheiten = (work, task) => { const a = andereFassung(work, task); return a ? einheiten(a, ANDERE) : []; };
export const alleEinheiten = (work, task) => [...eigeneEinheiten(task), ...andereEinheiten(work, task)];
export const eigeneMax = (task) => eigeneEinheiten(task).reduce((n, u) => n + u.max, 0);
export const basis = (tasks) => (tasks || []).reduce((n, t) => n + eigeneMax(t), 0);

export function gewechselt(work, sid, task) {
  const liste = ((work && work.wechsel) || {})[String(sid)];
  return Array.isArray(liste) && liste.map(String).includes(String(task.id)) && !!andereFassung(work, task);
}

export const einheitenFuer = (work, sid, task) => (gewechselt(work, sid, task) ? andereEinheiten(work, task) : eigeneEinheiten(task));

export function punkte(eintrag, uid, umax) {
  if (Array.isArray(eintrag)) return eintrag.map(String).includes(uid) ? 0 : umax;   // Altformat
  if (!eintrag || eintrag === "abwesend") return 0;
  const v = eintrag[uid];
  return v == null || v === "" ? 0 : Number(v) || 0;
}

// Punkte eines Kindes in einer Aufgabe — in der Fassung, die es schrieb.
export const aufgabenPunkte = (work, sid, task) => {
  const r = ((work && work.results) || {})[String(sid)];
  return einheitenFuer(work, sid, task).reduce((n, u) => n + punkte(r, u.id, u.max), 0);
};

export function wertung(work, sid, scale) {
  const tasks = (work && work.tasks) || [];
  const gesamt = basis(tasks);
  let erreicht = 0, inBasis = 0, ueber = 0;
  tasks.forEach((t) => {
    const e = aufgabenPunkte(work, sid, t);
    const em = eigeneMax(t);
    erreicht += e;
    inBasis += Math.min(e, em);
    ueber += Math.max(0, e - em);
  });
  if (!gesamt) return { erreicht, basis: 0, basePct: 0, bonusPct: 0, pct: 0 };
  const basePct = (inBasis / gesamt) * 100;
  const bonusPct = ueber ? Math.min((ueber / gesamt) * 100, naechsteStufe(basePct, scale)) : 0;
  return { erreicht, basis: gesamt, basePct, bonusPct, pct: Math.min(100, basePct + bonusPct) };
}
