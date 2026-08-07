// Klasse (und Kurs) aus der Adresse übernehmen — ?class=12&kurs=3.
//
// Die Modulseiten merken sich die zuletzt gewählte Klasse (core/cache.js), aber
// nur beim ersten Aufbau. Wer aus dem Kurs heraus in ein Modul springt, das
// gerade schon offen ist, sähe sonst weiter die alte Klasse. Steht sie in der
// Adresse, gewinnt sie — und wird zugleich als „zuletzt gewählt" gemerkt.
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { rememberClass } from "./cache.js";

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
