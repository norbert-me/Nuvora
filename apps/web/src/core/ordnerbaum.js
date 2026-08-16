// Ein Ordnerbaum aus einer FLACHEN Liste mit `parent_id`.
//
// Zwei Seiten halten ihre Ordner so: die Einstiege (`Methoden.jsx`) und die
// Kartenstapel (`Karten.jsx`). Beide haben denselben Weg nach oben („wo bin
// ich?" für die Brotkrume) und dieselbe Zyklusprüfung („darf dieser Ordner da
// hinein?") einzeln gebaut — und dabei ist genau der Unterschied entstanden,
// den man erst bei kaputten Daten sieht: `Methoden` bricht nach 50 Schritten
// ab, `Karten` lief in einer Schleife für immer weiter und hätte bei einem
// Ordner, der sein eigener Vorfahre ist, den Tab eingefroren. Hier gibt es
// die Bremse einmal, für beide.
//
// NICHT hierher gehört der Fragenbaum aus `Dashboard.jsx`: der kommt vom
// Server bereits verschachtelt (`children`-Listen statt `parent_id`) und
// braucht kein Nachschlagen des Elternteils. Dieselbe Idee, andere Datenform —
// zusammengelegt würde eine der beiden Seiten ihre Daten für die andere
// umbauen müssen.
//
// `elternVon` ist überall auszutauschen, weil `Methoden.jsx` beim Ziehen den
// noch nicht gespeicherten ENTWURF liest, nicht den Serverstand — sonst
// springt ein gezogener Ordner beim Loslassen an seinen alten Platz zurück.
//
// Regressionstest: `ordnerbaum.test.js`.

/** Sicherheitsbremse gegen Zyklen in den Daten. Tiefer ist kein echter Baum. */
const MAX_TIEFE = 50;

const standardEltern = (f) => f?.parent_id ?? null;

/** Ordner mit dieser id aus der flachen Liste; `null`, wenn es ihn nicht gibt. */
export const ordnerMitId = (ordner, id) =>
  (id == null ? null : ordner.find((f) => f.id === id) || null);

/**
 * Weg von der Wurzel bis zu diesem Ordner (einschließlich) — die Brotkrume.
 * Für die Wurzel selbst (`id == null`) eine leere Liste.
 */
export function pfadZu(ordner, id, elternVon = standardEltern) {
  const weg = [];
  let cur = ordnerMitId(ordner, id);
  for (let i = 0; cur && i < MAX_TIEFE; i++) {
    weg.unshift(cur);
    cur = ordnerMitId(ordner, elternVon(cur));
  }
  return weg;
}

/**
 * Ist `vorfahrId` ein Vorfahre von `knotenId`?
 *
 * Die Frage hinter dem Ziehen: ein Ordner darf nicht in einen seiner eigenen
 * Nachfahren wandern, sonst hängt der Ast danach an sich selbst und ist von
 * der Wurzel aus nicht mehr erreichbar. Ein Ordner ist NICHT sein eigener
 * Vorfahre — „an denselben Platz ziehen" prüft der Aufrufer getrennt.
 */
export function istVorfahre(ordner, vorfahrId, knotenId, elternVon = standardEltern) {
  if (vorfahrId == null || knotenId == null) return false;
  let cur = ordnerMitId(ordner, knotenId);
  for (let i = 0; cur && i < MAX_TIEFE; i++) {
    const p = elternVon(cur);
    if (p === vorfahrId) return true;
    cur = ordnerMitId(ordner, p);
  }
  return false;
}

/** Die direkten Unterordner von `elternId` (`null` = Wurzel), Reihenfolge wie in der Liste. */
export const kinderVon = (ordner, elternId, elternVon = standardEltern) =>
  ordner.filter((f) => elternVon(f) === (elternId ?? null));
