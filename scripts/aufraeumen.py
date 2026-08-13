#!/usr/bin/env python3
"""Nuvora — Testreste aufraeumen und den Modulzustand zurueckstellen.

Die Testskripte (selftest.py, systemtest.py und ihre Browser-Gegenstuecke)
schalten zum Pruefen Module des Testkontos zu und legen Daten mit dem Praefix
ZZ-Selbsttest bzw. ZZ-Systemtest an. Am Ende raeumen sie beides wieder ab —
ausser der Lauf bricht ab (Strg-C, abgestuerzter Browser, Netz weg). Dann steht
das Konto mit fremder Modul-Aktivierung und liegengebliebenen Testdaten da.

Genau dafuer ist dieses Werkzeug da, und zwar von Hand:

    scripts/aufraeumen.py              zeigt nur, was gefunden wurde (Vorgabe)
    scripts/aufraeumen.py --loeschen   raeumt es weg

Die Vorgabe ist die Trockenuebung. Ein Werkzeug, das ungefragt loescht, ist auf
einem Produktivkonto gefaehrlich — und das Testkonto ist genau so ein Konto.

Sicherheitsnetz: angefasst wird ausschliesslich, was eines der Praefixe im
Namen traegt. Das ist nicht bloss ein Vorsatz, sondern im Code verankert: ein
Fund ohne Praefix laesst sich gar nicht erst anlegen (Konstruktor wirft), und
unmittelbar vor jedem DELETE wird noch einmal geprueft. Eine Klasse "7a" bleibt
also auch dann unberuehrt, wenn daneben eine "ZZ-Selbsttest Klasse" steht.

Modulzustand: die Testskripte sollen ihren Ausgangszustand VOR dem ersten
Umschalten in .selftest-module.json schreiben (je Instanz getrennt, wie
.selftest-bestand.json). Gibt es die Datei, stellt dieses Werkzeug genau diesen
Zustand wieder her. Gibt es sie nicht, sagt es das, zeigt den aktuellen Stand
und bietet --module-aus / --module-an an — geraten wird nicht.

Zugang wie bei den anderen Skripten: --url/--email/--passwort, sonst
SELFTEST_URL/SELFTEST_EMAIL/SELFTEST_PASSWORD, sonst .deploy.env.

Rueckgabewert: 0 = nichts offen, 1 = es blieb etwas liegen.
Nur Standardbibliothek — Bericht und Api kommen aus gemeinsam.py.
"""
import argparse
import contextlib
import io
import json
import os
import sys
from datetime import datetime

# Format, Farben und HTTP-Client kommen aus gemeinsam.py — zwei Fassungen
# desselben Berichts laufen sonst auseinander. Frueher standen sie in
# selftest.py, das umgekehrt von hier holt; das war ein Ring. Jetzt zeigen
# beide auf dasselbe Blatt (siehe Modulkopf von gemeinsam.py).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gemeinsam import Api, Bericht  # noqa: E402

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Beide Testskripte, beide Praefixe. Wer ein drittes Testskript baut, traegt
# sein Praefix hier ein — sonst raeumt niemand hinter ihm auf.
PRAEFIXE = ("ZZ-Selbsttest", "ZZ-Systemtest")

# Ausgangszustand der Module, je Instanz — genau wie .selftest-bestand.json.
MODUL_DATEI = os.path.join(WURZEL, ".selftest-module.json")

# Papierkorb: Kinder vor Eltern, sonst greift die Kaskade ins Leere
# (dieselbe Reihenfolge wie empty_trash in apps/api/app/routers/trash.py).
# Kinder vor Eltern; Fragen vor Themen, weil purge_topic die topic_id der
# Fragen erst loest und eine Frage sonst im selben Lauf auf ein weggeraeumtes
# Thema zeigt.
TRASH_REIHENFOLGE = ["card", "ladder", "deck", "path", "class", "kurs", "question", "topic"]


# ────────────────── Gemerkter Modulzustand (Datei) ──────────────────

def _lies_datei():
    try:
        with open(MODUL_DATEI) as f:
            daten = json.load(f)
        return daten if isinstance(daten, dict) else {}
    except Exception:
        return {}


