#!/usr/bin/env python3
"""Lasttest der Schueler-Wege: eine Schulklasse gleichzeitig.

Warum es das gibt
─────────────────
Der Selbsttest fragt „geht es?" — eine Anfrage nach der anderen. Eine
Schulklasse fragt etwas anderes: **30 Geraete im selben Moment, hinter EINER
Adresse.** Alles, was pro IP zaehlt (App-Drosselung, nginx `limit_req`), sieht
darin einen einzigen, sehr eifrigen Client. Dieses Skript misst, was davon
ankommt und was mit 429 abgewiesen wird.

Was es NICHT ist
────────────────
Kein Angriffswerkzeug. Es laeuft gegen die eigene Instanz (Login mit den
eigenen Zugangsdaten), die Zahl der Anfragen ist hart gedeckelt
(`MAX_ANFRAGEN`), und es raeumt seine Testdaten (Praefix `ZZ-Lasttest`)
hinterher wieder ab.

Gemessen wird
─────────────
- Karten (`/api/karten/lernen/<token>`): n Kinder lernen gleichzeitig.
- Code-Detektiv (`/api/codedetektiv/sessions/<code>`): n Kinder treten bei,
  pollen im Takt der App (alle 1,8 s, siehe `store.jsx`) und melden Ergebnisse.

Ausgabe je Probe: Anfragen gesamt, davon 429 abgewiesen, langsamste Anfrage,
Mittel und 95. Perzentil.

Beispiel:
    python3 scripts/lasttest.py --url http://127.0.0.1:8134 \
        --email test@nuvora.local --passwort 'Systemtest123!'
"""
import argparse
import os
import statistics
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Bewusst importiert statt kopiert: derselbe HTTP-Client, dieselbe Berichtsform
# wie im Selbsttest — sonst laufen die beiden Werkzeuge auseinander.
from selftest import AUS, Api, Bericht, FETT, GELB, GRUEN, ROT  # noqa: E402

PRAEFIX = "ZZ-Lasttest"

# Harte Obergrenze fuer den ganzen Lauf. Ein Messwerkzeug darf nicht aus
# Versehen zum Lastgenerator werden; wird sie erreicht, bricht das Skript ab.
MAX_ANFRAGEN = 20000

# Takt, in dem die Code-Detektiv-App den Sitzungsstand abfragt (store.jsx:
# `setInterval(tick, 1800)`). Genau dieser Takt mal Kinderzahl ist die Last,
# die eine Klasse aus einer einzigen Adresse erzeugt.
POLL_TAKT = 1.8


class Zaehler:
    """Anfragen mitschreiben — Dauer und Status, ueber Threads hinweg."""

    def __init__(self):
        self.schloss = threading.Lock()
        self.dauern = []      # Sekunden
        self.status = {}      # HTTP-Status -> Anzahl
        self.fehler = []

    def merke(self, status, dauer):
        with self.schloss:
            self.dauern.append(dauer)
            self.status[status] = self.status.get(status, 0) + 1
            if len(self.dauern) > MAX_ANFRAGEN:
                raise RuntimeError(f"Obergrenze von {MAX_ANFRAGEN} Anfragen erreicht")

    def merke_fehler(self, text):
        with self.schloss:
            self.fehler.append(str(text)[:200])

    @property
    def gesamt(self):
        return len(self.dauern)

    @property
    def abgewiesen(self):
        return self.status.get(429, 0)

    def zusammenfassung(self):
        if not self.dauern:
            return "keine Anfrage"
        sortiert = sorted(self.dauern)
        p95 = sortiert[min(len(sortiert) - 1, int(len(sortiert) * 0.95))]
        codes = ", ".join(f"{k}×{v}" for k, v in sorted(self.status.items()))
        return (f"{self.gesamt} Anfragen ({codes}), "
                f"429: {self.abgewiesen} ({100 * self.abgewiesen / self.gesamt:.1f} %), "
                f"langsamste {sortiert[-1] * 1000:.0f} ms, "
                f"Mittel {statistics.mean(sortiert) * 1000:.0f} ms, "
                f"p95 {p95 * 1000:.0f} ms")


