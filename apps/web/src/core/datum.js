// Datum und Uhrzeit — EINE Quelle statt einer Kopie je Seite.
//
// Vorher: `ymd` fünfmal zeichengleich (feiertage.js, Zufall, Sitzplan,
// Anwesenheit, Kalender) plus `heuteYmd` in Todo; `addDays` zweimal (im
// Kalender so, in feiertage.js als `plus`); die Montags-Formel
// `(getDay() + 6) % 7` an sieben Stellen.
//
// Alles hier rechnet LOKAL — das ist der Grund für die Datei:
// `new Date().toISOString().slice(0, 10)` sieht gleich aus, liefert in +02:00
// ab 22 Uhr aber schon den Folgetag. Für ein Kalenderdatum immer `ymd`.
// Die Namen bleiben die bisherigen, damit sich die Aufrufstellen beim
// Zusammenführen nicht zugleich umbenennen.

/** Kalenderdatum als "YYYY-MM-DD" — lokal, nie über UTC. */
export const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Heute als "YYYY-MM-DD". */
export const heuteYmd = () => ymd(new Date());

/** n Tage weiter (n darf negativ sein). Gibt ein neues Date zurück. */
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** Derselbe Tag, 0:00 Uhr lokal. */
export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/** Wochentag mit Montag = 0 … Sonntag = 6 (nicht Sonntag = 0 wie `getDay`). */
export const wochentagMo0 = (d) => (new Date(d).getDay() + 6) % 7;

/** Montag der Woche, in der `d` liegt — 0:00 Uhr lokal. */
export const mondayOf = (d) => { const x = startOfDay(d); x.setDate(x.getDate() - wochentagMo0(x)); return x; };

/** ISO-Kalenderwoche über die Donnerstag-Regel. */
export const isoWeek = (d) => {
  const x = startOfDay(d);
  x.setDate(x.getDate() - wochentagMo0(x) + 3);           // Donnerstag dieser Woche
  const firstThu = new Date(x.getFullYear(), 0, 4);
  firstThu.setDate(firstThu.getDate() - wochentagMo0(firstThu) + 3);
  return { year: x.getFullYear(), week: 1 + Math.round((x - firstThu) / (7 * 86400000)) };
};

/**
 * Kalenderdatum als ISO-Zeichenkette, auf 12:00 Uhr LOKAL verankert.
 *
 * So verschiebt die UTC-Umrechnung das Datum nie über die Tagesgrenze. Sonst
 * wird lokale Mitternacht in +TZ zum UTC-Vortag und der ICS-Export zeigt einen
 * Tag zu früh (der 3.9. stand als 2.9. im Apple-Kalender).
 */
export const isoDay = (d) => {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate(), 12, 0, 0).toISOString();
};

/** "HH:MM" → Minuten seit Mitternacht, sonst null. */
export const hmToMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
  return m ? (+m[1]) * 60 + (+m[2]) : null;
};

/** Sekunden als "M:SS" (Fragen-Uhr in Session und Auswertung). */
export const mmss = (sek) => `${Math.floor(sek / 60)}:${String(Math.floor(sek % 60)).padStart(2, "0")}`;
