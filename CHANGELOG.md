# Änderungen

Was in jeder Fassung dazugekommen ist — kurz, in der Sprache der Oberfläche.
Die technischen Begründungen stehen in [CLAUDE.md](CLAUDE.md), die
Entwicklungsgeschichte in `git log`.

## 4.1.3 — 30.08.2026

**Kalender**

- Termine aus abonnierten fremden Kalendern gehen auf Wunsch im eigenen Export
  mit hinaus — im Abo und im CalDAV-Kalender. Der Schalter steht im Teilen-Dialog
  bei den externen Kalendern und ist **aus**: wer seinen iCloud-Kalender in
  Nuvora einblendet und Nuvora zurück aufs selbe Handy spiegelt, sähe sonst
  jeden Termin doppelt.
- Einen fremden Termin im Handy zu löschen blendet ihn in Nuvora aus — im
  fremden Kalender bleibt er unangetastet. Ändern geht nicht: das gehört dorthin,
  wo der Termin herkommt.
- Über dem Kalender erscheint eine Zeile, wenn im gezeigten Zeitraum etwas
  ausgeblendet ist — entfallene Stunden und weggeblendete fremde Termine. Ein
  Klick zeigt sie im Popup, dort lassen sie sich zurückholen. Vorher lagen sie
  verstreut: als durchgestrichene Chips über jedem Tag und als Sammelknopf im
  Auge-Menü.
- Freie Tage lassen sich auf **Kommende / Vergangene / Alle** umschalten und
  zeigen voreingestellt nur das Kommende. Die Liste wächst mit jedem Schuljahr;
  Vergangenes ist nicht weg, es steht nur nicht mehr im Weg.

**CalDAV**

- Auf iPhone und iPad richtet ein Konfigurationsprofil das Konto ein: ein Tipp
  statt Serveradresse, Port, Pfad, Benutzername und Passwort abzutippen. Der
  Knopf erscheint direkt nach dem Anlegen eines Gerätepassworts; der Link gilt
  einmal und zehn Minuten. iOS meldet dabei „Nicht signiert“ — das ist erwartet.
- Der Teilen-Dialog läuft auf schmalen Bildschirmen nicht mehr aus dem Rand.
