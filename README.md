# Nuvora

**Deutsch** · [English](README.en.md)

Werkzeugkasten **für Lehrkräfte**. Selbst gehostet, keine Cloud, keine Schülerdaten bei Dritten.

Quellcode: [github.com/norbert-me/Nuvora](https://github.com/norbert-me/Nuvora)

Quelloffen und nicht kommerziell nutzbar ([CC BY-NC 4.0](LICENSE)) — der Quellcode liegt offen, kommerzielle Nutzung ist ausgeschlossen. Das ist bewusst *keine* OSI-Open-Source-Lizenz.

> **100 % mit KI gebaut.** Code, Design und Texte sind vollständig mit einem KI-Assistenten (Claude) entwickelt — als Beleg, wie weit KI-gestützte Softwareentwicklung heute trägt.

## Was ist Nuvora

Eine Lehrkraft meldet sich an, legt ihre Klassen, Kurse, Schüler und Themen an
und schaltet sich die Module zu, die sie braucht. Alle Module arbeiten auf
denselben Daten. Lernende brauchen weder Gerät noch Konto — sie sind
Datensätze, die die Lehrkraft verwaltet.

Nuvora ist die Basis: Konto, Klassen, Kurse, Schüler, Themen und Material
gehören dem Kern. Module sind Gäste. Sie besitzen keine Klassen, keine Schüler
und keine eigenen Konten, und sie hängen nicht voneinander ab.

Nuvora ist ausdrücklich **nicht**:

- **keine Lernplattform.** Lernende haben keine Konten und melden sich nie an.
  Zwei Wege führen ohne Konto in die App — Karteikarten üben (`/lernen/<token>`)
  und einer Code-Detektiv-Sitzung beitreten (`/cd/<code>`) —, beide über einen
  geheimen Link, beide ohne Anmeldung.
- **kein Schulverwaltungsprogramm.** Keine Zeugnisse, keine Stundenpläne für
  ein Kollegium, keine Elternportale, kein Rollenmodell (Administration ist
  Konto 1).
- **kein gehosteter Dienst.** Es gibt keine Nuvora-Cloud. Wer es nutzen will,
  betreibt es selbst — und ist damit im Sinne der DSGVO verantwortlich.
- **kein Produkt mit Support.** Ein-Personen-Projekt ohne Einnahmen, ohne
  Zusage auf Antwortzeit und ohne Zusicherung, dass ein Modul erhalten bleibt.

**Stand:** Version 4.0.2. Der Rahmen steht, 14 Module sitzen darauf, keins hat
eigene Konten oder eine eigene Datenbank. Rund 300 API-Tests und 75
Frontend-Tests laufen bei jedem Push; nach jedem Deploy benutzt ein Selbsttest
jedes Modul einmal wirklich. Was das *nicht* heißt: dass jemand außer dem Autor
die Software im Alltag betreibt. Nuvora läuft auf einer Installation.

**Screenshots:** noch keine im Repository. Das ist eine Lücke, keine Absicht —
welche Ansichten fehlen, steht in [docs/bilder/README.md](docs/bilder/README.md).

## Wie fange ich an

Zum Ausprobieren auf dem eigenen Rechner. Für den Serverbetrieb siehe
[Betrieb](#betrieb) — dort erzeugt `deploy.sh` die Secrets selbst.

**Voraussetzungen:** Docker mit Compose v2, rund 2 GB RAM und 5 GB Platz, ein
freier Port (Vorgabe 8080). Alles Weitere bringen die Container mit — Postgres
16, Python, Node. Der erste Build dauert ein paar Minuten.

**1. Konfiguration anlegen**

```bash
cp .env.example .env
cp config/site.example.json config/site.json   # Impressum, sonst bleibt es leer
```

**2. Die beiden Pflichtwerte setzen.** Ohne sie startet der Stack absichtlich
nicht — Standardpasswörter sollen nicht versehentlich in Produktion landen.

```bash
openssl rand -hex 24    # → POSTGRES_PASSWORD in .env eintragen
openssl rand -hex 32    # → TOKEN_SECRET in .env eintragen
```

Beide Zeilen in `.env` mit einem Editor füllen. (Ein `sed -i`-Einzeiler ist
zwischen macOS und Linux nicht portabel — deshalb hier von Hand.)

**3. Das erste Konto festlegen.** In `.env` stehen `ADMIN_EMAIL` und
`ADMIN_PASSWORD`. Daraus legt Nuvora **beim ersten Start** das
Administrationskonto an — bereits bestätigt. Passwort ändern; die
E-Mail-Adresse kann lokal bleiben, wie sie ist.

> **Das ist der Schritt, an dem man sonst hängenbleibt.** Sich über `/login`
> selbst zu registrieren funktioniert lokal **nicht**: die Anmeldung verlangt
> eine bestätigte E-Mail-Adresse, und ohne konfigurierten SMTP-Server wird
> keine Bestätigungsmail verschickt. Das Admin-Konto aus der `.env` ist der Weg
> hinein.

**4. Starten**

```bash
docker compose up -d --build
```

**5. Anmelden** auf <http://localhost:8080> mit `ADMIN_EMAIL` und
`ADMIN_PASSWORD` aus der `.env`.

**6. Ein Modul zuschalten.** Frisch ist die Shell fast leer — das ist Absicht:
Module werden pro Lehrkraft aktiviert. Unter `/modules` eins auswählen, danach
erscheint es in der Navigation. Dann unter `/classes` eine Klasse mit ein paar
Schülern anlegen — fast jedes Modul arbeitet darauf.

(Beispielinhalte legt nur die **Registrierung** über `/login` an, nicht das
Admin-Konto aus der `.env`. Lokal startet man also leer. Fertiges Material zum
Importieren liegt in `examples/`.)

Danach erreichbar:

| Pfad          | Was                                                 |
| ------------- | --------------------------------------------------- |
| `/`           | Startseite — Module, Klassen, Kurse, Themen          |
| `/modules`    | Module zuschalten und abschalten                    |
| `/classes`    | Klassen und Schüler                                 |
| `/papierkorb` | Gelöschtes aus Kern und Modulen                     |
| `/backup`     | Sicherungen (nur Administration, Konto 1)           |
| Modulpfade    | siehe [Die Module](#die-module)                      |

**Wenn etwas nicht geht:**

| Symptom | Ursache |
| ------- | ------- |
| `POSTGRES_PASSWORD nicht gesetzt` beim `up` | Schritt 2 übersprungen — Compose bricht bewusst ab |
| Anmeldung sagt „E-Mail noch nicht bestätigt" | Über `/login` registriert statt das Admin-Konto benutzt (Schritt 3) |
| Modul-Seite leitet auf `/modules` um | Das Modul ist für dieses Konto nicht zugeschaltet |
| Passwort in `.env` später geändert, DB lässt niemanden rein | Postgres legt die Rolle nur beim **ersten** Start an — siehe [Konfiguration](#konfiguration) |
| Port 8080 belegt | `PORT` in `.env` ändern |

Wieder abräumen — `docker compose down -v` löscht auch die Datenbank.

## Betrieb

### Deploy

```bash
cp .deploy.env.example .deploy.env   # Server und Zielpfad eintragen
./deploy.sh                          # alles
./deploy.sh api                      # nur einen Service neu bauen
./deploy.sh --port 8090              # anderer Port, wird in .deploy.env gemerkt
./deploy.sh --schnelltest            # nur der kurze API-Selbsttest
./deploy.sh --kein-selftest          # ohne Prüfung ausliefern
```

Lädt hoch, baut auf dem Server, prüft Kern und Module und bricht ab, wenn etwas
nicht antwortet. Danach läuft der Selbsttest — **vollständig**, das ist die
Voreinstellung. Der Rückgabewert ist rot, wenn er etwas findet. Wer weniger
prüft, sagt es mit `--schnelltest` und bekommt am Ende einen Block „Umfang
dieses Laufs", der jeden übersprungenen Teil mit Grund aufführt.

Services: `api` (Kern), `web` (Shell + Modul-Seiten inkl. Lernpfad-Statik),
`db`, `proxy`. Einen eigenen Lernpfad-Container gibt es nicht.

Beim ersten Lauf legt das Skript die `.env` auf dem Server an und erzeugt
`TOKEN_SECRET` und `POSTGRES_PASSWORD` als Zufallswerte (`chmod 600`). Danach
wird die `.env` des Servers **nie** überschrieben.

Für Mailversand und Admin-Konto (`SMTP_*`, `ADMIN_EMAIL`) dort nachtragen:

```bash
ssh <server>
cd <pfad> && nano .env
```

`ADMIN_EMAIL` sollte eine **echte, empfangende** Mailadresse sein — dorthin
gehen Kontaktanfragen. Ein reiner Absender (`SMTP_FROM`) ohne Postfach empfängt
nichts. Das Admin-Profil zeigt eine Einrichtungs-Checkliste inkl.
Zustellbarkeit.

Ein Upgrade braucht keine Migrationsschritte, nur `./deploy.sh`: das Schema
entsteht beim Start aus `Base.metadata.create_all` plus additiven
Spalten/Indizes in `_ensure_columns` (idempotent). Kein Alembic.

### Konfiguration

Alles wird an **einer** Stelle konfiguriert, im Wurzelverzeichnis. Die Module
haben keine eigenen `.env`-Dateien, kein eigenes Compose und kein eigenes
Deploy.

| Datei              | Inhalt                                             | Im Repo? |
| ------------------ | -------------------------------------------------- | -------- |
| `.env`             | Passwörter, `TOKEN_SECRET`, SMTP, Ports            | nein     |
| `.deploy.env`      | Serveradresse, Zielpfad, Zugang für den Selbsttest | nein     |
| `config/site.json` | Betreiber, Anschrift, Kontakt (Impressum)          | nein     |

`config/site.json` ist die einzige Quelle der Betreiberdaten; das Impressum
holt sie über `/site.json` vom Proxy.

**Postgres legt Rolle und Datenbank nur beim ersten Start an.** Ein später
geändertes `POSTGRES_PASSWORD` erreicht eine bestehende Datenbank nicht — dann
ist es ein `ALTER ROLE`, kein `.env`-Edit. `deploy.sh` prüft das vorab und
sagt, was zu tun ist.

### Selbsttest

„Health" sagt nur, dass ein Container läuft. Der Selbsttest sagt, ob die
Installation *funktioniert*. `./deploy.sh` ruft ihn automatisch; einzeln geht
es auch:

```bash
./selftest.sh                    # ALLES: API, Systemtest, beide Browser-Läufe
./selftest.sh --schnell          # nur der kurze API-Selbsttest
./selftest.sh --ohne-browser     # API + Systemtest, ohne Playwright
./selftest.sh --ohne-system      # ohne den Alleinstellungs-Durchgang
./selftest.sh --nur-system       # ohne Anmeldung, ohne Schreiben
./selftest.sh --url https://…    # gegen eine andere Instanz
./selftest.sh --browser=webkit   # Engine der iPads (auch: chromium|beide)
./selftest.sh --debug            # jede Anfrage mit Status und Dauer
```

Vier Teile:

| Teil | Datei | Was es tut |
| ---- | ----- | ---------- |
| Selbsttest | `scripts/selftest.py` | Erreichbarkeit, Sicherheit, Web-Dateien, Einrichtung (über `GET /api/selftest`), je Modul ein Schreib-Roundtrip auf Kern-Klasse und -Schülern |
| Systemtest | `scripts/systemtest.py` | jedes Modul **einzeln**: nur dieses aktiv, alle fremden Endpunkte müssen genau 403 liefern; dazu nachgerechnete Noten und jede Modul-Brücke zweimal |
| Rundgang | `scripts/selftest-browser.mjs` | jede Seite im echten Browser — Desktop, Handy (390 px), dunkles Design; echte Handgriffe mit Neuladen als Beweis |
| Oberflächen | `scripts/systemtest-browser.mjs` | jedes Modul einzeln in der Oberfläche; verbotene Verbindungen bleiben unsichtbar |

Am Ende steht, welche Teile gelaufen sind und was übersprungen wurde — ein
grüner Lauf ohne vollen Umfang ist keine Aussage über die Seite. Ausführlich,
auch was ein grüner Lauf **nicht** bedeutet: [docs/selbsttest.md](docs/selbsttest.md).

Der Selbsttest braucht ein eigenes Testkonto (`SELFTEST_EMAIL` /
`SELFTEST_PASSWORD` in `.deploy.env`, einmalig selbst registrieren und
bestätigen); `SELFTEST_TOKEN` erzeugt `deploy.sh` beim ersten Lauf von allein.
Ohne das Token bleiben Schema, Konfiguration und E-Mail ungeprüft — der Bericht
sagt das.

Testdaten tragen das Präfix `ZZ-Selbsttest` bzw. `ZZ-Systemtest` und werden
inklusive Papierkorb wieder abgeräumt. Bleibt nach einem Abbruch etwas liegen,
räumen die Tests es beim nächsten Lauf selbst weg; von Hand geht es auch:

```bash
python3 scripts/aufraeumen.py               # nur anzeigen
python3 scripts/aufraeumen.py --loeschen    # wirklich abräumen
python3 scripts/aufraeumen.py --module-aus  # alle Module abschalten
python3 scripts/aufraeumen.py --module-an   # alle Module anschalten
```

Es fasst ausschließlich an, was ein Testpräfix trägt. Den Modul-Zustand stellt
es aus `.selftest-module.json` wieder her; fehlt sie, sagt es das und rät
nicht. Playwright installiert `selftest.sh` beim ersten Mal nach
`scripts/node_modules` (bewusst getrennt von `apps/web`, damit es nie ins
Web-Image wandert).

### Sicherungen

Unter `/backup`, nur für die Administration (Konto 1) — eine Sicherung enthält
die Daten aller Konten.

**Was drin ist:** die Datenbank (inkl. Schülerfotos, Karten- und
Materialdateien, die als `LargeBinary` in der DB liegen), der Upload-Ordner
(Frage-Bilder) und `config/site.json`. **Was nicht drin ist:** die `.env` mit
`TOKEN_SECRET` und `POSTGRES_PASSWORD` — bewusst getrennt, damit ein
verlorenes Archiv nicht auch die Schlüssel mitnimmt.

- **Erzeugen:** „Jetzt sichern" legt ein ZIP im Ablageordner an (0600 in einem
  0700-Ordner, außerhalb von `NUVORA_UPLOAD_DIR`, das ohne Anmeldung
  ausgeliefert wird).
- **Zeitplan:** „Nur von Hand", „Täglich" oder „Wöchentlich". Ein
  Hintergrund-Job sieht stündlich nach, ob etwas fällig ist.
- **Aufbewahrung:** höchstens `NUVORA_BACKUP_KEEP` Sicherungen (Vorgabe 7) und
  `NUVORA_BACKUP_MAX_MB` MB insgesamt (Vorgabe 2048); die älteste geht zuerst,
  die jüngste bleibt immer.
- **Ziel:** `NUVORA_BACKUP_DIR` (Vorgabe `/app/backups`, in
  `docker-compose.yml` ein eigenes Volume), optional zusätzlich
  `NUVORA_BACKUP_DIR_EXTERN`. Liegt der Ordner auf keinem eigenen Volume, sagt
  die Oberfläche das — sonst wären die Sicherungen beim nächsten `--build` weg.
- **Prüfen und zurückspielen:** „Prüfen" liest das Archiv und zählt Datensätze
  und Dateien; der **Probelauf** spielt es in eine Wegwerf-Datenbank ein, bevor
  „Zurückspielen" (mit Bestätigungswort) die echte überschreibt. Eine
  Sicherung, die nie zurückgespielt wurde, ist keine.
- **Verschlüsselung: bewusst nein.** Die Archive liegen unverschlüsselt im
  Ordner. Wer sie vom Server wegträgt, verschlüsselt sie dort, wo es etwas
  bringt (`age -p datei.zip`, `gpg --symmetric --cipher-algo AES256`). Die
  Begründung steht im Kopf von `apps/api/app/routers/backup.py`.

Wer lieber nur die Datenbank per Cron sichert: `scripts/backup.sh` macht ein
`pg_dump` aus dem laufenden `db`-Container (Aufbewahrung über
`BACKUP_RETENTION_DAYS`, Vorgabe 14). Es sichert **nur** die Datenbank —
Uploads und `config/site.json` nicht.

### Fristen

Läuft automatisch, ohne Zutun:

| Was | Frist |
| --- | ----- |
| Papierkorb (`/papierkorb`) — Gelöschtes aus Kern und Modulen | 30 Tage, dann endgültig |
| Unbestätigte Konten | 14 Tage |
| Code-Detektiv-Sitzungen | 1 bzw. 7 Tage |

### Update-Kanäle

Zwei Kanäle, einstellbar im Profil unter „Über Nuvora": **Stable** meldet das
jüngste reguläre Release, **Beta** auch Pre-Releases. Vorbelegung über
`UPDATE_CHANNEL` in der `.env`.

Wichtig dabei, weil es überrascht: der Release-Workflow erklärt ein Release nur
dann zum regulären, wenn sich die **Hauptversion** ändert (`release.yml`,
Schritt „Kanal bestimmen"). Alles andere — auch ein Patch mit
Sicherheitskorrekturen — geht als Pre-Release heraus und erreicht damit nur die
Beta-Linie. Auf der Releases-Seite steht deshalb vieles als „Pre-release"; das
ist kein Hinweis auf Instabilität. Wer eine Fehlerbehebung an alle ausliefern
will, muss das Release von Hand auf regulär stellen.

Tags sind signiert; `git verify-tag v4.0.0` prüft das (Anleitung in
[SECURITY.md](SECURITY.md)). Jedes Release trägt eine Stückliste der
Abhängigkeiten als Anhang.

## Die Module

Das Register steht **im Code** (`apps/api/app/routers/modules.py`): ein Modul
existiert nur, wenn es Code dazu gibt; die Datenbank merkt sich nur, wer was
aktiviert hat. Vierzehn Stück, jedes pro Lehrkraft zuschaltbar:

| Modul | Pfad | Wofür |
| ----- | ---- | ----- |
| CardVote | `/cardvote` | Abstimmen ohne Geräte: Lernende halten bedruckte Karten hoch, die Lehrkraft scannt sie (ArUco/OpenCV). Live-Ergebnisse, Spiel-Modus, Auswertung mit Notenschlüssel, Export (PDF/Excel/iDoceo), Marktplatz |
| Lernpfad | `/lernpfad` | Aufgaben und Lernpfade (aus mehreren **Lernleitern**); der Generator verteilt differenziert. Lernleitern über den Marktplatz teilbar |
| Karteikarten | `/karten` | Spaced Repetition (SM-2). Lernende üben **ohne Konto** per QR-Code; Reifegrad sichtbar, Meisterung als Notenspalte übernehmbar |
| Kalender | `/kalender` | Tag/Woche/Monat + wiederkehrender Stundenplan; Quiz, Deck oder Lernleiter an eine Stunde planen; freie Tage; ICS-Feed raus, externer Kalender read-only rein (SSRF-gehärtet) |
| Auswertung | `/auswertung` | Zwei Reiter: **Notenbuch** (eigene Spalten mit Gewichten, gewichteter Schnitt, Trend je Schüler) und **Klassenarbeit** (Aufgabe → Thema, richtig/falsch je Schüler, Fehlerprofil, Trennschärfe) |
| Unterrichtsplanung | `/unterrichtsplanung` | Einstiege sammeln: Idee, Ablauf, Material, Dauer — themen-getaggt und an Kalender-Stunden zuweisbar |
| Code-Detektiv | `/code-detektiv` | Programmier-Rätsel: Code-Bausteine per Drag & Drop ordnen, allein oder in einer Klassen-Session (Beitritt per Code, ohne Login) |
| Orga | `/orga` | Klassenführung in Reitern: Checklisten, Anwesenheit/Fehlzeiten (PDF-Report), Ausleihe, Sitzplan (optional SEGEL-Stufen) |
| Zufall | `/zufall` | Zufallsschüler (fair gewichtet nach Zeit seit dem letzten Ziehen) und Zufallsgruppen |
| Notizbrett | `/notizbrett` | Notizzettel + To-do-Liste. Datierte Aufgaben erscheinen im Kalender. Nicht an Schüler gebunden |
| Klassenleitung | `/klassenleitung` | Elternkontakte je Schüler: Datum, Kanal, Notiz — Dokumentationspflicht ohne Zettel |
| Beobachtungen | `/notizen` | Formative Notizen je Schüler, bewusst getrennt von der Note |
| Tafel | `/tafel` | Classroom-Screen für den Beamer: frei platzierbare Textfelder, Timer. Ohne Daten |
| Mathespiele | `/mathespiele` | Aktuell Mathefußball: Kopfrechen-Duell für zwei Teams am Beamer |

Ein **Reifegrad** steht an jedem Modul (`stable` / `beta`); die Shell zeigt ihn
als Badge.

### Was die Module verbindet

Verbindendes ist **Zusatz, nie Voraussetzung** — CardVote läuft ohne Lernpfad,
Karten laufen ohne Kalender. Träger ist die geteilte Themen-Taxonomie (Fach →
Thema → Unterthema):

- schwaches CardVote-/Code-Detektiv-/Klassenarbeits-Thema → Karten-Deck oder
  Lernpfad-Aufgabe
- CardVote-, Karten- und Code-Detektiv-Ergebnisse → Notenspalte
- schwaches Thema → passender Einstieg vorgeschlagen
- Kalender plant Quiz/Deck/Lernleiter und schaltet Decks am Tag frei
- Themen-Ansicht zeigt zu einem Thema alles quer über die aktiven Module

Fehlt das Gegenstück-Modul, ist die Verbindung nicht sichtbar und die API weist
sie mit 403 ab. Genau das prüft der Systemtest für jede Brücke zweimal.

### Bauformen

Drei, mehr braucht es nicht:

- **React im Rahmen** — der Normalfall (CardVote, Auswertung, Kalender …).
- **Nativ in-page gemountet** — Lernpfad. Die erprobte Vanilla-JS-Oberfläche
  liegt unter `apps/web/public/lp/` und wird in einen Host injiziert (kein
  iframe, kein eigener Container, kein Nachbau); ihr CSS ist gescopet. Daten
  kommen aus dem Kern über `/api/lernpfad/*`.
- **Portierte Fremd-App** — Code-Detektiv, inzwischen nativ in der Shell
  (`apps/web/src/codedetektiv/`), CSS unter `.cd-scope` isoliert.

### Desktop-Hülle (macOS, optional)

`apps/desktop` — eine Electron-Hülle um dieselbe Weboberfläche: eigenes
Fenster, Dock-Icon, kein Browser-Rahmen. **Kein eigener Server, keine eigene
Datenbank, kein eigener Code-Pfad**; sie zeigt auf einen laufenden
Nuvora-Server. Offline *lesen* über den Service Worker, offline *schreiben*
noch offen. Sie ist bewusst kein Modul. Details in `apps/desktop/README.md`.

## Datenschutz

Nuvora läuft auf **deinem** Server. Damit bist du im Sinne der DSGVO
Verantwortlicher für die Daten darin — nicht das Projekt. Praktisch heißt das:
Rücksprache mit Schulleitung und Schulträger, ein Verzeichnis von
Verarbeitungstätigkeiten, ein Blick in die Vorgaben deines Bundeslandes, und
Sicherungen, die du auch zurückspielen kannst.

**Besonders schützenswerte Daten.** `students.foerder` (Förderschwerpunkte),
`students.massnahmen` (Nachteilsausgleiche) und `students.notizen` sind Daten
nach **DSGVO Art. 9**. Sie stehen in **keinem Export** und in **keiner**
Marktplatz-Veröffentlichung. Wer ein Feld ergänzt, prüft zuerst jeden Export-
und Veröffentlichungspfad; `apps/api/tests/test_keine_lecks.py` und
`test_export_vollstaendig.py` halten das fest.

**Auskunft und Löschung.**

| Recht | Weg |
| ----- | --- |
| Auskunft nach Art. 15 | `GET /api/me/export` — in der Oberfläche: Profil → Daten exportieren |
| Löschung des Kontos | `POST /api/auth/delete-account` — in der Oberfläche: Profil |
| Impressum und Datenschutzerklärung | `/legal`, gespeist aus `config/site.json`; auch von den Seiten erreichbar, die Lernende ohne Konto sehen |

Dazu die automatischen Fristen oben (Papierkorb 30 Tage, unbestätigte Konten 14
Tage, Spielsitzungen 1 bzw. 7 Tage).

**Technisch:**

- **Selbst gehostet, keine Cloud.** Schülerdaten verlassen den eigenen Server
  nicht. Ein Konto sieht nur eigene Daten (`owner_id` überall); die
  Mandantentrennung wird im Selbsttest an der laufenden Installation geprüft.
- **Passwörter** mit Argon2id gehasht (19 MiB, 2 Durchgänge); ältere
  PBKDF2-Hashes werden beim nächsten Login still angehoben. Pflicht zur
  E-Mail-Bestätigung, Reset per Einmal-Link.
- **Sicherheits-Header** zentral am Proxy (CSP, `X-Frame-Options: SAMEORIGIN`,
  `nosniff`, Referrer-Policy); `server_tokens off`.
- **Rate-Limits** gegen Brute-Force und Massenanlage auf schreibenden
  Endpunkten.
- **Externer Kalender-Abruf SSRF-gehärtet** (private/lokale IPs und Redirects
  gesperrt).
- **Secrets** liegen nur auf dem Server (`.env`, `chmod 600`);
  `POSTGRES_PASSWORD` und `TOKEN_SECRET` sind Pflicht, sonst startet der Stack
  nicht.

Vollständige Bestandsaufnahme — welche Felder, welche Tabellen, welche Fristen,
was nach außen geht: [docs/datenschutz.md](docs/datenschutz.md). Die bekannten
Grenzen (Token im `localStorage`, prozesslokale Rate-Limits, Schüler-Token in
der Adresse, kein Rollenmodell) stehen offen in [SECURITY.md](SECURITY.md).
Lücken bitte **nicht** als öffentliches Issue — der Meldeweg steht dort.

Der Meldeweg steht zusätzlich maschinenlesbar in
`apps/web/public/.well-known/security.txt` (RFC 9116) und wird vom Selbsttest
mitgeprüft — inklusive Restlaufzeit des `Expires`-Datums, damit die Datei nicht
unbemerkt abläuft.

## Mitentwickeln

Es gibt keinen Prozess und keine Zusage auf Antwortzeit — aber eine Anleitung.
Vor größerer Arbeit lohnt eine Rückfrage per Issue.

**Tests laufen lassen:**

```bash
cd apps/api && pip install -r requirements-dev.txt && pytest   # API
cd apps/web && npm install && npm run test                     # Frontend (vitest)
```

Sie decken die Stellen ab, an denen ein Fehler still Daten kostet: E/G-Wertung,
Klassen-Update ohne Datenverlust, Papierkorb-Kaskaden, Mandantentrennung,
Kurs-Logik, Backup-Pfade, Modul-Schranken. Bei jedem Push laufen sie zusammen
mit dem Web-Build und einem `docker compose build` in der CI.

**Wo was liegt:**

| Ort | Inhalt |
| --- | ------ |
| `apps/api/app` | FastAPI · SQLAlchemy 2 (async) · Postgres 16 — Kern-Router und Modul-Router in `routers/` |
| `apps/web/src` | React 18 · Vite · react-router · i18n (de vollständig, en/es weitgehend) |
| `apps/web/public/lp` | Lernpfad-Statik (Vanilla JS), in-page gemountet |
| `apps/desktop` | Electron-Hülle |
| `scripts/` | Selbsttest, Systemtest, Aufräumen, Backup-Cron, Lasttest |
| `docs/` | Architektur, neues Modul, Selbsttest, Datenschutz, Entwicklung |
| `nginx.conf`, `docker-compose.yml` | Proxy und Stack — eine Domain, alle Teile |

**Weiterlesen:**

| Seite | Für wen |
| ----- | ------- |
| [docs/architektur.md](docs/architektur.md) | Wie Kern und Module zusammenhängen und warum Module Gäste sind |
| [docs/neues-modul.md](docs/neues-modul.md) | Ein neues Modul bauen — die fünf Einträge, ohne die es ungeprüft bleibt |
| [docs/selbsttest.md](docs/selbsttest.md) | Was „grün" bedeutet und was nicht |
| [docs/datenschutz.md](docs/datenschutz.md) | Welche Daten, wo, wie lange |
| [docs/entwicklung.md](docs/entwicklung.md) | Lokal am Code arbeiten, Tests, Abhängigkeiten |
| [SECURITY.md](SECURITY.md) | Lücken melden, bekannte Grenzen, Signaturen prüfen |
| [CLAUDE.md](CLAUDE.md) | Arbeitsanweisung für den KI-Assistenten — Regeln, Fallstricke, Begründungen |

### Python-Abhängigkeiten ändern

Zwei Dateien, eine Richtung: `apps/api/requirements.txt` ist die Quelle mit
Bereichen, `apps/api/requirements.lock.txt` ist daraus **erzeugt** — feste
Fassungen samt Hashes. Container und CI installieren nur aus der Lock-Datei
(`pip install --require-hashes`), damit zwei Builds vom selben Commit dasselbe
ergeben.

```bash
cd apps/api
pip install pip-tools            # einmalig
# 1. requirements.txt bearbeiten
# 2. Lock neu erzeugen — mit Python 3.14, wie im Container:
pip-compile --allow-unsafe --generate-hashes --strip-extras \
  --output-file=requirements.lock.txt requirements.txt
```

`pip-compile` löst für den Interpreter, unter dem es läuft — deshalb Python
3.14. Stolperstein: pip-tools 7.6 bricht mit pip 26 ab
(`make_requirement_preparer() missing … allow_editables`); dann im selben Venv
`pip install "pip<26"`. Die Testwerkzeuge (`requirements-dev.txt`) bleiben
bewusst ohne Lock.

## Lizenz

[CC BY-NC 4.0](LICENSE) — Namensnennung, nicht kommerziell.

- **Erlaubt:** Betrieb an Schulen, durch Lehrkräfte, Schulträger und
  öffentliche Bildungseinrichtungen; Weitergabe und Veränderung, solange Nuvora
  genannt wird.
- **Nicht erlaubt:** Verkauf, kostenpflichtiges Hosting als Dienst, Nutzung in
  kommerziellen Fortbildungen oder als Teil eines bezahlten Angebots.
- Im Zweifel fragen.

Zwei Dinge dazu ehrlich gesagt: Creative-Commons-Lizenzen sind nicht für
Software gedacht (keine Patent- und Haftungsklauseln), und „nicht kommerziell"
ist juristisch unscharf. Deshalb steht die Abgrenzung oben im Klartext. Nuvora
ist damit **keine** OSI-konforme Open-Source-Lizenz, auch wenn der Quellcode
offenliegt.

**Ohne Gewähr.** Die Software wird bereitgestellt, wie sie ist — keine
Zusicherung von Eignung, Verfügbarkeit oder Fehlerfreiheit, keine Haftung für
Datenverlust. Wer sie mit Schülerdaten betreibt, sorgt selbst für Sicherungen.