def merke_module(basis, aktiv):
    """Ausgangszustand festhalten, BEVOR das erste Modul umgeschaltet wird.

    Von den Testskripten aufzurufen. Je Instanz getrennt: Test- und
    Produktivinstanz haben verschiedene Modulzustaende.
    """
    alle = _lies_datei()
    alle[basis.rstrip("/")] = {"aktiv": sorted(aktiv), "zeit": datetime.now().isoformat(timespec="seconds")}
    with open(MODUL_DATEI, "w") as f:
        json.dump(alle, f, ensure_ascii=False, indent=2)


def vergiss_module(basis):
    """Nach erfolgreichem Zurueckstellen: der gemerkte Zustand ist verbraucht.

    Ohne das wuerde dieses Werkzeug spaeter einen alten Stand wiederherstellen
    und dabei glauben, es tue etwas Gutes.
    """
    alle = _lies_datei()
    if alle.pop(basis.rstrip("/"), None) is None:
        return
    with open(MODUL_DATEI, "w") as f:
        json.dump(alle, f, ensure_ascii=False, indent=2)


def lies_module(basis):
    return _lies_datei().get(basis.rstrip("/"))


# ────────────────── Bericht ──────────────────

class Aufraeumbericht(Bericht):
    """Der Bericht aus gemeinsam.py, nur mit passender Schlusszeile.

    Format, Farben und Aufbau kommen unveraendert von dort (eine Quelle);
    ersetzt wird allein das Wort in der Zusammenfassung — hier raeumt jemand
    auf, er testet nicht.
    """

    def drucke(self):
        puffer = io.StringIO()
        with contextlib.redirect_stdout(puffer):
            super().drucke()
        print(puffer.getvalue()
              .replace("Selbsttest gruen", "Aufraeumen fertig")
              .replace("Selbsttest ROT", "Aufraeumen unvollstaendig"), end="")


# ────────────────── Funde ──────────────────

def mit_praefix(text):
    return any(p in (text or "") for p in PRAEFIXE)


LABEL_FELDER = ("name", "title", "text", "label", "aufgabentext", "front", "filename")


def _label(obj):
    """Der sprechende Name eines Objekts — egal, wie das Feld heisst."""
    if not isinstance(obj, dict):
        return ""
    for feld in LABEL_FELDER:
        wert = obj.get(feld)
        if isinstance(wert, str) and wert.strip():
            return wert.strip()
    return ""


class Fund:
    """Ein liegengebliebenes Testobjekt — mit dem Weg, es loszuwerden.

    Das Sicherheitsnetz sitzt hier, nicht im Aufrufer: ohne Praefix im Namen
    kann ein Fund gar nicht entstehen, und vor jedem DELETE wird noch einmal
    geprueft. Wer kuenftig eine Art ergaenzt, kann das Netz nicht vergessen —
    es fuehrt kein Weg daran vorbei.
    """

    def __init__(self, gruppe, art, label, pfade, hinweis=""):
        if not mit_praefix(label):
            raise ValueError(f"Fund ohne Testpraefix: {art} '{label}' — wird nie angefasst")
        self.gruppe, self.art, self.label = gruppe, art, label
        self.pfade = list(pfade)      # leer = nur melden, nicht loeschbar
        self.hinweis = hinweis

    def __str__(self):
        text = f"{self.art}: {self.label}"
        return text + (f"   ({self.hinweis})" if self.hinweis else "")

    def loesche(self, api):
        if not mit_praefix(self.label):   # zweite Bremse, direkt vor dem Zugriff
            raise ValueError(f"Abgebrochen: '{self.label}' traegt kein Testpraefix")
        for pfad in self.pfade:
            api.call("DELETE", pfad, erwartet=(200, 204, 404))


def _kurz(text, n=60):
    text = " ".join(str(text).split())
    return text if len(text) <= n else text[:n - 1] + "…"


# ────────────────── Einsammeln ──────────────────

