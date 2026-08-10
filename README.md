# Nuvora

**Deutsch** · [English](README.en.md)

Werkzeugkasten **für Lehrkräfte**. Selbst gehostet, keine Cloud, keine Schülerdaten bei Dritten.

Quellcode: [github.com/norbert-me/Nuvora](https://github.com/norbert-me/Nuvora)

Quelloffen und nicht kommerziell nutzbar ([CC BY-NC 4.0](LICENSE)) — der Quellcode liegt offen, kommerzielle Nutzung ist ausgeschlossen. Das ist bewusst *keine* OSI-Open-Source-Lizenz.

> **100 % mit KI gebaut.** Code, Design und Texte sind vollständig mit einem KI-Assistenten (Claude) entwickelt — als Beleg, wie weit KI-gestützte Softwareentwicklung heute trägt.

Lernende brauchen keine Geräte und keine Konten — sie tauchen nur als Datensätze auf, die die Lehrkraft verwaltet.

Nuvora ist die Basis: Konto, Klassen, Kurse, Schüler und Themen liegen hier. Module werden dazugeschaltet und arbeiten auf diesen Daten — sie besitzen sie nicht.

## Für wen — und was es nicht ist

**Für Lehrkräfte**, die ihre Klassen, Noten, Aufgaben und Planung an einem Ort
haben wollen, ohne Schülerdaten in fremde Hände zu geben. Betrieben wird es von
einer Person oder einer Schule auf einem eigenen Server.

Nuvora ist ausdrücklich **nicht**:

- **keine Lernplattform.** Lernende haben keine Konten, melden sich nie an und
  bekommen keine Oberfläche mit Fortschrittsbalken. Sie sind Datensätze, die
  die Lehrkraft verwaltet. Zwei Wege führen ohne Konto in die App — Karteikarten
  üben und einer Code-Detektiv-Sitzung beitreten —, beide über einen geheimen
  Link, beide ohne Anmeldung.
- **kein Schulverwaltungsprogramm.** Keine Zeugnisse, keine Stundenpläne für
  ein Kollegium, keine Elternportale, kein Rollenmodell (Administration ist
  Konto 1).
- **kein gehosteter Dienst.** Es gibt keine Nuvora-Cloud, bei der man sich
  anmeldet. Wer es nutzen will, betreibt es selbst — und ist damit im Sinne der
  DSGVO verantwortlich.
- **kein Produkt mit Support.** Ein-Personen-Projekt ohne Einnahmen, ohne
  Zusage auf Antwortzeit und ohne Zusicherung, dass ein Modul erhalten bleibt.

Wer prüft, ob er dieser Software Schülerdaten anvertrauen kann, fängt am besten
bei [docs/datenschutz.md](docs/datenschutz.md) an: welche Daten, wo, wie lange,
was nach außen geht und was das Backup-Skript ausdrücklich *nicht* sichert.

## Dokumentation

| Seite | Für wen |
| ----- | ------- |
| [Architektur](docs/architektur.md) | Wie Kern und Module zusammenhängen und warum Module Gäste sind |
| [Ein neues Modul bauen](docs/neues-modul.md) | Beitragen: die fünf Einträge, ohne die es ungeprüft bleibt |
| [Selbsttest](docs/selbsttest.md) | Was „grün" bedeutet — und was nicht |
| [Datenschutz](docs/datenschutz.md) | Welche Daten, wo, wie lange; Auskunft und Löschung |
| [Entwicklung](docs/entwicklung.md) | Lokal am Code arbeiten, Tests, Abhängigkeiten |
| [SECURITY.md](SECURITY.md) | Lücken melden, bekannte Grenzen, Signaturen prüfen |

> **Status: stabil, wächst weiter.** Der Rahmen steht — Anmeldung, Startseite, Modulverwaltung, Klassen, Kurse und Themen sind Nuvora. Vierzehn Module sitzen auf dem Kern; keins hat eigene Konten oder eine eigene Datenbank. Verwandte Werkzeuge sind unter einem Modul mit **Reitern** gebündelt (z. B. Auswertung = Notenbuch + Klassenarbeiten, Notizbrett = Notizen + To-do, Orga = Checklisten + Anwesenheit + Ausleihe + Sitzplan). Die geteilte **Themen-Taxonomie** verbindet sie: ein in CardVote oder Code-Detektiv schwaches Thema erzeugt auf Knopfdruck ein Karten-Übungsdeck oder eine Lernpfad-Wiederholung, Test-Ergebnisse werden zu einer Notenspalte, und die Themen-Ansicht zeigt zu einem Thema alles quer über die Module — samt hinterlegtem Material.

Was das konkret heißt, in Zahlen: **14 Module** im Register, **218 API-Tests**
und **58 Frontend-Tests**, die bei jedem Push laufen, und ein Selbsttest, der
nach jedem Deploy jedes Modul einmal wirklich benutzt. Was es *nicht* heißt:
dass jemand außer dem Autor die Software im Alltag betreibt. Nuvora läuft auf
einer Installation, und der Autor ist dieselbe Person, die sie schreibt.

## Screenshots

*Noch keine im Repository.* Wer beim Lesen wissen will, wie das aussieht, muss
es derzeit selbst starten — das ist eine Lücke, keine Absicht. Bilder gehören
nach `docs/bilder/` und werden von hier aus eingebunden; welche Ansichten
gebraucht werden, steht in [docs/bilder/README.md](docs/bilder/README.md).

## Kern

- **Klassen** = die Schülergruppe (die Personen). **Kurse** = das Fach; eine Klasse kann in mehreren Kursen liegen (n:m). Modul-Inhalte hängen am Kurs, die Schüler werden geteilt.
- **Themen** in drei Ebenen (Fach → Thema → Unterthema) — die gemeinsame Taxonomie, auf die alle Module zeigen.
- **Material** je Thema und je Kalender-Stunde: Arbeitsblätter, PDFs u. Ä. ablegen (im Konto, privat, nicht geteilt).
- **Modulregister** im Code: ein Modul existiert nur, wenn es Code dazu gibt; die Datenbank merkt sich nur, wer was aktiviert hat.

## Module

### CardVote — `apps/web` + `apps/api`

Abstimmung im Unterricht ganz ohne digitale Endgeräte. Lernende halten bedruckte Karten hoch, die Lehrkraft scannt sie mit der Handykamera, Ergebnisse erscheinen live.

- **Live-Abstimmung** — Fragen auf dem Beamer, Ergebnisse in Echtzeit per WebSocket, Timer pro Frage
- **Spiel-Modus** — Punkte, Streaks, Bestenliste, Podium
- **Auswertung** — Notenverteilung mit anpassbarem Schlüssel, Boxplots, 95%-Konfidenzintervalle, didaktische Hinweise (Decken-/Bodeneffekt, Streuung, Ratewahrscheinlichkeit)
- **Ergebnis → Note** — die Trefferquote als Notenspalte übernehmen (mit Link zurück zur Auswertung)
- **Export** — PDF, Excel, iDoceo-CSV
- **Fragen** — Ordner und Fragesets, LaTeX-Formeln, Bilder, Import/Export als JSON oder Excel
- **Scanner** — ArUco-Erkennung (OpenCV, `DICT_6X6_50`) über die Handykamera, Fernsteuerung der Session
- **Marktplatz** — eigene Fragesets veröffentlichen, fremde bewerten und übernehmen

FastAPI · Postgres · React · OpenCV (ArUco)

### Lernpfad

Verwaltung von Aufgaben und Lernpfaden. Ein Lernpfad besteht aus mehreren **Lernleitern**; der Generator verteilt Aufgaben differenziert auf die Lernenden.

Die bewährte Oberfläche blieb — sie ist **ins Web-Projekt eingebaut** (`apps/web/public/lp/`) und wird **nativ in die Shell gemountet** (kein iframe, kein Nachbau, kein eigener Container): das HTML wird in einen Host injiziert, das CSS gescopet, die App läuft im selben Fenster auf Nuvoras API. Lernleitern lassen sich über den Marktplatz teilen (der Aufgabenpool, ohne Schülerbezug).

Vanilla JS, in-page gemountet

### Auswertung — Notenbuch + Klassenarbeiten

Leistung auswerten an einem Ort, in zwei Reitern.

**Notenbuch** — Spalten aus deinem Leistungskonzept mit Gewichten; bedient sich wie eine leere Tabelle. Rechnet den gewichteten Schnitt und zeigt, wie viel des Konzepts belegt ist — die Zeugnisnote bleibt deine Entscheidung, Beobachtungen zählen nie mit. Ein **Trend je Schüler** (▲/▼) zeigt, ob die Leistung übers Halbjahr steigt oder fällt. Als Notenspalte übernehmbar: **CardVote**-Trefferquote, **Karten**-Meisterung und **Code-Detektiv**-Sessions (jeweils über deine Notenskala).

**Klassenarbeiten** — Aufgaben mit Thema anlegen und je Schüler richtig/falsch (oder Teilpunkte) ankreuzen. Die Auswertung zeigt Punkte, Notenverteilung mit anpassbarem Schlüssel, Boxplots und Trennschärfe je Aufgabe — und **wer bei welchem Thema Nachholbedarf hat**. Daraus lässt sich gezielte Wiederholung (Karten-Deck / Lernpfad) anstoßen. Abwesende werden herausgerechnet, ohne ihre Noten zu verlieren.

### Karten

Karteikarten mit Spaced Repetition (SM-2). Ein Stapel gehört einem Kurs; die Lernenden üben **ohne Konto** über einen QR-Code (geheimer Token pro Person), ihren Reifegrad-Fortschritt sieht die Lehrkraft. Optional an ein Thema gebunden — dann schaltet der Kalender den Stapel am geplanten Tag automatisch frei. Die Meisterung lässt sich als Notenspalte übernehmen.

### Kalender

Unterrichtsplanung: Tag-, Wochen-, Monatsansicht und ein wiederkehrender **Stundenplan** (Klasse je Stunde, Farben, Uhrzeiten). An einen Eintrag lässt sich ein CardVote-Quiz, ein Karten-Deck oder eine Lernleiter planen; **freie Tage** (Ferien/Feiertage) blenden Stunden aus. **Kalender-Sync** in beide Richtungen: eigener ICS-Feed zum Abonnieren (Apple/Google) und ein externer Kalender read-only eingeblendet (SSRF-gehärtet).

### Unterrichtsplanung — Einstiege

**Einstiege** — Ideen für den Unterrichtseinstieg: Idee, Ablauf mit Material, Materialliste, ungefähre Dauer. Wiederverwendbar, an Kalender-Stunden zuweisbar und themen-getaggt: zu einem schwachen Thema schlägt die Startseite einen passenden Einstieg vor.

### Code-Detektiv

Programmier-Rätsel für den Informatikunterricht: Code-Bausteine per Drag & Drop in die richtige Reihenfolge bringen, allein oder in einer Klassen-Session (öffentliches Beitreten per Code, ohne Login). Nativ in der Shell (React). Themen-getaggte Rätsel fließen in die schwachen Themen ein.

### Orga

Werkzeuge zur Klassenführung, in Reitern:

- **Checklisten** — Sammel-Häkchen (z. B. „Unterschrift der Klassenarbeit gesehen")
- **Anwesenheit / Fehlzeiten** — Status je Tag, Übersicht je Person, PDF-Report
- **Ausleihe** — Gegenstände verleihen, Rückgabe und Überfälligkeit im Blick
- **Sitzplan** — Tische frei platzieren und drehen; optional **SEGEL-Stufen** (Helios-Konzept Hafen → Küste → Meer → Welt) je Schüler am Platz, für den schnellen Blick im Unterricht

### Zufallsschüler

Zieht per Knopfdruck eine zufällige Person aus einer Klasse — fair gewichtet nach der Zeit seit dem letzten Ziehen, nicht zweimal am Stück. Optional auf E-/G-Niveau eingeschränkt; auch als Zufallsgruppen-Generator.

### Notizbrett

Zwei Reiter: **Notizen** (freie Zettel, sortierbar) und **Aufgaben** (To-do-Liste). Datierte Aufgaben erscheinen zusätzlich im Kalender. Nicht an Schüler gebunden.

### Klassenleitung

Aufgaben der Klassenleitung — derzeit die **Elternkontakte** je Schüler: Datum, Kanal (Telefon/Mail/Gespräch) und Notiz. Erfüllt die Dokumentationspflicht ohne Zettel.

### Beobachtungen

Formative Notizen je Schüler mit Datum (Anstrengung, Sozialverhalten, Fortschritt) — **bewusst getrennt von der Note**. Was das Notenbuch nicht misst, hat hier seinen Platz.

### Tafel

Frei platzierbare Textfelder und ein Countdown-Timer für den Beamer. Felder verschieben, skalieren, einfärben; Vollbild. Reines Werkzeug, ohne Daten.

### Mathespiele

Sammlung von Mathe-Spielen. Aktuell **Mathefußball**: Kopfrechen-Duell für zwei Teams am Beamer — die richtige Antwort schiebt den Ball Richtung gegnerisches Tor. Zahlenraum und Rechenarten einstellbar.

### Desktop-App (macOS, optional)

`apps/desktop` — eine schlanke Electron-Hülle um dieselbe Weboberfläche: eigenes Fenster, Dock-Icon, kein Browser-Rahmen. **Kein eigener Server, keine eigene Datenbank**; die App zeigt auf deinen Nuvora-Server. Offline *lesen* funktioniert über Nuvoras Service Worker, offline *schreiben* noch nicht. Details in `apps/desktop/README.md`.

## Architektur

Nuvora ist die Basis, Module sind Gäste. Drei Regeln, die jede Änderung einhält:

1. **Kein Modul besitzt Klassen oder Schüler** — die liegen im Kern, alle Module teilen sie.
2. **Kein Modul hat eigene Konten** — der Kern authentifiziert, Module erben.
3. **Module hängen nicht voneinander ab** — CardVote läuft ohne Lernpfad und ohne Noten. Verbindendes (gemeinsame Themen, Ergebnis-Übernahme) ist Zusatz, nie Voraussetzung.

```
Nuvora-Kern (apps/api, apps/web)
├── Konten · Klassen · Kurse · Schüler · Themen · Material   gehören dem Kern
├── Modulregister                                            wer hat was aktiviert
└── Module
    ├── CardVote           /cardvote/*         Abstimmung, Auswertung, Marktplatz
    ├── Lernpfad           /lernpfad           Aufgaben & Lernleitern (nativ in-page)
    ├── Karten             /karten             Karteikarten, Spaced Repetition
    ├── Kalender           /kalender           Planung, Stundenplan, ICS-Sync
    ├── Auswertung         /auswertung         Notenbuch + Klassenarbeiten
    ├── Unterrichtsplanung /unterrichtsplanung Einstiege
    ├── Code-Detektiv      /code-detektiv      Programmier-Rätsel (nativ)
    ├── Orga               /orga               Checklisten · Anwesenheit · Ausleihe · Sitzplan
    ├── Zufallsschüler     /zufall             zufällige Person / Gruppen
    ├── Notizbrett         /notizbrett         Notizen + To-do
    ├── Klassenleitung     /klassenleitung     Elternkontakte
    ├── Beobachtungen      /notizen            formative Notizen je Schüler
    ├── Tafel              /tafel              Beamer-Textfelder + Timer
    └── Mathespiele        /mathespiele        Mathe-Spiele (Beamer)
```

Verbindendes ist Zusatz, nie Voraussetzung: die geteilte **Themen-Taxonomie** trägt die Brücken.

- schwaches CardVote-/Code-Detektiv-Thema → Karten-Deck oder Lernpfad-Aufgabe (auch fachübergreifend, mit Klassenwahl)
- CardVote-, Karten- und Code-Detektiv-Ergebnisse → Notenspalte
- schwaches Thema → passender Einstieg vorgeschlagen
- Lernleitern über den Marktplatz teilbar
- Kalender plant Quiz/Deck/Lernleiter und schaltet Decks am Tag frei
- Themen-Ansicht zeigt zu einem Thema alles quer über die aktiven Module, samt Material

| Teil       | Stack                                        |
| ---------- | -------------------------------------------- |
| Kern-API   | FastAPI · SQLAlchemy 2 (async) · Postgres 16 |
| Frontend   | React 18 · Vite · react-router · i18n (de vollständig, en/es weitgehend) |
| Lernpfad   | Vanilla JS, nativ in die Shell gemountet     |
| Proxy      | nginx — eine Domain, alle Teile              |

Ein Konto sieht nur eigene Daten (`owner_id` überall); Module werden pro Lehrkraft zugeschaltet.

Warum das so gebaut ist, wie die drei Bauformen der Module aussehen und wo die Grenzen liegen: [docs/architektur.md](docs/architektur.md).

## Wer betreibt, ist verantwortlich

Nuvora läuft auf **deinem** Server. Damit bist du im Sinne der DSGVO Verantwortlicher für die Daten darin — nicht das Projekt. Praktisch heißt das: Rücksprache mit Schulleitung und Schulträger, ein Verzeichnis von Verarbeitungstätigkeiten, ein Blick in die Vorgaben deines Bundeslandes, und Sicherungen, die du auch zurückspielen kannst.

Was Nuvora dafür mitbringt: eine vollständige Datenschutzerklärung und ein Impressum, gespeist aus `config/site.json`, erreichbar unter `/legal` — auch von den Seiten, die Lernende ohne Konto sehen. Dazu eine Auskunft nach Art. 15 (Profil → Daten exportieren), Selbstlöschung des Kontos und automatische Fristen (Papierkorb 30 Tage, unbestätigte Konten 14 Tage, Spielsitzungen 1 bzw. 7 Tage).

Lücken bitte nicht als öffentliches Issue: [SECURITY.md](SECURITY.md) beschreibt den Meldeweg, `/.well-known/security.txt` nennt ihn maschinenlesbar (RFC 9116).

## Sicherheit & Datenschutz

- **Selbst gehostet, keine Cloud.** Schülerdaten verlassen den eigenen Server nicht.
- **Lernende haben keine Konten** und loggen sich nie ein — sie sind Datensätze, die die Lehrkraft verwaltet.
- **Besonders schützenswerte Daten** (Förderschwerpunkte, Notizen — DSGVO Art. 9) stehen in **keinem Export** und in keiner Marktplatz-Veröffentlichung.
- **Passwörter** mit Argon2id gehasht (19 MiB Speicher, 2 Durchgänge); ältere PBKDF2-Hashes werden beim nächsten Login still angehoben, ohne dass jemand etwas tun muss. Pflicht zur E-Mail-Bestätigung, Reset per Einmal-Link.
- **Externer Kalender-Abruf SSRF-gehärtet** (private/lokale IPs und Redirects gesperrt).
- **Sicherheits-Header** zentral am Proxy (CSP, `X-Frame-Options: SAMEORIGIN`, `nosniff`, Referrer-Policy); `server_tokens off`.
- **Rate-Limits** gegen Brute-Force und Massenanlage auf allen schreibenden Endpunkten.
- **Secrets** liegen nur auf dem Server (`.env`, `chmod 600`) und werden nie ins Repo committet; `POSTGRES_PASSWORD` und `TOKEN_SECRET` sind Pflicht, sonst startet der Stack nicht.

Vollständige Bestandsaufnahme — welche Felder, welche Tabellen, welche Fristen, was nach außen geht, was das Backup-Skript nicht sichert: [docs/datenschutz.md](docs/datenschutz.md). Die bekannten Grenzen (Token im `localStorage`, prozesslokale Rate-Limits, Schüler-Token in der Adresse, kein Rollenmodell) stehen offen in [SECURITY.md](SECURITY.md).

## Ziel der Bündelung

1. Klassen, Kurse und Schüler einmal anlegen, in allen Modulen nutzen.
2. Testergebnisse steuern den Lernpfad: schwache Themen erzeugen passende Aufgaben.
3. Ein Login, eine Domain.

## Releases, Kanäle und Support

Zwei Update-Kanäle, einstellbar im Profil: **Stable** springt nur auf Hauptversionen (4.0.0, 5.0.0), **Beta** nimmt alles dazwischen mit. Auf der Releases-Seite steht deshalb vieles als „Pre-release" — das ist die Beta-Linie, kein Hinweis auf Instabilität. Die Version steht im Profil unter „Über Nuvora".

Das Schema entsteht beim Start von selbst (siehe unten); ein Upgrade braucht keine Migrationsschritte, nur `./deploy.sh`.

Tags sind signiert; `git verify-tag v4.0.0` prüft das (Anleitung in [SECURITY.md](SECURITY.md)). Jedes Release trägt eine Stückliste der Abhängigkeiten als Anhang.

**Support:** Nuvora ist ein Ein-Personen-Projekt ohne Einnahmen. Fehlermeldungen und Ideen sind willkommen und werden gelesen, aber es gibt keine Zusage auf Antwortzeit, keinen Support-Vertrag und keine Zusicherung, dass ein Modul erhalten bleibt. Wer Nuvora produktiv einsetzt, sollte das einkalkulieren — der Quellcode liegt offen, die Daten liegen bei dir.

## In 10 Minuten lokal laufend

Zum Ausprobieren auf dem eigenen Rechner. Für den Serverbetrieb siehe
[Deploy](#deploy) — dort erzeugt `deploy.sh` die Secrets selbst.

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
Zufallswerte erzeugen:

```bash
openssl rand -hex 24    # → POSTGRES_PASSWORD in .env eintragen
openssl rand -hex 32    # → TOKEN_SECRET in .env eintragen
```

Beide Zeilen in `.env` mit einem Editor füllen. (Ein `sed -i`-Einzeiler ist
zwischen macOS und Linux nicht portabel — deshalb hier von Hand.)

**3. Das erste Konto festlegen.** In `.env` stehen `ADMIN_EMAIL` und
`ADMIN_PASSWORD`. Aus diesen beiden Werten legt Nuvora **beim ersten Start**
das Administrationskonto an — bereits bestätigt. Passwort ändern, die
E-Mail-Adresse kann lokal bleiben, wie sie ist.

> **Das ist der Schritt, an dem man sonst hängenbleibt.** Sich über
> `/login` selbst zu registrieren funktioniert lokal **nicht**: die Anmeldung
> verlangt eine bestätigte E-Mail-Adresse, und ohne konfigurierten SMTP-Server
> wird keine Bestätigungsmail verschickt. Das Admin-Konto aus der `.env` ist
> der Weg hinein.

**4. Starten**

```bash
docker compose up -d --build
```

**5. Anmelden** auf <http://localhost:8080> mit `ADMIN_EMAIL` und
`ADMIN_PASSWORD` aus der `.env`.

**6. Ein Modul zuschalten.** Frisch ist die Shell fast leer — das ist Absicht:
Module werden pro Lehrkraft aktiviert. Unter `/modules` eins auswählen, danach
erscheint es in der Navigation. Danach unter `/classes` eine Klasse mit ein
paar Schülern anlegen — fast jedes Modul arbeitet darauf.

(Beispielinhalte legt nur die **Registrierung** über `/login` an, nicht das
Admin-Konto aus der `.env`. Lokal startet man also mit einer leeren
Installation.)

Danach erreichbar:

| Pfad         | Was                                                |
| ------------ | -------------------------------------------------- |
| `/`          | Nuvora — Startseite, Module, Klassen, Kurse, Themen |
| `/modules`   | Module zuschalten und abschalten                   |
| `/cardvote/` | Modul CardVote                                     |
| `/lernpfad`  | Modul Lernpfad                                      |
| `/auswertung`| Modul Auswertung (Notenbuch + Klassenarbeiten)     |
| weitere      | `/karten` · `/kalender` · `/unterrichtsplanung` · `/code-detektiv` · `/orga` · `/zufall` · `/notizbrett` · `/klassenleitung` · `/notizen` · `/tafel` · `/mathespiele` |

**Wenn etwas nicht geht:**

| Symptom | Ursache |
| ------- | ------- |
| `POSTGRES_PASSWORD nicht gesetzt` beim `up` | Schritt 2 übersprungen — Compose bricht bewusst ab |
| Anmeldung sagt „E-Mail noch nicht bestätigt" | Über `/login` registriert statt das Admin-Konto benutzt (Schritt 3) |
| Modul-Seite leitet auf `/modules` um | Das Modul ist für dieses Konto nicht zugeschaltet |
| Passwort in `.env` später geändert, DB lässt niemanden rein | Postgres legt die Rolle nur beim **ersten** Start an — siehe [Konfiguration](#konfiguration) |
| Port 8080 belegt | `PORT` in `.env` ändern |

Wieder abräumen — `docker compose down -v` löscht auch die Datenbank.

## Deploy

```bash
cp .deploy.env.example .deploy.env   # Server und Zielpfad eintragen
./deploy.sh                          # alles
./deploy.sh api                      # nur einen Service neu bauen
./deploy.sh --port 8090              # anderer Port, wird in .deploy.env gemerkt
./deploy.sh --schnelltest            # nur der kurze API-Selbsttest
./deploy.sh --kein-selftest          # ohne Prüfung ausliefern
```

Lädt hoch, baut auf dem Server, prüft Kern und Module und bricht ab, wenn etwas nicht antwortet. Danach läuft die **Prüfung** (siehe unten) — **vollständig**, das ist die Voreinstellung. Der Rückgabewert ist rot, wenn sie etwas findet.

Vollständig ist Absicht: ein grüner Deploy soll heißen „die Seite läuft", nicht „der Teil, den wir angeschaut haben, läuft". Wer weniger prüft, sagt es mit `--schnelltest` — und bekommt am Ende einen Block „Umfang dieses Laufs", der jeden übersprungenen Teil mit Grund aufführt.

Services: `api` (Kern), `web` (Shell + Modul-Seiten inkl. Lernpfad-Statik), `db`, `proxy`. Einen eigenen Lernpfad-Container gibt es nicht mehr.

Beim ersten Lauf legt das Skript die `.env` auf dem Server an und erzeugt `TOKEN_SECRET` und `POSTGRES_PASSWORD` als Zufallswerte (`chmod 600`) — niemand muss sie lesen oder eintippen. Danach wird die `.env` des Servers **nie** überschrieben; Secrets bleiben dort.

Optional nachtragen für Mailversand und Admin-Konto (`SMTP_*`, `ADMIN_EMAIL`):

```bash
ssh <server>
cd <pfad> && nano .env
```

`ADMIN_EMAIL` sollte eine **echte, empfangende** Mailadresse sein — dorthin gehen Kontaktanfragen. Ein reiner Absender (`SMTP_FROM`) ohne Postfach empfängt nichts. Das Admin-Profil zeigt eine Einrichtungs-Checkliste inkl. Zustellbarkeit.

## Konfiguration

Alles wird an **einer** Stelle konfiguriert, im Wurzelverzeichnis. Die Module haben keine eigenen `.env`-Dateien, kein eigenes Compose und kein eigenes Deploy mehr.

```bash
cp .env.example             .env          # Secrets, Ports, SMTP
cp .deploy.env.example      .deploy.env   # Zielserver
cp config/site.example.json config/site.json  # Impressum/Betreiberdaten
```

| Datei              | Inhalt                                        | Im Repo? |
| ------------------ | --------------------------------------------- | -------- |
| `.env`             | Passwörter, `TOKEN_SECRET`, SMTP              | nein     |
| `.deploy.env`      | Serveradresse, Zielpfad, Zugang für den Selbsttest | nein |
| `config/site.json` | Betreiber, Anschrift, Kontakt (Impressum)     | nein     |

`config/site.json` ist die einzige Quelle der Betreiberdaten: Lernpfad liest sie serverseitig, das Impressum im Rahmen holt sie über `/site.json` vom Proxy.

**Postgres legt Rolle und Datenbank nur beim ersten Start an.** Ein später geändertes `POSTGRES_PASSWORD` erreicht eine bestehende Datenbank nicht — dann ist es ein `ALTER ROLE`, kein `.env`-Edit. `deploy.sh` prüft das vorab und sagt, was zu tun ist.

Datenbanken, Backups und Uploads enthalten personenbezogene Daten und sind grundsätzlich von Git ausgeschlossen.

## Selbsttest

Nach jedem Deploy prüft Nuvora sich selbst — `./deploy.sh` ruft `./selftest.sh` automatisch, einzeln geht es auch:

```bash
./selftest.sh                # ALLES: API, Systemtest, beide Browser-Läufe
./selftest.sh --schnell      # nur der kurze API-Selbsttest
./selftest.sh --ohne-browser # API + Systemtest, ohne Playwright
./selftest.sh --ohne-system  # ohne den Alleinstellungs-Durchgang
./selftest.sh --nur-system   # ohne Anmeldung, ohne Schreiben
./selftest.sh --debug        # jede Anfrage mit Status und Dauer
```

Ausführlich — auch, was ein grüner Lauf **nicht** bedeutet — in
[docs/selbsttest.md](docs/selbsttest.md).

„Health" sagt nur, dass ein Container läuft. Die Prüfung sagt, ob die Installation *funktioniert*. Sie besteht aus vier Teilen:

| Teil | Datei | Was es tut |
| ---- | ----- | ---------- |
| Selbsttest | `scripts/selftest.py` | API, Einrichtung, Seiten, je Modul ein Schreib-Roundtrip |
| Systemtest | `scripts/systemtest.py` | jedes Modul **einzeln**: nur dieses aktiv, alle anderen müssen abweisen |
| Rundgang | `scripts/selftest-browser.mjs` | jede Seite im echten Browser — Desktop, Handy, dunkel |
| Oberflächen | `scripts/systemtest-browser.mjs` | jedes Modul einzeln in der Oberfläche, verbotene Verbindungen unsichtbar |

Am Ende steht, welche Teile gelaufen sind. Was übersprungen wurde, steht ebenfalls da — ein grüner Lauf ohne vollen Umfang ist keine Aussage über die Seite.

### Was geprüft wird

| Bereich          | Was geprüft wird |
| ---------------- | ---------------- |
| Erreichbarkeit   | Namensauflösung, Antwortzeit, WebSocket-Handshake (Live-Ergebnisse), TLS-Zertifikat samt Restlaufzeit, Umleitung http → https |
| Sicherheit       | Schutz-Kopfzeilen auf mehreren Pfaden, Server-Kennung ohne Version, API-Doku nicht öffentlich, Datenrouten ohne Token verschlossen, heikle Dateien (`.env`, `.git/config` …) liefern nichts |
| Web-Dateien      | `robots.txt`, favicon, Manifest, Icons, unbekannte Adressen bekommen die Shell, Anwendung kommt komprimiert und zwischenspeicherbar |
| Einrichtung      | Datenbank, **Schema gegen die Modelle** (es gibt kein Alembic — hier fällt auf, was in `_ensure_columns` fehlt), Konfiguration, Betreiberdaten, Modulregister gegen die gemounteten Router |
| E-Mail           | Host, Verbindung, Anmeldung, Absender-Freigabe (`MAIL FROM`/`RCPT TO`, **ohne** eine Mail zu verschicken), SPF und DMARC der Absender-Domain |
| Module           | je Modul ein echter Schreib-Roundtrip auf Kern-Klasse und -Schülern: anlegen, lesen, ändern, löschen |
| Alleinstellung   | je Modul: nur dieses aktiv — die eigenen Endpunkte antworten, **alle fremden liefern genau 403** (Regel 3). Weder 200 (Daten offen) noch 500 (Schranke kracht statt abzuweisen) |
| Rechnen          | CardVote vollständig durchgespielt (Fragen, E/G, Scans, Auswertung) und die Zahlen im Test **nachgerechnet** — Trefferquote, E-Bonus, Notenverteilung, Minuspunkte, krank/anwesend; dazu Noten übernehmen, ändern, gewichten |
| Brücken          | jede Modul-Verbindung **zweimal**: mit beiden Modulen muss sie funktionieren, mit einem sauber abgelehnt werden — im Backend und in der Oberfläche |
| Schüler-Wege     | `/lernen/<token>` und `/cd/<code>` ohne Konto — und Absage bei falschem Token |
| Mandantentrennung | fremde IDs lesen und beschreiben muss scheitern |
| Bestand          | Klassen, Schüler, Kurse, Themen im Vergleich zum letzten Lauf — Frühwarnung, falls eine Kaskade zu viel mitreißt |
| Browser          | jede Seite rendert, keine Konsolenfehler, keine toten Links — Desktop, **Handy (390 px)** und **dunkles Design**; dazu echte Handgriffe mit Neuladen als Beweis, dass gespeichert wurde |

### Testdaten und Aufräumen

Testdaten tragen das Präfix `ZZ-Selbsttest` bzw. `ZZ-Systemtest` und werden inklusive Papierkorb wieder abgeräumt; zugeschaltete Module werden zurückgesetzt. Nötig ist ein eigenes Testkonto (`SELFTEST_EMAIL`/`SELFTEST_PASSWORD` in `.deploy.env`, einmalig selbst registrieren) — `SELFTEST_TOKEN` erzeugt `deploy.sh` beim ersten Lauf von allein.

Bleibt nach einem Abbruch (Strg-C) etwas liegen, räumen die Tests es beim nächsten Lauf selbst weg. Von Hand geht es auch:

```bash
python3 scripts/aufraeumen.py             # nur anzeigen, was liegengeblieben ist
python3 scripts/aufraeumen.py --loeschen  # wirklich abräumen
python3 scripts/aufraeumen.py --module-aus  # alle Module abschalten
```

Es fasst ausschließlich an, was ein Testpräfix trägt — die Prüfung sitzt unmittelbar vor jedem Löschen, nicht nur in der Auswahl. Den Modul-Zustand stellt es aus `.selftest-module.json` wieder her, die die Tests vor dem ersten Umschalten schreiben; fehlt sie, sagt es das und rät nicht.

Der Browser-Teil braucht Playwright; `selftest.sh` installiert es beim ersten Mal nach `scripts/node_modules` (bewusst getrennt von `apps/web`, damit es nie ins Web-Image wandert).

## Tests

```bash
cd apps/api && pip install -r requirements-dev.txt && pytest
```

218 Regressionstests für die Stellen, an denen ein Fehler still Daten kostet: E/G-Wertung, Klassen-Update ohne Datenverlust, Papierkorb-Kaskaden, Mandantentrennung, Kurs-Logik. Dazu 58 Frontend-Tests (`cd apps/web && npm run test`). Bei jedem Push laufen sie zusammen mit dem Web-Build und einem `docker compose build` in der CI.

## Beitragen

Es gibt keinen Prozess und keine Zusage auf Antwortzeit — aber es gibt eine Anleitung:

- [docs/entwicklung.md](docs/entwicklung.md) — lokal am Code arbeiten, Tests, Abhängigkeiten
- [docs/neues-modul.md](docs/neues-modul.md) — ein neues Modul bauen: die fünf Einträge, ohne die es ungeprüft bleibt
- [docs/architektur.md](docs/architektur.md) — die drei Regeln, an die sich jede Änderung hält

Vor größerer Arbeit lohnt eine Rückfrage per Issue. Sicherheitslücken **nicht** als Issue, sondern über den Weg in [SECURITY.md](SECURITY.md).

## Abhängigkeiten ändern (Python)

Zwei Dateien, eine Richtung: `apps/api/requirements.txt` ist die Quelle mit Bereichen, `apps/api/requirements.lock.txt` ist daraus **erzeugt** — feste Fassungen samt Hashes. Container und CI installieren nur aus der Lock-Datei (`pip install --require-hashes`), damit zwei Builds vom selben Commit dasselbe ergeben und ein umgeschriebenes Upstream-Paket am Hash auffällt. Wer die Lock-Datei von Hand bearbeitet, arbeitet gegen das nächste `pip-compile`.

```bash
cd apps/api
pip install pip-tools            # einmalig
# 1. requirements.txt bearbeiten (Paket hinzu, Bereich ändern)
# 2. Lock neu erzeugen — mit Python 3.12, wie im Container:
pip-compile --allow-unsafe --generate-hashes --strip-extras \
  --output-file=requirements.lock.txt requirements.txt
```

`pip-compile` löst für den Interpreter, unter dem es läuft — deshalb Python 3.12. Stolperstein: pip-tools 7.6 bricht mit pip 26 ab (`make_requirement_preparer() missing … allow_editables`); dann im selben Venv `pip install "pip<26"`. Die Testwerkzeuge (`requirements-dev.txt`) bleiben bewusst ohne Lock: sie werden nie ausgeliefert, und eine unerwartete Fassung fällt sofort als roter Testlauf auf.

## Schema & Migrationen

Kein Alembic. Das Schema entsteht beim Start aus `Base.metadata.create_all` plus additive Spalten/Indizes in `_ensure_columns` (idempotent). Neue Tabellen kommen von selbst; neue Spalten gehören in die `wanted`-Liste.

## Lizenz und was sie praktisch heißt

[CC BY-NC 4.0](LICENSE) — Namensnennung, nicht kommerziell.

- **Erlaubt:** Betrieb an Schulen, durch Lehrkräfte, Schulträger und öffentliche Bildungseinrichtungen; Weitergabe und Veränderung, solange Nuvora genannt wird.
- **Nicht erlaubt:** Verkauf, kostenpflichtiges Hosting als Dienst, Nutzung in kommerziellen Fortbildungen oder als Teil eines bezahlten Angebots.
- Im Zweifel fragen — Antwort kommt.

Zwei Dinge dazu ehrlich gesagt: Creative-Commons-Lizenzen sind nicht für Software gedacht (keine Patent- und Haftungsklauseln), und „nicht kommerziell" ist juristisch unscharf. Deshalb steht die Abgrenzung oben im Klartext. Nuvora ist damit **keine** OSI-konforme Open-Source-Lizenz, auch wenn der Quellcode offenliegt.

**Ohne Gewähr.** Die Software wird bereitgestellt, wie sie ist — keine Zusicherung von Eignung, Verfügbarkeit oder Fehlerfreiheit, keine Haftung für Datenverlust. Wer sie mit Schülerdaten betreibt, sorgt selbst für Sicherungen.
