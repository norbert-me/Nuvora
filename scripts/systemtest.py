#!/usr/bin/env python3
"""Nuvora — Systemtest: jedes Modul EINZELN durchgespielt, nichts abgehakt.

Der Selbsttest (`scripts/selftest.py`) fragt: laeuft die Installation? Dieser
Test fragt: stimmt, was sie behauptet? Er beweist statt zu quittieren —
angelegte Werte werden unabhaengig neu gelesen und verglichen, Zahlen werden im
Test selbst gerechnet und gegen die des Servers gehalten.

Fuenf Ebenen:

1. **Alleinstellung** — je Modul aus dem REGISTRY: NUR dieses eine aktiv, alle
   anderen abgeschaltet. Dann muessen die Endpunkte dieses Moduls antworten und
   die Endpunkte jedes anderen mit 403 abweisen. Das ist die Regel-3-Probe:
   ohne Aktivierung nichts, und kein Modul haengt an einem anderen.
2. **Inhalt** — je Modul echte Daten schreiben, danach unabhaengig neu lesen und
   die WERTE vergleichen (nicht den Statuscode).
3. **CardVote vollstaendig** — Fragen, Quiz mit E/G, Sitzung, Scans fuer mehrere
   Kinder und Fragen, Auswertung. Trefferquote je Frage, Prozentwerte,
   E/G-Bonus und Minuspunkte werden im Test von Hand gerechnet und verglichen
   (Regeln: apps/api/app/scoring.py).
4. **Noten** — Ergebnis als Spalte uebernehmen, eine Note aendern, Beobachtung
   ergaenzen (darf nie zaehlen), Gewichte setzen, gewichteten Schnitt gegen die
   eigene Rechnung pruefen, Endnote setzen und wieder entfernen.
5. **Bruecken** — jedes Paar mit Bruecke zweimal: mit beiden Modulen muss sie
   wirken, ohne das zweite darf sie NICHTS tun (und nichts halb tun); ohne das
   besitzende Modul 403.

Alles Angelegte traegt PRAEFIX und wird am Ende hart entfernt; der
Modul-Zustand des Kontos wird wiederhergestellt. Was nicht abgeraeumt werden
konnte, steht unter "Reste".

Nutzung:
    scripts/systemtest.py --url http://127.0.0.1:8124 --email … --passwort …
    scripts/systemtest.py --json
Rueckgabewert: 0 = gruen, 1 = mindestens ein Fehler.
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

# Bausteine kommen aus dem gleichen Verzeichnis — nicht kopieren: HTTP-Client,
# Berichtsform und Farben sollen an EINER Stelle gepflegt werden. gemeinsam.py
# ist das Blatt (Client/Bericht), selftest.py und aufraeumen.py sitzen darauf.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gemeinsam import (  # noqa: E402
    Api, Bericht, Kernumgebung, melde_an, standard_argumente, FETT, AUS,
)
from aufraeumen import merke_module, vergiss_module  # noqa: E402
from selftest import raeume_reste  # noqa: E402

PRAEFIX = "ZZ-Systemtest"


class Systembericht(Bericht):
    """Der Bericht aus gemeinsam.py, nur anders unterschrieben.

    Gruppen, Farben, Zusammenfassung und JSON kommen unveraendert von dort —
    dupliziert wird nichts, nur das Wort in der Schlusszeile ausgetauscht, damit
    im Terminal nicht "Selbsttest" ueber einem Systemtest steht.
    """

    TITEL_GRUEN = "Systemtest gruen"
    TITEL_ROT = "Systemtest ROT"


# Notenschluessel wie DEFAULT_SCALE in apps/api/app/scoring.py: ab wie viel
# Prozent welche Note. Der Test rechnet damit selbst — waeren die Werte dort
# andere, faellt genau das hier auf.
SKALA = {1: 87, 2: 73, 3: 59, 4: 45, 5: 20, 6: 0}


def note_aus_prozent(pct):
    for g in (1, 2, 3, 4, 5, 6):
        if pct >= SKALA[g]:
            return g
    return 6


def naechste_stufe(pct):
    """Prozentpunkte bis zur naechstbesseren Stufe — der Deckel des E-Bonus."""
    hoeher = sorted(v for v in SKALA.values() if v > pct)
    return (hoeher[0] - pct) if hoeher else max(0.0, 100.0 - pct)


def gleich(a, b, toleranz=0.001):
    return abs(float(a) - float(b)) <= toleranz


# ─────────────────────── Testumgebung im Kern ───────────────────────

class Umgebung(Kernumgebung):
    """Klasse mit drei Kindern (E/G/G), Kurs und Thema — der Boden, auf dem
    jedes Modul arbeitet. Die Niveaus braucht die E/G-Wertung von CardVote.

    Anlegen, Merken und rueckwaerts Abraeumen stehen in `Kernumgebung`
    (gemeinsam.py); hier steht nur, WER angelegt wird.
    """

    def __init__(self, api, b):
        super().__init__(api, b, PRAEFIX)
        self.karten = [1, 2, 3]  # card_id (die aufgedruckte Nummer)
        self.namen = [f"{PRAEFIX} Anna", f"{PRAEFIX} Ben", f"{PRAEFIX} Cem"]
        self.niveaus = ["E", "G", "G"]

    def aufbauen(self):
        self._grundlage([{"card_id": c, "name": n, "niveau": v}
                         for c, n, v in zip(self.karten, self.namen, self.niveaus)])
        if len(self.students) != 3:
            raise AssertionError(f"{len(self.students)} Schueler angelegt statt 3")
        return (f"Klasse {self.class_id}, Kurs {self.kurs_id}, Thema {self.topic_id}, "
                f"Kinder {self.students} (Niveau E/G/G)")


# ─────────────────────── Was jedes Modul koennen muss ───────────────────────

def endpunkte(u):
    """Je Modul die Endpunkte, die bei aktivem Modul antworten muessen.

    Bewusst nur lesende Wege: das Schreiben prueft der Inhalts-Roundtrip weiter
    unten, hier geht es darum, dass die Route ueberhaupt lebt und nicht an einem
    anderen Modul haengt.
    """
    c, k, s, t = u.class_id, u.kurs_id, u.students[0], u.topic_id
    return {
        "cardvote": [
            ("GET", "/api/questions"),
            ("GET", "/api/folders"),
            ("GET", "/api/root-question-sets"),
            ("GET", "/api/sessions/active"),
            ("GET", "/api/sessions-list"),
            ("GET", "/api/stats/dashboard"),
            # Zeitraum ist Pflicht (frm/to) — der Wiederholungs-Vorschlag der Folgewoche.
            ("GET", f"/api/weak-topics?frm={(datetime.now() - timedelta(days=30)).isoformat()}"
                    f"&to={datetime.now().isoformat()}"),
            ("GET", "/api/weak-review"),
            ("GET", f"/api/classes/{c}/evaluation"),
        ],
        "lernpfad": [
            ("GET", "/api/lernpfad/exercises"),
            ("GET", "/api/lernpfad/paths"),
            ("GET", "/api/lernpfad/paths/trash"),
            ("GET", "/api/lernpfad/ladders/trash"),
        ],
        "auswertung": [
            ("GET", f"/api/noten/classes/{c}/students"),
            ("GET", f"/api/noten/classes/{c}/sections"),
            ("GET", f"/api/noten/classes/{c}/entries"),
            ("GET", f"/api/noten/classes/{c}/summary"),
            ("GET", f"/api/noten/classes/{c}/year"),
            ("GET", f"/api/noten/classes/{c}/dividers"),
            ("GET", f"/api/noten/classes/{c}/export"),
            ("GET", "/api/noten/code-sessions"),
            ("GET", f"/api/klassenarbeit/classes/{c}/students"),
            ("GET", f"/api/klassenarbeit/classes/{c}/works"),
        ],
        "karten": [
            ("GET", "/api/karten/decks"),
            ("GET", "/api/karten/card-folders"),
            ("GET", f"/api/karten/classes/{c}/decks"),
            ("GET", f"/api/karten/classes/{c}/all-decks"),
            ("GET", f"/api/karten/classes/{c}/decks/trash"),
            ("GET", f"/api/karten/classes/{c}/card-folders"),
            ("GET", f"/api/karten/classes/{c}/progress"),
            ("GET", f"/api/karten/classes/{c}/students/{s}/cards"),
        ],
        "kalender": [
            ("GET", "/api/kalender/entries"),
            ("GET", "/api/kalender/breaks"),
            ("GET", "/api/kalender/timetable"),
            ("GET", "/api/kalender/klassenarbeiten"),
            ("GET", "/api/kalender/klassenarbeiten/uebersicht"),
            ("GET", "/api/kalender/slot-cancellations"),
            ("GET", "/api/kalender/export"),
            ("GET", "/api/kalender/subscribe"),
            ("GET", "/api/kalender/external"),
            ("GET", f"/api/kalender/quiz-session?set_id=0&class_id={c}"),
        ],
        "orga": [
            ("GET", f"/api/orga/{c}"),
            ("GET", f"/api/anwesenheit/{c}?date={datetime.now().date().isoformat()}"),
            ("GET", f"/api/anwesenheit/{c}/summary"),
            ("GET", f"/api/anwesenheit/{c}/student/{s}"),
            ("GET", f"/api/sitzplan/{c}"),
            ("GET", f"/api/sitzplan/{c}/segel"),
            ("GET", "/api/ausleihe/items"),
            ("GET", "/api/ausleihe/loans"),
        ],
        "zufall": [
            ("GET", f"/api/zufall/{c}"),
        ],
        "unterrichtsplanung": [
            ("GET", "/api/methoden/list"),
            ("GET", "/api/methoden/folders"),
            ("GET", "/api/methoden/export"),
        ],
        "notizbrett": [
            ("GET", "/api/notizblock"),
            ("GET", "/api/todo"),
            ("GET", "/api/todo/calendar"),
        ],
        "code-detektiv": [
            ("GET", "/api/codedetektiv/puzzles"),
        ],
        # Reines Frontend, kein Backend — im Browser-Test geprueft.
        "tafel": [],
        "mathespiele": [],
    }


def tore(u):
    """Je Modul die Endpunkte, die OHNE Aktivierung 403 liefern muessen.

    Kleiner Ausschnitt der Liste oben: es geht nicht um Vollstaendigkeit,
    sondern darum, dass die Schranke am Router haengt. Wer hier 200 bekommt,
    liest Moduldaten ohne das Modul.
    """
    c, s = u.class_id, u.students[0]
    return {
        "cardvote": [("GET", "/api/questions"), ("GET", "/api/sessions-list"),
                     ("GET", "/api/folders")],
        "lernpfad": [("GET", "/api/lernpfad/exercises"), ("GET", "/api/lernpfad/paths")],
        "auswertung": [("GET", f"/api/noten/classes/{c}/sections"),
                       ("GET", f"/api/klassenarbeit/classes/{c}/works")],
        "karten": [("GET", "/api/karten/decks"),
                   ("GET", f"/api/karten/classes/{c}/decks"),
                   ("GET", f"/api/karten/classes/{c}/progress")],
        "kalender": [("GET", "/api/kalender/entries"), ("GET", "/api/kalender/timetable")],
        "orga": [("GET", f"/api/orga/{c}"), ("GET", "/api/ausleihe/items"),
                 ("GET", f"/api/sitzplan/{c}")],
        "zufall": [("GET", f"/api/zufall/{c}")],
        "unterrichtsplanung": [("GET", "/api/methoden/list"), ("GET", "/api/methoden/folders")],
        "notizbrett": [("GET", "/api/notizblock"), ("GET", "/api/todo")],
        "code-detektiv": [("GET", "/api/codedetektiv/puzzles")],
        "tafel": [],
        "mathespiele": [],
    }


# ─────────────────────── Inhalt: schreiben und wiederfinden ───────────────────────
#
# Jede dieser Proben schreibt echte Daten und liest sie DANACH unabhaengig neu
# (eigener Aufruf, eigene Liste) und vergleicht die Werte. Ein Statuscode
# beweist nichts: eine Route kann 201 melden und trotzdem nichts speichern.

def _minuten_bis(iso: str) -> float:
    """Minuten von jetzt bis zu einem ISO-Zeitpunkt (mit oder ohne Zeitzone)."""
    z = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    jetzt = datetime.now(timezone.utc) if z.tzinfo else datetime.now()
    return (z - jetzt).total_seconds() / 60


def _finde(liste, **felder):
    for e in liste or []:
        if all(e.get(k) == v for k, v in felder.items()):
            return e
    return None


def inhalt_cardvote(api, u, spuren):
    frage = api.call("POST", "/api/questions", {
        "text": f"{PRAEFIX} 7*8?", "question_type": "mc",
        "choices": {"A": "54", "B": "56", "C": "58", "D": "48"},
        "correct_answer": "B", "topic_id": u.topic_id,
    }, erwartet=(201,))
    spuren.append(("Frage", lambda: api.call("DELETE", f"/api/questions/{frage['id']}",
                                             erwartet=(204, 404))))
    gelesen = api.call("GET", f"/api/questions/{frage['id']}", erwartet=(200,))
    if gelesen["text"] != f"{PRAEFIX} 7*8?" or gelesen["correct_answer"] != "B":
        raise AssertionError(f"Frage kam anders zurueck: {gelesen}")
    if gelesen.get("topic_id") != u.topic_id:
        raise AssertionError("Thema der Frage nicht gespeichert")
    if (gelesen.get("choices") or {}).get("B") != "56":
        raise AssertionError(f"Antwortmoeglichkeiten verloren: {gelesen.get('choices')}")
    api.call("PUT", f"/api/questions/{frage['id']}", {
        "text": f"{PRAEFIX} 7*8 (neu)", "question_type": "mc",
        "choices": {"A": "54", "B": "56", "C": "58", "D": "48"},
        "correct_answer": "B", "topic_id": u.topic_id,
    }, erwartet=(200,))
    liste = api.call("GET", "/api/questions", erwartet=(200,))
    wieder = _finde(liste, id=frage["id"])
    if not wieder or wieder["text"] != f"{PRAEFIX} 7*8 (neu)":
        raise AssertionError("geaenderter Text steht nicht in der Liste")
    # Der Scanner-Weg gehoert zu CardVote und wird sonst von keiner Probe
    # beruehrt — ein stiller Ausfall faellt erst im Unterricht auf.
    scanweg = inhalt_scan_roh(api, u, spuren)
    return ("Frage geschrieben, einzeln und in der Liste mit gleichen Werten "
            f"wiedergefunden; {scanweg}")


def inhalt_lernpfad(api, u, spuren):
    aufgabe = api.call("POST", "/api/lernpfad/exercises", {
        "topic_id": u.topic_id, "aufgabentext": f"{PRAEFIX} Kuerze 12/18",
        "kategorie": "Uebung", "loesung": "2/3", "unteraufgaben": 3,
    }, erwartet=(201,))
    spuren.append(("Aufgabe", lambda: api.call(
        "DELETE", f"/api/lernpfad/exercises/{aufgabe['id']}", erwartet=(204, 404))))
    wieder = _finde(api.call("GET", f"/api/lernpfad/exercises?topic_id={u.topic_id}",
                             erwartet=(200,)), id=aufgabe["id"])
    if not wieder:
        raise AssertionError("Aufgabe nicht ueber ihr Thema auffindbar")
    for feld, soll in (("aufgabentext", f"{PRAEFIX} Kuerze 12/18"), ("loesung", "2/3"),
                       ("kategorie", "Uebung"), ("unteraufgaben", 3)):
        if wieder.get(feld) != soll:
            raise AssertionError(f"{feld}: {wieder.get(feld)!r} statt {soll!r}")

    pfad = api.call("POST", "/api/lernpfad/paths", {"name": f"{PRAEFIX} Pfad"}, erwartet=(201,))
    spuren.append(("Lernpfad", lambda: (
        api.call("DELETE", f"/api/lernpfad/paths/{pfad['id']}", erwartet=(204, 404)),
        api.call("DELETE", f"/api/lernpfad/paths/{pfad['id']}/purge", erwartet=(204, 404)))))
    leiter = api.call("POST", f"/api/lernpfad/paths/{pfad['id']}/ladders", {
        "class_id": u.class_id, "topic_id": u.topic_id, "notizen": "Notiz A",
        "assignments": [{"student_id": u.students[0], "exercise_ids": [aufgabe["id"]]}],
    }, erwartet=(201,))
    # Unabhaengig neu lesen: ueber die Pfadliste, nicht ueber die Antwort von eben.
    p = _finde(api.call("GET", "/api/lernpfad/paths", erwartet=(200,)), id=pfad["id"])
    if not p:
        raise AssertionError("Lernpfad fehlt in der Liste")
    l = _finde(p.get("ladders"), id=leiter["id"])
    if not l:
        raise AssertionError("Lernleiter haengt nicht am Lernpfad")
    if l.get("notizen") != "Notiz A" or l.get("topic_id") != u.topic_id \
            or l.get("class_id") != u.class_id:
        raise AssertionError(f"Lernleiter kam anders zurueck: {l}")
    zuweisung = (l.get("assignments") or [{}])[0]
    if zuweisung.get("exercise_ids") != [aufgabe["id"]]:
        raise AssertionError(f"Zuweisung der Aufgabe verloren: {l.get('assignments')}")
    return "Aufgabe (5 Felder), Lernpfad mit Lernleiter und Zuweisung wiedergefunden"


def inhalt_auswertung(api, u, spuren):
    block = api.call("POST", f"/api/noten/classes/{u.class_id}/sections",
                     {"name": f"{PRAEFIX} Block", "weight": 60}, erwartet=(201,))
    spuren.append(("Notenblock", lambda: api.call(
        "DELETE", f"/api/noten/sections/{block['id']}", erwartet=(204, 404))))
    # Abschnitt im 2. Halbjahr: die Uebernahme-Dialoge legen ihn dort direkt an
    # (frueher endete der Weg bei „lege zuerst einen an"). term muss haften und
    # term=all muss beide liefern — sonst waehlt man im Dialog ins Leere.
    zweites = api.call("POST", f"/api/noten/classes/{u.class_id}/sections?term=2",
                       {"name": f"{PRAEFIX} Block 2. HJ", "weight": 0}, erwartet=(201,))
    spuren.append(("Notenblock 2. HJ", lambda: api.call(
        "DELETE", f"/api/noten/sections/{zweites['id']}", erwartet=(204, 404))))
    if str(zweites.get("term")) != "2":
        raise AssertionError(f"Halbjahr am Abschnitt verloren: {zweites}")
    alle = {x["id"] for x in api.call(
        "GET", f"/api/noten/classes/{u.class_id}/sections?term=all", erwartet=(200,))}
    if not {block["id"], zweites["id"]} <= alle:
        raise AssertionError(f"term=all liefert nicht beide Halbjahre: {alle}")
    spalte = api.call("POST", "/api/noten/categories",
                      {"name": f"{PRAEFIX} Spalte", "section_id": block["id"],
                       "topic_id": u.topic_id}, erwartet=(201,))
    api.call("POST", "/api/noten/entries", {
        "category_id": spalte["id"], "student_id": u.students[0], "kind": "grade", "value": 2.3,
    }, erwartet=(201,))
    # Unabhaengig lesen: ueber die Eintragsliste der Klasse.
    eintraege = api.call("GET", f"/api/noten/classes/{u.class_id}/entries", erwartet=(200,))
    meiner = [e for e in eintraege if e["category_id"] == spalte["id"]]
    if len(meiner) != 1 or not gleich(meiner[0]["value"], 2.3):
        raise AssertionError(f"Note nicht wie geschrieben zurueck: {meiner}")
    # Und ueber die Zusammenfassung — die rechnet, statt nur zu spiegeln.
    zus = api.call("GET", f"/api/noten/classes/{u.class_id}/summary", erwartet=(200,))
    zeile = _finde(zus, student_id=u.students[0])
    if not zeile or not gleich(zeile["per_category"].get(str(spalte["id"])), 2.3):
        raise AssertionError(f"Schnitt der Spalte falsch: {zeile}")

    arbeit = api.call("POST", "/api/klassenarbeit/works",
                      {"class_id": u.class_id, "name": f"{PRAEFIX} Arbeit"}, erwartet=(201,))
    spuren.append(("Klassenarbeit", lambda: api.call(
        "DELETE", f"/api/klassenarbeit/works/{arbeit['id']}", erwartet=(204, 404))))
    api.call("PUT", f"/api/klassenarbeit/works/{arbeit['id']}", {
        "tasks": [{"id": "a1", "label": "Aufgabe 1", "topic_id": u.topic_id, "max": 4}],
        "results": {str(u.students[0]): {"a1": 1}, str(u.students[1]): {"a1": 4}},
        # Fehlerart je Zelle: beim ersten Kind fehlen Punkte (zaehlt), beim
        # zweiten steht die volle Punktzahl (zaehlt NICHT — die Angabe ist
        # veraltet, wird aber nicht geloescht). Unbekannte Art fliegt raus.
        "fehler": {str(u.students[0]): {"a1": "ansatz"},
                   str(u.students[1]): {"a1": "rechnen"}},
    }, erwartet=(200,))
    gelesen = _finde(api.call("GET", f"/api/klassenarbeit/classes/{u.class_id}/works",
                              erwartet=(200,)), id=arbeit["id"])
    if not gelesen or (gelesen.get("tasks") or [{}])[0].get("max") != 4:
        raise AssertionError(f"Aufgabe der Klassenarbeit nicht gespeichert: {gelesen}")
    # Die Fehlerart des Kindes mit voller Punktzahl bleibt GESPEICHERT — nur
    # gezaehlt wird sie nicht (siehe unten). Wuerde sie beim Speichern
    # weggeworfen, waere sie nach einer Nachkorrektur unwiederbringlich weg.
    if (gelesen.get("fehler") or {}).get(str(u.students[1]), {}).get("a1") != "rechnen":
        raise AssertionError(f"Fehlerart nicht gespeichert: {gelesen.get('fehler')}")
    # Die Auswertung rechnet: 1 von 4 und 4 von 4 Punkten = 5 von 8 = 63 %.
    ausw = api.call("GET", f"/api/klassenarbeit/works/{arbeit['id']}/analysis", erwartet=(200,))
    thema = _finde(ausw.get("topics"), topic_id=u.topic_id)
    if not thema:
        raise AssertionError("Thema fehlt in der Auswertung")
    soll = round(5 / 8 * 100)
    if thema["pct"] != soll:
        raise AssertionError(f"Trefferquote {thema['pct']} % statt {soll} % (5 von 8 Punkten)")
    schwach = _finde(ausw.get("students"), student_id=u.students[0])
    if not schwach:
        raise AssertionError("Kind mit 1 von 4 Punkten gilt nicht als schwach")
    # Fehlerarten: genau EINE zaehlt. Das Kind mit voller Punktzahl darf nicht
    # auftauchen (sonst zaehlt die Auswertung Fehler an geloesten Aufgaben),
    # und die erfundene Art darf gar nicht erst gespeichert worden sein.
    fehler = ausw.get("fehler")
    if not fehler or fehler.get("gesamt") != {"ansatz": 1}:
        raise AssertionError(f"Fehlerarten falsch gezaehlt: {fehler}")
    if any(x["student_id"] == u.students[1] for x in fehler.get("students", [])):
        raise AssertionError("Kind mit voller Punktzahl steht in den Fehlerarten")
    # Eine erfundene Art nimmt der Server nicht an (fester Katalog wie beim
    # Foerder-Vokabular) — sie darf nicht als neue Kategorie durchrutschen.
    api.call("PUT", f"/api/klassenarbeit/works/{arbeit['id']}",
             {"fehler": {str(u.students[0]): {"a1": "erfunden"}}}, erwartet=(200,))
    nachher = _finde(api.call("GET", f"/api/klassenarbeit/classes/{u.class_id}/works",
                              erwartet=(200,)), id=arbeit["id"])
    if (nachher.get("fehler") or {}).get(str(u.students[0])):
        raise AssertionError(f"Erfundene Fehlerart angenommen: {nachher.get('fehler')}")

    # Kopie in dieselbe Klasse (eine zweite Klasse gibt es im Test nicht): die
    # Aufgaben muessen mitkommen, die PUNKTE nicht. Eine Kopie mit fremden
    # Punkten waere eine Note am falschen Kind.
    kopie = api.call("POST", f"/api/klassenarbeit/works/{arbeit['id']}/copy",
                     {"class_id": u.class_id, "name": f"{PRAEFIX} Arbeit Kopie"}, erwartet=(201,))
    spuren.append(("Klassenarbeit-Kopie", lambda: api.call(
        "DELETE", f"/api/klassenarbeit/works/{kopie['id']}", erwartet=(204, 404))))
    if kopie["id"] == arbeit["id"]:
        raise AssertionError("Kopie ist dieselbe Arbeit")
    # Anhaenge (Arbeit + Erwartungshorizont): sie haengen an der Kern-Ablage,
    # aber sie sind ein Weg des Auswertungs-Moduls — und ohne Probe faellt ein
    # kaputter Bezug erst auf, wenn jemand seine Arbeit sucht.
    pdf = b"%PDF-1.4\ntrailer<</Root 1 0 R>>\n%%EOF\n"
    anhang = api.upload("/api/material", "file", f"{PRAEFIX}-arbeit.pdf", pdf, "application/pdf",
                        felder={"work_id": str(arbeit["id"]), "rolle": "arbeit"}, erwartet=(201,))
    spuren.append(("Anhang", lambda: api.call("DELETE", f"/api/material/{anhang['id']}", erwartet=(204, 404))))
    nur_arbeit = api.call("GET", f"/api/material?work_id={arbeit['id']}&rolle=arbeit", erwartet=(200,))
    if not any(m["id"] == anhang["id"] for m in nur_arbeit):
        raise AssertionError("Anhang der Arbeit nicht unter seiner Rolle wiedergefunden")
    if api.call("GET", f"/api/material?work_id={arbeit['id']}&rolle=erwartung", erwartet=(200,)):
        raise AssertionError("Anhang steht unter der falschen Rolle")

    # Klassenvergleich: Original und Kopie gehoeren zur selben Gruppe. Die
    # Aufgabenstatistik muss die Aufgabe kennen, auch wenn die Kopie noch keine
    # Punkte hat — sonst waere die Sicht erst nach dem Korrigieren nutzbar.
    verg = api.call("GET", f"/api/klassenarbeit/works/{arbeit['id']}/vergleich", erwartet=(200,))
    ids = {a["id"] for a in verg.get("arbeiten", [])}
    if arbeit["id"] not in ids or kopie["id"] not in ids:
        raise AssertionError(f"Vergleich kennt die Gruppe nicht: {ids}")
    eigene = _finde(verg["arbeiten"], id=arbeit["id"])
    if not eigene or eigene.get("n") != 2:
        raise AssertionError(f"Vergleich zaehlt {eigene and eigene.get('n')} gewertete Kinder statt 2")
    # 1 und 4 von je 4 Punkten: die Kinder liegen bei 25 % und 100 %, der Schnitt
    # also bei 62,5 %. Die Aufgabenstatistik rechnet ueber die Punkte (5 von 8)
    # und rundet auf 62 — beides bewusst gegen die Zahl geprueft, nicht gegen
    # "irgendwas".
    if eigene.get("schnitt") != 62.5:
        raise AssertionError(f"Schnitt im Vergleich {eigene.get('schnitt')} statt 62,5 %")
    einheit = (eigene.get("einheiten") or [{}])[0]
    if einheit.get("pct") != 62:
        raise AssertionError(f"Aufgabenstatistik {einheit.get('pct')} % statt 62 %")
    # Kennzahlen, an denen eine misslungene Aufgabe auffaellt: kein Kind hat 0
    # Punkte (1 und 4 von 4), eines hat die volle Punktzahl.
    if einheit.get("null") != 0 or einheit.get("voll") != 50:
        raise AssertionError(f"0-Punkte/Vollpunkte falsch: {einheit.get('null')} / {einheit.get('voll')}")
    ges = (verg.get("gesamt") or [None])[0]
    if not ges or ges.get("n") != 2 or ges.get("pct") != 62:
        raise AssertionError(f"Gesamtdaten der Aufgabe falsch: {ges}")

    if (kopie.get("tasks") or [{}])[0].get("max") != 4:
        raise AssertionError(f"Aufgaben nicht mitkopiert: {kopie.get('tasks')}")
    if kopie.get("results"):
        raise AssertionError(f"Punkte mitkopiert — sie gehoeren der Quellklasse: {kopie['results']}")
    api.call("DELETE", f"/api/klassenarbeit/works/{kopie['id']}", erwartet=(204, 404))
    # Sofort wieder abraeumen: der Noten-Teil weiter unten rechnet mit den
    # Gewichten ALLER Abschnitte — ein liegengebliebener Testabschnitt wuerde
    # dort eine falsche Erwartung erzeugen. (In `spuren` steht es trotzdem, fuer
    # den Fall, dass die Probe vorher abbricht.)
    api.call("DELETE", f"/api/klassenarbeit/works/{arbeit['id']}", erwartet=(204, 404))
    # Mit der Arbeit gehen ihre Anhaenge: sonst laegen sie unsichtbar in der
    # Ablage und belegten das Speicherkonto der Lehrkraft.
    if api.call("GET", f"/api/material?work_id={arbeit['id']}", erwartet=(200,)):
        raise AssertionError("Anhaenge ueberleben das Loeschen der Arbeit")
    api.call("DELETE", f"/api/noten/sections/{block['id']}", erwartet=(204, 404))
    return f"Note 2,3 wiedergefunden; Klassenarbeit rechnet {soll} % und findet das schwache Kind"


MINI_JPEG = (
    # Kleinstes gueltiges JPEG (1x1, grau). Reicht, um den Weg zu pruefen:
    # Upload, Typerkennung, Markererkennung, Antwortform. Karten findet er
    # keine — genau das ist die erwartete Antwort.
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a"
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA"
    "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=="
)


def inhalt_scan_roh(api, u, spuren):
    """Der Weg, den der Scanner im Unterricht nimmt: rohes JPEG statt base64.

    Geprueft wird nicht die Erkennung (dafuer braeuchte es ein echtes Foto mit
    Marker), sondern dass der Weg lebt und dieselbe Antwortform liefert wie der
    alte JSON-Weg — genau daran haengt der Scanner nach jedem Deploy.
    """
    import base64
    sitzung = api.call("POST", "/api/sessions", {"name": f"{PRAEFIX} Scanweg", "class_id": u.class_id}, erwartet=(200, 201))
    spuren.append(("Scan-Sitzung", lambda: api.call("DELETE", f"/api/sessions/{sitzung['id']}", erwartet=(204, 404))))
    roh = api.upload_roh(f"/api/scan-image-raw?session_id={sitzung['id']}&save=false",
                         base64.b64decode(MINI_JPEG), "image/jpeg", erwartet=(200,))
    if not isinstance(roh, dict) or "cards" not in roh:
        raise AssertionError(f"Rohweg antwortet ohne Kartenliste: {roh}")
    json_weg = api.call("POST", "/api/scan-image",
                        {"session_id": sitzung["id"], "image": MINI_JPEG, "save": False}, erwartet=(200,))
    if json_weg.get("cards") != roh.get("cards"):
        raise AssertionError(f"JSON- und Rohweg antworten verschieden: {json_weg} / {roh}")
    api.call("DELETE", f"/api/sessions/{sitzung['id']}", erwartet=(204, 404))
    return "rohes JPEG und JSON-Weg liefern dieselbe Antwort"


def inhalt_karten(api, u, spuren):
    """Der volle Weg: Stapel und drei Karten anlegen, freigeben, Zugang holen,
    OHNE Anmeldung lernen, antworten — und danach als Lehrkraft nachsehen, ob
    der Fortschritt wirklich gestiegen ist."""
    anonym = Api(api.basis, debug=api.debug)
    # niveau_aktiv: die E/G-Unterscheidung JE KARTE ist ein Schalter am Stapel
    # (wie am CardVote-Quiz) und aus, bis jemand sie anmacht. Ohne ihn saehen
    # alle alles — genau das prueft der Gegenzweig weiter unten.
    stapel = api.call("POST", f"/api/karten/classes/{u.class_id}/decks",
                      {"name": f"{PRAEFIX} Stapel", "topic_id": u.topic_id, "niveau_aktiv": True}, erwartet=(201,))
    spuren.append(("Kartenstapel", lambda: (
        api.call("DELETE", f"/api/karten/decks/{stapel['id']}", erwartet=(204, 404)),
        api.call("DELETE", f"/api/karten/decks/{stapel['id']}/purge", erwartet=(204, 404)))))
    # Karte OHNE Angabe. Mit eingeschalteter Differenzierung ist eine neue Karte
    # Grundstoff: der Server MUSS "G" daraus machen (siehe _niveau_vorgabe in
    # karten.py). Angabelose Karten gibt es nur noch im Bestand — dass hier
    # nichts Neutrales mehr entsteht, ist die eigentliche Zusicherung und wird
    # deshalb gleich zurueckgelesen statt nur ueber die Sichtbarkeit erschlossen.
    kg1 = api.call("POST", f"/api/karten/decks/{stapel['id']}/cards",
                   {"front": "3+4", "back": "7"}, erwartet=(201,))
    # Karte ausdruecklich fuer E …
    ke = api.call("POST", f"/api/karten/decks/{stapel['id']}/cards",
                  {"front": "5*6", "back": "30", "niveau": "E"}, erwartet=(201,))
    # … und eine ausdruecklich fuer G. Dasselbe Prinzip wie bei CardVote, aber je
    # Karte statt je Stapel. Das erste Testkind ist E, das zweite G.
    kg2 = api.call("POST", f"/api/karten/decks/{stapel['id']}/cards",
                   {"front": "G-Karte", "back": "nur G", "niveau": "G"}, erwartet=(201,))

    # Zurueckgelesen, nicht der Antwort des Anlegens geglaubt: was in der
    # Datenbank steht, entscheidet spaeter darueber, wer die Karte sieht.
    deck_gelesen = _finde(api.call("GET", f"/api/karten/classes/{u.class_id}/decks", erwartet=(200,)),
                          id=stapel["id"])
    niveaus = {c["front"]: c.get("niveau") for c in (deck_gelesen or {}).get("cards") or []}
    if niveaus.get("3+4") != "G":
        raise AssertionError("Karte ohne Angabe kam als "
                             f"{niveaus.get('3+4')!r} an statt als 'G' "
                             "(mit niveau_aktiv ist Grundstoff die Vorgabe)")
    if niveaus.get("5*6") != "E" or niveaus.get("G-Karte") != "G":
        raise AssertionError(f"ausdrueckliche Niveaus nicht gespeichert: {niveaus}")

    # Vor der Freigabe darf ein Kind nichts sehen — sonst waeren Entwuerfe oeffentlich.
    zugaenge = api.call("POST", f"/api/karten/classes/{u.class_id}/tokens", erwartet=(200, 201))
    token = _finde(zugaenge, student_id=u.students[0])
    if not token:
        raise AssertionError("kein Zugang fuer das erste Kind erzeugt")
    token = token["token"]
    vorab = anonym.call("GET", f"/api/karten/lernen/{token}", erwartet=(200,))
    if vorab.get("cards"):
        raise AssertionError("Entwurf ist fuer Lernende sichtbar — Freigabe wirkt nicht")

    api.call("POST", f"/api/karten/decks/{stapel['id']}/release", {"now": True}, erwartet=(200,))
    sitzung = anonym.call("GET", f"/api/karten/lernen/{token}", erwartet=(200,))
    # Das E-Kind bekommt GENAU die E-Karte. Dass es die beiden G-Karten NICHT
    # sieht, ist die Zusicherung, kein Nebeneffekt: die angabelose Karte ist
    # oben serverseitig zu "G" geworden und damit fuer ein E-Kind unsichtbar.
    if sitzung.get("total") != 1 or len(sitzung.get("cards") or []) != 1:
        raise AssertionError(f"E-Kind sieht {sitzung.get('total')} Karten statt 1")
    vorderseiten = {c["front"] for c in sitzung["cards"]}
    if vorderseiten != {"5*6"}:
        raise AssertionError(f"falsche Karten ans E-Kind ausgeliefert: {vorderseiten}")

    # Gegenprobe: dasselbe Deck, ein G-Kind — es MUSS genau die beiden G-Karten
    # bekommen und die E-Karte nicht. Ohne diese Richtung wuerde ein Filter, der
    # einfach alles wegwirft, unbemerkt durchgehen.
    token_g = _finde(zugaenge, student_id=u.students[1])
    if not token_g:
        raise AssertionError("kein Zugang fuer das zweite Kind erzeugt")
    token_g = token_g["token"]
    sitzung_g = anonym.call("GET", f"/api/karten/lernen/{token_g}", erwartet=(200,))
    fronts_g = {c["front"] for c in sitzung_g.get("cards") or []}
    if fronts_g != {"3+4", "G-Karte"}:
        raise AssertionError(f"G-Kind sieht {fronts_g} statt der beiden G-Karten")
    if sitzung_g.get("total") != 2:
        raise AssertionError(f"G-Kind zaehlt {sitzung_g.get('total')} Karten statt 2")

    # Gelernt wird ab hier mit dem G-Kind: es hat zwei Karten, und nur mit zweien
    # laesst sich "eine richtig, eine falsch" ueberhaupt zeigen. Jede Karte, die
    # hier angefasst wird, gehoert diesem Kind auch wirklich.
    vorher = _finde(api.call("GET", f"/api/karten/classes/{u.class_id}/progress", erwartet=(200,)),
                    student_id=u.students[1])
    anonym.call("POST", f"/api/karten/lernen/{token_g}/review",
                {"card_id": kg1["id"], "grade": 3}, erwartet=(200,))
    anonym.call("POST", f"/api/karten/lernen/{token_g}/review",
                {"card_id": kg2["id"], "grade": 0}, erwartet=(200,))
    nachher = _finde(api.call("GET", f"/api/karten/classes/{u.class_id}/progress", erwartet=(200,)),
                     student_id=u.students[1])
    if nachher["total"] != 2:
        raise AssertionError(f"Fortschritt zaehlt {nachher['total']} Karten statt 2")
    if nachher["reviewed"] <= (vorher or {}).get("reviewed", 0):
        raise AssertionError(f"Fortschritt nicht gestiegen: {vorher} -> {nachher}")
    if nachher["reviewed"] != 1:
        # grade 0 setzt zurueck (reps=0) — genau eine Karte gilt als gelernt.
        raise AssertionError(f"{nachher['reviewed']} gelernte Karten statt 1 "
                             "(grade 0 darf nicht als gelernt zaehlen)")
    if nachher["due"] != 0:
        # Beide Karten sind beantwortet: die gute liegt einen Tag weit weg, die
        # falsche ("nochmal") zehn Minuten. Faellig ist also gerade keine.
        raise AssertionError(f"{nachher['due']} faellige Karten statt 0")
    # Die falsche Karte darf aber nicht verschwinden — sie muss kurz darauf
    # wiederkommen, sonst waere "nochmal" ein Loeschknopf.
    stand = anonym.call("GET", f"/api/karten/lernen/{token_g}", erwartet=(200,))
    if not stand.get("next_due"):
        raise AssertionError("keine naechste Faelligkeit — die falsche Karte kommt nie wieder")
    frist = _minuten_bis(stand["next_due"])
    if not (0 < frist <= 15):
        raise AssertionError(f"falsche Karte erst in {frist:.0f} Minuten wieder faellig "
                             "(erwartet: rund 10)")
    # Die Detailsicht muss dasselbe sagen wie die Uebersicht.
    detail = api.call("GET", f"/api/karten/classes/{u.class_id}/students/{u.students[1]}/cards",
                      erwartet=(200,))
    eine = _finde(detail, card_id=kg1["id"])
    if not eine or eine["reps"] != 1:
        raise AssertionError(f"Detailsicht zeigt {eine} statt reps=1")
    # Und sie zeigt nur, was dem Kind gehoert: die E-Karte darf in den Zahlen des
    # G-Kindes nicht auftauchen — sonst haette es dauerhaft Rueckstand fuer eine
    # Karte, die es nie zu sehen bekommt.
    if _finde(detail, card_id=ke["id"]):
        raise AssertionError("E-Karte steht in der Detailsicht des G-Kindes")
    e_fortschritt = _finde(api.call("GET", f"/api/karten/classes/{u.class_id}/progress", erwartet=(200,)),
                           student_id=u.students[0])
    if (e_fortschritt or {}).get("total") != 1:
        raise AssertionError(f"Fortschritt des E-Kindes zaehlt {e_fortschritt} statt 1 Karte")
    # Gegenprobe zum Schalter: ausgeschaltet zaehlt das Karten-Niveau nicht
    # mehr, das E-Kind bekommt auch die G-Karte. Ohne diese Richtung koennte der
    # Filter einfach immer greifen und niemandem fiele es auf.
    api.call("PUT", f"/api/karten/decks/{stapel['id']}",
             {"name": f"{PRAEFIX} Stapel", "topic_id": u.topic_id, "niveau_aktiv": False}, erwartet=(200,))
    ohne_schalter = anonym.call("GET", f"/api/karten/lernen/{token}?all=true", erwartet=(200,))
    if ohne_schalter.get("total") != 3:
        raise AssertionError(f"ohne Niveau-Schalter zaehlt das E-Kind {ohne_schalter.get('total')} Karten statt 3")
    api.call("PUT", f"/api/karten/decks/{stapel['id']}",
             {"name": f"{PRAEFIX} Stapel", "topic_id": u.topic_id, "niveau_aktiv": True}, erwartet=(200,))

    # Fremder Token darf nichts oeffnen.
    status, _ = anonym.call("GET", "/api/karten/lernen/ZZ-kein-token", roh=True)
    if status < 400:
        raise AssertionError(f"falscher Token liefert HTTP {status}")

    # ─── Die Sammlung: Stapel ohne Klasse, Zuweisung an einen Kurs ───
    #
    # Der zweite Weg zu denselben Karten, und der heikle: die Zuweisung
    # entscheidet, was ein Kind sieht. Also beide Richtungen — zugewiesen kommt
    # es an, zurueckgenommen ist es still.
    frei = api.call("POST", "/api/karten/decks",
                    {"name": f"{PRAEFIX} Sammlung"}, erwartet=(201,))
    spuren.append(("Sammlungsstapel", lambda: (
        api.call("DELETE", f"/api/karten/decks/{frei['id']}", erwartet=(204, 404)),
        api.call("DELETE", f"/api/karten/decks/{frei['id']}/purge", erwartet=(204, 404)))))
    if frei.get("kurs_ids"):
        raise AssertionError(f"neuer Sammlungsstapel ist schon zugewiesen: {frei}")
    api.call("POST", f"/api/karten/decks/{frei['id']}/cards",
             {"front": "Sammlung", "back": "ja"}, erwartet=(201,))
    api.call("POST", f"/api/karten/decks/{frei['id']}/release", {"now": True}, erwartet=(200,))
    ohne = anonym.call("GET", f"/api/karten/lernen/{token}", erwartet=(200,))
    if any(c["front"] == "Sammlung" for c in ohne.get("cards") or []):
        raise AssertionError("unzugewiesener Stapel wird ausgeteilt")

    zu = api.call("PUT", f"/api/karten/decks/{frei['id']}/kurse",
                  {"kurs_ids": [u.kurs_id]}, erwartet=(200,))
    if zu.get("kurs_ids") != [u.kurs_id]:
        raise AssertionError(f"Zuweisung nicht gespeichert: {zu}")
    mit = anonym.call("GET", f"/api/karten/lernen/{token}", erwartet=(200,))
    if not any(c["front"] == "Sammlung" for c in mit.get("cards") or []):
        raise AssertionError("zugewiesener Stapel kommt beim Kind nicht an")
    nur_kurs = api.call("GET", f"/api/karten/decks?kurs_id={u.kurs_id}", erwartet=(200,))
    if not any(d["id"] == frei["id"] for d in nur_kurs):
        raise AssertionError("Kurs-Filter zeigt den zugewiesenen Stapel nicht")

    api.call("PUT", f"/api/karten/decks/{frei['id']}/kurse", {"kurs_ids": []}, erwartet=(200,))
    zurueck = anonym.call("GET", f"/api/karten/lernen/{token}", erwartet=(200,))
    if any(c["front"] == "Sammlung" for c in zurueck.get("cards") or []):
        raise AssertionError("zurueckgenommene Zuweisung teilt weiter aus")
    if not any(d["id"] == frei["id"] for d in api.call("GET", "/api/karten/decks", erwartet=(200,))):
        raise AssertionError("Stapel ist aus der Sammlung verschwunden statt nur unzugewiesen")
    api.call("DELETE", f"/api/karten/decks/{frei['id']}", erwartet=(204,))
    api.call("DELETE", f"/api/karten/decks/{frei['id']}/purge", erwartet=(204,))

    return ("Stapel freigegeben, Karte ohne Angabe kommt als G an, E-Kind sieht "
            "genau die E-Karte, G-Kind genau die beiden G-Karten, "
            "ohne Anmeldung gelernt, Fortschritt 0 -> 1 von 2 "
            f"(Detailsicht bestaetigt reps=1), falsche Karte in {frist:.0f} Minuten "
            "wieder faellig, falscher Token abgewiesen; Niveau-Schalter aus = alle "
            "sehen alles; Sammlungsstapel erst nach Kurs-Zuweisung sichtbar und "
            "nach Ruecknahme wieder still")


def inhalt_kalender(api, u, spuren):
    tag = datetime.now().replace(hour=9, minute=0, second=0, microsecond=0)
    eintrag = api.call("POST", "/api/kalender/entries", {
        "date": tag.isoformat(), "title": f"{PRAEFIX} Stunde", "notes": "Merksatz",
        "class_id": u.class_id, "topic_id": u.topic_id, "period": 2,
        "start_time": "09:00", "end_time": "09:45",
        "verlaufsplan": [{"phase": "Einstieg", "dauer": "5", "text": "Blitzlicht"}],
    }, erwartet=(201,))
    spuren.append(("Kalendereintrag", lambda: api.call(
        "DELETE", f"/api/kalender/entries/{eintrag['id']}", erwartet=(204, 404))))
    frm = (tag - timedelta(days=1)).isoformat()
    to = (tag + timedelta(days=1)).isoformat()
    wieder = _finde(api.call("GET", f"/api/kalender/entries?frm={frm}&to={to}", erwartet=(200,)),
                    id=eintrag["id"])
    if not wieder:
        raise AssertionError("Eintrag nicht im abgefragten Zeitraum")
    for feld, soll in (("title", f"{PRAEFIX} Stunde"), ("notes", "Merksatz"),
                       ("class_id", u.class_id), ("topic_id", u.topic_id),
                       ("period", 2), ("start_time", "09:00")):
        if wieder.get(feld) != soll:
            raise AssertionError(f"{feld}: {wieder.get(feld)!r} statt {soll!r}")
    if (wieder.get("verlaufsplan") or [{}])[0].get("text") != "Blitzlicht":
        raise AssertionError(f"Verlaufsplan verloren: {wieder.get('verlaufsplan')}")

    slot = api.call("PUT", "/api/kalender/timetable/slot", {
        "weekday": 0, "period": 1, "class_id": u.class_id, "title": f"{PRAEFIX} Slot",
    }, erwartet=(200,))
    spuren.append(("Stundenplan-Slot", lambda: api.call(
        "DELETE", f"/api/kalender/timetable/slot/{slot['id']}", erwartet=(204, 404))))
    plan = api.call("GET", "/api/kalender/timetable", erwartet=(200,))
    treffer = _finde(plan.get("slots"), id=slot["id"])
    if not treffer or treffer.get("weekday") != 0 or treffer.get("class_id") != u.class_id:
        raise AssertionError(f"Slot nicht im Stundenplan wiedergefunden: {plan.get('slots')}")

    pause = api.call("POST", "/api/kalender/breaks", {
        "start_date": tag.isoformat(), "end_date": (tag + timedelta(days=2)).isoformat(),
        "label": f"{PRAEFIX} frei",
    }, erwartet=(201,))
    spuren.append(("Freier Zeitraum", lambda: api.call(
        "DELETE", f"/api/kalender/breaks/{pause['id']}", erwartet=(204, 404))))
    if not _finde(api.call("GET", "/api/kalender/breaks", erwartet=(200,)), id=pause["id"]):
        raise AssertionError("freier Zeitraum nicht in der Liste")

    arbeit = api.call("POST", "/api/kalender/klassenarbeiten", {
        "date": (tag + timedelta(days=7)).isoformat(), "title": f"{PRAEFIX} KA",
        "class_id": u.class_id,
        # Themen der Arbeit: eins eigenes und eine erfundene Nummer. Die eigene
        # muss bleiben, die fremde still herausfallen — ein Thema, das jemand
        # zwischendurch geloescht hat, darf keinen Termin blockieren.
        "topic_ids": [u.topic_id, 999999999],
    }, erwartet=(201,))
    spuren.append(("Klassenarbeitstermin", lambda: api.call(
        "DELETE", f"/api/kalender/klassenarbeiten/{arbeit['id']}", erwartet=(204, 404))))
    if arbeit.get("topic_ids") != [u.topic_id]:
        raise AssertionError(f"Themen der Arbeit falsch gefiltert: {arbeit.get('topic_ids')}")
    if not _finde(api.call("GET", "/api/kalender/klassenarbeiten", erwartet=(200,)),
                  id=arbeit["id"]):
        raise AssertionError("Klassenarbeitstermin nicht in der Liste")
    # Die Uebersicht loest die Themen mit Namen auf — sonst stuende dort eine
    # Nummer, mit der niemand etwas anfangen kann.
    ueb = _finde(api.call("GET", "/api/kalender/klassenarbeiten/uebersicht", erwartet=(200,)),
                 id=arbeit["id"])
    if not ueb or not [x for x in (ueb.get("topics") or []) if x.get("label")]:
        raise AssertionError(f"Themen fehlen in der Uebersicht: {ueb}")
    # Stoffverteilungsplan: Themen mit Soll-Stunden je Kurs. Der Server rechnet
    # daraus die Zeitraeume — hier zaehlt, dass der Plan gespeichert wird und
    # ein fremdes Thema NICHT hineinkommt.
    if u.kurs_id:
        api.call("PUT", "/api/kalender/stoffplan", {
            "kurs_id": u.kurs_id,
            "zeilen": [{"topic_id": u.topic_id, "stunden": 3},
                       {"topic_id": 999999999, "stunden": 5}],
        }, erwartet=(204,))
        spuren.append(("Stoffplan", lambda: api.call(
            "PUT", "/api/kalender/stoffplan",
            {"kurs_id": u.kurs_id, "zeilen": []}, erwartet=(204, 404))))
        plan = api.call("GET", f"/api/kalender/stoffplan?kurs_id={u.kurs_id}", erwartet=(200,))
        eigene = [z for z in plan.get("zeilen") or [] if z["topic_id"] == u.topic_id]
        if len(eigene) != 1 or eigene[0]["stunden"] != 3:
            raise AssertionError(f"Stoffplan nicht gespeichert: {plan.get('zeilen')}")
        if any(z["topic_id"] == 999999999 for z in plan.get("zeilen") or []):
            raise AssertionError("fremdes Thema im Stoffplan angenommen")
        if "stunden_gesamt" not in plan:
            raise AssertionError(f"Stoffplan ohne Stundenrechnung: {plan}")

    return ("Eintrag (6 Felder + Verlaufsplan), Slot, freier Zeitraum, "
            "Klassenarbeit mit Themen, Stoffplan wiedergefunden")


def inhalt_orga(api, u, spuren):
    # Abschaltbare Teile des Moduls: SEGEL laesst sich abstellen, ohne dass die
    # Anwesenheit oder die Ausleihe mitgehen. Nach dem Test wieder anschalten —
    # der Lauf darf die Einstellungen des Kontos nicht veraendern.
    def segel(an):
        return api.call("PUT", "/api/modules/orga/optionen", {"optionen": {"segel": an}},
                        erwartet=(200,))
    aus = segel(False)
    if (aus.get("optionen_an") or {}).get("segel") is not False:
        raise AssertionError(f"Option nicht gespeichert: {aus.get('optionen_an')}")
    gelesen = _finde(api.call("GET", "/api/modules", erwartet=(200,)), key="orga")
    if (gelesen.get("optionen_an") or {}).get("segel") is not False:
        raise AssertionError(f"Option kommt in der Liste nicht zurueck: {gelesen.get('optionen_an')}")
    # Ein Tippfehler im Schluessel muss auffallen, statt als „gespeichert" zu
    # gelten und nie zu wirken.
    api.call("PUT", "/api/modules/orga/optionen", {"optionen": {"gibtsnicht": True}},
             erwartet=(400,))
    an = segel(True)
    if (an.get("optionen_an") or {}).get("segel") is not True:
        raise AssertionError(f"Option nicht zurueckgestellt: {an.get('optionen_an')}")

    posten = api.call("POST", f"/api/orga/{u.class_id}", {"name": f"{PRAEFIX} Zettel"},
                      erwartet=(201,))
    spuren.append(("Checklisten-Punkt", lambda: api.call(
        "DELETE", f"/api/orga/item/{posten['id']}", erwartet=(204, 404))))
    api.call("PUT", f"/api/orga/item/{posten['id']}/toggle", {"student_id": u.students[0]},
             erwartet=(200,))
    wieder = _finde(api.call("GET", f"/api/orga/{u.class_id}", erwartet=(200,)), id=posten["id"])
    if not wieder or u.students[0] not in (wieder.get("done") or []):
        raise AssertionError(f"Haken nicht gespeichert: {wieder}")

    heute = datetime.now().replace(hour=8, minute=0, second=0, microsecond=0)
    api.call("PUT", f"/api/anwesenheit/{u.class_id}",
             {"student_id": u.students[1], "date": heute.isoformat(), "status": "fehlt",
              "note": "krank"}, erwartet=(200,))
    spuren.append(("Anwesenheit", lambda: api.call(
        "PUT", f"/api/anwesenheit/{u.class_id}",
        {"student_id": u.students[1], "date": heute.isoformat(), "status": "da"},
        erwartet=(200, 404))))
    tag = api.call("GET", f"/api/anwesenheit/{u.class_id}?date={heute.isoformat()}",
                   erwartet=(200,))
    eintrag = tag.get(str(u.students[1]))
    if not eintrag or eintrag.get("status") != "fehlt" or eintrag.get("note") != "krank":
        raise AssertionError(f"Fehlzeit nicht wie geschrieben: {tag}")

    api.call("PUT", f"/api/sitzplan/{u.class_id}",
             {"seats": [{"sid": u.students[0], "x": 3, "y": 4, "rot": 90}]}, erwartet=(200,))
    plan = api.call("GET", f"/api/sitzplan/{u.class_id}", erwartet=(200,))
    sitz = _finde(plan.get("seats"), sid=u.students[0])
    if not sitz or not gleich(sitz["x"], 3) or not gleich(sitz["y"], 4) \
            or not gleich(sitz["rot"], 90):
        raise AssertionError(f"Sitzplatz nicht wie gesetzt: {plan}")

    gegenstand = api.call("POST", "/api/ausleihe/items", {"name": f"{PRAEFIX} Buch"},
                          erwartet=(201,))
    spuren.append(("Ausleih-Gegenstand", lambda: api.call(
        "DELETE", f"/api/ausleihe/items/{gegenstand['id']}", erwartet=(204, 404))))
    leihe = api.call("POST", "/api/ausleihe/loans",
                     {"item_id": gegenstand["id"], "student_id": u.students[2]}, erwartet=(201,))
    offen = _finde(api.call("GET", "/api/ausleihe/items", erwartet=(200,)), id=gegenstand["id"])
    if not offen or offen.get("open") != 1:
        raise AssertionError(f"offene Ausleihe wird nicht gezaehlt: {offen}")
    if (leihe.get("borrower") or "") != u.namen[2]:
        raise AssertionError(f"Ausleiher '{leihe.get('borrower')}' statt '{u.namen[2]}'")
    api.call("PUT", f"/api/ausleihe/loans/{leihe['id']}/return", erwartet=(200,))
    zurueck = _finde(api.call("GET", "/api/ausleihe/items", erwartet=(200,)), id=gegenstand["id"])
    if zurueck.get("open") != 0:
        raise AssertionError("Rueckgabe schliesst die Ausleihe nicht")
    return "Haken, Fehlzeit mit Notiz, Sitzplatz (x/y/rot), Ausleihe und Rueckgabe belegt"


def inhalt_zufall(api, u, spuren):
    api.call("DELETE", f"/api/zufall/{u.class_id}", erwartet=(204,))
    api.call("POST", f"/api/zufall/{u.class_id}/draw", {"student_id": u.students[0]},
             erwartet=(200,))
    api.call("POST", f"/api/zufall/{u.class_id}/draw", {"student_id": u.students[0]},
             erwartet=(200,))
    # Kurz warten: den Zeitstempel eines NEUEN Eintrags setzt die Datenbank
    # (server_default now()), den eines vorhandenen der Server in Python. Liegen
    # beide in derselben Sekunde, entscheidet auf sekundengenauen Datenbanken der
    # Zufall, wer als „zuletzt gezogen" gilt.
    time.sleep(1.2)
    api.call("POST", f"/api/zufall/{u.class_id}/draw", {"student_id": u.students[1]},
             erwartet=(200,))
    spuren.append(("Zieh-Gedaechtnis", lambda: api.call(
        "DELETE", f"/api/zufall/{u.class_id}", erwartet=(204, 404))))
    stand = api.call("GET", f"/api/zufall/{u.class_id}", erwartet=(200,))
    hist = stand.get("history") or {}
    if hist.get(str(u.students[0]), {}).get("count") != 2:
        raise AssertionError(f"zweimal gezogen, gezaehlt: {hist.get(str(u.students[0]))}")
    if stand.get("last_student_id") != u.students[1]:
        raise AssertionError(f"zuletzt gezogen ist {stand.get('last_student_id')}, "
                             f"gezogen wurde {u.students[1]}")
    return "dreimal gezogen: Zaehler 2 und 1, zuletzt Gezogener stimmt"


def inhalt_unterrichtsplanung(api, u, spuren):
    ordner = api.call("POST", "/api/methoden/folders", {"name": f"{PRAEFIX} Methoden"},
                      erwartet=(201,))
    spuren.append(("Methodenordner", lambda: api.call(
        "DELETE", f"/api/methoden/folders/{ordner['id']}", erwartet=(204, 404))))
    methode = api.call("POST", "/api/methoden/", {
        "title": f"{PRAEFIX} Einstieg", "description": "Impulsbild zeigen",
        "ablauf": "1. Bild\n2. Fragen", "material": "Beamer", "dauer": 10,
        "folder_id": ordner["id"], "topic_id": u.topic_id,
    }, erwartet=(201,))
    spuren.append(("Methode", lambda: api.call(
        "DELETE", f"/api/methoden/{methode['id']}", erwartet=(204, 404))))
    wieder = _finde(api.call("GET", "/api/methoden/list", erwartet=(200,)), id=methode["id"])
    if not wieder:
        raise AssertionError("Methode nicht in der Sammlung")
    for feld, soll in (("title", f"{PRAEFIX} Einstieg"), ("description", "Impulsbild zeigen"),
                       ("material", "Beamer"), ("dauer", 10),
                       ("folder_id", ordner["id"]), ("topic_id", u.topic_id)):
        if wieder.get(feld) != soll:
            raise AssertionError(f"{feld}: {wieder.get(feld)!r} statt {soll!r}")
    return "Methode mit 6 Feldern im Ordner wiedergefunden"


def inhalt_notizbrett(api, u, spuren):
    notiz = api.call("POST", "/api/notizblock",
                     {"title": f"{PRAEFIX} Notiz", "content": "Zeile 1\nZeile 2"}, erwartet=(201,))
    spuren.append(("Notizzettel", lambda: api.call(
        "DELETE", f"/api/notizblock/{notiz['id']}", erwartet=(204, 404))))
    wieder = _finde(api.call("GET", "/api/notizblock", erwartet=(200,)), id=notiz["id"])
    if not wieder or wieder.get("content") != "Zeile 1\nZeile 2":
        raise AssertionError(f"Notiz kam anders zurueck: {wieder}")

    morgen = (datetime.now() + timedelta(days=1)).date().isoformat()
    aufgabe = api.call("POST", "/api/todo",
                       {"text": f"{PRAEFIX} Kopien machen", "due_date": morgen,
                        "due_time": "07:30"}, erwartet=(201,))
    spuren.append(("To-do", lambda: api.call(
        "DELETE", f"/api/todo/{aufgabe['id']}", erwartet=(204, 404))))
    t = _finde(api.call("GET", "/api/todo", erwartet=(200,)), id=aufgabe["id"])
    if not t or t.get("due_date") != morgen or t.get("due_time") != "07:30" or t.get("done"):
        raise AssertionError(f"To-do kam anders zurueck: {t}")
    api.call("PUT", f"/api/todo/{aufgabe['id']}", {"done": True}, erwartet=(200,))
    t = _finde(api.call("GET", "/api/todo", erwartet=(200,)), id=aufgabe["id"])
    if not t.get("done"):
        raise AssertionError("Erledigt-Haken nicht gespeichert")
    # Datierte Aufgaben erscheinen im Kalender-Auszug des Moduls.
    if not _finde(api.call("GET", "/api/todo/calendar", erwartet=(200,)), id=aufgabe["id"]):
        raise AssertionError("datiertes To-do fehlt im Kalender-Auszug")
    return "Notiz mit Zeilenumbruch, To-do mit Datum/Uhrzeit, Haken und Kalender-Auszug"




def inhalt_code_detektiv(api, u, spuren):
    kennung = f"{PRAEFIX}-raetsel"
    nutzlast = {"blocks": [{"id": "b1", "text": "print(x)"}, {"id": "b2", "text": "x = 1"}],
                "order": ["b2", "b1"]}
    api.call("PUT", "/api/codedetektiv/puzzles", {
        "client_id": kennung, "title": f"{PRAEFIX} Raetsel",
        "topic_id": u.topic_id, "payload": nutzlast,
    }, erwartet=(200,))
    spuren.append(("Raetsel", lambda: api.call(
        "DELETE", f"/api/codedetektiv/puzzles/{kennung}", erwartet=(204, 404))))
    wieder = _finde(api.call("GET", "/api/codedetektiv/puzzles", erwartet=(200,)),
                    client_id=kennung)
    if not wieder or wieder.get("payload") != nutzlast:
        raise AssertionError(f"Raetsel-Inhalt kam anders zurueck: {wieder}")
    if wieder.get("topic_id") != u.topic_id:
        raise AssertionError("Thema des Raetsels nicht gespeichert")

    # Klassen-Session: beitreten und Ergebnis melden geht OHNE Anmeldung.
    anonym = Api(api.basis, debug=api.debug)
    sitzung = api.call("POST", "/api/codedetektiv/sessions",
                       {"puzzles": [{"id": "zz1", "title": f"{PRAEFIX} Raetsel"}]}, erwartet=(201,))
    code = sitzung["code"]
    spuren.append(("Code-Detektiv-Session", lambda: api.call(
        "DELETE", f"/api/codedetektiv/sessions/{code}", erwartet=(204, 404))))
    anonym.call("POST", f"/api/codedetektiv/sessions/{code}/join",
                {"name": f"{PRAEFIX} Kind"}, erwartet=(200, 201))
    anonym.call("POST", f"/api/codedetektiv/sessions/{code}/result",
                {"playerName": f"{PRAEFIX} Kind", "puzzleId": "zz1", "solved": True,
                 "attempts": 2, "time": 12.5}, erwartet=(200, 201))
    stand = anonym.call("GET", f"/api/codedetektiv/sessions/{code}", erwartet=(200,))
    text = json.dumps(stand, ensure_ascii=False)
    if f"{PRAEFIX} Kind" not in text:
        raise AssertionError(f"beigetretenes Kind steht nicht in der Session: {text[:200]}")
    return "Raetsel samt Bausteinen wiedergefunden; Beitritt und Ergebnis ohne Anmeldung"


INHALT = {
    "cardvote": inhalt_cardvote,
    "lernpfad": inhalt_lernpfad,
    "auswertung": inhalt_auswertung,
    "karten": inhalt_karten,
    "kalender": inhalt_kalender,
    "orga": inhalt_orga,
    "zufall": inhalt_zufall,
    "unterrichtsplanung": inhalt_unterrichtsplanung,
    "notizbrett": inhalt_notizbrett,
    "code-detektiv": inhalt_code_detektiv,
    "tafel": None,
    "mathespiele": None,
}


# ─────────────────────── Modul-Schalter ───────────────────────

class Schalter:
    """Modul-Aktivierung des Kontos — merkt sich den Anfangszustand und stellt
    ihn am Ende wieder her. Der Test darf die Einstellungen nicht veraendern."""

    def __init__(self, api, b):
        self.api, self.b = api, b
        self.module = api.call("GET", "/api/modules", erwartet=(200,))
        self.verfuegbar = [m["key"] for m in self.module if m.get("available")]
        self.anfangs_aktiv = {m["key"] for m in self.module if m.get("active")}
        # Mitgefuehrter Stand, damit nur noch die Differenz geschickt wird: der
        # Test schaltet dutzendfach um, und ein Aufruf je Modul und Durchgang
        # laeuft am echten Server in die nginx-Drosselung (limit_req).
        self.aktiv_jetzt = set(self.anfangs_aktiv)   # None = Stand unbekannt
        # Ausgangszustand festhalten, bevor irgendetwas umgeschaltet wird: nach
        # einem Abbruch stellt scripts/aufraeumen.py ihn wieder her.
        merke_module(api.basis, self.anfangs_aktiv)

    def frisch_lesen(self):
        """Stand neu vom Server holen — nach einem Fehler ist der mitgefuehrte
        Zustand nicht mehr vertrauenswuerdig."""
        module = self.api.call("GET", "/api/modules", erwartet=(200,))
        self.aktiv_jetzt = {m["key"] for m in module if m.get("active")}
        return self.aktiv_jetzt

    def setze(self, aktiv):
        """Genau diese Schluessel aktiv, alle anderen aus — nur die Differenz."""
        aktiv = {k for k in aktiv if k in self.verfuegbar}
        if self.aktiv_jetzt is None:
            self.frisch_lesen()
        einschalten = aktiv - self.aktiv_jetzt
        ausschalten = {k for k in self.verfuegbar if k not in aktiv} & self.aktiv_jetzt
        for key, methode in ([(k, "POST") for k in sorted(einschalten)] +
                             [(k, "DELETE") for k in sorted(ausschalten)]):
            try:
                self.api.call(methode, f"/api/modules/{key}/activate", erwartet=(200,))
            except Exception:
                # Zustand ist jetzt unbekannt — frisch lesen, sonst wuerde der
                # naechste Aufruf auf einer Luege aufbauen.
                try:
                    self.frisch_lesen()
                except Exception:
                    self.aktiv_jetzt = None   # beim naechsten Mal frisch holen
                raise
            if methode == "POST":
                self.aktiv_jetzt.add(key)
            else:
                self.aktiv_jetzt.discard(key)

    def nur(self, key):
        self.setze({key})

    def alle_an(self):
        self.setze(self.verfuegbar)

    def zuruecksetzen(self):
        try:
            self.setze(self.anfangs_aktiv)
            # Zur Kontrolle wirklich lesen, nicht dem mitgefuehrten Stand glauben.
            jetzt = self.frisch_lesen()
            if jetzt != self.anfangs_aktiv:
                self.b.reste.append(
                    f"Modul-Zustand nicht wiederhergestellt: {sorted(jetzt)} "
                    f"statt {sorted(self.anfangs_aktiv)}")
                return False
            # Wiederhergestellt — der gemerkte Stand ist verbraucht.
            vergiss_module(self.api.basis)
            return True
        except Exception as e:
            self.b.reste.append(f"Modul-Zustand nicht wiederhergestellt: {e}")
            return False


# ─────────────────────── 1./2. Alleinstellung und Inhalt ───────────────────────

def teste_alleinstellung(api, b, u, sch, spuren, nur_modul=None):
    alle_endpunkte = endpunkte(u)
    alle_tore = tore(u)
    unbekannt = [m["key"] for m in sch.module if m["key"] not in alle_endpunkte]
    if unbekannt:
        b.add("Register", "REGISTRY gegen Test", False,
              f"ohne Probe im Systemtest: {', '.join(unbekannt)} — "
              "neues Modul, aber keine Endpunktliste in scripts/systemtest.py")

    for m in sch.module:
        key, name = m["key"], m.get("name", m["key"])
        if nur_modul and key != nur_modul:
            continue
        if not m.get("available"):
            b.add(f"Modul {name}", "verfuegbar", True, "im Register, aber nicht waehlbar")
            continue
        if key not in alle_endpunkte:
            continue
        meine = alle_endpunkte[key]
        if not meine and INHALT.get(key) is None:
            b.add(f"Modul {name}", "Backend", True,
                  "kein API-Anteil — der Nachweis haengt allein am Browser-Test "
                  "(systemtest-browser.mjs, laeuft im selben Durchlauf mit)")
            continue

        sch.nur(key)   # NUR dieses Modul — alles andere aus.

        def eigene():
            tot = []
            for methode, pfad in meine:
                status, text = api.call(methode, pfad, roh=True)
                if not (200 <= status < 300):
                    tot.append(f"{pfad} -> {status} {text[:60]}")
            if tot:
                raise AssertionError("antwortet nicht: " + "; ".join(tot))
            return f"{len(meine)} Endpunkte antworten, ohne dass ein anderes Modul laeuft"

        b.pruefe(f"Modul {name}", "Eigene Endpunkte allein lauffaehig", eigene)

        def fremde():
            # Regel 3: ohne Aktivierung nichts. Nicht 200 (Daten offen), nicht
            # 500 (Schranke kracht statt abzuweisen) — genau 403.
            offen, kaputt = [], []
            gezaehlt = 0
            for anderer, wege in alle_tore.items():
                if anderer == key:
                    continue
                for methode, pfad in wege:
                    gezaehlt += 1
                    status, _ = api.call(methode, pfad, roh=True)
                    if status == 403:
                        continue
                    (offen if 200 <= status < 300 else kaputt).append(
                        f"{anderer}: {pfad} -> {status}")
            probleme = []
            if offen:
                probleme.append("ohne Aktivierung erreichbar: " + ", ".join(offen))
            if kaputt:
                probleme.append("weder 200 noch 403: " + ", ".join(kaputt))
            if probleme:
                raise AssertionError(" | ".join(probleme))
            return f"{gezaehlt} fremde Endpunkte, alle 403"

        b.pruefe(f"Modul {name}", "Fremde Endpunkte gesperrt (Regel 3)", fremde)

        probe = INHALT.get(key)
        if probe is not None:
            b.pruefe(f"Modul {name}", "Inhalt anlegen und wiederfinden",
                     lambda p=probe: p(api, u, spuren))


# ─────────────────────── 3. CardVote vollstaendig ───────────────────────

def teste_zugang_dicht(api, b, u, sch, spuren):
    """Ausgeteilte Zugaenge muessen mit dem Modul verstummen.

    Ein QR-Code haengt im Ordner des Kindes und laesst sich nicht einsammeln.
    Wer Karteikarten abschaltet, erwartet, dass ueber die verteilten Links
    nichts mehr zu holen ist — weder Kartentexte noch Lernstand. Und wer sie
    wieder einschaltet, erwartet, dass dieselben Zettel weiter gelten: sonst
    waere jedes Abschalten ein versehentliches Einsammeln aller Ausdrucke.

    Geprueft wird beides, und zwar mit einem ECHTEN Token — nicht mit einem
    erfundenen: ein erfundener wird ohnehin abgewiesen und beweist nichts.
    """
    anonym = Api(api.basis, debug=api.debug)
    sch.nur("karten")
    stapel = api.call("POST", f"/api/karten/classes/{u.class_id}/decks",
                      {"name": f"{PRAEFIX} Zugangsprobe"}, erwartet=(201,))
    spuren.append(("Zugangs-Stapel", lambda: (
        api.call("DELETE", f"/api/karten/decks/{stapel['id']}", erwartet=(204, 404)),
        api.call("DELETE", f"/api/karten/decks/{stapel['id']}/purge", erwartet=(204, 404)))))
    api.call("POST", f"/api/karten/decks/{stapel['id']}/cards",
             {"front": "GEHEIM-VORNE", "back": "GEHEIM-HINTEN"}, erwartet=(201,))
    api.call("POST", f"/api/karten/decks/{stapel['id']}/release", {"now": True}, erwartet=(200,))
    zugaenge = api.call("POST", f"/api/karten/classes/{u.class_id}/tokens", erwartet=(200, 201))
    eintrag = _finde(zugaenge, student_id=u.students[0])
    if not eintrag:
        raise AssertionError("kein Zugang erzeugt")
    token = eintrag["token"]

    def offen():
        stand = anonym.call("GET", f"/api/karten/lernen/{token}", erwartet=(200,))
        if not any(c["front"] == "GEHEIM-VORNE" for c in stand.get("cards") or []):
            raise AssertionError("Karte fehlt, obwohl das Modul laeuft")
        return "mit Modul: Karten kommen an"

    def zu():
        sch.nur("auswertung")   # Karten UND CardVote aus
        status, text = anonym.call("GET", f"/api/karten/lernen/{token}", roh=True)
        if status < 400:
            raise AssertionError(f"abgeschaltetes Modul liefert weiter (HTTP {status})")
        if "GEHEIM" in text:
            raise AssertionError("Karteninhalte stehen trotz abgeschaltetem Modul in der Antwort")
        status, _ = anonym.call("POST", f"/api/karten/lernen/{token}/review",
                                {"card_id": 1, "grade": 2}, roh=True)
        if status < 400:
            raise AssertionError(f"Schreiben trotz abgeschaltetem Modul moeglich (HTTP {status})")
        status, _ = anonym.call("GET", f"/api/karten/lernen/{token}/results", roh=True)
        if status < 400:
            raise AssertionError(f"Testergebnisse trotz abgeschaltetem CardVote (HTTP {status})")
        return "ohne Modul: 401 und keine Inhalte in der Antwort"

    def wieder():
        sch.nur("karten")
        stand = anonym.call("GET", f"/api/karten/lernen/{token}", erwartet=(200,))
        if not (stand.get("cards") or []):
            raise AssertionError("derselbe Zugang gilt nach dem Wiedereinschalten nicht mehr")
        return "nach dem Wiedereinschalten gilt derselbe Zettel"

    def frisch():
        # Rotation macht den alten Ausdruck tot — sonst gaebe es keinen Weg
        # zurueck, wenn ein Link im Klassenchat gelandet ist.
        neu = api.call("POST", f"/api/karten/classes/{u.class_id}/tokens/rotate", erwartet=(200,))
        neuer = _finde(neu, student_id=u.students[0])
        if not neuer or neuer["token"] == token:
            raise AssertionError("Rotation vergibt denselben Token")
        status, _ = anonym.call("GET", f"/api/karten/lernen/{token}", roh=True)
        if status < 400:
            raise AssertionError(f"alter Token lebt nach der Rotation weiter (HTTP {status})")
        alle = {x["token"] for x in neu}
        if len(alle) != len(neu):
            raise AssertionError("zwei Kinder haben denselben Zugang bekommen")
        return f"alter Zettel tot, {len(alle)} neue und alle verschieden"

    b.pruefe("Zugaenge", "Mit Modul erreichbar", offen)
    b.pruefe("Zugaenge", "Ohne Modul dicht", zu)
    b.pruefe("Zugaenge", "Wieder an: derselbe Zettel gilt", wieder)
    b.pruefe("Zugaenge", "Rotation macht alte Codes tot", frisch)
    api.call("DELETE", f"/api/karten/decks/{stapel['id']}", erwartet=(204, 404))
    api.call("DELETE", f"/api/karten/decks/{stapel['id']}/purge", erwartet=(204, 404))


def teste_cardvote_voll(api, b, u, sch, spuren):
    """Ein ganzer Test von der Frage bis zur gerechneten Auswertung.

    Vier Fragen, davon zwei als E (Zusatz) markiert. Drei Kinder: eines im
    E-Kurs (fuer das alles regulaer zaehlt), zwei im G-Kurs (fuer die nur die
    G-Fragen die 100 % bilden, richtige E-Antworten geben Bonus). Die
    erwarteten Zahlen rechnet der Test selbst — Regeln siehe
    apps/api/app/scoring.py.
    """
    sch.nur("cardvote")
    zustand = {}

    def aufbau():
        ordner = api.call("POST", "/api/folders", {"name": f"{PRAEFIX} Ordner"}, erwartet=(201,))
        spuren.append(("CardVote-Ordner", lambda: api.call(
            "DELETE", f"/api/folders/{ordner['id']}", erwartet=(204, 404))))
        fragen = []
        for i, richtig in enumerate("ABCD"):
            q = api.call("POST", "/api/questions", {
                "text": f"{PRAEFIX} Frage {i + 1}", "question_type": "mc",
                "choices": {"A": "1", "B": "2", "C": "3", "D": "4"},
                "correct_answer": richtig, "topic_id": u.topic_id,
            }, erwartet=(201,))
            fragen.append(q)
            spuren.append((f"Frage {i + 1}", lambda qq=q: api.call(
                "DELETE", f"/api/questions/{qq['id']}", erwartet=(204, 404))))
        # Fragen 3 und 4 sind E-Anforderung — am Set-Eintrag, nicht an der Frage.
        satz = api.call("POST", "/api/question-sets", {
            "name": f"{PRAEFIX} Quiz", "folder_id": ordner["id"],
            "question_ids": [q["id"] for q in fragen],
            "niveau_aktiv": True, "minuspunkte": False,
            "niveaus": {str(fragen[2]["id"]): "E", str(fragen[3]["id"]): "E"},
        }, erwartet=(201,))
        spuren.append(("Quiz", lambda: api.call(
            "DELETE", f"/api/question-sets/{satz['id']}", erwartet=(204, 404))))
        gelesen = api.call("GET", f"/api/question-sets/{satz['id']}", erwartet=(200,))
        if not gelesen.get("niveau_aktiv"):
            raise AssertionError("E/G-Differenzierung am Quiz nicht gespeichert")
        # Das Niveau haengt am Set-Eintrag (dieselbe Frage kann anderswo
        # Anforderung sein); ausgeliefert wird es als {frage_id: "E"|"G"}.
        niveaus = gelesen.get("niveaus") or {}
        e_fragen = {k for k, v in niveaus.items() if v == "E"}
        soll = {str(fragen[2]["id"]), str(fragen[3]["id"])}
        if e_fragen != soll:
            raise AssertionError(f"E-Markierung am Set-Eintrag verloren: {niveaus} "
                                 f"— E erwartet fuer {sorted(soll)}")
        zustand["fragen"] = fragen
        zustand["satz"] = satz
        return f"Ordner, 4 Fragen, Quiz mit E/G (Frage 3+4 = E)"

    if not b.pruefe("CardVote", "Fragen und Quiz mit E/G", aufbau):
        return zustand

    # Antworten je Kind (card_id) und Frage-Position. Richtig ist A,B,C,D.
    ANTWORTEN = {
        1: ["A", "B", "C", "A"],   # Anna (E): 3 richtig, Frage 4 falsch
        2: ["A", "A", "C", "D"],   # Ben  (G): G falsch bei 2, beide E richtig
        3: ["A", "B", "A", "A"],   # Cem  (G): beide G richtig, beide E falsch
    }

    def sitzung_und_scans():
        s = api.call("POST", "/api/sessions", {
            "name": f"{PRAEFIX} Test", "class_id": u.class_id,
            "question_set_id": zustand["satz"]["id"], "mode": "test",
        }, erwartet=(201,))
        zustand["sitzung"] = s
        spuren.append(("Sitzung", lambda: api.call(
            "DELETE", f"/api/sessions/{s['id']}", erwartet=(204, 404))))
        gezaehlt = 0
        for pos, frage in enumerate(zustand["fragen"]):
            api.call("POST", f"/api/sessions/{s['id']}/set-question?question_id={frage['id']}",
                     erwartet=(200,))
            for card_id, antworten in ANTWORTEN.items():
                api.call("POST", "/api/scan", {
                    "session_id": s["id"], "student_id": card_id, "answer": antworten[pos],
                }, erwartet=(201,))
                gezaehlt += 1
        api.call("POST", f"/api/sessions/{s['id']}/finish", erwartet=(200,))
        beendet = api.call("GET", f"/api/sessions/{s['id']}", erwartet=(200,))
        if beendet.get("status") != "finished":
            raise AssertionError(f"Sitzung steht auf '{beendet.get('status')}' statt 'finished'")
        return f"{gezaehlt} Scans ueber 4 Fragen und 3 Kinder, Sitzung beendet"

    if not b.pruefe("CardVote", "Sitzung, Scans, Abschluss", sitzung_und_scans):
        return zustand

    def trefferquoten():
        """Je Frage: wie viele der drei Kinder haben richtig geantwortet?
        Gegen die Rohdaten (/results) UND gegen die Auswertung gehalten."""
        soll = []
        for pos, richtig in enumerate("ABCD"):
            soll.append(sum(1 for a in ANTWORTEN.values() if a[pos] == richtig))
        if soll != [3, 2, 2, 1]:
            raise AssertionError(f"Testdaten falsch angelegt: {soll}")
        ausw = api.call("GET", f"/api/sessions/{zustand['sitzung']['id']}/evaluation",
                        erwartet=(200,))
        zustand["auswertung"] = ausw
        ist = []
        for frage in zustand["fragen"]:
            treffer = 0
            for zeile in ausw["students"]:
                a = _finde(zeile["answers"], question_id=frage["id"])
                if a and a["is_correct"]:
                    treffer += 1
            ist.append(treffer)
        if ist != soll:
            raise AssertionError(f"Trefferquote je Frage {ist} statt {soll}")
        # Rueckmeldung je Kind: dieselbe Punktzahl wie in der Auswertung — sie
        # steht auf dem Blatt, das ausgeteilt wird, UND auf der Schuelerseite
        # hinter dem QR-Code. Zwei Rechnungen waeren zwei Wahrheiten.
        rm = api.call("GET", f"/api/sessions/{zustand['sitzung']['id']}/rueckmeldung",
                      erwartet=(200,))
        for zeile in rm.get("students") or []:
            aus_ausw = _finde(ausw["students"], card_id=zeile["card_id"])
            if not aus_ausw or not gleich(aus_ausw["score"], zeile["punkte"]):
                raise AssertionError(
                    f"Rueckmeldung rechnet anders als die Auswertung: "
                    f"{zeile['name']} {zeile['punkte']} statt {aus_ausw and aus_ausw['score']}")
        if not rm.get("students"):
            raise AssertionError("Rueckmeldung leer, obwohl gescannt wurde")
        # Notenverlauf: dieselbe Erhebung muss dort mit derselben Prozentzahl
        # auftauchen. Er ist eine KERN-Sicht (kein 403 ohne Modul) und fasst
        # Quizze und Klassenarbeiten auf einer Achse zusammen — eine dritte
        # Rechnung waere eine dritte Wahrheit.
        verlauf = api.call("GET", f"/api/classes/{u.class_id}/notenverlauf", erwartet=(200,))
        sid = zustand["sitzung"]["id"]
        if not _finde(verlauf.get("erhebungen"), quelle="cardvote", id=sid):
            raise AssertionError("Sitzung fehlt in den Erhebungen des Notenverlaufs")
        for sch in verlauf.get("schueler") or []:
            im_verlauf = next((w for w in sch["werte"] if w["quelle"] == "cardvote" and w["id"] == sid), None)
            aus_rm = _finde(rm["students"], student_id=sch["student_id"])
            if im_verlauf and aus_rm and im_verlauf["pct"] != aus_rm["pct"]:
                raise AssertionError(
                    f"Notenverlauf rechnet anders als die Rueckmeldung: {sch['name']} "
                    f"{im_verlauf['pct']} % statt {aus_rm['pct']} %")
        # Zweite Quelle: die rohen Scans zaehlen dasselbe.
        roh = api.call("GET", f"/api/sessions/{zustand['sitzung']['id']}/results"
                              f"?question_id={zustand['fragen'][0]['id']}", erwartet=(200,))
        if roh["counts"]["A"] != 3:
            raise AssertionError(f"Rohdaten zaehlen {roh['counts']} statt 3x A bei Frage 1")
        return f"Frage 1–4 richtig von 3: {ist} — Auswertung und Rohdaten stimmen ueberein"

    b.pruefe("CardVote", "Trefferquote je Frage", trefferquoten)

    def eg_wertung():
        """Die E/G-Regel von Hand nachgerechnet.

        Anna (E-Kurs): differenziert wird nicht, alle 4 Fragen zaehlen.
        Ben/Cem (G-Kurs): Basis sind die Fragen 1+2, Fragen 3+4 geben Bonus.
        """
        ausw = zustand["auswertung"]
        if not ausw.get("niveau_aktiv"):
            raise AssertionError("Auswertung meldet niveau_aktiv=false trotz E/G-Quiz")

        # Anna: 3 von 4 richtig = 75,0 %, kein Bonus (E-Kurs kennt keinen).
        anna = {"base_pct": 75.0, "bonus_pct": 0.0, "pct": 75.0, "score": 3, "total": 4,
                "e_total": 0}
        # Ben: Basis 1 von 2 = 50,0 %. Zwei richtige E-Antworten (>= 2, keine
        # falsche) -> voller Bonus bis zur naechsten Stufe: 59 - 50 = 9,0.
        ben_basis = 50.0
        ben_bonus = 1.0 * naechste_stufe(ben_basis)
        ben = {"base_pct": ben_basis, "bonus_pct": ben_bonus, "pct": ben_basis + ben_bonus,
               "score": 1, "total": 2, "e_total": 2}
        # Cem: Basis 2 von 2 = 100 %. Beide E falsch -> kein Bonus (erst ab zwei
        # richtigen E-Antworten gibt es ueberhaupt welchen).
        cem = {"base_pct": 100.0, "bonus_pct": 0.0, "pct": 100.0, "score": 2, "total": 2,
               "e_total": 2}

        abweichung = []
        for card_id, soll in ((1, anna), (2, ben), (3, cem)):
            zeile = _finde(ausw["students"], card_id=card_id)
            if not zeile:
                raise AssertionError(f"Kind mit Karte {card_id} fehlt in der Auswertung")
            for feld, wert in soll.items():
                if not gleich(zeile.get(feld, -999), wert, 0.05):
                    abweichung.append(f"Karte {card_id} {feld}={zeile.get(feld)} statt {wert}")
            if zeile.get("status") != "anwesend":
                abweichung.append(f"Karte {card_id} gilt als {zeile.get('status')}")
        if abweichung:
            raise AssertionError("; ".join(abweichung))
        return (f"E-Kind 75,0 %; G-Kind mit 2 E-Treffern 50,0 + {ben_bonus:.1f} Bonus = "
                f"{ben['pct']:.1f} %; G-Kind ohne E-Treffer 100,0 % ohne Bonus")

    b.pruefe("CardVote", "E/G-Wertung (Bonus gerechnet)", eg_wertung)

    def notenverteilung():
        """Aus den Prozentwerten die Noten nach DEFAULT_SCALE — und zaehlen."""
        ausw = zustand["auswertung"]
        noten = {}
        for zeile in ausw["students"]:
            if zeile["status"] != "anwesend":
                continue
            g = note_aus_prozent(zeile["pct"])
            noten[zeile["card_id"]] = g
        soll = {1: 2, 2: 3, 3: 1}   # 75 % -> 2, 59 % -> 3, 100 % -> 1
        if noten != soll:
            raise AssertionError(f"Noten {noten} statt {soll}")
        verteilung = {g: sum(1 for x in noten.values() if x == g) for g in sorted(set(noten.values()))}
        if verteilung != {1: 1, 2: 1, 3: 1}:
            raise AssertionError(f"Notenverteilung {verteilung} statt je einmal 1, 2, 3")
        zustand["noten"] = noten
        return f"Verteilung {verteilung} (je einmal Note 1, 2 und 3)"

    b.pruefe("CardVote", "Notenverteilung", notenverteilung)

    def minuspunkte():
        """Minuspunkte am Quiz einschalten und dieselbe Sitzung neu bewerten.

        Eine falsche Antwort kostet ihr Gewicht, unter 0 geht es nie. Erwartet:
        Anna 3 richtig - 1 falsch = 2 von 4 = 50,0 %. Ben 1 richtig - 1 falsch
        = 0 von 2 = 0,0 %, dazu voller E-Bonus bis zur naechsten Stufe (20).
        Cem unveraendert 100,0 %.
        """
        satz = zustand["satz"]
        api.call("PUT", f"/api/question-sets/{satz['id']}", {
            "name": f"{PRAEFIX} Quiz", "folder_id": satz.get("folder_id"),
            "question_ids": [q["id"] for q in zustand["fragen"]],
            "niveau_aktiv": True, "minuspunkte": True,
        }, erwartet=(200,))
        ausw = api.call("GET", f"/api/sessions/{zustand['sitzung']['id']}/evaluation",
                        erwartet=(200,))
        if not ausw.get("minuspunkte"):
            raise AssertionError("Auswertung meldet minuspunkte=false nach dem Einschalten")
        ben_bonus = 1.0 * naechste_stufe(0.0)
        soll = {1: (50.0, 0.0), 2: (0.0, ben_bonus), 3: (100.0, 0.0)}
        abweichung = []
        for card_id, (basis, bonus) in soll.items():
            zeile = _finde(ausw["students"], card_id=card_id)
            if not gleich(zeile["base_pct"], basis, 0.05):
                abweichung.append(f"Karte {card_id} base_pct={zeile['base_pct']} statt {basis}")
            if not gleich(zeile["bonus_pct"], bonus, 0.05):
                abweichung.append(f"Karte {card_id} bonus_pct={zeile['bonus_pct']} statt {bonus}")
            if zeile["score"] < 0:
                abweichung.append(f"Karte {card_id} hat negative Punkte ({zeile['score']})")
        if abweichung:
            raise AssertionError("; ".join(abweichung))
        # Wieder abschalten: die spaeteren Pruefungen rechnen ohne Abzug.
        api.call("PUT", f"/api/question-sets/{satz['id']}", {
            "name": f"{PRAEFIX} Quiz", "folder_id": satz.get("folder_id"),
            "question_ids": [q["id"] for q in zustand["fragen"]],
            "niveau_aktiv": True, "minuspunkte": False,
        }, erwartet=(200,))
        return "Abzug wirkt (50/0/100 %), Punkte bleiben >= 0, E-Bonus bleibt unangetastet"

    b.pruefe("CardVote", "Minuspunkte", minuspunkte)

    def krank():
        """Wer nichts abgegeben hat, ist krank und bleibt draussen — bis die
        Lehrkraft ihn auf anwesend stellt. Geprueft am vierten Kind, das es in
        der Klasse nicht gibt: statt dessen wird Karte 3 auf krank gesetzt."""
        sid = zustand["sitzung"]["id"]
        api.call("PUT", f"/api/sessions/{sid}/eval-config", {"krank": [3]}, erwartet=(200,))
        ausw = api.call("GET", f"/api/sessions/{sid}/evaluation", erwartet=(200,))
        zeile = _finde(ausw["students"], card_id=3)
        if zeile["status"] != "krank":
            raise AssertionError(f"auf krank gesetztes Kind gilt als {zeile['status']}")
        api.call("PUT", f"/api/sessions/{sid}/eval-config", {}, erwartet=(200,))
        zurueck = _finde(api.call("GET", f"/api/sessions/{sid}/evaluation",
                                  erwartet=(200,))["students"], card_id=3)
        if zurueck["status"] != "anwesend":
            raise AssertionError("Zuruecksetzen der Krank-Markierung wirkt nicht")
        return "krank/anwesend schaltet die Wertung wie dokumentiert"

    b.pruefe("CardVote", "Krank bleibt aus der Wertung", krank)
    return zustand


# ─────────────────────── 4. Noten anpassen ───────────────────────

def teste_noten(api, b, u, sch, spuren, cv):
    """Vom uebernommenen Testergebnis bis zum gewichteten Schnitt.

    Gerechnet wird im Test: zwei Abschnitte mit 60 und 40 Prozent, daraus die
    Erwartung fuer `weighted`. Beobachtungen duerfen daran nichts aendern.
    """
    if "sitzung" not in cv or "noten" not in cv:
        b.add("Noten", "alle", False,
              "uebersprungen — der CardVote-Teil hat keine Sitzung geliefert")
        return
    sch.setze({"auswertung"})
    z = {}

    def uebernehmen():
        # Die Rechnung weiter unten gilt nur, wenn keine fremden Abschnitte
        # mitgewichtet werden — sonst wuerde der Test seine eigene Erwartung
        # verbiegen, statt einen Unterschied zu melden.
        vorhanden = api.call("GET", f"/api/noten/classes/{u.class_id}/sections", erwartet=(200,))
        if vorhanden:
            raise AssertionError(
                f"die Testklasse hat schon {len(vorhanden)} Notenabschnitt(e) "
                f"({[s['name'] for s in vorhanden]}) — der Test raeumt nicht auf")
        block = api.call("POST", f"/api/noten/classes/{u.class_id}/sections",
                         {"name": f"{PRAEFIX} Schriftlich", "weight": 60}, erwartet=(201,))
        z["schriftlich"] = block["id"]
        spuren.append(("Notenblock schriftlich", lambda: api.call(
            "DELETE", f"/api/noten/sections/{block['id']}", erwartet=(204, 404))))
        antwort = api.call("POST", "/api/noten/import-session", {
            "session_id": cv["sitzung"]["id"], "section_id": block["id"],
            "column_name": f"{PRAEFIX} Test",
            "grades": [{"card_id": c, "value": float(g)} for c, g in cv["noten"].items()],
        }, erwartet=(201,))
        if antwort.get("imported") != 3:
            raise AssertionError(f"{antwort.get('imported')} Noten uebernommen statt 3")
        # Unabhaengig nachsehen: Spalte da, Werte je Kind richtig zugeordnet?
        abschnitte = api.call("GET", f"/api/noten/classes/{u.class_id}/sections", erwartet=(200,))
        sec = _finde(abschnitte, id=block["id"])
        spalte = _finde(sec.get("categories") or [], name=f"{PRAEFIX} Test")
        if not spalte:
            raise AssertionError(f"uebernommene Spalte fehlt im Abschnitt: {sec}")
        z["test_spalte"] = spalte["id"]
        eintraege = api.call("GET", f"/api/noten/classes/{u.class_id}/entries", erwartet=(200,))
        haben = {e["student_id"]: e["value"] for e in eintraege
                 if e["category_id"] == spalte["id"]}
        soll = {u.students[i]: float(cv["noten"][i + 1]) for i in range(3)}
        if haben != soll:
            raise AssertionError(f"Noten je Kind {haben} statt {soll}")
        # Zweimal uebernehmen wuerde denselben Test doppelt zaehlen.
        status, _ = api.call("POST", "/api/noten/import-session", {
            "session_id": cv["sitzung"]["id"], "section_id": block["id"],
            "column_name": f"{PRAEFIX} Test 2",
            "grades": [{"card_id": 1, "value": 2.0}],
        }, roh=True)
        if status != 409:
            raise AssertionError(f"zweite Uebernahme derselben Sitzung: HTTP {status} statt 409")
        return f"3 Noten uebernommen ({soll}), zweite Uebernahme abgelehnt"

    if not b.pruefe("Noten", "Ergebnis als Spalte uebernehmen", uebernehmen):
        return

    def note_aendern():
        # Anna von 2 auf 3,0 — es darf KEINE zweite Zelle entstehen.
        api.call("POST", "/api/noten/entries", {
            "category_id": z["test_spalte"], "student_id": u.students[0],
            "kind": "grade", "value": 3.0,
        }, erwartet=(201,))
        eintraege = [e for e in api.call("GET", f"/api/noten/classes/{u.class_id}/entries",
                                         erwartet=(200,))
                     if e["category_id"] == z["test_spalte"] and e["student_id"] == u.students[0]]
        if len(eintraege) != 1:
            raise AssertionError(f"{len(eintraege)} Eintraege in einer Zelle — eine Note je Zelle")
        if not gleich(eintraege[0]["value"], 3.0):
            raise AssertionError(f"Note steht auf {eintraege[0]['value']} statt 3,0")
        zeile = _finde(api.call("GET", f"/api/noten/classes/{u.class_id}/summary", erwartet=(200,)),
                       student_id=u.students[0])
        if not gleich(zeile["per_category"][str(z["test_spalte"])], 3.0):
            raise AssertionError("geaenderte Note kommt in der Zusammenfassung nicht an")
        return "Note 2,0 -> 3,0 ersetzt die Zelle (kein zweiter Eintrag)"

    b.pruefe("Noten", "Einzelne Note aendern", note_aendern)

    def beobachtung():
        # Beobachtung OHNE Notenwert: erlaubt, zaehlt aber nie mit.
        vorher = _finde(api.call("GET", f"/api/noten/classes/{u.class_id}/summary", erwartet=(200,)),
                        student_id=u.students[0])
        api.call("POST", "/api/noten/entries", {
            "category_id": z["test_spalte"], "student_id": u.students[0],
            "kind": "observation", "note": f"{PRAEFIX} strengt sich an",
        }, erwartet=(201,))
        nachher = _finde(api.call("GET", f"/api/noten/classes/{u.class_id}/summary", erwartet=(200,)),
                         student_id=u.students[0])
        if nachher["observations"] != vorher["observations"] + 1:
            raise AssertionError("Beobachtung wird nicht gezaehlt")
        if nachher["per_category"] != vorher["per_category"] \
                or nachher["weighted"] != vorher["weighted"]:
            raise AssertionError(f"Beobachtung hat den Schnitt veraendert: "
                                 f"{vorher['weighted']} -> {nachher['weighted']}")
        # Mit Notenwert muss sie abgewiesen werden — sonst erodiert die Trennung.
        status, _ = api.call("POST", "/api/noten/entries", {
            "category_id": z["test_spalte"], "student_id": u.students[1],
            "kind": "observation", "value": 3.0,
        }, roh=True)
        if status < 400:
            raise AssertionError(f"Beobachtung mit Notenwert angenommen (HTTP {status})")
        return "Beobachtung gezaehlt, Schnitt unveraendert, Beobachtung mit Note abgewiesen"

    b.pruefe("Noten", "Beobachtung zaehlt nie mit", beobachtung)

    def kommentar():
        """Kommentar an der Zelle: gehoert zur Note, zaehlt nie mit.

        Seit das Modul „Beobachtungen" weg ist, haengt die Bemerkung an der
        Zelle. Geprueft wird beides: sie kommt zurueck, und der Schnitt bleibt
        unveraendert — sonst waere aus einer Notiz eine Note geworden.
        """
        vorher = _finde(api.call("GET", f"/api/noten/classes/{u.class_id}/summary", erwartet=(200,)),
                        student_id=u.students[1])
        api.call("PUT", "/api/noten/entries/comment", {
            "category_id": z["test_spalte"], "student_id": u.students[1],
            "text": f"{PRAEFIX} krank, nachgeschrieben",
        }, erwartet=(200,))
        eintraege = api.call("GET", f"/api/noten/classes/{u.class_id}/entries", erwartet=(200,))
        meiner = [e for e in eintraege
                  if e["category_id"] == z["test_spalte"] and e["student_id"] == u.students[1]]
        if not meiner or PRAEFIX not in (meiner[0].get("note") or ""):
            raise AssertionError(f"Kommentar nicht wiedergefunden: {meiner}")
        nachher = _finde(api.call("GET", f"/api/noten/classes/{u.class_id}/summary", erwartet=(200,)),
                         student_id=u.students[1])
        if nachher["weighted"] != vorher["weighted"]:
            raise AssertionError(f"Kommentar hat den Schnitt veraendert: "
                                 f"{vorher['weighted']} -> {nachher['weighted']}")
        # Leerer Text loescht ihn wieder.
        api.call("PUT", "/api/noten/entries/comment", {
            "category_id": z["test_spalte"], "student_id": u.students[1], "text": "",
        }, erwartet=(200,))
        rest = [e for e in api.call("GET", f"/api/noten/classes/{u.class_id}/entries", erwartet=(200,))
                if e["category_id"] == z["test_spalte"] and e["student_id"] == u.students[1]
                and (e.get("note") or "").strip()]
        if rest:
            raise AssertionError(f"Kommentar liess sich nicht loeschen: {rest}")
        return "Kommentar an der Zelle gespeichert, Schnitt unveraendert, wieder geloescht"

    b.pruefe("Noten", "Kommentar an der Notenzelle", kommentar)

    def gewichte():
        """Zweiter Abschnitt mit 40 %, dann den gewichteten Schnitt nachrechnen."""
        block2 = api.call("POST", f"/api/noten/classes/{u.class_id}/sections",
                          {"name": f"{PRAEFIX} Sonstige", "weight": 40}, erwartet=(201,))
        z["sonstige"] = block2["id"]
        spuren.append(("Notenblock sonstige", lambda: api.call(
            "DELETE", f"/api/noten/sections/{block2['id']}", erwartet=(204, 404))))
        spalte = api.call("POST", "/api/noten/categories",
                          {"name": f"{PRAEFIX} Mitarbeit", "section_id": block2["id"]},
                          erwartet=(201,))
        werte = {u.students[0]: 2.0, u.students[1]: 4.0, u.students[2]: 1.0}
        for sid, wert in werte.items():
            api.call("POST", "/api/noten/entries", {
                "category_id": spalte["id"], "student_id": sid, "kind": "grade", "value": wert,
            }, erwartet=(201,))
        # Eigene Rechnung: Bereichsnote = Schnitt der Spalten des Bereichs,
        # Endnote = (60 * schriftlich + 40 * sonstige) / 100.
        schriftlich = {u.students[0]: 3.0,
                       u.students[1]: float(cv["noten"][2]),
                       u.students[2]: float(cv["noten"][3])}
        soll = {sid: round((schriftlich[sid] * 60 + werte[sid] * 40) / 100, 2)
                for sid in werte}
        zus = api.call("GET", f"/api/noten/classes/{u.class_id}/summary", erwartet=(200,))
        abweichung = []
        for sid, erwartet in soll.items():
            zeile = _finde(zus, student_id=sid)
            if zeile.get("unweighted_fallback"):
                abweichung.append(f"Kind {sid}: rechnet ungewichtet trotz gesetzter Gewichte")
            if not gleich(zeile.get("weighted", -1), erwartet, 0.005):
                abweichung.append(f"Kind {sid}: weighted={zeile.get('weighted')} statt {erwartet}")
            if not gleich(zeile["section_effective"].get(str(z["schriftlich"]), -1),
                          schriftlich[sid], 0.005):
                abweichung.append(f"Kind {sid}: Bereichsnote schriftlich falsch "
                                  f"({zeile['section_effective']})")
        if abweichung:
            raise AssertionError("; ".join(abweichung))
        z["soll_weighted"] = soll
        return ("60/40 gewichtet: " +
                ", ".join(f"{schriftlich[s]}/{werte[s]} -> {soll[s]}" for s in soll))

    b.pruefe("Noten", "Gewichteter Schnitt gegen eigene Rechnung", gewichte)

    def endnote():
        if "soll_weighted" not in z:
            raise AssertionError("uebersprungen — der Gewichte-Teil oben ist nicht durchgelaufen")
        sid = u.students[0]
        api.call("PUT", "/api/noten/overrides", {
            "class_id": u.class_id, "student_id": sid, "value": 1.7, "term": "1",
        }, erwartet=(204,))
        zeile = _finde(api.call("GET", f"/api/noten/classes/{u.class_id}/summary", erwartet=(200,)),
                       student_id=sid)
        if not gleich(zeile.get("total_override", -1), 1.7):
            raise AssertionError(f"Endnote steht auf {zeile.get('total_override')} statt 1,7")
        # Der gerechnete Schnitt bleibt daneben stehen — die Note ist eine
        # Entscheidung, keine Ueberschreibung der Rechnung.
        if not gleich(zeile["weighted"], z["soll_weighted"][sid], 0.005):
            raise AssertionError("die Endnote hat den gerechneten Schnitt ueberschrieben")
        api.call("DELETE", f"/api/noten/overrides?class_id={u.class_id}&student_id={sid}&term=1",
                 erwartet=(204,))
        zeile = _finde(api.call("GET", f"/api/noten/classes/{u.class_id}/summary", erwartet=(200,)),
                       student_id=sid)
        if zeile.get("total_override") is not None:
            raise AssertionError(f"Endnote nicht entfernt: {zeile.get('total_override')}")
        return "Endnote 1,7 gesetzt (Schnitt bleibt daneben) und wieder entfernt"

    b.pruefe("Noten", "Endnote setzen und entfernen", endnote)


# ─────────────────────── 5. Bruecken zwischen Modulen ───────────────────────

def teste_bruecken(api, b, u, sch, spuren, cv):
    """Jede Bruecke zweimal: mit beiden Modulen muss sie wirken, mit nur einem
    darf sie NICHTS tun — und nichts halb tun. Wer die Bruecke besitzt, weist
    ohne sein eigenes Modul mit 403 ab."""

    # ── Bruecke 1: CardVote-Ergebnis -> Notenspalte ──
    def ergebnis_zu_note_ohne_noten():
        sch.setze({"cardvote"})
        status, _ = api.call("POST", "/api/noten/import-session", {
            "session_id": cv["sitzung"]["id"], "section_id": 1,
            "column_name": f"{PRAEFIX} darf nicht", "grades": [{"card_id": 1, "value": 2.0}],
        }, roh=True)
        if status != 403:
            raise AssertionError(f"Uebernahme ohne Modul Auswertung: HTTP {status} statt 403")
        return "ohne Auswertung 403 — keine Spalte entsteht"

    if "sitzung" in cv:
        b.pruefe("Bruecken", "Ergebnis -> Note: ohne Auswertung gesperrt",
                 ergebnis_zu_note_ohne_noten)
        b.add("Bruecken", "Ergebnis -> Note: mit beiden Modulen", True,
              "im Noten-Teil belegt (3 Noten uebernommen, zweite Uebernahme 409)")

    # ── Bruecke 2: Kalender plant Quiz / Deck / Lernleiter ──
    z = {}

    def kalender_plant():
        sch.setze({"kalender", "cardvote", "karten", "lernpfad"})
        pfad = api.call("POST", "/api/lernpfad/paths", {"name": f"{PRAEFIX} Bruecken-Pfad"},
                        erwartet=(201,))
        spuren.append(("Bruecken-Lernpfad", lambda: (
            api.call("DELETE", f"/api/lernpfad/paths/{pfad['id']}", erwartet=(204, 404)),
            api.call("DELETE", f"/api/lernpfad/paths/{pfad['id']}/purge", erwartet=(204, 404)))))
        leiter = api.call("POST", f"/api/lernpfad/paths/{pfad['id']}/ladders",
                          {"class_id": u.class_id, "topic_id": u.topic_id}, erwartet=(201,))
        deck = api.call("POST", f"/api/karten/classes/{u.class_id}/decks",
                        {"name": f"{PRAEFIX} Bruecken-Stapel"}, erwartet=(201,))
        z["deck"] = deck["id"]
        spuren.append(("Bruecken-Stapel", lambda: (
            api.call("DELETE", f"/api/karten/decks/{deck['id']}", erwartet=(204, 404)),
            api.call("DELETE", f"/api/karten/decks/{deck['id']}/purge", erwartet=(204, 404)))))
        tag = datetime.now().replace(hour=10, minute=0, second=0, microsecond=0)
        eintrag = api.call("POST", "/api/kalender/entries", {
            "date": tag.isoformat(), "title": f"{PRAEFIX} geplante Stunde",
            "class_id": u.class_id, "topic_id": u.topic_id,
            "cardvote_set_id": cv.get("satz", {}).get("id"),
            "karten_deck_id": deck["id"], "lernpfad_ladder_id": leiter["id"],
        }, erwartet=(201,))
        z["eintrag"] = eintrag["id"]
        spuren.append(("Bruecken-Kalendereintrag", lambda: api.call(
            "DELETE", f"/api/kalender/entries/{eintrag['id']}", erwartet=(204, 404))))
        wieder = _finde(api.call("GET", "/api/kalender/entries", erwartet=(200,)),
                        id=eintrag["id"])
        fehlt = [f for f, soll in (("karten_deck_id", deck["id"]),
                                   ("lernpfad_ladder_id", leiter["id"]),
                                   ("cardvote_set_id", cv.get("satz", {}).get("id")))
                 if soll is not None and wieder.get(f) != soll]
        if fehlt:
            raise AssertionError(f"geplante Verknuepfungen fehlen: {fehlt} in {wieder}")
        # Die Stunde weist den Stapel ihrem Kurs zu — das ist seit dem Umbau der
        # Weg, auf dem er bei Kindern ankommt (von Hand zugewiesen wird nicht
        # mehr). Ohne diese Probe waere der Stapel geplant, aber bei niemandem.
        zu = api.call("GET", f"/api/karten/decks/{deck['id']}/kurse", erwartet=(200,))
        if u.kurs_id not in (zu.get("kurs_ids") or []):
            raise AssertionError(f"die geplante Stunde hat den Stapel nicht zugewiesen: {zu}")
        return ("Quiz, Deck und Lernleiter am Eintrag gespeichert und wiedergefunden; "
                "die Stunde hat den Stapel ihrem Kurs zugewiesen")

    b.pruefe("Bruecken", "Kalender plant Quiz/Deck/Lernleiter", kalender_plant)

    def kalender_ohne_modul():
        sch.setze({"cardvote", "karten", "lernpfad"})
        status, _ = api.call("POST", "/api/kalender/entries", {
            "date": datetime.now().isoformat(), "title": f"{PRAEFIX} darf nicht",
            "class_id": u.class_id,
        }, roh=True)
        if status != 403:
            raise AssertionError(f"Kalendereintrag ohne Modul Kalender: HTTP {status} statt 403")
        return "ohne Kalender 403 — kein halb angelegter Eintrag"

    b.pruefe("Bruecken", "Kalender-Planung ohne Kalender gesperrt", kalender_ohne_modul)

    def deck_freischaltung():
        """Der Kalender schaltet ein Deck am Termintag frei — aber nur, wenn er
        selbst aktiv ist (Regel 3). Ohne Kalender bleibt der Stapel Entwurf."""
        # a) ohne Kalender: neues Deck zum Thema des Eintrags bleibt Entwurf
        sch.setze({"karten"})
        ohne = api.call("POST", f"/api/karten/classes/{u.class_id}/decks",
                        {"name": f"{PRAEFIX} ohne Kalender", "topic_id": u.topic_id},
                        erwartet=(201,))
        spuren.append(("Stapel ohne Kalender", lambda: (
            api.call("DELETE", f"/api/karten/decks/{ohne['id']}", erwartet=(204, 404)),
            api.call("DELETE", f"/api/karten/decks/{ohne['id']}/purge", erwartet=(204, 404)))))
        if ohne.get("released_at"):
            raise AssertionError("Stapel wurde ohne Modul Kalender freigeschaltet — "
                                 "die Bruecke laeuft, obwohl das Modul aus ist")
        # b) mit Kalender: derselbe Handgriff schaltet frei
        sch.setze({"karten", "kalender"})
        mit = api.call("POST", f"/api/karten/classes/{u.class_id}/decks",
                       {"name": f"{PRAEFIX} mit Kalender", "topic_id": u.topic_id},
                       erwartet=(201,))
        spuren.append(("Stapel mit Kalender", lambda: (
            api.call("DELETE", f"/api/karten/decks/{mit['id']}", erwartet=(204, 404)),
            api.call("DELETE", f"/api/karten/decks/{mit['id']}/purge", erwartet=(204, 404)))))
        frisch = _finde(api.call("GET", f"/api/karten/classes/{u.class_id}/all-decks",
                                 erwartet=(200,)), id=mit["id"])
        if not frisch or not frisch.get("released_at"):
            raise AssertionError("Stapel zum Thema eines Kalendereintrags wurde NICHT "
                                 "freigeschaltet, obwohl der Kalender laeuft")
        return "ohne Kalender Entwurf, mit Kalender am Termintag freigeschaltet"

    b.pruefe("Bruecken", "Kalender schaltet Karten-Deck frei", deck_freischaltung)

    # ── Bruecke 3: Klassenarbeit -> gezielte Wiederholung (Karten / Lernpfad) ──
    def wiederholung():
        """Aus dem Fehlerprofil einer Klassenarbeit sollen Karten wieder faellig
        und Lernpfad-Aufgaben angelegt werden — je nach aktivem Modul."""
        # Vorarbeit: ein Kind hat Karten zum Thema gelernt (sonst gibt es nichts
        # wieder faellig zu machen), und eine Arbeit, in der es dieses Thema
        # verhauen hat.
        sch.setze({"karten"})
        anonym = Api(api.basis, debug=api.debug)
        deck = api.call("POST", f"/api/karten/classes/{u.class_id}/decks",
                        {"name": f"{PRAEFIX} Wiederholung", "topic_id": u.topic_id},
                        erwartet=(201,))
        spuren.append(("Wiederholungs-Stapel", lambda: (
            api.call("DELETE", f"/api/karten/decks/{deck['id']}", erwartet=(204, 404)),
            api.call("DELETE", f"/api/karten/decks/{deck['id']}/purge", erwartet=(204, 404)))))
        karte = api.call("POST", f"/api/karten/decks/{deck['id']}/cards",
                         {"front": "9*9", "back": "81"}, erwartet=(201,))
        api.call("POST", f"/api/karten/decks/{deck['id']}/release", {"now": True}, erwartet=(200,))
        token = _finde(api.call("POST", f"/api/karten/classes/{u.class_id}/tokens",
                                erwartet=(200, 201)), student_id=u.students[0])["token"]
        anonym.call("POST", f"/api/karten/lernen/{token}/review",
                    {"card_id": karte["id"], "grade": 3}, erwartet=(200,))

        sch.setze({"auswertung"})
        arbeit = api.call("POST", "/api/klassenarbeit/works",
                          {"class_id": u.class_id, "name": f"{PRAEFIX} Bruecken-Arbeit"},
                          erwartet=(201,))
        spuren.append(("Bruecken-Klassenarbeit", lambda: api.call(
            "DELETE", f"/api/klassenarbeit/works/{arbeit['id']}", erwartet=(204, 404))))
        api.call("PUT", f"/api/klassenarbeit/works/{arbeit['id']}", {
            "tasks": [{"id": "a1", "label": "Aufgabe 1", "topic_id": u.topic_id, "max": 4}],
            "results": {str(u.students[0]): {"a1": 0}},
        }, erwartet=(200,))

        # a) ohne Karten und ohne Lernpfad: die Bruecke darf NICHTS tun.
        leer = api.call("POST", f"/api/klassenarbeit/works/{arbeit['id']}/remediate",
                        {"threshold": 0.5, "cards": True, "exercises": True}, erwartet=(200,))
        if leer.get("cards_requeued") or leer.get("exercises_created"):
            raise AssertionError(f"Bruecke wirkte ohne die Zielmodule: {leer}")
        if leer.get("students") != 1:
            raise AssertionError(f"schwaches Kind nicht erkannt: {leer}")

        # b) mit beiden Modulen: sie muss wirken.
        sch.setze({"auswertung", "karten", "lernpfad"})
        voll = api.call("POST", f"/api/klassenarbeit/works/{arbeit['id']}/remediate",
                        {"threshold": 0.5, "cards": True, "exercises": True}, erwartet=(200,))
        if not voll.get("cards_requeued"):
            raise AssertionError(f"keine Karte wieder faellig gemacht: {voll}")
        if not voll.get("exercises_created"):
            raise AssertionError(f"keine Wiederholungsaufgabe angelegt: {voll}")
        # Unabhaengig nachsehen: steht die Aufgabe wirklich im Pool?
        aufgaben = api.call("GET", f"/api/lernpfad/exercises?topic_id={u.topic_id}",
                            erwartet=(200,))
        neu = [a for a in aufgaben if a.get("kategorie") == "Wiederholung"
               and PRAEFIX in (a.get("aufgabentext") or "")]
        if not neu:
            raise AssertionError("Wiederholungsaufgabe gemeldet, steht aber nicht im Pool")
        for a in neu:
            spuren.append((f"Wiederholungsaufgabe {a['id']}", lambda aa=a: api.call(
                "DELETE", f"/api/lernpfad/exercises/{aa['id']}", erwartet=(204, 404))))
        # Der Fortschritt selbst wird im Karten-Teil geprueft; hier zaehlt, dass
        # die Bruecke gegriffen hat (Zahl der wieder faellig gemachten Karten).
        return (f"ohne Zielmodule 0/0, mit ihnen {voll['cards_requeued']} Karten wieder "
                f"faellig und {voll['exercises_created']} Aufgabe(n) im Pool")

    b.pruefe("Bruecken", "Klassenarbeit -> Wiederholung (Karten/Lernpfad)", wiederholung)

    def wiederholung_ohne_auswertung():
        sch.setze({"karten", "lernpfad"})
        status, _ = api.call("POST", "/api/klassenarbeit/works/999999/remediate",
                             {"threshold": 0.5}, roh=True)
        if status != 403:
            raise AssertionError(f"Wiederholung ohne Modul Auswertung: HTTP {status} statt 403")
        return "ohne Auswertung 403"

    b.pruefe("Bruecken", "Wiederholung ohne Auswertung gesperrt", wiederholung_ohne_auswertung)

    # ── Bruecke 4: schwaches Thema aus CardVote ──
    def schwache_themen():
        """CardVote weist die schwachen Themen aus (Ziel 2). Der Weg muss ohne
        Lernpfad und ohne Karten vollstaendig funktionieren — sonst haengt
        CardVote an einem anderen Modul."""
        sch.setze({"cardvote"})
        stats = api.call(
            "GET", f"/api/sessions/{cv['sitzung']['id']}/topic-stats", erwartet=(200,))
        text = json.dumps(stats, ensure_ascii=False)
        if str(u.topic_id) not in text and f"{PRAEFIX} Thema" not in text:
            raise AssertionError(f"das Thema der Fragen fehlt in der Themenstatistik: {text[:200]}")
        schwach = api.call(
            "GET", f"/api/weak-topics?frm={(datetime.now() - timedelta(days=30)).isoformat()}"
                   f"&to={datetime.now().isoformat()}", erwartet=(200,))
        if not isinstance(schwach, (list, dict)):
            raise AssertionError(f"unerwartete Antwort: {schwach}")
        return "Themenstatistik und schwache Themen ohne Lernpfad/Karten abrufbar"

    if "sitzung" in cv:
        b.pruefe("Bruecken", "Schwache Themen (CardVote allein)", schwache_themen)

    # ── Bruecke 5: Karten-Fortschritt speist die schwachen Themen ──
    def karten_in_schwache_themen():
        """Ein Thema, an dem beim Karten-Ueben immer wieder gepatzt wird, gehoert
        in den Wiederholungs-Vorschlag. Ohne das Modul Karten darf es dort NICHT
        auftauchen — sonst haengt der Vorschlag an einem fremden Modul."""
        sch.setze({"karten"})
        anonym = Api(api.basis, debug=api.debug)
        deck = api.call("POST", f"/api/karten/classes/{u.class_id}/decks",
                        {"name": f"{PRAEFIX} Schwach-Stapel", "topic_id": u.topic_id},
                        erwartet=(201,))
        spuren.append(("Schwach-Stapel", lambda: (
            api.call("DELETE", f"/api/karten/decks/{deck['id']}", erwartet=(204, 404)),
            api.call("DELETE", f"/api/karten/decks/{deck['id']}/purge", erwartet=(204, 404)))))
        karte = api.call("POST", f"/api/karten/decks/{deck['id']}/cards",
                         {"front": "7*8", "back": "56"}, erwartet=(201,))
        api.call("POST", f"/api/karten/decks/{deck['id']}/release", {"now": True}, erwartet=(200,))
        token = _finde(api.call("POST", f"/api/karten/classes/{u.class_id}/tokens",
                                erwartet=(200, 201)), student_id=u.students[0])["token"]
        # dreimal daneben: reps steigt, lapses steigt mit — das ist ein schwaches Thema
        for _ in range(3):
            anonym.call("POST", f"/api/karten/lernen/{token}/review",
                        {"card_id": karte["id"], "grade": 0}, erwartet=(200,))

        spanne = (f"?frm={(datetime.now() - timedelta(days=2)).isoformat()}"
                  f"&to={datetime.now().isoformat()}&class_id={u.class_id}")
        mit = api.call("GET", f"/api/weak-topics{spanne}", erwartet=(200,))
        drin = [t for t in mit.get("topics", []) if t.get("topic_id") == u.topic_id]
        if not drin:
            raise AssertionError(f"Karten-Thema fehlt in den schwachen Themen: {mit}")

        sch.setze({"cardvote"})   # Karten aus
        ohne = api.call("GET", f"/api/weak-topics{spanne}", erwartet=(200,))
        if [t for t in ohne.get("topics", []) if t.get("topic_id") == u.topic_id]:
            raise AssertionError(f"Karten-Thema erscheint OHNE Modul Karten: {ohne}")
        return f"mit Karten schwaches Thema gemeldet ({drin[0].get('pct')} %), ohne Karten nicht"

    b.pruefe("Bruecken", "Karten -> schwache Themen", karten_in_schwache_themen)

    # ── Bruecke 6: Klassenarbeitstermin legt ein Korrektur-To-do an ──
    def termin_zu_todo():
        def termin(name):
            e = api.call("POST", "/api/kalender/klassenarbeiten", {
                "date": (datetime.now() + timedelta(days=3)).isoformat(),
                "title": f"{PRAEFIX} {name}", "class_id": u.class_id}, erwartet=(201,))
            spuren.append((f"Bruecken-Termin {name}", lambda: api.call(
                "DELETE", f"/api/kalender/klassenarbeiten/{e['id']}", erwartet=(204, 404))))
            return e

        # a) ohne To-do-Modul: nur der Termin, kein Zettel
        sch.setze({"kalender"})
        termin("ohne Todo")
        sch.setze({"kalender", "notizbrett"})
        vorher = api.call("GET", "/api/todo", erwartet=(200,))
        vorher_ids = {t["id"] for t in vorher}
        if [t for t in vorher if "ohne Todo" in (t.get("text") or "")]:
            raise AssertionError("Termin hat ohne Modul To-do trotzdem einen Eintrag angelegt")

        # b) mit beiden: genau ein Korrektur-To-do
        e = termin("mit Todo")
        nachher = api.call("GET", "/api/todo", erwartet=(200,))
        neu = [t for t in nachher if t["id"] not in vorher_ids and f"#ka{e['id']}" in (t.get("text") or "")]
        for t in neu:
            spuren.append((f"Korrektur-Todo {t['id']}", lambda tt=t: api.call(
                "DELETE", f"/api/todo/{tt['id']}", erwartet=(204, 404))))
        if len(neu) != 1:
            raise AssertionError(f"erwartet genau 1 Korrektur-To-do, gefunden {len(neu)}")
        if not neu[0].get("due_date"):
            raise AssertionError(f"Korrektur-To-do ohne Datum: {neu[0]}")
        return f"ohne To-do-Modul keins, mit ihm eins zum {neu[0]['due_date']}"

    b.pruefe("Bruecken", "Klassenarbeitstermin -> Korrektur-To-do", termin_zu_todo)

    # ── Bruecke 7: Fruehwarnung nennt die Schueler-ID (fuer Beobachtungen) ──
    def fruehwarnung_ids():
        """Aus einer Meldung soll direkt eine Beobachtung entstehen koennen —
        dafuer braucht die Oberflaeche die Datenbank-ID, nicht nur die
        aufgedruckte Kartennummer. Die Fruehwarnung selbst ist Kern."""
        sch.setze({"cardvote"})
        d = api.call("GET", f"/api/classes/{u.class_id}/fruehwarnung", erwartet=(200,))
        kinder = d.get("schueler") or []
        if not kinder:
            return "keine Meldungen im Testbestand — Feldpruefung entfaellt"
        ohne = [k for k in kinder if k.get("student_id") is None]
        if ohne:
            raise AssertionError(f"{len(ohne)} Eintraege ohne student_id — Beobachtung nicht moeglich")
        return f"{len(kinder)} Eintraege, alle mit student_id"

    b.pruefe("Bruecken", "Fruehwarnung -> Beobachtung (Schueler-ID)", fruehwarnung_ids)

    # ── Bruecke 8: Karten speisen den Themenstand ──
    def karten_im_themenstand():
        """Der Themenstand ist Kern und rechnet ueber drei Quellen. Mit dem Modul
        Karten muss der Kartenstand mitzaehlen, ohne es darf er nicht auftauchen
        — und der Aufruf muss trotzdem 200 liefern (kein 403, Regel 3).

        Nachgerechnet wird dabei der Fehler, der schon einmal drinsteckte: drei
        Karten, jede dreimal verpatzt (SM-2: reps faellt auf 0, lapses steigt).
        Wer nach reps > 0 filtert, sieht hier NICHTS statt 0 %.

        Dafuer braucht die Probe ein EIGENES Thema: der Themenstand zaehlt
        richtigerweise alles zusammen, was zu einem Thema vorliegt — und die
        Karten-Probe weiter oben hat auf u.topic_id schon einen Stapel bespielt.
        Auf dem gemeinsamen Thema waeren die Zahlen darum nicht mehr exakt
        vorhersagbar, und genau die exakten Zahlen sind der Sinn dieser Probe.
        """
        sch.setze({"karten"})
        anonym = Api(api.basis, debug=api.debug)
        thema = api.call("POST", "/api/topics", {"name": f"{PRAEFIX} Themenstand-Thema"},
                         erwartet=(201,))
        topic_id = thema["id"]
        deck = api.call("POST", f"/api/karten/classes/{u.class_id}/decks",
                        {"name": f"{PRAEFIX} Themenstand-Stapel", "topic_id": topic_id},
                        erwartet=(201,))
        # Thema NACH dem Stapel abraeumen (Stapel zuerst eingetragen heisst:
        # zuletzt abgeraeumt) — sonst bliebe das Thema als Rest im Bericht.
        spuren.append(("Themenstand-Thema", lambda: api.call(
            "DELETE", f"/api/topics/{topic_id}", erwartet=(204, 404))))
        spuren.append(("Themenstand-Stapel", lambda: (
            api.call("DELETE", f"/api/karten/decks/{deck['id']}", erwartet=(204, 404)),
            api.call("DELETE", f"/api/karten/decks/{deck['id']}/purge", erwartet=(204, 404)))))
        karten = [api.call("POST", f"/api/karten/decks/{deck['id']}/cards",
                           {"front": f"{i}*9", "back": str(i * 9)}, erwartet=(201,))
                  for i in range(1, 4)]
        api.call("POST", f"/api/karten/decks/{deck['id']}/release", {"now": True}, erwartet=(200,))
        token = _finde(api.call("POST", f"/api/karten/classes/{u.class_id}/tokens",
                                erwartet=(200, 201)), student_id=u.students[0])["token"]
        for k in karten:
            for _ in range(3):
                anonym.call("POST", f"/api/karten/lernen/{token}/review",
                            {"card_id": k["id"], "grade": 0}, erwartet=(200,))

        def thema_von(antwort):
            kind = _finde(antwort.get("schueler") or [], student_id=u.students[0])
            if kind is None:
                raise AssertionError(f"Kind {u.students[0]} fehlt im Themenstand: {antwort}")
            return next((t for t in (kind.get("themen") or []) if t["topic_id"] == topic_id), None)

        mit = api.call("GET", f"/api/classes/{u.class_id}/themenprofil"
                              f"?student_id={u.students[0]}", erwartet=(200,))
        if "karten" not in (mit.get("quellen") or []):
            raise AssertionError(f"Karten als Quelle nicht gemeldet: {mit.get('quellen')}")
        th = thema_von(mit)
        if not th or not (th.get("karten") or {}).get("versuche"):
            raise AssertionError(f"verpatzte Karten fehlen im Themenstand: {th}")
        # Genau, nicht "mindestens": auf einem eigenen Thema liegen exakt drei
        # Karten mit je drei verpatzten Versuchen und keinem Treffer. Eine
        # Ungleichung wuerde hier jede Verrechnung durchwinken.
        if (th["karten"]["karten"], th["karten"]["versuche"], th["karten"]["treffer"]) != (3, 9.0, 0.0):
            raise AssertionError(f"Kartenzahlen falsch (reps>0-Falle?): {th['karten']} "
                                 "(erwartet 3 Karten, 9 Versuche, 0 Treffer)")
        if th["pct"] != 0.0 or "karten" not in th["quellen"]:
            raise AssertionError(f"dreimal verpatzt ergibt nicht 0 %: {th}")

        sch.setze({"cardvote"})   # Karten aus
        ohne = api.call("GET", f"/api/classes/{u.class_id}/themenprofil"
                               f"?student_id={u.students[0]}", erwartet=(200,))
        if "karten" in (ohne.get("quellen") or []):
            raise AssertionError("Karten zaehlen ohne das Modul weiter mit")
        leer = thema_von(ohne)
        if leer and leer.get("karten"):
            raise AssertionError(f"Kartenstand erscheint OHNE Modul Karten: {leer}")
        return (f"mit Karten {th['karten']['treffer']:.0f} von "
                f"{th['karten']['versuche']:.0f} Versuchen = 0 %, ohne Karten keine Spur")

    b.pruefe("Bruecken", "Karten -> Themenstand", karten_im_themenstand)


# ───────────── 6. Fruehwarnung und Themenstand nachgerechnet ─────────────
#
# Beide antworteten im Test bisher nur "ohne Fehler". Das ist zu wenig: es sind
# die zwei Sichten, aus denen eine Lehrkraft Schluesse ueber ein einzelnes Kind
# zieht — eine falsche Zahl darin ist schlimmer als gar keine.
#
# Die Datengrundlage sind vier Klassenarbeiten (nicht Quizze): eine Arbeit ist
# ein PUT mit allen Punkten aller Kinder, vier Quizze waeren siebzig Aufrufe.
# Gerechnet wird ausschliesslich ueber die Arbeiten, indem NUR das Modul
# Auswertung laeuft — sonst mischten die Quizze der CardVote-Probe mit und die
# Erwartung waere nicht mehr exakt.

# Punkte je Aufgabe. Anna faellt in jeder Arbeit gleich weit zurueck (damit der
# Median eindeutig ist), aber INNERHALB der Themen verschiebt sich etwas:
# Thema 1 bricht ein, Thema 4 holt auf, Thema 2 und 3 bleiben. Genau daran
# laesst sich der Trend des Themenstands pruefen, ohne die Fruehwarnung zu
# verwackeln.
FW_MAX = 4.0                     # Maximalpunkte je Aufgabe
FW_PUNKTE = {
    # Thema -> je Arbeit die Punkte von (Anna, Ben, Cem)
    "T1": [(4, 4, 3), (4, 4, 3), (0, 4, 3), (0, 4, 3)],
    "T2": [(1, 4, 3), (1, 4, 3), (1, 4, 3), (1, 4, 3)],
    "T3": [(1, 4, 3), (1, 4, 3), (1, 4, 3), (1, 4, 3)],
    "T4": [(0, 4, 3), (0, 4, 3), (4, 4, 3), (4, 4, 3)],
    # Nur in der ersten Arbeit — bleibt unter MINDEST_PUNKTE (6) und muss
    # deshalb im Themenstand „zu wenig fuer eine Aussage" heissen.
    "T5": [(1, 4, 3)],
}
FW_ARBEITEN = 4


def teste_verlauf_gerechnet(api, b, u, sch, spuren):
    """Vier Klassenarbeiten anlegen und beide Kern-Sichten nachrechnen."""
    from statistics import median

    sch.setze({"auswertung"})
    z = {}

    def aufbau():
        vorhanden = api.call("GET", f"/api/klassenarbeit/classes/{u.class_id}/works",
                             erwartet=(200,))
        if vorhanden:
            # Jede fremde Arbeit in derselben Klasse verschiebt das Klassenmittel,
            # gegen das hier gerechnet wird. Lieber ehrlich abbrechen als eine
            # Zahl vergleichen, die nichts mehr bedeutet.
            raise AssertionError(
                f"die Testklasse hat schon {len(vorhanden)} Klassenarbeit(en) "
                f"({[w['name'] for w in vorhanden]}) — eine fremde Arbeit verschiebt das "
                "Klassenmittel, gegen das hier gerechnet wird")
        themen = {}
        for schluessel in FW_PUNKTE:
            t = api.call("POST", "/api/topics",
                         {"name": f"{PRAEFIX} Verlauf {schluessel}"}, erwartet=(201,))
            themen[schluessel] = t["id"]
            spuren.append((f"Verlauf-Thema {schluessel}", lambda tid=t["id"]: api.call(
                "DELETE", f"/api/topics/{tid}", erwartet=(204, 404))))
        z["themen"] = themen

        arbeiten = []
        for i in range(FW_ARBEITEN):
            aufgaben, ergebnisse = [], {str(sid): {} for sid in u.students}
            for schluessel, reihe in FW_PUNKTE.items():
                if i >= len(reihe):
                    continue
                aufgaben.append({"id": schluessel, "label": schluessel,
                                 "topic_id": themen[schluessel], "max": FW_MAX})
                for k, sid in enumerate(u.students):
                    ergebnisse[str(sid)][schluessel] = reihe[i][k]
            w = api.call("POST", "/api/klassenarbeit/works",
                         {"class_id": u.class_id, "name": f"{PRAEFIX} Verlauf {i + 1}"},
                         erwartet=(201,))
            spuren.append((f"Verlauf-Arbeit {i + 1}", lambda wid=w["id"]: api.call(
                "DELETE", f"/api/klassenarbeit/works/{wid}", erwartet=(204, 404))))
            api.call("PUT", f"/api/klassenarbeit/works/{w['id']}",
                     {"tasks": aufgaben, "results": ergebnisse}, erwartet=(200,))
            arbeiten.append(w)
        z["arbeiten"] = arbeiten
        return (f"{FW_ARBEITEN} Klassenarbeiten ueber {len(themen)} Themen, "
                f"{FW_ARBEITEN * len(u.students)} Punktezeilen")

    if not b.pruefe("Verlauf", "Vier Klassenarbeiten anlegen", aufbau):
        return

    def erwartung_je_arbeit():
        """Je Arbeit die Quote jedes Kindes und das Klassenmittel — mit
        denselben Rundungen wie app/fruehwarnung.py (_quote rundet auf eine
        Nachkommastelle, das Mittel ebenso)."""
        aus = []
        for i in range(FW_ARBEITEN):
            quoten = []
            for k in range(len(u.students)):
                erreicht = sum(reihe[i][k] for reihe in FW_PUNKTE.values() if i < len(reihe))
                moeglich = FW_MAX * sum(1 for reihe in FW_PUNKTE.values() if i < len(reihe))
                quoten.append(round(erreicht / moeglich * 100, 1))
            mittel = round(sum(quoten) / len(quoten), 1)
            aus.append((quoten, mittel))
        return aus

    def fruehwarnung():
        """Die Regel aus app/fruehwarnung.py im Test nachgerechnet.

        Anna liegt in jeder Arbeit rund 33 Prozentpunkte unter der Klasse — das
        ist die Meldung. Ben und Cem liegen darueber und duerfen NICHT gemeldet
        werden; genau dieser Gegenbeweis fehlt sonst.
        """
        d = api.call("GET", f"/api/classes/{u.class_id}/fruehwarnung", erwartet=(200,))
        if d.get("quellen", {}).get("arbeiten") != FW_ARBEITEN:
            raise AssertionError(f"Datenlage nennt {d.get('quellen')} statt {FW_ARBEITEN} Arbeiten")
        if len(d.get("tests") or []) != FW_ARBEITEN:
            raise AssertionError(f"{len(d.get('tests') or [])} Erhebungen im Fenster "
                                 f"statt {FW_ARBEITEN}")
        erwartet = erwartung_je_arbeit()
        abweichung = []
        for k, card_id in enumerate(u.karten):
            zeile = _finde(d["schueler"], card_id=card_id)
            if not zeile:
                raise AssertionError(f"Karte {card_id} fehlt in der Fruehwarnung")
            abstaende = [round(quoten[k] - mittel, 1) for quoten, mittel in erwartet]
            soll_med = round(median(abstaende), 1)
            unter = sum(1 for x in abstaende[-5:] if x <= -15.0)   # abstand_einzeln
            soll_status = "melden" if (soll_med <= -20.0 and unter >= 4) else "unauffaellig"
            if zeile["status"] != soll_status:
                abweichung.append(f"Karte {card_id}: '{zeile['status']}' statt '{soll_status}' "
                                  f"(Abstaende {abstaende})")
            if not gleich(zeile.get("abstand_median", -999), soll_med, 0.05):
                abweichung.append(f"Karte {card_id}: Median {zeile.get('abstand_median')} "
                                  f"statt {soll_med}")
            for punkt, (quoten, mittel) in zip(zeile["kurve"], erwartet):
                if not gleich(punkt["pct"], quoten[k], 0.05) or not gleich(punkt["klasse"], mittel, 0.05):
                    abweichung.append(f"Karte {card_id}: Kurvenpunkt {punkt['pct']}/{punkt['klasse']} "
                                      f"statt {quoten[k]}/{mittel}")
                if punkt["art"] != "arbeit":
                    abweichung.append(f"Karte {card_id}: Erhebungsart '{punkt['art']}' "
                                      "statt 'arbeit' — es rechnet eine fremde Quelle mit")
        gemeldet = [s["card_id"] for s in d["schueler"] if s["status"] == "melden"]
        if gemeldet != [u.karten[0]]:
            abweichung.append(f"gemeldet werden {gemeldet}, erwartet nur {[u.karten[0]]}")
        if abweichung:
            raise AssertionError("; ".join(abweichung))
        anna = _finde(d["schueler"], card_id=u.karten[0])
        return (f"Anna gemeldet ({anna['abstand_median']:+.1f} Prozentpunkte Median ueber "
                f"{FW_ARBEITEN} Arbeiten), Ben und Cem unauffaellig")

    b.pruefe("Verlauf", "Fruehwarnung gegen eigene Rechnung", fruehwarnung)

    def zu_wenig_daten():
        """Unter `mindest_antworten` gibt es keine Entwarnung, sondern „zu wenig
        Daten". Geprueft an einem Kind, das nur in EINER Arbeit vorkommt: seine
        Punkte werden aus drei Arbeiten entfernt, danach bleiben fuenf gewertete
        Antworten — unter den zwoelf, die die Regel verlangt.
        """
        opfer = str(u.students[2])
        for w in z["arbeiten"][1:]:
            voll = _finde(api.call("GET", f"/api/klassenarbeit/classes/{u.class_id}/works",
                                   erwartet=(200,)), id=w["id"])
            ohne = {k: v for k, v in (voll.get("results") or {}).items() if k != opfer}
            api.call("PUT", f"/api/klassenarbeit/works/{w['id']}", {"results": ohne},
                     erwartet=(200,))
        d = api.call("GET", f"/api/classes/{u.class_id}/fruehwarnung", erwartet=(200,))
        zeile = _finde(d["schueler"], card_id=u.karten[2])
        if zeile["status"] != "zu_wenig_daten":
            raise AssertionError(f"Kind mit 5 Antworten gilt als '{zeile['status']}' "
                                 "statt 'zu_wenig_daten'")
        if zeile.get("abstand_median") is not None:
            raise AssertionError("zu duenne Datenlage liefert trotzdem einen Median")
        # Zurueck auf den vollen Stand — der Themenstand unten rechnet damit.
        for i, w in enumerate(z["arbeiten"]):
            if i == 0:
                continue
            ergebnisse = {}
            for k, sid in enumerate(u.students):
                ergebnisse[str(sid)] = {s: reihe[i][k] for s, reihe in FW_PUNKTE.items()
                                        if i < len(reihe)}
            api.call("PUT", f"/api/klassenarbeit/works/{w['id']}", {"results": ergebnisse},
                     erwartet=(200,))
        return ("fuenf gewertete Antworten ergeben „zu wenig Daten“ "
                "und nicht „unauffaellig“")

    b.pruefe("Verlauf", "Zu duenne Datenlage meldet nicht", zu_wenig_daten)

    def themenstand():
        """Gewichtet statt gemittelt — und der Trend vergleicht Haelften.

        Fuer Anna: Thema 1 bricht ein (100/100/0/0 -> „ab"), Thema 4 holt auf
        (0/0/100/100 -> „auf"), Thema 2 und 3 bleiben („gleich"). Alle vier
        stehen bei 50 bzw. 25 Prozent, obwohl die Verlaeufe voellig verschieden
        sind — genau deshalb muss beides geprueft werden. Thema 5 kommt nur
        einmal vor und bleibt unter dem Mindestmass.
        """
        aus = api.call("GET", f"/api/classes/{u.class_id}/themenprofil"
                              f"?student_id={u.students[0]}", erwartet=(200,))
        if aus.get("quellen") != ["arbeit"]:
            raise AssertionError(f"Quellen {aus.get('quellen')} statt nur ['arbeit'] — "
                                 "es rechnet etwas mit, das die Erwartung verschiebt")
        kind = (aus.get("schueler") or [{}])[0]
        nach_id = {t["topic_id"]: t for t in kind.get("themen") or []}
        abweichung = []
        for schluessel, reihe in FW_PUNKTE.items():
            tid = z["themen"][schluessel]
            eintrag = nach_id.get(tid)
            if not eintrag:
                abweichung.append(f"{schluessel} fehlt im Themenstand")
                continue
            erreicht = sum(x[0] for x in reihe)
            moeglich = FW_MAX * len(reihe)
            genug = moeglich >= 6.0        # MINDEST_PUNKTE
            soll_pct = round(erreicht / moeglich * 100, 1) if genug else None
            if eintrag["genug"] != genug:
                abweichung.append(f"{schluessel}: genug={eintrag['genug']} statt {genug}")
            if soll_pct is None and eintrag["pct"] is not None:
                abweichung.append(f"{schluessel}: {eintrag['pct']} % trotz "
                                  f"{moeglich:.0f} moeglichen Punkten (Mindestmass 6)")
            if soll_pct is not None and not gleich(eintrag["pct"], soll_pct, 0.05):
                abweichung.append(f"{schluessel}: {eintrag['pct']} % statt {soll_pct} %")
            if not gleich(eintrag["max"], moeglich, 0.05):
                abweichung.append(f"{schluessel}: max={eintrag['max']} statt {moeglich}")
            if eintrag["erhebungen"] != len(reihe):
                abweichung.append(f"{schluessel}: {eintrag['erhebungen']} Erhebungen "
                                  f"statt {len(reihe)}")
            # Trend: erste gegen zweite Haelfte der Prozentwerte des Verlaufs.
            werte = [round(x[0] / FW_MAX * 100, 1) for x in reihe]
            soll_trend = None
            if len(werte) >= 3:
                h = len(werte) // 2
                delta = round(sum(werte[h:]) / len(werte[h:]) - sum(werte[:h]) / h, 1)
                soll_trend = "auf" if delta >= 10.0 else ("ab" if delta <= -10.0 else "gleich")
            ist_trend = (eintrag.get("trend") or {}).get("richtung")
            if ist_trend != soll_trend:
                abweichung.append(f"{schluessel}: Trend '{ist_trend}' statt '{soll_trend}' "
                                  f"(Verlauf {werte})")
        if abweichung:
            raise AssertionError("; ".join(abweichung))
        return ("5 Themen: Prozente gewichtet nachgerechnet, Trend ab/auf/gleich wie erwartet, "
                "das duenne Thema ohne Zahl")

    b.pruefe("Verlauf", "Themenstand gegen eigene Rechnung", themenstand)

    def ohne_modul():
        """Beide Sichten gehoeren dem Kern: ohne Quellmodul antworten sie leer,
        niemals mit 403 (Regel 3)."""
        sch.setze({"zufall"})     # weder Auswertung noch CardVote noch Karten
        fw = api.call("GET", f"/api/classes/{u.class_id}/fruehwarnung", erwartet=(200,))
        if fw.get("schueler"):
            raise AssertionError("Fruehwarnung meldet ohne aktives Quellmodul weiter Kinder")
        if fw["quellen"]["auswertung"] or fw["quellen"]["cardvote"]:
            raise AssertionError(f"Datenlage behauptet aktive Module: {fw['quellen']}")
        ts = api.call("GET", f"/api/classes/{u.class_id}/themenprofil", erwartet=(200,))
        if ts.get("quellen"):
            raise AssertionError(f"Themenstand nennt Quellen ohne Modul: {ts['quellen']}")
        if any(k.get("themen") for k in ts.get("schueler") or []):
            raise AssertionError("Themenstand liefert ohne Quellmodul weiter Themen")
        sch.setze({"auswertung"})
        return "ohne Quellmodul: 200 mit leerer Antwort, kein 403"

    b.pruefe("Verlauf", "Ohne Quellmodul leer statt 403", ohne_modul)


# ─────────────────────── Ablauf ───────────────────────

def main():
    p = standard_argumente(
        argparse.ArgumentParser(description="Systemtest: jedes Nuvora-Modul einzeln durchgespielt"))
    p.add_argument("--modul", help="nur dieses Modul aus dem REGISTRY pruefen")
    args = p.parse_args()

    if not args.url:
        print("Fehler: keine URL. --url oder SELFTEST_URL/SITE_URL setzen.", file=sys.stderr)
        return 2
    if not (args.email and args.passwort):
        print("Fehler: der Systemtest schreibt Daten und braucht ein Konto "
              "(--email/--passwort oder SELFTEST_EMAIL/SELFTEST_PASSWORD).", file=sys.stderr)
        return 2

    api = Api(args.url, debug=args.debug, selftest_token=args.token or "")
    b = Systembericht()
    if not args.json:
        print(f"{FETT}Nuvora-Systemtest{AUS} gegen {args.url}")

    # Dieselbe Anmeldung wie im Selbsttest (gemeinsam.py) — inklusive der
    # Auskunft, was zu tun ist, wenn das Testkonto gar nicht existiert.
    if not b.pruefe("Anmeldung", "Login",
                    lambda: melde_an(api, args.email, args.passwort, args.url)):
        b.drucke()
        return 1

    sch = Schalter(api, b)
    b.add("Register", "Modul-Zustand gesichert", True,
          f"{len(sch.anfangs_aktiv)} von {len(sch.verfuegbar)} Modulen aktiv — "
          "wird am Ende wiederhergestellt")

    u = Umgebung(api, b)
    spuren = []      # (Beschreibung, Aufraeum-Funktion) fuer alles aus den Proben
    try:
        # Fuer den Aufbau muessen alle Module an sein (Klasse anlegen beruehrt
        # nur den Kern, aber das Abraeumen spaeter braucht die Module).
        sch.alle_an()
        # Reste eines abgebrochenen Laufs zuerst wegraeumen: sonst scheitert
        # schon der Aufbau am 409 ("Dieses Thema gibt es an dieser Stelle
        # schon") und der ganze Modulteil faellt aus. Alle Module sind hier
        # bereits an, die Suche findet also auch die Modul-Reste.
        raeume_reste(api, b)
        sch.alle_an()   # raeume_reste stellt den Modulstand zurueck
        if not b.pruefe("Kern", "Testdaten anlegen", u.aufbauen):
            b.add("Module", "alle", False, "uebersprungen — ohne Klasse kein Modultest")
            b.drucke()
            return 1

        teste_alleinstellung(api, b, u, sch, spuren, args.modul)
        if not args.modul:
            teste_zugang_dicht(api, b, u, sch, spuren)
            cv = teste_cardvote_voll(api, b, u, sch, spuren)
            teste_noten(api, b, u, sch, spuren, cv)
            # VOR den Bruecken: die rechnen zwar nur je Arbeit, lassen aber eine
            # Klassenarbeit stehen (sie wird erst ganz am Ende abgeraeumt) — und
            # eine fremde Arbeit in der Klasse verschiebt jedes Klassenmittel,
            # gegen das hier gerechnet wird.
            teste_verlauf_gerechnet(api, b, u, sch, spuren)
            teste_bruecken(api, b, u, sch, spuren, cv)
    finally:
        # Aufraeumen braucht alle Module (jede Loesch-Route haengt hinter ihrer
        # Schranke) — erst danach den urspruenglichen Zustand herstellen.
        try:
            sch.alle_an()
        except Exception as e:
            b.reste.append(f"Module zum Aufraeumen nicht einschaltbar: {e}")
        for was, fn in reversed(spuren):
            try:
                fn()
            except Exception as e:
                b.reste.append(f"{was}: {e}")
        u.abbauen()
        b.add("Aufraeumen", "Modul-Zustand wiederhergestellt", sch.zuruecksetzen(),
              f"wieder aktiv: {', '.join(sorted(sch.anfangs_aktiv)) or 'keins'}")

    if args.json:
        print(b.als_json())
    else:
        b.drucke()
    return 1 if b.fehler else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        # Strg-C soll einen ruhigen Satz geben, keinen Stapelabzug. Der Abbruch
        # ist ungefaehrlich: der `finally`-Block in main() laeuft beim
        # Aufraeumen mit, stellt den Modulzustand wieder her und raeumt die
        # Testdaten ab. Nur ein ZWEITES Strg-C waehrenddessen kann Reste und
        # zugeschaltete Module hinterlassen — dann hilft `scripts/aufraeumen.py`.
        print("\n  Abgebrochen (Strg-C). Modulzustand und Testdaten wurden "
              "zurueckgesetzt.\n  Falls doch etwas liegen blieb: "
              "python3 scripts/aufraeumen.py --loeschen", file=sys.stderr)
        sys.exit(130)
