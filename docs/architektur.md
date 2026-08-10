# Architektur

Wie Nuvora aufgebaut ist und warum. Für die Kurzfassung reicht das
[README](../README.md); hier steht, was dahintersteckt.

## Das Prinzip: Kern und Gäste

Nuvora ist **die Basis**. Ihr gehören Konten, Klassen, Kurse, Schüler, Themen
und Material. **Module** (CardVote, Lernpfad, Karten …) arbeiten auf diesen
Daten, besitzen sie aber nicht, und werden pro Lehrkraft einzeln zugeschaltet.

Daraus folgen drei Regeln, an die sich jede Änderung hält:

1. **Kein Modul besitzt Klassen oder Schüler.** Die liegen im Kern.
2. **Kein Modul hat eigene Konten.** Der Kern authentifiziert, Module erben.
3. **Module hängen nicht voneinander ab.** CardVote läuft ohne Lernpfad und
   ohne Notenbuch. Verbindendes ist **Zusatz, nie Voraussetzung**.

Regel 3 ist die, die im Alltag weh tut — und deshalb die wichtigste. Sie ist
der Grund, warum `questions.topic_id` optional ist und `ON DELETE SET NULL`
trägt: verschwindet das Thema, verliert die Frage ihre Verknüpfung, nicht ihre
Existenz. Ein Feature, das CardVote ohne Lernpfad kaputt macht, ist falsch
gebaut, auch wenn es fachlich reizvoll klingt.

Geprüft wird das nicht nur durch guten Willen: der **Systemtest**
(`scripts/systemtest.py`) schaltet je Durchgang genau *ein* Modul aktiv und
verlangt, dass alle fremden Endpunkte mit **403** antworten — nicht mit 200
(Daten offen) und nicht mit 500 (die Schranke kracht, statt abzuweisen). Siehe
[Selbsttest](selbsttest.md).

## Warum überhaupt Module?

Weil eine Lehrkraft, die nur Karteikarten will, keine Scanner-Oberfläche und
keinen Marktplatz sehen soll. Das Modulregister ist damit kein
Lizenz-Mechanismus, sondern eine Aufräumhilfe: die Shell zeigt nur, was
zugeschaltet ist, und die API weist alles andere ab.

## Wo der Code liegt

Verzeichnisse folgen der Architektur, nicht der Herkunft:

| Ort                    | Inhalt                                             |
| ---------------------- | -------------------------------------------------- |
| `apps/api`             | FastAPI-Kern **und** die Modul-Router               |
| `apps/web`             | React-Shell **und** die Modul-Seiten                |
| `apps/web/public/lp/`  | Statik der eingebetteten Lernpfad-App              |
| `apps/desktop`         | Electron-Hülle um dieselbe Weboberfläche           |
| `scripts/`             | Selbsttest, Systemtest, Aufräumen, Backup          |
| `config/site.json`     | Betreiberdaten für Impressum und Datenschutz       |

Es gibt bewusst **kein** `apps/cardvote` — der Kern kann nicht in einem seiner
Module liegen — und **kein** `apps/lernpfad` mehr.

## Die vier Container

`docker-compose.yml` und `nginx.conf` im Wurzelverzeichnis fahren alles
zusammen. Es gibt keine Einzel-Composes in `apps/*`.

```
        Browser
           │
      ┌────▼─────┐   Port 8080 (PORT aus .env)
      │  proxy   │   nginx: Sicherheits-Header, Rate-Limits, /site.json
      └──┬────┬──┘
         │    │
   /api/ │    │ /
   /ws/  │    │ /lp/
      ┌──▼─┐ ┌▼────┐
      │api │ │ web │  nginx mit der gebauten React-App + Lernpfad-Statik
      └──┬─┘ └─────┘
         │
      ┌──▼─┐
      │ db │  Postgres 16, Volume pgdata
      └────┘
```

| Dienst  | Was                                                          |
| ------- | ------------------------------------------------------------ |
| `db`    | Postgres 16, Daten im Volume `pgdata`                        |
| `api`   | FastAPI + SQLAlchemy 2 (async, asyncpg), Uploads im Volume `uploads` |
| `web`   | die gebaute React-Shell inklusive Lernpfad-Statik unter `/lp/` |
| `proxy` | nginx — eine Domain, alle Teile, Sicherheits-Header an einer Stelle |

