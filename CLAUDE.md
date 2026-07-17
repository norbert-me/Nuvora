# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Das Prinzip

**Nuvora ist die Basis, Module sind Gäste.** Der Kern besitzt Konten, Klassen und Schüler. Module (CardVote, Lernpfad) arbeiten auf diesen Daten, besitzen sie aber nicht, und werden pro Lehrkraft zugeschaltet.

Daraus folgen zwei Regeln, die jede Änderung einhalten muss:

- **Kein Modul besitzt Klassen oder Schüler.** Die liegen im Kern. Ein Modul, das eigene anlegt, hat den Sinn der Plattform gebrochen.
- **Kein Modul hat eigene Konten.** Der Kern authentifiziert, Module erben.

Verzeichnisse folgen der Architektur, nicht der Herkunft: `apps/api` (Kern + Modul-Router), `apps/web` (Shell + Modul-Seiten), `apps/lernpfad` (noch eigenständig). Es gibt kein `apps/cardvote` — der Kern kann nicht in einem seiner Module liegen.

## Status

Der Rahmen steht: Nuvora hat eigene Startseite, Modulregister und Navigation. CardVote ist ein Modul unter `/cardvote/*`. **Lernpfad noch nicht** — es hängt unter `/lernpfad/` als eigene App mit eigenen Konten und ist im Register bewusst `available=False`.

### Aufbau heute

`docker-compose.yml` (Root) + `nginx.conf` (Root) fahren alles zusammen:

| Pfad         | Ziel                 |
| ------------ | -------------------- |
| `/`          | `web:3000` (Shell)   |
| `/api/`, `/ws/` | `api:8000`        |
| `/lernpfad/` | `lernpfad:3000`      |

### Modulregister

`apps/api/app/routers/modules.py` — `REGISTRY` listet die Module **im Code**: ein Modul existiert nur, wenn es Code dazu gibt. Die DB (`user_modules`) merkt sich nur, wer was aktiviert hat.

Im Frontend liest `src/core/modules.js` das aus; `ModuleGate` in `main.jsx` schützt die Modul-Routen — ohne Aktivierung landet man bei `/modules`. Neue Module: Eintrag in `REGISTRY`, Routen in `main.jsx` hinter `ModuleGate`.

Bestandskonten werden beim Start einmalig angeschlossen (`users.modules_initialized`), damit niemand nach dem Umbau vor einer leeren Shell steht.

Der Slash am Ende von `proxy_pass http://lernpfad:3000/` schneidet das Prefix ab — Lernpfad sieht `/` und weiss von Nuvora nichts. Passend dazu leitet `apps/lernpfad/js/app.js` seine `API`-Konstante aus `location.pathname` ab, damit das Modul auch standalone (`npm start`) läuft. Beim Ändern eines der beiden Punkte den anderen mitziehen.

### Alles wird im Wurzelverzeichnis konfiguriert

`apps/*` enthält **nur noch Quellcode und Dockerfile**. Kein eigenes Compose, kein eigenes `.env`, kein eigenes `deploy.sh` — das ist bewusst so und soll nicht zurückwandern.

| Ort                | Zweck                                       |
| ------------------ | ------------------------------------------- |
| `.env`             | Secrets, Ports, SMTP (gitignored)           |
| `.deploy.env`      | Zielserver für `deploy.sh` (gitignored)     |
| `config/site.json` | Betreiberdaten (gitignored)                 |

Pflicht-Env: `POSTGRES_PASSWORD`, `TOKEN_SECRET` — Compose bricht ohne sie bewusst ab, damit keine Default-Credentials in Produktion landen.

`config/site.json` ist die **einzige** Quelle der Betreiberdaten. Lernpfad bekommt `./config` nach `/app/config` gemountet und liest sie über `server.js`; CardVotes `Legal.jsx` fetcht `/site.json`, das der Proxy aus demselben Mount ausliefert. Früher hatte jedes Modul seine eigene Datei (`config/site.json` vs. `frontend/public/legal-config.json`) mit eigenem Schema — die waren bereits inhaltlich auseinandergelaufen. Schema ist jetzt das deutsche (`betreiber`, `strasse`, `plz_ort`, …).

### Als Nächstes

1. **Themen-Taxonomie im Kern** — CardVote-Fragen und Lernpfad-Aufgaben brauchen dieselben Themen, sonst ist Ziel 2 unmöglich.
2. **Lernpfad auf den Kern** — localStorage raus, Daten pro Lehrkraft, eigene Konten/Klassen entfallen (siehe Migrationshürde).

Erledigt: Rahmen mit Modulregister; Klassen und Schüler liegen im Kern (`/classes`), nicht mehr im Modul.

## Was ist Nuvora

