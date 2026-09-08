// Welchen Stand einer Zeile hat diese Oberflaeche zuletzt gesehen?
//
// Der Server zaehlt an jeder offline bearbeitbaren Zeile mit, wie oft sie
// geaendert wurde (`app/versionierung.py`). Damit er beim Schreiben sagen kann
// „das ist nicht mehr die Zeile, die du gelesen hast", muss der Client die
// gelesene Nummer mitschicken. Hier liegt sie.
//
// Drei Entscheidungen:
//
//  (a) **Aus den Antworten gelernt, nicht in jeder Seite gepflegt.** Jede
//      GET-Antwort laeuft ohnehin durch den fetch-Interceptor; dort wird
//      mitgeschrieben, was eine `id` UND eine `version` traegt. Muesste jede
//      Seite die Nummer selbst durchreichen, fehlte sie in der Haelfte — und
//      eine Sperre, die nur manchmal greift, ist keine.
//  (b) **Der Schluessel ist der Pfad der Einzelressource.** Eine Liste
//      `/api/notizblock` liefert Zettel mit id 12 — der Schluessel dafuer ist
//      `/api/notizblock/12`, also genau der Pfad, den das spaetere PUT nimmt.
//      Verschachteltes (die Karten IN einem Stapel) wird bewusst NICHT
//      gelernt: ihr eigener Pfad ist ein anderer, und ein geratener Schluessel
//      waere schlimmer als keiner — er zeigte auf eine fremde Zeile.
//  (c) **Nur im Arbeitsspeicher.** Was ueber einen Neustart hinaus gebraucht
//      wird, haengt am Outbox-Eintrag selbst (der liegt in IndexedDB). Eine
//      zweite, dauerhafte Ablage waere eine zweite Wahrheit, die nach dem
//      naechsten Deploy auf geloeschte Zeilen zeigt.

export const KOPF = "X-Nuvora-Version";

const staende = new Map();   // "/api/notizblock/12" -> Versionsnummer
const MAX = 2000;            // eine Obergrenze, damit ein langer Tag den Speicher nicht fuellt

function pfadVon(url) {
  try { return new URL(url, location.origin).pathname; } catch { return null; }
}

/** Endet der Pfad auf eine numerische ID? Dann ist es die Einzelressource. */
function ohneId(pfad) {
  const m = /^(.*)\/(\d+)$/.exec(pfad);
  return m ? m[1] : pfad;
}

function setz(schluessel, version) {
  if (!schluessel || !Number.isFinite(version)) return;
  if (staende.size > MAX) staende.clear();   // billiger als eine Verdraengungsstrategie
  staende.set(schluessel, version);
}

/**
 * Aus einer gelesenen Antwort lernen. `daten` ist der geparste Rumpf einer
 * GET-Antwort auf `url`.
 */
export function merke(url, daten) {
  const pfad = pfadVon(url);
  if (!pfad || !daten) return;
  const basis = ohneId(pfad);
  const eintrag = (o) => {
    if (!o || typeof o !== "object") return;
    if (o.id == null || typeof o.version !== "number") return;
    setz(`${basis}/${o.id}`, o.version);
  };
  if (Array.isArray(daten)) daten.forEach(eintrag);
  else eintrag(daten);
}

/** Die zuletzt gelesene Version fuer diese Adresse — oder null. */
export function fuer(url) {
  const pfad = pfadVon(url);
  if (!pfad) return null;
  const v = staende.get(pfad);
  return typeof v === "number" ? v : null;
}

/** Nach einem eigenen Schreibvorgang: der Server nennt die neue Nummer. */
export function vergiss(url) {
  const pfad = pfadVon(url);
  if (pfad) staende.delete(pfad);
}

/** Nur fuer Tests. */
export function _leeren() { staende.clear(); }
