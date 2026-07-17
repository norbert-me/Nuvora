# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Beide Module sind importiert (`apps/cardvote`, `apps/lernpfad`) und laufen hinter einem gemeinsamen Proxy auf einer Domain. **Fachlich sind sie noch getrennt**: eigene Konten, eigene Klassen, eigene DBs. Die Bündelung ist bisher Deployment-Ebene, nicht Datenebene.

### Aufbau heute

`docker-compose.yml` (Root) + `nginx.conf` (Root) fahren alles zusammen:

| Pfad         | Ziel                      |
| ------------ | ------------------------- |
| `/`          | `cardvote-frontend:3000`  |
| `/api/`, `/ws/` | `cardvote-backend:8000` |
| `/lernpfad/` | `lernpfad:3000`           |

Der Slash am Ende von `proxy_pass http://lernpfad:3000/` schneidet das Prefix ab — Lernpfad sieht `/` und weiss von Nuvora nichts. Passend dazu leitet `apps/lernpfad/js/app.js` seine `API`-Konstante aus `location.pathname` ab, damit das Modul auch standalone (`npm start`) läuft. Beim Ändern eines der beiden Punkte den anderen mitziehen.

Pflicht-Env: `POSTGRES_PASSWORD`, `TOKEN_SECRET` (Compose bricht ohne sie bewusst ab). Vorlage `.env.example`.

### Als Nächstes

1. Konten zusammenführen — CardVote gewinnt, Lernpfad-Auth entfällt.
2. Themen-Taxonomie: CardVote-Fragen und Lernpfad-Aufgaben brauchen dieselben Themen, sonst ist Ziel 2 unmöglich.
3. Lernpfad von localStorage auf Postgres, Daten pro Lehrkraft (siehe unten).

## Was ist Nuvora

Werkzeug **für Lehrkräfte** — keine Lernplattform. Lernende haben keine Konten und loggen sich nie ein; sie tauchen nur als Datensätze auf, die die Lehrkraft verwaltet. Deutschsprachig (UI, Kommentare, Daten).

Nuvora bündelt zwei bestehende Apps als Module:

- **CardVote** — Abstimmung im Unterricht per bedruckter ArUco-Karten, die die Lehrkraft mit dem Handy scannt.
- **Lernpfad** (bisher „Lernleiter") — Verwaltung von Mathe-Aufgaben, Klassen und Lernpfaden.

### Ziele der Bündelung

1. **Geteilte Klassen/Schüler** — einmal anlegen, in beiden Modulen nutzen.
2. **Ergebnisse steuern Lernpfad** — schwache Themen aus CardVote-Tests erzeugen passende Aufgaben im Lernpfad.
3. **Ein Login, eine Domain.**
4. **Öffentlich anbieten** — Registrierung, Datenschutz, Mandantentrennung **pro Lehrkraft**.

## Quellprojekte

Beide liegen außerhalb dieses Repos unter `/Users/schule/Dwarves/`.

### CardVote — `/Users/schule/Dwarves/plickers-clone` (v1.4.4)

Wird der **Kern von Nuvora**. Sein Auth-, Konto- und Mandantenmodell gewinnt.

- **Backend** `backend/app` — FastAPI + SQLAlchemy 2 (async, asyncpg) + Postgres 16, Alembic-Migrationen. Router bereits fachlich getrennt: `auth`, `classes`, `cards`, `questions`, `folders`, `sessions`, `results`, `marketplace`, `export_import`, `scan_image`. Live-Ergebnisse via `websocket.py`.
- **Frontend** `frontend/` — React 18 + Vite + react-router, KaTeX für Formeln, i18n vorhanden.
- **Scan** — OpenCV (`opencv-contrib-python-headless`), ArUco `DICT_6X6_50`.
- **Export** — reportlab (PDF), openpyxl (Excel), iDoceo-CSV.
- **Auth** — PBKDF2 (SHA-256, 100k Iterationen), E-Mail-Bestätigungspflicht, Passwort-Reset per Einmal-Link (1h), Rate-Limits.
- **Deploy** — `docker-compose.yml`: `db` / `backend` / `frontend`, Frontend auf `:3001`.

### Lernleiter — `/Users/schule/Dwarves/lernleiter`

Wird **portiert**, nicht übernommen. Eigenes `CLAUDE.md` dort lesen, bevor daran gearbeitet wird.

- Express + `sql.js` (SQLite in-memory, als Datei-Buffer persistiert), `lernleiter.db`.
- Frontend `js/app.js` — ~2000 Zeilen, ein IIFE, kein Framework, kein Build.
- Tabellen: `aufgaben`, `schueler`, `klassen`, `lernpfade`, `kontakt`, `users`, `sessions`.
- Auth: eigene Konten — scrypt-Hashing (`crypto.scryptSync`), `sessions`-Tabelle, HttpOnly-Cookie, Admin über `ADMIN_EMAIL`-Env.

> Achtung: Lernleiters eigenes `CLAUDE.md` ist an dieser Stelle **veraltet** — es beschreibt hardcodiertes Basic Auth (`admin`) und `LERNLEITER_NO_AUTH`. Beides ist aus `server.js` verschwunden. Dort dokumentierte Aussagen vor Verwendung gegen den Code prüfen.

## Die zentrale Migrationshürde

**Lernleiters Source of Truth ist `localStorage`, nicht die DB.** `js/app.js` hält State unter `ll_aufgaben`, `ll_schueler`, `ll_klassen`, `ll_id_counter`; jedes `save()` schreibt localStorage und spiegelt per `syncToAPI()` ans Backend. Die App läuft komplett ohne Backend.

Lernleiter *hat* inzwischen Konten (scrypt, Sessions), aber die fachlichen Daten hängen trotzdem am Browser statt an der Person — die Konten schützen den Zugang, trennen aber keine Mandanten. Beide Konto-Systeme müssen zu einem werden; CardVots gewinnt (E-Mail-Bestätigung, Reset, Rate-Limits).

Für Nuvora heißt das — ohne diesen Umbau gibt es kein Produkt, nur zwei Apps unter einer Domain:

1. localStorage als Source of Truth entfernen; Server wird autoritativ.
2. Jede Lernpfad-Entität bekommt einen Besitzer (Lehrkraft-FK), Postgres statt sql.js.
3. `schueler`/`klassen` aus Lernleiter **entfallen** — CardVotes Klassen-/Schülermodell ist das gemeinsame. Nur `aufgaben` und `lernpfade` wandern rüber.
4. Frontend-IIFE wird React-Modul im bestehenden Vite-Frontend.

## Konventionen

- Deutsch für UI, Daten und Kommentare; Code-Bezeichner Englisch, wie in CardVote üblich.
- Migrationen ausschließlich über Alembic — kein manuelles Schema-Gefummel.
- Schüler sind Daten, keine Nutzer. Jeder Vorschlag, Lernenden ein Konto zu geben, widerspricht dem Produktzweck.
