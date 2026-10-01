// Wertung einer Klassenarbeit je Kind — Spiegel von apps/api/app/arbeitswertung.py.
// Die Seite rechnet beim Tippen live, Notenverlauf und Vergleich am Server;
// wer hier etwas ändert, ändert es dort mit.
//
// Wahlaufgaben: eine Aufgabe kann eine E-Fassung haben (`task.e`, eigene
// Teilaufgaben, Punkte, Themen). Welche Fassung ein Kind schrieb, steht in
// `work.e_wahl` ({sid: [taskId, …]}, nur E — fehlt die Angabe, gilt G).
// Basis ist die G-Punktzahl; was eine E-Fassung darüber hinaus bringt, ist
// Bonus, höchstens eine Notenstufe (wie beim E-Bonus im Quiz).
import { naechsteStufe } from "./scoring.js";

const maxVon = (x) => (Number(x) > 0 ? Number(x) : 1);

// Wertungseinheiten einer Fassung: [{ id, max, topic, label }]. Teilaufgaben,
// wenn es welche gibt, sonst die Fassung selbst. Thema: Teilaufgabe vor
// Fassung vor Aufgabe (`erbe`).
export function einheiten(teil, erbe = null) {
  if (!teil) return [];
  const eigen = teil.topic_id || erbe || null;
  if (Array.isArray(teil.parts) && teil.parts.length) {
    return teil.parts.filter((p) => p && p.id).map((p) => ({ id: String(p.id), max: maxVon(p.max), topic: p.topic_id || eigen, label: p.label || "" }));
  }
  return teil.id ? [{ id: String(teil.id), max: maxVon(teil.max), topic: eigen, label: "" }] : [];
}

export const eFassung = (task) => (task && task.e && task.e.id ? task.e : null);
export const gEinheiten = (task) => einheiten(task);
export const eEinheiten = (task) => (eFassung(task) ? einheiten(task.e, task.topic_id) : []);
export const alleEinheiten = (task) => [...gEinheiten(task), ...eEinheiten(task)];
export const gMax = (task) => gEinheiten(task).reduce((n, u) => n + u.max, 0);
export const basis = (tasks) => (tasks || []).reduce((n, t) => n + gMax(t), 0);

export function fassung(work, sid, task) {
  if (!eFassung(task)) return "G";
  const wahl = ((work && work.e_wahl) || {})[String(sid)];
  return Array.isArray(wahl) && wahl.map(String).includes(String(task.id)) ? "E" : "G";
}

export const einheitenFuer = (work, sid, task) => (fassung(work, sid, task) === "E" ? eEinheiten(task) : gEinheiten(task));

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
    const gm = gMax(t);
    erreicht += e;
    inBasis += Math.min(e, gm);
    ueber += Math.max(0, e - gm);
  });
  if (!gesamt) return { erreicht, basis: 0, basePct: 0, bonusPct: 0, pct: 0 };
  const basePct = (inBasis / gesamt) * 100;
  const bonusPct = ueber ? Math.min((ueber / gesamt) * 100, naechsteStufe(basePct, scale)) : 0;
  return { erreicht, basis: gesamt, basePct, bonusPct, pct: Math.min(100, basePct + bonusPct) };
}
