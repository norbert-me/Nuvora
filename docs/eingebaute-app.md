# Eingebaute App (Nuvora ohne Server)

Ziel: Nuvora auf einem Mac oder Windows-Rechner betreiben, ohne Docker, Postgres
oder Proxy — ein Programm, Daten auf der eigenen Platte.

## Bauform

Ein Prozess auf `127.0.0.1`: die FastAPI-Anwendung liefert die gebaute
Weboberfläche selbst aus, die Daten liegen in **SQLite**, Konten sind sofort
bestätigt (`NUVORA_LOKAL=1`, siehe `apps/api/app/lokal.py`). Die Desktop-Hülle
(Electron) startet diesen Prozess und zeigt `http://127.0.0.1:<port>`. Der
Service-Worker läuft, weil `localhost` als sicherer Kontext gilt — Offline-Lesen
bleibt also, wie es ist.

## Etappen

1. **API lokal lauffähig** (erledigt): SQLite statt Postgres (`database.sql_vor`,
   Bestands-Migrationen für Postgres leise übersprungen, `ON CONFLICT DO NOTHING`
   ohne Constraint-Namen), `lokal.py` liefert Oberfläche und `/site.json`, Registrierung
   ohne Mailbestätigung. Test `tests/test_lokal.py`.
2. **Hülle startet den Server**: `apps/desktop/main.js` wählt einen freien Port,
   erzeugt beim ersten Start `TOKEN_SECRET` (in `userData`), setzt
   `DATABASE_URL`/`NUVORA_UPLOAD_DIR` unter `userData`, wartet auf `/api/health`
   und lädt dann die Adresse. `setup.html` bekommt die Wahl „Auf diesem Rechner“
   oder „Mit Server verbinden“.
3. **Paketieren**: API mit PyInstaller (onedir) zu einem Programm; Weboberfläche
   (`apps/web/dist`) als Ressource daneben; `electron-builder` für macOS (DMG,
   arm64 + x64) und Windows (NSIS). Windows-Build braucht einen Windows-Runner in CI.
4. **Feinschliff**: alle Module beim ersten Konto einschalten; Sicherung = Kopie
   der SQLite-Datei (Knopf im Profil); „Passwort vergessen“ ohne Mail
   (lokaler Zurücksetz-Weg); Update über die vorhandene Release-Prüfung; Selbsttest
   `--lokal`.

## Offene Entscheidungen

- **Office-Vorschau (LibreOffice)** fällt weg — 1 GB im Paket ist keine Option.
  Dateien lassen sich weiter laden, nur nicht im Browser ansehen.
- **Scanner mit dem Handy** (CardVote): die Kamera des Handys erreicht
  `127.0.0.1` des Rechners nicht, und im LAN verlangt der Browser https. Entweder
  scannt der Rechner selbst (Webcam), oder die lokale Installation bekommt ein
  selbstsigniertes Zertifikat fürs Schulnetz. Zu klären, bevor Etappe 3 fertig ist.
- **Signierung**: macOS-DMG bleibt unsigniert (wie bisher), Windows-SmartScreen
  warnt bei unsignierter Datei.
- **Mehrere Rechner**: kein Abgleich — jede lokale Installation ist für sich.
  Wer das braucht, nimmt den Server.
