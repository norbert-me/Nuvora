# CLAUDE.md

> **Kein Projektdokument.** Das hier ist die Arbeitsanweisung für den
> KI-Assistenten (Claude Code), der an diesem Repository arbeitet: Regeln,
> Fallstricke, Entscheidungen mit Begründung. Wer wissen will, **was** Nuvora
> ist und wie man es betreibt, liest [README.md](README.md).

## Das Prinzip

**Nuvora ist die Basis, Module sind Gäste.** Der Kern besitzt Konten, Klassen und Schüler. Module (CardVote, Lernpfad) arbeiten auf diesen Daten, besitzen sie aber nicht, und werden pro Lehrkraft zugeschaltet.

Daraus folgen drei Regeln, die jede Änderung einhalten muss:

- **Kein Modul besitzt Klassen oder Schüler.** Die liegen im Kern. Ein Modul, das eigene anlegt, hat den Sinn der Plattform gebrochen.
- **Kein Modul hat eigene Konten.** Der Kern authentifiziert, Module erben.
- **Module hängen nicht voneinander ab.** CardVote muss ohne Lernpfad vollständig funktionieren und umgekehrt. Verbindendes (Themen, später die Wochenplanung) ist **Zusatz, nie Voraussetzung**: `questions.topic_id` ist deshalb optional und `ON DELETE SET NULL`. Ein Feature, das CardVote ohne Lernpfad kaputt macht, ist falsch gebaut — auch wenn es fachlich reizvoll klingt.

Verzeichnisse folgen der Architektur, nicht der Herkunft: `apps/api` (Kern + Modul-Router) und `apps/web` (Shell + Modul-Seiten). Die Lernpfad-Statik liegt **in** `apps/web/public/lp/` und wird in-page gemountet — es gibt **kein** `apps/lernpfad` mehr. Es gibt auch kein `apps/cardvote` — der Kern kann nicht in einem seiner Module liegen.

## Status

Der Rahmen steht, alle Module sitzen auf dem Kern (die Tabelle nennt die drei,
an denen sich die Bauformen zeigen — die vollständige Liste ist `REGISTRY` in
`apps/api/app/routers/modules.py`):

| Modul    | Pfad         | Form                                    |
| -------- | ------------ | --------------------------------------- |
| CardVote | `/cardvote/*` | React im Rahmen                        |
| Lernpfad | `/lernpfad`  | bestehende Vanilla-JS-App, nativ in-page gemountet |
| Auswertung | `/auswertung` | React im Rahmen (Notenbuch + Klassenarbeiten) |

Keins hat noch eigene Konten, Klassen oder Datenbank. Die Datenübernahme der Bestandsdaten aus der alten Lernleiter-Installation ist erledigt; das Skript wurde entfernt.

### Aufbau heute

`docker-compose.yml` (Root) + `nginx.conf` (Root) fahren alles zusammen:

| Pfad             | Ziel                                    |
| ---------------- | --------------------------------------- |
| `/`              | `web:3000` (Shell + alle React-Seiten)  |
| `/api/`, `/ws/`  | `api:8000`                              |
| `/lp/`           | Lernpfad-Statik, ausgeliefert vom `web`-Container (kein eigener Container mehr) |

`/lernpfad` ist eine React-Seite mit Nuvoras Navbar. Die erprobte Vanilla-JS-App ist **ins Web-Projekt eingebaut**: ihre Statik liegt unter `apps/web/public/lp/` (index.html, css, js, vendor) und wird vom `web`-Container ausgeliefert — **kein eigener lernpfad-Container mehr** (früher `/lernpfad-app/` hinter dem Proxy). `LernpfadModule.jsx` mountet sie **nativ in-page** (kein iframe): injiziert das Markup von `/lp/index.html` in einen Host `#lp-app`, lädt `style.scoped.css` (das komplette Lernpfad-CSS unter `#lp-app` gescopet, damit `:root`/`body`-Regeln nicht ins Shell-Theming lecken) und führt `js/app.js` im selben Fenster aus. `app.js` erkennt den In-page-Modus über `window.__nuvoraInPage` und hängt die Rahmen-Klassen (`embedded`/`authed`) an `#lp-app` statt an `html`/`body`. Kommunikation per `window.postMessage` (Theme/Tab rein, Modal/Toast/Tab raus). Gleiche Origin, daher erbt die App Nuvoras Token aus `localStorage`. Bearbeiten der App: direkt in `apps/web/public/lp/` (eine Quelle; `style.scoped.css` ist die gescopete Fassung von `style.css`).

