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

## Einmal einrichten (auf einem Mac mit Xcode)

```bash
cd apps/ios
npm install
npx cap add ios       # erzeugt das Xcode-Projekt unter apps/ios/ios
npx cap sync ios
npx cap open ios      # Xcode: Signierung auswählen, auf Gerät starten
```

`npx cap add ios` braucht **CocoaPods** (`brew install cocoapods`) und lädt
beim ersten Mal die iOS-Abhängigkeiten. Das erzeugte Verzeichnis `ios/` ist
Teil des Projekts und darf eingecheckt werden; hier liegt es bewusst noch
nicht, weil es ohne Xcode auf dem Rechner nicht entsteht.

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

## Was hier NICHT hineingehört

Kein Modul im `REGISTRY`, keine eigene Anmeldung, keine eigenen Daten. Alles,
was die App kann, kann die Weboberfläche; sie ist nur das Fenster darum. Wer
hier eine Funktion einbaut, die es im Web nicht gibt, hat einen zweiten
Code-Pfad geschaffen — genau das, was die Desktop-Hülle bewusst vermeidet.
