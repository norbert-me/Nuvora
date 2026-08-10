# Datenschutz — was Nuvora speichert, wo, und wie lange

Diese Seite ist **keine Rechtsberatung** und **keine fertige
Datenschutzerklärung**. Sie ist eine Bestandsaufnahme aus dem Quellcode, damit
du als Betreiberin oder Betreiber dein Verzeichnis von
Verarbeitungstätigkeiten füllen und die Fragen deiner Schulleitung beantworten
kannst. Jede Angabe hier ist im Code belegt; die Dateinamen stehen dabei.

Die Datenschutzerklärung, die deine Instanz **ausliefert**, entsteht zur
Laufzeit unter `/legal` aus `config/site.json` (`apps/web/src/pages/Legal.jsx`).

## Wer ist verantwortlich

**Du.** Nuvora läuft auf deinem Server; das Projekt hat keinen Zugriff auf
deine Daten und ist nicht Auftragsverarbeiter. Praktisch heißt das: Rücksprache
mit Schulleitung und Schulträger, ein Verzeichnis von
Verarbeitungstätigkeiten, ein Blick in die Vorgaben deines Bundeslandes — und
Sicherungen, die du auch **zurückspielen** kannst.

## Der wichtigste Grundsatz

**Lernende haben keine Konten und melden sich nie an.** Sie sind Datensätze,
die die Lehrkraft verwaltet. Es gibt keine Schüler-Anmeldung, kein
Schüler-Passwort und keine Schüler-Sicht auf fremde Daten. Zwei Wege führen
ohne Konto in die Anwendung, beide über ein Geheimnis in der Adresse:

| Weg | Wofür | Widerruf |
| --- | ----- | -------- |
| `/lernen/<token>` | Karteikarten üben (`students.karten_token`) | Token unter Karten → QR-Codes neu vergeben |
| `/cd/<code>` | einer Code-Detektiv-Klassensitzung beitreten | Sitzung endet; Löschung siehe Fristen |

