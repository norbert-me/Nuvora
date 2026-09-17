#!/usr/bin/env python3
"""Nuvora — Wegwerf-Konto fuer genau einen Testlauf anlegen oder loeschen.

    scripts/wegwerfkonto.py anlegen            gibt E-Mail und Passwort aus
                                               (zwei Zeilen auf stdout)
    scripts/wegwerfkonto.py loeschen EMAIL     tilgt das Konto samt Inhalt

Benutzt von selftest.sh: vor dem ersten Teillauf wird ein Konto angelegt, und
ein trap loescht es am Ende — auch nach Strg-C. Der Server laesst beides nur
mit SELFTEST_TOKEN zu und loescht ausschliesslich Adressen der Form
`selftest-<16 hex>@selftest.invalid`.

Rueckgabewert:
    0  erledigt
    3  der Server bietet den Weg nicht an (alter Stand: 404/405) oder nimmt das
       Token nicht an (403) — selftest.sh faellt dann auf das feste Konto aus
       .deploy.env zurueck
    1  sonstiger Fehler (Meldung auf stderr)
    2  Aufruf falsch
"""
import argparse
import json
import os
import re
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gemeinsam import Api, ApiFehler, ist_wegwerf  # noqa: E402

KEIN_WEG = 3

TOUR_DATEI = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                          "apps", "web", "src", "components", "GuidedTour.jsx")


def tour_ids(pfad=TOUR_DATEI):
    """Alle Tour-IDs aus GuidedTour.jsx: "kern" plus die Schluessel von
    MODULE_TOURS. Jede Tour, die sich beim ersten Besuch ueber eine Seite legt,
    steht dort (tourFor) — ein frisches Konto soll keine davon sehen, sonst
    klicken die Browser-Laeufe gegen Overlays. Fehlt die Datei (Lauf ausserhalb
    des Repos), nimmt der Server seine Grundausstattung."""
    try:
        with open(pfad, encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return []
    m = re.search(r"export const MODULE_TOURS = \{(.*?)\n\};", text, re.S)
    if not m:
        return []
    ids = re.findall(r"^  (?:\"([\w-]+)\"|([\w-]+)): \[", m.group(1), re.M)
    return ["kern"] + [a or b for a, b in ids]


def main():
    p = argparse.ArgumentParser(description="Wegwerf-Konto des Selbsttests anlegen/loeschen")
    p.add_argument("aktion", choices=("anlegen", "loeschen"))
    p.add_argument("email", nargs="?", default="")
    p.add_argument("--url", default=os.environ.get("SELFTEST_URL") or os.environ.get("SITE_URL"))
    p.add_argument("--token", default=os.environ.get("SELFTEST_TOKEN"))
    args = p.parse_args()
    if not args.url:
        print("Fehler: keine URL (--url oder SELFTEST_URL).", file=sys.stderr)
        return 2
    if not args.token:
        print("kein SELFTEST_TOKEN — Wegwerf-Konto nicht moeglich", file=sys.stderr)
        return KEIN_WEG

    api = Api(args.url, selftest_token=args.token)
    try:
        if args.aktion == "anlegen":
            status, text = api.call("POST", "/api/selftest/konto",
                                    {"touren": tour_ids()}, roh=True)
            if status in (403, 404, 405):
                print(f"Server bietet kein Wegwerf-Konto an (HTTP {status})", file=sys.stderr)
                return KEIN_WEG
            if status != 201:
                print(f"Anlegen fehlgeschlagen: HTTP {status}: {text[:150]}", file=sys.stderr)
                return 1
            d = json.loads(text)
            if not ist_wegwerf(d.get("email")):
                print(f"Server lieferte keine Wegwerf-Adresse: {d.get('email')!r}", file=sys.stderr)
                return 1
            print(d["email"])
            print(d["passwort"])
            if d.get("verwaiste_geloescht"):
                print(f"{d['verwaiste_geloescht']} verwaiste(s) Wegwerf-Konto(en) abgeraeumt",
                      file=sys.stderr)
            return 0

        # loeschen — die Pruefung steht zusaetzlich hier, nicht nur im Server:
        # ein vertippter Aufruf soll gar nicht erst hinausgehen.
        if not ist_wegwerf(args.email):
            print(f"'{args.email}' ist kein Wegwerf-Konto — wird nicht angefasst", file=sys.stderr)
            return 2
        pfad = "/api/selftest/konto/" + urllib.parse.quote(args.email.strip().lower(), safe="@")
        status, text = api.call("DELETE", pfad, roh=True)
        if status in (200, 404):
            return 0
        if status in (403, 405):
            print(f"Loeschen nicht moeglich (HTTP {status})", file=sys.stderr)
            return KEIN_WEG
        print(f"Loeschen fehlgeschlagen: HTTP {status}: {text[:150]}", file=sys.stderr)
        return 1
    except ApiFehler as e:
        print(f"Server nicht erreichbar: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
