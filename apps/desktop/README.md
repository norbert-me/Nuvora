# Nuvora Desktop (macOS)

Native Mac-App als schlanke Hülle um die Nuvora-Weboberfläche. **Kein** eigener
Server, keine eigene Datenbank — die App öffnet deinen vorhandenen Nuvora-Server
in einem eigenen Fenster (Dock-Icon, kein Browser-Rahmen).

## Stand: Phase 0

- Fenster auf den Server; Adresse wird pro Rechner gemerkt.
- **Offline lesen:** war die App schon einmal online, bleiben die geladenen
  Daten offline sichtbar (Nuvoras Service-Worker, network-first + Cache-Fallback).
- Externe Links öffnen im Standard-Browser.

**Noch nicht:** offline **schreiben** und synchronisieren (Phase 1 — Outbox +
Auto-Sync bei Verbindung).

## Ausprobieren (Entwicklungsmodus)

```bash
cd apps/desktop
npm install
NUVORA_URL=http://192.168.10.75:8080 npm start
```

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
