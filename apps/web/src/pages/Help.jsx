// Hilfe, passend zum Bereich, aus dem man kommt.
//
// Nuvora hat mehrere Bereiche (Kern, CardVote, Lernpfad, Noten). Eine einzige
// CardVote-Hilfe passte nicht mehr. Der Bereich kommt aus ?area= (die Navbar
// haengt ihn beim Klick auf Hilfe an, abgeleitet aus der aktuellen Seite);
// oben stehen die anderen Bereiche zum Wechseln.
import { Link, useSearchParams } from "react-router-dom";
import { useModules } from "../core/modules.js";

const Section = ({ title, children }) => (
  <section style={{ marginBottom: 26 }}>
    <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>{title}</h3>
    <div style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.7 }}>{children}</div>
  </section>
);

const Faq = ({ q, children }) => (
  <details style={{ marginBottom: 10, padding: "12px 16px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }}>
    <summary style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", cursor: "pointer" }}>{q}</summary>
    <div style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.7, marginTop: 8 }}>{children}</div>
  </details>
);

const A = ({ to, children }) => <Link to={to} style={{ color: "var(--accent)" }}>{children}</Link>;

// ─── Inhalte je Bereich ───

function KernHilfe() {
  return (
    <>
      <Section title="Klassen und Schüler">
        Klassen und Schüler gehören Nuvora, nicht einem einzelnen Modul — einmal unter <A to="/classes">Klassen</A> angelegt,
        nutzen alle Module dieselben. Jede Person hat eine Kartennummer (für CardVote), dazu optional E-/G-Kurs,
        Förderschwerpunkte, Notizen und die Klassenleitung.
      </Section>
      <Section title="Themen">
        <A to="/topics">Themen</A> sind der gemeinsame Wortschatz: CardVote-Fragen und Lernpfad-Aufgaben zeigen auf
        dieselben Themen. Nur so lässt sich später erkennen, wo eine Klasse Übung braucht. Themen sind zweistufig
        (Thema → Unterthema) und entstehen auch nebenbei beim Anlegen einer Aufgabe.
      </Section>
      <Section title="Module">
        Unter <A to="/modules">Module</A> schaltest du zu, was du brauchst. Abschalten entfernt keine Daten — sie
        sind nach dem Wiedereinschalten wieder da.
      </Section>
      <Faq q="Was passiert mit den Daten meiner Schüler?">
        Alles liegt auf dem eigenen Server — keine Cloud, kein Tracking. Förderschwerpunkte und Notizen sind
        besonders geschützt: sie stehen in keinem Export und in keiner Veröffentlichung. Details in der{" "}
        <A to="/legal">Datenschutzerklärung</A>.
      </Faq>
    </>
  );
}

function CardVoteHilfe() {
  return (
    <>
      <Section title="Was ist CardVote?">
        Abstimmung im Unterricht — ganz ohne Geräte für die Lernenden. Jede Person bekommt eine gedruckte Karte
        mit einem Muster. Je nachdem, welche Seite nach oben zeigt, bedeutet das Antwort A, B, C oder D. Die
        Lehrkraft scannt die hochgehaltenen Karten mit der Handykamera, Ergebnisse erscheinen live auf dem Beamer.
      </Section>
      <Section title="Karten drucken">
        Unter <A to="/cardvote/cards">Karten</A> die Karten-PDF einer Klasse herunterladen. Pro Blatt zwei Karten:
        vorne der Marker mit A, B, C, D an den Rändern, auf der Folgeseite die Namen (beidseitig drucken). An der
        gestrichelten Linie schneiden. Zum Antworten wird die Karte so gedreht, dass der Buchstabe oben ist.
      </Section>
      <Section title="Ablauf einer Session">
        <ol style={{ paddingLeft: 20, margin: 0 }}>
          <li>Unter <A to="/cardvote/questions">Fragen</A> ein Frageset erstellen (oder aus dem Marktplatz übernehmen).</li>
          <li>Unter <A to="/cardvote/session">Live-Session</A> Klasse und Frageset wählen und starten.</li>
          <li>Den <strong>Session-Code</strong> im Scanner auf dem Handy eingeben.</li>
          <li>Frage auf dem Beamer zeigen, Karten hochhalten, mit dem Handy über die Klasse schwenken.</li>
          <li><strong>Aufdecken</strong> zeigt die Verteilung — auch vom Handy aus steuerbar.</li>
          <li>Nach der letzten Frage <strong>Test beenden</strong> — Auswertung unter <A to="/cardvote/tests">Auswertung</A>.</li>
        </ol>
      </Section>
      <Section title="Tipps zum Scannen">
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <li>Gutes Licht, Gegenlicht und starke Schatten vermeiden.</li>
          <li>Karten flach zur Kamera halten, nicht knicken.</li>
          <li>Langsam schwenken; erfasste Personen erscheinen sofort.</li>
          <li>„Erkennung anzeigen" blendet Rahmen samt Antwort ein.</li>
        </ul>
      </Section>
      <Faq q="Eine Karte wird nicht erkannt.">
        Meist Licht oder Winkel: flacher halten, näher heran, Reflexionen vermeiden. Zerknickte oder verblasste
        Karten neu drucken.
      </Faq>
      <Faq q="Kann ich Fragen mit Formeln oder Bildern erstellen?">
        Ja. Formeln über die Formel-Leiste im Editor (LaTeX), Bilder per Upload — beides auch in den Antworten.
      </Faq>
    </>
  );
}