### Modulregister

`apps/api/app/routers/modules.py` — `REGISTRY` listet die Module **im Code**: ein Modul existiert nur, wenn es Code dazu gibt. Die DB (`user_modules`) merkt sich nur, wer was aktiviert hat.

Im Frontend liest `src/core/modules.js` das aus; `ModuleGate` in `main.jsx` schützt die Modul-Routen — ohne Aktivierung landet man bei `/modules`. Neue Module: Eintrag in `REGISTRY`, Routen in `main.jsx` hinter `ModuleGate`.

Bestandskonten werden beim Start einmalig angeschlossen (`users.modules_initialized`), damit niemand nach dem Umbau vor einer leeren Shell steht.

### Selbsttest nach dem Deploy

`./deploy.sh` ruft am Ende `./selftest.sh` — Health sagt nur „Container läuft", der Selbsttest sagt, ob es wirklich funktioniert. **Vollständig ist die Voreinstellung**: ein grüner Deploy soll heißen „die Seite läuft", nicht „der Teil, den wir angeschaut haben, läuft". Weniger geht nur ausdrücklich (`--schnell`, `--ohne-browser`, `--ohne-system`, `--ohne-desktop`; beim Deploy `--schnelltest`), und dann zählt der Block „Umfang dieses Laufs" am Ende jeden übersprungenen Teil mit Grund auf. Sieben Teile:

