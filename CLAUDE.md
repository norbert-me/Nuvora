# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Das Prinzip

**Nuvora ist die Basis, Module sind Gäste.** Der Kern besitzt Konten, Klassen und Schüler. Module (CardVote, Lernpfad) arbeiten auf diesen Daten, besitzen sie aber nicht, und werden pro Lehrkraft zugeschaltet.

Daraus folgen drei Regeln, die jede Änderung einhalten muss:

- **Kein Modul besitzt Klassen oder Schüler.** Die liegen im Kern. Ein Modul, das eigene anlegt, hat den Sinn der Plattform gebrochen.
- **Kein Modul hat eigene Konten.** Der Kern authentifiziert, Module erben.
- **Module hängen nicht voneinander ab.** CardVote muss ohne Lernpfad vollständig funktionieren und umgekehrt. Verbindendes (Themen, später die Wochenplanung) ist **Zusatz, nie Voraussetzung**: `questions.topic_id` ist deshalb optional und `ON DELETE SET NULL`. Ein Feature, das CardVote ohne Lernpfad kaputt macht, ist falsch gebaut — auch wenn es fachlich reizvoll klingt.

Verzeichnisse folgen der Architektur, nicht der Herkunft: `apps/api` (Kern + Modul-Router), `apps/web` (Shell + Modul-Seiten), `apps/lernpfad` (noch eigenständig). Es gibt kein `apps/cardvote` — der Kern kann nicht in einem seiner Module liegen.

## Status

Der Rahmen steht, alle drei Module sitzen auf dem Kern:

| Modul    | Pfad         | Form                                    |
| -------- | ------------ | --------------------------------------- |
| CardVote | `/cardvote/*` | React im Rahmen                        |
| Lernpfad | `/lernpfad`  | bestehende Vanilla-JS-App, nativ in-page gemountet |
| Noten    | `/noten`     | React im Rahmen                          |

Keins hat noch eigene Konten, Klassen oder Datenbank. Die Datenübernahme der Bestandsdaten aus der alten Lernleiter-Installation ist erledigt; das Skript wurde entfernt.

### Aufbau heute

`docker-compose.yml` (Root) + `nginx.conf` (Root) fahren alles zusammen:

| Pfad             | Ziel                                    |
| ---------------- | --------------------------------------- |
| `/`              | `web:3000` (Shell + alle React-Seiten)  |
| `/api/`, `/ws/`  | `api:8000`                              |
| `/lernpfad-app/` | `lernpfad:3000` (nur Statik)            |

`/lernpfad` ist eine React-Seite mit Nuvoras Navbar. Sie mountet die bestehende App **nativ in-page** (kein iframe mehr): `LernpfadModule.jsx` injiziert das Markup von `/lernpfad-app/index.html` in einen Host `#lp-app`, lädt `style.scoped.css` (das komplette Lernpfad-CSS unter `#lp-app` gescopet, damit `:root`/`body`-Regeln nicht ins Shell-Theming lecken) und führt `js/app.js` im selben Fenster aus. `app.js` erkennt den In-page-Modus über `window.__nuvoraInPage` und hängt die Rahmen-Klassen (`embedded`/`authed`) an `#lp-app` statt an `html`/`body`. Kommunikation weiter per `window.postMessage` (Theme/Tab rein, Modal/Toast/Tab raus). Gleiche Origin, daher erbt die App Nuvoras Token aus `localStorage`. Der alte iframe-Weg (`/lernpfad-app/` als eigener Container) existiert noch, wird aber nicht mehr eingebunden.

### Modulregister

`apps/api/app/routers/modules.py` — `REGISTRY` listet die Module **im Code**: ein Modul existiert nur, wenn es Code dazu gibt. Die DB (`user_modules`) merkt sich nur, wer was aktiviert hat.

Im Frontend liest `src/core/modules.js` das aus; `ModuleGate` in `main.jsx` schützt die Modul-Routen — ohne Aktivierung landet man bei `/modules`. Neue Module: Eintrag in `REGISTRY`, Routen in `main.jsx` hinter `ModuleGate`.

