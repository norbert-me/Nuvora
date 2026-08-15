// Themen-Beschriftung und -Reihenfolge — eine Quelle für alle Ansichten.
//
// „Kürzen" gibt es unter mehreren Oberthemen, deshalb heißt ein Unterthema
// überall „Thema / Unterthema". Stünde diese Regel zweimal im Code, hieße
// dieselbe Auswahl in der einen Ansicht „Kürzen" und in der anderen
// „Brüche / Kürzen" — und niemand wüsste, ob das dasselbe ist.
import { useEffect, useState } from "react";

import { hol } from "./melden.js";

export function themenIndex(topics) {
  const liste = Array.isArray(topics) ? topics : [];
  const byId = new Map(liste.map((t) => [t.id, t]));

  const label = (t) => {
    if (!t) return "";
    return t.parent_id ? `${byId.get(t.parent_id)?.name ?? "?"} / ${t.name}` : t.name;
  };

  // Oberthemen mit ihren Unterthemen direkt darunter — alphabetisch.
  const nameAsc = (a, b) => (a.name || "").localeCompare(b.name || "", "de", { numeric: true });
  const geordnet = [];
  liste.filter((t) => !t.parent_id).sort(nameAsc).forEach((root) => {
    geordnet.push(root);
    liste.filter((c) => c.parent_id === root.id).sort(nameAsc).forEach((c) => geordnet.push(c));
  });

  return {
    liste,
    byId,
    label,
    geordnet,
    // Beschriftung zu einer ID — für Listen, die nur `topic_id` haben.
    labelFuerId: (id) => (id == null ? "" : label(byId.get(id))),
  };
}

/**
 * Die Kern-Themen laden.
 *
 * Diese eine Zeile stand sechsmal wortgleich in Seiten (Methoden, Noten,
 * Dashboard, Klassenarbeit, Evaluation, lernpfad/Exercises) — direkt neben dem
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
