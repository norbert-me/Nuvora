# Nuvora

Werkzeugkasten **für Lehrkräfte**. Selbst gehostet, keine Cloud, keine Schülerdaten bei Dritten.

Quelloffen und nicht kommerziell nutzbar ([CC BY-NC 4.0](LICENSE)) — der Quellcode liegt offen, kommerzielle Nutzung ist ausgeschlossen. Das ist bewusst *keine* OSI-Open-Source-Lizenz.

Lernende brauchen keine Geräte und keine Konten — sie tauchen nur als Datensätze auf, die die Lehrkraft verwaltet.

> **Status: früh.** Nuvora bündelt gerade zwei bisher eigenständige Werkzeuge zu einem Produkt. Aktuell sind es zwei getrennt lauffähige Apps in einem Repo; gemeinsame Konten und geteilte Klassen kommen noch. Siehe [CLAUDE.md](CLAUDE.md) für den Zielaufbau.

## Module

### CardVote — `apps/cardvote`

Abstimmung im Unterricht ganz ohne digitale Endgeräte. Lernende halten bedruckte Karten hoch, die Lehrkraft scannt sie mit der Handykamera, Ergebnisse erscheinen live.

Auswertung als Noten, Boxplots und Konfidenzintervalle; Export als PDF, Excel und iDoceo-CSV. Fragen mit LaTeX und Bildern, Marktplatz zum Teilen von Fragesets.

FastAPI · Postgres · React · OpenCV (ArUco)

### Lernpfad — `apps/lernpfad`

Verwaltung von Mathe-Aufgaben, Klassen und Lernpfaden.

Express · sql.js · Vanilla JS

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

### Einzeln arbeiten

Die Composes in `apps/*/` laufen weiter für sich, wenn nur ein Modul gebraucht wird:

```bash
cd apps/cardvote && docker compose up -d --build   # Frontend auf :3001
cd apps/lernpfad && npm start                      # :3000
```

Lernpfad merkt an `location.pathname`, ob es unter `/lernpfad/` oder auf `/` liegt, und wählt seine API-Basis entsprechend — beide Betriebsarten funktionieren ohne Umbau.

## Konfiguration

Alle Zugangsdaten kommen aus Env-Dateien, die **nicht** im Repo liegen. Vorlagen kopieren und ausfüllen:

```bash
cp .env.example                           .env
cp apps/cardvote/.deploy.env.example      apps/cardvote/.deploy.env
cp apps/lernpfad/.deploy.env.example      apps/lernpfad/.deploy.env
cp apps/lernpfad/config/site.example.json apps/lernpfad/config/site.json
```

Datenbanken, Backups und Uploads enthalten personenbezogene Daten und sind grundsätzlich von Git ausgeschlossen.

## Lizenz

[CC BY-NC 4.0](LICENSE) — Namensnennung, nicht kommerziell.
