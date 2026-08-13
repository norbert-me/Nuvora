// Auswahl eines Kern-Themas. Bewusst klein und modulunabhaengig: CardVote
// funktioniert ohne Thema vollstaendig — die Auswahl ist Zusatz, keine Pflicht
// (siehe Regel "Module haengen nicht voneinander ab" in CLAUDE.md).
//
// Zeigt "Thema / Unterthema", damit ein Unterthema ohne sein Oberthema nicht
// mehrdeutig wird ("Kürzen" gibt es unter mehreren Themen).
import { useState, useEffect } from "react";
import { themenIndex } from "../core/topics.js";

export default function TopicPicker({ value, onChange, style }) {
  const [topics, setTopics] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/topics")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setTopics(Array.isArray(d) ? d : []))
      .catch(() => setTopics([]))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return null;

  // Ohne Themen keine leere Auswahl anbieten — das waere nur ein toter Kasten.
  if (topics.length === 0) {
    return (
      <span style={{ fontSize: 12.5, color: "var(--text3)" }}>
        Kein Thema angelegt — unter <a href="/topics" style={{ color: "var(--accent)" }}>Themen</a> anlegen.
      </span>
    );
  }

  // Beschriftung („Thema / Unterthema") und Reihenfolge kommen aus
  // core/topics.js — dieselbe Quelle wie der Themenfilter im Quiz.
  const { label, geordnet: ordered } = themenIndex(topics);

  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border2)", fontSize: 13, background: "var(--card)", color: "var(--text)", ...style }}
    >
      <option value="">Kein Thema</option>
      {ordered.map((t) => (
        <option key={t.id} value={t.id}>{label(t)}</option>
      ))}
    </select>
  );
}
