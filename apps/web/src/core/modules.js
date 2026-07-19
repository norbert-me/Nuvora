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

export async function fetchModules() {
  const res = await fetch("/api/modules");
  if (!res.ok) return [];
  const mods = await res.json();
  _publish(mods);
  return mods;
}

export async function setModuleActive(key, active) {
  const res = await fetch(`/api/modules/${key}/activate`, {
    method: active ? "POST" : "DELETE",
  });
  if (!res.ok) throw new Error("Modul konnte nicht geändert werden");
  return fetchModules();
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
