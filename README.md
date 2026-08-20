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

**Stand:** Version 4.0.4. Der Rahmen steht, 14 Module sitzen darauf, keins hat
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
| Karteikarten | `/karten` | Spaced Repetition (SM-2). Alle Stapel liegen in **einer Sammlung** (Ordner); die Klassenauswahl ist nur ein Filter. Ausgerollt wird über die **Stunde im Kalender** — wer einen Stapel dort einplant, gibt ihn damit dem Kurs dieser Stunde frei (ohne das Modul Kalender bleibt alles bedienbar, nur das Ausrollen entfällt). Lernende üben **ohne Konto** per QR-Code; Reifegrad sichtbar, Meisterung als Notenspalte übernehmbar. **E/G je Karte ist ein Schalter am Stapel** (wie am Quiz) — aus sehen alle alles, an ist eine **neue** Karte G, bis sie auf E geschaltet wird |
| Kalender | `/kalender` | Tag/Woche/Monat + wiederkehrender Stundenplan; Quiz, Deck oder Lernleiter an eine Stunde planen; freie Tage; ICS-Feed raus, externer Kalender read-only rein (SSRF-gehärtet) |
| Auswertung | `/auswertung` | Drei Sichten: **Notenbuch** (eigene Spalten mit Gewichten, gewichteter Schnitt, Trend je Schüler), **Klassenarbeit** (Punkte je Aufgabe/Teilaufgabe, Thema bis auf die Teilaufgabe, Arbeit + Erwartungshorizont als Anhang, Fehlerprofil, optional Fehlerarten je Zelle, Rückmeldebogen je Kind zum Ausdrucken) und **Vergleich** (dieselbe Arbeit über mehrere Klassen, je Aufgabe mit Trennschärfe, Nuller-Anteil und Streuung) |
| Unterrichtsplanung | `/unterrichtsplanung` | Einstiege sammeln: Idee, Ablauf, Material, Dauer — themen-getaggt und an Kalender-Stunden zuweisbar |
| Code-Detektiv | `/code-detektiv` | Programmier-Rätsel: Code-Bausteine per Drag & Drop ordnen, allein oder in einer Klassen-Session (Beitritt per Code, ohne Login) |
| Orga | `/orga` | Klassenführung in Reitern: Checklisten, Anwesenheit/Fehlzeiten (PDF-Report), Ausleihe, Sitzplan (optional SEGEL-Stufen, Hervorheben von Gruppen) |
| Zufall | `/zufall` | Zufallsschüler (fair gewichtet nach Zeit seit dem letzten Ziehen) und Zufallsgruppen |
| Notizbrett | `/notizbrett` | Notizzettel + To-do-Liste. Datierte Aufgaben erscheinen im Kalender. Nicht an Schüler gebunden |
| Tafel | `/tafel` | Classroom-Screen für den Beamer: frei platzierbare Textfelder, Timer. Ohne Daten |
| Mathespiele | `/mathespiele` | Aktuell Mathefußball: Kopfrechen-Duell für zwei Teams am Beamer |

Ein **Reifegrad** steht an jedem Modul (`stable` / `beta`); die Shell zeigt ihn
als Badge.

### Frühwarnung: wer hängt über mehrere Erhebungen hinweg hinterher?

Aus den CardVote-Quizzen **und** den Klassenarbeiten einer Klasse rechnet Nuvora
den **Abstand zum Klassenmittel derselben Erhebung** — eine absolute Quote sagt
nichts, ein schwerer Test drückt alle. Gemeldet wird erst, was sich wiederholt:
im Median mindestens 20 Prozentpunkte unter der Klasse, und das in vier der
letzten fünf Erhebungen, bei mindestens zwölf gewerteten Antworten. Darunter
steht „zu wenig Daten" — bei vier A–D-Fragen trifft reines Raten im Schnitt eine.

