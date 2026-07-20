# Nuvora

**Deutsch** · [English](README.en.md)

Werkzeugkasten **für Lehrkräfte**. Selbst gehostet, keine Cloud, keine Schülerdaten bei Dritten.

Quellcode: [github.com/norbert-me/Nuvora](https://github.com/norbert-me/Nuvora)

Quelloffen und nicht kommerziell nutzbar ([CC BY-NC 4.0](LICENSE)) — der Quellcode liegt offen, kommerzielle Nutzung ist ausgeschlossen. Das ist bewusst *keine* OSI-Open-Source-Lizenz.

Lernende brauchen keine Geräte und keine Konten — sie tauchen nur als Datensätze auf, die die Lehrkraft verwaltet.

Nuvora ist die Basis: Konto, Klassen, Kurse, Schüler und Themen liegen hier. Module werden dazugeschaltet und arbeiten auf diesen Daten — sie besitzen sie nicht.

> **Status: 2.0 — stabil, wächst weiter.** Der Rahmen steht — Anmeldung, Startseite, Modulverwaltung, Klassen, Kurse und Themen sind Nuvora. Neun Module sitzen auf dem Kern; keins hat eigene Konten oder eine eigene Datenbank. Die geteilte **Themen-Taxonomie** verbindet sie: ein in CardVote oder Code-Detektiv schwaches Thema erzeugt auf Knopfdruck ein Karten-Übungsdeck oder eine Lernpfad-Wiederholung, Test-Ergebnisse werden zu einer Notenspalte, und die Themen-Ansicht zeigt zu einem Thema alles quer über die Module — samt hinterlegtem Material.

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

### Noten

Notenbuch: Spalten aus deinem Leistungskonzept mit Gewichten, Noten und Beobachtungen je Person. Bedient sich wie eine leere Tabelle.

Rechnet den gewichteten Schnitt und zeigt, wie viel des Konzepts belegt ist — die Zeugnisnote bleibt deine Entscheidung, Beobachtungen zählen nie mit. Ein **Trend je Schüler** (▲/▼) zeigt, ob die Leistung übers Halbjahr steigt oder fällt. Als Notenspalte übernehmbar: **CardVote**-Trefferquote, **Karten**-Meisterung und **Code-Detektiv**-Sessions (jeweils über deine Notenskala).

### Karten

Karteikarten mit Spaced Repetition (SM-2). Ein Stapel gehört einem Kurs; die Lernenden üben **ohne Konto** über einen QR-Code (geheimer Token pro Person), ihren Reifegrad-Fortschritt sieht die Lehrkraft. Optional an ein Thema gebunden — dann schaltet der Kalender den Stapel am geplanten Tag automatisch frei. Die Meisterung lässt sich als Notenspalte übernehmen.

### Kalender

Unterrichtsplanung: Tag-, Wochen-, Monatsansicht und ein wiederkehrender **Stundenplan** (Klasse je Stunde, Farben, Uhrzeiten). An einen Eintrag lässt sich ein CardVote-Quiz, ein Karten-Deck oder eine Lernleiter planen; **freie Tage** (Ferien/Feiertage) blenden Stunden aus. **Kalender-Sync** in beide Richtungen: eigener ICS-Feed zum Abonnieren (Apple/Google) und ein externer Kalender read-only eingeblendet (SSRF-gehärtet).

### Einstiege

Ideen für den Unterrichtseinstieg — Idee, Ablauf mit Material, Materialliste und ungefähre Dauer. Wiederverwendbar, an Kalender-Stunden zuweisbar und themen-getaggt: zu einem schwachen Thema schlägt die Startseite einen passenden Einstieg vor.

### Code-Detektiv

Programmier-Rätsel für den Informatikunterricht: Code-Bausteine per Drag & Drop in die richtige Reihenfolge bringen, allein oder in einer Klassen-Session (öffentliches Beitreten per Code, ohne Login). Nativ in der Shell (React). Themen-getaggte Rätsel fließen in die schwachen Themen ein.

### Orga

Werkzeuge zur Klassenführung, in Reitern:

- **Checklisten** — Sammel-Häkchen (z. B. „Unterschrift der Klassenarbeit gesehen")
- **Anwesenheit / Fehlzeiten** — Status je Tag, Übersicht je Person, PDF-Report
- **Ausleihe** — Gegenstände verleihen, Rückgabe und Überfälligkeit im Blick
- **Sitzplan** — Tische frei platzieren und drehen; optional **SEGEL-Stufen** (Helios-Konzept Hafen → Küste → Meer → Welt) je Schüler am Platz, für den schnellen Blick im Unterricht

### Zufallsschüler

Zieht per Knopfdruck eine zufällige Person aus einer Klasse — fair gewichtet nach der Zeit seit dem letzten Ziehen, nicht zweimal am Stück.

> CardVote wurde bis v1.4.4 eigenständig entwickelt ([Archiv](https://github.com/norbert-me/CardVote)). Weiterentwicklung findet nur noch hier statt. Der Marktplatz teilt inzwischen auch Karten-Stapel, Einstiege und Lernleitern.

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
    ├── CardVote      /cardvote/*     Abstimmung, Auswertung, Marktplatz
    ├── Lernpfad      /lernpfad       Aufgaben & Lernleitern (nativ in-page)
    ├── Noten         /noten          Notenbuch, Trend, Ergebnis-Übernahme
    ├── Karten        /karten         Karteikarten, Spaced Repetition
    ├── Kalender      /kalender        Planung, Stundenplan, ICS-Sync
    ├── Einstiege     /methoden       Unterrichtseinstiege (themen-getaggt)
    ├── Code-Detektiv /code-detektiv  Programmier-Rätsel (nativ)
    ├── Orga          /orga           Checklisten · Anwesenheit · Ausleihe · Sitzplan
    └── Zufallsschüler /zufall        zufällige Person ziehen
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
| Frontend   | React 18 · Vite · react-router · i18n (de/en/es) |
| Lernpfad   | Vanilla JS, nativ in die Shell gemountet     |
| Proxy      | nginx — eine Domain, alle Teile              |

Ein Konto sieht nur eigene Daten (`owner_id` überall); Module werden pro Lehrkraft zugeschaltet.

## Sicherheit & Datenschutz

- **Selbst gehostet, keine Cloud.** Schülerdaten verlassen den eigenen Server nicht.
- **Lernende haben keine Konten** und loggen sich nie ein — sie sind Datensätze, die die Lehrkraft verwaltet.
- **Besonders schützenswerte Daten** (Förderschwerpunkte, Notizen — DSGVO Art. 9) stehen in **keinem Export** und in keiner Marktplatz-Veröffentlichung.
- **Passwörter** mit PBKDF2 (SHA-256, 100 000 Iterationen) gehasht und gesalzen; Pflicht zur E-Mail-Bestätigung, Reset per Einmal-Link.
- **Externer Kalender-Abruf SSRF-gehärtet** (private/lokale IPs und Redirects gesperrt).
- **Sicherheits-Header** zentral am Proxy (CSP, `X-Frame-Options: SAMEORIGIN`, `nosniff`, Referrer-Policy); `server_tokens off`.
- **Rate-Limits** gegen Brute-Force und Massenanlage auf allen schreibenden Endpunkten.
- **Secrets** liegen nur auf dem Server (`.env`, `chmod 600`) und werden nie ins Repo committet; `POSTGRES_PASSWORD` und `TOKEN_SECRET` sind Pflicht, sonst startet der Stack nicht.

## Ziel der Bündelung

1. Klassen, Kurse und Schüler einmal anlegen, in allen Modulen nutzen.
2. Testergebnisse steuern den Lernpfad: schwache Themen erzeugen passende Aufgaben.
3. Ein Login, eine Domain.

## Starten

Nuvora läuft als ein Deployment hinter einem Proxy:

```bash
cp .env.example .env     # POSTGRES_PASSWORD und TOKEN_SECRET sind Pflicht
docker compose up -d --build
```

Dann auf <http://localhost:8080>:

| Pfad         | Was                                                |
| ------------ | -------------------------------------------------- |
| `/`          | Nuvora — Startseite, Module, Klassen, Kurse, Themen |
| `/cardvote/` | Modul CardVote                                     |
| `/lernpfad`  | Modul Lernpfad                                      |
| `/noten`     | Modul Noten                                         |
| weitere      | `/karten` · `/kalender` · `/methoden` · `/code-detektiv` · `/orga` · `/zufall` |

Ohne `POSTGRES_PASSWORD` und `TOKEN_SECRET` startet der Stack absichtlich nicht — Standardpasswörter sollen nicht versehentlich in Produktion landen. Zufallswert erzeugen mit `openssl rand -hex 32`.

## Deploy

```bash
cp .deploy.env.example .deploy.env   # Server und Zielpfad eintragen
./deploy.sh                          # alles
./deploy.sh api                      # nur einen Service neu bauen
./deploy.sh --port 8090              # anderer Port, wird in .deploy.env gemerkt
```

Lädt hoch, baut auf dem Server, prüft Kern und Module und bricht ab, wenn etwas nicht antwortet.

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
| `.deploy.env`      | Serveradresse, Zielpfad                       | nein     |
| `config/site.json` | Betreiber, Anschrift, Kontakt (Impressum)     | nein     |

`config/site.json` ist die einzige Quelle der Betreiberdaten: Lernpfad liest sie serverseitig, das Impressum im Rahmen holt sie über `/site.json` vom Proxy.

**Postgres legt Rolle und Datenbank nur beim ersten Start an.** Ein später geändertes `POSTGRES_PASSWORD` erreicht eine bestehende Datenbank nicht — dann ist es ein `ALTER ROLE`, kein `.env`-Edit. `deploy.sh` prüft das vorab und sagt, was zu tun ist.

Datenbanken, Backups und Uploads enthalten personenbezogene Daten und sind grundsätzlich von Git ausgeschlossen.

## Schema & Migrationen

Kein Alembic. Das Schema entsteht beim Start aus `Base.metadata.create_all` plus additive Spalten/Indizes in `_ensure_columns` (idempotent). Neue Tabellen kommen von selbst; neue Spalten gehören in die `wanted`-Liste.

## Lizenz

[CC BY-NC 4.0](LICENSE) — Namensnennung, nicht kommerziell.