Nach außen führt genau **ein** Port. TLS terminiert ein vorgelagerter Proxy;
Nuvora selbst lauscht auf Port 80 im Container (siehe
[SECURITY.md](../SECURITY.md), „Was in den Rahmen fällt").

## Das Modulregister

Die Liste der Module steht **im Code**, nicht in der Datenbank:
`REGISTRY` in `apps/api/app/routers/modules.py`. Ein Modul existiert nur, wenn
es Code dazu gibt. Die Tabelle `user_modules` merkt sich ausschließlich, **wer
was aktiviert hat**.

Die Absicherung liegt an zwei Stellen, und beide sind nötig:

- **Backend** — jeder Modul-Router hat eine `require_module`-Abhängigkeit, die
  bei fehlender Aktivierung `403` wirft. Das ist die echte Schranke.
- **Frontend** — `ModuleGate` in `apps/web/src/main.jsx` schützt die Route;
  ohne Aktivierung landet man auf `/modules`. `useAktiv()` aus
  `apps/web/src/core/modules.js` blendet einzelne Knöpfe aus.

Das Frontend allein wäre keine Sicherheit, nur Kosmetik. Ein Tippfehler in
`aktiv("noten")` statt `aktiv("auswertung")` fällt auch nicht von selbst auf —
deshalb prüft `apps/api/tests/test_modul_keys_frontend.py`, dass REGISTRY,
`MODUL_KEYS` und jeder tatsächlich abgefragte Schlüssel dieselbe Menge sind.

Bestandskonten werden beim Start einmalig angeschlossen
(`users.modules_initialized`), damit niemand nach einem Upgrade vor einer
leeren Shell steht.

## Die drei Bauformen der Module

Nicht jedes Modul ist eine React-Seite. Nuvora trägt drei Formen — bewusst,
weil ein Nachbau erprobter Oberflächen Verschwendung wäre:

| Form                  | Beispiel      | Wie                                                  |
| --------------------- | ------------- | ---------------------------------------------------- |
| React im Rahmen       | CardVote, Auswertung, Karten … | normale Seiten in `apps/web/src`     |
| Fremde App, nativ eingebettet | Lernpfad | Vanilla-JS-App, in-page gemountet                    |
| Portierte Client-App  | Code-Detektiv | ursprünglich eigenständig, jetzt als nested Route    |

### Lernpfad: nativ in-page, kein iframe

`LernpfadModule.jsx` injiziert das Markup von `/lp/index.html` in einen Host
`#lp-app`, lädt `style.scoped.css` (das komplette Lernpfad-CSS unter `#lp-app`
gescopet, damit `:root`/`body`-Regeln nicht ins Shell-Theming lecken) und führt
`js/app.js` im selben Fenster aus. `app.js` erkennt den Modus über
`window.__nuvoraInPage` und hängt seine Rahmen-Klassen an `#lp-app` statt an
`html`/`body`. Kommunikation per `window.postMessage` (Theme und Tab rein,
Modal/Toast/Tab raus). Gleiche Origin, deshalb erbt die App Nuvoras Token aus
dem `localStorage`.

**Der Adapter ist der Kern der Sache.** `vonKern`/`zuKern` in `app.js`
übersetzen an der Datengrenze, damit die gewachsene Oberfläche ihre alten
Formen behalten darf:

```
thema/unterthema (Text)  <->  topic_id   (Kern-Taxonomie, wird bei Bedarf angelegt)
Klassenname (Text)       <->  class_id   (Kern-Klassen)
```

Wer an den Datenformen etwas ändert, ändert den Adapter — nicht die
Oberfläche. `localStorage` ist dort nur noch Anzeige-Cache; der Server ist
autoritativ.

### Code-Detektiv: portiert, CSS isoliert

Läuft unverändert auf React 18 (keine React-19-only-APIs, reiner
localStorage-Client). Sein CSS ist unter `.cd-scope` isoliert, weil
`makecode.css` globale `*`/`body`/`:root`-Regeln mitbrachte. Kein Backend für
die Rätsel selbst, kein Login — die Klassen-Session läuft über
`/api/codedetektiv`.

## Was die Module verbindet

Die geteilte **Themen-Taxonomie** (Fach → Thema → Unterthema) trägt alle
Brücken. Jede davon ist optional und muss sauber verschwinden, wenn eines der
beiden Module fehlt:

- schwaches Thema aus CardVote/Code-Detektiv → Karten-Deck oder Lernpfad-Aufgabe
- CardVote-, Karten- und Code-Detektiv-Ergebnisse → Notenspalte
- schwaches Thema → passender Einstieg vorgeschlagen
- Kalender plant Quiz/Deck/Lernleiter und schaltet Decks am Tag frei
- Themen-Ansicht zeigt zu einem Thema alles quer über die aktiven Module

Der Browser-Systemtest (`scripts/systemtest-browser.mjs`) prüft jede Brücke
**zweimal**: mit beiden Modulen muss sie da sein, mit nur einem muss sie
unsichtbar bleiben.

## Ein Papierkorb, im Kern

Gelöschtes aus Kern und Modulen (Klassen, Kurse, Kartenstapel, Karten,
Lernpfade, Lernleitern) sammelt `apps/api/app/routers/trash.py` und zeigt
`/papierkorb`. Module löschen nur noch weich (`deleted_at`); kein Modul baut
sich eine eigene Papierkorb-Ansicht. Wiederherstellen und endgültiges Löschen
rufen die Modul-Funktionen auf, damit die Semantik (Kurs-Mitgliedschaften,
Kaskaden) nur einmal existiert. Nach 30 Tagen räumt ein Hintergrund-Job auf.

**Live-Daten werden nie durch delete+recreate ersetzt.** Entitäten mit
Kaskaden (Schüler → Noten, Karten-Fortschritt) werden gemergt — sonst reißt die
Kaskade fremde Modul-Daten mit. Dafür gibt es den Regressionstest
`apps/api/tests/test_update_class.py`.

## Klasse und Kurs

- **Klasse** = die Schülergruppe, also die Personen.
- **Kurs** = das Fach. Eine Klasse kann in mehreren Kursen liegen (n:m).

Modul-Inhalte hängen am Kurs, die Schüler werden geteilt. Anwesenheit läuft
über den Kurs; Karten und Noten bleiben pro Klasse an der Schüler-Zeile.

## Schema ohne Migrationen

Es gibt **kein Alembic** — das stand einmal als ungenutzte Abhängigkeit drin
und hat genau das Gegenteil suggeriert. Das Schema entsteht beim Start aus
`Base.metadata.create_all` plus `_ensure_columns` in `apps/api/app/main.py`
(additive Spalten und Indizes, idempotent).

- Neue **Tabellen** kommen von selbst.
- Neue **Spalten** auf bestehenden Tabellen gehören in die `wanted`-Liste in
  `_ensure_columns`.

Wer das vergisst, merkt es beim nächsten Deploy: der Selbsttest vergleicht das
Schema gegen die Modelle. Genau dafür ist er da.

## Stile

`apps/web/src/components/Icons.jsx` ist die **einzige** Design-Quelle: Buttons
(`btnPrimary`, `btnSecondary`, `btnSmall`, `iconBtn`), Kopf (`pageTitle`,
`pageIntro`), Formulare (`inputStyle`, `selectStyle`), Container (`cardStyle`,
`panelStyle`), Tabellen (`th`, `td`), dazu `chipStyle`, `badge(color)`,
`COLORS` und die Komponenten `Tabs`, `Toggle`, `StageBadge`. Braucht eine Seite
eine Abweichung, wird per Spread abgeleitet
(`{ ...inputStyle, width: "100%" }`) — nicht neu gebaut. So sind früher vier
`btnPrimary`-Varianten entstanden.

## Konventionen

- Deutsch für Oberfläche, Daten und Kommentare; Code-Bezeichner Englisch.
- **Schüler sind Daten, keine Nutzer.** Jeder Vorschlag, Lernenden ein Konto zu
  geben, widerspricht dem Produktzweck.
- **Alles wird im Wurzelverzeichnis konfiguriert.** `apps/*` enthält nur
  Quellcode und Dockerfile — kein eigenes Compose, kein eigenes `.env`, kein
  eigenes Deploy-Skript.
- **E/G-Differenzierung wird an einer Stelle gewertet**, die Regeln stehen aber
  doppelt: `apps/api/app/scoring.py` (PDF, Excel, Notenbuch-Brücke) und
  `apps/web/src/core/scoring.js` (Auswertungsseite, rechnet live). Beide müssen
  zusammen geändert werden; `apps/api/tests/test_scoring.py` und
  `test_scoring_parity.py` wachen darüber.

## Weiter

- [Ein neues Modul bauen](neues-modul.md)
- [Selbsttest](selbsttest.md)
- [Datenschutz](datenschutz.md)
