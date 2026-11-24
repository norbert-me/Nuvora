// Struktur-Teilen: neue Serverdaten uebernehmen, ohne unveraenderte Objekte auszutauschen.
//
// Nach jedem Speichern lud die Notenseite ALLES neu, und weil jedes Objekt dabei neu war,
// zeichnete sich die ganze Tabelle neu — auch die 29 Zeilen, in denen sich nichts geaendert
// hatte. Hier behaelt ein Eintrag seine Identitaet, wenn sein Inhalt gleich geblieben ist;
// bleibt die ganze Liste gleich, bleibt auch die Liste dieselbe.
//
//   alt, neu — Listen von Objekten; idOf(objekt) — Schluessel zum Zuordnen.
export function teilen(alt, neu, idOf) {
  if (!Array.isArray(alt) || !Array.isArray(neu) || alt.length === 0) return neu;
  const nachId = new Map(alt.map((x) => [idOf(x), x]));
  let ganzGleich = alt.length === neu.length;
  const r = neu.map((n, i) => {
    const a = nachId.get(idOf(n));
    if (a !== undefined && (a === n || JSON.stringify(a) === JSON.stringify(n))) {
      if (alt[i] !== a) ganzGleich = false;
      return a;
    }
    ganzGleich = false;
    return n;
  });
  return ganzGleich ? alt : r;
}
