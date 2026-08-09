// Nuvora-Kern (Frontend): welche Module hat diese Lehrkraft aktiviert?
//
// Die Liste kommt vom Backend (/api/modules) — dort steht die Registry. Hier
// wird sie nur geholt und gecacht, damit Navbar und Startseite dieselbe
// Wahrheit benutzen und nicht jede Komponente einzeln nachfragt.
import { useState, useEffect, useCallback } from "react";

// Erst-Stand aus localStorage: dann zeigt die Shell die Modul-Navigation sofort
// beim Laden, ohne auf /api/modules zu warten. Wird bei jedem Fetch aktualisiert.
const _LS = "nuvora_cache_modules";
function _seed() {
  try { const raw = localStorage.getItem(_LS); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
let _cache = _seed();
const _subscribers = new Set();

function _publish(mods) {
  _cache = mods;
  try { localStorage.setItem(_LS, JSON.stringify(mods)); } catch { /* egal */ }
  _subscribers.forEach((fn) => fn(mods));
}

// Auf einer Modulseite fragen mehrere Stellen gleichzeitig: ModuleGate, die
// Navigation und jedes useAktiv() der Seite. Das waren bis zu vier identische
// Anfragen je Seitenaufruf — auf dem Handy vier Roundtrips und unnoetig nah am
// Rate-Limit. Laeuft schon eine Anfrage, haengen sich die anderen dran.
let _laufend = null;
async function _hole() {
  // Offline/Abbruch darf keine unbehandelte Ablehnung erzeugen — die Shell
  // arbeitet dann mit dem letzten bekannten Stand weiter.
  const res = await fetch("/api/modules").catch(() => null);
  if (!res || !res.ok) return _cache || [];   // Cache behalten statt leeren
  const mods = await res.json();
  _publish(mods);
  return mods;
}
export function fetchModules({ frisch = false } = {}) {
  // frisch: nach einer Aenderung darf keine bereits laufende (noch alte)
  // Anfrage geteilt werden, sonst zeigt die Oberflaeche den Stand von vorher.
  if (_laufend && !frisch) return _laufend;
  const p = _hole();
  _laufend = p;
  const frei = () => { if (_laufend === p) _laufend = null; };
  p.then(frei, frei);
  return p;
}

export async function setModuleActive(key, active) {
  const res = await fetch(`/api/modules/${key}/activate`, {
    method: active ? "POST" : "DELETE",
  });
  if (!res.ok) throw new Error("Modul konnte nicht geändert werden");
  return fetchModules({ frisch: true });
}

// Bekannte Modul-Schluessel — muessen wortgleich zur REGISTRY im Backend sein
// (apps/api/app/routers/modules.py). Ein Tippfehler hier ist besonders
// tueckisch: die Abfrage liefert einfach immer false, das Feature verschwindet
// stillschweigend, und niemand sieht einen Fehler. Genau so waren die
// Noten-Uebernahme (Karten, CardVote), die Note im Elternkontakt und der
// Code-Detektiv-Import monatelang tot ("noten" statt "auswertung",
// "codedetektiv" statt "code-detektiv").
export const MODUL_KEYS = [
  "cardvote", "lernpfad", "auswertung", "code-detektiv", "karten", "kalender",
  "orga", "zufall", "unterrichtsplanung", "notizbrett", "notizen",
  "klassenleitung", "tafel", "mathespiele",
];

/**
 * Laeuft dieses Modul fuer diese Lehrkraft? Rueckgabe ist eine Funktion, damit
 * eine Seite mehrere Module abfragen kann:
 *
 *   const aktiv = useAktiv();
 *   aktiv("karten") && <Knopf …/>
 *
 * Unbekannte Schluessel melden sich in der Konsole, statt still false zu sein.
 */
export function useAktiv() {
  const { modules } = useModules();
  return useCallback((key) => {
    if (!MODUL_KEYS.includes(key)) {
      console.error(`[Nuvora] Unbekannter Modul-Schluessel "${key}" — Tippfehler? Bekannt: ${MODUL_KEYS.join(", ")}`);
      return false;
    }
    return modules.some((m) => m.key === key && m.active);
  }, [modules]);
}

/**
 * @param {boolean} enabled  Nur laden, wenn eingeloggt — sonst antwortet die
 *                           API mit 401 und die Shell wuerde beim Ausloggen
 *                           unnoetig nachfragen.
 */
export function useModules(enabled = true) {
  const [modules, setModules] = useState(_cache || []);
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    if (!enabled) {
      _cache = null;
      setModules([]);
      return;
    }
    _subscribers.add(setModules);
    let alive = true;
    fetchModules().finally(() => alive && setLoading(false));
    return () => {
      alive = false;
      _subscribers.delete(setModules);
    };
  }, [enabled]);

  const toggle = useCallback((key, active) => setModuleActive(key, active), []);

  return { modules, active: modules.filter((m) => m.active), loading, toggle };
}