| Teil | Was es prüft |
| ---- | ------------ |
| `apps/api/app/routers/selftest.py` (`GET /api/selftest`, nur Administration) | Datenbank, **Schema gegen die Modelle** (es gibt kein Alembic — hier fällt auf, was in `_ensure_columns` fehlt), Konfiguration, `config/site.json`, REGISTRY gegen die gemounteten Router, **E-Mail bis zur Absender-Freigabe** (Host, Verbindung, Anmeldung, MAIL FROM/RCPT TO, SPF und DMARC — ohne eine Mail zu verschicken) |
| `scripts/selftest.py` | **Erreichbarkeit** (Namensauflösung, Antwortzeit, WebSocket-Handshake, TLS-Zertifikat samt Restlaufzeit, Umleitung http→https), **Sicherheit** (Schutz-Kopfzeilen auf mehreren Pfaden, Server-Kennung, API ohne Anmeldung, heikle Dateien, API-Doku), **Web-Dateien** (robots.txt, favicon, manifest, Icons, unbekannte Adressen, Kompression und Cache), System und Statik, dann **je Modul ein echter Schreib-Roundtrip** (anlegen, lesen, ändern, löschen) auf Kern-Klasse und -Schülern; schaltet die Module dafür zu und stellt den Zustand danach wieder her. Dazu: **Schüler-Wege ohne Login** (`/lernen/<token>`, `/cd/<code>` — inklusive Absage bei falschem Token), **Mandantentrennung** an der laufenden Installation (fremde IDs lesen und beschreiben muss scheitern) und eine **Frühwarnung bei Datenschwund** (Zahlen aus dem letzten Lauf in `.selftest-bestand.json`) |
| `scripts/selftest-browser.mjs` | Rundgang im echten Browser: jede Modul- und Kern-Seite rendert, keine Konsolenfehler, keine toten internen Links — dreimal: Desktop, **Handy (390 px, meldet waagerechten Überlauf samt schuldigem Element)** und **dunkles Design**. Dazu **echte Handgriffe** (Notizzettel, Thema anlegen) mit Neuladen als Beweis, dass gespeichert wurde. Playwright liegt isoliert in `scripts/`, nie in `apps/web` |
| `scripts/systemtest.py` | Jedes Modul **einzeln**: `Schalter.nur(key)` schaltet alle anderen ab, dann müssen die eigenen Endpunkte 2xx liefern und **alle fremden genau 403** — weder 200 (Daten offen) noch 500 (Schranke kracht statt abzuweisen). Dazu 12 Inhalts-Roundtrips, die nach dem Schreiben **unabhängig neu lesen und Werte vergleichen**; CardVote vollständig (4 Fragen mit E/G, 3 Kinder, 12 Scans) mit **im Test nachgerechneten** Erwartungen für Trefferquote, E-Bonus, Notenverteilung, Minuspunkte und krank/anwesend; Noten übernehmen, ändern, gewichten; jede Modul-Brücke **zweimal** (mit beiden Modulen muss sie gehen, mit einem sauber abgelehnt werden) |
| `scripts/systemtest-browser.mjs` | Dieselbe Matrix in der Oberfläche: je Modul rendert die Seite, die Navigation zeigt **genau dieses** Modul, fremde Adressen laufen ans ModuleGate — und vor allem bleiben **verbotene Verbindungen unsichtbar** (kein „Ins Notenmodul“ ohne Auswertung, kein Quiz-Selektor ohne CardVote), mit dem Gegenbeweis, dass sie bei beiden aktiven Modulen erscheinen. Dazu echte Handgriffe über die Oberfläche mit Neuladen als Beweis |
| `scripts/desktop-test.mjs` | Die Desktop-App im echten Electron-Fenster — der Browser-Rundgang trifft sie nicht: Start, Anmeldung, alle Kern- und Modulseiten, das Menü, `window.open` bleibt dicht (die Hülle darf keine fremden Fenster aufreißen), ein echter Handgriff |
| `scripts/desktop-offline.mjs` | Dieselbe App ohne Netz: Service Worker vorhanden, Lesen offline, Deep-Link offline, **echte Inhaltsdaten** statt einer leeren Hülle, und der Fehlerfall bei toter Adresse. Offline lesen ist das einzige Versprechen der Desktop-App — ungeprüft wäre es eine Behauptung |

Die beiden Desktop-Teile brauchen macOS und ein installiertes Electron (`apps/desktop/node_modules`). Fehlt eins davon — oder das Testkonto, oder eins der Skripte —, wird **übersprungen mit Grund**, nicht rot: eine fehlende Werkbank ist kein Befund über die Seite. Anders als Playwright wird Electron dabei **nicht** nachinstalliert; 400 MB Download mitten in einem Deploy erwartet niemand. `--schnell` lässt die Desktop-Teile mit aus (sie sind die langsamsten), `--ohne-desktop` nur sie.

Der Einrichtungsteil gehört der Administration. Damit er trotzdem bei jedem Deploy läuft, zählt auch ein `SELFTEST_TOKEN` — den erzeugt `deploy.sh` beim ersten Lauf selbst, merkt ihn in `.deploy.env` und schreibt denselben Wert in die `.env` auf dem Server — ohne ihn bleiben Schema, Konfiguration und E-Mail-Versand ungeprüft, und der Bericht sagt genau das.

Das Testkonto wird **einmalig von Hand angelegt** (registrieren + E-Mail bestätigen) — der Selbsttest legt es nicht an, weil die Bestätigungspflicht kein Skript ersetzen kann; fehlt es, sagt der Bericht genau das statt nur „401".

Der Roundtrip schreibt in das Konto aus `SELFTEST_EMAIL`/`SELFTEST_PASSWORD` (`.deploy.env`), alles mit Präfix `ZZ-Selbsttest`, und räumt inklusive Papierkorb wieder ab. Was übrig bleibt, steht am Ende unter „Reste" — das ist ein Befund, kein Rauschen.

