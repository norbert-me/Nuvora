// ─── Doppelte Fragen finden ──────────────────────────────────────────────────
//
// Wer ueber Jahre Fragen sammelt, importiert und kopiert, hat irgendwann
// dieselbe Frage mehrfach in der Sammlung. Sichtbar wird das erst im Block
// „Fragen ohne Quiz" — dort stehen die Zwillinge untereinander.
//
// Die Regel steht bewusst hier und nicht in der Seite: sie ist die einzige
// Stelle, an der entschieden wird, was „gleich" heisst, und sie ist damit
// pruefbar (`dubletten.test.js`).
//
// **Was zaehlt als gleich:** der Fragetext nach Normalisierung. Klein
// geschrieben, Leerraum zusammengezogen, aussen getrimmt — mehr nicht.
// Satzzeichen bleiben stehen: `3 · 2/7` und `3 · 2/9` sind zwei verschiedene
// Aufgaben, und wer den Bruchstrich wegnormalisiert, loescht die eine davon.
// LaTeX ist Teil des Textes und wird nicht ausgewertet.

/** Fragetext auf seine Vergleichsform bringen. Satzzeichen bleiben. */
export function normalisiereFragetext(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Signatur der Antwortmoeglichkeiten (inkl. richtiger Antwort).
 *
 * Bewusst reihenfolge-empfindlich: dieselben vier Antworten in anderer
 * Reihenfolge sind eine andere Frage — der Buchstabe der richtigen Antwort
 * steht auf der gedruckten Karte und im Scan.
 */
export function antwortSignatur(frage) {
  const wahl = frage?.choices || {};
  const teile = Object.keys(wahl).sort().map((k) => `${k}=${normalisiereFragetext(wahl[k])}`);
  return `${teile.join("|")}#${String(frage?.correct_answer ?? "").trim().toUpperCase()}`;
}

/** Steckt die Frage in mindestens einer Fragensammlung? */
export function istInSammlung(frage) {
  return (frage?.sammlungen?.length || 0) > 0;
}

/**
 * Rangfolge fuer „welche bleibt stehen?" — kleiner ist besser.
 *
 *   1. in einer Sammlung — sie ist im Unterricht in Gebrauch; loescht man sie,
 *      fehlt sie im Quiz.
 *   2. Thema gesetzt — sie ist eingeordnet; die Arbeit steckt schon drin.
 *   3. kleinste id — die aelteste, an ihr haengen die aeltesten Verweise.
 */
export function behaltenRang(frage) {
  return [istInSammlung(frage) ? 0 : 1, frage?.topic_id ? 0 : 1, frage?.id ?? 0];
}

function rangVergleich(a, b) {
  const ra = behaltenRang(a), rb = behaltenRang(b);
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
  return 0;
}

/**
 * Gruppen doppelter Fragen — nur Texte, die mindestens zweimal vorkommen.
 *
 * Rueckgabe je Gruppe:
 *   { schluessel, fragen: [...beste zuerst], behalten: <id der besten>,
 *     gleicheAntworten: true|false }
 *
 * `gleicheAntworten` trennt die beiden Faelle, die man nicht verwechseln darf:
 * gleicher Text + gleiche Antworten ist eine sichere Dublette, gleicher Text +
 * andere Antworten muss ein Mensch ansehen (zwei Varianten derselben Aufgabe).
 *
 * Die Liste darf **Partner** enthalten: Fragen, die in einer Sammlung stecken
 * und deshalb gar nicht zur Auswahl stehen. Sie sind da, damit sichtbar wird,
 * dass es die Waise „schon im Quiz X gibt". Eine Gruppe, in der NUR solche
 * stehen, ist keine Aufraeumarbeit und faellt raus.
 */
export function findeDubletten(fragen) {
  const nachText = new Map();
  for (const q of fragen || []) {
    const s = normalisiereFragetext(q?.text);
    if (!s) continue; // ohne Text gibt es nichts zu vergleichen
    if (!nachText.has(s)) nachText.set(s, []);
    nachText.get(s).push(q);
  }
  const gruppen = [];
  for (const [schluessel, liste] of nachText) {
    if (liste.length < 2) continue;
    if (liste.every(istInSammlung)) continue; // nichts aufzuraeumen
    const sortiert = [...liste].sort(rangVergleich);
    const erste = antwortSignatur(sortiert[0]);
    gruppen.push({
      schluessel,
      fragen: sortiert,
      behalten: sortiert[0].id,
      erst: Math.min(...sortiert.map((q) => q.id)),
      gleicheAntworten: sortiert.every((q) => antwortSignatur(q) === erste),
    });
  }
  // Reihenfolge der Gruppen = Reihenfolge des ersten Auftretens. So steht das,
  // was oben in der Liste stand, auch hier oben.
  return gruppen.sort((a, b) => a.erst - b.erst);
}

/** Wie viele Gruppen, wie viele Fragen stecken darin? */
export function dublettenZahlen(gruppen) {
  return { gruppen: gruppen.length, fragen: gruppen.reduce((n, g) => n + g.fragen.length, 0) };
}
