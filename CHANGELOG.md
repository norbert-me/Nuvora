# Änderungen

Was in jeder Fassung dazugekommen ist — **eine Zeile je Änderung**, in der
Sprache der Oberfläche. Keine Begründungen: eine Fassung, die man in einer
halben Minute überfliegt, wird gelesen; drei Absätze je Punkt nicht, und bei
einer Zwischenfassung stehen zehn solcher Abschnitte untereinander.
Die technischen Begründungen stehen in [CLAUDE.md](CLAUDE.md), die
Entwicklungsgeschichte in `git log`.

Die Release-Notiz auf GitHub entsteht aus **genau einem** dieser Abschnitte —
dem der Fassung, um die es geht. Eine Zeit lang hängte die Notiz einer
Zwischenfassung (x.y.0) alle Abschnitte der vorigen Reihe an, damit sie nicht
dünner ausfällt als die der Zwischenschritte. Das war falsch: „Neu in 4.3.0"
muss aufzählen, was in 4.3.0 neu ist. Wer 4.1.x übersprungen hat, findet die
Notizen dieser Fassungen weiter unten — jede an ihrer Stelle, und keine zweimal.

## Unveröffentlicht

**Offline und schlechtes Netz**

- Bei langsamer Verbindung zeigen Listen nach kurzer Wartezeit den zuletzt
  geladenen Stand, statt leer zu bleiben; die frische Antwort kommt nach.
- Die Desktop-App lädt zusätzlich die Daten je Kurs vor.
- Änderungen aus dem Offline-Betrieb überschreiben keinen neueren Stand mehr
  still: passt beides nicht zusammen, entscheidet Nuvora zugunsten der neueren
  Änderung — und fragt nur, wenn inzwischen wirklich woanders gearbeitet wurde.

**Bedienung**

- Kalender, Tagesansicht: eine Linie zeigt die aktuelle Uhrzeit (im
  Viertelstundentakt).
- Die Teile eines Moduls stehen nur noch im Profil — im Zahnrad der Modulseite
  standen dieselben Schalter ein zweites Mal.
- Der Kurs verlinkt auf „Karteikarten" statt auf „Karten".
- Sitzplan: wer heute fehlt, verspätet oder entschuldigt ist, steht am Platz.
  Ein Klick auf ein Kind schreibt eine Bemerkung ins Notenbuch. Gelöscht wird
  ein Platz, indem man ihn auf den Mülleimer zieht, der beim Ziehen erscheint.
- Fehler melden: ein angehängtes Bild wird im Dialog gezeigt.
- Tafel: mehrere Tafeln lassen sich unter einem Namen speichern und wieder
  öffnen — sie hängen am Konto, nicht am Browser.
- Tafel im Vollbild: der Schließen-Knopf steht wieder vollständig im Bild.
- Notenbuch: fehlende Kinder werden auch dann an der Spalte markiert, wenn der
  Kurs aus mehreren Fach-Klassen besteht.

- Der Speichern-Knopf bleibt am Bildschirm: scrollt er aus dem Bild, während
  etwas offen ist, erscheint er unten.
- Kurs: das Schuljahr wird ausgewählt, „andere …" legt ein neues an.
- Kurs und Thema: das Feld „Jahrgang" ist weg — das Schuljahr sagt es bereits.
- Profil: die Schalter unter „Teile der Module" stehen in einer Spalte; die
  Checklisten in Orga lassen sich jetzt ebenfalls ausblenden.
- Person: ein vorhandenes Foto lässt sich neu zuschneiden, ohne es noch einmal
  auszuwählen. Die Klassenleitung steht wieder im Dialog, und der Platzhalter
  der Notiz schlägt keinen Nachteilsausgleich mehr vor — der gehört an den
  Kurs, damit er bei Klassenarbeiten erscheint.
- Kurs bearbeiten: ein Klick auf ein Kind öffnet seine Angaben — Niveau,
  Förderschwerpunkt und der Nachteilsausgleich für diesen Kurs an einer Stelle.
  Die beiden eigenen Listen darunter sind weg; die Kinderliste zeigt „NTA" und
  E/G als Merkzeichen. Umbenannt wird mit dem Stift.
