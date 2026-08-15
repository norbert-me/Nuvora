// Klasse (und Kurs) aus der Adresse übernehmen — ?class=12&kurs=3.
//
// Die Modulseiten merken sich die zuletzt gewählte Klasse (core/cache.js), aber
// nur beim ersten Aufbau. Wer aus dem Kurs heraus in ein Modul springt, das
// gerade schon offen ist, sähe sonst weiter die alte Klasse. Steht sie in der
// Adresse, gewinnt sie — und wird zugleich als „zuletzt gewählt" gemerkt.
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { lastClass, rememberClass, swr } from "./cache.js";

export function useUrlClass(setClassId, setKursId) {
  const [params] = useSearchParams();
  const c = Number(params.get("class")) || null;
  const k = Number(params.get("kurs")) || null;
  useEffect(() => {
    if (c) { rememberClass(c); setClassId?.(c); }
    if (k) setKursId?.(k);
    // Absichtlich an den Werten hängend, nicht am params-Objekt: sonst feuert
    // es bei jeder anderen Änderung der Adresse mit.
  }, [c, k]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Klassenliste holen, eine Klasse vorwählen und die Wahl merken.
 *
 * Diese sechs Zeilen standen in Noten, Zufall, Sitzplan, Orga und Karten (in
 * vier davon zeichengleich); Klassenarbeit hatte dieselbe Regel mit rohem
 * `fetch` statt `swr`, also grundlos ohne Cache. Vorwahl in dieser Reihenfolge:
 * `vorzug` (z.B. ?class= aus einem Link), zuletzt gewählte Klasse, erste der
 * Liste, sonst keine. Gewählt wird nur, solange nichts gewählt IST — eine
 * laufende Auswahl darf ein nachgeladener Serverstand nicht umwerfen.
 * `setClasses` ist freiwillig (Klassenarbeit braucht die Liste nicht).
 *
 * NICHT für `KursKlasseSelect`: das lädt Klassen zusammen mit Kursen und
 * gruppiert sie — ein Auswahlfeld, kein Ladehaken.
 */
export function useKlassenListe(setClasses, setClassId, { vorzug = null } = {}) {
  useEffect(() => swr("classes", "/api/classes", (d) => {
    const list = Array.isArray(d) ? d : [];
    setClasses?.(list);
    setClassId?.((jetzt) => {
      if (jetzt != null) return jetzt;
      if (vorzug && list.some((c) => c.id === vorzug)) return vorzug;
      const w = lastClass();
      return list.some((c) => c.id === w) ? w : (list[0]?.id ?? null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
}

/** Die gewählte Klasse als „zuletzt gewählt" merken. Stand fünfmal wortgleich da. */
export function useKlasseMerken(classId) {
  useEffect(() => { if (classId) rememberClass(classId); }, [classId]);
}
