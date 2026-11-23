// Kurs-Info: Rechnungen ohne Oberfläche (getestet in kursinfo.test.js).

/**
 * Wiederholungsbedarf eines Kurses aus dem Themenprofil (`/api/classes/{id}/themenprofil`).
 *
 * Je Thema der Durchschnitt ueber die Kinder, bei denen es eine ZAHL gibt (`pct` ist null, solange zu wenig
 * Punkte da sind — „zu wenig fuer eine Aussage" zaehlt weder als gut noch als schlecht). Gemeldet wird, was im
 * Schnitt unter `schwelle` % liegt, die schwaechsten zuerst. Dazu, wie viele Kinder darunter liegen.
 *
 * `profile`: Liste der Antworten (eine je Klasse des Kurses).
 */
export function wiederholungsbedarf(profile, { schwelle = 60, max = 5, kindSchwelle = 50 } = {}) {
  const je = new Map();
  let kinderMitZahl = 0;
  for (const p of profile || []) {
    for (const kind of (p && p.schueler) || []) {
      let hatZahl = false;
      for (const th of kind.themen || []) {
        if (th.pct == null || th.topic_id == null) continue;
        hatZahl = true;
        const e = je.get(th.topic_id) || { topic_id: th.topic_id, name: th.name || "", summe: 0, n: 0, darunter: 0 };
        e.summe += th.pct; e.n += 1;
        if (th.pct < kindSchwelle) e.darunter += 1;
        if (!e.name && th.name) e.name = th.name;
        je.set(th.topic_id, e);
      }
      if (hatZahl) kinderMitZahl += 1;
    }
  }
  const alle = [...je.values()].map((e) => ({ ...e, pct: Math.round(e.summe / e.n) }));
  return {
    datenDa: alle.length > 0,
    kinderMitZahl,
    themen: alle.filter((e) => e.pct < schwelle).sort((a, b) => a.pct - b.pct || b.darunter - a.darunter).slice(0, max)
      .map(({ topic_id, name, pct, n, darunter }) => ({ topic_id, name, pct, n, darunter })),
  };
}

/** Notenschnitt aus der Summary eines Halbjahrs: Mittel der Gesamtnoten (ohne LE-Kinder und ohne Kinder ohne Note). */
export function kursSchnitt(summary) {
  const w = (summary || []).filter((s) => !s.le && s.weighted != null && Number.isFinite(Number(s.weighted))).map((s) => Number(s.weighted));
  return w.length ? { schnitt: w.reduce((a, b) => a + b, 0) / w.length, n: w.length } : null;
}
