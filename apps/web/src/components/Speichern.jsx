// Ein Entwurf, ein Speichern-Knopf — für die ganze Anwendung dieselbe Form.
//
// Die Regel kommt aus dem Gebrauch: „manche Dinge haben keinen Speichern-Knopf
// und speichern automatisch. Das fühlt sich komisch an, man hat das Gefühl,
// es ist nicht gespeichert. Man hat keine Kontrolle." Also gilt ab hier
// überall: **wo sich etwas ändern lässt, gibt es einen Speichern-Knopf** —
// ohne Ausnahme, auch bei Schaltern und Häkchen.
//
// Damit das nicht jede Seite anders löst (und drei Seiten es vergessen), steht
// die Mechanik hier an einer Stelle:
//
//   const e = useEntwurf(stapel, (wert) => fetch(…));
//   <input value={e.wert.name} onChange={(ev) => e.setz({ name: ev.target.value })} />
//   <Speicherleiste entwurf={e} />
//
// `useEntwurf` hält eine Arbeitskopie. Nichts davon geht zum Server, bevor
// jemand speichert; `verwerfen` stellt den letzten gespeicherten Stand wieder
// her. Solange etwas offen ist, warnt die Anwendung beim Verlassen der Seite
// und beim Schließen des Fensters.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBlocker } from "react-router-dom";

import { btnPrimary, btnSecondary, btnSmall, COLORS as C } from "./Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

/** Flacher Vergleich reicht: die Entwürfe sind einfache Objekte aus Feldwerten. */
function gleich(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => {
    const x = a[k], y = b[k];
    if (Array.isArray(x) && Array.isArray(y)) return x.length === y.length && x.every((v, i) => v === y[i]);
    return x === y;
  });
}

/**
 * Arbeitskopie eines Datensatzes.
 *
 * @param gespeichert  der Stand, der auf dem Server liegt
 * @param speichernFn  async (wert) => void | false — false heißt „nicht gespeichert"
 *                     (dann bleibt der Entwurf offen, damit nichts verloren geht)
 */
export function useEntwurf(gespeichert, speichernFn) {
  const [wert, setWert] = useState(gespeichert);
  const [laeuft, setLaeuft] = useState(false);
  // „Hat hier jemand HINEINGEGRIFFEN?" — und nicht „unterscheiden sich die
  // Werte?". Der Unterschied ist der Kern: Daten kommen oft erst nach dem
  // Mounten, die Arbeitskopie startet also mit einem leeren Stand. Wer nur
  // vergleicht, haelt diesen ersten Nachschub fuer eine offene Aenderung,
  // uebernimmt ihn nie — und die Maske steht sofort auf „nicht gespeichert"
  // und zeigt leere Felder. Genau das ist beim ersten Einsatz passiert.
  const beruehrt = useRef(false);
  useEffect(() => {
    if (!beruehrt.current) setWert(gespeichert);
  }, [gespeichert]);

  const geaendert = beruehrt.current && !gleich(wert, gespeichert);

  const setz = useCallback((teil) => {
    beruehrt.current = true;
    setWert((v) => ({ ...v, ...(typeof teil === "function" ? teil(v) : teil) }));
  }, []);

  const speichern = useCallback(async () => {
    if (laeuft) return false;           // Doppelklick zählt einmal
    setLaeuft(true);
    try {
      const ok = await speichernFn(wert);
      // Nur bei Erfolg loslassen: sonst gaelte der Entwurf als uebernommen und
      // der naechste Nachschub vom Server ueberschriebe, was nie ankam.
      if (ok !== false) beruehrt.current = false;
      return ok !== false;
    } finally {
      setLaeuft(false);
    }
  }, [laeuft, speichernFn, wert]);

  const verwerfen = useCallback(() => { beruehrt.current = false; setWert(gespeichert); }, [gespeichert]);

  return useMemo(() => ({ wert, setz, geaendert, speichern, verwerfen, laeuft }),
    [wert, setz, geaendert, speichern, verwerfen, laeuft]);
}

/**
 * Warnen, solange etwas offen ist.
 *
 * Zwei Wege hinaus, zwei Sperren: der Seitenwechsel INNERHALB der Anwendung
 * (React Router, deshalb liegt die Anwendung an einem Datenrouter — ohne den
 * gibt es `useBlocker` nicht) und das Schließen/Neuladen des Fensters
 * (`beforeunload`, dort bestimmt der Browser den Wortlaut).
 */
export function useVerlassenWarnung(offen, frage) {
  const sperre = useBlocker(offen);
  useEffect(() => {
    if (sperre.state !== "blocked") return;
    // `confirm` und nicht der eigene Dialog: die Sperre muss synchron
    // entscheiden, sonst ist der Seitenwechsel schon durch.
    if (window.confirm(frage)) sperre.proceed();
    else sperre.reset();
  }, [sperre, frage]);

  useEffect(() => {
    if (!offen) return;
    const anhalten = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", anhalten);
    return () => window.removeEventListener("beforeunload", anhalten);
  }, [offen]);
}

/**
 * Speichern + Abbrechen + der Hinweis „nicht gespeichert".
 *
 * Sichtbar wird sie erst, wenn wirklich etwas offen ist — ein dauerhaft
 * ausgegrauter Knopf ist Möblierung, kein Hinweis. `immer` zeigt sie trotzdem
 * (für Formulare, in denen der Knopf am festen Platz stehen soll).
 */
export default function Speicherleiste({ entwurf, immer = false, style, klein = false }) {
  const { t } = useLanguage();
  useVerlassenWarnung(entwurf.geaendert, t("speichern.verlassen"));
  if (!entwurf.geaendert && !immer) return null;
  const grund = klein ? { ...btnSmall } : null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, ...style }}>
      {entwurf.geaendert && (
        <span style={{ fontSize: 12, color: C.warning, whiteSpace: "nowrap" }}>{t("speichern.offen")}</span>
      )}
      <button onClick={entwurf.speichern} disabled={!entwurf.geaendert || entwurf.laeuft}
        style={{ ...btnPrimary, ...grund, opacity: entwurf.geaendert && !entwurf.laeuft ? 1 : 0.5 }}>
        {entwurf.laeuft ? t("speichern.laeuft") : t("common.save")}
      </button>
      <button onClick={entwurf.verwerfen} disabled={!entwurf.geaendert || entwurf.laeuft}
        style={{ ...btnSecondary, ...grund, opacity: entwurf.geaendert && !entwurf.laeuft ? 1 : 0.5 }}>
        {t("common.abort")}
      </button>
    </span>
  );
}