Ob es am aktuellen Thema liegt oder an älteren Lücken, beantwortet die Zeitachse
**ohne gepflegte Voraussetzungen**: Nuvora kennt das Erstvorkommen jedes Themas,
Fragen zu lange bekannten Themen sind Wiederholung — also der Vorwissenstest,
den es ohnehin gibt. Zu sehen dort, wo man mit den Ergebnissen arbeitet: in der
CardVote-Klassenauswertung, auf der Schülerseite und bei den Klassenarbeiten —
also nur mit dem jeweiligen Modul. Jede Meldung nennt die Zahlen, aus denen sie
entstand. Es ist eine Beobachtung, keine Diagnose — aus Trefferquoten
folgt keine Lernstörung.

### Themenstand: sitzt das Unterthema — und wird es besser?

Eine Klassenarbeit prüft meist mehrere Unterthemen. Nuvora rechnet daraus (und
aus den CardVote-Quizzen) je Kind und Thema die erreichten von den möglichen
Punkten — nicht den Mittelwert der Quoten, sondern gewichtet: eine Aufgabe zu
acht Punkten wiegt achtmal so schwer wie eine zu einem, denn sie prüft auch
mehr. Unter sechs möglichen Punkten steht „zu wenig für eine Aussage" statt
einer Zahl, die nach Wissen aussieht.

Der Pfeil daneben beantwortet die zweite Frage: verglichen wird die erste Hälfte
der Erhebungen zu diesem Thema mit der zweiten — nicht die letzte mit der
vorletzten, sonst wäre jede schwache Arbeit ein „Abstieg". Eine Note steht klein
daneben, ausdrücklich als Orientierung: der Notenschlüssel gilt für eine ganze
Arbeit, nicht für drei Aufgaben daraus.

Ist das Modul Karten aktiv, zählen die **Karteikarten** als dritte Quelle mit:
ein Kartenversuch ist ein Punkt, Treffer sind die richtig erinnerten. So sieht
man beim Kartenlernen je Thema, wie sicher es sitzt und wie viele Karten heute
anstehen — statt „alte" und „neue" Stapel von Hand zu führen (beim Verschieben
zwischen Stapeln ginge der Lernstand verloren). Ein Thema, an dem erst ein oder
zwei Karten geübt wurden, bekommt keine Zahl, sondern den Hinweis; die Zahl der
fälligen Karten steht trotzdem da — sie zählt, sie bewertet nicht. Karten haben
kein Datum und stehen deshalb nicht im Verlauf. Was ein Kind wegen E/G nie zu
sehen bekommt, wird ihm auch nicht als Rückstand angerechnet.

### Reihenfolge der Lernenden

Die Liste einer Klasse lässt sich per Ziehen sortieren — und diese Reihenfolge
gilt überall: Notenbuch, Anwesenheit, Klassenarbeit, Kartenfortschritt. Sie ist
bewusst eine eigene Angabe und **nicht** die Kartennummer: auf der steht die
gedruckte CardVote-Karte, und jeder Scan verweist darauf. Wer beim Sortieren
umnummeriert, ordnet alte Ergebnisse dem falschen Kind zu.

### Archiv statt Löschen

Am Schuljahresende lassen sich Klassen und Kurse **archivieren**: raus aus allen
Auswahllisten, alle Daten bleiben (Noten, Klassenarbeiten, Karten-Fortschritt).
Einen Kurs zu archivieren nimmt seine Fach-Klassen mit; zurück geht es jederzeit.
Bewusst etwas anderes als der Papierkorb — der löscht nach 30 Tagen, und eine
alte Note muss man Jahre später noch nachschlagen können.

### Bemerkungen stehen an der Note

Jede Zelle im Notenbuch kann einen Kommentar tragen — über die kleine Ecke oben
rechts. „Formel vergessen", „krank, nachgeschrieben am 12.03." Zeilen mit
Kommentaren tragen einen Punkt hinter dem Namen, damit man sie beim Durchsehen
findet.