Bestandskonten werden beim Start einmalig angeschlossen (`users.modules_initialized`), damit niemand nach dem Umbau vor einer leeren Shell steht.

Der Slash am Ende von `proxy_pass http://lernpfad:3000/` schneidet das Prefix ab — die App dahinter sieht `/`.

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

Keine offenen Fundament-Aufgaben. Die früher geplante Wochenplanung ist im **Modul Kalender** aufgegangen (Stundenplan + Planung von Quiz/Deck/Lernleiter + freie Tage). Weiteres nur nach Bedarf.

Erledigt: Rahmen mit Modulregister; Klassen, Schüler und Themen im Kern; alle Module auf dem Kern; Datenübernahme aus der alten Lernleiter-Installation; CardVote-Ergebnisse als Note (mit Link zur Auswertung); Kalender mit Stundenplan, Planung und freien Tagen.

### Wochenplanung (im Modul Kalender umgesetzt)

Die ursprünglich separat gedachte Wochenplanung ist Teil des **Moduls Kalender** geworden: wiederkehrender **Stundenplan** (Wochentag × Stunde, Klasse je Slot, Uhrzeiten), an einen Kalender-Eintrag lässt sich ein **CardVote-Quiz, ein Karten-Deck oder eine Lernleiter** planen (Selektor nur bei aktivem Modul, Regel 3), das verknüpfte Deck wird am Kalendertag automatisch freigeschaltet, und **freie Zeiträume** (Ferien/Feiertage) blenden Stunden und Einträge aus. Bleibt Zusatz, kein Fundament — CardVote/Karten laufen ohne den Kalender voll.

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

Auf dem Kern, aber **nicht in React nachgebaut**: die bestehende App läuft eingebettet unter `/lernpfad` weiter. Ihre Oberfläche ist erprobt (Aufgaben, Klasse, Generator, Lernpfade) — ein Nachbau wäre Verschwendung und ist bewusst verworfen worden.

- Frontend `js/app.js` — ~2000 Zeilen, ein IIFE, kein Framework, kein Build. KaTeX liegt gebündelt in `vendor/` (kein Dependency-Ordner — nicht löschen, der Docker-Build braucht ihn).
- `server.js` liefert **nur noch Statik**. Kein eigenes Backend, keine SQLite, keine eigenen Konten.
- Daten kommen aus dem Kern: `/api/lernpfad/*` (Aufgaben, Pfade, Lernleitern), `/api/classes`, `/api/topics`.

**Der Adapter ist der Kern der Sache.** `vonKern`/`zuKern` in `app.js` übersetzen an der Datengrenze, damit die 2000 Zeilen Oberfläche ihre alten Formen behalten:

```
thema/unterthema (Text)  <->  topic_id   (Kern-Taxonomie, wird bei Bedarf angelegt)
Klassenname (Text)       <->  class_id   (Kern-Klassen)
```

Wer an den Datenformen etwas ändert, ändert den Adapter — nicht die Oberfläche.

`localStorage` ist nur noch Anzeige-Cache; der Server ist autoritativ. Der Tab „Klasse" zeigt nur an, gepflegt wird unter `/classes` (die Formulare sind per CSS versteckt, nicht entfernt: `app.js` hängt überall daran).

> **Fachbegriff:** Ein **Lernpfad** besteht aus mehreren **Lernleitern**. Das sind zwei Dinge, nicht alter und neuer Name — nicht zusammenführen. Nur die Produktmarke hieß früher „Lernleiter".

### Code-Detektiv — `apps/code-detektiv`

