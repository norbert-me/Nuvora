# Selbsttest — was „grün" bedeutet und was nicht

Ein Health-Check sagt: „der Container läuft". Er sagt nichts darüber, ob man
sich anmelden kann, ob das Schema zu den Modellen passt oder ob ein Modul nach
dem letzten Umbau noch schreibt. Genau diese Lücke schließt der Selbsttest.

`./deploy.sh` ruft ihn am Ende automatisch auf — **vollständig**, das ist die
Voreinstellung. Der Rückgabewert ist rot, wenn er etwas findet.

## Aufrufen

```bash
./selftest.sh                  # ALLES: API, Systemtest, beide Browser-Läufe
./selftest.sh --schnell        # nur der kurze API-Selbsttest
./selftest.sh --ohne-browser   # API + Systemtest, ohne Playwright
./selftest.sh --ohne-system    # ohne den Alleinstellungs-Durchgang
./selftest.sh --nur-system     # nur die Checks ohne Login (kein Schreiben)
./selftest.sh --url https://…  # gegen eine andere Instanz
./selftest.sh --debug          # jede Anfrage mit Status, Dauer und Fehlertext
./selftest.sh --json           # Ergebnis als JSON
```

Die Namen sind leicht zu verwechseln: `--ohne-system` lässt den Systemtest weg,
`--nur-system` lässt umgekehrt alles weg, was einen Login braucht.

## Die vier Teile

| Teil | Datei | Was es tut |
| ---- | ----- | ---------- |
| Selbsttest | `scripts/selftest.py` | Erreichbarkeit, Sicherheit, Web-Dateien, Einrichtung, je Modul ein Schreib-Roundtrip |
| Systemtest | `scripts/systemtest.py` | jedes Modul **einzeln**: nur dieses aktiv, alle anderen müssen abweisen |
| Rundgang | `scripts/selftest-browser.mjs` | jede Seite im echten Browser — Desktop, Handy (390 px), dunkles Design |
| Oberflächen | `scripts/systemtest-browser.mjs` | jedes Modul einzeln in der Oberfläche; verbotene Verknüpfungen müssen unsichtbar sein |

Dazu kommt ein fünfter Teil, der **in der API selbst** sitzt:
`apps/api/app/routers/selftest.py` beantwortet `GET /api/selftest` und prüft,
was nur von innen sichtbar ist — Datenbankverbindung, **Schema gegen die
Modelle**, Konfiguration, `config/site.json`, REGISTRY gegen die tatsächlich
gemounteten Router und den E-Mail-Weg bis zur Absender-Freigabe.

Der Schema-Vergleich ist der wichtigste einzelne Check: es gibt kein Alembic,
und hier fällt auf, was in `_ensure_columns` vergessen wurde.

Der E-Mail-Teil geht bis `MAIL FROM` / `RCPT TO` und prüft SPF und DMARC der
Absender-Domain — **ohne** eine Mail zu verschicken.

## Was konkret geprüft wird

| Bereich | Was |
| ------- | --- |
| Erreichbarkeit | Namensauflösung, Antwortzeit, WebSocket-Handshake, TLS-Zertifikat samt Restlaufzeit, Umleitung http → https |
| Sicherheit | Schutz-Kopfzeilen auf mehreren Pfaden, Server-Kennung ohne Version, API-Doku nicht öffentlich, Datenrouten ohne Token verschlossen, heikle Dateien (`.env`, `.git/config` …) liefern nichts |
| Web-Dateien | `robots.txt`, Favicon, Manifest, Icons, unbekannte Adressen bekommen die Shell, Anwendung kommt komprimiert und zwischenspeicherbar |
| Einrichtung | Datenbank, Schema gegen die Modelle, Konfiguration, Betreiberdaten, REGISTRY gegen die gemounteten Router |
| E-Mail | Host, Verbindung, Anmeldung, Absender-Freigabe, SPF, DMARC |
| Module | je Modul ein echter Schreib-Roundtrip auf Kern-Klasse und -Schülern: anlegen, lesen, ändern, löschen |
| Alleinstellung | je Modul: nur dieses aktiv — die eigenen Endpunkte antworten, alle fremden liefern **genau 403** |
| Rechnen | CardVote vollständig durchgespielt und die Zahlen nachgerechnet: Trefferquote, E-Bonus, Notenverteilung, Minuspunkte, krank/anwesend; dazu Noten übernehmen, ändern, gewichten |
| Brücken | jede Modul-Verbindung zweimal: mit beiden Modulen funktionierend, mit einem sauber abgelehnt — im Backend und in der Oberfläche |
| Schüler-Wege | `/lernen/<token>` und `/cd/<code>` ohne Konto — und Absage bei falschem Token |
| Mandantentrennung | fremde IDs lesen und beschreiben muss scheitern |
| Bestand | Klassen, Schüler, Kurse, Themen im Vergleich zum letzten Lauf (`.selftest-bestand.json`) — Frühwarnung, falls eine Kaskade zu viel mitreißt |
| Browser | jede Seite rendert, keine Konsolenfehler, keine toten internen Links; Handy-Lauf meldet waagerechten Überlauf samt schuldigem Element; dazu echte Handgriffe mit Neuladen als Beweis, dass gespeichert wurde |

