import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { COLORS as C, pageApp, pageTitle, panelStyle } from "../components/Icons.jsx";

// Rechtstext, kein Werkzeug: die Seite hat nur zwei Überschriftenstufen und
// braucht sie vierzehnmal. Einmal aus der Schrift-Leiter abgeleitet statt an
// jeder Stelle eine eigene Größe zu setzen (dort standen 17er).
const h2Style = { ...pageTitle, marginBottom: 24 };
const h3Style = { fontSize: 16, fontWeight: 600, marginBottom: 8 };

const FALLBACK ={ betreiber: "[Name eintragen]", strasse: "[Straße]", plz_ort: "[PLZ Ort]", email: "kontakt@example.com" };

export default function Legal() {
  const [cfg, setCfg] = useState(FALLBACK);
  useEffect(() => {
    // Betreiberdaten kommen zentral aus Nuvoras config/site.json — dieselbe
    // Quelle, die auch Lernpfad liest. Der Proxy liefert sie unter /site.json
    // aus (siehe nginx.conf).
    fetch("/site.json").then((r) => r.ok ? r.json() : FALLBACK).then(setCfg).catch(() => {});
  }, []);

  const { betreiber: name, strasse: street, plz_ort: city, email, telefon, land, verantwortlich } = cfg;
  const mailto = `mailto:${email}`;

  return (
    <div style={{ ...pageApp, lineHeight: 1.7, color: "var(--text)" }}>
      {/* Entwicklungsstatus: die Anwendung ist im Aufbau (Alpha/Beta). Realer
          Hinweis, weil echte Daten betroffen sind. */}
      <div style={{ ...panelStyle, marginBottom: 24, border: `1px solid ${C.warning}`, background: C.warning + "1a", fontSize: 14 }}>
        <strong>Hinweis zum Entwicklungsstand.</strong> Nuvora befindet sich in
        aktiver Entwicklung (Alpha/Beta). Es besteht <strong>kein Anspruch auf
        die erstellten Daten</strong>: im Zuge der Weiterentwicklung können Daten
        verändert werden oder verloren gehen. Verlasse dich nicht als einzige
        Quelle darauf — bewahre Noten und wichtige Unterlagen zusätzlich außerhalb
        des Systems auf.
      </div>

      <h2 style={{ ...h2Style }}>Impressum</h2>

      <section style={{ marginBottom: 32 }}>
        <p style={{ fontSize: 13, color: "var(--text3)", marginBottom: 12 }}>Angaben gemäß § 5 DDG (ehem. TMG)</p>

        <p>
          <strong>{name}</strong><br />
          {street}<br />
          {city}{land ? <><br />{land}</> : null}
        </p>

        {/* § 5 Abs. 1 Nr. 2 DDG verlangt Angaben, die eine unmittelbare
            Kommunikation ermoeglichen — E-Mail plus ein zweiter Weg. Telefon
            steht in config/site.json und wurde hier bisher nicht ausgegeben. */}
        <p style={{ marginTop: 12 }}>
          <strong>Kontakt:</strong><br />
          E-Mail: <a href={mailto} style={{ color: "var(--accent)" }}>{email}</a>
          {telefon ? <><br />Telefon: {telefon}</> : null}
          <br />
          <Link to="/contact" style={{ color: "var(--accent)" }}>Kontaktformular</Link>
        </p>

        <p style={{ marginTop: 12 }}>
          <strong>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV:</strong><br />
          {verantwortlich || name}<br />
          {street}<br />
          {city}
        </p>
      </section>

      <h2 style={{ ...h2Style }}>Datenschutzerklärung</h2>

      <section style={{ marginBottom: 32 }}>
        <h3 style={{ ...h3Style }}>1. Verantwortlicher</h3>
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

        <h3 style={{ ...h3Style, marginTop: 24 }}>2. Allgemeines zur Datenverarbeitung</h3>
        <p>
          Nuvora ist ein selbstgehosteter Werkzeugkasten für Lehrkräfte mit zuschaltbaren Modulen
          (u.&nbsp;a. Abstimmungen, Karteikarten, Noten, Kalender). Die Verarbeitung personenbezogener
          Daten erfolgt ausschließlich zur Bereitstellung und Nutzung der Anwendung. Eine Weitergabe an
          Dritte findet nicht statt — ausgenommen die Übermittlungen, die die Lehrkraft selbst auslöst
          (siehe Abschnitt 5).
        </p>

        <h3 style={{ ...h3Style, marginTop: 24 }}>3. Rechtsgrundlagen</h3>
        <p>
          Die Verarbeitung personenbezogener Daten erfolgt auf folgenden Rechtsgrundlagen:
        </p>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>Art. 6 Abs. 1 lit. b DSGVO</strong> — Vertragserfüllung: Registrierung und Nutzung des Dienstes (Lehrkraft-Konten).</li>
          <li><strong>Art. 6 Abs. 1 lit. f DSGVO</strong> — Berechtigtes Interesse: Betrieb und Sicherheit der Anwendung, insbesondere Schutz vor automatisierten Angriffen (Zugriffszählung je IP-Adresse im Arbeitsspeicher).</li>
          <li><strong>Art. 6 Abs. 1 lit. a DSGVO</strong> — Einwilligung: Soweit die nutzende Lehrkraft bzw. Schule Daten von Lernenden eingibt, ist diese für die Einholung einer ggf. erforderlichen Einwilligung der Betroffenen (bzw. der Erziehungsberechtigten) selbst verantwortlich.</li>
        </ul>

        <h3 style={{ ...h3Style, marginTop: 24 }}>4. Art der verarbeiteten Daten</h3>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>Nutzungsdaten der Lehrkraft:</strong> E-Mail-Adresse, Name, Passwort (als gesalzener Hash gespeichert, nicht im Klartext).</li>
          <li><strong>Daten der Lernenden:</strong> Name und zugewiesene Kartennummer, eingegeben durch die Lehrkraft. Optional E-/G-Kurs, Klassenleitung sowie – soweit von der Lehrkraft erfasst – Förderschwerpunkte und Notizen.</li>
          <li><strong>Besondere Kategorien (Art. 9 DSGVO):</strong> Angaben zu Förderschwerpunkten (z.&nbsp;B. LRS, Dyskalkulie) und Notizen zu Nachteilsausgleichen können besondere Kategorien personenbezogener Daten darstellen. Diese Angaben werden ausschließlich auf dem Server des Verantwortlichen verarbeitet, erscheinen in keiner Veröffentlichung (Marktplatz) und in keinem teilbaren Export. Enthalten sind sie
          nur in der <strong>eigenen Datenauskunft</strong> der Lehrkraft (Profil, Export aller eigenen Daten) und
          in den <strong>Sicherungen</strong> des Servers (Abschnitt 8). Rechtsgrundlage und Erforderlichkeit ihrer Erhebung liegen in der Verantwortung der erhebenden Lehrkraft bzw. Schule (in der Regel Schulgesetz/-verordnung des jeweiligen Landes). Für die Bereitstellung des Systems stützt sich der Verantwortliche auf Art. 9 Abs. 2 lit. g DSGVO in Verbindung mit § 22 BDSG bzw. den Schulgesetzen der Länder.</li>
          <li><strong>Modul-Daten der Lernenden:</strong> je nach genutztem Modul – Abstimmungsergebnisse (CardVote: Antworten pro Frage und Session), Bewertungen und Beobachtungen (Noten), Lernfortschritt beim Karteikarten-Üben (Karten), Anwesenheit und Fehlzeiten (Anwesenheit), Sitzpositionen (Sitzplan) sowie Unterrichtsplanung mit Klassen- und Themenbezug (Kalender). Alle diese Daten gibt die Lehrkraft ein bzw. erfasst sie im Unterricht.</li>
          <li><strong>Pseudonymer Zugang der Lernenden (Modul Karten):</strong> Zum Üben ohne Konto erhält jede Person einen zufälligen, geheimen Token (in einem QR-Code/Link). Er dient allein dazu, den Übungsfortschritt der richtigen Person zuzuordnen; ein Login findet nicht statt. Wer den Link kennt, kann üben – die Lehrkraft gibt ihn gezielt aus.</li>
          <li><strong>Öffentliche Spielsitzung (Modul Code-Detektiv):</strong> Zum Mitspielen ohne Konto tritt die Lernperson über einen sechsstelligen Sitzungscode bei und gibt dabei einen selbstgewählten Namen an. Innerhalb der Sitzung sind dieser Name und der Lösungsstand für alle Teilnehmenden mit dem Code sichtbar. Sitzungen werden automatisch gelöscht: beendete nach einem Tag, offen gebliebene nach sieben. Die Lehrkraft sollte statt des vollen Namens ein Kürzel vergeben lassen.</li>
          <li><strong>Kamerabilder:</strong> Werden beim Scannen (CardVote) kurzfristig im Arbeitsspeicher verarbeitet, um ArUco-Marker zu erkennen. Es erfolgt keine dauerhafte Speicherung der Bilder.</li>
          <li><strong>Technische Zugriffsdaten:</strong> IP-Adresse im Arbeitsspeicher für den Schutz vor automatisierten Angriffen (Zugriffszählung, nicht dauerhaft). Zusätzlich schreibt der Webserver ein <strong>Zugriffsprotokoll</strong> mit IP-Adresse, Zeitpunkt, aufgerufener Adresse (Zugangs-Codes und Tokens darin unkenntlich gemacht), Statuscode und Browserkennung. Es wird nach Größe rotiert (höchstens drei Dateien zu je 10&nbsp;MB) und damit je nach Aufkommen nach einigen Tagen bis Wochen überschrieben.</li>
        </ul>

        <h3 style={{ ...h3Style, marginTop: 24 }}>5. Speicherung und Speicherort</h3>
        <p>
          Alle Daten werden ausschließlich auf dem Server des Verantwortlichen gespeichert.
          Ausgenommen ist der Versand von E-Mails (Bestätigung der Registrierung, Passwort-Reset,
          Kontaktformular): Läuft er über einen externen Anbieter, verarbeitet dieser die
          Empfängeradresse und den Inhalt der Nachricht im Auftrag des Verantwortlichen
          (Art. 28 DSGVO). Daten von Lernenden werden dabei nicht übermittelt.
          Die Datenübertragung zwischen Browser und Server ist durch HTTPS (TLS) verschlüsselt.
        </p>
        <p style={{ marginTop: 8 }}>
          Darüber hinaus werden Daten nur übermittelt, wenn die Lehrkraft das <strong>selbst einrichtet
          oder auslöst</strong>:
        </p>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>WebUntis-Import (Modul Kalender):</strong> Die eingegebenen WebUntis-Zugangsdaten gehen einmalig an den Untis-Server der Schule, um den Stundenplan abzurufen. Das Passwort wird nicht gespeichert; gemerkt werden nur Serveradresse, Schule, Benutzername bzw. der Abo-Link.</li>
          <li><strong>Kalender-Abo (ICS) und CalDAV:</strong> Richtet die Lehrkraft das Abo oder einen Gerätezugang ein, ruft der von ihr gewählte Kalenderdienst (z.&nbsp;B. Apple iCloud, Google, Microsoft) die Termine ab. Übermittelt werden dabei Termintitel, Kurs- und Klassennamen, Orte, Notizen und die Texte terminierter Aufgaben (To-dos). Was dieser Dienst damit tut, richtet sich nach dessen Bedingungen.</li>
          <li><strong>Abonnierte fremde Kalender:</strong> Trägt die Lehrkraft die Adresse eines fremden Kalenders ein, ruft der Server diese Adresse regelmäßig ab; der Anbieter sieht dabei die IP-Adresse des Servers.</li>
        </ul>

        <h3 style={{ ...h3Style, marginTop: 24 }}>6. Speicherdauer und Löschung</h3>
        <p>
          Daten der Lernenden und Abstimmungsergebnisse werden gespeichert, solange die zugehörige
          Klasse bzw. Session in der Anwendung existiert. Die Lehrkraft kann Klassen, Sessions und
          alle zugehörigen Daten jederzeit eigenständig löschen. Konten der Lehrkraft können über
          die Profil-Seite selbst gelöscht werden; dabei werden alle zugehörigen Daten entfernt.
          Ausgenommen sind abgeschickte <strong>Fehlermeldungen</strong>: sie bleiben ohne Kontobezug bis
          zum Ablauf ihrer Frist bestehen (Abschnitt 7), ihr Anhang und das beigelegte Protokoll werden mit
          dem Konto gelöscht. In den <strong>Sicherungen</strong> bleiben gelöschte Daten enthalten, bis die
          betreffende Sicherung rotiert wird (Abschnitt 8).
        </p>
        <p>Automatisch gelöscht wird:</p>
        <ul style={{ paddingLeft: 20 }}>
          <li><strong>Papierkorb:</strong> gelöschte Klassen, Kurse, Kartenstapel, Karten, Lernpfade, Lernleitern, Aufgaben, Fragen, Themen, PAP-Aufgaben und Personen nach <strong>30 Tagen</strong> endgültig.</li>
          <li><strong>Unbestätigte Konten:</strong> nach <strong>14 Tagen</strong> ohne Bestätigung der E-Mail-Adresse.</li>
          <li><strong>Spielsitzungen (Code-Detektiv):</strong> beendete nach <strong>einem Tag</strong>, offen gebliebene nach <strong>sieben Tagen</strong>.</li>
          <li><strong>Anmelde-Token:</strong> laufen nach <strong>30 Tagen</strong> ohne Nutzung ab.</li>
          <li><strong>Fehlermeldungen:</strong> nach <strong>180 Tagen</strong>.</li>
        </ul>
        <p>
          Die Übungs-Zugänge der Lernenden (QR-Code/Link im Modul Karten) kann die Lehrkraft
          jederzeit neu vergeben; bisherige Links werden damit sofort ungültig.
        </p>

        <h3 style={{ ...h3Style, marginTop: 24 }}>7. Fehlermeldungen</h3>
        <p>
          Angemeldete Lehrkräfte können über den Knopf „Fehler melden" eine Meldung abschicken. Sie
          enthält den eingegebenen Text und — jeweils einzeln abwählbar — ein <strong>Protokoll</strong> der
          letzten Schritte in der Anwendung (Seitenwechsel, fehlgeschlagene Aufrufe, Fehlertexte; ohne
          Seiteninhalte, Formularwerte und ohne Kennungen von Klassen oder Personen), Angaben zur
          <strong> Umgebung</strong> (Bildschirmgröße, Browser, Sprache, Zeitzone, aktive Module) sowie
          optional einen selbst gewählten <strong>Anhang</strong> (z.&nbsp;B. ein Bildschirmfoto). Was
          mitgeht, lässt sich vor dem Absenden im Klartext ansehen. Der Anhang kann Inhalte tragen, die die
          Lehrkraft auswählt — personenbezogene Daten von Lernenden sollten darin nicht zu sehen sein.
        </p>
        <p style={{ marginTop: 8 }}>
          Meldungen werden in der Datenbank des Servers gespeichert und sind <strong>nur für die
          Administration</strong> einsehbar. Sie werden nach <strong>180 Tagen</strong> automatisch gelöscht,
          früher, sobald die Administration sie löscht.
        </p>

        <h3 style={{ ...h3Style, marginTop: 24 }}>8. Sicherungen</h3>
        <p>
          Zum Schutz vor Datenverlust erstellt der Server regelmäßig Sicherungen der gesamten Datenbank und
          der hochgeladenen Dateien. Sie enthalten sämtliche gespeicherten Daten, einschließlich der Angaben
          nach Art. 9 DSGVO, und liegen beim Verantwortlichen. Aufbewahrt wird eine feste Zahl von
          Sicherungen (voreingestellt <strong>sieben</strong>); die jeweils älteste wird beim Anlegen einer neuen
          entfernt. Gelöschte Daten sind daher noch so lange in den Sicherungen enthalten, bis die letzte
          Sicherung, die sie trägt, rotiert wurde. Eine Sicherung wird nur zur Wiederherstellung nach einem
          Fehler verwendet.
        </p>

        <h3 style={{ ...h3Style, marginTop: 24 }}>9. Cookies und Tracking</h3>
        <p>
          Nuvora verwendet <strong>keine Cookies</strong> und <strong>keine Tracking-Dienste</strong>.
          Die Authentifizierung erfolgt über ein Token, das ausschließlich im lokalen Speicher
          (localStorage) des Browsers abgelegt wird. Externe Analyse- oder Werbedienste werden nicht eingesetzt.
        </p>
        <p style={{ marginTop: 8 }}>
          Zusätzlich legt die Anwendung im Browser (localStorage) eigene Daten der Lehrkraft ab, damit Seiten
          schneller erscheinen und Entwürfe ein Neuladen überstehen: einen <strong>Anzeige-Zwischenspeicher</strong>
          (z.&nbsp;B. Klassen, Kurse, Themen, aktive Module), die <strong>Einrichtung der Startseite</strong>, den
          <strong> Arbeitsstand der Tafel</strong> und weitere Entwürfe (z.&nbsp;B. Ablaufpläne) sowie den
          <strong> Zwischenspeicher des Lernpfads</strong> mit Aufgaben, Klassen und den <strong>Namen der
          Lernenden</strong> (ohne Förderangaben und Notizen). Für den Offline-Betrieb legt der
          Service-Worker zusätzlich die abgerufenen Daten in einem Zwischenspeicher des Browsers ab.
          Diese Daten verbleiben im Browser der Lehrkraft, werden nicht an Dritte übertragen und
          <strong>beim Abmelden entfernt</strong> — einschließlich des Offline-Zwischenspeichers.
        </p>
        <p style={{ marginTop: 8 }}>
          Eine Ausnahme davon sind <strong>offline getätigte Änderungen</strong>, die noch nicht zum Server
          übertragen werden konnten: sie warten in einer Warteschlange im Browser, bis wieder eine Verbindung
          besteht — sie beim Abmelden zu löschen hieße, unwiederbringlich Arbeit zu verwerfen. Sie tragen das
          Konto, zu dem sie gehören, und werden nie unter einem anderen übertragen.
        </p>
        <p style={{ marginTop: 8 }}>
          Sämtliche Schriften und Bibliotheken (u.&nbsp;a. KaTeX zur Formeldarstellung) werden
          lokal vom eigenen Server ausgeliefert — es werden keine Inhalte von Drittanbieter-CDNs
          geladen und somit keine IP-Adressen an Dritte übermittelt.
        </p>

        <h3 style={{ ...h3Style, marginTop: 24 }}>10. Rechte der betroffenen Personen</h3>
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

        <h3 style={{ ...h3Style, marginTop: 24 }}>11. Beschwerderecht bei einer Aufsichtsbehörde</h3>
        <p>
          Betroffene Personen haben das Recht, sich bei einer Datenschutz-Aufsichtsbehörde über
          die Verarbeitung ihrer personenbezogenen Daten zu beschweren. Eine Liste der
          Aufsichtsbehörden finden Sie unter:&nbsp;
          <a href="https://www.bfdi.bund.de/DE/Service/Anschriften/Laender/Laender-node.html" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
            bfdi.bund.de
          </a>.
        </p>

        <h3 style={{ ...h3Style, marginTop: 24 }}>12. Wer ist für die Daten der Lernenden verantwortlich?</h3>
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

        <h3 style={{ ...h3Style, marginTop: 24 }}>13. Sicherheit</h3>
        <p>
          Passwörter werden mit Argon2id gehasht und gesalzen gespeichert.
          Die Kommunikation ist durchgehend TLS-verschlüsselt. Der Zugriff auf Daten ist durch
          Authentifizierung und Autorisierung geschützt; jede Lehrkraft sieht ausschließlich
          die eigenen Klassen, Fragen und Sessions.
        </p>

        <h3 style={{ ...h3Style, marginTop: 24 }}>14. Keine Gewährleistung der Bereitstellung</h3>
        <p>
          Nuvora wird unentgeltlich und ohne Anspruch auf ständige Verfügbarkeit, Fehlerfreiheit
          oder Weiterführung bereitgestellt. Es besteht <strong>kein Rechtsanspruch auf die
          (dauerhafte) Bereitstellung des Dienstes</strong>. Der Betrieb kann jederzeit ohne
          Vorankündigung eingeschränkt, unterbrochen oder eingestellt werden. Nutzende sollten
          eigene Sicherungen wichtiger Daten (z.&nbsp;B. Auswertungen, Exporte) vornehmen.
        </p>

        <h3 style={{ ...h3Style, marginTop: 24 }}>15. Marktplatz — Haftungsausschluss für fremde Inhalte</h3>
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

        <h3 style={{ ...h3Style, marginTop: 24 }}>16. Entfernung von Inhalten und Konten</h3>
        <p>
          Der Betreiber behält sich vor, veröffentlichte Marktplatz-Inhalte, einzelne Daten oder
          ganze Konten <strong>jederzeit und ohne vorherige Ankündigung oder Angabe von Gründen
          zu entfernen bzw. zu löschen</strong> — etwa bei Verdacht auf rechtswidrige, unangemessene
          oder missbräuchliche Inhalte, bei technischer Notwendigkeit oder bei Einstellung des
          Dienstes. Ein Anspruch auf Wiederherstellung entfernter Inhalte besteht nicht.
        </p>
      </section>

      <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 32 }}>
        Stand: September 2026
      </p>
    </div>
  );
}
