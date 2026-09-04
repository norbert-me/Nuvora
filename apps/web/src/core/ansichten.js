// Ansichts-Einstellungen — am KONTO, nicht am Gerät.
//
// Betroffen sind die Einrichtung der Startseite (Reihenfolge der Kacheln,
// ausgeblendete, Widgets) und die Start-Ansicht des Kalenders. Beides lag im
// localStorage, mit der Begründung „das ist eine Ansicht, kein Inhalt". Im
// Gebrauch war das falsch: wer die Startseite am Rechner einrichtet und abends
// am Tablet weiterarbeitet, fand dort die alte Anordnung — und hielt sie für
// nicht gespeichert.
//
// Der localStorage bleibt als SOFORT-Antwort und Offline-Rückfall: die Seite
// zeichnet aus ihm, während der Serverstand noch unterwegs ist. Kommt er an,
// gewinnt er.
import { alsJson } from "./melden.js";

// EIN Schluessel, ohne Konto-Nummer: auf einem Geraet ist immer genau ein
// Konto angemeldet, und beim Abmelden wird er geleert (siehe `vergessen`).
// Mit der Nummer im Namen haetten Leser und Schreiber sie kennen muessen — der
// Kalender kennt den angemeldeten Nutzer gar nicht.
const KEY = "nuvora_ansichten";

/** Was der Browser zuletzt gesehen hat — synchron, für den ersten Render. */
export function lokal(bereich) {
  try {
    const alle = JSON.parse(localStorage.getItem(KEY) || "{}");
    return alle[bereich] ?? null;
  } catch { return null; }
}

/** Serverstand übernehmen (kommt aus /api/auth/me im angemeldeten Nutzer). */
export function uebernehmen(ansichten) {
  if (!ansichten || typeof ansichten !== "object") return;
  try { localStorage.setItem(KEY, JSON.stringify(ansichten)); } catch { /* egal */ }
}

/** Beim Abmelden: der naechste Nutzer soll nicht die Startseite des vorigen sehen. */
export function vergessen() {
  try { localStorage.removeItem(KEY); } catch { /* egal */ }
}

/**
 * Eine Einstellung sichern: erst lokal (die Seite soll nicht auf das Netz
 * warten), dann ans Konto. Schlägt der Server fehl, bleibt der lokale Stand —
 * beim nächsten Speichern geht er erneut hinaus.
 */
export async function sichern(bereich, wert) {
  try {
    const alle = JSON.parse(localStorage.getItem(KEY) || "{}");
    alle[bereich] = wert;
    localStorage.setItem(KEY, JSON.stringify(alle));
  } catch { /* egal */ }
  await fetch("/api/auth/ansichten", alsJson("PUT", { bereich, wert })).catch(() => {});
}
