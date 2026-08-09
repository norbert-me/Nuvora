#!/usr/bin/env python3
"""Nuvora — Selbsttest der laufenden Installation (laeuft nach jedem Deploy).

Drei Ebenen, in dieser Reihenfolge:

1. System        — /api/health, /api/version, /site.json, Lernpfad-Statik, Shell-Seiten.
2. Einrichtung   — /api/selftest im Server (Schema gegen die Modelle, Konfiguration,
                   Betreiberdaten, Registry gegen gemountete Router). Nur fuer die
                   Administration; mit einem normalen Konto wird der Teil uebersprungen.
3. Module        — je Modul ein echter Schreib-Roundtrip (anlegen, lesen, aendern,
                   loeschen) auf dem Kern. Danach wird alles wieder abgeraeumt,
                   inklusive Papierkorb.

Der Roundtrip schreibt in die Datenbank des angegebenen Kontos. Alles Angelegte
traegt das Praefix aus PRAEFIX und wird am Ende hart geloescht; was nicht
abgeraeumt werden konnte, steht am Schluss unter "Reste" — dann von Hand
nachsehen, nicht ignorieren.

Nutzung:
    scripts/selftest.py --url https://… --email … --passwort …
    scripts/selftest.py                       (nimmt SELFTEST_* / SITE_URL aus der Umgebung)
    scripts/selftest.py --json                (Maschinenlesbar, fuer eigene Auswertung)

Rueckgabewert: 0 = alles gruen (Warnungen erlaubt), 1 = mindestens ein Fehler.
Nur Standardbibliothek, damit der Test ohne Installation ueberall laeuft.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta

PRAEFIX = "ZZ-Selbsttest"
TIMEOUT = 30


# ─────────────────────────── HTTP ───────────────────────────

class ApiFehler(Exception):
    def __init__(self, methode, pfad, status, text):
        super().__init__(f"{methode} {pfad} -> {status}: {text[:200]}")
        self.status = status


class Api:
    """Duenner HTTP-Client auf urllib — kein requests, keine Installation."""

    def __init__(self, basis):
        self.basis = basis.rstrip("/")
        self.token = None

    def call(self, methode, pfad, body=None, erwartet=None, roh=False):
        url = pfad if pfad.startswith("http") else self.basis + pfad
        daten = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=daten, method=methode)
        if daten is not None:
            req.add_header("Content-Type", "application/json")
        if self.token:
            req.add_header("Authorization", "Bearer " + self.token)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                status, inhalt = r.status, r.read()
        except urllib.error.HTTPError as e:
            status, inhalt = e.code, e.read()
        except Exception as e:  # DNS, TLS, Verbindung
            raise ApiFehler(methode, pfad, 0, str(e))
        text = inhalt.decode("utf-8", "replace")
        if erwartet and status not in erwartet:
            raise ApiFehler(methode, pfad, status, text)
        if roh:
            return status, text
        if not text:
            return None
        try:
            return json.loads(text)
        except ValueError:
            return text


# ─────────────────────────── Bericht ───────────────────────────

class Bericht:
    def __init__(self):
        self.zeilen = []      # (gruppe, name, ok, schwere, detail)
        self.reste = []

    def add(self, gruppe, name, ok, detail="", schwere="fehler"):
        self.zeilen.append((gruppe, name, ok, schwere, detail))
        return ok

    def pruefe(self, gruppe, name, fn, schwere="fehler"):
        """Einen Check ausfuehren; jede Ausnahme ist ein Fehlschlag mit Grund."""
        try:
            detail = fn() or ""
            return self.add(gruppe, name, True, str(detail), schwere)
        except Exception as e:
            return self.add(gruppe, name, False, str(e), schwere)

    @property
    def fehler(self):
        return [z for z in self.zeilen if not z[2] and z[3] == "fehler"]

    @property
    def warnungen(self):
        return [z for z in self.zeilen if not z[2] and z[3] == "warnung"]

    def drucke(self):
        gruppe_vorher = None
        for gruppe, name, ok, schwere, detail in self.zeilen:
            if gruppe != gruppe_vorher:
                print(f"\n── {gruppe}")
                gruppe_vorher = gruppe
            zeichen = "✓" if ok else ("!" if schwere == "warnung" else "✗")
            zeile = f"  {zeichen} {name}"
            if detail:
                zeile += f"   {detail}"
            print(zeile)
        if self.reste:
            print("\n── Reste (nicht abgeraeumt — von Hand pruefen)")
            for r in self.reste:
                print(f"  ! {r}")
        print("\n" + "=" * 40)
        if not self.fehler:
            print(f"  Selbsttest gruen — {len(self.zeilen)} Checks, "
                  f"{len(self.warnungen)} Warnung(en).")
        else:
            print(f"  Selbsttest ROT — {len(self.fehler)} Fehler, "
                  f"{len(self.warnungen)} Warnung(en):")
            for gruppe, name, _ok, _s, detail in self.fehler:
                print(f"    ✗ {gruppe} / {name}: {detail}")
        print("=" * 40)

    def als_json(self):
        return json.dumps({
            "ok": not self.fehler,
            "fehler": len(self.fehler),
            "warnungen": len(self.warnungen),
            "reste": self.reste,
            "checks": [{"gruppe": g, "name": n, "ok": o, "schwere": s, "detail": d}
                       for g, n, o, s, d in self.zeilen],
        }, ensure_ascii=False, indent=2)


# ─────────────────────────── 1. System ───────────────────────────

def teste_system(api, b):
    def health():
        d = api.call("GET", "/api/health", erwartet=(200,))
        if d.get("status") != "ok":
            raise AssertionError(f"Status {d}")
        return "Kern und Datenbank erreichbar"

    def version():
        # Die Version sieht nur die Administration. Ohne Login (oder mit einem
        # normalen Konto) ist 401/403 die richtige Antwort — der Endpunkt lebt.
        status, text = api.call("GET", "/api/version", roh=True)
        if status in (401, 403):
            return "erreichbar (nur fuer die Administration sichtbar)"
        if status != 200:
            raise AssertionError(f"HTTP {status}: {text[:120]}")
        d = json.loads(text)
        return f"v{d.get('version', '?')} (Kanal {d.get('channel', '?')})"

    def site_json():
        status, text = api.call("GET", "/site.json", roh=True)
        if status != 200:
            raise AssertionError(f"HTTP {status} — Proxy liefert die Betreiberdaten nicht aus")
        daten = json.loads(text)
        leer = [f for f in ("betreiber", "strasse", "plz_ort", "email")
                if not str(daten.get(f) or "").strip()]
        if leer:
            raise AssertionError("leere Pflichtfelder: " + ", ".join(leer))
        return "Impressumsdaten vollstaendig"

    def statik(pfad, muss_enthalten=None):
        def fn():
            status, text = api.call("GET", pfad, roh=True)
            if status != 200:
                raise AssertionError(f"HTTP {status}")
            if muss_enthalten and muss_enthalten not in text:
                raise AssertionError(f"Inhalt unerwartet ('{muss_enthalten}' fehlt)")
            return f"{len(text)} Zeichen"
        return fn

    b.pruefe("System", "/api/health", health)
    b.pruefe("System", "/api/version", version)
    b.pruefe("System", "/site.json", site_json)
    # Shell: liefert der Web-Container die gebaute App aus?
    b.pruefe("System", "Shell /", statik("/", "<div id=\"root\""))
    # Lernpfad laeuft in-page aus apps/web/public/lp/ — genau diese drei Dateien
    # zieht LernpfadModule.jsx. Fehlt eine, ist das Modul stumm.
    b.pruefe("System", "Lernpfad /lp/index.html", statik("/lp/index.html"))
    # __nuvoraInPage: daran erkennt die App den In-page-Modus. Fehlt es, ist
    # eine alte, nur fuer den eigenen Container gebaute Fassung ausgeliefert.
    b.pruefe("System", "Lernpfad /lp/js/app.js", statik("/lp/js/app.js", "__nuvoraInPage"))
    b.pruefe("System", "Lernpfad /lp/css/style.scoped.css",
             statik("/lp/css/style.scoped.css", "#lp-app"))


# ─────────────────────────── 2. Einrichtung (Server) ───────────────────────────

def teste_einrichtung(api, b):
    status, text = api.call("GET", "/api/selftest", roh=True)
    if status == 403:
        b.add("Einrichtung", "Server-Selbsttest", True, schwere="warnung",
              detail="uebersprungen — Konto ist nicht die Administration")
        return
    if status != 200:
        b.add("Einrichtung", "Server-Selbsttest", False, f"HTTP {status}: {text[:150]}")
        return
    daten = json.loads(text)
    for c in daten.get("checks", []):
        b.add("Einrichtung: " + c["gruppe"], c["name"], c["ok"], c.get("detail", ""),
              c.get("schwere", "fehler"))


# ─────────────────────────── 3. Module: Schreib-Roundtrip ───────────────────────────

class Umgebung:
    """Testdaten im Kern, auf denen alle Modul-Proben arbeiten.

    Eine Klasse mit zwei Schuelern und ein Kurs — genau das, was die Module
    voraussetzen duerfen (Regel: kein Modul besitzt Klassen oder Schueler).
    """

    def __init__(self, api, b):
        self.api, self.b = api, b
        self.class_id = self.kurs_id = self.topic_id = None
        self.students = []
        self.aufraeumen = []   # (beschreibung, fn) — in umgekehrter Reihenfolge

    def spaeter(self, beschreibung, fn):
        self.aufraeumen.append((beschreibung, fn))

    def _weg(self, prefix, oid):
        """Weich loeschen, dann endgueltig — purge verweigert alles, was nicht
        im Papierkorb liegt."""
        self.api.call("DELETE", f"{prefix}/{oid}", erwartet=(204, 404))
        self.api.call("DELETE", f"{prefix}/{oid}/purge", erwartet=(204, 404))

    def aufbauen(self):
        kl = self.api.call("POST", "/api/classes", {
            "name": f"{PRAEFIX} Klasse",
            "students": [{"card_id": 1, "name": f"{PRAEFIX} Anna"},
                         {"card_id": 2, "name": f"{PRAEFIX} Ben"}],
        }, erwartet=(201,))
        self.class_id = kl["id"]
        self.students = [s["id"] for s in kl.get("students", [])]
        # Jede neue Klasse bringt ihren eigenen Kurs mit (Kern, 1:1) — den nimmt
        # der Test, statt einen zweiten anzulegen.
        self.kurs_id = kl.get("kurs_id")
        # Reihenfolge: erst eintragen, was zuletzt weg soll. Abgeraeumt wird
        # rueckwaerts, also Klasse vor ihrem Kurs (sonst haengt die Klasse an
        # einem geloeschten Kurs).
        if self.kurs_id:
            self.spaeter(f"Kurs {self.kurs_id}", lambda: self._weg("/api/kurse", self.kurs_id))
        # Erst weich (Papierkorb), dann hart — purge verlangt genau diesen Weg.
        self.spaeter(f"Klasse {self.class_id}", lambda: self._weg("/api/classes", self.class_id))

        thema = self.api.call("POST", "/api/topics", {"name": f"{PRAEFIX} Thema"}, erwartet=(201,))
        self.topic_id = thema["id"]
        self.spaeter(f"Thema {self.topic_id}", lambda: self.api.call(
            "DELETE", f"/api/topics/{self.topic_id}", erwartet=(204, 404)))
        return f"Klasse {self.class_id}, Kurs {self.kurs_id}, Thema {self.topic_id}, " \
               f"{len(self.students)} Schueler"

    def abbauen(self):
        for beschreibung, fn in reversed(self.aufraeumen):
            try:
                fn()
            except Exception as e:
                self.b.reste.append(f"{beschreibung}: {e}")
        # Der Papierkorb ist im Kern — weich Geloeschtes der Module landet dort
        # und wuerde sonst als Testmuell stehen bleiben.
        try:
            for eintrag in self.api.call("GET", "/api/trash", erwartet=(200,)) or []:
                if PRAEFIX in str(eintrag.get("label", "")):
                    self.api.call("DELETE", f"/api/trash/{eintrag['kind']}/{eintrag['id']}",
                                  erwartet=(204, 404))
        except Exception as e:
            self.b.reste.append(f"Papierkorb: {e}")


def teste_kern(api, b, u):
    def klassen():
        alle = api.call("GET", "/api/classes", erwartet=(200,))
        if not any(k["id"] == u.class_id for k in alle):
            raise AssertionError("angelegte Klasse fehlt in der Liste")
        # Aendern muss die Schueler MERGEN, nicht neu anlegen — sonst reisst die
        # Kaskade Noten und Karten-Fortschritt mit.
        vorher = set(u.students)
        geaendert = api.call("PUT", f"/api/classes/{u.class_id}", {
            "name": f"{PRAEFIX} Klasse B",
            "students": [{"card_id": 1, "name": f"{PRAEFIX} Anna"},
                         {"card_id": 2, "name": f"{PRAEFIX} Ben"}],
        }, erwartet=(200,))
        nachher = {s["id"] for s in geaendert.get("students", [])}
        if vorher != nachher:
            raise AssertionError(f"Schueler-IDs haben sich geaendert ({vorher} -> {nachher}) — "
                                 "delete+recreate statt merge")
        return "anlegen, lesen, aendern (IDs stabil)"

    def kurse():
        mitglieder = api.call("GET", f"/api/kurse/{u.kurs_id}/students", erwartet=(200,))
        if len(mitglieder) < 2:
            raise AssertionError(f"Kurs hat {len(mitglieder)} Schueler statt 2")
        # Zusaetzlicher Kurs: anlegen, Klasse zuordnen, wieder loesen, entsorgen.
        zweit = api.call("POST", "/api/kurse", {"name": f"{PRAEFIX} Zweitkurs"}, erwartet=(201,))
        try:
            api.call("PUT", f"/api/kurse/{zweit['id']}", {"name": f"{PRAEFIX} Zweitkurs B"},
                     erwartet=(200,))
            api.call("POST", f"/api/kurse/{zweit['id']}/classes/{u.class_id}", erwartet=(204,))
            geteilt = api.call("GET", f"/api/kurse/{zweit['id']}/students", erwartet=(200,))
            if len(geteilt) < 2:
                raise AssertionError("Klasse teilt ihre Schueler nicht mit dem zweiten Kurs")
            api.call("DELETE", f"/api/kurse/{zweit['id']}/classes/{u.class_id}", erwartet=(204,))
        finally:
            api.call("DELETE", f"/api/kurse/{zweit['id']}", erwartet=(204, 404))
            api.call("DELETE", f"/api/kurse/{zweit['id']}/purge", erwartet=(204, 404))
        return f"{len(mitglieder)} Schueler im Kurs, zweiter Kurs teilt dieselben"

    def themen():
        api.call("PUT", f"/api/topics/{u.topic_id}",
                 {"name": f"{PRAEFIX} Thema", "ziel_g": "G-Ziel", "ziel_e": "E-Ziel"},
                 erwartet=(200,))
        api.call("GET", f"/api/topics/{u.topic_id}/usage", erwartet=(200,))
        return "Thema mit E/G-Zielen"

    def papierkorb():
        api.call("GET", "/api/trash", erwartet=(200,))
        return "erreichbar"

    def modulregister():
        module = api.call("GET", "/api/modules", erwartet=(200,))
        if not module:
            raise AssertionError("REGISTRY leer")
        return f"{len(module)} Module im Register"

    b.pruefe("Kern", "Klassen und Schueler", klassen)
    b.pruefe("Kern", "Kurse", kurse)
    b.pruefe("Kern", "Themen", themen)
    b.pruefe("Kern", "Papierkorb", papierkorb)
    b.pruefe("Kern", "Modulregister", modulregister)


# ── je Modul eine Probe: anlegen, lesen, aendern, loeschen ──

def probe_cardvote(api, u):
    ordner = api.call("POST", "/api/folders", {"name": f"{PRAEFIX} Ordner"}, erwartet=(201,))
    frage = api.call("POST", "/api/questions", {
        "text": f"{PRAEFIX} Frage", "question_type": "mc",
        "choices": {"A": "1", "B": "2", "C": "3", "D": "4"},
        "correct_answer": "A", "topic_id": u.topic_id,
    }, erwartet=(201,))
    satz = api.call("POST", "/api/question-sets", {
        "name": f"{PRAEFIX} Quiz", "folder_id": ordner["id"], "question_ids": [frage["id"]],
        "niveau_aktiv": True, "niveaus": {str(frage["id"]): "E"},
    }, erwartet=(201,))
    sitzung = api.call("POST", "/api/sessions", {
        "name": f"{PRAEFIX} Test", "class_id": u.class_id,
        "question_set_id": satz["id"], "mode": "test",
    }, erwartet=(201,))
    api.call("GET", f"/api/sessions/{sitzung['id']}", erwartet=(200,))
    api.call("GET", f"/api/sessions/{sitzung['id']}/evaluation", erwartet=(200,))
    api.call("GET", "/api/sessions-list", erwartet=(200,))
    api.call("GET", "/api/stats/dashboard", erwartet=(200,))
    api.call("DELETE", f"/api/sessions/{sitzung['id']}", erwartet=(204,))
    api.call("DELETE", f"/api/question-sets/{satz['id']}", erwartet=(204,))
    api.call("DELETE", f"/api/questions/{frage['id']}", erwartet=(204,))
    api.call("DELETE", f"/api/folders/{ordner['id']}", erwartet=(204,))
    return "Ordner, Frage, Quiz (E/G), Sitzung, Auswertung"


def probe_lernpfad(api, u):
    aufgabe = api.call("POST", "/api/lernpfad/exercises", {
        "topic_id": u.topic_id, "aufgabentext": f"{PRAEFIX} Aufgabe", "kategorie": "Uebung",
    }, erwartet=(201,))
    api.call("PUT", f"/api/lernpfad/exercises/{aufgabe['id']}",
             {"topic_id": u.topic_id, "aufgabentext": f"{PRAEFIX} Aufgabe 2"}, erwartet=(200,))
    api.call("GET", "/api/lernpfad/exercises", erwartet=(200,))
    pfad = api.call("POST", "/api/lernpfad/paths", {"name": f"{PRAEFIX} Pfad"}, erwartet=(201,))
    leiter = api.call("POST", f"/api/lernpfad/paths/{pfad['id']}/ladders",
                      {"class_id": u.class_id, "topic_id": u.topic_id}, erwartet=(201,))
    api.call("PUT", f"/api/lernpfad/ladders/{leiter['id']}",
             {"class_id": u.class_id, "topic_id": u.topic_id, "notizen": "Test"}, erwartet=(200,))
    # weich loeschen -> Papierkorb -> hart loeschen (genau der Weg der Oberflaeche)
    api.call("DELETE", f"/api/lernpfad/paths/{pfad['id']}", erwartet=(204,))
    api.call("POST", f"/api/lernpfad/paths/{pfad['id']}/restore", erwartet=(200,))
    api.call("DELETE", f"/api/lernpfad/paths/{pfad['id']}", erwartet=(204,))
    api.call("DELETE", f"/api/lernpfad/paths/{pfad['id']}/purge", erwartet=(204,))
    api.call("DELETE", f"/api/lernpfad/exercises/{aufgabe['id']}", erwartet=(204,))
    return "Aufgabe, Pfad mit Lernleiter, Papierkorb-Weg"


def probe_auswertung(api, u):
    block = api.call("POST", f"/api/noten/classes/{u.class_id}/sections",
                     {"name": f"{PRAEFIX} Block", "weight": 100}, erwartet=(201,))
    spalte = api.call("POST", "/api/noten/categories",
                      {"name": f"{PRAEFIX} Spalte", "section_id": block["id"],
                       "topic_id": u.topic_id}, erwartet=(201,))
    eintrag = api.call("POST", "/api/noten/entries", {
        "category_id": spalte["id"], "student_id": u.students[0], "kind": "grade", "value": 2.0,
    }, erwartet=(201,))
    # Invariante: eine Beobachtung mit Notenwert muss abgelehnt werden.
    # Faellt das durch, erodiert die Trennung von Messwert und Beobachtung.
    status, _ = api.call("POST", "/api/noten/entries", {
        "category_id": spalte["id"], "student_id": u.students[1],
        "kind": "observation", "value": 3.0,
    }, roh=True)
    if status < 400:
        raise AssertionError("Beobachtung mit Notenwert wurde angenommen (HTTP "
                             f"{status}) — Beobachtungen duerfen nie zaehlen")
    zusammenfassung = api.call("GET", f"/api/noten/classes/{u.class_id}/summary", erwartet=(200,))
    if not zusammenfassung:
        raise AssertionError("Zusammenfassung leer")
    arbeit = api.call("POST", "/api/klassenarbeit/works",
                      {"class_id": u.class_id, "name": f"{PRAEFIX} Arbeit"}, erwartet=(201,))
    api.call("GET", f"/api/klassenarbeit/works/{arbeit['id']}/analysis", erwartet=(200,))
    api.call("DELETE", f"/api/klassenarbeit/works/{arbeit['id']}", erwartet=(204,))
    api.call("DELETE", f"/api/noten/entries/{eintrag['id']}", erwartet=(204,))
    api.call("DELETE", f"/api/noten/categories/{spalte['id']}", erwartet=(204,))
    api.call("DELETE", f"/api/noten/sections/{block['id']}", erwartet=(204,))
    return "Block, Spalte, Note, Klassenarbeit; Beobachtung ohne Note erzwungen"


def probe_karten(api, u):
    stapel = api.call("POST", f"/api/karten/classes/{u.class_id}/decks",
                      {"name": f"{PRAEFIX} Stapel", "topic_id": u.topic_id}, erwartet=(201,))
    karte = api.call("POST", f"/api/karten/decks/{stapel['id']}/cards",
                     {"front": "1+1", "back": "2"}, erwartet=(201,))
    api.call("PUT", f"/api/karten/cards/{karte['id']}", {"front": "2+2", "back": "4"},
             erwartet=(200,))
    api.call("GET", f"/api/karten/classes/{u.class_id}/decks", erwartet=(200,))
    api.call("POST", f"/api/karten/classes/{u.class_id}/tokens", erwartet=(200, 201))
    api.call("GET", f"/api/karten/classes/{u.class_id}/progress", erwartet=(200,))
    api.call("DELETE", f"/api/karten/cards/{karte['id']}", erwartet=(204,))
    api.call("DELETE", f"/api/karten/decks/{stapel['id']}", erwartet=(204,))
    api.call("DELETE", f"/api/karten/decks/{stapel['id']}/purge", erwartet=(204,))
    return "Stapel, Karte, Schueler-Zugaenge, Fortschritt"


def probe_kalender(api, u):
    tag = datetime.now().replace(microsecond=0)
    eintrag = api.call("POST", "/api/kalender/entries", {
        "date": tag.isoformat(), "title": f"{PRAEFIX} Stunde",
        "class_id": u.class_id, "topic_id": u.topic_id,
    }, erwartet=(201,))
    api.call("GET", "/api/kalender/entries", erwartet=(200,))
    pause = api.call("POST", "/api/kalender/breaks", {
        "start_date": tag.isoformat(), "end_date": (tag + timedelta(days=1)).isoformat(),
        "label": f"{PRAEFIX} frei",
    }, erwartet=(201,))
    slot = api.call("PUT", "/api/kalender/timetable/slot", {
        "weekday": 0, "period": 1, "class_id": u.class_id, "title": f"{PRAEFIX} Slot",
    }, erwartet=(200,))
    api.call("GET", "/api/kalender/timetable", erwartet=(200,))
    arbeit = api.call("POST", "/api/kalender/klassenarbeiten", {
        "date": tag.isoformat(), "title": f"{PRAEFIX} KA", "class_id": u.class_id,
    }, erwartet=(201,))
    # Am Klassenarbeitstermin zeigt der Kalender die vereinbarten Massnahmen.
    api.call("GET", f"/api/classes/{u.class_id}/massnahmen?arbeit=true", erwartet=(200,))
    api.call("DELETE", f"/api/kalender/klassenarbeiten/{arbeit['id']}", erwartet=(204,))
    api.call("DELETE", f"/api/kalender/timetable/slot/{slot['id']}", erwartet=(204,))
    api.call("DELETE", f"/api/kalender/breaks/{pause['id']}", erwartet=(204,))
    api.call("DELETE", f"/api/kalender/entries/{eintrag['id']}", erwartet=(204,))
    return "Eintrag, Stundenplan-Slot, freier Zeitraum, Klassenarbeit + Massnahmen"


def probe_orga(api, u):
    posten = api.call("POST", f"/api/orga/{u.class_id}", {"name": f"{PRAEFIX} Zettel"},
                      erwartet=(201,))
    api.call("PUT", f"/api/orga/item/{posten['id']}/toggle", {"student_id": u.students[0]},
             erwartet=(200,))
    api.call("GET", f"/api/orga/{u.class_id}", erwartet=(200,))
    api.call("DELETE", f"/api/orga/item/{posten['id']}", erwartet=(204,))
    # Anwesenheit, Sitzplan und Ausleihe haengen am selben Modul.
    heute = datetime.now().replace(microsecond=0).isoformat()
    api.call("PUT", f"/api/anwesenheit/{u.class_id}",
             {"student_id": u.students[0], "date": heute, "status": "da"}, erwartet=(200,))
    api.call("GET", f"/api/anwesenheit/{u.class_id}", erwartet=(200,))
    api.call("PUT", f"/api/sitzplan/{u.class_id}",
             {"seats": [{"sid": u.students[0], "x": 1, "y": 1}]}, erwartet=(200,))
    api.call("GET", f"/api/sitzplan/{u.class_id}", erwartet=(200,))
    gegenstand = api.call("POST", "/api/ausleihe/items", {"name": f"{PRAEFIX} Buch"},
                          erwartet=(201,))
    leihe = api.call("POST", "/api/ausleihe/loans",
                     {"item_id": gegenstand["id"], "student_id": u.students[0]}, erwartet=(201,))
    api.call("PUT", f"/api/ausleihe/loans/{leihe['id']}/return", erwartet=(200,))
    api.call("DELETE", f"/api/ausleihe/items/{gegenstand['id']}", erwartet=(204,))
    return "Checkliste, Anwesenheit, Sitzplan, Ausleihe"


def probe_zufall(api, u):
    api.call("GET", f"/api/zufall/{u.class_id}", erwartet=(200,))
    api.call("POST", f"/api/zufall/{u.class_id}/draw", {"student_id": u.students[0]},
             erwartet=(200,))
    api.call("DELETE", f"/api/zufall/{u.class_id}", erwartet=(204,))
    return "ziehen und Gedaechtnis leeren"


def probe_unterrichtsplanung(api, u):
    api.call("GET", f"/api/planung/classes/{u.class_id}", erwartet=(200,))
    woche = api.call("POST", f"/api/planung/classes/{u.class_id}/weeks",
                     {"label": f"{PRAEFIX} Woche"}, erwartet=(201,))
    api.call("POST", f"/api/planung/weeks/{woche['id']}/blocks",
             {"topic_id": u.topic_id, "position": 0}, erwartet=(201,))
    api.call("DELETE", f"/api/planung/weeks/{woche['id']}", erwartet=(204,))
    ordner = api.call("POST", "/api/methoden/folders", {"name": f"{PRAEFIX} Methoden"},
                      erwartet=(201,))
    methode = api.call("POST", "/api/methoden/", {
        "title": f"{PRAEFIX} Einstieg", "description": "Idee", "folder_id": ordner["id"],
        "topic_id": u.topic_id,
    }, erwartet=(201,))
    api.call("GET", "/api/methoden/list", erwartet=(200,))
    api.call("DELETE", f"/api/methoden/{methode['id']}", erwartet=(204,))
    api.call("DELETE", f"/api/methoden/folders/{ordner['id']}", erwartet=(204,))
    return "Wochen mit Bloecken, Methodensammlung"


def probe_notizbrett(api, u):
    notiz = api.call("POST", "/api/notizblock",
                     {"title": f"{PRAEFIX} Notiz", "content": "Text"}, erwartet=(201,))
    api.call("PUT", f"/api/notizblock/{notiz['id']}",
             {"title": f"{PRAEFIX} Notiz 2", "content": "Text"}, erwartet=(200,))
    api.call("GET", "/api/notizblock", erwartet=(200,))
    api.call("DELETE", f"/api/notizblock/{notiz['id']}", erwartet=(204,))
    aufgabe = api.call("POST", "/api/todo", {"text": f"{PRAEFIX} To-do"}, erwartet=(201,))
    api.call("PUT", f"/api/todo/{aufgabe['id']}", {"text": f"{PRAEFIX} To-do 2"}, erwartet=(200,))
    api.call("DELETE", f"/api/todo/{aufgabe['id']}", erwartet=(204,))
    return "Notizzettel und To-dos"


def probe_notizen(api, u):
    beobachtung = api.call("POST", "/api/notizen",
                           {"student_id": u.students[0], "text": f"{PRAEFIX} Beobachtung"},
                           erwartet=(201,))
    api.call("PUT", f"/api/notizen/{beobachtung['id']}",
             {"student_id": u.students[0], "text": f"{PRAEFIX} Beobachtung 2"}, erwartet=(200,))
    api.call("GET", "/api/notizen/counts", erwartet=(200,))
    api.call("DELETE", f"/api/notizen/{beobachtung['id']}", erwartet=(204,))
    return "Beobachtung anlegen, aendern, loeschen"


def probe_klassenleitung(api, u):
    kontakt = api.call("POST", "/api/elternlog",
                       {"student_id": u.students[0], "channel": "Telefon",
                        "text": f"{PRAEFIX} Gespraech"}, erwartet=(201,))
    api.call("PUT", f"/api/elternlog/{kontakt['id']}",
             {"student_id": u.students[0], "text": f"{PRAEFIX} Gespraech 2"}, erwartet=(200,))
    api.call("GET", "/api/elternlog/counts", erwartet=(200,))
    api.call("DELETE", f"/api/elternlog/{kontakt['id']}", erwartet=(204,))
    return "Elternkontakt anlegen, aendern, loeschen"


def probe_code_detektiv(api, u):
    raetsel_id = f"{PRAEFIX}-raetsel"
    api.call("PUT", "/api/codedetektiv/puzzles", {
        "client_id": raetsel_id, "title": f"{PRAEFIX} Raetsel",
        "topic_id": u.topic_id, "payload": {"blocks": []},
    }, erwartet=(200,))
    api.call("GET", "/api/codedetektiv/puzzles", erwartet=(200,))
    api.call("DELETE", f"/api/codedetektiv/puzzles/{raetsel_id}", erwartet=(204,))
    return "Raetsel speichern und loeschen"


# Modul-Schluessel (REGISTRY) -> Probe. Module ohne Backend stehen mit None
# hier: sie werden im Browser-Test geprueft, nicht ueber die API.
PROBEN = {
    "cardvote": probe_cardvote,
    "lernpfad": probe_lernpfad,
    "auswertung": probe_auswertung,
    "karten": probe_karten,
    "kalender": probe_kalender,
    "orga": probe_orga,
    "zufall": probe_zufall,
    "unterrichtsplanung": probe_unterrichtsplanung,
    "notizbrett": probe_notizbrett,
    "notizen": probe_notizen,
    "klassenleitung": probe_klassenleitung,
    "code-detektiv": probe_code_detektiv,
    "tafel": None,
    "mathespiele": None,
}


def teste_module(api, b, u):
    """Jedes Modul aus dem REGISTRY einmal wirklich benutzen.

    Die Modul-Endpunkte sind serverseitig hinter der Aktivierung gesperrt
    (require_module), also wird jedes Modul fuer den Test zugeschaltet und der
    Zustand danach wiederhergestellt — der Selbsttest darf die Einstellungen
    des Kontos nicht dauerhaft veraendern.
    """
    module = api.call("GET", "/api/modules", erwartet=(200,))
    vorher_aktiv = {m["key"] for m in module if m.get("active")}
    zugeschaltet = []
    try:
        for m in module:
            if not m.get("available") or m["key"] in vorher_aktiv:
                continue
            try:
                api.call("POST", f"/api/modules/{m['key']}/activate", erwartet=(200,))
                zugeschaltet.append(m["key"])
            except Exception as e:
                b.add("Module", m["key"], False, f"Aktivieren fehlgeschlagen: {e}")

        for m in module:
            key, name = m["key"], m.get("name", m["key"])
            if key not in PROBEN:
                b.add("Module", name, False,
                      f"'{key}' steht im REGISTRY, hat aber keine Probe in scripts/selftest.py")
                continue
            probe = PROBEN[key]
            if probe is None:
                b.add("Module", name, True, "reines Frontend-Modul — Prüfung im Browser-Test")
                continue
            b.pruefe("Module", name, lambda p=probe: p(api, u))
    finally:
        for key in zugeschaltet:
            try:
                api.call("DELETE", f"/api/modules/{key}/activate", erwartet=(200,))
            except Exception as e:
                b.reste.append(f"Modul {key} blieb zugeschaltet: {e}")


def teste_seiten(api, b):
    """Jede Modul-Seite und jede Kern-Seite muss die Shell ausliefern.

    Das faengt den Fall ab, dass ein Modul im REGISTRY einen Pfad nennt, den
    der Proxy nicht auf die Shell leitet (dann kaeme 404 statt der App).
    """
    module = api.call("GET", "/api/modules", erwartet=(200,))
    pfade = [m["path"] for m in module if m.get("available") and not m.get("external")]
    pfade += ["/modules", "/classes", "/kurse", "/topics", "/papierkorb", "/profile",
              "/legal", "/contact", "/help", "/tutorial", "/marktplatz", "/login"]
    for pfad in sorted(set(pfade)):
        def fn(p=pfad):
            status, text = api.call("GET", p, roh=True)
            if status != 200:
                raise AssertionError(f"HTTP {status}")
            if "<div id=\"root\"" not in text:
                raise AssertionError("liefert nicht die Shell aus")
            return "Shell"
        b.pruefe("Seiten", pfad, fn)


# ─────────────────────────── Ablauf ───────────────────────────

def main():
    p = argparse.ArgumentParser(description="Selbsttest der laufenden Nuvora-Installation")
    p.add_argument("--url", default=os.environ.get("SELFTEST_URL") or os.environ.get("SITE_URL"))
    p.add_argument("--email", default=os.environ.get("SELFTEST_EMAIL"))
    p.add_argument("--passwort", default=os.environ.get("SELFTEST_PASSWORD"))
    p.add_argument("--nur-system", action="store_true",
                   help="nur die Checks ohne Login (kein Schreib-Roundtrip)")
    p.add_argument("--json", action="store_true", help="Ergebnis als JSON ausgeben")
    args = p.parse_args()

    if not args.url:
        print("Fehler: keine URL. --url oder SELFTEST_URL/SITE_URL setzen.", file=sys.stderr)
        return 2

    api = Api(args.url)
    b = Bericht()
    if not args.json:
        print(f"Nuvora-Selbsttest gegen {args.url}")

    teste_system(api, b)

    if args.nur_system or not (args.email and args.passwort):
        if not args.nur_system:
            b.add("Anmeldung", "Zugangsdaten", True, schwere="warnung",
                  detail="SELFTEST_EMAIL/SELFTEST_PASSWORD fehlen — "
                         "Module und Einrichtung ungeprueft")
    else:
        angemeldet = False

        def login():
            nonlocal angemeldet
            d = api.call("POST", "/api/auth/login",
                         {"email": args.email, "password": args.passwort}, erwartet=(200,))
            api.token = d["token"]
            api.call("GET", "/api/auth/me", erwartet=(200,))
            angemeldet = True
            return f"angemeldet als {d['user'].get('email')}"

        b.pruefe("Anmeldung", "Login", login)
        if angemeldet:
            teste_einrichtung(api, b)
            teste_seiten(api, b)
            u = Umgebung(api, b)
            if b.pruefe("Kern", "Testdaten anlegen", u.aufbauen):
                try:
                    teste_kern(api, b, u)
                    teste_module(api, b, u)
                finally:
                    u.abbauen()

    if args.json:
        print(b.als_json())
    else:
        b.drucke()
    return 1 if b.fehler else 0


if __name__ == "__main__":
    sys.exit(main())
