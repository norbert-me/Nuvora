# Nuvora

Werkzeugkasten **für Lehrkräfte**. Selbst gehostet, keine Cloud, keine Schülerdaten bei Dritten.

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

## Entwicklung

Jedes Modul startet vorerst noch für sich:

```bash
# CardVote
cd apps/cardvote && docker compose up -d --build   # Frontend auf :3001

# Lernpfad
cd apps/lernpfad && npm start                      # :3000
```

## Konfiguration

Alle Zugangsdaten kommen aus Env-Dateien, die **nicht** im Repo liegen. Vorlagen kopieren und ausfüllen:

```bash
cp apps/cardvote/.env.example            apps/cardvote/.env
cp apps/cardvote/.deploy.env.example     apps/cardvote/.deploy.env
cp apps/lernpfad/.deploy.env.example     apps/lernpfad/.deploy.env
cp apps/lernpfad/config/site.example.json apps/lernpfad/config/site.json
```

Datenbanken, Backups und Uploads enthalten personenbezogene Daten und sind grundsätzlich von Git ausgeschlossen.

## Lizenz

[CC BY-NC 4.0](LICENSE) — Namensnennung, nicht kommerziell.
