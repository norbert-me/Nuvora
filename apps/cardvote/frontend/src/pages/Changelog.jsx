const ENTRIES = [
  {
    version: "1.4.4",
    date: "2026-07-17",
    changes: [
      "Auswertung: Gesamt-Konfidenzintervall für das ganze Quiz als Kennzahl-Kachel — alle Antworten des Tests gepoolt, zeigt wie belastbar das Gesamtergebnis ist",
      "ⓘ-Erklärung unterscheidet jetzt die drei Ebenen: gesamtes Quiz, pro Frage in diesem Test, und alle jemals gegebenen Antworten (im Fragen-Editor)",
    ],
  },
  {
    version: "1.4.3",
    date: "2026-07-17",
    changes: [
      "Auswertung: 95%-Konfidenzintervall jetzt auch pro Frage in der normalen Test-Auswertung — als Zeile in der Übersichtstabelle und als Kennzahl in der Frage-Detailansicht, mit ⓘ-Erklärung",
    ],
  },
  {
    version: "1.4.2",
    date: "2026-07-17",
    changes: [
      "Sprachwahl (DE/EN/ES) jetzt auch nach der Anmeldung in der Navigation verfügbar — nur Auswertungs-Detailseiten und Hilfe sind noch auf Deutsch",
    ],
  },
  {
    version: "1.4.1",
    date: "2026-07-17",
    changes: [
      "Deploy: package.json/package-lock.json werden jetzt mit übertragen — der Server-Build scheiterte, weil neue Abhängigkeiten (lokale Schriften, KaTeX) dort fehlten",
    ],
  },
  {
    version: "1.4.0",
    date: "2026-07-17",
    changes: [
      "Mehrsprachigkeit (3. Runde): Profil, Fragen-Editor (inkl. Import-Fortschritt, Veröffentlichen-Dialog, Statistiken) und komplette Live-Session sind jetzt in Deutsch/Englisch/Spanisch verfügbar",
      "Noch offen: Auswertungs-Detailseiten und Hilfe — bis dahin bleibt die Sprachwahl vor der Anmeldung",
    ],
  },
  {
    version: "1.3.8",
    date: "2026-07-16",
    changes: [
      "Mehrsprachigkeit (2. Runde): Startseite nach Login, Klassen, Scanner, Marktplatz, Auswertungs-Liste, Kontakt sowie E-Mail-Bestätigungs- und Passwort-Reset-Seiten sind jetzt in Deutsch/Englisch/Spanisch verfügbar",
      "Datumsformate folgen der gewählten Sprache",
      "Noch offen: Fragen-Editor, Live-Session, Profil, Auswertungs-Detail und Hilfe — bis dahin bleibt die Sprachwahl vor der Anmeldung",
    ],
  },
  {
    version: "1.3.7",
    date: "2026-07-16",
    changes: [
      "Datenschutz: Schriften (Inter) und Formel-Bibliothek (KaTeX) werden jetzt lokal ausgeliefert statt von Google- und jsdelivr-CDNs — keine IP-Übermittlung an Dritte mehr (relevant nach LG-München-Urteil zu Google Fonts)",
      "Sicherheit: Content-Security-Policy verschärft — keine externen Hosts mehr erlaubt",
      "Performance: KaTeX lädt nur noch bei tatsächlicher Formel-Anzeige (eigener Chunk statt im Haupt-Bundle)",
      "Datenschutzerklärung entsprechend aktualisiert (CDN-Absatz ersetzt)",
    ],
  },
  {
    version: "1.3.6",
    date: "2026-07-16",
    changes: [
      "Neue Hilfe-Seite mit Anleitung (Karten drucken/falten, Session-Ablauf, Scan-Tipps) und häufigen Fragen — im Footer verlinkt",
      "Sicherheit: Das Admin-Konto kann sich nicht mehr selbst löschen (danach gäbe es dauerhaft keinen Admin mehr)",
      "Scanner: Session-Code findet nur noch eigene Sessions — vorher konnte man bei Code-Gleichheit in der Session einer anderen Lehrkraft landen und bekam unverständliche Fehler",
      "Begriffe vereinheitlicht: überall Session-Code (statt Session-ID), Test (statt Lernerhebung), Frageset (statt Quiz im Marktplatz)",
      "Registrierung: überflüssiges Namensfeld entfernt (der Benutzername wird im Profil gepflegt)",
      "Scanner: Checkbox heißt jetzt „Erkennung anzeigen\" statt „Debug\"",
      "Sprachwahl vorerst nur vor der Anmeldung sichtbar, bis alle Seiten übersetzt sind (kein halb übersetztes Erscheinungsbild)",
    ],
  },
  {
    version: "1.3.5",
    date: "2026-07-16",
    changes: [
      "Sicherheit: Rate-Limit-Umgehung per gefälschtem X-Forwarded-For-Header geschlossen — IP-Ermittlung vertraut jetzt nur dem vom eigenen Server gesetzten Header",
      "Sicherheit: E-Mail-Header-Injection im Kontaktformular verhindert (Zeilenumbrüche in Name/E-Mail werden entfernt)",
      "Performance: Datenbank-Indizes auf allen häufig gefilterten Spalten ergänzt (Scans, Lernende, Fragesets, Sessions u.a.) — Auswertungen und Live-Sessions deutlich schneller bei wachsender Datenmenge",
      "Aufräumen: ungenutzte Endpoints (auth/me, Admin-Passwort-Setzen) und toten Frontend-Code entfernt",
    ],
  },
  {
    version: "1.3.4",
    date: "2026-07-16",
    changes: [
      "Code-Review: ungenutzten Rest-Code auf der Anmeldeseite entfernt (überflüssiger Konfigurations-Abruf bei jedem Seitenaufruf)",
    ],
  },
  {
    version: "1.3.3",
    date: "2026-07-16",
    changes: [
      "Mehrsprachigkeit (Start): Sprachauswahl Deutsch/Englisch/Spanisch in der Navigation — Navigation, Startseite und Anmeldung sind übersetzt, weitere Seiten folgen schrittweise",
    ],
  },
  {
    version: "1.3.2",
    date: "2026-07-16",
    changes: [
      "Marktplatz: Anzeigename ist jetzt live verknüpft — bei Änderung des Benutzernamens im Profil aktualisiert er sich überall im Marktplatz automatisch (kein alter Stand mehr)",
      "Marktplatz: Autoren-Name ist anklickbar und zeigt alle Quiz dieser Person (mit Filter-Hinweis und Zurücksetzen-Möglichkeit)",
    ],
  },
  {
    version: "1.3.1",
    date: "2026-07-16",
    changes: [
      "Repository-Audit: verwaisten, unbenutzten iOS-Prototyp-Ordner (nach Konkurrenzprodukt benannt) entfernt",
      "Restliche Konkurrenzprodukt-Nennungen aus Paketname und Changelog-Historie entfernt",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-07-16",
    changes: [
      "Profil: „Anzeigename\" (Anrede + Nachname) entfernt, ersetzt durch einen einzigen „Benutzername\" — dieselbe Kennung wie im Marktplatz",
      "Marktplatz-Veröffentlichung: Namensfeld beim Hochladen entfernt — es wird automatisch der Benutzername aus dem Profil verwendet",
      "Navigation: Personenname aus der Menüleiste entfernt, zeigt jetzt „Profil\"",
    ],
  },
  {
    version: "1.2.6",
    date: "2026-07-15",
    changes: [
      "„+ Neues Frageset\" und „+ Neue Klasse\" von Blau auf monochrom (Apple-Stil) umgestellt",
      "„Import & Vorlagen\"-Button auf einheitliche Größe der übrigen Buttons angeglichen",
    ],
  },
  {
    version: "1.2.5",
    date: "2026-07-15",
    changes: [
      "Fragen & Klassen: Import-Buttons und Vorlagen-Downloads in ein Dropdown-Menü „Import & Vorlagen\" zusammengefasst — weniger Buttons in der Werkzeugleiste, klare Trennung Import (Upload-Symbol) vs. Vorlage (Download-Symbol)",
      "Info-Symbol beim JSON-Beispiel entfernt (unnötig)",
    ],
  },
  {
    version: "1.2.4",
    date: "2026-07-15",
    changes: [
      "Download-Buttons app-weit vereinheitlicht: eigenes Download-Symbol statt uneinheitlicher Textlinks/„↓\"-Zeichen (Fragen, Klassen, Auswertung)",
      "Dark-Mode-Fehler behoben: Import-Buttons unter Fragen waren fest schwarz statt themenabhängig",
    ],
  },
  {
    version: "1.2.3",
    date: "2026-07-15",
    changes: [
      "Wichtiger Fix: Service Worker lud nach jedem Deploy weiterhin die alte, gecachte Version der Seite aus — Deploys kamen bei wiederkehrenden Besuchen nie an. HTML/Navigation läuft jetzt netzwerk-first",
      "Fragen: JSON-Beispiel zum Download und Info-Symbol mit Erklärung des JSON-Aufbaus neben den Import-Buttons",
    ],
  },
  {
    version: "1.2.2",
    date: "2026-07-15",
    changes: [
      "Mitwirken-Hinweis jetzt auch auf der Startseite für angemeldete Nutzende sichtbar (vorher nur vor dem Login)",
    ],
  },
  {
    version: "1.2.1",
    date: "2026-07-15",
    changes: [
      "Neues Kontaktformular — sendet direkt an die hinterlegte Admin-E-Mail, im Footer jeder Seite verlinkt",
      "Startseite: Hinweis auf Mitwirken — Ideen, Vorschläge und Fehler per Kontaktformular melden",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-07-15",
    changes: [
      "README überarbeitet: Marktplatz, E-Mail-Bestätigung/Passwort-Reset, Sicherheits-Features, Konfidenzintervall und Tendenznoten ergänzt",
      "README: Kontakt-Abschnitt (GitHub Issues) und SMTP-Konfigurationsvariablen dokumentiert",
    ],
  },
  {
    version: "1.1.9",
    date: "2026-07-14",
    changes: [
      "Verbindungsfehler-Hinweis als schlanker Balken über dem Header statt vollflächigem Popup — verdeckt keine Inhalte mehr",
      "Datenschutzerklärung erweitert: Verantwortlichkeit für Lernenden-Daten klargestellt, kein Anspruch auf Bereitstellung, Haftungsausschluss für Marktplatz-Inhalte, Recht auf Löschung ohne Vorankündigung",
    ],
  },
  {
    version: "1.1.8",
    date: "2026-07-14",
    changes: [
      "Anmelden-Link in der Navigation springt jetzt auch aus dem Passwort-vergessen-Modus zurück zur Anmeldemaske",
      "Handy: Burger-Menü schließt sich beim Klick auf das Profil-/Anmelden-Symbol",
      "Notenverteilung: umschaltbar zwischen ganzen Noten und Teilnoten (Tendenznoten mit .0/.3/.7)",
    ],
  },
  {
    version: "1.1.7",
    date: "2026-07-14",
    changes: [
      "Admin-Bereich: Design an den Rest der Seite angeglichen (monochrom statt farbiger Akzente)",
      "Admin-Bereich: Version und Kontenverwaltung zeigen jetzt einen Ladehinweis statt kommentarlos zu erscheinen",
    ],
  },
  {
    version: "1.1.6",
    date: "2026-07-14",
    changes: [
      "Deploy: pip install mit höherem Timeout und Retries gegen vereinzelte Netzwerk-Timeouts beim Docker-Build",
    ],
  },
  {
    version: "1.1.5",
    date: "2026-07-14",
    changes: [
      "Deploy: rsync überträgt jetzt nur noch Dateiinhalte (kein chmod/chown/utimes) — NAS erlaubte auch Rechte-Übertragung nicht",
    ],
  },
  {
    version: "1.1.4",
    date: "2026-07-14",
    changes: [
      "Deploy: rsync-Zeitstempel-Übertragung entfernt (schlug auf dem NAS-Mount mit 'Operation not permitted' fehl)",
    ],
  },
  {
    version: "1.1.3",
    date: "2026-07-14",
    changes: [
      "Profil: Admin-Bereich (Version, Kontenverwaltung) optisch klar vom persönlichen Profil abgetrennt (eigene Sektion mit Trennlinie und Markierung)",
    ],
  },
  {
    version: "1.1.2",
    date: "2026-07-14",
    changes: [
      "Profil: E-Mail-Adresse kann geändert werden, wird aber erst nach Bestätigung per Link an der neuen Adresse aktiv",
    ],
  },
  {
    version: "1.1.1",
    date: "2026-07-14",
    changes: [
      "Fragen-Statistik: 95%-Konfidenzintervall für den Anteil richtiger Antworten, mit Erklärung per Info-Symbol",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-07-14",
    changes: [
      "Sicherheit: E-Mail-Adressen im Marktplatz nicht mehr öffentlich sichtbar (Anzeigename fiel bisher auf die E-Mail zurück, wenn kein Name gesetzt war)",
      "Admin: sieht im Marktplatz zusätzlich die E-Mail der veröffentlichenden Person (nur für Admin sichtbar, zur Moderation)",
    ],
  },
  {
    version: "1.0.5",
    date: "2026-07-13",
    changes: [
      "Registrierung: E-Mail muss per Link bestätigt werden, bevor man sich anmelden kann",
      "Unbestätigte Konten werden nach 14 Tagen automatisch gelöscht (bestehende Konten ausgenommen)",
      "Anmeldung: Hinweis wenn E-Mail noch nicht bestätigt, mit Button zum erneuten Senden der Bestätigungs-Mail",
      "Admin: Passwort-Setzen im Kontenpanel entfernt (Nutzer setzen selbst per Passwort-vergessen-Funktion)",
    ],
  },
  {
    version: "1.0.4",
    date: "2026-07-13",
    changes: [
      "Registrierung: kein Auto-Login mehr — Hinweis auf Bestätigungs-E-Mail, danach anmelden",
      "Admin: Mail-Test (POST /api/mail-test) zeigt den echten SMTP-Fehler zur Diagnose",
      "E-Mail-Versand: Willkommens-Mail bei der Registrierung",
      "Passwort vergessen: Zurücksetzen per E-Mail-Link (1 Stunde gültig, einmalig verwendbar) statt Kontakt zur Administration",
      "E-Mail-Anbindung provider-neutral über SMTP (z.B. Cloudflare) — per Umgebungsvariablen konfigurierbar",
      "Sicherheit: Missbrauchsschutz gegen Überlastung (Flood-/Rate-Limits pro IP, Body-Größen-Limit, WebSocket-Verbindungslimit, Schutz gegen Session-Code-Brute-Force und Registrierungs-Spam)",
      "Sicherheit: Erstellungs-Limits pro Konto für Fragen, Klassen, Fragesets, Importe und Marktplatz (Veröffentlichen/Übernehmen/Bewerten) — gegen Spam und Massen-Anlage; Klassengröße serverseitig begrenzt",
      "Admin: Versionsanzeige im Profil mit Update-Hinweis, wenn auf GitHub eine neuere Version verfügbar ist",
    ],
  },
  {
    version: "1.0.3",
    date: "2026-07-12",
    changes: [
      "Profil-Seite responsiv: Admin-Kontenverwaltung ist auf schmalen Bildschirmen scrollbar statt überzulaufen",
      "Löschen-Aktionen einheitlich als rotes Papierkorb-Symbol",
      "Seitentitel entfernt — die Navigation zeigt den Namen ohnehin an",
      "Live-Session: Auswahl vor dem Start ist jetzt zentriert",
      "Fragen bearbeiten und neu anlegen jetzt in einem zentrierten Popup — kein Runterscrollen mehr",
      "LaTeX-Editor auch für die Antwortfelder: Formel-Werkzeugleiste wirkt auf das aktive Feld, mit Live-Vorschau pro Antwort",
      "Sicherheit: Zugriffsprüfung auf Klassen, Fragen, Fragesets, Sessions und Auswertungen — nur eigene Daten sind abrufbar (Schutz personenbezogener Daten)",
      "Sicherheit: Statistik-Dashboard und Fragenliste auf eigene Daten beschränkt",
      "Sicherheit: Fernsteuerung der Live-Session erfordert Authentifizierung als Session-Besitzer:in",
      "Import: Fortschrittsanzeige beim Hochladen von Fragesets/Ordnern/Excel (Lesen → Hochladen → Import → Fertig/Fehler) mit klarer Rückmeldung",
      "Verbindungsstatus: Globaler Live-Hinweis auf jeder Seite, sobald der Server nicht erreichbar ist — verschwindet automatisch bei Wiederverbindung",
      "Verbindungsstatus: Health-Check prüft jetzt auch die Datenbank — eigene Meldung, wenn der Server läuft, aber die DB nicht erreichbar ist",
      "Auto-Reconnect: Nach einem Verbindungsausfall bestätigt ein Popup die Wiederverbindung und lädt die Seite automatisch neu",
      "Verbindungsverlust wird schneller erkannt (Health-Check bricht nach 4 s ab, Prüfung alle 5 s)",
      "Klassen: zeigt einen Ladehinweis statt fälschlich 'keine Klassen', solange die Daten noch geladen werden",
    ],
  },
  {
    version: "1.0.2",
    date: "2026-07-11",
    changes: [
      "Live-Session: Beim Aufdecken werden auch ungueltige Antwortfelder (z.B. D bei 3 Optionen) mit Stimmen angezeigt, als gestrichelt markiert",
      "Scanner: Wieder schneller — selbstplanende Scan-Schleife ohne Request-Stau statt starrem 500ms-Takt",
      "Marktplatz: Quiz veröffentlichen (aktueller Stand als Kopie), suchen, nach Neu/Top sortieren und per Klick übernehmen",
      "Marktplatz: Quiz mit 1–5 Sternen bewerten, jederzeit anpassbar",
      "Scanner in die Live-Session integriert — kein eigener Navigationspunkt mehr; „Als Scanner beitreten\" bzw. Scanner-Button in der Session",
      "Fernsteuerung: Vom Handy (Scanner) lassen sich Aufdecken/Verbergen, nächste Frage und Test beenden auslösen — Buttons spiegeln den Host-Zustand",
      "Scanner: Bei Testende steigt der Scanner aus und zeigt einen Hinweis; Session-Code-Eingabe eleganter gestaltet",
      "Marktplatz: Quiz-Inhalt vor dem Übernehmen als Vorschau ansehbar",
      "Marktplatz: Anzeigename pro Upload wählbar, Standard im Profil hinterlegbar",
      "Design: Live-Session durchgängig monochrom (Apple-Stil) statt Blau/Grün/Verlauf",
      "Marktplatz-Upload jetzt direkt unter Fragen am Frageset (Upload-Symbol) statt schwer bedienbarer Auswahlliste",
      "Durchgängig gendergerechte Sprache",
      "Scanner: Kamera wird erst nach Beitritt und Start der Session aktiviert",
    ],
  },
  {
    version: "1.0.1",
    date: "2026-07-10",
    changes: [
      "Mobilansicht: Karten-Grid wechselt auf eine Spalte, Padding angepasst",
      "Kontakt-Mail auf der Login-Seite wird aus legal-config.json geladen statt hartcodiert",
      "README: Deutsch/Englisch aufklappbar mit Sprachauswahl-Links",
      "Login-Seite zeigt Erklärung was CardVote ist, bevor man sich einloggt",
      "Eigenname eines Konkurrenzprodukts entfernt — Beschreibung ist jetzt generisch",
      "Landing Page mit Feature-Übersicht für nicht angemeldete Personen",
      "Login/Registrierung über Profil-Icon in der Navigation erreichbar",
      "Scanner: Debug-Overlay (Kasten + Antwort) funktioniert wieder zuverlässig",
      "Scanner: Debug-Overlay zeigt letzte erkannte Position ohne Verzögerung",
      "Spiel-Modus: Timer kann auf Unbegrenzt gestellt werden (kein Speed-Bonus)",
      "Dark Mode Toggle: SVG-Icons statt Emojis",
      "Home: Flowchart-Layout mit Verbindungslinien statt Karten-Grid",
      "Design: Monochromes Farbschema (Apple-Stil) — Icons, Buttons und Flowchart in Schwarz/Grau statt Blau",
      "Alle Emojis durch SVG-Icons ersetzt (Close-Buttons, Vorschlaege, Spiel-Modus, Scanner)",
      "Klassen: Einzelne Lernende entfernbar (Karten rutschen nach), Hinweis auf Neudruck, Systemlimit (50 Karten) sichtbar",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-07-10",
    changes: [
      "Open Source auf GitHub (CC BY-NC 4.0)",
      "Impressum und Kontaktdaten ausgelagert (legal-config.json)",
      "Token-Secret und Serverdaten nicht mehr im Repository",
      "Session fortsetzen zeigt bereits abgegebene Stimmen korrekt an",
      "LaTeX-Rendering in der Zusammenfassung nach Testabschluss",
      "LaTeX-Konvertierung in PDF-Exporten",
      "Klassen-Übersicht vereinfacht (kein Aufklappen mehr)",
      "Verschiebe-Griff in Fragesets vergrößert",
      "Karten-PDF-Icon korrigiert",
      "GitHub-Link im Footer",
      "PWA: Service Worker, Manifest, Icons für Offline-Nutzung",
      "Scan-Genauigkeit: Mehrfach-Bestätigung vor Speicherung",
    ],
  },
  {
    version: "0.9.0",
    date: "2026-07-09",
    changes: [
      "Drag & Drop für Fragen in Fragesets",
      "Vollbild-Modus während Live-Sessions",
      "Debug-Overlay im Scanner zeigt erkannte Marker mit Namen und Antwort",
      "Neu gescannte Lernende blitzen grün auf in der Scanner-Liste",
      "Mobile Navigation: Burger-Menü, Seitentitel, Profil-Icon",
      "Frage- und Antwort-Texte skalieren mit Bildschirmhöhe",
    ],
  },
  {
    version: "0.8.0",
    date: "2026-07-09",
    changes: [
      "Dezimalnoten (1.0–6.0) mit linearer Interpolation",
      "iDoceo-kompatibler CSV-Export",
      "PDF-Export zeigt nur gescannte Fragen pro Lernende",
      "Gewichtung akzeptiert Dezimalkomma (0,5)",
      "QR-Code funktioniert hinter Cloudflare Tunnel",
      "Scanner auf zweitem Gerät verbindbar",
      "Automatischer Logout bei abgelaufenem Token",
      "Live-Sessions zeigen Beenden statt Fortsetzen",
      "Fortsetzen lädt bestehende Scan-Daten",
    ],
  },
  {
    version: "0.7.0",
    date: "2026-07-08",
    changes: [
      "Auswertungsseite mit Notenverteilung, Boxplot, Trennschärfe",
      "Didaktische Vorschläge (Decken-/Bodeneffekt, Streuung, Ratewahrscheinlichkeit)",
      "Excel- und PDF-Export",
      "Fragen-Statistiken über alle Tests hinweg",
      "Notenschlüssel und Gewichtung pro Test anpassbar",
      "Klassen- und Lernende-Auswertung",
    ],
  },
  {
    version: "0.6.0",
    date: "2026-07-07",
    changes: [
      "Live-Session mit Spiel-Modus (Punkte, Streaks, Bestenliste)",
      "Timer pro Frage mit Countdown-Anzeige",
      "Fragen und Antworten mischen",
      "ArUco-Marker-Erkennung per Kamera",
      "WebSocket-Updates in Echtzeit",
    ],
  },
];

export default function Changelog() {
  return (
    <div>
      {ENTRIES.map((entry) => (
        <div key={entry.version} style={{ marginBottom: 28, padding: 20, background: "var(--bg3)", borderRadius: 16, border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>v{entry.version}</span>
            <span style={{ fontSize: 13, color: "var(--text3)" }}>{entry.date}</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {entry.changes.map((c, i) => (
              <li key={i} style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.8 }}>{c}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