Wer den Link weitergibt, gibt den Zugang weiter. Das ist eine bewusste
Abwägung (siehe [SECURITY.md](../SECURITY.md), „Bekannte Grenzen").

## Welche Daten über Lernende gespeichert werden

Grunddatensatz, Tabelle `students` (`apps/api/app/models.py`):

| Feld | Inhalt |
| ---- | ------ |
| `name` | Name |
| `class_id`, `kurs_id` | Klassen- und Kurszugehörigkeit |
| `card_id` | Nummer der bedruckten ArUco-Karte (CardVote) |
| `niveau` | `E`, `G` oder leer |
| `foerder` | Förderschwerpunkte (JSON) |
| `massnahmen` | vereinbarte Fördermaßnahmen (JSON) |
| `notizen` | Freitext |
| `klassenlehrer` | Klassenleitung dieses Kindes (Freitext) |
| `karten_token` | Geheimnis für den kontenlosen Karten-Zugang |
| `photo`, `photo_mime` | optionales Foto (max. 5 MB) |

Daran hängen die Module. Jede dieser Tabellen enthält personenbezogene Daten:

| Tabelle | Inhalt |
| ------- | ------ |
| `scans` | CardVote-Antworten je Frage und Session |
| `grade_entries` | Noten und Beobachtungseinträge |
| `grade_overrides` | manuell gesetzte Bereichs- oder Endnote |
| `attendance` | Anwesenheitsstatus je Tag und Stunde, mit Freitext-Notiz |
| `card_reviews` | Lernfortschritt je Karteikarte (SM-2) |
| `observations` | formative Beobachtungen (Datum, Kategorie, Text) |
| `parent_contacts` | Elternkontakte (Datum, Kanal, Notiz) |
| `material_loans` | Ausleihen |
| `segel_status` | SEGEL-Stufe je Schüler und Kurs |
| `zufall_draws` | letzte Ziehung und Zähler (Zufallsschüler) |
| `kurs_students` | Kurszugehörigkeit |

Dazu Schülerbezüge, die als JSON in anderen Tabellen liegen:
`learning_ladders.assignments` (welche Aufgabe wem) und `work_analyses`
(Klassenarbeitsergebnisse, Abwesende).

### Besonders schützenswert (Art. 9 DSGVO)

`students.foerder`, `students.massnahmen` und `students.notizen` enthalten
Angaben wie Dyskalkulie, LRS, sozial-emotionalen Förderbedarf und
Nachteilsausgleiche. Das sind Gesundheitsdaten im Sinne von Art. 9.

Regel im Code: **Sie stehen in keinem Teilen-Export und in keiner
Marktplatz-Veröffentlichung.** Wer ein Feld dieser Art ergänzt, prüft zuerst
jeden Export- und Marktplatzpfad. Dieselbe Einstufung gilt für die Tabellen
`observations` und `parent_contacts`.

Ausdrücklich davon ausgenommen ist die **Selbstauskunft** (siehe unten): sie
enthält bewusst alles, was zum eigenen Konto gehört — das ist ihr Zweck.

## Welche Daten über die Lehrkraft gespeichert werden

Tabelle `users`: E-Mail, Passwort-Hash, Name, Anrede, optionaler
Marktplatz-Name, Notenskala und Tendenz-Einstellung, `token_version`,
`email_verified`, eine eventuell ausstehende neue E-Mail-Adresse,
Kalender-Token, Adressen abonnierter externer Kalender, Stundenplan-Zeiten und
`created_at`.

Passwörter werden mit **Argon2id** gehasht (19 MiB Speicher, 2 Durchgänge,
Parallelität 1 — die Parameter stehen als Konstanten in
`apps/api/app/routers/auth.py`). Bestehende PBKDF2-Hashes werden beim nächsten
Login still auf Argon2id gehoben; dabei bleibt `token_version` bewusst
unverändert, damit die Umstellung niemanden auf anderen Geräten abmeldet.

> Hinweis: [SECURITY.md](../SECURITY.md) führt PBKDF2 noch als bekannte Grenze
> und Argon2id als „vorgemerkt". Das ist überholt — im Code ist die Umstellung
> erfolgt.

## Wo die Daten liegen

| Was | Wo |
| --- | -- |
| Alle Tabellen | Postgres im Docker-Volume `pgdata` |
| Material (PDF, Arbeitsblätter) | als BLOB **in der Datenbank**, Tabelle `materials` |
| Bilder zu CardVote-Fragen | Docker-Volume `uploads` (`/app/uploads`) |
| Schüler- und Kartenfotos | in der Datenbank |
| Betreiberdaten fürs Impressum | `config/site.json` |
| Secrets | `.env` auf dem Server, `chmod 600`, nie im Repo |

Größenlimits: Material 15 MB je Datei bei 200 MB Kontingent pro Konto,
Fragenbild 10 MB, Schüler- und Kartenfoto je 5 MB, global 24 MB pro Anfrage
(nginx begrenzt zusätzlich auf 10 MB). Der Dateityp wird an den Magic Bytes
erkannt, nicht am gemeldeten Content-Type.

## Wie lange — automatische Fristen

Diese Fristen laufen als Hintergrund-Jobs, ohne dass jemand etwas anstoßen
muss:

| Was | Frist | Wo |
| --- | ----- | -- |
| Papierkorb (Klassen, Kurse, Decks, Karten, Lernpfade, Lernleitern) | 30 Tage | `main.py`, Lauf beim Start und alle 6 h |
| Unbestätigte Konten | 14 Tage | `main.py`, alle 6 h; in der Bestätigungsmail angekündigt |
| Beendete Code-Detektiv-Sitzungen | 1 Tag | `main.py`, stündlich |
| Nicht beendete Code-Detektiv-Sitzungen | 7 Tage | `main.py`, stündlich |
| Passwort-Reset-Link | 1 Stunde | `routers/auth.py` |
| Anmelde-Token | 30 Tage (mit Sliding-Renewal) | `routers/auth.py` |
| Cache eines externen Kalenders | 10 Minuten | `routers/kalender.py` |
| Backups (Vorgabe) | 14 Tage | `scripts/backup.sh`, `BACKUP_RETENTION_DAYS` |

**Alles Übrige bleibt, bis jemand es löscht.** Es gibt keine automatische
Löschung von Noten, Anwesenheiten, Beobachtungen oder Schülerdatensätzen am
Schuljahresende. Wie lange solche Daten aufbewahrt werden dürfen, regeln die
Vorgaben deines Bundeslandes — das ist eine Betreiber-Entscheidung, und Nuvora
trifft sie nicht für dich.

## Auskunft und Löschung

| Recht | Weg | Endpunkt |
| ----- | --- | -------- |
| Auskunft (Art. 15) | Profil → „Daten exportieren" | `GET /api/me/export` |
| Löschung (Art. 17) | Profil → Konto löschen, mit Passwortbestätigung | `POST /api/auth/delete-account` |

**Die Selbstauskunft** liefert eine JSON-Datei
(`nuvora-export-JJJJ-MM-TT.json`) mit rund 50 Datenbereichen, alle auf das
eigene Konto gefiltert: Klassen, Schüler samt Förder- und Notizfeldern, Noten,
Karten, Kalender, Anwesenheit, Sitzpläne, Material, Beobachtungen,
Elternkontakte, Kurse, Klassenarbeiten, Code-Sitzungen. Ausgenommen sind der
Passwort-Hash und die Dateiinhalte selbst — Blobs erscheinen als Platzhalter
mit Größenangabe, die Dateien lädt man im jeweiligen Modul herunter.

**Beim Löschen des Kontos** werden zuerst die Marktplatz-Veröffentlichungen
dieser Person entfernt und die Bilddateien der eigenen Fragen aus dem
Upload-Verzeichnis gelöscht, sofern keine fremde Frage dieselbe Datei nutzt.
Danach räumt die Datenbank-Kaskade über `owner_id` den Rest ab: Klassen →
Schüler → Noten, Anwesenheit, Beobachtungen, Elternkontakte, Karten-Fortschritt
und so weiter. Das Administrationskonto (`id == 1`) lässt sich nicht auf diesem
Weg löschen.

Anfragen von Eltern nach Art. 15 zu **einem einzelnen Kind** beantwortet
Nuvora nicht auf Knopfdruck — es gibt keinen Export je Schüler. Der
Kontoexport enthält die Daten, muss aber von Hand auf die betroffene Person
reduziert werden.

## Was nach außen geht

Nuvora hat keine Telemetrie, keine externen Skripte und keine CDN-Aufrufe;
Schriften und Formelsatz sind mitgeliefert. Ausgehende Verbindungen gibt es
genau diese:

| Ziel | Wann | Abschaltbar |
| ---- | ---- | ----------- |
| `raw.githubusercontent.com` und `api.github.com` | Update-Check auf neue Versionen | — |
| dein SMTP-Server | Registrierung, Passwort-Reset, E-Mail-Wechsel, Kontaktformular | ja, `SMTP_*` leer lassen |
| abonnierter externer Kalender | Anzeige eines fremden Kalenders | ja, nicht einrichten |
| `cloudflare-dns.com` | **nur im Selbsttest**: SPF/DKIM/DMARC der Absender-Domain prüfen | läuft nur beim Selbsttest |

Der Abruf externer Kalender ist gegen SSRF gehärtet: nur http/https, private,
Loopback-, Link-local- und reservierte Adressen sind gesperrt, DNS wird
gepinnt, Redirects werden nicht gefolgt, maximal 2 MB, 6 Sekunden Zeitlimit.

In die andere Richtung: der **eigene ICS-Feed**
(`/api/kalender/feed/<token>.ics`) ist ohne Anmeldung erreichbar, geschützt nur
durch den Token in der Adresse — damit Apple- oder Google-Kalender ihn
abonnieren können. Er enthält deine Termine. Widerrufen lässt er sich im
Kalender-Modul.

## Mandantentrennung

Jeder Datensatz trägt eine `owner_id`; jeder Zugriff prüft sie. Ein Konto sieht
nur eigene Daten. Der Selbsttest prüft das an der **laufenden** Installation:
fremde IDs lesen und beschreiben muss scheitern (siehe
[Selbsttest](selbsttest.md)). Dazu kommt der Regressionstest
`apps/api/tests/test_tenant_isolation.py`.

Ein Rollenmodell gibt es nicht: Administration ist Konto 1.

## Missbrauchsschutz

Rate-Limits sitzen auf zwei Ebenen. Am Proxy: 30 Anfragen pro Sekunde je IP
(Burst 80) und maximal 50 gleichzeitige Verbindungen je IP. In der Anwendung:
global 3000 Anfragen pro Minute je IP auf `/api/`, dazu enge Grenzen an den
empfindlichen Stellen — Login 5 Versuche pro Minute, Registrierung 10 pro 10
Minuten, Passwort-Reset 5 pro 10 Minuten, Kontaktformular 5 pro Stunde.

Diese Zähler leben im Prozessspeicher. Bei mehreren Arbeitsprozessen
vervielfachen sie sich; für die vorgesehene Ein-Container-Installation ist das
dicht genug.

## Sicherungen

`scripts/backup.sh` erzeugt einen komprimierten Postgres-Dump nach
`backups/nuvora-JJJJ-MM-TT_HHMM.sql.gz`, löscht leere Dumps mit Fehlercode und
räumt Sicherungen älter als `BACKUP_RETENTION_DAYS` (Vorgabe 14) weg. Es läuft
nicht von selbst — vorgesehen ist ein Cron-Eintrag; ein Beispiel steht im Kopf
des Skripts, dort auch der Weg zum Zurückspielen.

Drei Dinge, die das Skript **nicht** tut und die du selbst regeln musst:

- **Das Volume `uploads` sichert es nicht.** Die Bilder zu CardVote-Fragen
  liegen dort und sind nicht Teil des Dumps. (Material und Fotos liegen in der
  Datenbank und sind damit enthalten.)
- **Es verschlüsselt nichts.** Der Dump enthält Klarnamen, Noten und
  Förderdaten von Kindern; er gehört verschlüsselt und außer Haus.
- **Es prüft nicht, ob sich der Dump zurückspielen lässt.** Eine Sicherung,
  die nie zurückgespielt wurde, ist eine Vermutung.

## Checkliste vor dem produktiven Einsatz

- [ ] `config/site.json` mit echten Betreiberdaten gefüllt, `/legal` geprüft
- [ ] TLS vorgeschaltet (Nuvora selbst spricht http)
- [ ] Verzeichnis von Verarbeitungstätigkeiten angelegt
- [ ] Schulleitung und Schulträger eingebunden, Landesvorgaben geprüft
- [ ] Backup eingerichtet, verschlüsselt, außer Haus — und **einmal
      zurückgespielt**
- [ ] `uploads`-Volume in die Sicherung aufgenommen
- [ ] Aufbewahrungsfristen für Noten und Beobachtungen festgelegt (Nuvora
      löscht sie nicht automatisch)
- [ ] Meldeweg für Lücken bekannt ([SECURITY.md](../SECURITY.md))