Ursprünglich eigenständige Client-App (React 19 + Vite), **inzwischen nativ in die Shell portiert** nach `apps/web/src/codedetektiv/` (kein iframe mehr). Der Code läuft unverändert auf React 18 (keine React-19-only-APIs, reiner localStorage-Client). Sein CSS ist unter `.cd-scope` isoliert (`makecode.css` hatte globale `*`/`body`/`:root`), interne Navigation auf `/code-detektiv/*` umgeschrieben, als nested Route in `main.jsx` gemountet. `@dnd-kit` + `lzma` sind dafür web-Dependencies. Der alte `apps/code-detektiv`-Container (`/code-detektiv-app/`) ist ungenutzt. Kein Backend, kein Login — reines Werkzeug, im Rahmen über `ModuleGate`.

### Noten — `apps/api/app/routers/noten.py` + `apps/web/src/pages/Noten.jsx`

Notenbuch, eigenständig wie die anderen. Bedient sich wie eine leere Tabellenkalkulation: Zeilen sind die Schüler aus dem Kern, Spalten legt die Lehrkraft an (Name + Gewicht in Prozent), in die Zelle wird `2` oder `2,3` getippt.

Zwei Dinge tut es bewusst **nicht**, und das darf nicht aufweichen:

- **Keine Zeugnisnote.** Es mittelt die eingetragenen Noten gewichtet und zeigt, wie viel des Leistungskonzepts belegt ist („40 %"). Die Note ist eine pädagogische Entscheidung.
- **Beobachtungen zählen nie mit.** „Anstrengungsbereitschaft" ist kein Messwert. Die API weist eine Beobachtung mit Notenwert zurück, damit die Trennung nicht aus Versehen erodiert.

Gewichte gibt das Werkzeug keine vor — das Leistungskonzept ist Fachkonferenz-Recht. Es zeigt nur die Summe und markiert, wenn sie nicht 100 % ergibt.

## Datenübernahme (erledigt)

Die Bestandsdaten aus der alten Lernleiter-SQLite sind in den Kern übernommen; das Skript `scripts/migrate-lernleiter.py` wurde danach entfernt.

## Konventionen

- Deutsch für UI, Daten und Kommentare; Code-Bezeichner Englisch.
- **Kein Alembic.** Es stand als ungenutzte Abhängigkeit in `requirements.txt` und hat genau das suggeriert — inzwischen entfernt. Das Schema entsteht beim Start aus `Base.metadata.create_all` plus `_ensure_columns` in `main.py` (additive Spalten und Indizes, idempotent). Neue Tabellen kommen von selbst; neue Spalten auf bestehenden Tabellen gehören in die `wanted`-Liste in `_ensure_columns`.
- Schüler sind Daten, keine Nutzer. Jeder Vorschlag, Lernenden ein Konto zu geben, widerspricht dem Produktzweck.
- **Live-Daten nie durch delete+recreate gefährden.** Entitäten mit Kaskaden (Schüler → Noten, Karten-Fortschritt) werden **gemergt**, nie gelöscht und neu angelegt — sonst reißt die Kaskade fremde Modul-Daten mit. Regressionstest dazu: `apps/api/tests/test_update_class.py` (`cd apps/api && pip install -r requirements-dev.txt && pytest`).
- **Stile kommen aus `apps/web/src/components/Icons.jsx`** — `btnPrimary`, `btnSecondary`, `btnSmall`, `pageTitle`, `iconBtn`, `COLORS`. Nicht je Seite neu definieren: genau so sind vier Varianten von `btnPrimary` entstanden. Drei Gruppen weichen bewusst ab (Formularseiten, Bestätigungsseiten, Session/Beamer) — das steht an der Definition.
- **Besonders schützenswerte Daten:** `students.foerder` und `students.notizen` sind DSGVO Art. 9 (Dyskalkulie, LRS, Nachteilsausgleiche). Sie stehen in keinem Export und in keiner Veröffentlichung. Wer ein Feld ergänzt, prüft zuerst jeden Export- und Marktplatzpfad.
- **Das Förder-Vokabular ist fest und wortgleich** in `classes.py` (`FOERDER_VALUES`) und `Classes.jsx` (`FOERDER`) — inklusive Umlaut in „Hören". Die Bestandsdaten benutzen genau diese Zeichenketten; jede Abweichung macht sie beim Übernehmen unbrauchbar.
