// Eine Stunde IN DER PAUSE traegt die Nummer PAUSE_BASIS + n („nach der n.
// Stunde") — dieselbe Regel wie im Server (app/caldav.py). Ausfaelle,
// Eintraege und Anwesenheit fuehren ihre Stunde ueberall als Nummer; so laeuft
// die Pausen-Stunde durch alle Wege, ohne dass einer eine zweite Angabe kennt.
export const PAUSE_BASIS = 100;
export const istPause = (p) => typeof p === "number" && p >= PAUSE_BASIS;
// Sortierschluessel: die Pause nach der 2. steht zwischen 2. und 3.
export const stundenRang = (p) => (p == null ? -1 : istPause(p) ? p - PAUSE_BASIS + 0.5 : p);
// Kurze Beschriftung: „3." bzw. „P2" (Pause nach der 2.).
export const stundeKurz = (p) => (istPause(p) ? `P${p - PAUSE_BASIS}` : `${p}.`);
// Lange Beschriftung mit Uebersetzer: „3. Stunde" bzw. „Pause nach der 2.".
export const stundeLabel = (p, t) => (istPause(p)
  ? t("kalender.pauseNach", { n: p - PAUSE_BASIS })
  : `${p}. ${t("kalender.period")}`);

// Uhrzeit einer Stundennummer — dieselbe Regel wie im Server (app/caldav.py:
// stundenzeit). Die Stunden 1..n stehen in `times` (Index = Nummer − 1), die
// **0. Stunde** hat einen eigenen Platz (`zero`): eine verschobene Liste haette
// jede gespeicherte Stundennummer um eins verrueckt.
export function stundenZeit(times, zero, p) {
  if (istPause(p)) {
    // Stunde in der Pause: vom Ende der n. bis zum Anfang der naechsten.
    // Nicht tiefer als eine Ebene: eine „Pause nach einer Pause" gibt es nicht.
    const n = p - PAUSE_BASIS;
    if (n >= PAUSE_BASIS) return null;
    const a = stundenZeit(times, zero, n), b = stundenZeit(times, zero, n + 1);
    return a || b ? { start: (a && a.end) || "", end: (b && b.start) || "" } : null;
  }
  const w = p === 0 ? zero : (Array.isArray(times) ? times[p - 1] : null);
  return w && typeof w === "object" ? w : null;
}

// Die Stundennummern des Rasters, mit der 0. vorneweg, wenn es sie gibt.
export function stundenListe(anzahl, hatNull) {
  const rest = Array.from({ length: Math.max(0, anzahl) }, (_, i) => i + 1);
  return hatNull ? [0, ...rest] : rest;
}

// Gilt diese (versionierte) Stundenplan-Stunde an dem Tag? `valid_from`/
// `valid_to` sind "YYYY-MM-DD" oder null (offen). Der Plan wird je Halbjahr
// fortgeschrieben: dieselbe Stunde liegt mehrfach in der Antwort, einmal je
// Fassung. Wer nicht filtert, zeigt „0. Stunde" zweimal — genau so stand es in
// der Stundenwahl der Anwesenheit.
//
// Die Regel stand dreimal (Kalender, Startseite, Anwesenheit); hier ist sie
// einmal.
export function slotGiltAm(slot, tagYmd) {
  if (!slot) return false;
  if (slot.valid_from && tagYmd < slot.valid_from) return false;
  if (slot.valid_to && tagYmd > slot.valid_to) return false;
  return true;
}

/**
 * Welche der angebotenen Stunden ist gemeint, wenn eine Seite gerade aufgeht?
 *
 * Die Anwesenheit sprang stur auf die ERSTE Stunde des Tages. Das machte den
 * Bestand unsichtbar: wer in der 5. Stunde Fehlzeiten eintraegt und die Seite
 * spaeter wieder oeffnet, stand auf der 1. — und dort liegt nichts. Von aussen
 * sah das aus, als wuerde die Anwesenheit gar nicht geladen.
 *
 * Gemeint ist die Stunde, die GERADE laeuft; ist der Tag schon vorbei, die
 * letzte; hat noch keine begonnen, die naechste. Sind keine Uhrzeiten gepflegt,
 * bleibt es bei der ersten — ohne Uhrzeit sagt die Uhr nichts.
 *
 * @param kandidaten  Slots (nach `period` sortiert), jeder mit `.period`
 * @param times/zero  aus /api/kalender/timetable
 * @param jetztMin    Minuten seit Mitternacht, oder null fuer „nicht heute"
 */
export function laufendeStunde(kandidaten, times, zero, jetztMin) {
  if (!Array.isArray(kandidaten) || kandidaten.length === 0) return null;
  if (jetztMin == null) return kandidaten[0];
  const alsMin = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  let letzteMitZeit = null;
  for (const s of kandidaten) {
    const bis = alsMin(stundenZeit(times, zero, s.period)?.end);
    if (bis == null) continue;
    letzteMitZeit = s;
    if (jetztMin <= bis) return s;
  }
  return letzteMitZeit || kandidaten[0];
}
