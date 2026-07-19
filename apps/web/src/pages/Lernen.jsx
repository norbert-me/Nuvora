// Kartenlernen für Schüler — KEIN Login, Zugriff über den Token in der URL.
// Öffentliche Route: läuft ohne Nuvora-Konto. Der Token ist die Identität.
import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";

const API = "/api/karten";

export default function Lernen() {
  const { token } = useParams();
  const [data, setData] = useState(null);   // { name, cards, total }
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [results, setResults] = useState(null); // CardVote-Ergebnisse (Token-öffentlich)
  const [tab, setTab] = useState(null);         // "karten" | "ergebnisse"

  useEffect(() => {
    fetch(`${API}/lernen/${token}/results`).then((r) => (r.ok ? r.json() : [])).then((d) => setResults(Array.isArray(d) ? d : [])).catch(() => setResults([]));
  }, [token]);

  // all=true: freiwilliges Weiteruben — alle Karten, auch nicht faellige.
  const load = useCallback((all = false) => {
    fetch(`${API}/lernen/${token}${all ? "?all=1" : ""}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => { setData(d); setI(0); setFlipped(false); setDone((d.cards || []).length === 0); })
      .catch(() => setError("Der Link ist ungültig oder abgelaufen."));
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const bewerten = async (grade) => {
    const card = data.cards[i];
    // Bewertung MUSS ankommen, sonst geht Fortschritt verloren und die Sitzung
    // beginnt spaeter von vorn. Schlaegt der Aufruf fehl, hier stoppen und
    // melden statt still weiterzublaettern.
    try {
      const r = await fetch(`${API}/lernen/${token}/review`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card_id: card.card_id, grade }),
      });
      console.debug("[Karten] Review", card.card_id, "grade", grade, "→", r.status, r.ok);
      if (!r.ok) { setError(`Speichern fehlgeschlagen (${r.status}). Bitte Seite neu laden.`); return; }
    } catch (e) {
      console.error("[Karten] Review-Aufruf fehlgeschlagen:", e);
      setError("Keine Verbindung — Bewertung nicht gespeichert. Bitte erneut versuchen.");
      return;
    }
    setFlipped(false);
    // "Nochmal" (grade 0): Karte kommt in dieser Sitzung erneut dran — ans Ende
    // der Warteschlange. Sonst ist sie fuer heute erledigt und faellt raus.
    const rest = data.cards.filter((_, idx) => idx !== i);
    const queue = grade === 0 ? [...rest, card] : rest;
    // Fertig: frisch vom Server laden, damit "gelernt" und Reifegrad die eben
    // gesendeten Bewertungen zeigen und nicht den Stand vom Seitenaufruf.
    if (queue.length === 0) { load(); return; }
    setData({ ...data, cards: queue });
    // Nicht dieselbe Karte direkt noch einmal: war sie die letzte, vorne weiter.
    setI(i >= queue.length || (grade === 0 && i >= queue.length - 1) ? 0 : i);
  };

  if (error) return <Center><p style={{ color: "#dc2626" }}>{error}</p></Center>;
  if (!data) return <Center><p style={{ color: "var(--text3)" }}>Lädt…</p></Center>;

  // Hat der Schüler überhaupt Karten? Ohne Karten-Modul/Stapel gibt es keine —
  // dann zeigt die Seite nur die Testergebnisse.
  const hatKarten = (data.total || 0) > 0 || (data.cards || []).length > 0 || (data.learned || 0) > 0;
  const aktiverTab = tab || (hatKarten ? "karten" : "ergebnisse");
  const tabBar = hatKarten ? (
    <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 16 }}>
      {[["karten", "Karten"], ["ergebnisse", "Ergebnisse"]].map(([k, l]) => (
        <button key={k} onClick={() => setTab(k)} style={{ padding: "6px 16px", borderRadius: 980, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13, background: aktiverTab === k ? "var(--text)" : "var(--card)", color: aktiverTab === k ? "var(--bg)" : "var(--text2)" }}>{l}</button>
      ))}
    </div>
  ) : null;

  if (aktiverTab === "ergebnisse") {
    return <Center><div style={{ width: "100%", maxWidth: 460 }}>{tabBar}<Ergebnisse name={data.name} results={results} /></div></Center>;
  }

  if (done) {
    return (
      <Center>
        <div style={{ textAlign: "center", width: "100%", maxWidth: 460 }}>
          {tabBar}
          <div style={{ fontSize: 48, marginBottom: 8 }}>✓</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Fertig für heute!</h2>
          <p style={{ color: "var(--text2)", marginBottom: 20 }}>Alle fälligen Karten gelernt. Komm später wieder.</p>
          {data.next_due && (
            <p style={{ fontSize: 14, color: "var(--text)", marginBottom: 20 }}>
              Nächstes Lernen: <strong>{new Date(data.next_due).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</strong>
            </p>
          )}
          <MeinFortschritt data={data} />
          {data.total > 0 && (
            <button onClick={() => load(true)} style={{ ...btn, marginTop: 20, background: "transparent", color: "var(--text)", border: "1px solid var(--border2)" }}>
              Freiwillig weiterüben
            </button>
          )}
        </div>
      </Center>
    );
  }

  const card = data.cards[i];
  return (
    <Center>
      <div style={{ width: "100%", maxWidth: 460 }}>
        {tabBar}
        <div style={{ fontSize: 13, color: "var(--text3)", textAlign: "center", marginBottom: 12 }}>
          {data.name} · Karte {i + 1} von {data.cards.length}
        </div>
        <div
          onClick={() => !flipped && setFlipped(true)}
          style={{
            minHeight: 200, display: "flex", alignItems: "center", justifyContent: "center",
            textAlign: "center", padding: 28, fontSize: 20, lineHeight: 1.5,
            border: "1px solid var(--border)", borderRadius: 18, background: "var(--card)",
            cursor: flipped ? "default" : "pointer", whiteSpace: "pre-wrap",
          }}
        >
          {flipped ? card.back : card.front}
        </div>

        {!flipped ? (
          <button onClick={() => setFlipped(true)} style={{ ...btn, width: "100%", marginTop: 16 }}>Umdrehen</button>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginTop: 16 }}>
            <Grade label="Nochmal" color="#dc2626" onClick={() => bewerten(0)} />
            <Grade label="Schwer" color="#b8860b" onClick={() => bewerten(1)} />
            <Grade label="Gut" color="#0a7d3e" onClick={() => bewerten(2)} />
            <Grade label="Leicht" color="#0066cc" onClick={() => bewerten(3)} />
          </div>
        )}
      </div>
    </Center>
  );
}

// Eigener Fortschritt fuer die lernende Person: gelernt-Anteil und die
// Reifegrad-Verteilung als kleiner gestapelter Balken.
const REIFE = [
  ["neu", "Neu", "#cbd5e1"],
  ["lernen", "Am Lernen", "#f59e0b"],
  ["kurz", "Kurzfristig", "#eab308"],
  ["mittel", "Mittelfristig", "#84cc16"],
  ["lang", "Langfristig", "#0a7d3e"],
];

function MeinFortschritt({ data }) {
  const hist = data?.hist || {};
  const total = data?.total || 0;
  if (!total) return null;
  const learned = data?.learned || 0;
  return (
    <div style={{ padding: 16, border: "1px solid var(--border)", borderRadius: 16, background: "var(--card)", textAlign: "left" }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Dein Fortschritt</div>
      <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 12 }}>{learned} von {total} Karten gelernt</div>
      <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", marginBottom: 10 }}>
        {REIFE.map(([k, , color]) => {
          const n = hist[k] || 0;
          return n > 0 ? <div key={k} style={{ width: `${(n / total) * 100}%`, background: color }} title={`${n}`} /> : null;
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
        {REIFE.map(([k, label, color]) => (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--text3)" }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: color }} />
            {label} {hist[k] || 0}
          </span>
        ))}
      </div>
    </div>
  );
}

// CardVote-Testergebnisse des Schülers (öffentlich über den Token).
function Ergebnisse({ results }) {
  if (results === null) return <p style={{ color: "var(--text3)", textAlign: "center" }}>Lädt…</p>;
  if (!results.length) return (
    <div style={{ textAlign: "center", padding: "40px 0" }}>
      <div style={{ fontSize: 42, marginBottom: 8 }}>📊</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Noch kein Ergebnis</h2>
      <p style={{ color: "var(--text2)" }}>Deine Testergebnisse erscheinen hier, sobald der erste Test ausgewertet wurde.</p>
    </div>
  );
  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12, textAlign: "center" }}>Deine Ergebnisse</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {results.map((r, idx) => (
          <div key={idx} style={{ padding: "12px 16px", border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
              <div style={{ fontSize: 12, color: "var(--text3)" }}>{r.date ? new Date(r.date).toLocaleDateString() : ""}</div>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: r.pct >= 50 ? "#0a7d3e" : "#dc2626" }}>{r.pct}%</div>
            <div style={{ fontSize: 12, color: "var(--text3)" }}>{r.score}/{r.total}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const Center = ({ children }) => (
  <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "var(--bg)" }}>
    {children}
  </div>
);

function Grade({ label, color, onClick }) {
  return (
    <button onClick={onClick} style={{ padding: "12px 4px", borderRadius: 12, border: "none", background: color, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
      {label}
    </button>
  );
}

const btn = { padding: "10px 20px", borderRadius: 980, border: "none", background: "var(--text)", color: "var(--bg)", fontWeight: 600, fontSize: 14, cursor: "pointer" };
