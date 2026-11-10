// Beamer-Modus: Kalender und Noten bleiben weg, solange andere mitsehen.
//
// Ein Browser kann nicht zuverlässig sagen, dass der Bildschirm gespiegelt
// oder per AirPlay übertragen wird — dafür gibt es keine Schnittstelle. Erkennbar
// ist nur ein ZWEITER, ERWEITERTER Bildschirm (`screen.isExtended`, Chromium).
// Deshalb zwei Wege: Wahl von Hand (an/aus) und „auto" (Voreinstellung), das
// nur auf den zweiten Bildschirm hört. Gespiegelt wird weiter nur durch den
// Handgriff erkannt. Gerätewahl, deshalb localStorage und kein Konto.
import { useSyncExternalStore } from "react";

/** Module, deren Inhalt vor Zuschauern verschwindet: Termine (Namen von Klassen) und Noten. */
export const BEAMER_MODULE = ["kalender", "auswertung"];

const KEY = "nuvora_beamer";
const hoerer = new Set();
let zweiterSchirm = false;
let frei = false; // „trotzdem zeigen" — gilt bis zum Neuladen, nie dauerhaft

const melde = () => hoerer.forEach((f) => f());

/** "auto" | "an" | "aus" */
export function beamerWahl() {
  try {
    const v = localStorage.getItem(KEY);
    return v === "an" || v === "aus" ? v : "auto";
  } catch { return "auto"; }
}

export function setzeBeamerWahl(w) {
  try {
    if (w === "an" || w === "aus") localStorage.setItem(KEY, w);
    else localStorage.removeItem(KEY);
  } catch { /* egal */ }
  frei = false;
  melde();
}

export function beamerAktiv(wahl = beamerWahl(), zweiter = zweiterSchirm) {
  return wahl === "an" || (wahl === "auto" && zweiter);
}

/** Schnellschalter für den Handgriff, den Safari/AirPlay nicht abnimmt:
 *  "aus"/"auto" -> "an", sonst zurück auf "auto". Gibt die neue Wahl zurück. */
export function beamerUmschalten() {
  const neu = beamerWahl() === "an" ? "auto" : "an";
  setzeBeamerWahl(neu);
  return neu;
}

export function beamerFreigeben() { frei = true; melde(); }

if (typeof window !== "undefined" && window.screen) {
  const lesen = () => {
    const neu = !!window.screen.isExtended;
    if (neu !== zweiterSchirm) { zweiterSchirm = neu; if (!neu) frei = false; melde(); }
  };
  lesen();
  try { window.screen.addEventListener?.("change", lesen); } catch { /* ältere Browser */ }
  // Apples Bildschirmübertragung (AirPlay/Spiegeln) meldet ein Browser nicht —
  // Safari kennt weder isExtended noch eine Ersatzschnittstelle. Darum ein
  // Tastenkürzel: Strg/Cmd + Umschalt + B schaltet den Schutz sofort ein/aus.
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "b" || e.key === "B")) {
      e.preventDefault();
      beamerUmschalten();
    }
  });
  window.addEventListener("storage", (e) => { if (e.key === KEY) melde(); });
}

const abonnieren = (f) => { hoerer.add(f); return () => hoerer.delete(f); };
const stand = () => (beamerAktiv() ? (frei ? "frei" : "aktiv") : "aus");

/** { aktiv: Inhalte verbergen, wahl, zweiterSchirm } */
export function useBeamer() {
  const s = useSyncExternalStore(abonnieren, stand, () => "aus");
  return { aktiv: s === "aktiv", wahl: beamerWahl(), zweiterSchirm };
}