function LernpfadHilfe() {
  return (
    <>
      <Section title="Was ist Lernpfad?">
        Verwaltung von Aufgaben und Lernpfaden. Ein <strong>Lernpfad</strong> besteht aus mehreren
        <strong> Lernleitern</strong> — jede Lernleiter deckt ein Thema für eine Klasse ab, mit einer eigenen
        Aufgabenauswahl pro Person. Genau diese Auswahl ist die Differenzierung.
      </Section>
      <Section title="Aufgaben und Themen">
        Jede Aufgabe hängt an einem <A to="/topics">Thema</A> aus dem Kern — demselben, das auch CardVote-Fragen
        nutzen. Kategorie (Basis, E-/G-Niveau), Quelle, LRS-Variante und Förderschwerpunkte lassen sich hinterlegen.
      </Section>
      <Section title="Klassen">
        Der Tab „Klasse" zeigt die Schüler nur an — angelegt und bearbeitet werden sie im Rahmen unter{" "}
        <A to="/classes">Klassen</A>, damit alle Module dieselben Daten nutzen.
      </Section>
      <Faq q="Warum sehe ich meine alten Aufgaben nicht?">
        Bestandsdaten aus der früheren Lernleiter-App werden einmalig übernommen. Ist das noch nicht geschehen,
        ist das Modul leer. Frag den Betreiber nach der Datenübernahme.
      </Faq>
    </>
  );
}

function NotenHilfe() {
  return (
    <>
      <Section title="Wie das Notenbuch funktioniert">
        Wie eine leere Tabelle: Zeilen sind die Schüler, Spalten legst du selbst an (Name + Gewicht in Prozent aus
        deinem Leistungskonzept). In eine Zelle tippen: <code>2</code> oder <code>2,3</code>. Mehrere Noten pro Feld
        sind erlaubt — gezeigt wird ihr Schnitt.
      </Section>
      <Section title="Schnitt und Zeugnisnote">
        Der Schnitt ist eine <strong>Rechenhilfe</strong> aus deinen Noten, keine Zeugnisnote. „40 % belegt" heißt,
        dass erst dieser Anteil deines Konzepts mit Noten hinterlegt ist. Die Note bleibt deine Entscheidung.
      </Section>
      <Section title="Beobachtungen">
        Über die Beob.-Spalte hältst du Beobachtungen fest (Anstrengungsbereitschaft, Hilfe angeboten …). Sie
        zählen <strong>nie</strong> in den Schnitt — sie sind dein Gedächtnis fürs Quartalsende.
      </Section>
      <Section title="Test aus CardVote übernehmen">
        In der CardVote-Auswertung gibt es „Ins Notenmodul": die Testnoten wandern nach dem eingestellten
        Notenschlüssel in eine Kategorie dieser Klasse. Voraussetzung: die Klasse hat dort schon eine Spalte.
      </Section>
    </>
  );
}

const BEREICHE = {
  core: { label: "Kern", el: <KernHilfe /> },
  cardvote: { label: "CardVote", el: <CardVoteHilfe /> },
  lernpfad: { label: "Lernpfad", el: <LernpfadHilfe /> },
  noten: { label: "Noten", el: <NotenHilfe /> },
};

export default function Help() {
  const [params, setParams] = useSearchParams();
  const { modules } = useModules();
  const aktiv = new Set(modules.filter((m) => m.active).map((m) => m.key));

  // Sichtbar: Kern immer, Module nur wenn aktiv.
  const sichtbar = ["core", ...["cardvote", "lernpfad", "noten"].filter((k) => aktiv.has(k))];
  const gewuenscht = params.get("area");
  const area = sichtbar.includes(gewuenscht) ? gewuenscht : sichtbar[0];

  return (
    <div style={{ maxWidth: 700 }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Hilfe</h2>

      {aktiv.has("cardvote") && (
        <p style={{ marginBottom: 20, padding: "12px 14px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)", fontSize: 14 }}>
          Zum ersten Mal hier? Das <A to="/cardvote/tutorial">Tutorial</A> führt dich durch CardVote — jederzeit neu startbar.
        </p>
      )}

      {/* Bereichs-Umschalter: nur zeigen, wenn es mehr als den Kern gibt. */}
      {sichtbar.length > 1 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 22, flexWrap: "wrap" }}>
          {sichtbar.map((k) => (
            <button
              key={k}
              onClick={() => setParams({ area: k })}
              style={{
                padding: "6px 14px", borderRadius: 980, fontSize: 13.5, cursor: "pointer", fontWeight: 500,
                border: area === k ? "1px solid var(--accent)" : "1px solid var(--border2)",
                background: area === k ? "var(--accent-bg)" : "var(--card)",
                color: area === k ? "var(--accent)" : "var(--text2)",
              }}
            >
              {BEREICHE[k].label}
            </button>
          ))}
        </div>
      )}

      {BEREICHE[area].el}

      <p style={{ fontSize: 13, color: "var(--text3)", marginTop: 24 }}>
        Frage nicht dabei? Über <A to="/contact">Kontakt</A> melden.
      </p>
    </div>
  );
}