class Sammler:
    """Sucht die Reste zusammen — in der Reihenfolge, in der sie weg duerfen.

    Kinder vor Eltern (Sitzung vor Quiz vor Frage vor Ordner, Note vor Spalte
    vor Block, Klasse vor Kurs). Geloescht wird spaeter genau in dieser Folge.
    """

    def __init__(self, api, b):
        self.api, self.b = api, b
        self.funde = []
        self.klassen = []      # (id, name)
        self.schueler = []     # (id, name)
        self.ich = None

    # -- kleine Helfer --------------------------------------------------

    def _get(self, pfad):
        """GET, das nie den Lauf abbricht: ein abgeschaltetes oder kaputtes
        Modul kostet einen Hinweis, nicht die Aufraeumaktion."""
        try:
            return self.api.call("GET", pfad, erwartet=(200,)) or []
        except Exception as e:
            self.b.add("Suche", pfad, False, f"nicht lesbar: {e}", schwere="warnung")
            return []

    def nimm(self, gruppe, art, daten, pfade, felder=None):
        """Aus einer Liste alles mit Praefix als Fund uebernehmen."""
        for obj in daten or []:
            if not isinstance(obj, dict):
                continue
            label = _label(obj) if felder is None else next(
                (obj.get(f) for f in felder if isinstance(obj.get(f), str) and obj.get(f).strip()), "")
            if mit_praefix(label):
                self.funde.append(Fund(gruppe, art, _kurz(label), pfade(obj)))

    # -- der eigentliche Rundgang --------------------------------------

    def alles(self):
        self.ich = (self.api.call("GET", "/api/auth/me", erwartet=(200,)) or {}).get("id")
        klassen = self._get("/api/classes")
        self.klassen = [(k["id"], k.get("name", "")) for k in klassen]
        for k in klassen:
            for s in k.get("students") or []:
                self.schueler.append((s["id"], s.get("name", "")))

        self._cardvote()
        self._lernpfad()
        self._karten()
        self._auswertung()
        self._kalender()
        self._orga()
        self._unterrichtsplanung()
        self._notizbrett()
        self._notizen_und_eltern()
        self._code_detektiv()
        self._kern(klassen)
        self._papierkorb()
        return self.funde

    def _cardvote(self):
        g = "CardVote"
        self.nimm(g, "Sitzung", self._get("/api/sessions-list"),
                  lambda o: [f"/api/sessions/{o['id']}"])

        # Quizze stecken im Ordnerbaum; ordnerlose liegen daneben.
        baum = self._get("/api/folders")
        ordner, saetze = [], list(self._get("/api/root-question-sets"))

        def durchlaufe(knoten):
            for n in knoten:
                ordner.append(n)
                saetze.extend(n.get("question_sets") or [])
                durchlaufe(n.get("children") or [])

        durchlaufe(baum)
        self.nimm(g, "Quiz", saetze, lambda o: [f"/api/question-sets/{o['id']}"])
        self.nimm(g, "Frage", self._get("/api/questions"),
                  lambda o: [f"/api/questions/{o['id']}"])
        # Ordner zuletzt: erst muessen die Quizze darin weg sein.
        self.nimm(g, "Ordner", ordner, lambda o: [f"/api/folders/{o['id']}"])

        if self.ich:
            self.nimm(g, "Marktplatz-Eintrag", self._get(f"/api/marketplace?author_id={self.ich}"),
                      lambda o: [f"/api/marketplace/{o['id']}"])

    def _lernpfad(self):
        g = "Lernpfad"
        # Lernleitern haengen an ihrem Pfad und gehen mit ihm; einzeln stehen
        # sie hoechstens im Papierkorb (der kommt weiter unten).
        self.nimm(g, "Lernpfad", self._get("/api/lernpfad/paths"),
                  lambda o: [f"/api/lernpfad/paths/{o['id']}",
                             f"/api/lernpfad/paths/{o['id']}/purge"])
        self.nimm(g, "Aufgabe", self._get("/api/lernpfad/exercises"),
                  lambda o: [f"/api/lernpfad/exercises/{o['id']}"])

    def _karten(self):
        g = "Karten"
        for cid, _name in self.klassen:
            # all-decks nimmt auch Entwuerfe mit, die in der Freigabe-Liste fehlen.
            self.nimm(g, "Kartenstapel", self._get(f"/api/karten/classes/{cid}/all-decks"),
                      lambda o: [f"/api/karten/decks/{o['id']}",
                                 f"/api/karten/decks/{o['id']}/purge"])
            self.nimm(g, "Karten-Ordner", self._get(f"/api/karten/classes/{cid}/card-folders"),
                      lambda o: [f"/api/karten/card-folders/{o['id']}"])

    def _auswertung(self):
        g = "Auswertung"
        for cid, _name in self.klassen:
            bloecke = self._get(f"/api/noten/classes/{cid}/sections?term=all")
            spalten = [s for blk in bloecke for s in (blk.get("categories") or [])]
            # Spalte vor Block: der Block nimmt seine Spalten sonst mit, und ein
            # Block ohne Praefix darf seine Testspalte trotzdem verlieren.
            self.nimm(g, "Notenspalte", spalten, lambda o: [f"/api/noten/categories/{o['id']}"])
            self.nimm(g, "Notenblock", bloecke, lambda o: [f"/api/noten/sections/{o['id']}"])
            self.nimm(g, "Klassenarbeit", self._get(f"/api/klassenarbeit/classes/{cid}/works"),
                      lambda o: [f"/api/klassenarbeit/works/{o['id']}"])

    def _kalender(self):
        g = "Kalender"
        self.nimm(g, "Klassenarbeitstermin", self._get("/api/kalender/klassenarbeiten"),
                  lambda o: [f"/api/kalender/klassenarbeiten/{o['id']}"])
        stundenplan = self._get("/api/kalender/timetable")
        slots = stundenplan.get("slots", []) if isinstance(stundenplan, dict) else []
        self.nimm(g, "Stundenplan-Slot", slots,
                  lambda o: [f"/api/kalender/timetable/slot/{o['id']}"])
        self.nimm(g, "Freier Zeitraum", self._get("/api/kalender/breaks"),
                  lambda o: [f"/api/kalender/breaks/{o['id']}"])
        self.nimm(g, "Eintrag", self._get("/api/kalender/entries"),
                  lambda o: [f"/api/kalender/entries/{o['id']}"])

    def _orga(self):
        g = "Orga"
        for cid, _name in self.klassen:
            self.nimm(g, "Checklisten-Posten", self._get(f"/api/orga/{cid}"),
                      lambda o: [f"/api/orga/item/{o['id']}"])
        self.nimm(g, "Ausleihe-Gegenstand", self._get("/api/ausleihe/items"),
                  lambda o: [f"/api/ausleihe/items/{o['id']}"])
        self.nimm("Material", "Material", self._get("/api/material"),
                  lambda o: [f"/api/material/{o['id']}"])

    def _unterrichtsplanung(self):
        g = "Unterrichtsplanung"
        self.nimm(g, "Einstieg/Methode", self._get("/api/methoden/list"),
                  lambda o: [f"/api/methoden/{o['id']}"])
        self.nimm(g, "Methoden-Ordner", self._get("/api/methoden/folders"),
                  lambda o: [f"/api/methoden/folders/{o['id']}"])

    def _notizbrett(self):
        g = "Notizbrett"
        self.nimm(g, "Notizzettel", self._get("/api/notizblock"),
                  lambda o: [f"/api/notizblock/{o['id']}"])
        self.nimm(g, "To-do", self._get("/api/todo"), lambda o: [f"/api/todo/{o['id']}"])

    def _notizen_und_eltern(self):
        """Beide haengen am einzelnen Kind — es gibt keine Gesamtliste.

        Frueher lief hier je Kind eine Anfrage an beide Endpunkte. Bei einer
        Klasse mit 30 Kindern sind das 60 Anfragen im Sekundentakt; die
        Missbrauchsschranke antwortet mit 429, der Selbsttest wartet brav die
        Sperre ab, und das Aufraeumen steht minutenlang scheinbar still. Genau
        deshalb wurde der letzte Lauf von Hand abgebrochen.

        Es gibt aber je Modul einen Zaehl-Endpunkt fuer die ganze Klasse. Wer 0
        Eintraege hat, kann auch keine Reste haben — also erst zaehlen, dann nur
        die wenigen Kinder abfragen, bei denen ueberhaupt etwas liegt. Aus 60
        Anfragen werden zwei plus eine Handvoll.
        """
        traeger: dict = {}   # student_id -> {"notizen", "elternlog"}
        for kid, _name in self.klassen:
            for modul, pfad in (("notizen", "/api/notizen/counts"),
                                ("elternlog", "/api/elternlog/counts")):
                zahlen = self.api.call("GET", f"{pfad}?class_id={kid}", erwartet=(200, 403, 404))
                # 403 (Modul aus) und 404 liefern KEINE Zaehlung, sondern
                # {"detail": "..."} — das sah wie ein Ergebnis aus und riss den
                # Lauf mit `int('detail')` ab. Nur echte Zaehlwerte nehmen:
                # Schluessel ist die Schueler-ID, Wert die Anzahl.
                if not isinstance(zahlen, dict):
                    continue
                for sid, anzahl in zahlen.items():
                    if str(sid).isdigit() and isinstance(anzahl, int) and anzahl:
                        traeger.setdefault(int(sid), set()).add(modul)

        for sid, module in sorted(traeger.items()):
            if "notizen" in module:
                self.nimm("Notizen", "Beobachtung", self._get(f"/api/notizen?student_id={sid}"),
                          lambda o: [f"/api/notizen/{o['id']}"])
            if "elternlog" in module:
                self.nimm("Klassenleitung", "Elternkontakt", self._get(f"/api/elternlog?student_id={sid}"),
                          lambda o: [f"/api/elternlog/{o['id']}"])

    def _code_detektiv(self):
        # Geloescht wird ueber die client_id, nicht ueber die Datenbank-ID.
        self.nimm("Code-Detektiv", "Raetsel", self._get("/api/codedetektiv/puzzles"),
                  lambda o: [f"/api/codedetektiv/puzzles/{o['client_id']}"])

    def _kern(self, klassen):
        g = "Kern"
        self.nimm(g, "Thema", self._get("/api/topics"), lambda o: [f"/api/topics/{o['id']}"])
        # Klasse vor Kurs: jede Klasse haengt an ihrem Kurs (1:1).
        self.nimm(g, "Klasse", klassen,
                  lambda o: [f"/api/classes/{o['id']}", f"/api/classes/{o['id']}/purge"])
        self.nimm(g, "Kurs", self._get("/api/kurse"),
                  lambda o: [f"/api/kurse/{o['id']}", f"/api/kurse/{o['id']}/purge"])

        # Testschueler in einer echten Klasse: die kann dieses Werkzeug nicht
        # einzeln entfernen (das ginge nur ueber PUT /api/classes mit der
        # vollstaendigen Liste — ein Schreibzugriff auf fremde Daten). Melden
        # statt anfassen; von Hand unter /classes loeschen.
        for k in klassen:
            kname = k.get("name", "")
            if mit_praefix(kname):
                continue   # geht mit der Testklasse ohnehin weg
            for s in k.get("students") or []:
                if mit_praefix(s.get("name", "")):
                    self.funde.append(Fund(
                        g, "Schueler", _kurz(s.get("name", "")), [],
                        hinweis=f"in Klasse '{_kurz(kname, 30)}' — von Hand unter /classes entfernen"))

    def _papierkorb(self):
        eintraege = self._get("/api/trash")
        # Kinder vor Eltern, sonst laeuft der Purge ins Leere.
        rang = {k: i for i, k in enumerate(TRASH_REIHENFOLGE)}
        eintraege = sorted(eintraege, key=lambda e: rang.get(e.get("kind"), 99))
        self.nimm("Papierkorb", "Eintrag", eintraege,
                  lambda o: [f"/api/trash/{o['kind']}/{o['id']}"], felder=("label",))


