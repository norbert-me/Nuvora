# Nuvora Desktop (macOS)

Native Mac-App als schlanke Hülle um die Nuvora-Weboberfläche. **Kein** eigener
Server, keine eigene Datenbank — die App öffnet deinen vorhandenen Nuvora-Server
in einem eigenen Fenster (Dock-Icon, kein Browser-Rahmen).

## Stand: Phase 0

- Fenster auf den Server; Adresse wird pro Rechner gemerkt.
- **Offline lesen:** war die App schon einmal online, bleiben die geladenen
  Daten offline sichtbar (Nuvoras Service-Worker, network-first + Cache-Fallback).
  Auch Seiten, die vorher nie geöffnet wurden, zeigen die Oberfläche statt eines
  weißen Fensters (Rückfall auf die Shell).
- Ist der Server gar nicht erreichbar, erscheint eine eigene Seite mit dem Knopf
  **Erneut verbinden** — kein leeres Fenster.
- Externe Links öffnen im Standard-Browser (nur `http`, `https`, `mailto`).

**Noch nicht:** offline **schreiben** und synchronisieren (Phase 1 — Outbox +
Auto-Sync bei Verbindung).

## Voraussetzungen

- **macOS 12 (Monterey) oder neuer** — Electron 43 (Chromium 150) unterstützt
  nichts Älteres.
- **Node 22.12 oder neuer** zum Bauen (verlangt Electron per `engines`).

### Server-Adresse über `http://` (z. B. IP im Schulnetz)

Ein Service-Worker — und damit das Offline-Lesen — läuft im Browser nur in einem
sicheren Kontext (`https` oder `localhost`). Läuft dein Nuvora unter `http://`
auf einer IP, erlaubt die App **genau diese eine, von dir eingetragene Adresse**
ausdrücklich als sicher (Chromium-Schalter
`unsafely-treat-insecure-origin-as-secure`, siehe Kommentar in `main.js`). Bei
`https://`-Adressen passiert das nicht.

Der Schalter wird beim **Start** gesetzt: änderst du die Adresse über das Menü
**Server**, ist das Offline-Lesen erst nach einem Neustart der App aktiv — die
App weist an dieser Stelle darauf hin.

## Ausprobieren (Entwicklungsmodus)

```bash
cd apps/desktop
npm install
NUVORA_URL=http://192.168.10.75:8080 npm start
```

Seit Electron 42 lädt `npm install` die Electron-Binärdatei **nicht** mehr per
`postinstall` (Härtung gegen Lieferketten-Angriffe); sie kommt beim ersten
`npm start` bzw. beim ersten Bau. Der erste Lauf braucht also Netz.

Ohne `NUVORA_URL` fragt die App beim ersten Start nach der Server-Adresse und
merkt sie sich (Menü **Server → Server-Adresse ändern…** zum Ändern).

## Als .app / .dmg bauen

```bash
cd apps/desktop
npm install
npm run dist        # erzeugt eine .dmg unter apps/desktop/dist/
# oder ohne Installer, nur die .app:
npm run pack        # apps/desktop/dist/mac*/Nuvora.app
```

Die App ist **nicht signiert/notarisiert** — für den eigenen Rechner reicht das
(beim ersten Öffnen ggf. Rechtsklick → „Öffnen"). Für Verteilung an andere
bräuchte es ein Apple-Developer-Zertifikat + Notarisierung.

## Architektur-Hinweis

Die App liegt bewusst in `apps/desktop` und ist **kein** Plattform-Modul (kein
ModuleGate, kein Backend). Sie ist ein Client wie der Browser — nur nativ
verpackt. Nichts am Kern oder an den Modulen hängt davon ab.