def _ruf(api, z, methode, pfad, body=None):
    """Ein Aufruf, gezaehlt. 429 gilt hier als Messwert, nicht als Fehler —
    darum steht es in `erwartet` (das schaltet zugleich die Wiederholung des
    Selbsttest-Clients ab, die die Messung sonst verfaelschen wuerde)."""
    start = time.monotonic()
    try:
        status, text = api.call(methode, pfad, body, roh=True,
                                erwartet=(200, 201, 204, 400, 403, 404, 429))
    except Exception as e:
        z.merke_fehler(f"{methode} {pfad}: {e}")
        z.merke(0, time.monotonic() - start)
        return 0, ""
    z.merke(status, time.monotonic() - start)
    return status, text


# ─────────────────────── Aufbau (als Lehrkraft) ───────────────────────

class Buehne:
    """Klasse, Kinder, Kartenstapel und eine Code-Detektiv-Sitzung — alles mit
    Praefix `ZZ-Lasttest` und alles wieder abgeraeumt."""

    def __init__(self, api, kinder):
        self.api, self.kinder = api, kinder
        self.class_id = self.kurs_id = self.deck_id = self.code = None
        self.tokens = []
        self.karten = []
        self.vorher_aktiv = set()

    def module_an(self):
        module = self.api.call("GET", "/api/modules", erwartet=(200,)) or []
        self.vorher_aktiv = {m["key"] for m in module if m.get("active")}
        for key in ("karten", "code-detektiv"):
            if key not in self.vorher_aktiv:
                self.api.call("POST", f"/api/modules/{key}/activate", erwartet=(200,))

    def module_zurueck(self):
        for key in ("karten", "code-detektiv"):
            if key not in self.vorher_aktiv:
                self.api.call("DELETE", f"/api/modules/{key}/activate", erwartet=(200, 404))

    def aufbauen(self):
        kl = self.api.call("POST", "/api/classes", {
            "name": f"{PRAEFIX} Klasse",
            "students": [{"card_id": i + 1, "name": f"{PRAEFIX} Kind {i:02d}"}
                         for i in range(self.kinder)],
        }, erwartet=(201,))
        self.class_id, self.kurs_id = kl["id"], kl.get("kurs_id")

        stapel = self.api.call("POST", f"/api/karten/classes/{self.class_id}/decks",
                               {"name": f"{PRAEFIX} Stapel"}, erwartet=(201,))
        self.deck_id = stapel["id"]
        for i in range(5):
            k = self.api.call("POST", f"/api/karten/decks/{self.deck_id}/cards",
                              {"front": f"{i}+{i}", "back": str(2 * i)}, erwartet=(201,))
            self.karten.append(k["id"])
        # Entwuerfe sind fuer Lernende unsichtbar — erst freigeben.
        self.api.call("POST", f"/api/karten/decks/{self.deck_id}/release", {"now": True},
                      erwartet=(200,))
        zugaenge = self.api.call("POST", f"/api/karten/classes/{self.class_id}/tokens",
                                 erwartet=(200, 201)) or []
        self.tokens = [z["token"] for z in zugaenge][:self.kinder]

        sitzung = self.api.call("POST", "/api/codedetektiv/sessions",
                                {"puzzles": [{"id": f"zz{i}", "title": f"{PRAEFIX} Raetsel {i}"}
                                             for i in range(3)]}, erwartet=(201,))
        self.code = sitzung["code"]
        return (f"Klasse {self.class_id} mit {len(self.tokens)} Zugaengen, "
                f"Stapel {self.deck_id} ({len(self.karten)} Karten), Sitzung {self.code}")

    def abbauen(self, bericht):
        def weg(prefix, oid):
            self.api.call("DELETE", f"{prefix}/{oid}", erwartet=(204, 404))
            self.api.call("DELETE", f"{prefix}/{oid}/purge", erwartet=(204, 404))

        for beschreibung, fn in [
            (f"Sitzung {self.code}", lambda: self.api.call(
                "DELETE", f"/api/codedetektiv/sessions/{self.code}", erwartet=(204, 404))),
            (f"Stapel {self.deck_id}", lambda: weg("/api/karten/decks", self.deck_id)),
            (f"Klasse {self.class_id}", lambda: weg("/api/classes", self.class_id)),
            (f"Kurs {self.kurs_id}", lambda: weg("/api/kurse", self.kurs_id)),
        ]:
            try:
                fn()
            except Exception as e:
                bericht.reste.append(f"{beschreibung}: {e}")
        try:
            for eintrag in self.api.call("GET", "/api/trash", erwartet=(200,)) or []:
                if PRAEFIX in str(eintrag.get("label", "")):
                    self.api.call("DELETE", f"/api/trash/{eintrag['kind']}/{eintrag['id']}",
                                  erwartet=(204, 404))
        except Exception as e:
            bericht.reste.append(f"Papierkorb: {e}")


