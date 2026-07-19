import { useState, useEffect } from "react";

const FALLBACK = { betreiber: "[Name eintragen]", strasse: "[Straße]", plz_ort: "[PLZ Ort]", email: "kontakt@example.com" };

export default function Legal() {
  const [cfg, setCfg] = useState(FALLBACK);
  useEffect(() => {
    // Betreiberdaten kommen zentral aus Nuvoras config/site.json — dieselbe
    // Quelle, die auch Lernpfad liest. Der Proxy liefert sie unter /site.json
    // aus (siehe nginx.conf).
    fetch("/site.json").then((r) => r.ok ? r.json() : FALLBACK).then(setCfg).catch(() => {});
  }, []);

  const { betreiber: name, strasse: street, plz_ort: city, email } = cfg;
  const mailto = `mailto:${email}`;

  return (
    <div style={{ lineHeight: 1.7, color: "var(--text)" }}>
      {/* Entwicklungsstatus: die Anwendung ist im Aufbau (Alpha/Beta). Realer
          Hinweis, weil echte Daten betroffen sind. */}
      <div style={{ marginBottom: 28, padding: "14px 16px", border: "1px solid #b8860b", borderRadius: 12, background: "rgba(184,134,11,0.10)", fontSize: 13.5 }}>
        <strong>Hinweis zum Entwicklungsstand.</strong> Nuvora befindet sich in
        aktiver Entwicklung (Alpha/Beta). Es besteht <strong>kein Anspruch auf
        die erstellten Daten</strong>: im Zuge der Weiterentwicklung können Daten
        verändert werden oder verloren gehen. Verlasse dich nicht als einzige
        Quelle darauf — bewahre Noten und wichtige Unterlagen zusätzlich außerhalb
        des Systems auf.
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Impressum</h2>

      <section style={{ marginBottom: 32 }}>
        <p style={{ fontSize: 13, color: "var(--text3)", marginBottom: 12 }}>Angaben gemäß § 5 DDG (ehem. TMG)</p>

        <p>
          <strong>{name}</strong><br />
          {street}<br />
          {city}
        </p>

        <p style={{ marginTop: 12 }}>
          <strong>Kontakt:</strong><br />
          E-Mail: <a href={mailto} style={{ color: "var(--accent)" }}>{email}</a>
        </p>

        <p style={{ marginTop: 12 }}>
          <strong>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV:</strong><br />
          {name}<br />
          {street}<br />
          {city}
        </p>
      </section>

      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Datenschutzerklärung</h2>

      <section style={{ marginBottom: 32 }}>
        <h3 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>1. Verantwortlicher</h3>
        <p>
          Verantwortlicher im Sinne der Datenschutz-Grundverordnung (DSGVO) und anderer nationaler
          Datenschutzgesetze sowie sonstiger datenschutzrechtlicher Bestimmungen ist:
        </p>
        <p style={{ marginTop: 8 }}>
          {name}<br />
          {street}<br />
          {city}<br />
          E-Mail: <a href={mailto} style={{ color: "var(--accent)" }}>{email}</a>
        </p>

        <h3 style={{ fontSize: 17, fontWeight: 600, marginTop: 24, marginBottom: 8 }}>2. Allgemeines zur Datenverarbeitung</h3>
        <p>
          Nuvora ist ein selbstgehosteter Werkzeugkasten für Lehrkräfte mit zuschaltbaren Modulen
          (u.&nbsp;a. Abstimmungen, Karteikarten, Noten, Kalender). Die Verarbeitung personenbezogener
          Daten erfolgt ausschließlich zur Bereitstellung und Nutzung der Anwendung. Es findet keine
          Weitergabe an Dritte statt.
        </p>

        <h3 style={{ fontSize: 17, fontWeight: 600, marginTop: 24, marginBottom: 8 }}>3. Rechtsgrundlagen</h3>
        <p>
          Die Verarbeitung personenbezogener Daten erfolgt auf folgenden Rechtsgrundlagen:
        </p>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>Art. 6 Abs. 1 lit. b DSGVO</strong> — Vertragserfüllung: Registrierung und Nutzung des Dienstes (Lehrkraft-Konten).</li>
          <li><strong>Art. 6 Abs. 1 lit. f DSGVO</strong> — Berechtigtes Interesse: Betrieb und Sicherheit der Anwendung (z.&nbsp;B. Protokollierung von Zugriffen).</li>
          <li><strong>Art. 6 Abs. 1 lit. a DSGVO</strong> — Einwilligung: Soweit die nutzende Lehrkraft bzw. Schule Daten von Lernenden eingibt, ist diese für die Einholung einer ggf. erforderlichen Einwilligung der Betroffenen (bzw. der Erziehungsberechtigten) selbst verantwortlich.</li>
        </ul>

        <h3 style={{ fontSize: 17, fontWeight: 600, marginTop: 24, marginBottom: 8 }}>4. Art der verarbeiteten Daten</h3>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>Nutzungsdaten der Lehrkraft:</strong> E-Mail-Adresse, Name, Passwort (als gesalzener Hash gespeichert, nicht im Klartext).</li>
          <li><strong>Daten der Lernenden:</strong> Name und zugewiesene Kartennummer, eingegeben durch die Lehrkraft. Optional E-/G-Kurs, Klassenleitung sowie – soweit von der Lehrkraft erfasst – Förderschwerpunkte und Notizen.</li>
          <li><strong>Besondere Kategorien (Art. 9 DSGVO):</strong> Angaben zu Förderschwerpunkten (z.&nbsp;B. LRS, Dyskalkulie) und Notizen zu Nachteilsausgleichen können besondere Kategorien personenbezogener Daten darstellen. Diese Angaben werden ausschließlich auf dem Server des Verantwortlichen verarbeitet, erscheinen in <strong>keinem Export</strong> und in keiner Veröffentlichung. Rechtsgrundlage und Erforderlichkeit ihrer Erhebung liegen in der Verantwortung der erhebenden Lehrkraft bzw. Schule (in der Regel Schulgesetz/-verordnung des jeweiligen Landes).</li>
          <li><strong>Modul-Daten der Lernenden:</strong> je nach genutztem Modul – Abstimmungsergebnisse (CardVote: Antworten pro Frage und Session), Bewertungen und Beobachtungen (Noten), Lernfortschritt beim Karteikarten-Üben (Karten), Anwesenheit und Fehlzeiten (Anwesenheit), Sitzpositionen (Sitzplan) sowie Unterrichtsplanung mit Klassen- und Themenbezug (Kalender). Alle diese Daten gibt die Lehrkraft ein bzw. erfasst sie im Unterricht.</li>
          <li><strong>Pseudonymer Zugang der Lernenden (Modul Karten):</strong> Zum Üben ohne Konto erhält jede Person einen zufälligen, geheimen Token (in einem QR-Code/Link). Er dient allein dazu, den Übungsfortschritt der richtigen Person zuzuordnen; ein Login findet nicht statt. Wer den Link kennt, kann üben – die Lehrkraft gibt ihn gezielt aus.</li>
          <li><strong>Kamerabilder:</strong> Werden beim Scannen (CardVote) kurzfristig im Arbeitsspeicher verarbeitet, um ArUco-Marker zu erkennen. Es erfolgt keine dauerhafte Speicherung der Bilder.</li>
          <li><strong>Technische Zugriffsdaten:</strong> IP-Adresse (kurzfristig im Arbeitsspeicher für Brute-Force-Schutz, nicht dauerhaft gespeichert).</li>
        </ul>

        <h3 style={{ fontSize: 17, fontWeight: 600, marginTop: 24, marginBottom: 8 }}>5. Speicherung und Speicherort</h3>
        <p>
          Alle Daten werden ausschließlich auf dem Server des Verantwortlichen gespeichert.
          Es erfolgt keine Übermittlung in Drittländer.
          Die Datenübertragung zwischen Browser und Server ist durch HTTPS (TLS) verschlüsselt.
        </p>

        <h3 style={{ fontSize: 17, fontWeight: 600, marginTop: 24, marginBottom: 8 }}>6. Speicherdauer und Löschung</h3>
        <p>
          Daten der Lernenden und Abstimmungsergebnisse werden gespeichert, solange die zugehörige
          Klasse bzw. Session in der Anwendung existiert. Die Lehrkraft kann Klassen, Sessions und
          alle zugehörigen Daten jederzeit eigenständig löschen. Konten der Lehrkraft können über
          die Profil-Seite selbst gelöscht werden; dabei werden alle zugehörigen Daten entfernt.
        </p>

        <h3 style={{ fontSize: 17, fontWeight: 600, marginTop: 24, marginBottom: 8 }}>7. Cookies und Tracking</h3>
        <p>
          Nuvora verwendet <strong>keine Cookies</strong> und <strong>keine Tracking-Dienste</strong>.
          Die Authentifizierung erfolgt über ein Token, das ausschließlich im lokalen Speicher
          (localStorage) des Browsers abgelegt wird. Externe Analyse- oder Werbedienste werden nicht eingesetzt.
        </p>
        <p style={{ marginTop: 8 }}>
          Zusätzlich legt die Anwendung im localStorage einen <strong>lokalen Zwischenspeicher</strong> selten
          wechselnder eigener Daten der Lehrkraft ab (z.&nbsp;B. Klassen, Themen, aktive Module, die Reihenfolge
          der Startseiten-Kacheln), damit Seiten schneller erscheinen. Diese Daten verbleiben im Browser der
          Lehrkraft, werden nicht an Dritte übertragen und beim Abmelden wieder entfernt.
        </p>
        <p style={{ marginTop: 8 }}>
          Sämtliche Schriften und Bibliotheken (u.&nbsp;a. KaTeX zur Formeldarstellung) werden
          lokal vom eigenen Server ausgeliefert — es werden keine Inhalte von Drittanbieter-CDNs
          geladen und somit keine IP-Adressen an Dritte übermittelt.
        </p>

        <h3 style={{ fontSize: 17, fontWeight: 600, marginTop: 24, marginBottom: 8 }}>8. Rechte der betroffenen Personen</h3>
        <p>
          Betroffene Personen (bzw. deren Erziehungsberechtigte) haben gemäß DSGVO folgende Rechte:
        </p>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>Auskunftsrecht</strong> (Art. 15 DSGVO) — Recht auf Information über die verarbeiteten Daten.</li>
          <li><strong>Berichtigungsrecht</strong> (Art. 16 DSGVO) — Recht auf Korrektur unrichtiger Daten.</li>
          <li><strong>Löschungsrecht</strong> (Art. 17 DSGVO) — Recht auf Löschung der Daten.</li>
          <li><strong>Recht auf Einschränkung der Verarbeitung</strong> (Art. 18 DSGVO).</li>
          <li><strong>Recht auf Datenübertragbarkeit</strong> (Art. 20 DSGVO).</li>
          <li><strong>Widerspruchsrecht</strong> (Art. 21 DSGVO) — Recht, der Verarbeitung zu widersprechen.</li>
        </ul>
        <p style={{ marginTop: 8 }}>
          Zur Ausübung dieser Rechte wenden Sie sich an <a href={mailto} style={{ color: "var(--accent)" }}>{email}</a>.
        </p>

        <h3 style={{ fontSize: 17, fontWeight: 600, marginTop: 24, marginBottom: 8 }}>9. Beschwerderecht bei einer Aufsichtsbehörde</h3>
        <p>
          Betroffene Personen haben das Recht, sich bei einer Datenschutz-Aufsichtsbehörde über
          die Verarbeitung ihrer personenbezogenen Daten zu beschweren. Eine Liste der
          Aufsichtsbehörden finden Sie unter:&nbsp;
          <a href="https://www.bfdi.bund.de/DE/Service/Anschriften/Laender/Laender-node.html" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
            bfdi.bund.de
          </a>.
        </p>

        <h3 style={{ fontSize: 17, fontWeight: 600, marginTop: 24, marginBottom: 8 }}>10. Wer ist für die Daten der Lernenden verantwortlich?</h3>
        <p>
          Für die Daten der Schülerinnen und Schüler (Namen, Kartennummern, Modul-Daten wie
          Abstimmungsergebnisse, Noten, Lernfortschritt, Anwesenheit)
          ist <strong>nicht der Betreiber dieser Nuvora-Instanz</strong>, sondern die jeweils
          <strong> nutzende Lehrkraft bzw. Schule</strong> als eigenständig Verantwortliche/r im Sinne
          der DSGVO (Art. 4 Nr. 7 DSGVO) verantwortlich. Der Betreiber stellt lediglich die technische
          Infrastruktur bereit (vergleichbar einer Auftragsverarbeitung). Die Lehrkraft bzw. Schule ist
          insbesondere selbst verantwortlich für:
        </p>
        <ul style={{ paddingLeft: 20 }}>
          <li>die Einholung ggf. erforderlicher Einwilligungen der Betroffenen bzw. Erziehungsberechtigten,</li>
          <li>die Information der Betroffenen über die Datenverarbeitung,</li>
          <li>die Erstellung eines Verarbeitungsverzeichnisses (Art. 30 DSGVO),</li>
          <li>ggf. den Abschluss einer Auftragsverarbeitungsvereinbarung (Art. 28 DSGVO) mit dem Betreiber dieser Instanz,</li>
          <li>die datenschutzkonforme Nutzung und rechtzeitige Löschung der Daten nach Schuljahres- bzw. Klassenende.</li>
        </ul>

        <h3 style={{ fontSize: 17, fontWeight: 600, marginTop: 24, marginBottom: 8 }}>11. Sicherheit</h3>
        <p>
          Passwörter werden mit PBKDF2 (SHA-256, 100.000 Iterationen) gehasht und gesalzen gespeichert.
          Die Kommunikation ist durchgehend TLS-verschlüsselt. Der Zugriff auf Daten ist durch
          Authentifizierung und Autorisierung geschützt; jede Lehrkraft sieht ausschließlich
          die eigenen Klassen, Fragen und Sessions.
        </p>

        <h3 style={{ fontSize: 17, fontWeight: 600, marginTop: 24, marginBottom: 8 }}>12. Keine Gewährleistung der Bereitstellung</h3>
        <p>
          Nuvora wird unentgeltlich und ohne Anspruch auf ständige Verfügbarkeit, Fehlerfreiheit
          oder Weiterführung bereitgestellt. Es besteht <strong>kein Rechtsanspruch auf die
          (dauerhafte) Bereitstellung des Dienstes</strong>. Der Betrieb kann jederzeit ohne
          Vorankündigung eingeschränkt, unterbrochen oder eingestellt werden. Nutzende sollten
          eigene Sicherungen wichtiger Daten (z.&nbsp;B. Auswertungen, Exporte) vornehmen.
        </p>

        <h3 style={{ fontSize: 17, fontWeight: 600, marginTop: 24, marginBottom: 8 }}>13. Marktplatz — Haftungsausschluss für fremde Inhalte</h3>
        <p>
          Über den Marktplatz können Nutzende eigene Fragensets veröffentlichen, die von anderen
          Nutzenden übernommen werden können. Diese Inhalte stammen von Dritten (anderen
          Nutzenden) und werden vor Veröffentlichung nicht inhaltlich durch den Betreiber geprüft.
          Der Betreiber <strong>übernimmt keine Verantwortung und keine Haftung für die
          Richtigkeit, Rechtmäßigkeit oder Qualität</strong> im Marktplatz veröffentlichter
          Inhalte. Für veröffentlichte Inhalte ist ausschließlich die hochladende Person
          verantwortlich. Rechtsverletzende Inhalte können gemeldet werden; die Kontaktdaten
          stehen oben im Impressum.
        </p>

        <h3 style={{ fontSize: 17, fontWeight: 600, marginTop: 24, marginBottom: 8 }}>14. Entfernung von Inhalten und Konten</h3>
        <p>
          Der Betreiber behält sich vor, veröffentlichte Marktplatz-Inhalte, einzelne Daten oder
          ganze Konten <strong>jederzeit und ohne vorherige Ankündigung oder Angabe von Gründen
          zu entfernen bzw. zu löschen</strong> — etwa bei Verdacht auf rechtswidrige, unangemessene
          oder missbräuchliche Inhalte, bei technischer Notwendigkeit oder bei Einstellung des
          Dienstes. Ein Anspruch auf Wiederherstellung entfernter Inhalte besteht nicht.
        </p>
      </section>

      <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 32 }}>
        Stand: Juli 2026
      </p>
    </div>
  );
}
