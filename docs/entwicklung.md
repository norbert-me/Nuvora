# Entwicklung

Lokal am Code arbeiten. Wer Nuvora nur ausprobieren will, ist mit dem
Docker-Weg im [README](../README.md#in-10-minuten-lokal-laufend) schneller.

## Voraussetzungen

- Docker mit Compose v2 (mindestens für Postgres)
- Python 3.14 — dieselbe Fassung wie im Container
- Node 26

## Backend

```bash
cd apps/api
python3.14 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
```

Die API braucht eine Postgres-Datenbank. Am einfachsten die aus dem Compose:

```bash
docker compose up -d db
```

Dann in `apps/api` starten (Umgebungsvariablen entsprechend der `.env`):

```bash
DATABASE_URL="postgresql+asyncpg://nuvora:<passwort>@localhost:5432/nuvora" \
TOKEN_SECRET="egal-lokal" \
uvicorn app.main:app --reload --port 8000
```

Damit das geht, muss der `db`-Dienst seinen Port nach außen geben — im
Compose tut er das **nicht**. Entweder ein `ports: ["5432:5432"]` lokal
ergänzen (nicht committen) oder die API im Container laufen lassen und nur das
Frontend lokal.

Das Schema entsteht beim Start von selbst — es gibt kein Alembic. Neue Spalten
auf bestehenden Tabellen gehören in die `wanted`-Liste in `_ensure_columns`
(`apps/api/app/main.py`), sonst fehlen sie auf jeder bestehenden Installation.

## Frontend

```bash
cd apps/web
npm ci
npm run dev
```

Der Vite-Dev-Server proxyt `/api` auf `http://localhost:8000` und `/ws` per
WebSocket dorthin — es muss also eine API laufen.

Die Lernpfad-App wird **nicht** gebaut: ihre Statik liegt fertig unter
`apps/web/public/lp/`. Bearbeitet wird sie direkt dort. `style.scoped.css` ist
die unter `#lp-app` gescopete Fassung von `style.css` — Änderungen an der einen
gehören auch in die andere.

## Tests

```bash
cd apps/api && pytest          # API-Regressionstests
cd apps/web && npm run test    # Vitest über src/core
cd apps/web && npm run build   # muss durchlaufen
```

Beides läuft bei jedem Push in der CI (`.github/workflows/ci.yml`), zusammen mit
`docker compose build api web` — dem Weg, den ein Fremder nimmt.

Die API-Tests decken gezielt die Stellen ab, an denen ein Fehler **still**
Daten kostet: E/G-Wertung (`test_scoring.py`), Klassen-Update ohne Datenverlust
(`test_update_class.py`), Papierkorb-Kaskaden, Mandantentrennung
(`test_tenant_isolation.py`), Kurs-Logik, Modul-Schranken
(`test_modul_schranke.py`) und der Gleichstand von Backend- und
Frontend-Modulschlüsseln (`test_modul_keys_frontend.py`).

`test_scoring_parity.py` prüft, dass `apps/api/app/scoring.py` und
`apps/web/src/core/scoring.js` dasselbe rechnen. Die beiden Dateien sind eine
bewusste Doppelung und müssen zusammen geändert werden.

## Gegen eine laufende Installation prüfen

Der Selbsttest braucht eine erreichbare Instanz und ein Testkonto — siehe
[Selbsttest](selbsttest.md).

```bash
./selftest.sh --url http://localhost:8080
```

## Python-Abhängigkeiten ändern

Zwei Dateien, eine Richtung: `requirements.txt` ist die Quelle mit Bereichen,
`requirements.lock.txt` ist daraus **erzeugt** — feste Fassungen samt Hashes.
Container und CI installieren nur aus der Lock-Datei
(`pip install --require-hashes`), damit zwei Builds vom selben Commit dasselbe
ergeben und ein umgeschriebenes Upstream-Paket am Hash auffällt.

```bash
cd apps/api
pip install pip-tools                 # einmalig
# 1. requirements.txt bearbeiten
# 2. Lock neu erzeugen — mit Python 3.14, wie im Container:
pip-compile --allow-unsafe --generate-hashes --strip-extras \
  --output-file=requirements.lock.txt requirements.txt
```

`pip-compile` löst für den Interpreter, unter dem es läuft — deshalb Python
3.14. Stolperstein: pip-tools 7.6 bricht mit pip 26 ab
(`make_requirement_preparer() missing … allow_editables`); dann im selben Venv
`pip install "pip<26"`. Die Testwerkzeuge (`requirements-dev.txt`) bleiben
bewusst ohne Lock: sie werden nie ausgeliefert, und eine unerwartete Fassung
fällt sofort als roter Testlauf auf.

## Was beim Beitragen wichtig ist

- **Die drei Regeln** aus der [Architektur](architektur.md) gelten für jede
  Änderung. Regel 3 (kein Modul hängt von einem anderen ab) ist die, die am
  ehesten aus Versehen bricht.
- **Stile nur aus `apps/web/src/components/Icons.jsx`.** Keine seiteneigenen
  Buttons, Inputs oder Tabs; Abweichungen per Spread ableiten.
- **Deutsch** für Oberfläche, Daten und Kommentare; Code-Bezeichner Englisch.
- **Kein delete+recreate** bei Entitäten mit Kaskaden (Schüler → Noten,
  Karten-Fortschritt) — gemergt wird, nicht neu angelegt.
- **Personenbezogene Felder**: erst [Datenschutz](datenschutz.md) lesen. Alles,
  was Förderbedarf oder Beobachtungen berührt, ist Art. 9 und gehört in keinen
  Teilen-Export.
- **Neues Modul?** [Ein neues Modul bauen](neues-modul.md) — es sind fünf
  Einträge, sonst wird der Selbsttest rot.

Nuvora ist ein Ein-Personen-Projekt ohne Einnahmen; es gibt keine Zusage auf
Antwortzeit für Pull Requests. Vor größerer Arbeit lohnt eine Rückfrage per
Issue.
