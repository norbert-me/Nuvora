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

/** Vor- und Nachname aus „Anna Maria Meier": der LETZTE Teil ist der Nachname (wie kurzName). */
export function nameTeile(name) {
  const teile = String(name == null ? "" : name).trim().split(/\s+/).filter(Boolean);
  if (teile.length < 2) return { vor: "", nach: teile[0] || "" };
  return { vor: teile.slice(0, -1).join(" "), nach: teile[teile.length - 1] };
}

const vgl = (a, b) => String(a || "").localeCompare(String(b || ""), "de", { sensitivity: "base", numeric: true });

/**
 * Kinder sortieren: "liste" = Reihenfolge der Liste (wie gepflegt), "nachname", "vorname",
 * "klasse" (in gemischten Kursen; dann nach Nachname, Vorname). Die Eingabe bleibt unberuehrt,
 * bei Gleichstand gilt die Reihenfolge der Liste.
 */
export function sortiereKinder(liste, art) {
  const l = liste || [];
  if (!art || art === "liste") return l;
  const mit = l.map((k, i) => ({ k, i, ...nameTeile(k.name) }));
  const schluessel = {
    nachname: (x, y) => vgl(x.nach, y.nach) || vgl(x.vor, y.vor),
    vorname: (x, y) => vgl(x.vor, y.vor) || vgl(x.nach, y.nach),
    klasse: (x, y) => vgl(x.k.klasse, y.k.klasse) || vgl(x.nach, y.nach) || vgl(x.vor, y.vor),
  }[art];
  if (!schluessel) return l;
  return mit.sort((x, y) => schluessel(x, y) || x.i - y.i).map((x) => x.k);
}