### Warum „genau 403"

Beim Alleinstellungs-Durchgang wäre `200` ein offenes Datenleck und `500` eine
Schranke, die kracht statt abzuweisen. Beides ist ein Befund. Nur `403` heißt:
Regel 3 hält.

## Was grün *nicht* heißt

Ein grüner Lauf ist eine Aussage über **den geprüften Umfang**, nicht über die
Installation. Deshalb steht am Ende jedes Laufs ein Block „Umfang dieses
Laufs", der jeden übersprungenen Teil mit Grund aufführt. Lies ihn.

Grün bedeutet insbesondere **nicht**:

- **dass die Einrichtung geprüft wurde.** Ohne `SELFTEST_TOKEN` (oder das
  Administrationskonto) bleiben Schema, Konfiguration und E-Mail-Versand außen
  vor. `deploy.sh` erzeugt das Token beim ersten Lauf selbst, merkt es in
  `.deploy.env` und schreibt denselben Wert in die `.env` auf dem Server.
- **dass die Module geprüft wurden.** Ohne Testkonto
  (`SELFTEST_EMAIL`/`SELFTEST_PASSWORD`) läuft nur, was ohne Login geht. Der
  Bericht sagt das ausdrücklich, statt nur „401" zu melden.
- **dass die Oberfläche stimmt.** Mit `--schnell` oder `--ohne-browser`
  rendert niemand eine Seite.
- **dass deine Daten in Ordnung sind.** Der Bestandsvergleich ist eine
  Frühwarnung, kein Backup-Ersatz.
- **dass es keine Fehler gibt.** Er prüft, was jemand aufgeschrieben hat.

## Das Testkonto

Der Selbsttest schreibt in ein **eigenes** Konto, nicht in das mit dem echten
Unterricht. Eingetragen wird es in `.deploy.env`:

```
SELFTEST_EMAIL=""
SELFTEST_PASSWORD=""
```

Dieses Konto wird **einmalig von Hand angelegt**: unter `<SITE_URL>/login`
registrieren und die Bestätigungsmail anklicken. Der Selbsttest legt es nicht
an — die Bestätigungspflicht kann kein Skript ersetzen. Fehlt es, sagt der
Bericht genau das.

## Testdaten und Aufräumen

Alles, was die Tests anlegen, trägt das Präfix `ZZ-Selbsttest` bzw.
`ZZ-Systemtest` und wird inklusive Papierkorb wieder abgeräumt. Zugeschaltete
Module werden auf den Zustand vor dem Lauf zurückgesetzt; der Ausgangszustand
liegt dafür in `.selftest-module.json`.

Was übrig bleibt, steht am Ende unter „Reste" — das ist ein Befund, kein
Rauschen.

Nach einem Abbruch (Strg-C) räumen die Tests beim nächsten Lauf selbst auf. Von
Hand geht es auch:

```bash
python3 scripts/aufraeumen.py               # nur anzeigen, was liegengeblieben ist
python3 scripts/aufraeumen.py --loeschen    # wirklich abräumen
python3 scripts/aufraeumen.py --module-aus  # alle Module abschalten
```

Es fasst ausschließlich an, was ein Testpräfix trägt; die Prüfung sitzt
unmittelbar vor jedem Löschen, nicht nur in der Auswahl. Fehlt
`.selftest-module.json`, sagt es das — und rät nicht.

## Playwright

Der Browser-Teil braucht Playwright. `selftest.sh` installiert es beim ersten
Lauf nach `scripts/node_modules` — bewusst getrennt von `apps/web`, damit es nie
ins Web-Image wandert.

## Für neue Module

Ein Modul im REGISTRY ohne Eintrag in `MODUL_PREFIX` (selftest.py) und `PROBEN`
(scripts/selftest.py) macht den Selbsttest **rot**. Das ist der Zweck: siehe
[Ein neues Modul bauen](neues-modul.md).
