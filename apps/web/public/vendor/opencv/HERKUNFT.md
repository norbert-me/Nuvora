# opencv.js — mitgeliefert, nicht vom CDN

| | |
|---|---|
| Dateien | `opencv.js` (0,2 MB) + `opencv.wasm` (7,6 MB) |
| Fassung | OpenCV 4.12.0, WebAssembly-Build aus `@techstark/opencv-js@4.12.0-release.1` |
| Lizenz | Apache-2.0 (`LICENSE.txt`) |
| Angepasst | ja — vier Stellen ersetzt, WebAssembly herausgelöst (`scripts/opencv_ohne_eval.py`) |
| Gebraucht von | `apps/web/src/cardvote/aruco.js` (ArUco-Erkennung im Browser) |

**Warum mitgeliefert?** `nginx.conf` im Wurzelverzeichnis setzt `script-src 'self'`
— es darf gar kein CDN geladen werden. Dieselbe Entscheidung wie bei der
KaTeX-Statik des Lernpfads (`public/lp/vendor/katex`).

**Warum nicht vorgeladen?** Zusammen sind es rund 7,8 MB (gut 3 MB über die
Leitung); `precache.json` umfasst sonst 2,7 MB. Beide liegen in `public/` und
tauchen deshalb gar nicht erst im Rollup-Bundle auf, aus dem `precacheListe`
(vite.config.js) seine Liste zieht — geholt werden sie erst beim Betreten der
Scan-Seite und bleiben danach im Cache des Service-Workers. Wer nie scannt,
zahlt sie nie.

**Warum 4.12 und nicht 5.0 (die Serverfassung)?** Der Machbarkeits-Spike hat 4.12
Karte für Karte gegen den Server gemessen: auf 912 Karten null verlorene Karten,
16 zusätzlich gefundene, null abweichende Antworten. 5.0 ließ sich im Browser
nicht initialisieren und wäre bestenfalls gleich gut.

**Nicht bearbeiten.** Bei einem Update: Datei austauschen, Fassung hier
nachtragen und die Erkennung gegen dieselben Testbilder nachmessen.


## Die Anpassungen: kein Übersetzen zur Laufzeit, kein `data:`-Fetch

**Die Dateien sind NICHT unverändert.** Es sind zwei getrennte Gründe, und beide
haben dasselbe Fehlerbild: die Erkennung startet nicht und der Scanner fällt
stumm auf den Server zurück. Beides erledigt
`python3 scripts/opencv_ohne_eval.py apps/web/public/vendor/opencv/opencv.js`
(idempotent, bricht ab, wenn es eine Stelle nicht wortgenau findet).

### 1. Vier Stellen bauen Funktionen aus Text

`nginx.conf` setzt `script-src 'self' 'wasm-unsafe-eval'` — kein
`'unsafe-eval'`. Die fertigen Builds übersetzen an vier Stellen Quelltext zur
Laufzeit:

| Stelle | vorher | nachher |
|---|---|---|
| `createNamedFunction` | Mantel per `new Function`, nur für den Namen | derselbe Mantel, Name über `Object.defineProperty` |
| `makeDynCaller` | Aufrufer per `new Function` | dasselbe mit `apply` |
| `craftInvokerFunction` | Aufrufer **jeder gebundenen Funktion** per `new_(Function, …)` | derselbe Ablauf als Abschluss |
| `__emval_get_method_caller` | Aufrufer für „C++ ruft eine JS-Methode", ebenso | ebenso |

Die dritte ist die entscheidende, und sie ist die, die man beim Suchen nach
`new Function` **nicht** findet: embind geht über seinen eigenen Umweg
`new_(Function, args)`. Der Fehler fällt in den statischen Konstruktoren an,
also bevor eine einzige OpenCV-Funktion registriert ist — und das Ergebnis sieht
aus wie alles Mögliche, nur nicht wie ein CSP-Verstoß: `window.cv` existiert,
`cv.calledRun` ist `true`, `cv.Mat` ist eine Funktion, aber von 374 Schlüsseln
stammt kein einziger aus der OpenCV-API. Ein Modul, das fertig aussieht und leer
ist. Das Skript prüft deshalb am Ende auf `new Function`, `new_(Function` **und**
`eval(`.

Die Ersetzungen ändern kein Verhalten, nur `Function.prototype.name` und
`.length`; embind reicht die Stelligkeit überall ausdrücklich weiter
(`exposePublicSymbol(name, fn, numArguments)`).

### 2. Das WebAssembly steckte im JS

Der Build ist `SINGLE_FILE`: das 7,6-MB-WebAssembly lag als
`data:application/octet-stream;base64,…` mitten im Skript, und Emscripten holte
es beim Start mit `fetch()`. Ein `fetch` auf eine `data:`-URL zählt für die CSP
als Verbindung, und `connect-src 'self' wss: ws:` kennt kein `data:` — Chrome
blockt ihn ab.

`data:` in den `connect-src` aufzunehmen wäre die falsche Antwort: die Direktive
gilt für die ganze Anwendung, und `data:` in `connect-src` ist ein bekannter Weg,
Daten an einer CSP vorbeizuschleusen. Also andersherum — das WebAssembly liegt
jetzt als `opencv.wasm` daneben und wird über `locateFile()` von der eigenen
Herkunft geholt, gedeckt von `connect-src 'self'`. Nebenbei: das JS schrumpft von
10,4 MB auf 0,2 MB, der base64-Aufschlag von einem Drittel entfällt, und
`WebAssembly.instantiateStreaming` kann übernehmen.

Dazu gehört ein `location ~ \.wasm$`-Block in `apps/web/nginx.conf`
(`application/wasm`) — bei jedem anderen Typ fällt Emscripten still auf den
langsameren Weg zurück. Kein `types` im `/vendor/`-Block: ein `types` in einer
`location` ersetzt die **ganze** Zuordnung, und `opencv.js` ginge dann als
`application/octet-stream` heraus, was der Browser wegen `nosniff` ablehnt.

### Alternativen, verworfen

`'unsafe-eval'` in der CSP wäre genau die Erlaubnis, die der Pentest
herausgeworfen hat und die `scripts/selftest.py` seither festhält — und sie gälte
für die ganze Anwendung. Die saubere Lösung wäre ein eigener Emscripten-Build mit
`-sDYNAMIC_EXECUTION=0` und getrennter `.wasm` (der hätte alle vier Stellen gar
nicht erst und wäre nebenbei kleiner) — ein bis zwei Arbeitstage, bei jedem
OpenCV-Update erneut. Zurückgestellt; die Ersetzungen sind dasselbe in klein.

**Nach jedem Austausch der Dateien das Skript erneut laufen lassen.** Die Probe
„opencv.js/.wasm (Erkennung im Browser)" in `scripts/selftest.py` prüft, dass
beide ausgeliefert werden und die `.wasm` den richtigen Typ trägt; die Probe
„CSP verbietet Inline-Javascript" hält die andere Hälfte fest: dass
`'unsafe-eval'` nicht doch wieder in die CSP wandert.