# ─────────────────────── Proben ───────────────────────

def probe_karten(basis, buehne, runden, debug=False):
    """n Kinder lernen gleichzeitig: Sitzung holen, dann `runden` Antworten.

    Jedes Kind bekommt einen eigenen Client OHNE Anmeldung — genau wie das
    echte Geraet. Die Drosselung `karten_review` zaehlt je Token; ob das
    stimmt, sieht man hier daran, dass die Zahl der 429 bei 0 bleibt.
    """
    z = Zaehler()

    def kind(token):
        api = Api(basis, debug=debug)
        _ruf(api, z, "GET", f"/api/karten/lernen/{token}")
        for i in range(runden):
            _ruf(api, z, "POST", f"/api/karten/lernen/{token}/review",
                 {"card_id": buehne.karten[i % len(buehne.karten)], "grade": 2})
        _ruf(api, z, "GET", f"/api/karten/lernen/{token}/results")

    start = time.monotonic()
    with ThreadPoolExecutor(max_workers=len(buehne.tokens)) as pool:
        list(pool.map(kind, buehne.tokens))
    return z, time.monotonic() - start


def probe_codedetektiv(basis, buehne, sekunden, debug=False):
    """n Kinder treten gleichzeitig bei, pollen im App-Takt und melden Ergebnisse.

    Das ist die Probe, die frueher am haerteste zuschlug: 30 Kinder × alle 1,8 s
    ≈ 1000 Abfragen je Minute — aus EINER Adresse.
    """
    z = Zaehler()
    namen = [f"{PRAEFIX} Kind {i:02d}" for i in range(buehne.kinder)]
    ende = time.monotonic() + sekunden

    def kind(nr):
        name = namen[nr]
        api = Api(basis, debug=debug)
        _ruf(api, z, "POST", f"/api/codedetektiv/sessions/{buehne.code}/join", {"name": name})
        runde = 0
        while time.monotonic() < ende:
            _ruf(api, z, "GET", f"/api/codedetektiv/sessions/{buehne.code}")
            if runde < 3:
                _ruf(api, z, "POST", f"/api/codedetektiv/sessions/{buehne.code}/result",
                     {"playerName": name, "puzzleId": f"zz{runde}",
                      "solved": True, "attempts": 1, "time": 4.0})
                runde += 1
            time.sleep(POLL_TAKT)

    start = time.monotonic()
    with ThreadPoolExecutor(max_workers=buehne.kinder) as pool:
        list(pool.map(kind, range(buehne.kinder)))
    return z, time.monotonic() - start


def vollzaehlig(api, buehne):
    """Sind alle Kinder und alle Ergebnisse angekommen? Der eigentliche Befund:
    eine verlorene Aktualisierung faellt nicht durch 429 auf, sondern dadurch,
    dass am Ende Kinder fehlen.

    Auch dieser Aufruf darf in die Drosselung laufen — dann ist das der Befund
    und kein Absturz des Messwerkzeugs."""
    status, text = api.call("GET", f"/api/codedetektiv/sessions/{buehne.code}", roh=True,
                            erwartet=(200, 429))
    if status != 200:
        raise AssertionError(f"Stand nicht abrufbar: HTTP {status} — die Drosselung "
                             f"weist selbst die Lehrkraft ab")
    import json as _json
    s = _json.loads(text)
    return len(s.get("players") or []), len(s.get("results") or [])


# ─────────────────────── Hauptprogramm ───────────────────────

