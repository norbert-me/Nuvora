// Themen-Beschriftung und -Reihenfolge — eine Quelle für alle Ansichten.
//
// „Kürzen" gibt es unter mehreren Oberthemen, deshalb heißt ein Unterthema
// überall „Thema / Unterthema". Stünde diese Regel zweimal im Code, hieße
// dieselbe Auswahl in der einen Ansicht „Kürzen" und in der anderen
// „Brüche / Kürzen" — und niemand wüsste, ob das dasselbe ist.
import { useEffect, useState } from "react";

import { hol } from "./melden.js";

// Natürlich vergleichen („9.2" vor „9.10", „7" vor „7/8"); Leeres nach hinten —
// ein Thema ohne Stufe oder Nummer ist nicht „die Nummer null".
const natuerlich = (a, b) => {
  const x = a == null ? "" : String(a), y = b == null ? "" : String(b);
  if (!x || !y) return x ? -1 : y ? 1 : 0;
  return x.localeCompare(y, "de", { numeric: true, sensitivity: "base" });
};

/**
 * Reihenfolge: Oberthemen nach Fach, Stufe und Nummer, Unterthemen nach
 * Nummer. Bei Gleichstand gilt die gezogene Reihenfolge (`position`), dann der
 * Name. Eine Quelle — die Themenseite und jede Auswahl sortieren gleich.
 */
export function themenVergleich(a, b) {
  if (!a.parent_id) {
    const f = natuerlich(a.fach, b.fach) || natuerlich(a.jahrgang, b.jahrgang);
    if (f) return f;
  }
  return natuerlich(a.nummer, b.nummer)
    || (a.position ?? 0) - (b.position ?? 0)
    || (a.name || "").localeCompare(b.name || "", "de", { numeric: true });
}

/** „2 IP-Adressen" — die Nummer steht vor dem Namen, wenn es eine gibt. */
export const mitNummer = (t) => (t ? (t.nummer ? `${t.nummer} ${t.name}` : t.name) : "");

export function themenIndex(topics) {
  const liste = Array.isArray(topics) ? topics : [];
  const byId = new Map(liste.map((t) => [t.id, t]));

  const label = (t) => {
    if (!t) return "";
    return t.parent_id ? `${byId.get(t.parent_id) ? mitNummer(byId.get(t.parent_id)) : "?"} / ${mitNummer(t)}` : mitNummer(t);
  };
  // Für Auswahllisten (Suche im Kalender, Themenwahl): dazu die Stufe, denn
  // „1 Netzwerk" gibt es in Stufe 5 und in Stufe 9. Unterthemen erben sie
  // vom Server (`jahrgang` ist dort schon aufgelöst).
  const auswahlLabel = (t) => {
    if (!t) return "";
    return t.jahrgang ? `Stufe ${t.jahrgang} · ${label(t)}` : label(t);
  };

  const geordnet = [];
  liste.filter((t) => !t.parent_id).sort(themenVergleich).forEach((root) => {
    geordnet.push(root);
    liste.filter((c) => c.parent_id === root.id).sort(themenVergleich).forEach((c) => geordnet.push(c));
  });

  return {
    liste,
    byId,
    label,
    auswahlLabel,
    geordnet,
    // Beschriftung zu einer ID — für Listen, die nur `topic_id` haben.
    labelFuerId: (id) => (id == null ? "" : label(byId.get(id))),
  };
}

/**
 * Die Kern-Themen laden.
 *
 * Diese eine Zeile stand sechsmal wortgleich in Seiten (Methoden, Noten,
 * Dashboard, Klassenarbeit, Evaluation) — direkt neben dem
 * `themenIndex`, dessen Beschriftungsregel längst hier liegt. Geladen, nicht
 * gecacht: `swr` würde beim ersten Aufbau kurz den alten Stand zeigen, und
 * genau das tun heute nur die zwei Seiten, die es ausdrücklich so wollen
 * (Kalender, Karten).
 */
export function useThemen() {
  const [topics, setTopics] = useState([]);
  useEffect(() => { hol("/api/topics").then((d) => setTopics(Array.isArray(d) ? d : [])); }, []);
  return topics;
}
