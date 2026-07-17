import { Link } from "react-router-dom";

const Section = ({ title, children }) => (
  <section style={{ marginBottom: 28 }}>
    <h3 style={{ fontSize: 17, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>{title}</h3>
    <div style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.7 }}>{children}</div>
  </section>
);

const Faq = ({ q, children }) => (
  <details style={{ marginBottom: 10, padding: "12px 16px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }}>
    <summary style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", cursor: "pointer" }}>{q}</summary>
    <div style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.7, marginTop: 8 }}>{children}</div>
  </details>
);

export default function Help() {
  return (
    <div style={{ maxWidth: 700 }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 20 }}>Hilfe</h2>

      <Section title="Was ist CardVote?">
        CardVote ist ein Abstimmungstool für den Unterricht — ganz ohne Geräte für die Lernenden.
        Jede Person bekommt eine gedruckte Karte mit einem Muster (Marker). Je nachdem, welche Seite
        der Karte nach oben zeigt, bedeutet das Antwort A, B, C oder D. Die Lehrkraft scannt die
        hochgehaltenen Karten mit der Handykamera, die Ergebnisse erscheinen live auf dem Beamer.
      </Section>

      <Section title="Karten drucken und falten">
        Unter <Link to="/cardvote/classes" style={{ color: "var(--accent)" }}>Klassen</Link> eine Klasse anlegen
        und über das Drucker-Symbol die Karten als PDF herunterladen. Pro Blatt liegen zwei Karten:
        vorne der Marker mit den Buchstaben A, B, C, D an den vier Rändern, auf der Folgeseite die
        zugehörigen Namen (beidseitig drucken). An der gestrichelten Linie auseinanderschneiden — fertig.
        <br /><br />
        <strong>Wichtig:</strong> Die Karte gehört fest zu einer Person (Kartennummer). Zum Antworten
        wird die Karte so gedreht, dass der gewählte Buchstabe oben ist, und hochgehalten.
      </Section>

      <Section title="Ablauf einer Session">
        <ol style={{ paddingLeft: 20, margin: 0 }}>
          <li>Unter <Link to="/cardvote/questions" style={{ color: "var(--accent)" }}>Fragen</Link> ein Frageset erstellen (oder aus dem Marktplatz übernehmen).</li>
          <li>Unter <Link to="/cardvote/session" style={{ color: "var(--accent)" }}>Live-Session</Link> Klasse und Frageset wählen und starten.</li>
          <li>Den angezeigten <strong>Session-Code</strong> im Scanner auf dem Handy eingeben (oder QR-Code scannen).</li>
          <li>Frage auf dem Beamer zeigen, Lernende halten Karten hoch, mit dem Handy über die Klasse schwenken.</li>
          <li><strong>Aufdecken</strong> zeigt die Antwortverteilung — auch direkt vom Handy aus steuerbar.</li>
          <li>Nach der letzten Frage <strong>Test beenden</strong> — die Auswertung liegt danach unter <Link to="/cardvote/tests" style={{ color: "var(--accent)" }}>Auswertung</Link>.</li>
        </ol>
      </Section>

      <Section title="Test oder Spiel-Modus?">
        <strong>Test</strong> speichert Ergebnisse für die Auswertung (Noten, Statistiken, Export).
        <strong> Spiel-Modus</strong> ist für spielerisches Wiederholen: Punkte, Streaks und eine
        Bestenliste mit Podium am Ende — ohne Benotung. Im Spiel-Modus gibt es einen Geschwindigkeitsbonus,
        wenn ein Timer gesetzt ist.
      </Section>

      <Section title="Tipps zum Scannen">
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <li>Gutes Licht hilft — Gegenlicht und starke Schatten vermeiden.</li>
          <li>Karten ruhig und möglichst flach zur Kamera halten, nicht knicken.</li>
          <li>Langsam über die Klasse schwenken; erfasste Personen erscheinen sofort in der Liste.</li>
          <li>„Erkennung anzeigen" blendet Rahmen um erkannte Karten samt Antwort ein — nützlich zum Prüfen.</li>
        </ul>
      </Section>

      <h3 style={{ fontSize: 17, fontWeight: 700, color: "var(--text)", margin: "32px 0 12px" }}>Häufige Fragen</h3>

      <Faq q="Der Session-Code funktioniert nicht.">
        Der Code gilt nur für die eigene, gerade laufende Session. Prüfe, ob die Session auf dem
        Hauptgerät gestartet ist und du im Scanner mit demselben Konto angemeldet bist.
      </Faq>
      <Faq q="Eine Karte wird nicht erkannt.">
        Meist Licht oder Winkel: Karte flacher halten, näher herangehen, Reflexionen vermeiden.
        Zerknickte oder stark verblasste Karten neu drucken.
      </Faq>
      <Faq q="Eine Person hat ihre Karte verloren.">
        Unter Klassen die Karten-PDF erneut herunterladen und nur die betroffene Seite drucken —
        die Kartennummer bleibt dieselbe.
      </Faq>
      <Faq q="Ich habe keine Bestätigungs-E-Mail bekommen.">
        Spam-Ordner prüfen. Auf der Anmeldeseite kann die Bestätigungs-E-Mail erneut gesendet
        werden (Hinweis erscheint beim Anmeldeversuch).
      </Faq>
      <Faq q="Kann ich Fragen mit Formeln oder Bildern erstellen?">
        Ja. Mathematische Formeln über die Formel-Leiste im Frage-Editor (LaTeX, z.&nbsp;B. Brüche
        und Wurzeln), Bilder per Upload — beides auch in den Antwortmöglichkeiten.
      </Faq>
      <Faq q="Was passiert mit meinen Daten?">
        Alles liegt auf dem eigenen Server der Schule bzw. des Betreibers — keine Cloud, kein Tracking.
        Details in der <Link to="/legal" style={{ color: "var(--accent)" }}>Datenschutzerklärung</Link>.
      </Faq>

      <p style={{ fontSize: 13, color: "var(--text3)", marginTop: 24 }}>
        Frage nicht dabei? Über <Link to="/contact" style={{ color: "var(--accent)" }}>Kontakt</Link> melden.
      </p>
    </div>
  );
}
