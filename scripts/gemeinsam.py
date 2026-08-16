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

    def rohbytes(self, pfad, erwartet=None):
        """Antwort als Bytes holen — fuer ZIP und PDF.

        `call(..., roh=True)` dekodiert als UTF-8 mit "replace" und macht aus
        einem ZIP damit Buchstabensalat. Wer in einer Sicherung oder einem
        Export wirklich nachsehen will, was drinsteht, braucht die Bytes.
        Rueckgabe: (status, bytes).
        """
        url = pfad if pfad.startswith("http") else self.basis + pfad
        req = urllib.request.Request(url, method="GET")
        if self.token:
            req.add_header("Authorization", "Bearer " + self.token)
        if self.selftest_token:
            req.add_header("X-Selftest-Token", self.selftest_token)
        start = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                status, inhalt = r.status, r.read()
        except urllib.error.HTTPError as e:
            status, inhalt = e.code, e.read()
        except Exception as e:
            self._merke("GET", pfad, 0, start, str(e))
            raise ApiFehler("GET", pfad, 0, str(e))
        self._merke("GET", pfad, status, start, f"{len(inhalt)} Bytes")
        if erwartet and status not in erwartet:
            raise ApiFehler("GET", pfad, status,
                            inhalt[:200].decode("utf-8", "replace"))
        return status, inhalt

    def upload(self, pfad, feldname, dateiname, inhalt, mime="application/octet-stream",
               felder=None, erwartet=None):
        """Datei hochladen (multipart/form-data) — fuer die Material-Ablage.

        Bewusst von Hand zusammengesetzt statt mit einer Bibliothek: die
        Testskripte kommen ohne Abhaengigkeiten aus, damit sie auf jedem Rechner
        und im Deploy laufen, ohne dass vorher etwas installiert werden muss.
        """
        grenze = "----nuvora-selbsttest-grenze"
        teile = []
        for k, v in (felder or {}).items():
            teile.append(
                f'--{grenze}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
            )
        teile.append(
            f'--{grenze}\r\nContent-Disposition: form-data; name="{feldname}"; '
            f'filename="{dateiname}"\r\nContent-Type: {mime}\r\n\r\n'.encode()
            + inhalt + b"\r\n"
        )
        teile.append(f"--{grenze}--\r\n".encode())
        koerper = b"".join(teile)

        url = self.basis + pfad
        req = urllib.request.Request(url, data=koerper, method="POST")
        req.add_header("Content-Type", f"multipart/form-data; boundary={grenze}")
        if self.token:
            req.add_header("Authorization", "Bearer " + self.token)
        if self.selftest_token:
            req.add_header("X-Selftest-Token", self.selftest_token)
        start = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                status, inhalt_a = r.status, r.read()
        except urllib.error.HTTPError as e:
            status, inhalt_a = e.code, e.read()
        except Exception as e:
            self._merke("POST", pfad, 0, start, str(e))
            raise ApiFehler("POST", pfad, 0, str(e))
        text = inhalt_a.decode("utf-8", "replace")
        self._merke("POST", pfad, status, start, text)
        if erwartet and status not in erwartet:
            raise ApiFehler("POST", pfad, status, text)
        try:
            return json.loads(text)
        except ValueError:
            return text

    def upload_roh(self, pfad, inhalt: bytes, mime: str, erwartet=None):
        """Rohdaten im Rumpf (kein multipart) — so schickt der Scanner sein Bild."""
        url = self.basis + pfad
        req = urllib.request.Request(url, data=inhalt, method="POST")
        req.add_header("Content-Type", mime)
        if self.token:
            req.add_header("Authorization", "Bearer " + self.token)
        if self.selftest_token:
            req.add_header("X-Selftest-Token", self.selftest_token)
        start = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                status, roh = r.status, r.read()
        except urllib.error.HTTPError as e:
            status, roh = e.code, e.read()
        except Exception as e:
            self._merke("POST", pfad, 0, start, str(e))
            raise ApiFehler("POST", pfad, 0, str(e))
        text = roh.decode("utf-8", "replace")
        self._merke("POST", pfad, status, start, text)
        if erwartet and status not in erwartet:
            raise ApiFehler("POST", pfad, status, text)
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
    """Ein Bericht — Gruppen, Farben, Zusammenfassung, JSON.

    Die Schlusszeile traegt das Wort aus `TITEL_GRUEN`/`TITEL_ROT`. Wer einen
    eigenen Namen braucht (Systemtest, Aufraeumen), setzt die beiden Attribute
    in einer Unterklasse — frueher lief das ueber ein Umlenken von stdout und
    ein Ersetzen im fertigen Text, in zwei Dateien nebeneinander.
    """

    TITEL_GRUEN = "Selbsttest gruen"
    TITEL_ROT = "Selbsttest ROT"

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
            print(f"  {GRUEN}{self.TITEL_GRUEN}{AUS} — {len(self.zeilen)} Checks, "
                  f"{len(self.warnungen)} Warnung(en).")
        else:
            print(f"  {ROT}{FETT}{self.TITEL_ROT}{AUS} — {len(self.fehler)} Fehler, "
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


# ─────────────────────────── Testumgebung im Kern ───────────────────────────

class Kernumgebung:
    """Klasse, Kurs und Thema im Kern — der Boden, auf dem jedes Modul arbeitet.

    Warum hier: `selftest.py` und `systemtest.py` bauen sich denselben Boden,
    nur mit anderen Kindern (zwei ohne Niveau, drei mit E/G/G). Der Unterbau war
    zweimal ausgeschrieben — Anlegen, Merken, rueckwaerts Abraeumen, Papierkorb
    leeren —, und beim Aendern musste man an beide Stellen denken. Was sich
    wirklich unterscheidet, ist allein die Schuelerliste; die gibt der Aufrufer.

    Regel 1 aus CLAUDE.md steht dahinter: kein Modul besitzt Klassen oder
    Schueler. Deshalb entstehen sie hier, im Kern, und nicht in einer Modulprobe.
    """

    def __init__(self, api, b, praefix):
        self.api, self.b, self.praefix = api, b, praefix
        self.class_id = self.kurs_id = self.topic_id = None
        self.students = []      # DB-IDs
        self.aufraeumen = []    # (Beschreibung, fn) — abgeraeumt wird rueckwaerts

    def spaeter(self, was, fn):
        self.aufraeumen.append((was, fn))

    def _weg(self, prefix, oid):
        """Weich loeschen, dann endgueltig — `purge` verweigert alles, was nicht
        im Papierkorb liegt."""
        if oid is None:
            return
        self.api.call("DELETE", f"{prefix}/{oid}", erwartet=(204, 404))
        self.api.call("DELETE", f"{prefix}/{oid}/purge", erwartet=(204, 404))

    def _grundlage(self, schueler):
        """Klasse (mit ihrem eigenen Kurs) und Thema anlegen.

        Eine neue Klasse bringt ihren Kurs von selbst mit (classes.py, 1:1) —
        einen zweiten daneben legt hier bewusst niemand an.

        Reihenfolge des Abraeumens: rueckwaerts, also Thema zuerst, dann die
        Klasse, zuletzt ihr Kurs — sonst haengt die Klasse an einem geloeschten
        Kurs.
        """
        kl = self.api.call("POST", "/api/classes", {
            "name": f"{self.praefix} Klasse", "students": schueler,
        }, erwartet=(201,))
        self.class_id = kl["id"]
        self.kurs_id = kl.get("kurs_id")
        self.students = [s["id"] for s in kl.get("students", [])]

        thema = self.api.call("POST", "/api/topics", {"name": f"{self.praefix} Thema"},
                              erwartet=(201,))
        self.topic_id = thema["id"]

        self.spaeter(f"Kurs {self.kurs_id}", lambda: self._weg("/api/kurse", self.kurs_id))
        self.spaeter(f"Klasse {self.class_id}", lambda: self._weg("/api/classes", self.class_id))
        self.spaeter(f"Thema {self.topic_id}", lambda: self.api.call(
            "DELETE", f"/api/topics/{self.topic_id}", erwartet=(204, 404)))
        return kl

    def abbauen(self):
        for was, fn in reversed(self.aufraeumen):
            try:
                fn()
            except Exception as e:
                self.b.reste.append(f"{was}: {e}")
        # Der Papierkorb ist im Kern — weich Geloeschtes der Module landet dort
        # und wuerde sonst als Testmuell stehen bleiben.
        try:
            for eintrag in self.api.call("GET", "/api/trash", erwartet=(200,)) or []:
                if self.praefix in str(eintrag.get("label", "")):
                    self.api.call("DELETE", f"/api/trash/{eintrag['kind']}/{eintrag['id']}",
                                  erwartet=(204, 404))
        except Exception as e:
            self.b.reste.append(f"Papierkorb: {e}")


# ─────────────────────────── Aufruf und Anmeldung ───────────────────────────

def standard_argumente(p):
    """Die Angaben, die jedes Testskript gleich entgegennimmt.

    Sechs Zeilen, die in `selftest.py` und `systemtest.py` wortgleich standen —
    inklusive der Umgebungsvariablen, aus denen `deploy.sh` sie fuellt. Wer eine
    siebte braucht, haengt sie am eigenen Parser an.
    """
    p.add_argument("--url", default=os.environ.get("SELFTEST_URL") or os.environ.get("SITE_URL"))
    p.add_argument("--email", default=os.environ.get("SELFTEST_EMAIL"))
    p.add_argument("--passwort", default=os.environ.get("SELFTEST_PASSWORD"))
    p.add_argument("--token", default=os.environ.get("SELFTEST_TOKEN"),
                   help="Geheimnis fuer die Einrichtungs-Pruefungen (sonst nur mit "
                        "Administrationskonto)")
    p.add_argument("--json", action="store_true", help="Ergebnis als JSON ausgeben")
    p.add_argument("--debug", action="store_true",
                   help="jede Anfrage mitschreiben (Status, Dauer, Fehlertext) — "
                        "zum Suchen, wenn etwas rot ist")
    return p


def melde_an(api, email, passwort, url):
    """Anmelden und den Token setzen — mit einer Auskunft, die weiterhilft.

    Das Testkonto legt kein Skript an: Registrieren verlangt eine
    E-Mail-Bestaetigung, die kein Skript ersetzen kann. Fehlt es, sagt der
    Fehler genau das statt nur "401".

    Nach dem Login wird `/api/auth/me` gelesen: erst das beweist, dass der Token
    auch traegt, und nicht nur, dass der Server ihn ausgestellt hat.
    """
    status, text = api.call("POST", "/api/auth/login",
                            {"email": email, "password": passwort}, roh=True)
    if status == 401:
        raise AssertionError(
            f"Konto '{email}' gibt es nicht (oder das Passwort stimmt nicht). "
            f"Einmalig anlegen: unter {url}/login registrieren, "
            "E-Mail bestaetigen, dann dieselben Zugangsdaten als "
            "SELFTEST_EMAIL/SELFTEST_PASSWORD in .deploy.env eintragen.")
    if status == 403:
        raise AssertionError(
            f"Konto '{email}' existiert, aber die E-Mail ist noch nicht "
            "bestaetigt. Bestaetigungslink aus der Mail oeffnen (ohne SMTP "
            "kommt keine Mail an — dann SMTP_* in der .env auf dem Server setzen).")
    if status != 200:
        raise AssertionError(f"HTTP {status}: {text[:150]}")
    d = json.loads(text)
    api.token = d["token"]
    api.call("GET", "/api/auth/me", erwartet=(200,))
    return f"angemeldet als {d['user'].get('email')}"