Der Kommentar zählt **nie** in einen Schnitt: gerechnet wird die Note, der Text
steht daneben. Das ist dieselbe Trennung, die vorher das eigene Modul
„Beobachtungen" gezogen hat — nur an der richtigen Stelle. Dieses Modul und
„Klassenleitung" gibt es deshalb nicht mehr; ihre Tabellen bleiben bestehen,
damit vorhandene Einträge nicht verloren gehen.

### Dieselbe Lerngruppe im nächsten Schuljahr

Aus „6.5 Mathematik" wird „7.5 Mathematik" — dieselben Kinder, ein Jahr später.
Beides in **eine** Klasse zu legen ginge nicht gut: am Notenbuch hängen
Halbjahre, an der Klasse Kartennummern, Sitzplan und Anwesenheit, und eine
Zeugnisnote gilt je Schuljahr.

Verbunden wird deshalb die **Reihenfolge**, nicht der Inhalt: ein Kurs trägt
sein **Schuljahr** (`2025/26`) und darf auf den Kurs des **Vorjahres** zeigen.
In der Kursliste steht dann „← Vorjahr: 6.5 Mathematik" bzw. „Folgejahr: 7.5
Mathematik →" — auch wenn das Vorjahr längst im Archiv liegt. Bestandskurse
bekommen ihr Schuljahr beim ersten Start aus dem Namen („(2025-2026)"); der
Name selbst bleibt unverändert. Ein Kreis in der Kette wird abgewiesen.

### Zugangs-Codes für die Lernenden

Karteikarten und die eigenen Testergebnisse erreichen Lernende **ohne Konto**
über einen persönlichen Link (`/lernen/<token>`). Die Klassenseite druckt ihn
als PDF: je Kind ein Zettel mit Name, QR-Code und dem Link im Klartext zum
Abtippen, acht pro Seite zum Ausschneiden.

Drei Regeln halten das dicht:

- **Der Code gilt nur, solange etwas dahinter steht.** Ist das Kartenmodul aus,
  liefert der Link keine Karten mehr; ist auch CardVote aus, ist er ganz tot und
  verschwindet aus der Klassenansicht. Ein ausgedruckter QR-Code lässt sich
  nicht einsammeln — deshalb prüft der Server bei **jedem** Aufruf, ob er noch
  etwas herausgeben darf. Dasselbe gilt für Code-Detektiv-Sitzungscodes.
- **Jeder Zettel ist einmalig.** Die Token sind Zufall (24 Byte) und in der
  Datenbank eindeutig; zwei Kinder können nie denselben bekommen.
- **Ein Link lässt sich zurückholen.** „Neu vergeben" macht alle alten Ausdrucke
  sofort ungültig — nötig, sobald ein Link im Klassenchat gelandet ist.

Auch eine gelöschte oder archivierte Klasse schaltet ihre Zugänge ab.

### Dateien ansehen statt herunterladen

An Themen, Stunden, Einstiegen und Klassenarbeiten hängt eine private
Dateiablage (200 MB je Konto). Ein Klick zeigt die Datei im Fenster: PDF und
Bilder direkt, Word/Excel/PowerPoint wandelt der Server beim ersten Ansehen
einmalig nach PDF (LibreOffice) und behält das Ergebnis. Die Datei verlässt den
Server dabei nicht.

Große PDFs bekommen für die Ansicht eine leichtere Fassung (Ghostscript, rund
150 dpi) — der Download liefert immer das Original. Jede Antwort trägt eine
Kennung (ETag, `Cache-Control: private`): wer dieselbe Arbeit ein zweites Mal
öffnet, bekommt „304, hast du schon" und lädt kein Byte erneut. Das ist der
Unterschied zwischen „sofort da" und „lädt fünf Sekunden", wenn eine ganze
Klasse am selben Schulanschluss hängt.

### Immer dieselbe Werkzeugleiste

Jede Seite baut ihre Leiste nach derselben Regel (`components/Werkzeugleiste.jsx`):

```
[ Auswahl ]  [ was man oft tut ]        …  [ Ansicht ⚙ ]  [ ⋯ Mehr ]
```

Links steht, **was** bearbeitet wird (Klasse, Kurs, Datum), daneben die zwei bis
drei Handgriffe des Alltags. Alles Seltene und alles Gefährliche liegt im
**Mehr**-Menü rechts — Löschen immer zuunterst. Vorher standen im Sitzplan elf
Bedienelemente nebeneinander und in der Klassenmaske der Papierkorb direkt neben
„Speichern".

### Etwas finden

Oben links neben „Nuvora" steht der **Modulwechsler**: er zeigt, in welchem
Modul man gerade ist, und führt mit einem Klick in jedes andere zugeschaltete.
Die Reiter daneben gehören immer nur zum aktuellen Bereich — der Weg in ein
anderes Modul führte vorher über die Startseite.

Oben rechts sitzt eine Lupe, überall erreichbar mit **⌘K / Strg+K**, auf der
Startseite zusätzlich als Suchfeld. Sie sucht in drei Töpfen: Seiten und Reiter
aller **zugeschalteten** Module, die eigenen Klassen und Kurse, die Themen
(Treffer führt in die Themenansicht). Gesucht wird auch nach dem, was man tun
will, nicht nur nach dem Namen des Reiters: „Fehlzeiten" findet die Anwesenheit,
„Zeugnis" das Notenbuch. Die Liste der Ziele steht in
`apps/web/src/core/ziele.js` — ein neuer Reiter gehört dort hinein, sonst ist er
nur über die Navigation zu finden.

### Was die Module verbindet

Verbindendes ist **Zusatz, nie Voraussetzung** — CardVote läuft ohne Lernpfad,
Karten laufen ohne Kalender. Träger ist die geteilte Themen-Taxonomie (Fach →
Thema → Unterthema):

- schwaches CardVote-/Code-Detektiv-/Klassenarbeits-Thema → Karten-Deck oder
  Lernpfad-Aufgabe
- CardVote-, Karten- und Code-Detektiv-Ergebnisse → Notenspalte (Abschnitt wird
  im Dialog gewählt oder dort samt Halbjahr angelegt)
- schwaches Thema → passender Einstieg vorgeschlagen
- Kalender plant Quiz/Deck/Lernleiter und schaltet Decks am Tag frei
- Themen-Ansicht zeigt zu einem Thema alles quer über die aktiven Module
- Karten-Fortschritt zählt in die schwachen Themen mit — woran beim Üben immer
  wieder gepatzt wird, steht im Wiederholungs-Vorschlag
- ein Klassenarbeitstermin legt ein Korrektur-To-do eine Woche danach an; wird
  der Termin verschoben, zieht der Zettel mit, wird er gelöscht, geht er mit
- die Frühwarnung schreibt aus einer Meldung direkt eine Beobachtung
- die Frühwarnung markiert Kinder mit vielen Fehltagen (Anwesenheit)
- der Sitzplan kann Plätze färben: frei markieren (nur im Browser, nur für
  diesen Kurs), nach Niveau E/G oder nach Förderschwerpunkt — Letzteres
  standardmäßig aus, weil der Plan oft am Beamer hängt
- der Elternkontakt zeigt die Fehltage des Kindes

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
über eine Warteschlange im Browser: Änderungen werden gepuffert und bei
Verbindung automatisch nachgeholt. Ausgenommen bleibt, was den Server jetzt
braucht (Anmeldung, laufende Abstimmung), was sich nicht wiederholen lässt
(endgültig löschen, Zugänge neu vergeben) und was kein JSON ist (Bilder,
Dateien) — was der Server beim Nachholen ablehnt, wird angezeigt statt still
verworfen. Sie ist bewusst kein Modul. Details in `apps/desktop/README.md`.

Fertig gebaut hängt sie an jedem [Release](https://github.com/norbert-me/Nuvora/releases)
(`.dmg` für Apple Silicon und Intel), unsigniert — beim ersten Start Rechtsklick
→ *Öffnen*. **Für iPhone/iPad gibt es keine App**; dort führt der Weg über
Safari: *Teilen* → *Zum Home-Bildschirm*.

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
