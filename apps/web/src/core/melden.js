// Abgelehnte Schreibvorgänge sichtbar machen.
//
// Das alte Muster war überall dasselbe:
//
//   await fetch(url, { method: "PUT", ... }).catch(() => {});
//   load();
//
// Kein `res.ok`. Bei 403, 409, 422 oder 500 lief der `await` durch, `load()`
// holte den alten Stand vom Server — und die gerade getippte Umbenennung, der
// umgelegte Schalter, die eingetippte Maßnahme verschwanden wortlos. Für die
// Lehrkraft sah das aus wie ein Anzeigefehler; in Wahrheit war es der stillste
// Datenverlust, den die Anwendung kennt.
//
// `sende()` prüft die Antwort und zeigt bei Ablehnung eine Meldung im
// bestehenden Toast (core/undo.jsx — kein zweiter Toast-Mechanismus). Der
// Rückgabewert sagt dem Aufrufer, ob er `load()` überhaupt rufen darf:
//
//   if (!(await sende(url, opts, "Kurs umbenennen"))) return; // Eingabe bleibt
//   load();
import { zeigeFehler } from "./undo.jsx";

// Warum je Status ein eigener Satz: „Das hat nicht geklappt" beantwortet die
// einzige Frage nicht, die die Lehrkraft in dem Moment hat — liegt es an mir,
// an den Daten oder am Server?
const NACH_STATUS = {
  400: "Der Server hat die Eingabe nicht angenommen.",
  401: "Die Anmeldung ist abgelaufen. Bitte neu anmelden.",
  403: "Dafür fehlt die Berechtigung.",
  404: "Der Eintrag existiert nicht mehr — vermutlich anderswo gelöscht.",
  409: "Das gibt es schon oder wurde inzwischen geändert.",
  413: "Zu groß für den Server.",
  422: "Die Eingabe hat der Server nicht angenommen.",
  429: "Zu viele Anfragen. Kurz warten und noch einmal versuchen.",
};

// Netzfehler (fetch wirft) kommen mit status 0 an.
export function fehlerText(status, detail = "") {
  const d = typeof detail === "string" ? detail.trim() : "";
  if (d) return d;
  if (!status) return "Keine Verbindung zum Server.";
  if (NACH_STATUS[status]) return NACH_STATUS[status];
  if (status >= 500) return `Der Server konnte nicht speichern (Fehler ${status}).`;
  return `Nicht gespeichert (Fehler ${status}).`;
}

// FastAPI antwortet mit {"detail": "..."} — den Grund lieber im Klartext zeigen
// als eine Zahl. Ein Klon, damit der Aufrufer die Antwort noch lesen kann.
async function detailVon(res) {
  try {
    const kopie = typeof res.clone === "function" ? res.clone() : res;
    const d = await kopie.json();
    if (typeof d?.detail === "string") return d.detail;
    if (Array.isArray(d?.detail) && typeof d.detail[0]?.msg === "string") return d.detail[0].msg;
  } catch { /* kein JSON — dann reicht der Status */ }
  return "";
}

// Prüft eine bereits geholte Antwort. `null`/`undefined` = fetch ist geflogen.
// Gibt true zurück, wenn gespeichert wurde.
export async function pruefeAntwort(res, was = "") {
  if (res && res.ok) return true;
  const status = res?.status || 0;
  const text = fehlerText(status, await (res ? detailVon(res) : ""));
  zeigeFehler(was ? `${was}: ${text}` : text);
  return false;
}

// Holt und prüft in einem. `was` ist die Handlung aus Sicht der Lehrkraft
// („Kurs umbenennen"), nicht der Endpunkt.
export async function sende(url, options, was = "") {
  let res = null;
  try { res = await fetch(url, options); } catch { res = null; }
  return pruefeAntwort(res, was);
}

/**
 * Die Optionen eines Schreib-Aufrufs mit JSON-Rumpf.
 *
 * Genau dieses Objekt stand 115-mal im Code — zeichengleich, nur Methode und
 * Rumpf wechselten: `method`, dazu `headers` mit `"Content-Type"` auf
 * `"application/json"` und `body: JSON.stringify(…)`.
 *
 * Den Anmelde-Kopf setzt der globale `fetch`-Aufsatz in `main.jsx`; hier geht
 * es nur um Inhaltstyp und Serialisierung.
 *
 *   await sende(url, alsJson("PUT", { name }), "Kurs umbenennen")
 */
export function alsJson(method, body) {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

/**
 * Lesen: holen, JSON auspacken, im Fehlerfall den Ersatzwert.
 *
 * `fetch(u).then(r => r.ok ? r.json() : []).catch(…)` stand über hundertmal da
 * und war zweimal lokal nacherfunden (Suche.jsx, KursKlasseSelect.jsx). Lesen
 * darf still scheitern — beim Schreiben meldet `sende`.
 */
export function hol(url, ersatz = []) {
  return fetch(url).then((r) => (r.ok ? r.json() : ersatz)).catch(() => ersatz);
}
