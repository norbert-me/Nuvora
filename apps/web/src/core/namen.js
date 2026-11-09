// Gekürzte Namen („Anna M.") — eine Anzeigeoption je Gerät, kein Eingriff in die
// Daten. Wer Noten oder den Sitzplan am Beamer zeigt, will nicht jedem den
// vollen Namen hinhalten; im Datensatz bleibt er unverändert.
import { useSyncExternalStore } from "react";

const KEY = "nuvora_kurzname";
const hoerer = new Set();

export const kurzNameAn = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };

export function setzeKurzName(an) {
  try { localStorage.setItem(KEY, an ? "1" : "0"); } catch { /* egal */ }
  hoerer.forEach((f) => f());
}

/** „Anna Meier" -> „Anna M."; ein einzelnes Wort und schon Gekürztes bleiben. */
export function kurzName(name) {
  const text = String(name == null ? "" : name).trim();
  const teile = text.split(/\s+/);
  if (teile.length < 2) return text;
  const letzter = teile[teile.length - 1];
  if (letzter.endsWith(".")) return text;
  return `${teile.slice(0, -1).join(" ")} ${Array.from(letzter)[0]}.`;
}

/** Hook: { an, name(n), umschalten(v) } — der Name wird nur gekürzt, wenn die Option an ist. */
export function useKurzName() {
  const an = useSyncExternalStore((f) => { hoerer.add(f); return () => hoerer.delete(f); }, kurzNameAn, () => false);
  return { an, name: (n) => (an ? kurzName(n) : n), umschalten: setzeKurzName };
}