**Ein neues Modul braucht fünf Einträge**, sonst wird die Testsuite rot (`apps/api/tests/test_selftest_register.py` hält sie zusammen): `REGISTRY` (modules.py), `MODUL_PREFIX` (selftest.py), `PROBEN` (scripts/selftest.py) sowie `endpunkte()`, `tore()` und `INHALT` in `scripts/systemtest.py`. Genau das ist der Zweck — ein Modul ohne Probe ist ein Modul, von dem niemand weiß, ob es nach dem Deploy noch läuft, und ein Modul ohne Eintrag in `tore()` ist eins, von dem niemand weiß, ob es sich überhaupt abschalten lässt. Die Oberfläche braucht keinen Eintrag: `systemtest-browser.mjs` zählt die Module zur Laufzeit aus `/api/modules` durch.

**Jedes Modul hält seine Tür zu.** Die Schranke kommt aus `modul_pflicht(key, name)` in `modules.py` — eine Quelle statt einer Kopie je Router. `apps/api/tests/test_modul_schranke.py` liest die gemounteten Routen aus der App (nicht den Quelltext) und verlangt für **jede** angemeldete `/api`-Route eine von vier Einordnungen: Kern, benannte Ausnahme, öffentlicher Weg oder Schranke. Die Ausnahmen (QR-Bild, `weak-topics`, `weak-review`) stehen mit Begründung im Test und werden in beide Richtungen geprüft. CardVote hatte als einziges Modul gar keine Schranke — mit abgeschaltetem Modul lieferten `/api/questions`, `/api/sessions-list` und `/api/folders` weiter Daten.

**Reste blockieren nichts mehr.** Bricht ein Lauf ab, liegen Testdaten und ein fremder Modul-Zustand herum — der nächste Lauf scheiterte früher schon am Aufbau (`409: Dieses Thema gibt es an dieser Stelle schon`). Beide Testfamilien räumen ihre Reste vor dem Aufbau selbst weg (`raeume_reste()` in scripts/selftest.py, `resteAbraeumen()` in den `.mjs`); `scripts/aufraeumen.py` macht dasselbe von Hand (ohne Schalter nur anzeigen, löschen erst mit `--loeschen`). Gelöscht wird ausschließlich, was ein Testpräfix trägt — die Prüfung sitzt in der Klasse `Fund` unmittelbar vor jedem DELETE, nicht nur in der Auswahl.

**HTTP-Client und Bericht stehen in `scripts/gemeinsam.py`.** Alle Testskripte holen `Api` und `Bericht` von dort — eine Quelle, kein Nachbau. Die Richtung ist gerade und muss es bleiben: `gemeinsam.py` ← `aufraeumen.py` ← `selftest.py` ← `systemtest.py`. Wer sie umdreht, baut den Importring wieder auf, den es vorher gab (und den nur ein Import mitten in der Funktion offenhielt).


### Alles wird im Wurzelverzeichnis konfiguriert

`apps/*` enthält **nur noch Quellcode und Dockerfile**. Kein eigenes Compose, kein eigenes `.env`, kein eigenes `deploy.sh` — das ist bewusst so und soll nicht zurückwandern.

| Ort                | Zweck                                       |
| ------------------ | ------------------------------------------- |
| `.env`             | Secrets, Ports, SMTP (gitignored)           |
| `.deploy.env`      | Zielserver für `deploy.sh` (gitignored)     |
| `config/site.json` | Betreiberdaten (gitignored)                 |

Pflicht-Env: `POSTGRES_PASSWORD`, `TOKEN_SECRET` — Compose bricht ohne sie bewusst ab, damit keine Default-Credentials in Produktion landen.

`config/site.json` ist die **einzige** Quelle der Betreiberdaten. `Legal.jsx` (im Rahmen) fetcht `/site.json`, das der Proxy aus dem `config`-Mount ausliefert — kein per-Modul-Config, kein `server.js` mehr. Früher hatte jedes Modul seine eigene Datei (`config/site.json` vs. `frontend/public/legal-config.json`) mit eigenem Schema — die waren bereits inhaltlich auseinandergelaufen. Schema ist jetzt das deutsche (`betreiber`, `strasse`, `plz_ort`, …).

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