def main():
    p = argparse.ArgumentParser(
        description="Lasttest der Schueler-Wege (Karten-Token, Code-Detektiv-Code)")
    p.add_argument("--url", default=os.environ.get("SELFTEST_URL") or os.environ.get("SITE_URL"))
    p.add_argument("--email", default=os.environ.get("SELFTEST_EMAIL"))
    p.add_argument("--passwort", default=os.environ.get("SELFTEST_PASSWORD"))
    p.add_argument("--kinder", type=int, default=30, help="Geraete gleichzeitig (Vorgabe: 30)")
    p.add_argument("--runden", type=int, default=20,
                   help="Karten-Antworten je Kind (Vorgabe: 20)")
    p.add_argument("--sekunden", type=int, default=20,
                   help="wie lange die Code-Detektiv-Sitzung laeuft (Vorgabe: 20)")
    p.add_argument("--nur", choices=("karten", "codedetektiv"),
                   help="nur eine der beiden Proben")
    p.add_argument("--debug", action="store_true", help="jede Anfrage mitschreiben")
    args = p.parse_args()

    if not args.url:
        print("Fehler: keine URL. --url oder SELFTEST_URL/SITE_URL setzen.", file=sys.stderr)
        return 2
    if not (args.email and args.passwort):
        print("Fehler: --email/--passwort (oder SELFTEST_EMAIL/SELFTEST_PASSWORD) fehlen.",
              file=sys.stderr)
        return 2
    if not 1 <= args.kinder <= 200:
        print("Fehler: --kinder muss zwischen 1 und 200 liegen.", file=sys.stderr)
        return 2

    geschaetzt = args.kinder * (args.runden + 2 + args.sekunden / POLL_TAKT + 3)
    if geschaetzt > MAX_ANFRAGEN:
        print(f"Fehler: das waeren rund {geschaetzt:.0f} Anfragen, erlaubt sind "
              f"{MAX_ANFRAGEN}. --kinder/--runden/--sekunden verkleinern.", file=sys.stderr)
        return 2

    api = Api(args.url, debug=args.debug)
    b = Bericht()
    print(f"Nuvora-Lasttest gegen {args.url} — {args.kinder} Kinder gleichzeitig")
    print(f"(rund {geschaetzt:.0f} Anfragen; Obergrenze {MAX_ANFRAGEN})")

    d = api.call("POST", "/api/auth/login", {"email": args.email, "password": args.passwort},
                 erwartet=(200,))
    api.token = d["token"]

    buehne = Buehne(api, args.kinder)
    buehne.module_an()
    try:
        b.pruefe("Aufbau", "Klasse, Stapel, Sitzung", buehne.aufbauen)

        if args.nur != "codedetektiv":
            z, dauer = probe_karten(args.url, buehne, args.runden, args.debug)
            b.add("Karten (/lernen/<token>)", f"{args.kinder} Kinder lernen gleichzeitig",
                  z.abgewiesen == 0 and not z.fehler,
                  f"{z.zusammenfassung()}, Gesamtdauer {dauer:.1f} s"
                  + (f" | Fehler: {z.fehler[:2]}" if z.fehler else ""))

        if args.nur != "karten":
            z, dauer = probe_codedetektiv(args.url, buehne, args.sekunden, args.debug)
            b.add("Code-Detektiv (/cd/<code>)", f"{args.kinder} Kinder spielen gleichzeitig",
                  z.abgewiesen == 0 and not z.fehler,
                  f"{z.zusammenfassung()}, Gesamtdauer {dauer:.1f} s"
                  + (f" | Fehler: {z.fehler[:2]}" if z.fehler else ""))

            try:
                spieler, ergebnisse = vollzaehlig(api, buehne)
                b.add("Code-Detektiv (/cd/<code>)", "alle Kinder in der Sitzung",
                      spieler == args.kinder, f"{spieler} von {args.kinder} Spielern")
                b.add("Code-Detektiv (/cd/<code>)", "kein Ergebnis verloren",
                      ergebnisse == args.kinder * 3,
                      f"{ergebnisse} von {args.kinder * 3} Ergebnissen")
            except Exception as e:
                b.add("Code-Detektiv (/cd/<code>)", "Stand nach dem Lauf", False, str(e))
    finally:
        buehne.abbauen(b)
        buehne.module_zurueck()

    b.drucke()
    print()
    print(f"{FETT}Hinweis zur Kante:{AUS} nginx drosselt zusaetzlich pro IP "
          f"(siehe nginx.conf). Laeuft dieser Test ohne Proxy (lokale "
          f"Pruefinstanz), ist die Proxy-Drossel NICHT gemessen — sie muss aus "
          f"der Konfiguration nachgerechnet werden.")
    return 1 if b.fehler else 0


if __name__ == "__main__":
    sys.exit(main())