# ────────────────── Module ──────────────────

def modulzustand(api):
    module = api.call("GET", "/api/modules", erwartet=(200,))
    verfuegbar = [m["key"] for m in module if m.get("available")]
    aktiv = {m["key"] for m in module if m.get("active")}
    return verfuegbar, aktiv


def setze_module(api, b, soll, ist, verfuegbar):
    """Modulzustand angleichen. Was nicht geht, kommt unter 'Reste'."""
    for key in sorted(set(soll) - set(ist)):
        if key not in verfuegbar:
            continue
        try:
            api.call("POST", f"/api/modules/{key}/activate", erwartet=(200,))
        except Exception as e:
            b.reste.append(f"Modul {key} liess sich nicht zuschalten: {e}")
    for key in sorted(set(ist) - set(soll)):
        try:
            api.call("DELETE", f"/api/modules/{key}/activate", erwartet=(200,))
        except Exception as e:
            b.reste.append(f"Modul {key} blieb zugeschaltet: {e}")


# ────────────────── Ablauf ──────────────────

def lies_deploy_env():
    """Zugangsdaten aus .deploy.env — dieselbe Quelle wie selftest.sh."""
    werte = {}
    pfad = os.path.join(WURZEL, ".deploy.env")
    try:
        with open(pfad) as f:
            for zeile in f:
                zeile = zeile.strip()
                if not zeile or zeile.startswith("#") or "=" not in zeile:
                    continue
                k, v = zeile.split("=", 1)
                werte[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        # Bewusst still und nur fuer Dateifehler: .deploy.env ist optional
        # (gitignored, auf fremden Rechnern gar nicht vorhanden). Fehlen die
        # Werte, sagt main() unten klar, was zu setzen ist — ein Abbruch hier
        # waere eine schlechtere Auskunft. Andere Fehler bleiben sichtbar.
        pass
    return werte


def main():
    p = argparse.ArgumentParser(
        description="Testreste (ZZ-Selbsttest / ZZ-Systemtest) finden und den Modulzustand "
                    "zurueckstellen. Ohne --loeschen wird nur aufgelistet.")
    p.add_argument("--url", default=os.environ.get("SELFTEST_URL") or os.environ.get("SITE_URL"))
    p.add_argument("--email", default=os.environ.get("SELFTEST_EMAIL"))
    p.add_argument("--passwort", default=os.environ.get("SELFTEST_PASSWORD"))
    p.add_argument("--loeschen", action="store_true",
                   help="gefundene Reste wirklich loeschen (Vorgabe ist die Trockenuebung)")
    p.add_argument("--module-aus", action="store_true",
                   help="alle Module abschalten, wenn der Ausgangszustand unbekannt ist")
    p.add_argument("--module-an", action="store_true",
                   help="alle Module anschalten, wenn der Ausgangszustand unbekannt ist")
    p.add_argument("--json", action="store_true", help="Ergebnis als JSON ausgeben")
    p.add_argument("--debug", action="store_true", help="jede Anfrage mitschreiben")
    args = p.parse_args()

    env = lies_deploy_env()
    url = args.url or env.get("SELFTEST_URL") or env.get("SITE_URL")
    email = args.email or env.get("SELFTEST_EMAIL")
    passwort = args.passwort or env.get("SELFTEST_PASSWORD")

    if not url:
        print("Fehler: keine URL. --url oder SELFTEST_URL/SITE_URL setzen.", file=sys.stderr)
        return 2
    if not (email and passwort):
        print("Fehler: kein Zugang. --email/--passwort oder SELFTEST_EMAIL/SELFTEST_PASSWORD "
              "setzen (sonst aus .deploy.env).", file=sys.stderr)
        return 2
    if args.module_aus and args.module_an:
        print("Fehler: --module-aus und --module-an schliessen einander aus.", file=sys.stderr)
        return 2

    api = Api(url, debug=args.debug)
    b = Aufraeumbericht()
    if not args.json:
        print(f"Nuvora aufraeumen gegen {url}"
              + ("" if args.loeschen else "   (Trockenuebung — nichts wird geloescht)"))

    def login():
        d = api.call("POST", "/api/auth/login", {"email": email, "password": passwort},
                     erwartet=(200,))
        api.token = d["token"]
        return f"angemeldet als {d['user'].get('email')}"

    if not b.pruefe("Anmeldung", "Login", login):
        b.drucke()
        return 1

    # 1. Modulzustand: erst merken, was gerade an ist (das ist der KAPUTTE
    #    Zustand nach einem Abbruch — der gute steht, wenn ueberhaupt, in der
    #    Datei), dann alles zuschalten. Ohne aktives Modul antwortet dessen
    #    API mit 403, und dann findet die Suche nichts.
    verfuegbar, jetzt_aktiv = modulzustand(api)
    gemerkt = lies_module(api.basis)
    b.add("Module", "Zustand jetzt", True,
          f"{len(jetzt_aktiv)} von {len(verfuegbar)} aktiv: " + (", ".join(sorted(jetzt_aktiv)) or "keins"))
    setze_module(api, b, set(verfuegbar), jetzt_aktiv, verfuegbar)
    b.add("Module", "Fuer die Suche", True, "alle Module voruebergehend zugeschaltet")

    try:
        # 2. Suchen.
        s = Sammler(api, b)
        funde = s.alles()
        if not funde:
            b.add("Suche", "Testreste", True, "nichts mit Praefix "
                  + " / ".join(PRAEFIXE) + " gefunden")
        else:
            for gruppe in dict.fromkeys(f.gruppe for f in funde):
                for f in [x for x in funde if x.gruppe == gruppe]:
                    b.add("Gefunden: " + gruppe, str(f), True,
                          "" if f.pfade else "nur Meldung, nicht loeschbar")

        # 3. Loeschen — aber nur auf ausdruecklichen Wunsch.
        if funde and not args.loeschen:
            b.add("Aufraeumen", "Trockenuebung", True, schwere="warnung",
                  detail=f"{len(funde)} Reste gefunden, nichts geloescht. "
                         "Mit --loeschen wirklich abraeumen.")
        elif funde:
            geloescht = 0
            for f in funde:
                if not f.pfade:
                    b.reste.append(f"{f.art} '{f.label}' — {f.hinweis}")
                    continue
                try:
                    f.loesche(api)
                    geloescht += 1
                except Exception as e:
                    b.reste.append(f"{f.art} '{f.label}': {e}")
            b.add("Aufraeumen", "Geloescht", True, f"{geloescht} Objekte")

            # Weich Geloeschtes landet im Papierkorb — der wird jetzt erst
            # richtig voll, also ein zweiter Durchgang.
            def papierkorb():
                rang = {k: i for i, k in enumerate(TRASH_REIHENFOLGE)}
                offen = sorted(api.call("GET", "/api/trash", erwartet=(200,)) or [],
                               key=lambda e: rang.get(e.get("kind"), 99))
                n = 0
                for e in offen:
                    if not mit_praefix(e.get("label", "")):
                        continue
                    api.call("DELETE", f"/api/trash/{e['kind']}/{e['id']}",
                             erwartet=(200, 204, 404))
                    n += 1
                return f"{n} Eintraege endgueltig geloescht"

            b.pruefe("Aufraeumen", "Papierkorb", papierkorb)

            # 4. Nachsehen: was jetzt noch da ist, ist ein Befund.
            def nachkontrolle():
                rest = Sammler(api, Bericht()).alles()
                loeschbar = [f for f in rest if f.pfade]
                if loeschbar:
                    raise AssertionError("noch da: " + ", ".join(str(f) for f in loeschbar[:8]))
                return "nichts mit Testpraefix mehr da"

            b.pruefe("Aufraeumen", "Nachkontrolle", nachkontrolle)
    finally:
        # 5. Modulzustand zurueckstellen — auch wenn oben etwas schiefging.
        _, ist = modulzustand(api)
        if gemerkt:
            soll = set(gemerkt.get("aktiv") or [])
            vorher_reste = len(b.reste)
            setze_module(api, b, soll, ist, verfuegbar)
            b.add("Module", "Zurueckgestellt", True,
                  f"nach dem gemerkten Ausgangszustand vom {gemerkt.get('zeit', '?')}: "
                  + (", ".join(sorted(soll)) or "keins aktiv"))
            # Nur vergessen, wenn das Zurueckstellen selbst geklappt hat —
            # liegengebliebene Testdaten sind ein anderes Problem und duerfen
            # den gemerkten Zustand nicht mit in den Papierkorb reissen.
            if len(b.reste) == vorher_reste:
                vergiss_module(api.basis)
        elif args.module_aus or args.module_an:
            soll = set(verfuegbar) if args.module_an else set()
            setze_module(api, b, soll, ist, verfuegbar)
            b.add("Module", "Gesetzt", True,
                  ("alle Module angeschaltet" if args.module_an else "alle Module abgeschaltet")
                  + " (ausdruecklich gewuenscht, nicht der gemerkte Ausgangszustand)")
        else:
            # Nicht raten. Zurueck auf den Stand von vorhin — das ist genau
            # der, den der Aufrufer vorgefunden hat — und sagen, was fehlt.
            setze_module(api, b, jetzt_aktiv, ist, verfuegbar)
            b.add("Module", "Ausgangszustand", False, schwere="warnung",
                  detail=f"unbekannt — {os.path.basename(MODUL_DATEI)} enthaelt nichts fuer "
                         f"{api.basis}. Aktiv ist wieder, was beim Start aktiv war: "
                         + (", ".join(sorted(jetzt_aktiv)) or "keins")
                         + ". Wenn das falsch ist: --module-aus oder --module-an.")

    if args.json:
        print(b.als_json())
    else:
        b.drucke()
    return 1 if (b.fehler or b.reste) else 0


if __name__ == "__main__":
    sys.exit(main())
