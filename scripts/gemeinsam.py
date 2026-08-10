#!/usr/bin/env python3
"""Gemeinsames Werkzeug der Testskripte: HTTP-Client, Bericht, Farben.

Warum eine eigene Datei? `selftest.py` und `aufraeumen.py` brauchen beide
denselben Bericht und denselben Client. Frueher wohnte beides in `selftest.py`,
`aufraeumen.py` holte es von dort — und `selftest.py` holte umgekehrt
`Sammler`/`modulzustand` aus `aufraeumen.py`. Das war ein Ring, den nur ein
Import mitten in der Funktion offenhielt: er lief, aber jede Codepruefung
meldete ihn wieder (CodeQL py/cyclic-import), und die Begruendung dafuer musste
an vier Stellen stehen.

Hier importiert nichts zurueck. Die Richtung ist jetzt gerade:

    gemeinsam.py  <-  aufraeumen.py  <-  selftest.py  <-  systemtest.py

Zwei Fassungen desselben Berichts laufen damit weiterhin nicht auseinander —
es gibt nach wie vor nur eine.

Nur Standardbibliothek, damit die Tests ohne Installation ueberall laufen.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

TIMEOUT = 30

# nginx drosselt /api/ (limit_req, siehe nginx.conf) und antwortet dann mit 429.
# Das ist kein Anwendungsfehler, sondern der Proxy vor der Anwendung. Wir warten
# gestaffelt und versuchen es erneut — hoechstens so oft:
RATELIMIT_VERSUCHE = 4
RATELIMIT_WARTEN = (1, 2, 4, 8)   # Sekunden zwischen den Versuchen
RATELIMIT_MAX_WARTEN = 30         # obere Schranke fuer ein Retry-After vom Server

# Farbe nur, wenn wirklich ein Terminal zuschaut — in eine Datei oder durch eine
# Pipe gehen sonst Steuerzeichen mit. NO_COLOR ist die uebliche Notbremse.
_FARBE = sys.stdout.isatty() and not os.environ.get("NO_COLOR")
ROT = "\033[31m" if _FARBE else ""
GELB = "\033[33m" if _FARBE else ""
GRUEN = "\033[32m" if _FARBE else ""
FETT = "\033[1m" if _FARBE else ""
AUS = "\033[0m" if _FARBE else ""

# Ab dieser Laenge wiederholt die Zusammenfassung die Fehler mitsamt Grund:
# in einem kurzen Bericht stuende alles doppelt untereinander, in einem langen
# scrollt der Befund sonst aus dem Bild.
LANG_AB = 25


# ─────────────────────────── HTTP ───────────────────────────

class ApiFehler(Exception):
    def __init__(self, methode, pfad, status, text):
        super().__init__(f"{methode} {pfad} -> {status}: {text[:200]}")
        self.status = status


def _ratelimit_text(text: str) -> str:
    """Erklaeren, WER gedrosselt hat — die Antwort weiss es.

    Zwei ganz verschiedene Dinge antworten mit 429, und die Ratschlaege sind
    gegensaetzlich:
      * nginx (limit_req fuer /api/, siehe nginx.conf) — der Test feuert zu
        schnell, Aufrufe sparen oder das Limit anheben.
      * Nuvora selbst (rate_limit in auth.py, z.B. "Zu viele Anmeldeversuche")
        — hier ist Warten die einzige richtige Antwort; wer weiter probiert,
        verlaengert die Sperre nur.
    Die Anwendung antwortet mit JSON und einem deutschen Satz, nginx mit einer
    HTML-Seite. Daran laesst sich beides sicher unterscheiden.
    """
    grund = ""
    try:
        grund = (json.loads(text) or {}).get("detail", "")
    except Exception:
        # Bewusst still: nginx antwortet auf 429 mit einer HTML-Seite, die sich
        # nicht als JSON lesen laesst. Genau daran wird unten unterschieden,
        # wer gedrosselt hat — ein leerer `grund` IST hier die Auskunft.
        pass
    if grund:
        return (f"Ratelimit von Nuvora selbst: „{grund}“ — auch nach "
                f"{RATELIMIT_VERSUCHE} Versuchen. Das ist eine Schutzsperre der "
                "Anwendung (rate_limit), kein Fehler. Kurz warten, nicht weiter "
                "probieren — jeder Versuch verlaengert die Sperre.")
    return (f"Ratelimit: nach {RATELIMIT_VERSUCHE} Versuchen immer noch 429. "
            "Das ist die Drosselung des nginx-Proxys (limit_req fuer /api/ in "
            "nginx.conf), nicht ein Fehler der Anwendung. Der Test feuert zu "
            "schnell — Aufrufe sparen oder das Limit anheben.")


class Api:
    """Duenner HTTP-Client auf urllib — kein requests, keine Installation."""

    def __init__(self, basis, debug=False, selftest_token=""):
        self.basis = basis.rstrip("/")
        self.token = None
        # Geheimnis fuer die Einrichtungs-Pruefungen (siehe SELFTEST_TOKEN).
        self.selftest_token = selftest_token
        self.debug = debug
        self.protokoll = []   # (methode, pfad, status, ms) — fuer --debug
        self.letzte_kopfe = {}
        self.ratelimit_treffer = 0   # wie oft wegen 429 gewartet wurde

    @staticmethod
    def _wartezeit(versuch, antwortkopfe):
        """Retry-After beachten, wenn der Server ihn schickt; sonst gestaffelt."""
        roh = (antwortkopfe.get("retry-after") or "").strip()
        if roh.isdigit():
            return min(int(roh), RATELIMIT_MAX_WARTEN)
        return RATELIMIT_WARTEN[min(versuch, len(RATELIMIT_WARTEN) - 1)]

    def call(self, methode, pfad, body=None, erwartet=None, roh=False, kopfe=None):
        url = pfad if pfad.startswith("http") else self.basis + pfad
        daten = json.dumps(body).encode() if body is not None else None

        # Wiederholung ausschliesslich bei 429. Auch POST/DELETE werden wiederholt,
        # und das ist hier richtig: ein 429 kommt vom Proxy VOR der Anwendung, die
        # Anfrage wurde also gar nicht verarbeitet — es gibt nichts, was doppelt
        # passieren koennte. Fuer jeden anderen Status wird nie wiederholt.
        for versuch in range(RATELIMIT_VERSUCHE):
            start = time.monotonic()
            req = urllib.request.Request(url, data=daten, method=methode)
            if daten is not None:
                req.add_header("Content-Type", "application/json")
            if self.token:
                req.add_header("Authorization", "Bearer " + self.token)
            if self.selftest_token:
                req.add_header("X-Selftest-Token", self.selftest_token)
            for k, v in (kopfe or {}).items():
                req.add_header(k, v)
            try:
                with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                    status, inhalt, antwortkopfe = r.status, r.read(), dict(r.headers)
            except urllib.error.HTTPError as e:
                status, inhalt, antwortkopfe = e.code, e.read(), dict(e.headers or {})
            except Exception as e:  # DNS, TLS, Verbindung
                self._merke(methode, pfad, 0, start, str(e))
                raise ApiFehler(methode, pfad, 0, str(e))
            text = inhalt.decode("utf-8", "replace")
            # Kopfzeilen der letzten Antwort — die Sicherheits-Pruefungen lesen sie.
            self.letzte_kopfe = {k.lower(): v for k, v in antwortkopfe.items()}
            self._merke(methode, pfad, status, start, text)
            if status != 429 or (erwartet and 429 in erwartet):
                break
            if versuch == RATELIMIT_VERSUCHE - 1:
                break
            self.ratelimit_treffer += 1
            time.sleep(self._wartezeit(versuch, self.letzte_kopfe))

        if erwartet and status not in erwartet:
            if status == 429:
                raise ApiFehler(
                    methode, pfad, status, _ratelimit_text(text))
            raise ApiFehler(methode, pfad, status, text)
        if roh:
            return status, text
        if not text:
            return None
        try:
            return json.loads(text)
        except ValueError:
            return text

    def _merke(self, methode, pfad, status, start, text):
        """Jede Anfrage mitschreiben — mit --debug wird daraus ein Protokoll,
        das auch beim allgemeinen Suchen hilft (welcher Aufruf ist langsam,
        welcher antwortet unerwartet)."""
        ms = round((time.monotonic() - start) * 1000)
        self.protokoll.append((methode, pfad, status, ms))
        if self.debug:
            hinweis = "" if 200 <= status < 400 else f"  {text[:300]}"
            print(f"    · {methode:6} {pfad:52} {status or 'ERR':>4}  {ms:5} ms{hinweis}",
                  file=sys.stderr)


# ─────────────────────────── Bericht ───────────────────────────

class Bericht:
    def __init__(self):
        self.zeilen = []      # (gruppe, name, ok, schwere, detail)
        self.reste = []

    def add(self, gruppe, name, ok, detail="", schwere="fehler"):
        # Einzeilig und gekuerzt: manche Fehlerantwort ist eine ganze HTML-Seite,
        # und die zerlegt den Bericht.
        detail = " ".join(str(detail).split())
        if len(detail) > 300:
            detail = detail[:297] + "…"
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
                print(f"\n{FETT}── {gruppe}{AUS}")
                gruppe_vorher = gruppe
            if ok:
                zeichen, farbe = "✓", GRUEN
            elif schwere == "warnung":
                zeichen, farbe = "!", GELB
            else:
                zeichen, farbe = "✗", ROT
            # Nur die Fehlerzeilen einfaerben: waere alles bunt, faellt nichts auf.
            zeile = f"  {farbe}{zeichen}{AUS} {name}" if ok else f"{farbe}  {zeichen} {name}"
            if detail:
                zeile += f"   {detail}"
            print(zeile + (AUS if not ok else ""))
        if self.reste:
            print(f"\n{FETT}── Reste (nicht abgeraeumt — von Hand pruefen){AUS}")
            for r in self.reste:
                print(f"{GELB}  ! {r}{AUS}")

        print("\n" + "=" * 40)
        if not self.fehler:
            print(f"  {GRUEN}Selbsttest gruen{AUS} — {len(self.zeilen)} Checks, "
                  f"{len(self.warnungen)} Warnung(en).")
        else:
            print(f"  {ROT}{FETT}Selbsttest ROT{AUS} — {len(self.fehler)} Fehler, "
                  f"{len(self.warnungen)} Warnung(en).")
            # Kurzer Bericht: Namen reichen, der Grund steht zwei Zeilen weiter
            # oben. Langer Bericht: der Befund ist laengst aus dem Bild
            # gescrollt, also hier noch einmal vollstaendig.
            if len(self.zeilen) > LANG_AB:
                for gruppe, name, _ok, _s, detail in self.fehler:
                    print(f"{ROT}  ✗ {gruppe} / {name}{AUS}")
                    if detail:
                        print(f"      {detail}")
                for gruppe, name, _ok, _s, detail in self.warnungen:
                    print(f"{GELB}  ! {gruppe} / {name}{AUS}   {detail}")
            else:
                namen = ", ".join(f"{g} / {n}" for g, n, _o, _s, _d in self.fehler[:6])
                if len(self.fehler) > 6:
                    namen += f" und {len(self.fehler) - 6} weitere"
                print(f"  Betroffen: {namen}")
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
