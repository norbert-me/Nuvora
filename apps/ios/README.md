# Nuvora für iPhone und iPad

Eine **Hülle** um die eigene Nuvora-Installation — derselbe Gedanke wie
`apps/desktop`: kein eigener Server, keine eigene Datenbank, kein zweiter
Code-Pfad. Die App zeigt beim ersten Start eine Seite, auf der die
Server-Adresse eingetragen wird, und lädt danach genau die Weboberfläche, die
auch der Browser zeigt. Offline lesen und offline schreiben kommen damit vom
Service-Worker und der Outbox der Weboberfläche (siehe CLAUDE.md) — die Hülle
bringt nichts Eigenes mit, das auseinanderlaufen könnte.

## Warum überhaupt eine App, wenn es die PWA gibt

Auf dem iPhone hat eine installierte PWA drei bekannte Grenzen: Safari räumt
den Speicher einer Seite nach einigen Tagen ohne Besuch auf, es gibt keinen
Eintrag im App Store (Verteilung an ein Kollegium), und ein Fenster ohne
Adressleiste hat keinen Zurück-Weg. Das erste ist der eigentliche Grund: eine
App, die ihre Offline-Daten über Nacht verliert, ist keine.

## Bauen: ein Befehl

```bash
./scripts/ios-bauen.sh          # oder: cd apps/ios && npm run build
```

Das Skript richtet alles ein, was fehlt (`npm install`, beim ersten Mal
`npx cap add ios`, sonst `npx cap sync ios`), archiviert mit `xcodebuild`
**ohne Signierung** und legt `apps/ios/dist/Nuvora-<Fassung>.ipa` ab. Fehlt
macOS, Xcode oder CocoaPods, bricht es mit dem Handgriff ab, der fehlt.

**Xcode braucht man nur zum Debuggen** auf einem angeschlossenen Gerät:

```bash
cd apps/ios && npx cap open ios   # dort Signierung waehlen, auf Geraet starten
```

Das Verzeichnis `apps/ios/ios` ist **nicht eingecheckt** — es entsteht beim
ersten Lauf und würde nach jedem Capacitor-Update auseinanderlaufen.
`npx cap add ios` braucht **CocoaPods** (`brew install cocoapods`).

## Die .ipa am Release ist **unsigniert**

`.github/workflows/release.yml` (Job `ios`) baut sie bei jedem Tag-Push mit
denselben Schritten wie das Skript — ohne Signierung, weil kein
Apple-Entwicklerzertifikat hinterlegt ist. Die Datei heißt
`Nuvora-<Fassung>.ipa` und hängt am Release; im Profil unter „Apps" steht sie
damit als ladbare Datei statt als „In Vorbereitung".

**Antippen genügt nicht.** iOS installiert nur signierte Apps. Drei Wege:

* **AltStore** oder **Sideloadly** — signieren mit der eigenen Apple-ID. Die
  Signatur hält 7 Tage und wird von der Software erneuert, solange das Gerät
  den Rechner erreicht.
* **Eigenes Entwicklerkonto**: die `.ipa` in Xcode neu signieren oder gleich
  aus dem Quellcode bauen (oben).
* **Gar nicht**: Nuvora in Safari öffnen, *Teilen* → *Zum Home-Bildschirm*.
  Das ist die PWA mit den oben genannten Grenzen — für viele reicht sie.

## Mit Apple-Entwicklerkonto: der Workflow signiert selbst

Der Job `ios` prüft, ob ein Zertifikat hinterlegt ist, und **signiert dann**,
sonst läuft er unsigniert weiter. Ein fehlendes Apple-Konto darf das Release
nicht aufhalten — deshalb ein Zweig und kein Schalter, den jemand pflegen
müsste. Diese Secrets liest er (Repository → *Settings* → *Secrets and
variables* → *Actions*):

