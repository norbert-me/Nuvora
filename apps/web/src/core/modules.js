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
// Ist der zuletzt gemeldete Stand echt vom Server, oder haben wir nur geraten?
// Ohne diese Unterscheidung sah eine fehlgeschlagene Anfrage aus wie "keine
// Module aktiv" — und das ModuleGate warf die Lehrkraft aus ihrer Modulseite
// auf /modules, obwohl alles aktiviert war. Ein kurzer 429 (Rate-Limit) oder
// eine Sekunde ohne Netz reichte dafuer.
let _bekannt = _cache !== null && _cache !== undefined;

export function modulstandBekannt() {
  return _bekannt;
}

async function _hole() {
  // Offline/Abbruch darf keine unbehandelte Ablehnung erzeugen — die Shell
  // arbeitet dann mit dem letzten bekannten Stand weiter.
  //
  // Zweiter Versuch nach kurzer Pause: die haeufigste Ursache ist ein 429 vom
  // Proxy (mehrere Seiten kurz hintereinander), und das ist eine Sekunde
  // spaeter vorbei. Ein zweiter Anlauf ist billiger als eine Fehlermeldung.
  for (let versuch = 0; versuch < 2; versuch++) {
    const res = await fetch("/api/modules").catch(() => null);
    if (res && res.ok) {
      const mods = await res.json();
      _bekannt = true;
      _publish(mods);
      return mods;
    }
    if (versuch === 0) await new Promise((r) => setTimeout(r, 700));
  }
  // Kein Stand vom Server. Mit Cache: damit weiterarbeiten (er stimmt fast
  // immer). Ohne Cache: NICHT so tun, als waeren keine Module aktiv.
  if (!_cache) _bekannt = false;
  return _cache || [];
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

/**
 * Einen abschaltbaren TEIL eines Moduls ein-/ausstellen.
 *
 * Welche Teile es gibt, steht im Backend (REGISTRY) und kommt mit der
 * Modulliste mit — hier wird nichts doppelt gepflegt.
 */
export async function setModuleOption(key, option, an) {
  const res = await fetch(`/api/modules/${key}/optionen`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ optionen: { [option]: an } }),
  });
  if (!res.ok) throw new Error("Option konnte nicht geändert werden");
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
  "orga", "zufall", "unterrichtsplanung", "notizbrett", "tafel", "mathespiele",
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
 * Ist dieser TEIL eines Moduls eingeschaltet?
 *
 *   const segel = useModulOption("orga", "segel");
 *
 * Solange der Modulstand noch nicht da ist, gilt die Antwort `true` — sonst
 * blitzte bei jedem Seitenaufruf kurz die abgeschaltete Fassung auf, und die
 * Seite baute sich vor den Augen um. Ein Teil, den es geben soll, kurz zu
 * sehen ist harmloser als einer, der springt.
 */
export function useModulOption(modulKey, optionKey) {
  const { modules, bekannt } = useModules();
  const mod = modules.find((m) => m.key === modulKey);
  if (!bekannt || !mod) return true;
  if (!mod.active) return false;
  const wert = (mod.optionen_an || {})[optionKey];
  return wert === undefined ? true : !!wert;
}

/**
 * @param {boolean} enabled  Nur laden, wenn eingeloggt — sonst antwortet die
 *                           API mit 401 und die Shell wuerde beim Ausloggen
 *                           unnoetig nachfragen.
 */
export function useModules(enabled = true) {
  const [modules, setModules] = useState(_cache || []);
  const [loading, setLoading] = useState(!_cache);
  const [bekannt, setBekannt] = useState(modulstandBekannt());

  useEffect(() => {
    if (!enabled) {
      _cache = null;
      setModules([]);
      return;
    }
    _subscribers.add(setModules);
    let alive = true;
    fetchModules().finally(() => {
      if (!alive) return;
      setBekannt(modulstandBekannt());
      setLoading(false);
    });
    return () => {
      alive = false;
      _subscribers.delete(setModules);
    };
  }, [enabled]);

  const toggle = useCallback((key, active) => setModuleActive(key, active), []);
  const setOption = useCallback((key, option, an) => setModuleOption(key, option, an), []);

  return {
    modules, active: modules.filter((m) => m.active), loading, toggle, setOption,
    // false = die Liste ist geraten, nicht gewusst. Wer daraus eine Sperre
    // ableitet (ModuleGate), darf dann nicht sperren.
    bekannt,
  };
}
