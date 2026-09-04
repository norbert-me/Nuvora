// Hochladen MIT Fortschritt — deshalb XMLHttpRequest und nicht `fetch`.
//
// `fetch` meldet nur, wann die Antwort da ist; wie weit die Datei draußen ist,
// weiß es nicht (Streams für Uploads sind in Safari nicht verfügbar). Bei einer
// 20-MB-Datei über eine Schul-Leitung heißt das: der Knopf ist grau, und
// niemand weiß, ob noch etwas passiert oder ob es hängt. Genau dafür gibt es
// `xhr.upload.onprogress`.
//
// Der Token kommt über `core/speicher.js` wie beim globalen fetch-Interceptor
// (main.jsx) — XHR läuft an ihm vorbei und bekäme ihn sonst nicht.
import { lies } from "./speicher.js";

export function hochladen(url, formData, { onFortschritt, methode = "POST" } = {}) {
  return new Promise((fertig) => {
    const xhr = new XMLHttpRequest();
    xhr.open(methode, url);
    const token = lies("token");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    if (onFortschritt) {
      xhr.upload.onprogress = (e) => {
        // `lengthComputable` ist falsch, solange die Gesamtgröße unbekannt ist
        // (kommt vor). Dann bleibt der Balken unbestimmt, statt zu springen.
        onFortschritt(e.lengthComputable ? Math.round((e.loaded / e.total) * 100) : null);
      };
      // Der letzte Prozentpunkt fehlt sonst: nach dem letzten Byte wartet der
      // Server noch (Bild verkleinern, PDF wandeln) — das ist kein Stillstand.
      xhr.upload.onload = () => onFortschritt(100);
    }
    const ende = () => {
      let daten = null;
      try { daten = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { /* kein JSON */ }
      fertig({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, daten });
    };
    xhr.onload = ende;
    xhr.onerror = () => fertig({ ok: false, status: 0, daten: null });
    xhr.onabort = () => fertig({ ok: false, status: 0, daten: null });
    xhr.send(formData);
  });
}
