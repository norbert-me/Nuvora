# Änderungen

Was in jeder Fassung dazugekommen ist — **eine Zeile je Änderung**, in der
Sprache der Oberfläche. Keine Begründungen: eine Fassung, die man in einer
halben Minute überfliegt, wird gelesen; drei Absätze je Punkt nicht, und bei
einer Zwischenfassung stehen zehn solcher Abschnitte untereinander.
Die technischen Begründungen stehen in [CLAUDE.md](CLAUDE.md), die
Entwicklungsgeschichte in `git log`.

Die Release-Notiz auf GitHub entsteht aus diesen Abschnitten. Bei einer neuen
Zwischenfassung (x.y.0) hängt sie **alle Abschnitte der vorigen Reihe** an: wer
von 4.1.0 auf 4.2.0 geht, hat 4.1.1 bis 4.1.9 nie gesehen — sonst wäre die
Notiz zur größten Fassung die dünnste.

## 4.1.5 — 31.08.2026

**Module**

- Das Modul „Unterrichtsplanung" heißt „Einstiege".

**Kalender**

- Der Raum lässt sich im Stundenplan eintragen.
- Klassenarbeiten haben ein Suchfeld und einen Kurs-Filter.
- Ein Quiz aus einem Ordner ließ sich nicht an eine Stunde hängen („Verknüpfter
  Eintrag nicht gefunden").

**Noten**

- Die Übernahme eines CardVote-Tests bot Abschnitte fremder Fächer an; die
  Spalte landete im falschen Notenbuch.
- Eine Beobachtung lässt sich anlegen, ohne vorher eine Spalte zu bauen.
- Der Satz „Der Gesamtschnitt ist eine Rechenhilfe" unter der Tabelle ist weg.

**CardVote**

- Eine gelöschte Auswertung führt auf die Startseite statt auf
  „Verbindungsfehler".

**Lernpfad**

- Lernpfade lassen sich umbenennen.
- Eine Lernleiter zeigte im Reiter „Lernpfade" einen fremden Kurs an.

## 4.1.4 — 31.08.2026

**Kurse**

- Ein Kurs kann einen Stammraum tragen.

**Kalender**

- Der Raum des Kurses steht als Ort am Termin — im Abo und im CalDAV-Kalender.
- Zeit und Raum lassen sich für eine einzelne Stundenplan-Stunde anpassen; der
  Termin zeigt jetzt auch die Uhrzeit der Stunde.
- Der Termin nennt die Art der Wiederholung statt nur „wiederholt sich".
- Die Startansicht (Monat/Woche/Tag) ist einstellbar.
- Abonnierte Kalender bekommen verschiedene Farben statt alle dasselbe Grau.
- Klassenarbeiten lassen sich nach Fach sortieren, tragen eine Notiz und nennen
  die Kalenderwoche.

**Stundenplan**

- Die Stundenzahl sitzt senkrecht mittig.

**Stoffverteilungsplan**

- Der ganze Plan lässt sich in einem Zug verwerfen.

**Karteikarten**

- Der QR-Reiter stürzte ab und zeigte nur noch „Diese Seite konnte nicht geladen
  werden".

**Lernpfad**

- Lernleiter-PDF: der Titel läuft nicht mehr rechts aus dem Blatt.
- Lernleiter-PDF: der QR-Code der Karten-App ist voreingestellt angehakt.
- Lernleiter-PDF: Smileys stehen an allen Aufgaben außer Erklärungen.
- Lernleiter-PDF: Kästchen, Smileys und Text sitzen auf einer Mitte; der
  Trennstrich liegt genau zwischen den Zeilen.

**CardVote**

- Der Abschnitt „Schwache Themen" ist weggefallen — seine beiden Knöpfe legten
  etwas Leeres an, und die Themen-Analyse darüber sagt dasselbe.
- Themen-Analyse: der Satz, der die Liste darunter noch einmal vorlas, ist weg.

**Karten-App (Schülerseite)**

- „Das üben wir noch" heißt jetzt „Das musst du noch üben".

**Startseite**

- „Offene Aufgaben" führt zum Aufgaben-Reiter statt auf die Notizzettel.

## 4.1.3 — 30.08.2026

**Kalender**

- Fremde (abonnierte) Termine gehen auf Wunsch im Abo und im CalDAV-Kalender mit
  hinaus. Schalter im Teilen-Dialog, aus als Vorgabe.
- Einen fremden Termin im Handy löschen blendet ihn in Nuvora aus.
- Über dem Kalender steht, was im gezeigten Zeitraum ausgeblendet ist — ein Klick
  holt es zurück.
- Freie Tage: Kommende / Vergangene / Alle.

**CalDAV**

- iPhone und iPad richten sich per Konfigurationsprofil ein, statt alles
  abzutippen.

**Oberfläche**

- Kein waagerechtes Scrollen mehr auf Kontakt, Anmelden und Passwort; die
  Formularseiten sind etwas breiter.
- Ein Seitenwechsel fängt oben an.
- Tutorial steht im Profil statt in der Fußzeile.
- Weniger Erklärtext im Profil und im Melde-Dialog.
