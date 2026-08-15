// Schuljahre vergleichen — „2025/26" ist Text, kein Datum.
//
// Gebraucht wird das an genau einer Stelle mit Folgen: der Auswahl „Vorjahr"
// bei einem Kurs. Dort dürfen nur FRÜHERE Jahrgänge stehen; ein Kurs aus
// demselben Schuljahr ist nie das Vorjahr, und wer ihn versehentlich wählt,
// baut eine Kette, die nichts bedeutet.

/** Startjahr einer Angabe: „2025/26" → 2025, „2025-2026" → 2025. Sonst null. */
export function startjahr(schuljahr) {
  const m = String(schuljahr || "").match(/(20\d{2})/);
  return m ? Number(m[1]) : null;
}

/**
 * Kommt `kandidat` vor `bezug`?
 *
 * Ohne Angabe am Bezug lässt sich nichts ausschließen — dann gilt jeder Kurs
 * als möglich (sonst stünde beim ersten Anlegen eine leere Liste da). Ohne
 * Angabe am Kandidaten ebenso: Bestandskurse tragen kein Jahr im Namen, und
 * sie zu verstecken hieße, sie gar nicht verknüpfen zu können.
 */
export function liegtDavor(kandidat, bezug) {
  const a = startjahr(kandidat);
  const b = startjahr(bezug);
  if (a === null || b === null) return true;
  return a < b;
}

/** Neueste zuerst — das direkt vorangehende Jahr steht damit oben. */
export function nachJahrAbsteigend(a, b) {
  return (startjahr(b) ?? -1) - (startjahr(a) ?? -1);
}
