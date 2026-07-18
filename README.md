# Nuvora

Werkzeugkasten **für Lehrkräfte**. Selbst gehostet, keine Cloud, keine Schülerdaten bei Dritten.

Quellcode: [github.com/norbert-me/Nuvora](https://github.com/norbert-me/Nuvora)

Quelloffen und nicht kommerziell nutzbar ([CC BY-NC 4.0](LICENSE)) — der Quellcode liegt offen, kommerzielle Nutzung ist ausgeschlossen. Das ist bewusst *keine* OSI-Open-Source-Lizenz.

Lernende brauchen keine Geräte und keine Konten — sie tauchen nur als Datensätze auf, die die Lehrkraft verwaltet.

Nuvora ist die Basis: Konto, Klassen und Schüler liegen hier. Module werden dazugeschaltet und arbeiten auf diesen Daten — sie besitzen sie nicht.

> **Status: im Aufbau.** Der Rahmen steht: Anmeldung, Startseite, Modulverwaltung, Klassen und Themen sind Nuvora. Alle drei Module sitzen auf dem Kern — keins hat noch eigene Konten oder eine eigene Datenbank.

## Module

### CardVote — `apps/web` + `apps/api`

Abstimmung im Unterricht ganz ohne digitale Endgeräte. Lernende halten bedruckte Karten hoch, die Lehrkraft scannt sie mit der Handykamera, Ergebnisse erscheinen live.

- **Live-Abstimmung** — Fragen auf dem Beamer, Ergebnisse in Echtzeit per WebSocket, Timer pro Frage
- **Spiel-Modus** — Punkte, Streaks, Bestenliste, Podium
- **Auswertung** — Notenverteilung mit anpassbarem Schlüssel, Boxplots, 95%-Konfidenzintervalle, didaktische Hinweise (Decken-/Bodeneffekt, Streuung, Ratewahrscheinlichkeit)
- **Export** — PDF, Excel, iDoceo-CSV
- **Fragen** — Ordner und Fragesets, LaTeX-Formeln, Bilder, Import/Export als JSON oder Excel
- **Scanner** — ArUco-Erkennung (OpenCV, `DICT_6X6_50`) über die Handykamera, Fernsteuerung der Session
- **Marktplatz** — eigene Fragesets veröffentlichen, fremde bewerten und übernehmen
- **Sonst** — Vollbild für die Projektion, Dark Mode, PWA, kein Tracking

FastAPI · Postgres · React · OpenCV (ArUco)

### Lernpfad — `apps/lernpfad`

Verwaltung von Mathe-Aufgaben und Lernpfaden. Ein Lernpfad besteht aus mehreren Lernleitern; der Generator verteilt Aufgaben differenziert auf die Lernenden.

Läuft eingebettet unter Nuvoras Navbar — die bewährte Oberfläche blieb, nur der Unterbau wurde ausgetauscht.

Express (nur Statik) · Vanilla JS

### Noten

Notenbuch: Spalten aus deinem Leistungskonzept mit Gewichten, Noten und Beobachtungen je Person. Bedient sich wie eine leere Tabelle.

Rechnet den gewichteten Schnitt deiner Noten und zeigt, wie viel des Konzepts belegt ist — die Zeugnisnote bleibt deine Entscheidung. Beobachtungen zählen nie mit.

React · Postgres

> CardVote wurde bis v1.4.4 eigenständig entwickelt ([Archiv](https://github.com/norbert-me/CardVote)). Weiterentwicklung findet nur noch hier statt.

## Architektur

Nuvora ist die Basis, Module sind Gäste. Drei Regeln, die jede Änderung einhält:

1. **Kein Modul besitzt Klassen oder Schüler** — die liegen im Kern, alle Module teilen sie.
2. **Kein Modul hat eigene Konten** — der Kern authentifiziert, Module erben.
3. **Module hängen nicht voneinander ab** — CardVote läuft ohne Lernpfad und ohne Noten. Verbindendes (gemeinsame Themen, Ergebnis-Übernahme) ist Zusatz, nie Voraussetzung.

```
Nuvora-Kern (apps/api, apps/web)
├── Konten · Klassen · Schüler · Themen        gehören dem Kern
├── Modulregister                              wer hat was aktiviert
└── Module
    ├── CardVote   /cardvote/*   Abstimmung, Auswertung, Marktplatz
    ├── Lernpfad   /lernpfad     Aufgaben & Lernpfade (eingebettet)
    └── Noten      /noten        Notenbuch
```

| Teil       | Stack                                        |
| ---------- | -------------------------------------------- |
| Kern-API   | FastAPI · SQLAlchemy 2 (async) · Postgres 16 |
| Frontend   | React 18 · Vite · react-router               |
| Lernpfad   | Express (nur Statik) · Vanilla JS            |
| Proxy      | nginx — eine Domain, alle Teile              |

Ein Konto sieht nur eigene Daten (`owner_id` überall); Module werden pro Lehrkraft zugeschaltet.

## Sicherheit & Datenschutz

- **Selbst gehostet, keine Cloud.** Schülerdaten verlassen den eigenen Server nicht.
- **Lernende haben keine Konten** und loggen sich nie ein — sie sind Datensätze, die die Lehrkraft verwaltet.
- **Besonders schützenswerte Daten** (Förderschwerpunkte, Notizen — DSGVO Art. 9) stehen in **keinem Export** und in keiner Marktplatz-Veröffentlichung.
- **Passwörter** mit PBKDF2 (SHA-256, 100 000 Iterationen) gehasht und gesalzen; Pflicht zur E-Mail-Bestätigung, Reset per Einmal-Link.
- **Sicherheits-Header** zentral am Proxy (CSP, `X-Frame-Options: SAMEORIGIN`, `nosniff`, Referrer-Policy); `server_tokens off`.
- **Rate-Limits** gegen Brute-Force und Massenanlage auf allen schreibenden Endpunkten.
- **Secrets** liegen nur auf dem Server (`.env`, `chmod 600`) und werden nie ins Repo committet; `POSTGRES_PASSWORD` und `TOKEN_SECRET` sind Pflicht, sonst startet der Stack nicht.

## Ziel der Bündelung

1. Klassen und Schüler einmal anlegen, in beiden Modulen nutzen.
2. Testergebnisse aus CardVote steuern den Lernpfad: schwache Themen erzeugen passende Aufgaben.
3. Ein Login, eine Domain.

## Starten

Nuvora läuft als ein Deployment hinter einem Proxy:

```bash
cp .env.example .env     # POSTGRES_PASSWORD und TOKEN_SECRET sind Pflicht
docker compose up -d --build
```

Dann auf <http://localhost:8080>:

| Pfad         | Was                                   |
| ------------ | ------------------------------------- |
| `/`          | Nuvora — Startseite, Module, Klassen  |
| `/cardvote/` | Modul CardVote                        |
| `/lernpfad/` | Modul Lernpfad                        |
| `/noten`     | Modul Noten                           |

Ohne `POSTGRES_PASSWORD` und `TOKEN_SECRET` startet der Stack absichtlich nicht — Standardpasswörter sollen nicht versehentlich in Produktion landen. Zufallswert erzeugen mit `openssl rand -hex 32`.

## Deploy

```bash
cp .deploy.env.example .deploy.env   # Server und Zielpfad eintragen
./deploy.sh                          # alles
./deploy.sh api                      # nur einen Service neu bauen
./deploy.sh --port 8090              # anderer Port, wird in .deploy.env gemerkt
```

Lädt hoch, baut auf dem Server, prüft Kern und Module und bricht ab, wenn etwas nicht antwortet.

Services: `api` (Kern), `web` (Shell + Modul-Seiten), `lernpfad`, `db`, `proxy`.

Beim ersten Lauf legt das Skript die `.env` auf dem Server an und erzeugt `TOKEN_SECRET` und `POSTGRES_PASSWORD` als Zufallswerte (`chmod 600`) — niemand muss sie lesen oder eintippen. Danach wird die `.env` des Servers **nie** überschrieben; Secrets bleiben dort.

Optional nachtragen für Mailversand und Admin-Konto (`SMTP_*`, `ADMIN_EMAIL`):

```bash
ssh <server>
cd <pfad> && nano .env
```

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

## Lizenz

[CC BY-NC 4.0](LICENSE) — Namensnennung, nicht kommerziell.
