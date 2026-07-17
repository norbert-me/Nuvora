# Nuvora

Werkzeugkasten **für Lehrkräfte**. Selbst gehostet, keine Cloud, keine Schülerdaten bei Dritten.

Quelloffen und nicht kommerziell nutzbar ([CC BY-NC 4.0](LICENSE)) — der Quellcode liegt offen, kommerzielle Nutzung ist ausgeschlossen. Das ist bewusst *keine* OSI-Open-Source-Lizenz.

Lernende brauchen keine Geräte und keine Konten — sie tauchen nur als Datensätze auf, die die Lehrkraft verwaltet.

> **Status: früh.** Nuvora bündelt gerade zwei bisher eigenständige Werkzeuge zu einem Produkt. Aktuell sind es zwei getrennt lauffähige Apps in einem Repo; gemeinsame Konten und geteilte Klassen kommen noch. Siehe [CLAUDE.md](CLAUDE.md) für den Zielaufbau.

## Module

### CardVote — `apps/cardvote`

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

Verwaltung von Mathe-Aufgaben, Klassen und Lernpfaden.

Express · sql.js · Vanilla JS

> CardVote wurde bis v1.4.4 eigenständig entwickelt ([Archiv](https://github.com/norbert-me/CardVote)). Weiterentwicklung findet nur noch hier statt.

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

| Pfad         | Modul    |
| ------------ | -------- |
| `/`          | CardVote |
| `/lernpfad/` | Lernpfad |

Ohne `POSTGRES_PASSWORD` und `TOKEN_SECRET` startet der Stack absichtlich nicht — Standardpasswörter sollen nicht versehentlich in Produktion landen. Zufallswert erzeugen mit `openssl rand -hex 32`.

## Deploy

```bash
cp .deploy.env.example .deploy.env   # Server und Zielpfad eintragen
./deploy.sh                          # alles
./deploy.sh lernpfad                 # nur einen Service neu bauen
```

Lädt hoch, baut auf dem Server, prüft beide Module und bricht ab, wenn eins nicht antwortet.

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

`config/site.json` ist die einzige Quelle der Betreiberdaten: Lernpfad liest sie serverseitig, CardVotes Impressum holt sie über `/site.json` vom Proxy.

Datenbanken, Backups und Uploads enthalten personenbezogene Daten und sind grundsätzlich von Git ausgeschlossen.

## Lizenz

[CC BY-NC 4.0](LICENSE) — Namensnennung, nicht kommerziell.