| Secret | Inhalt |
| ------ | ------ |
| `IOS_CERT_P12` | Verteilungszertifikat als `.p12`, **base64** (`base64 -i cert.p12 \| pbcopy`) |
| `IOS_CERT_PASSWORD` | Passwort des `.p12` |
| `IOS_PROVISIONING_PROFILE` | Provisioning-Profil (`.mobileprovision`), base64 |
| `IOS_TEAM_ID` | Team-ID aus dem Entwicklerkonto (10 Zeichen) |
| `IOS_EXPORT_METHOD` | optional, Vorgabe `app-store`; `ad-hoc` für eine Datei, die auf registrierten Geräten läuft |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY` | App-Store-Connect-Schlüssel (`.p8` base64) — **nur** damit lädt der Workflow direkt nach TestFlight |

Sind die drei `ASC_*` gesetzt, landet jeder Tag-Push in TestFlight: die
Installation auf dem Gerät passiert dann von selbst, und niemand muss mehr
etwas sideloaden. Ohne sie entsteht eine signierte Datei am Release; ohne
Zertifikat bleibt es bei der unsignierten plus Sideloading.

Signiert ausliefern ginge nur mit einem hinterlegten Zertifikat — das ist
bewusst nichts, was hier im öffentlichen Repository liegt: es wäre der
Schlüssel eines einzelnen Entwicklerkontos, und jede daraus entstandene
Installation hinge an dessen Laufzeit.

## Was in der Hülle steckt

* `www/index.html` — die Einrichtungsseite. Sie merkt sich die Adresse im
  `localStorage` **ihrer** Herkunft (`capacitor://localhost`) und leitet beim
  nächsten Start direkt weiter. Die Weboberfläche läuft danach auf der Herkunft
  des Servers und kommt an diesen Speicher nicht heran — die Adresse steht
  also an genau einer Stelle.
* `capacitor.config.json` — `allowNavigation: ["*"]`, weil die Zieladresse die
  ist, die die Lehrkraft selbst einträgt; eine feste Liste könnte sie nicht
  kennen.
* **Server wechseln**: in Nuvora unter „Profil“ (der Eintrag erscheint nur in
  der App) — er ruft `capacitor://localhost/index.html?setup=1` auf.

## Auf das iPhone bekommen — was ein Sideloader kann und was nicht

Anders als bei Android ist eine `.ipa` **kein fertiges Paket zum Installieren**.
Android prüft beim Installieren nur, dass eine APK überhaupt signiert ist —
von wem, ist egal. iOS prüft bei **jedem Start**, ob die Signatur von einem
Zertifikat stammt, das Apple ausgestellt hat, und ob das Provisioning-Profil
dieses Gerät nennt. Eine unsignierte Datei startet deshalb nicht, egal wie sie
auf das Gerät kommt.

Ein Sideloader (**AltStore**, **Sideloadly**) installiert die Datei deshalb
nicht einfach, sondern **signiert sie im Moment der Installation mit deiner
eigenen Apple-ID neu**. Das funktioniert — mit zwei Fristen:

| Apple-ID | Gültigkeit | Grenzen |
| -------- | ---------- | ------- |
| kostenlos | **7 Tage**, danach startet die App nicht mehr | höchstens 3 selbst signierte Apps, Rechner im selben Netz zum Erneuern (AltStore macht das von allein, solange AltServer läuft) |
| Developer Program (99 €/Jahr) | **1 Jahr** | keine praktische Grenze; zusätzlich TestFlight möglich (Installation und Updates ohne Rechner) |

Die Datei, die beide Werkzeuge erwarten, ist genau die, die
`scripts/ios-bauen.sh` und die Release-Pipeline erzeugen — dort ist also nichts
weiter zu tun. Was der Sideloader danach macht, kann kein Skript abnehmen: die
Signatur gehört zur Apple-ID des Geräts.

**Und die Alternative ohne all das:** Nuvora im Safari öffnen, *Teilen* → *Zum
Home-Bildschirm*. Offline lesen und schreiben kommen vom Service Worker und der
Outbox, also aus derselben Quelle wie in der App — Bedingung ist eine
**https**-Adresse. Über `http://192.168.x.y:8090` gibt es im Safari gar keinen
Service Worker, und damit kein Offline.

## Was hier NICHT hineingehört

Kein Modul im `REGISTRY`, keine eigene Anmeldung, keine eigenen Daten. Alles,
was die App kann, kann die Weboberfläche; sie ist nur das Fenster darum. Wer
hier eine Funktion einbaut, die es im Web nicht gibt, hat einen zweiten
Code-Pfad geschaffen — genau das, was die Desktop-Hülle bewusst vermeidet.