### Lernpfad — `apps/web/public/lp/` (in-page in `apps/web` gemountet)

Auf dem Kern, aber **nicht in React nachgebaut**: die bestehende App läuft eingebettet unter `/lernpfad` weiter. Ihre Oberfläche ist erprobt (Aufgaben, Klasse, Generator, Lernpfade) — ein Nachbau wäre Verschwendung und ist bewusst verworfen worden. `LernpfadModule.jsx` mountet die Statik **nativ in-page** (kein iframe, kein eigener Container).

- Frontend `apps/web/public/lp/js/app.js` — ein IIFE, kein Framework, kein Build. KaTeX liegt gebündelt in `vendor/` (kein Dependency-Ordner — nicht löschen).
- **Nur Statik**, vom `web`-Container ausgeliefert. Kein eigenes Backend, keine SQLite, keine eigenen Konten, kein `server.js`.
- Daten kommen aus dem Kern: `/api/lernpfad/*` (Aufgaben, Pfade, Lernleitern), `/api/classes`, `/api/topics`.

**Der Adapter ist der Kern der Sache.** `vonKern`/`zuKern` in `app.js` übersetzen an der Datengrenze, damit die 2000 Zeilen Oberfläche ihre alten Formen behalten:

```
thema/unterthema (Text)  <->  topic_id   (Kern-Taxonomie, wird bei Bedarf angelegt)
Klassenname (Text)       <->  class_id   (Kern-Klassen)
```

Wer an den Datenformen etwas ändert, ändert den Adapter — nicht die Oberfläche.

`localStorage` ist nur noch Anzeige-Cache; der Server ist autoritativ. Der Tab „Klasse" zeigt nur an, gepflegt wird unter `/classes` (die Formulare sind per CSS versteckt, nicht entfernt: `app.js` hängt überall daran).

> **Fachbegriff:** Ein **Lernpfad** besteht aus mehreren **Lernleitern**. Das sind zwei Dinge, nicht alter und neuer Name — nicht zusammenführen. Nur die Produktmarke hieß früher „Lernleiter".

### Code-Detektiv — `apps/web/src/codedetektiv/`

Ursprünglich eigenständige Client-App (React 19 + Vite), **inzwischen nativ in die Shell portiert** (kein iframe mehr). Der Code läuft unverändert auf React 18 (keine React-19-only-APIs, reiner localStorage-Client). Sein CSS ist unter `.cd-scope` isoliert (`makecode.css` hatte globale `*`/`body`/`:root`), interne Navigation auf `/code-detektiv/*` umgeschrieben, als nested Route in `main.jsx` gemountet. `@dnd-kit` + `lzma` sind dafür web-Dependencies. Das alte Verzeichnis `apps/code-detektiv` und sein Container gibt es nicht mehr. Kein Backend, kein Login — reines Werkzeug, im Rahmen über `ModuleGate`.

### Auswertung (Notenbuch + Klassenarbeiten) — `apps/api/app/routers/noten.py`, `klassenarbeit.py` + `apps/web/src/pages/Auswertung.jsx`

Notenbuch, eigenständig wie die anderen. Bedient sich wie eine leere Tabellenkalkulation: Zeilen sind die Schüler aus dem Kern, Spalten legt die Lehrkraft an (Name + Gewicht in Prozent), in die Zelle wird `2` oder `2,3` getippt.

Zwei Dinge tut es bewusst **nicht**, und das darf nicht aufweichen:

- **Keine Zeugnisnote.** Es mittelt die eingetragenen Noten gewichtet und zeigt, wie viel des Leistungskonzepts belegt ist („40 %"). Die Note ist eine pädagogische Entscheidung.
- **Beobachtungen zählen nie mit.** „Anstrengungsbereitschaft" ist kein Messwert. Die API weist eine Beobachtung mit Notenwert zurück, damit die Trennung nicht aus Versehen erodiert.

Gewichte gibt das Werkzeug keine vor — das Leistungskonzept ist Fachkonferenz-Recht. Es zeigt nur die Summe und markiert, wenn sie nicht 100 % ergibt.

### Desktop-App — `apps/desktop`

Electron-Hülle um dieselbe Weboberfläche (eigenes Fenster, Dock-Icon). **Kein eigener Server, keine eigene Datenbank, kein eigener Code-Pfad** — sie zeigt auf einen laufenden Nuvora-Server. Offline lesen über den Service Worker; offline schreiben ist offen. Sie ist bewusst kein Modul: es gibt nichts im REGISTRY und keine Modul-Probe dafür. Geprüft wird sie trotzdem — `scripts/desktop-test.mjs` und `scripts/desktop-offline.mjs` gehen sie nach dem Deploy durch, weil eine Hülle, die niemand testet, genau so lange gut aussieht, bis jemand sie öffnet. Auf einem Rechner ohne macOS oder ohne Electron gilt sie als übersprungen (mit Grund), nicht als rot.

## Datenübernahme (erledigt)

Die Bestandsdaten aus der alten Lernleiter-SQLite sind in den Kern übernommen; das Skript `scripts/migrate-lernleiter.py` wurde danach entfernt.

## Konventionen

- Deutsch für UI, Daten und Kommentare; Code-Bezeichner Englisch.
- **Die Admin-Prüfung steht in `apps/api/app/admin.py`**, nicht in `main.py`: `_require_admin` und `APP_VERSION` brauchen auch Router (`backup.py`), und `main.py` importiert jeden Router. In `main.py` waren sie deshalb ein Importring, den nur ein Import mitten in der Funktion offenhielt. `admin.py` importiert keinen Router — von dort holen alle oben, und die Prüfung existiert weiter nur einmal.
- **Kein Alembic.** Es stand als ungenutzte Abhängigkeit in `requirements.txt` und hat genau das suggeriert — inzwischen entfernt. Das Schema entsteht beim Start aus `Base.metadata.create_all` plus `_ensure_columns` in `main.py` (additive Spalten und Indizes, idempotent). Neue Tabellen kommen von selbst; neue Spalten auf bestehenden Tabellen gehören in die `wanted`-Liste in `_ensure_columns`.
- Schüler sind Daten, keine Nutzer. Jeder Vorschlag, Lernenden ein Konto zu geben, widerspricht dem Produktzweck.
- **E/G-Differenzierung liegt am Quiz, gewertet wird an einer Stelle.** `question_sets.niveau_aktiv` schaltet sie ein, `question_set_items.niveau` markiert die E-Fragen (bewusst am Set-Eintrag: dieselbe Frage kann anderswo Anforderung sein), `question_sets.minuspunkte` schaltet den Abzug ein. Alle sehen dieselben Fragen; unterschieden wird erst in der Auswertung. Die Regeln stehen doppelt — `apps/api/app/scoring.py` (PDF, Excel, Notenbuch-Brücke) und `apps/web/src/core/scoring.js` (Auswertungsseite, rechnet Gewichte live) — und müssen zusammen geändert werden. Regressionstest: `apps/api/tests/test_scoring.py`. Wer nichts abgegeben hat, gilt als krank und bleibt aus der Wertung; die Lehrkraft kann ihn auf „anwesend" stellen, dann zählt die 0 überall mit (`eval_config.krank` / `.anwesend`).
- **Ein Papierkorb, im Kern.** Gelöschtes aus Kern und Modulen (Klassen, Kurse, Kartenstapel, Karten, Lernpfade, Lernleitern) sammelt `apps/api/app/routers/trash.py` und zeigt `/papierkorb`. Module löschen nur noch weich (`deleted_at`) — kein Modul baut sich wieder eine eigene Papierkorb-Ansicht. Wiederherstellen/endgültig Löschen ruft die Modul-Funktionen auf, damit die Semantik (Kurs-Mitgliedschaften, Kaskaden) nur einmal existiert. Neue Art mit `deleted_at`: Eintrag in `list_trash` + `_AKTIONEN`, Tabelle in den Aufräumjob in `main.py` (30 Tage).
- **Live-Daten nie durch delete+recreate gefährden.** Entitäten mit Kaskaden (Schüler → Noten, Karten-Fortschritt) werden **gemergt**, nie gelöscht und neu angelegt — sonst reißt die Kaskade fremde Modul-Daten mit. Regressionstest dazu: `apps/api/tests/test_update_class.py` (`cd apps/api && pip install -r requirements-dev.txt && pytest`).
- **Stile kommen aus `apps/web/src/components/Icons.jsx`** — das ist die **einzige** Design-Quelle. Buttons `btnPrimary`/`btnSecondary`/`btnSmall`, `iconBtn`; Kopf `pageTitle`/`pageIntro`; Formulare `inputStyle`/`selectStyle`; Container `cardStyle`/`panelStyle`; Tabellen `th`/`td`; `chipStyle`, `badge(color)`, `COLORS`; Komponenten `Tabs`, `Toggle`, `StageBadge`. **Nie je Seite neu definieren** (so sind vier `btnPrimary`-Varianten und ein Dutzend leicht abweichender Input-/Tab-Styles entstanden). Braucht eine Seite eine Abweichung, per Spread ableiten (`{ ...inputStyle, width: "100%" }`), nicht neu bauen. Drei Gruppen weichen bewusst ab (Formularseiten, Bestätigungsseiten, Session/Beamer) — das steht an der Definition.
- **Frühwarnung rechnet an einer Stelle und diagnostiziert nichts.** `apps/api/app/fruehwarnung.py` beantwortet aus den CardVote-Tests „wer hängt über mehrere Tests hinweg hinterher?" — gemessen wird der **Abstand zum Klassenmittel desselben Tests** (eine absolute Quote sagt nichts: ein schwerer Test drückt alle) über ein Fenster der letzten Tests, mit Mindestzahl an Antworten, weil vier A–D-Fragen zu einem Viertel Ratequote gehören. Die Frage „aktuelles Thema oder alte Lücke?" beantwortet die **Zeitachse statt gepflegter Voraussetzungen**: Nuvora kennt das Erstvorkommen jedes Themas, Fragen zu lange bekannten Themen sind Wiederholung — also der Vorwissenstest, den niemand anlegen muss. Regressionstest `apps/api/tests/test_fruehwarnung.py` (rechnet die Regel nach, inklusive der Fälle, die **nicht** melden). Anzeige an drei Orten aus **einer** Komponente (`apps/web/src/components/Fruehwarnung.jsx`): Startseite, Klassen-Auswertung, Schülerseite. Die Ausgabe nennt immer die Zahlen, aus denen sie entstand; sie ist eine Beobachtung, nie eine Aussage über eine Lernstörung — die folgt aus keiner Trefferquote.
- **Besonders schützenswerte Daten:** `students.foerder`, `students.massnahmen` und `students.notizen` sind DSGVO Art. 9 (Dyskalkulie, LRS, Nachteilsausgleiche). Sie stehen in keinem Export und in keiner Veröffentlichung. Wer ein Feld ergänzt, prüft zuerst jeden Export- und Marktplatzpfad.
- **Fördermaßnahmen hängen am Kind, nicht am Modul.** `students.massnahmen` hält, was zum Schwerpunkt konkret vereinbart ist (`[{art, detail, arbeit}]`, Katalog `MASSNAHMEN_VALUES` in `classes.py`, wortgleich in `Classes.jsx`). `arbeit: true` heißt „gilt in Klassenarbeiten" — genau die zeigt der Kalender am Klassenarbeitstermin über `GET /api/classes/{id}/massnahmen?arbeit=true`. Der Kalender zeigt nur an; gepflegt wird unter `/classes`.
- **Das Förder-Vokabular ist fest und wortgleich** in `classes.py` (`FOERDER_VALUES`) und `Classes.jsx` (`FOERDER`) — inklusive Umlaut in „Hören". Die Bestandsdaten benutzen genau diese Zeichenketten; jede Abweichung macht sie beim Übernehmen unbrauchbar.
