import { lies } from "./core/speicher.js";

const API = "/api";

export { API };

export function authHeaders() {
  // Ueber core/speicher.js, nicht direkt: Safari wirft im privaten Modus schon
  // beim Zugriff auf localStorage. Hier waere das besonders teuer — die
  // Funktion laeuft bei JEDEM API-Aufruf.
  const token = lies("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function apiFetch(path, opts = {}) {
  return fetch(`${API}${path}`, {
    ...opts,
    headers: { ...authHeaders(), ...opts.headers },
  });
}