- WebUntis-Import: fehlende Kurse schlägt der Dialog zum Anlegen vor („Mathe 7.5"),
  Fach und Jahrgang kommen mit.
- Fördermaßnahmen: der Knopf heißt wieder „+ Maßnahme" statt „+ + Maßnahme".

**Notenbuch**

- „Vergleichen" ist aus dem Spaltenmenü verschwunden: es war für Klassenarbeiten
  gedacht und stand trotzdem an jeder Spalte. Klassenarbeiten haben ihren
  Vergleich als eigene Seite; was eine einzelne Spalte hergibt, steht unter
  „Details".
- Ein Kommentar an einer Note lässt sich per Rechtsklick oder langem Druck auf
  die Zelle schreiben — nicht mehr nur über die kleine Ecke.
- Das Thema einer Spalte schlägt sich aus dem Kalendereintrag des Tages vor.
- Der Wechsel von Halbjahr, Klasse oder Kurs fragt nicht mehr erneut nach
  Änderungen, die man vorher aufgegeben hat.

## 4.3.1 — 07.09.2026

**Kalender und Tafel**

- Der Verlaufsplan eines Kalendereintrags zeigt zu jeder Phase die Uhrzeit und
  über der Liste die Summe gegen die Länge der Stunde.
- Neues Tafel-Feld: der Verlaufsplan der laufenden Stunde, die aktuelle Phase
  hervorgehoben, daneben die Restzeit.
- Die Startseiten-Kachel „Heute" zeigt nur noch, was noch kommt.

**Auswertung**

- CardVote: „bei dem Thema gefehlt" je Kind — dessen Fragen zählen nicht zur
  Basis, richtige Antworten geben Bonus (höchstens eine Notenstufe), Abzüge
  greifen dort nicht. Vorschlag aus der Anwesenheit, entschieden wird per Haken.
- Notenbuch: wer am Tag der Spalte gefehlt hat oder zu spät kam, ist in der
  Spalte farbig markiert.

**Lernpfad und Unterricht**

- Im automatischen Entwurf bekommen E- und G-Kinder dieselben Aufgaben; E-Kinder
  zusätzlich die E-Aufgaben.
- Die Zahl der vorangestellten Wiederholungsaufgaben ist einstellbar (0 = keine).
- Eine aus einer Klassenarbeit erzeugte Wiederholungsaufgabe verlinkt die Arbeit.
- Anwesenheit: eine ohne Stunde erfasste Verspätung gilt jetzt auch in den
  Folgestunden.
- Kalender: das Plus des Verlaufsplans steht unter der Liste; Fehlermeldungen
  nennen, welche Verknüpfung klemmt.
- PAP: „Hinzufügen" sagt, was fehlt, statt nichts zu tun.

**Schulnetz und Apps**

- Weniger Datenverkehr: alte Schriftfassungen werden nicht mehr vorgeladen
  (2,7 statt 3,7 MB), und auf langsamer Verbindung lädt Nuvora nur, was gerade
  gebraucht wird. Dazu ein Schalter „Datensparen" im Profil.
- Die Desktop-App sagt, wenn eine neuere Fassung bereitsteht — mit Ladeknopf,
  wegklickbar je Fassung.

**Personen und Kurse**

- Die Personenseite zeigt Angaben, Förderbedarf, Noten beider Halbjahre je Kurs,
  Fehlzeiten und Verspätungen sowie den QR-Zugang; Foto und Name sind dort
  änderbar, Kinder lassen sich anlegen und Kursen zuweisen, und die
  Nachteilsausgleiche eines Kurses sind dort einstellbar.
- Kurse haben kein Klassen-Feld mehr; Kinder werden über eine Personensuche
  hinzugefügt. Der Jahrgang darf jetzt „7/8" heißen.
- Die Liste der E/G-Zuordnungen erscheint nur noch, wenn E/G im Kurs an ist.
- Archivieren wirkt sofort und wartet nicht mehr auf „Speichern".
- Die Begrüßung auf der Startseite ist weg.

**Kalender und Orga**

- Eine Klassenarbeit kann die Stunde im Stundenplan ersetzen — der Unterricht
  entfällt an dem Tag.
- Aus dem Kalendereintrag führen zwei Wege in die Orga der Klasse (Anwesenheit,
  Checkliste).
- In der Checkliste löscht ein Klick auf den Spaltenkopf die Spalte; der
  Mülleimer je Spalte ist weg.
- Die Stundenwahl der Anwesenheit zeigt jede Stunde nur noch einmal.
- Die CalDAV-Angaben stehen mit der Beschriftung über dem Feld — „Serveradresse"
  passte daneben nicht mehr hin.

**Zeitleiste**

- Ohne eingetragenes Schuljahr sagt die Zeitleiste, warum die Halbjahrs-Wahl
  nichts ändert — mit dem Weg ins Profil.

**Startseite und Sitzplan**

- Ein Klick auf die Stunde öffnet ihren Kalendereintrag statt der Anwesenheit.
- Sitzplan: Ziehen auf dem iPhone reißt nicht mehr mitten in der Bewegung ab.

**Fehler melden**

- Die Kennung des Browsers geht nur noch mit, wenn „Technische Angaben
  mitschicken" angehakt ist.
- In der Übersicht der Administration ist zu sehen, welche Meldung einen Anhang
  hat; Bilder stehen direkt als Bild darin.

**Kleinigkeiten**

- Die Datei-Vorschau hat ein Schließkreuz.
- Der Erklärtext über den externen Kalendern ist weg.

## 4.3.0 — 08.09.2026

**Auswertung und Profil**

- Die CardVote-Auswertung geht nach Kurs statt nach Klasse — und wahlweise
  nach Person, mit Suchfeld.
- Alle abschaltbaren Teile der eingeschalteten Module stehen zusätzlich im
  Profil, an einer Stelle.

**Fehler melden**

- Meldungen werden gespeichert statt gemailt. Die Administration sieht im
  Profil alle Meldungen mit Absender, kann sie löschen, den Anhang öffnen und
  das Melden ganz abschalten.
- Keine Begrenzung mehr, wie oft gemeldet werden darf.
- Der Melde-Dialog ist kürzer: kein Einleitungssatz, größeres Textfeld,
  „Was wird mitgeschickt?" und „Datei anhängen" in einer Zeile, und nach dem
  Absenden steht nur noch „Danke!".
- Der Hinweis auf Rückmeldungen in der Fußzeile ist weg — er führte über das
  Kontaktformular an Protokoll und Umgebung vorbei.

**Kern: die Person**

- „Klassen" ist aus der Navigation verschwunden: Kinder werden im Kurs
  gepflegt, ein einzelnes Kind findest du unter „Personen". Die Seite bleibt
  erreichbar, solange es Bestandsklassen gibt.
- Ein Kind gibt es jetzt einmal — auch wenn es in mehreren Kursen sitzt.
  Name, Foto, Niveau, Förderangaben und Zugang hängen an der Person, nicht
  mehr an jeder einzelnen Liste. Bestehende Daten wandern beim Start mit,
  es geht nichts verloren.
- Neue Seite „Personen": jedes Kind einmal, mit seinen Kursen und dem
  Themenstand je Kurs nebeneinander.
- Die Kinder eines Kurses werden im Kurs gepflegt: anlegen, umbenennen,
  sortieren, Foto, Angaben, entfernen — ohne den Umweg über die
  Klassenmaske. Eine Namensliste füllt den Kurs in einem Zug.
- Foto und Name gehören jetzt dem Kind, nicht mehr jeder einzelnen Liste.
- Ein Kurs lässt sich „aus einem anderen entwickeln" — seine Kinder kommen
  mit, Noten und Karten bleiben beim alten Kurs.

**Kalender**

- Die Zeitleiste zeigt das Datum rechts (links staute sich auf dem Handy
  alles Übrige), schreibt „1. Stunde" aus, und ein Klick darauf führt in den
  Tag, wo die Stunde geplant wird.
- Lange Auswahllisten (Thema, Einstieg, Quiz, Kartenstapel, Lernleiter) haben
  ein Suchfeld — tippen statt scrollen. Kurze Listen bleiben, wie sie waren.
- Wischen nach links oder rechts blättert Tag, Woche und Monat.
- Trägt ein Eintrag einen anderen Kurs als die Stundenplan-Vorlage, zeigt der
  Tag jetzt den des Eintrags — vorher stand im Kalender „7.5 LZ" und im
  geöffneten Eintrag „7.5 GA".
- Kurze Stunden (etwa eine 0. Stunde über zehn Minuten) legen sich nicht mehr
  über die nächste: nebeneinander gestellt wird, was sich als Kasten
  überlappt, nicht nur, was sich zeitlich überschneidet.
- Wird der Kurs einer Stundenplan-Stunde gewechselt, heißt sie danach auch so.
  Die Auswahl sprang bisher auf den alten Kurs zurück.
- Der Dialog heißt „Neuer Eintrag", solange es noch keinen gibt — vorher stand
  „Eintrag bearbeiten" über leeren Feldern, und der fehlende Papierkorb wirkte
  wie ein Fehler.
- Beim Anlegen aus einer Stunde steht der Kurs im Kopf, wie in der Ansicht.

**Klassen**

- Die Klassenmaske hat nur noch einen Ausgang: die Überschrift. Der zweite
  „Abbrechen"-Knopf neben „Speichern" ist weg.
- Der Satz zur CardVote-Grenze steht nicht mehr unter jeder Klasse, sondern
  nur noch, wenn sie erreicht ist.
- Der Hinweis „Reihenfolge = Kartennummer" erscheint erst, wenn wirklich
  umsortiert wurde.
- QR-Zugang und CardVote-Abstimmkarte werden klar auseinandergehalten: der
  Menüpunkt heißt „QR-Zugänge drucken (je Kind einer)" und sagt auf
  Nachfrage, wofür er ist und was er nicht ist.

## 4.2.0 — 06.09.2026

**Karteikarten**

- Ein Stapel lässt sich im Ausrollen-Menü direkt einem oder mehreren Kursen
  zuweisen — die Planung im Kalender bleibt, ist aber nicht mehr der einzige
  Weg. Ein Stapel für die AG hängt an keiner einzelnen Stunde.

**Module**

- Jedes Modul mit unabhängigen Teilen lässt sie einzeln ein- und ausblenden:
  Notenbuch und Klassenarbeiten, Sitzplan/Anwesenheit/Ausleihe, Notizzettel
  und Aufgaben, Stundenplan/Zeitleiste/freie Zeiträume, Karten-Fortschritt.
  Ausgeblendetes verschwindet aus Navigation, Suche und Startseiten-Kachel.
- Orgas eigener Reiter „Optionen" ist weg — er machte, was jetzt das Zahnrad
  jedes Moduls macht, und stand als vermeintlicher Inhalt in der Suche.
- Der Vergleich der Klassenarbeiten steht immer in der Navigation, nicht mehr
  nur neben den Arbeiten.
- Schülerfotos lassen sich beim Zuschneiden herauszoomen; der Rand wird
  schwarz, statt das Gesicht abzuschneiden.
- Die abschaltbaren Teile eines Moduls (z. B. SEGEL-Stufen) stellst du jetzt
  im Modul selbst ein — im Zahnrad neben den übrigen Ansichts-Schaltern,
  nicht mehr in der Modulauswahl.

**Neues Modul: PAP-Editor**

- Doppelklick auf ein Symbol öffnet die Beschriftung als Popup.
- Verbindungen lassen sich anklicken, beschriften und löschen; der
  Verbinden-Modus sagt unter dem Blatt, was er gerade will.
- Ein neues Symbol hängt sich unter das gewählte und wird gleich verbunden.
- Neuer Link zum freien Editor ohne Anmeldung (/pap-frei) zum Austeilen —
  daneben steht, wie der überwachte Weg über den QR-Zugang läuft.
- Die Palette zeigt die Symbole in ihrer Form, nicht als Textknöpfe.
- Symbole wachsen mit ihrer Beschriftung, statt sie abzuschneiden.
- Verbinden ist ein Modus: einschalten, Start und Ziel anklicken.
- Ein Raster lässt sich ein- und ausschalten; Kommentare gibt es dazu.
- Die Reiter stehen in der Navigation; „Neues Blatt" heißt jetzt
  „Alles löschen" und fragt nach.
- Programmablaufpläne zeichnen (Start/Ende, Anweisung, Verzweigung, Ein- und
  Ausgabe, Unterprogramm), verbinden, verschieben, drucken.
- Zwei Wege: frei zeichnen ohne Konto und ohne Zuordnung — oder als Aufgabe,
  die die Kinder über ihren QR-Zugang öffnen und abgeben.
- Die Abgabenliste zeigt auch, wer noch nichts gezeichnet hat.

**Notizbrett**

- Eine Aufgabe am unteren Rand rutscht beim Bearbeiten oder Aufklappen der
  Notiz ins Bild — vorher tippte man in ein Feld, das man nicht sah.

**Konto und Zugänge**

- Nach einem Update zeigt Nuvora beim nächsten Anmelden, was neu ist.
- Im Profil steht „App laden": die Desktop-App für macOS lässt sich direkt
  herunterladen. Windows, Linux, Android und iPhone stehen schon in der Liste
  und sagen, dass sie in Vorbereitung sind.

**Kalender**

- Externe Kalender und der WebUntis-Abo-Link lassen sich wieder abrufen, wenn
  der Anbieter weiterleitet (Apple, Google und WebUntis tun das häufig).
- WebUntis-Zeiten in UTC werden umgerechnet — sonst landeten die Stunden auf
  der falschen Stundennummer oder der Import blieb leer.
- Neuer Knopf „Wo finde ich die Adresse meines Kalenders?" — der Weg dorthin
  für Apple, Google, WebUntis und Outlook, Schritt für Schritt.
- Das Tutorial erklärt den Kalender in beide Richtungen: fremde Kalender
  einblenden, Stundenplan aus WebUntis holen, Nuvora ins Handy bringen.

## 4.1.8 — 05.09.2026

**Startseite und Kalender**

- Die Einrichtung der Startseite und die Start-Ansicht des Kalenders hängen am
  Konto statt am Browser — am zweiten Gerät stand sonst wieder der alte Stand.

**Konto und Zugänge**

- Links, die aus dem Haus gehen (Bestätigungsmail, QR-Zettel, Kalender-Abo,
  CalDAV-Profil, Code-Detektiv-Beitritt), tragen jetzt immer die öffentliche
  Adresse der Installation — nicht mehr die, über die man gerade zugreift.
- Die Anmeldemaske heißt „Nuvora", nicht mehr „CardVote".

**Kalender**

- Der Stundenplan kennt eine 0. Stunde — eine Zeile vor der ersten, mit
  eigener Uhrzeit. Die Nummern der übrigen Stunden bleiben, wie sie waren.
- Der Raum lässt sich für eine einzelne Stundenplan-Stunde setzen oder mit
  einem Häkchen für alle Stunden des Kurses.
- Der Eintrag-Dialog nennt im Kopf die Uhrzeit der Stunde — „2. Stunde" allein
  sagt nicht, wann sie ist. Der Hinweis unter den Zeitfeldern ist dafür weg.
- Neuer Reiter „Zeitleiste": der Kurs von oben nach unten — Unterrichtsstunden,
  Themen, Freischaltungen (Quiz, Karten, Lernleiter, Rätsel) und
  Klassenarbeiten auf einer Achse.
- Der Stoffverteilungsplan ist entfernt; was unterrichtet wird, steht am
  Kalendereintrag und erscheint auf der Zeitleiste.

**Sitzplan**

- Der Plan lässt sich in jede Richtung erweitern; die Fläche wächst mit dem,
  was darauf steht. Vorher hingen die Tische am Rand „wie an einer Wand".
  Nach links und oben sieht man den Tisch jetzt schon beim Ziehen an seinem
  Platz, statt erst beim Loslassen.
- Das Foto füllt die Höhe des Platzes; der Name steht darunter über die ganze
  Breite. Alle Plätze sind gleich groß, egal ob mit Foto oder ohne.
- Der Dreh-Griff sitzt wieder in der Ecke oben rechts.
- „Einpassen" rechnet mit einem festen Rand statt mit 30 % Zuschlag — der Plan
  stand sonst winzig in der Mitte.
- Ein Tisch ließ sich am Foto nicht ziehen — der Browser nahm stattdessen das
  Bild mit.

**Klassen**

- Ein vorhandenes Foto lässt sich neu zuschneiden, ohne die Datei erneut zu
  suchen.
- Ein Klick auf „Klassen" in der Navigation schließt die Bearbeiten-Maske.

- Ein Klassenfoto wird beim Hinzufügen quadratisch zugeschnitten; verschieben
  und zoomen geht im Dialog.
- Im Sitzplan sind die Fotos größer und eckig.
- Ein Klick auf die Überschrift führt zurück zur Klassenliste.

**Dateien**

- Hochladen zeigt einen Fortschrittsbalken (Material, Klassenfotos).

**Notizbrett**

- Die Aufgabenliste steht mittig, auch im Notizbrett.
- Eine Aufgabe kann eine Notiz für längeren Text tragen; in der Liste klappt
  sie auf Klick auf.
- Was heute fällig ist, steht rot (vorher gelb wie „demnächst").
- Der Kalender-Knopf trägt sofort das heutige Datum ein und öffnet die Auswahl.

## 4.1.7 — 01.09.2026

**Orga**

- Der Sitzplan stürzte beim Öffnen ab („Can't find variable: abs") — ein Rest
  der entfernten Aufruf-Ansicht.

**Sicherheit**

- Die Content-Security-Policy verbietet Inline-Javascript (`script-src` ohne
  `unsafe-inline`) und erlaubt nur noch, was ausdrücklich dasteht
  (`default-src 'none'`, `object-src 'none'`).
- Neue Schutz-Kopfzeilen: HSTS (nur über https), X-Permitted-Cross-Domain-
  Policies, Cross-Origin-Resource-/Opener-/Embedder-Policy.

**Module**

- Das Notizbrett ist nicht mehr „beta".

**Notizbrett**

- Ein Fälligkeitsdatum aus einem anderen Jahr trägt die Jahreszahl.
- Eine neue Aufgabe steht oben in der Liste, nicht unten.

**Fehlermeldung**

- Der Melde-Knopf ist auf großen Bildschirmen ein Viertel größer.

- An eine Meldung lässt sich eine Datei anhängen (Screenshot, Export, PDF) —
  selbst ausgewählt, bis 3 MB. Protokoll und Umgebung bleiben inhaltsfrei.

**Startseite**

- Die Kachel „Heute" zeigte entfallene Stunden weiter an und ließ bei Terminen
  ohne Stundenplan-Stunde die Uhrzeit weg. Auch die Zeiten der Stunden fehlten.

**Kalender**

- Der Klick auf eine Aufgabe führt zu genau dieser Aufgabe, nicht nur in die
  Liste.
- Die gewählte Startansicht (Monat/Woche/Tag) wirkt wieder: sie galt nur ohne
  Ansichts-Parameter in der Adresse, und der blieb nach jedem Reiterklick stehen.
- Die Aufgabe „… korrigieren" heißt nach der Notiz der Klassenarbeit (sonst
  nach ihrem Titel) und zieht bei Änderungen mit. Ein selbst umformulierter
  Text bleibt unberührt.

**Noten**

- Der Klick auf einen Namen zeigt E-/G-Kurs, Förderschwerpunkte, Maßnahmen und
  Notiz — und lässt sie dort auch ändern. Vorher lag E/G im Kurs und der
  Förderschwerpunkt in der Klasse, und im Notenbuch stand nichts davon.

**Kurse**

- Die E/G-Zuordnung stand am rechten Rand ihrer Spalte, also direkt vor dem
  nächsten Namen. Jetzt steht sie vor dem eigenen Namen, mit Trennlinie
  zwischen den Spalten.
- Der Jahrgang wird ausgewählt statt getippt; „andere …" legt einen neuen an.

## 4.1.6 — 01.09.2026

**Module**

- Das Modul „Auswertung" heißt „Noten".

**Konto**

- Die geführte Tour merkt sich am Konto, dass sie gelaufen ist — sie startete
  auf jedem Gerät neu, auf dem Handy immer wieder.

**Kalender**

- Der Kalender hat eine Suche (Lupe): Titel, Notiz, Ort und Kurs über den
  ganzen Zeitraum, auch in abonnierten Kalendern — ein Klick auf einen Treffer
  springt zum Tag und öffnet ihn.
- Termine über mehrere Tage: ein Eintrag mit „bis"-Datum, im Monat als
  durchgehender Balken, in der Woche mit Pfeilen an den Rändern. Aus Apple und
  Outlook kommen mehrtägige Termine jetzt an, statt abgelehnt zu werden.
- Die Datumseingabe in der Tagesansicht konnte die Seite beim Tippen im
  Jahresfeld abstürzen lassen.

**Noten**

- Eine Beobachtung braucht keine Spalte mehr; ohne Bewertungsstruktur steht die
  Namensliste mit dem Beobachtungs-Knopf da.
- Der „Vergleich" steht bei den Klassenarbeiten statt neben dem Notenbuch.

**Kurse**

- Der Sprung aus einem Kurs ins Notenbuch (Sitzplan, Orga, Klassenarbeit) zeigte
  den falschen Kurs, wenn zwei Kurse dieselbe Klasse haben.

**Lernpfad**

- Die Lernleiter lässt sich als A5 quer ausdrucken (A4 war für eine kurze Leiter
  halb leer; zwei A5 passen auf ein Blatt). Das Format steht neben den
  PDF-Knöpfen und wird gemerkt. Auf dem flachen Blatt sitzen die Zeilen enger,
  damit die Leiter auf eine Seite passt.
- Ein offener Lernpfad zeigte nach dem Anlegen einer Lernleiter im Generator die
  neue Lernleiter erst nach dem Neuladen.
- Die Unterthema-Auswahl im Generator war anders groß als die Felder daneben.

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

**Aufgaben**

- Das Fälligkeitsdatum trägt eine Ampel: vorbei rot, innerhalb einer Woche gelb,
  sonst blau.

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
