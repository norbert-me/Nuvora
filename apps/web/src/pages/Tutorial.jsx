// Tutorial für CardVote — vier Bereiche, jederzeit neu startbar.
//
// Bewusst kein Overlay über der App: Overlays verdecken genau das, was sie
// erklären, und lassen sich nicht nebenher lesen. Stattdessen eine eigene
// Seite mit Links in die echten Bereiche — wer abbricht, findet den Stand
// wieder, weil der Fortschritt im Konto-Browser gemerkt wird.
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";

const STORAGE_KEY = "cv_tutorial_done";

const CV = "/cardvote";

const BEREICHE = [
  {
    key: "fragen",
    titel: "Fragen erstellen",
    ziel: `${CV}/questions`,
    zielText: "Zu den Fragen",
    schritte: [
      "Fragen liegen in Fragesets, Fragesets in Ordnern — wie Dateien in Verzeichnissen.",
      "Eine Frage hat 2, 3 oder 4 Antworten. Mehrere richtige Antworten sind erlaubt: einfach mehrere ankreuzen.",
      "Formeln schreibst du in Dollarzeichen: $\\frac{1}{2}$ wird als Bruch gesetzt — im Fragetext wie in den Antworten.",
      "Bilder kannst du hochladen und links, rechts, über oder unter die Frage stellen.",
      "In deinem Konto liegt schon ein Beispiel-Frageset, das all das vorführt.",
    ],
  },
  {
    key: "klasse",
    titel: "Klasse erstellen",
    ziel: "/classes",
    zielText: "Zu den Klassen",
    schritte: [
      "Klassen und Schüler gehören Nuvora, nicht CardVote — deshalb nutzt auch Lernpfad dieselben.",
      "Jede Person bekommt eine Kartennummer. Die Nummer zählt, nicht der Name: sie steht auf der gedruckten Karte.",
      "Namen kannst du auch per Excel oder JSON importieren, statt sie zu tippen.",
      "Die Karten druckst du unter CardVote → Karten als PDF. Jede Karte hat vier Seiten (A, B, C, D).",
      "Eine Blanko-Klasse mit 30 Karten liegt schon bereit — überschreib einfach die Namen.",
    ],
  },
  {
    key: "session",
    titel: "Live-Session",
    ziel: `${CV}/session`,
    zielText: "Zur Live-Session",
    schritte: [
      "Klasse und Frageset wählen, Session starten — die Frage erscheint für den Beamer.",
      "Die Lernenden halten ihre Karte so, dass ihre Antwort oben steht. Kein Gerät, kein WLAN für die Klasse.",
      "Du öffnest den Scanner auf dem Handy und gibst den vierstelligen Session-Code ein.",
      "Kamera auf die Klasse richten: erkannte Karten werden markiert, Ergebnisse erscheinen live.",
      "Aufdecken, nächste Frage und Testende kannst du direkt vom Handy aus auslösen.",
    ],
  },
  {
    key: "auswerten",
    titel: "Marktplatz & Auswerten",
    ziel: `${CV}/tests`,
    zielText: "Zur Auswertung",
    schritte: [
      "Nach dem Testende liegt die Auswertung unter Tests: Noten, Boxplot, Lösungsquote pro Frage.",
      "Den Notenschlüssel kannst du anpassen — ganze Noten oder Tendenznoten mit .3 und .7.",
      "Hinweise zeigen Auffälligkeiten: Deckeneffekt, hohe Streuung, Ratewahrscheinlichkeit.",
      "Export als PDF, Excel oder iDoceo-CSV — pro Person oder als Gesamtübersicht.",
      "Im Marktplatz veröffentlichst du eigene Fragesets oder übernimmst fremde mit einem Klick.",
    ],
  },
];

export default function Tutorial() {
  const [done, setDone] = useState({});
  const [offen, setOffen] = useState(BEREICHE[0].key);

  useEffect(() => {
    try { setDone(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")); } catch { /* egal */ }
  }, []);

  const merke = (next) => {
    setDone(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* egal */ }
  };

  const toggle = (key) => merke({ ...done, [key]: !done[key] });
  const neu = () => { merke({}); setOffen(BEREICHE[0].key); };

  const fertig = BEREICHE.filter((b) => done[b.key]).length;

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Tutorial</h1>
        <span style={{ fontSize: 13, color: "var(--text3)" }}>{fertig} von {BEREICHE.length} erledigt</span>
        {fertig > 0 && (
          <button onClick={neu} style={{ marginLeft: "auto", ...btnSecondary }}>Von vorn beginnen</button>
        )}
      </div>
      <p style={{ color: "var(--text2)", marginBottom: 22, fontSize: 14 }}>
        Vier Bereiche, in der Reihenfolge einer echten Stunde. Du kannst jederzeit
        abbrechen und später weitermachen — oder alles zurücksetzen.
      </p>

      {BEREICHE.map((b, i) => {
        const auf = offen === b.key;
        const erledigt = !!done[b.key];
        return (
          <div key={b.key} style={{ marginBottom: 10, border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)", overflow: "hidden" }}>
            <button
              onClick={() => setOffen(auf ? null : b.key)}
              style={{
                display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "14px 16px",
                background: "none", border: "none", cursor: "pointer", textAlign: "left", color: "var(--text)",
              }}
            >
              <span style={{
                width: 26, height: 26, borderRadius: 13, flexShrink: 0, fontSize: 13, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: erledigt ? "#0a7d3e" : "var(--bg)", color: erledigt ? "#fff" : "var(--text3)",
                border: erledigt ? "none" : "1px solid var(--border2)",
              }}>
                {erledigt ? "✓" : i + 1}
              </span>
              <span style={{ flex: 1, fontSize: 16, fontWeight: 600 }}>{b.titel}</span>
              <span style={{ color: "var(--text3)", fontSize: 12 }}>{auf ? "▾" : "▸"}</span>
            </button>

            {auf && (
              <div style={{ padding: "0 16px 16px 54px" }}>
                <ul style={{ margin: "0 0 14px", paddingLeft: 18, color: "var(--text2)", fontSize: 14, lineHeight: 1.75 }}>
                  {b.schritte.map((s, k) => <li key={k}>{s}</li>)}
                </ul>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Link to={b.ziel} style={{ ...btnPrimary, textDecoration: "none", display: "inline-block" }}>{b.zielText}</Link>
                  <button onClick={() => toggle(b.key)} style={btnSecondary}>
                    {erledigt ? "Wieder offen" : "Erledigt"}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const btnSecondary = { padding: "7px 14px", cursor: "pointer", fontSize: 13.5, border: "1px solid var(--border2)", borderRadius: 980, background: "var(--card)", color: "var(--text)", fontWeight: 500 };
const btnPrimary = { padding: "7px 14px", cursor: "pointer", fontSize: 13.5, border: "none", borderRadius: 980, background: "var(--text)", color: "var(--bg)", fontWeight: 600 };