Werkzeug **für Lehrkräfte** — keine Lernplattform. Lernende haben keine Konten und loggen sich nie ein; sie tauchen nur als Datensätze auf, die die Lehrkraft verwaltet. Deutschsprachig (UI, Kommentare, Daten).

### Ziele

1. **Geteilte Klassen/Schüler** — einmal anlegen, in beiden Modulen nutzen.
2. **Ergebnisse steuern Lernpfad** — schwache Themen aus CardVote-Tests erzeugen passende Aufgaben im Lernpfad.
3. **Ein Login, eine Domain.**
4. **Öffentlich anbieten** — Registrierung, Datenschutz, Mandantentrennung **pro Lehrkraft**.

## Die Module

### CardVote — `apps/api` + `apps/web`

Im Rahmen, unter `/cardvote/*`. Herkunft: eigenständiges Projekt bis v1.4.4 ([Archiv](https://github.com/norbert-me/CardVote)), Weiterentwicklung nur noch hier.

- **Backend** `apps/api/app` — FastAPI + SQLAlchemy 2 (async, asyncpg) + Postgres 16. Router: `auth`, `classes`, `modules` (Kern) sowie `questions`, `folders`, `sessions`, `results`, `scan_image`, `cards`, `marketplace`, `export_import` (Modul). Live-Ergebnisse via `websocket.py`.
- **Frontend** `apps/web/src` — React 18 + Vite + react-router, KaTeX, i18n (de/en/es).
- **Scan** — OpenCV (`opencv-contrib-python-headless`), ArUco `DICT_6X6_50`.
- **Auth** — PBKDF2 (SHA-256, 100k Iterationen), E-Mail-Bestätigungspflicht, Reset per Einmal-Link (1h), Rate-Limits. Token im `localStorage`, globaler `fetch`-Interceptor in `main.jsx`.

### Lernpfad — `apps/lernpfad`

**Noch nicht im Rahmen.** Läuft als eigene App unter `/lernpfad/`, im Register `available=False`.

- Express + `sql.js` (SQLite in-memory, als Datei-Buffer persistiert).
- Frontend `js/app.js` — ~2000 Zeilen, ein IIFE, kein Framework, kein Build. KaTeX liegt gebündelt in `vendor/` (kein Dependency-Ordner — nicht löschen, der Docker-Build braucht ihn).
- Tabellen: `aufgaben`, `schueler`, `klassen`, `lernpfade`, `kontakt`, `users`, `sessions`.
- Auth: eigene Konten — scrypt (`crypto.scryptSync`), `sessions`-Tabelle, HttpOnly-Cookie, Admin über `ADMIN_EMAIL`.

> **Fachbegriff:** Ein **Lernpfad** besteht aus mehreren **Lernleitern**. Das sind zwei Dinge, nicht alter und neuer Name — nicht zusammenführen. Nur die Produktmarke hieß früher „Lernleiter".

## Die zentrale Migrationshürde

**Lernpfads Source of Truth ist `localStorage`, nicht die DB.** `js/app.js` hält State unter `ll_aufgaben`, `ll_schueler`, `ll_klassen`, `ll_id_counter`; jedes `save()` schreibt localStorage und spiegelt per `syncToAPI()` ans Backend. Die App läuft komplett ohne Backend.

Lernpfad *hat* Konten (scrypt, Sessions), aber die fachlichen Daten hängen am Browser statt an der Person — die Konten schützen den Zugang, trennen aber keine Mandanten.

Was zu tun ist:

1. localStorage als Source of Truth entfernen; Server wird autoritativ.
2. `aufgaben` und `lernpfade` nach Postgres, mit `owner_id`.
3. `schueler`/`klassen`/`users` aus Lernpfad **entfallen** — der Kern hat sie bereits.
4. Frontend-IIFE wird React-Modul in `apps/web`, dann `available=True`.

Davor braucht es die **Themen-Taxonomie**: CardVote-Fragen und Lernpfad-Aufgaben müssen auf dieselben Themen zeigen, sonst lässt sich „schwaches Thema" nicht auf Aufgaben abbilden (Ziel 2).

## Konventionen

- Deutsch für UI, Daten und Kommentare; Code-Bezeichner Englisch.
- **Kein Alembic im Betrieb**, obwohl es in `requirements.txt` steht: das Schema entsteht beim Start aus `Base.metadata.create_all` plus `_ensure_columns` in `main.py` (additive Spalten und Indizes, idempotent). Neue Tabellen kommen von selbst; neue Spalten auf bestehenden Tabellen gehören in die `wanted`-Liste in `_ensure_columns`.
- Schüler sind Daten, keine Nutzer. Jeder Vorschlag, Lernenden ein Konto zu geben, widerspricht dem Produktzweck.
