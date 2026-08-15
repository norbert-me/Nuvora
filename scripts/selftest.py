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
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

PRAEFIX = "ZZ-Selbsttest"

# Bericht, HTTP-Client und Farben stehen in gemeinsam.py — aufraeumen.py
# braucht sie genauso, und eine zweite Fassung des Berichts liefe
# auseinander. Von dort importiert nichts zurueck (siehe Modulkopf).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gemeinsam import Api, Bericht  # noqa: E402
# Das Abraeumen sitzt in aufraeumen.py — dort steht das Netz (Klasse `Fund`),
# das ausschliesslich Testpraefixe loescht. Der Import steht seit der
# Aufteilung wieder oben: aufraeumen.py holt sein Werkzeug aus gemeinsam.py
# und nicht mehr von hier, ein Ring entsteht dabei nicht.
from aufraeumen import (  # noqa: E402
    Sammler, merke_module, modulzustand, setze_module, vergiss_module,
)


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


# ───────────────── 1b. Erreichbarkeit, Sicherheit, Web-Dateien ─────────────────

def _host_port(url):
    teile = urllib.parse.urlsplit(url)
    https = teile.scheme == "https"
    return teile.hostname or "", teile.port or (443 if https else 80), https


def _tls_kontext():
    """TLS-Kontext fuer die eigenen Verbindungen des Selbsttests.

    Das ist der NORMALE Verbindungsweg, kein absichtlicher Versuch mit alten
    Protokollen: Zertifikat und Hostname werden geprueft (Vorgabe von
    `create_default_context`), und die Untergrenze steht ausdruecklich auf
    TLS 1.2. Ohne diese Zeile haengt es von Python- und OpenSSL-Fassung ab, ob
    TLS 1.0/1.1 noch mitgehen — ein Werkzeug, das die TLS-Lage der Installation
    beurteilt, darf sich selbst nicht auf veraltete Protokolle einlassen.
    """
    import ssl   # wie in teste_erreichbarkeit lokal: Start ohne TLS-Modul soll gehen
    ctx = ssl.create_default_context()
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    return ctx


def _ist_lokal(host):
    """Adresse aus dem eigenen Netz? Dort ist fehlendes HTTPS kein Versaeumnis."""
    import ipaddress
    if host in ("localhost", "127.0.0.1", "::1"):
        return True
    try:
        return ipaddress.ip_address(host).is_private
    except ValueError:
        return False


def teste_erreichbarkeit(api, b):
    """Kommt man ueberhaupt hin — und verschluesselt?

    Alles, was zwischen Browser und Nuvora liegt: Namensaufloesung, Antwortzeit,
    Zertifikat, Umleitung von http auf https. Faellt hier etwas aus, nuetzt die
    gesundeste Anwendung nichts.
    """
    import socket
    import ssl

    host, port, https = _host_port(api.basis)
    lokal = _ist_lokal(host)

    def namen():
        adressen = {a[4][0] for a in socket.getaddrinfo(host, port)}
        return f"{host} -> {', '.join(sorted(adressen))}"

    def antwortzeit():
        start = time.monotonic()
        api.call("GET", "/api/health", erwartet=(200,))
        ms = round((time.monotonic() - start) * 1000)
        if ms > 3000:
            raise AssertionError(f"{ms} ms bis zur Antwort — das merkt man im Unterricht")
        return f"{ms} ms"

    def websocket():
        """Live-Ergebnisse haengen an einem WebSocket — der geht durch andere
        Teile des Proxys als die normale API und faellt sonst erst im Unterricht
        auf. Geprueft wird der Handshake (HTTP 101), nichts weiter."""
        # Session-ID egal: der Endpunkt nimmt die Verbindung an und schliesst
        # sie mangels Anmeldung wieder — geprueft wird nur der Handshake.
        pfad = "/ws/session/999999999"
        anfrage = (
            f"GET {pfad} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\n"
            "Connection: Upgrade\r\nSec-WebSocket-Key: c2VsYnN0dGVzdDEyMzQ1Ng==\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        ).encode()
        roh = socket.create_connection((host, port), timeout=10)
        try:
            if https:
                roh = _tls_kontext().wrap_socket(roh, server_hostname=host)
            roh.sendall(anfrage)
            antwort = roh.recv(200).decode("utf-8", "replace")
        finally:
            roh.close()
        erste = antwort.split("\r\n")[0]
        if "101" not in erste:
            raise AssertionError(f"kein Upgrade: '{erste}' — Live-Ergebnisse kaemen nie an")
        return "Handshake steht (HTTP 101)"

    b.pruefe("Erreichbarkeit", "Namensaufloesung", namen)
    b.pruefe("Erreichbarkeit", "Antwortzeit", antwortzeit)
    b.pruefe("Erreichbarkeit", "WebSocket (Live-Ergebnisse)", websocket)

    if not https:
        b.add("Erreichbarkeit", "HTTPS", lokal, schwere="warnung" if not lokal else "fehler",
              detail="Adresse im eigenen Netz — ohne Verschluesselung vertretbar" if lokal else
                     "oeffentlich erreichbar, aber unverschluesselt: Passwoerter und Token gehen "
                     "im Klartext durchs Netz. Zertifikat einrichten (z.B. Reverse Proxy mit "
                     "Let's Encrypt).")
        return

    def zertifikat():
        ctx = _tls_kontext()
        try:
            with socket.create_connection((host, port), timeout=10) as roh:
                with ctx.wrap_socket(roh, server_hostname=host) as tls:
                    cert = tls.getpeercert()
                    version = tls.version()
        except ssl.SSLError as e:
            # Der Kontext laesst nichts unter TLS 1.2 zu. Scheitert der
            # Handshake daran, spricht der Server nur noch veraltete
            # Protokolle — genau der Befund, den frueher die Pruefung auf
            # tls.version() unten geliefert hat.
            raise AssertionError(
                f"TLS-Handshake mit mindestens TLS 1.2 scheitert ({e}) — der Server "
                "bietet offenbar nur veraltete Verschluesselung (TLS 1.0/1.1) oder "
                "kein passendes Verfahren an") from e
        # Hostname und Kette hat wrap_socket schon geprueft (sonst haette es
        # geworfen) — bleibt die Restlaufzeit.
        bis = datetime.strptime(cert["notAfter"], "%b %d %H:%M:%S %Y %Z")
        tage = (bis - datetime.utcnow()).days
        aussteller = dict(x[0] for x in cert["issuer"]).get("organizationName", "?")
        if tage < 0:
            raise AssertionError(f"Zertifikat ist seit {-tage} Tagen abgelaufen")
        if tage < 14:
            raise AssertionError(f"Zertifikat laeuft in {tage} Tagen ab (Aussteller {aussteller}) "
                                 "— Erneuerung pruefen")
        # Eine Pruefung auf "TLSv1"/"TLSv1.1" steht hier nicht mehr: mit
        # ctx.minimum_version = TLSv1_2 kaeme so eine Verbindung gar nicht erst
        # zustande — sie landet oben im SSLError-Zweig.
        return f"{version}, gueltig noch {tage} Tage, ausgestellt von {aussteller}"

    def umleitung():
        # Wer http eintippt, muss auf https landen — sonst hilft das Zertifikat
        # nur denen, die daran denken. Bewusst mit http.client statt urllib:
        # urllib folgt Weiterleitungen von selbst und wuerde immer 200 melden,
        # egal ob umgeleitet wurde oder nicht.
        import http.client
        verbindung = http.client.HTTPConnection(host, 80, timeout=10)
        try:
            verbindung.request("GET", "/", headers={"Host": host})
            antwort = verbindung.getresponse()
            status, ziel = antwort.status, antwort.getheader("Location") or ""
        finally:
            verbindung.close()
        if status in (301, 302, 307, 308) and ziel.startswith("https://"):
            return f"HTTP {status} nach {ziel[:60]}"
        raise AssertionError(f"http:// antwortet mit {status} statt einer Umleitung auf https")

    b.pruefe("Erreichbarkeit", "TLS-Zertifikat", zertifikat)
    b.pruefe("Erreichbarkeit", "Umleitung http -> https", umleitung, schwere="warnung")


# Kopfzeilen, die jede Antwort tragen muss, mit dem Grund dahinter.
SICHERHEITS_KOPFE = [
    ("x-content-type-options", "nosniff",
     "ohne ihn raten Browser den Dateityp und fuehren notfalls Hochgeladenes aus"),
    ("x-frame-options", "", "sonst laesst sich Nuvora in fremde Seiten einbetten (Clickjacking)"),
    ("referrer-policy", "", "sonst wandern vollstaendige Adressen an fremde Server"),
    ("content-security-policy", "", "die wichtigste Bremse gegen eingeschleustes Javascript"),
]

# Pfade, die es im Netz nie geben darf.
GEHEIM = ["/.env", "/.git/config", "/docker-compose.yml", "/config/site.json",
          "/apps/api/app/main.py", "/.deploy.env"]
# Woran man erkennt, dass wirklich die Datei kam (und nicht die Shell als 200).
VERRAETERISCH = ["POSTGRES_PASSWORD", "TOKEN_SECRET", "SMTP_PASSWORD", "[core]",
                 "services:", "proxy_pass"]


def teste_sicherheit(api, b):
    """Was ein Fremder von aussen sehen und anfassen kann."""
    host, _port, https = _host_port(api.basis)

    def kopfe_auf(pfad):
        def fn():
            api.call("GET", pfad, roh=True)
            kopfe = api.letzte_kopfe
            fehlt = []
            for name, erwartet, warum in SICHERHEITS_KOPFE:
                wert = kopfe.get(name, "")
                if not wert or (erwartet and erwartet not in wert.lower()):
                    fehlt.append(f"{name} ({warum})")
            if fehlt:
                raise AssertionError("fehlt: " + "; ".join(fehlt))
            return ", ".join(n for n, _e, _w in SICHERHEITS_KOPFE)
        return fn

    # Auf mehreren Pfaden, nicht nur auf der Startseite: nginx vererbt
    # add_header NICHT in einen location-Block, der eigene Header setzt — so
    # verliert ausgerechnet eine Sonderroute ihren Schutz, ohne dass es auffaellt.
    for pfad, name in (("/", "Startseite"), ("/api/health", "API"),
                       ("/site.json", "Betreiberdaten"), ("/lp/index.html", "Lernpfad-Statik")):
        b.pruefe("Sicherheit", f"Schutz-Kopfzeilen: {name}", kopfe_auf(pfad))

    if https:
        def hsts():
            api.call("GET", "/", roh=True)
            wert = api.letzte_kopfe.get("strict-transport-security", "")
            if not wert:
                raise AssertionError("kein HSTS — Browser versuchen es weiter unverschluesselt")
            return wert[:60]
        b.pruefe("Sicherheit", "HSTS", hsts, schwere="warnung")

    def server_verraet():
        api.call("GET", "/", roh=True)
        wert = api.letzte_kopfe.get("server", "")
        if any(z.isdigit() for z in wert):
            raise AssertionError(f"Server-Kopfzeile nennt die Version ({wert}) — "
                                 "erleichtert die Suche nach passenden Luecken")
        return wert or "keine Server-Kennung"

    def api_ohne_anmeldung():
        # Ohne Token darf keine einzige Nutzdaten-Route antworten.
        anonym = Api(api.basis, debug=api.debug)
        offen = []
        for pfad in ("/api/classes", "/api/kurse", "/api/topics", "/api/noten/code-sessions",
                     "/api/karten/classes/1/decks", "/api/trash", "/api/me/export"):
            status, _ = anonym.call("GET", pfad, roh=True)
            if status == 200:
                offen.append(pfad)
        if offen:
            raise AssertionError("ohne Anmeldung erreichbar: " + ", ".join(offen))
        return "7 Datenrouten ohne Token geprueft, alle verschlossen"

    def geheime_dateien():
        gefunden = []
        for pfad in GEHEIM:
            status, text = api.call("GET", pfad, roh=True)
            if status == 200 and any(m in text for m in VERRAETERISCH):
                gefunden.append(pfad)
        if gefunden:
            raise AssertionError("ausgeliefert: " + ", ".join(gefunden))
        return f"{len(GEHEIM)} heikle Pfade geprueft, keiner liefert Inhalte"

    def api_doku():
        for pfad in ("/api/docs", "/docs", "/openapi.json", "/api/openapi.json"):
            status, text = api.call("GET", pfad, roh=True)
            if status == 200 and ("swagger" in text.lower() or '"openapi"' in text):
                raise AssertionError(f"{pfad} ist oeffentlich — zeigt jede Route und jedes Feld")
        return "nicht oeffentlich"

    b.pruefe("Sicherheit", "Server-Kennung", server_verraet, schwere="warnung")
    b.pruefe("Sicherheit", "API ohne Anmeldung", api_ohne_anmeldung)
    b.pruefe("Sicherheit", "Heikle Dateien", geheime_dateien)
    b.pruefe("Sicherheit", "API-Dokumentation", api_doku, schwere="warnung")


def teste_web_dateien(api, b):
    """Kleinkram, den ein Browser oder eine Suchmaschine erwartet."""

    def robots():
        status, text = api.call("GET", "/robots.txt", roh=True)
        if status != 200:
            raise AssertionError(f"HTTP {status} — ohne robots.txt entscheidet jede Suchmaschine "
                                 "selbst, was sie von Nuvora indexiert")
        if "user-agent" not in text.lower():
            raise AssertionError("Datei ohne User-agent-Zeile — wird ignoriert")
        gesperrt = [z for z in ("/api/", "/lernen/", "/cd/") if z in text]
        return f"{len(text)} Zeichen, gesperrt: {', '.join(gesperrt) or 'nichts'}"

    def datei(pfad, was, schwere="fehler"):
        def fn():
            status, text = api.call("GET", pfad, roh=True)
            if status != 200:
                raise AssertionError(f"HTTP {status} — {was}")
            return f"{len(text)} Zeichen"
        return fn

    def unbekannte_seite():
        # Eine SPA beantwortet unbekannte Adressen mit der Shell — das ist
        # richtig so (die Route entscheidet der Browser), soll aber wirklich
        # die Shell sein und keine Fehlerseite des Proxys.
        status, text = api.call("GET", "/gibt-es-nicht-zz", roh=True)
        if status != 200 or '<div id="root"' not in text:
            raise AssertionError(f"HTTP {status} statt der Shell — tote Lesezeichen landen im Nichts")
        return "unbekannte Adressen bekommen die Shell"

    def auslieferung():
        # Die Anwendung ist ueber ein Megabyte gross; ohne Kompression und ohne
        # Cache laedt jede Seite sie neu.
        status, text = api.call("GET", "/", roh=True)
        treffer = re.search(r'src="(/assets/[^"]+\.js)"', text)
        if not treffer:
            raise AssertionError("kein Anwendungs-Javascript in der Shell gefunden")
        # Mit Accept-Encoding fragen: ohne diese Kopfzeile liefert JEDER Server
        # unkomprimiert aus — die Pruefung haette sonst immer angeschlagen.
        api.call("GET", treffer.group(1), roh=True, kopfe={"Accept-Encoding": "gzip, br"})
        kopfe = api.letzte_kopfe
        maengel = []
        if "gzip" not in kopfe.get("content-encoding", "") and "br" not in kopfe.get("content-encoding", ""):
            maengel.append("keine Kompression (gzip/br)")
        if "max-age" not in kopfe.get("cache-control", ""):
            maengel.append("kein Cache-Control")
        if maengel:
            raise AssertionError(", ".join(maengel) + f" fuer {treffer.group(1)}")
        return f"{treffer.group(1).split('/')[-1]}: komprimiert und zwischenspeicherbar"

    def security_txt():
        # RFC 9116: Contact und Expires sind Pflicht, und ein abgelaufenes
        # Expires ist schlechter als keine Datei — dann glaubt der Finder, es
        # gaebe einen gepflegten Meldeweg, und schreibt ins Leere.
        status, text = api.call("GET", "/.well-known/security.txt", roh=True)
        if status != 200:
            raise AssertionError(f"HTTP {status} — kein Meldeweg fuer Sicherheitsluecken (RFC 9116)")
        felder = {z.split(":", 1)[0].strip().lower() for z in text.splitlines()
                  if ":" in z and not z.strip().startswith("#")}
        fehlt = [f for f in ("contact", "expires") if f not in felder]
        if fehlt:
            raise AssertionError("Pflichtfelder fehlen: " + ", ".join(fehlt))
        zeile = next((z for z in text.splitlines() if z.lower().startswith("expires:")), "")
        wert = zeile.split(":", 1)[1].strip()
        try:
            bis = datetime.strptime(wert.replace("Z", "").split(".")[0], "%Y-%m-%dT%H:%M:%S")
        except ValueError:
            raise AssertionError(f"Expires nicht lesbar: {wert}")
        tage = (bis - datetime.utcnow()).days
        if tage < 0:
            raise AssertionError(f"abgelaufen seit {-tage} Tagen — Expires neu setzen")
        if tage < 30:
            raise AssertionError(f"laeuft in {tage} Tagen ab — Expires neu setzen")
        return f"gueltig noch {tage} Tage"

    b.pruefe("Web-Dateien", "robots.txt", robots)
    b.pruefe("Web-Dateien", "security.txt (RFC 9116)", security_txt)
    b.pruefe("Web-Dateien", "favicon.svg", datei("/favicon.svg", "Browser zeigt kein Symbol"))
    b.pruefe("Web-Dateien", "manifest.json", datei("/manifest.json", "kein Zum-Startbildschirm-Hinzufuegen"))
    b.pruefe("Web-Dateien", "icon-192.png", datei("/icon-192.png", "Symbol fuer den Startbildschirm fehlt"))
    b.pruefe("Web-Dateien", "sw.js", datei("/sw.js", "Service Worker fehlt"), schwere="warnung")
    b.pruefe("Web-Dateien", "Unbekannte Adresse", unbekannte_seite)
    b.pruefe("Web-Dateien", "Auslieferung der Anwendung", auslieferung, schwere="warnung")


# ─────────────────────────── 2. Einrichtung (Server) ───────────────────────────

def teste_einrichtung(api, b):
    status, text = api.call("GET", "/api/selftest", roh=True)
    if status == 403:
        # Uebersprungen heisst: Schema, Konfiguration und E-Mail-Versand sind
        # ungeprueft — also genau das, was man nach einem Deploy wissen will.
        # Als Warnung sichtbar halten, mit dem Weg dahin.
        b.add("Einrichtung", "Server-Selbsttest", False, schwere="warnung",
              detail="uebersprungen — Schema, Konfiguration und E-Mail bleiben ungeprueft. "
                     "SELFTEST_TOKEN in .deploy.env UND in der .env auf dem Server setzen "
                     "(gleicher Wert), dann laeuft der Teil auch ohne Administrationskonto.")
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

    def reihenfolge():
        # Die Reihenfolge der Schuelerliste ist eine eigene Angabe (position) —
        # NICHT die Kartennummer. Geprueft wird beides: dass Umsortieren wirkt
        # und dass die Kartennummern dabei stehen bleiben (an ihnen haengen
        # Scans und Noten).
        kl = api.call("GET", f"/api/classes/{u.class_id}", erwartet=(200,))
        vorher = [(s["card_id"], s["name"]) for s in kl["students"]]
        if len(vorher) < 2:
            return "uebersprungen — weniger als zwei Schueler"
        gedreht = list(reversed(kl["students"]))
        api.call("PUT", f"/api/classes/{u.class_id}",
                 {"name": kl["name"], "renumber": True, "students": [
                     {"card_id": s["card_id"], "name": s["name"], "niveau": s.get("niveau") or ""}
                     for s in gedreht]}, erwartet=(200,))
        nachher = api.call("GET", f"/api/classes/{u.class_id}", erwartet=(200,))["students"]
        if [s["name"] for s in nachher] != [s["name"] for s in gedreht]:
            raise AssertionError(f"Reihenfolge nicht uebernommen: {[s['name'] for s in nachher]}")
        # Mit renumber gilt: Reihenfolge IST die Nummer, also 1..n von oben.
        # Die Testergebnisse ziehen serverseitig mit (Regressionstest dazu:
        # apps/api/tests/test_update_class.py).
        soll = list(range(1, len(nachher) + 1))
        if [s["card_id"] for s in nachher] != soll:
            raise AssertionError(f"nicht durchnummeriert: {[s['card_id'] for s in nachher]}")
        # zurueckdrehen, damit die folgenden Proben ihre gewohnte Reihenfolge sehen
        zurueck = api.call("GET", f"/api/classes/{u.class_id}", erwartet=(200,))["students"]
        namen_vorher = [n for _, n in vorher]
        api.call("PUT", f"/api/classes/{u.class_id}",
                 {"name": kl["name"], "renumber": True, "students": [
                     {"card_id": next(z["card_id"] for z in zurueck if z["name"] == n), "name": n}
                     for n in namen_vorher]}, erwartet=(200,))
        return "umsortiert, Kartennummern folgen der Reihenfolge (1..n)"

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
            # Jahresfolge: der zweite Kurs bekommt den ersten als Vorjahr. Die
            # Liste muss den Namen des Vorjahres mitliefern, sonst muesste die
            # Oberflaeche je Kurs nachfragen — und das Vorjahr liegt meist im
            # Archiv, wo diese Liste gar nicht hinsieht.
            api.call("PUT", f"/api/kurse/{zweit['id']}",
                     {"name": f"{PRAEFIX} Zweitkurs B", "schuljahr": "2025/26",
                      "vorgaenger_id": u.kurs_id}, erwartet=(200,))
            liste = api.call("GET", "/api/kurse", erwartet=(200,))
            mein = next((x for x in liste if x["id"] == zweit["id"]), None)
            if not mein or mein.get("vorgaenger_id") != u.kurs_id or not mein.get("vorgaenger_name"):
                raise AssertionError(f"Vorjahr fehlt in der Kursliste: {mein}")
            if mein.get("schuljahr") != "2025/26":
                raise AssertionError(f"Schuljahr nicht gespeichert: {mein}")
            # Ein Kreis muss abgewiesen werden (sonst dreht sich jede Anzeige,
            # die der Kette folgt, im Kreis).
            status, _ = api.call("PUT", f"/api/kurse/{zweit['id']}",
                                 {"name": f"{PRAEFIX} Zweitkurs B", "vorgaenger_id": zweit["id"]}, roh=True)
            if status != 400:
                raise AssertionError(f"Kurs als eigenes Vorjahr: HTTP {status} statt 400")
        finally:
            api.call("DELETE", f"/api/kurse/{zweit['id']}", erwartet=(204, 404))
            api.call("DELETE", f"/api/kurse/{zweit['id']}/purge", erwartet=(204, 404))
        return (f"{len(mitglieder)} Schueler im Kurs, zweiter Kurs teilt dieselben, "
                f"Jahresfolge gesetzt und Kreis abgewiesen")

    def themen():
        api.call("PUT", f"/api/topics/{u.topic_id}",
                 {"name": f"{PRAEFIX} Thema", "ziel_g": "G-Ziel", "ziel_e": "E-Ziel"},
                 erwartet=(200,))
        api.call("GET", f"/api/topics/{u.topic_id}/usage", erwartet=(200,))
        return "Thema mit E/G-Zielen"

    def archiv():
        # Archiv ist NICHT der Papierkorb: die Klasse verschwindet aus den
        # Listen, ihre Daten bleiben. Geprueft wird beides — raus und zurueck.
        api.call("POST", f"/api/classes/{u.class_id}/archive", erwartet=(200,))
        aktiv = api.call("GET", "/api/classes", erwartet=(200,))
        if any(k["id"] == u.class_id for k in aktiv):
            raise AssertionError("archivierte Klasse steht weiter in der aktiven Liste")
        im_archiv = api.call("GET", "/api/classes?archiviert=true", erwartet=(200,))
        if not any(k["id"] == u.class_id for k in im_archiv):
            raise AssertionError("archivierte Klasse fehlt im Archiv")
        # Die Schueler muessen dranbleiben — Archiv heisst nicht Datenverlust.
        eintrag = next(k for k in im_archiv if k["id"] == u.class_id)
        if len(eintrag.get("students") or []) != 2:
            raise AssertionError(f"Archiv hat {len(eintrag.get('students') or [])} Schueler statt 2")
        api.call("POST", f"/api/classes/{u.class_id}/archive", erwartet=(200,))
        zurueck = api.call("GET", "/api/classes", erwartet=(200,))
        if not any(k["id"] == u.class_id for k in zurueck):
            raise AssertionError("Klasse kommt nicht aus dem Archiv zurueck")

        # Kurs archivieren nimmt seine Fach-Klassen mit — genau das ist der
        # Sinn am Schuljahresende, und genau das vergisst man beim Nachbauen.
        if u.kurs_id:
            api.call("POST", f"/api/kurse/{u.kurs_id}/archive", erwartet=(200,))
            if any(k["id"] == u.kurs_id for k in api.call("GET", "/api/kurse", erwartet=(200,))):
                raise AssertionError("archivierter Kurs steht weiter in der aktiven Liste")
            if any(k["id"] == u.class_id for k in api.call("GET", "/api/classes", erwartet=(200,))):
                raise AssertionError("Kurs archiviert, seine Klasse aber nicht")
            api.call("POST", f"/api/kurse/{u.kurs_id}/archive", erwartet=(200,))
            if not any(k["id"] == u.class_id for k in api.call("GET", "/api/classes", erwartet=(200,))):
                raise AssertionError("Klasse kommt mit dem Kurs nicht zurueck")
        return "Klasse und Kurs archivieren (Klassen ziehen mit), Schueler bleiben, zurueckholen"

    def papierkorb():
        api.call("GET", "/api/trash", erwartet=(200,))
        return "erreichbar"

    def fruehwarnung():
        # Rechnet ueber CardVote-Quizze UND Klassenarbeiten und gehoert deshalb
        # keinem der beiden Module. Sie darf ohne beide antworten (leer), aber
        # niemals 403 oder 500 — sonst haengt eine Kern-Sicht an einem Modul.
        eine = api.call("GET", f"/api/classes/{u.class_id}/fruehwarnung", erwartet=(200,))
        if "schueler" not in eine or "quellen" not in eine:
            raise AssertionError(f"Antwort unvollstaendig: {list(eine)}")
        # Die Datenlage muss mitkommen: ohne sie kann die Oberflaeche im
        # Leerfall nur „nichts gefunden" sagen statt WARUM.
        q = eine["quellen"]
        for feld in ("cardvote", "auswertung", "quizze", "arbeiten", "arbeiten_ohne_thema"):
            if feld not in q:
                raise AssertionError(f"Datenlage ohne '{feld}': {q}")
        return f"Klassensicht antwortet ({len(eine['schueler'])} Kinder, Datenlage vollstaendig)"

    def material():
        # Dateiablage des Kerns: hochladen, wiederfinden, ansehen, loeschen.
        # Ein winziges, gueltiges PDF — der Ansehen-Weg (/pdf) muss es
        # unveraendert durchreichen, ohne LibreOffice zu bemuehen.
        pdf = (b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
               b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
               b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 99 99]>>endobj\n"
               b"trailer<</Root 1 0 R>>\n%%EOF\n")
        hoch = api.upload("/api/material", "file", f"{PRAEFIX}.pdf", pdf, "application/pdf",
                          felder={"topic_id": str(u.topic_id)}, erwartet=(201,))
        mid = hoch["id"]
        try:
            liste = api.call("GET", f"/api/material?topic_id={u.topic_id}", erwartet=(200,))
            if not any(m["id"] == mid for m in liste):
                raise AssertionError("hochgeladene Datei steht nicht in der Liste")
            status, text = api.call("GET", f"/api/material/{mid}/pdf", roh=True)
            if status != 200 or not text.startswith("%PDF"):
                raise AssertionError(f"Ansehen liefert HTTP {status} und kein PDF")
            kopf = api.letzte_kopfe.get("content-disposition", "")
            if "inline" not in kopf:
                raise AssertionError(f"PDF kommt nicht zum Ansehen zurueck: {kopf}")
            # Zweiter Aufruf darf nichts mehr kosten: der Server schickt eine
            # Kennung (ETag) mit, der Browser bringt sie zurueck, es folgt 304
            # ohne Inhalt. In Schulnetzen ist das der Unterschied zwischen
            # „sofort da" und „laedt fuenf Sekunden".
            etag = api.letzte_kopfe.get("etag", "")
            if not etag:
                raise AssertionError("Ansicht ohne ETag — jedes Oeffnen laedt die Datei neu")
            status2, text2 = api.call("GET", f"/api/material/{mid}/pdf", roh=True,
                                      kopfe={"If-None-Match": etag})
            if status2 != 304 or text2:
                raise AssertionError(f"zweiter Abruf liefert HTTP {status2} mit {len(text2)} Zeichen statt 304 ohne Inhalt")
        finally:
            api.call("DELETE", f"/api/material/{mid}", erwartet=(204, 404))
        return "hochladen, wiederfinden, als PDF ansehen, loeschen"

    def themenstand():
        # Kern-Sicht wie die Fruehwarnung: rechnet ueber Klassenarbeiten UND
        # Quizze, gehoert keinem Modul und darf ohne beide leer antworten —
        # aber nie 403 oder 500.
        aus = api.call("GET", f"/api/classes/{u.class_id}/themenprofil", erwartet=(200,))
        fehlt = [f for f in ("schueler", "mindest_punkte", "mindest_karten", "quellen")
                 if f not in aus]
        if fehlt:
            raise AssertionError(f"Antwort unvollstaendig, es fehlt: {', '.join(fehlt)}")
        # Die Herkunft muss benannt sein und darf nur die drei bekannten Quellen
        # nennen — eine Zahl ohne nachvollziehbare Quelle waere eine Behauptung.
        unbekannt = set(aus["quellen"]) - {"arbeit", "quiz", "karten"}
        if unbekannt:
            raise AssertionError(f"unbekannte Quelle gemeldet: {sorted(unbekannt)}")
        einer = api.call("GET", f"/api/classes/{u.class_id}/themenprofil?student_id={u.students[0]}",
                         erwartet=(200,))
        if len(einer.get("schueler") or []) != 1:
            raise AssertionError("Einschraenkung auf ein Kind wirkt nicht")
        quellen = ", ".join(aus["quellen"]) or "keine (kein Quellmodul aktiv)"
        return (f"Klasse und einzelnes Kind ({aus['mindest_punkte']:.0f} Punkte / "
                f"{aus['mindest_karten']} Karten Mindestmass; Quellen: {quellen})")

    def zugangsdruck():
        # Der Zettel zum Ausschneiden. Geprueft wird, dass wirklich ein PDF
        # herauskommt — ein leeres Blatt faellt sonst erst am Drucker auf.
        status, text = api.call("GET", f"/api/karten/classes/{u.class_id}/zugaenge.pdf"
                                       f"?base=http://example.invalid", roh=True)
        if status == 409:
            return "uebersprungen — weder Karteikarten noch CardVote aktiv"
        if status != 200:
            raise AssertionError(f"HTTP {status} statt eines PDF")
        if not text.startswith("%PDF"):
            raise AssertionError("Antwort ist kein PDF")
        return f"PDF erzeugt ({len(text) // 1024} KB)"

    def modulregister():
        module = api.call("GET", "/api/modules", erwartet=(200,))
        if not module:
            raise AssertionError("REGISTRY leer")
        return f"{len(module)} Module im Register"

    def sicherung():
        """Der Sicherungs-Weg gehoert der Administration — und was da liegt,
        muss heil sein.

        Bewusst wird KEINE Sicherung erzeugt: `POST /api/admin/backup` legt eine
        echte Datei in die Rotation und wirft dabei (KEEP/MAX_MB in backup.py)
        eine echte aeltere heraus. Ein Test, der bei jedem Deploy laeuft, darf
        die Sicherungshistorie des Betriebs nicht aufbrauchen. Geprueft wird
        deshalb: die Tuer ist zu (ohne Anmeldung und mit einem gewoehnlichen
        Lehrkraft-Konto), und — falls das Testkonto die Administration ist —
        die Pruefsumme der neuesten vorhandenen Sicherung.
        """
        anonym = Api(api.basis, debug=api.debug)
        for pfad, methode in (("/api/admin/backup", "GET"),
                              ("/api/admin/backup", "POST"),
                              ("/api/admin/backup/einstellungen", "PUT")):
            status, _ = anonym.call(methode, pfad, {} if methode != "GET" else None, roh=True)
            if status == 200 or status == 201:
                raise AssertionError(f"{methode} {pfad} antwortet ohne Anmeldung mit {status} — "
                                     "Sicherungen enthalten Art.-9-Daten")
        status, text = api.call("GET", "/api/admin/backup", roh=True)
        if status == 403:
            return "nur fuer die Administration (Testkonto ist keine) — Tuer zu"
        if status != 200:
            raise AssertionError(f"HTTP {status}: {text[:150]}")
        daten = json.loads(text)
        fehlt = [f for f in ("ziel", "verzeichnis", "sicherungen", "inhalt", "nicht_enthalten")
                 if f not in daten]
        if fehlt:
            raise AssertionError("Auskunft unvollstaendig: " + ", ".join(fehlt))
        if not any(".env" in z for z in daten.get("nicht_enthalten") or []):
            raise AssertionError("die Auskunft nennt nicht, dass .env bewusst NICHT mitgesichert "
                                 "wird — genau das muss dranstehen")
        liste = daten.get("sicherungen") or []
        if not liste:
            return "Administration: Auskunft vollstaendig, noch keine Sicherung vorhanden"
        neueste = liste[0]["name"]
        pruef = api.call("POST", f"/api/admin/backup/{neueste}/pruefen", erwartet=(200,))
        if not pruef.get("ok"):
            raise AssertionError(f"neueste Sicherung '{neueste}' ist nicht heil: {pruef}")
        return f"{len(liste)} Sicherungen, neueste ('{neueste}') geprueft und heil"

    b.pruefe("Kern", "Klassen und Schueler", klassen)
    b.pruefe("Kern", "Reihenfolge", reihenfolge)
    b.pruefe("Kern", "Kurse", kurse)
    b.pruefe("Kern", "Themen", themen)
    b.pruefe("Kern", "Papierkorb", papierkorb)
    b.pruefe("Kern", "Archiv", archiv)
    b.pruefe("Kern", "Dateiablage", material)
    b.pruefe("Kern", "Fruehwarnung", fruehwarnung)
    b.pruefe("Kern", "Themenstand", themenstand)
    b.pruefe("Kern", "Zugangs-Zettel", zugangsdruck)
    b.pruefe("Kern", "Modulregister", modulregister)
    b.pruefe("Kern", "Sicherung", sicherung)


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
                       "topic_id": u.topic_id, "date": "2026-03-02"}, erwartet=(201,))
    # Das Datum ist eine Eigenschaft der Spalte, kein Namensbestandteil: es muss
    # haften und getrennt vom Titel zurueckkommen (frueher stand es IM Titel).
    if spalte.get("date") != "2026-03-02":
        raise AssertionError(f"Datum der Spalte nicht gespeichert: {spalte}")
    if "2026" in (spalte.get("name") or ""):
        raise AssertionError(f"Datum ist in den Titel gerutscht: {spalte['name']}")
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

    # Die Sammlung: ein Stapel OHNE Klasse, danach einem Kurs zugewiesen. Das
    # ist der Weg, den die Oberflaeche heute geht — ohne Probe wuesste niemand,
    # ob er nach dem Deploy noch traegt.
    sammlung = api.call("POST", "/api/karten/decks",
                        {"name": f"{PRAEFIX} Sammlung"}, erwartet=(201,))
    api.call("GET", "/api/karten/decks", erwartet=(200,))
    api.call("GET", "/api/karten/card-folders", erwartet=(200,))
    kurs_id = None
    for k in api.call("GET", "/api/kurse", erwartet=(200,)) or []:
        if any(c.get("id") == u.class_id for c in (k.get("classes") or [])):
            kurs_id = k["id"]
            break
    if kurs_id is not None:
        zu = api.call("PUT", f"/api/karten/decks/{sammlung['id']}/kurse",
                      {"kurs_ids": [kurs_id]}, erwartet=(200,))
        if zu.get("kurs_ids") != [kurs_id]:
            raise AssertionError(f"Zuweisung nicht gespeichert: {zu}")
    api.call("DELETE", f"/api/karten/decks/{sammlung['id']}", erwartet=(204,))
    api.call("DELETE", f"/api/karten/decks/{sammlung['id']}/purge", erwartet=(204,))

    api.call("DELETE", f"/api/karten/cards/{karte['id']}", erwartet=(204,))
    api.call("DELETE", f"/api/karten/decks/{stapel['id']}", erwartet=(204,))
    api.call("DELETE", f"/api/karten/decks/{stapel['id']}/purge", erwartet=(204,))
    return "Stapel, Karte, Schueler-Zugaenge, Fortschritt, Sammlung + Kurs-Zuweisung"


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
    api.call("GET", f"/api/anwesenheit/{u.class_id}?date={heute}", erwartet=(200,))
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
    # Das Modul ist die Einstiegs-/Methodensammlung. Die frueher hier gepruefte
    # Wochenplanung (/api/planung) gibt es nicht mehr: die Jahresplanung liegt
    # an den Themen im Kern, der Rest im Modul Kalender.
    ordner = api.call("POST", "/api/methoden/folders", {"name": f"{PRAEFIX} Methoden"},
                      erwartet=(201,))
    methode = api.call("POST", "/api/methoden/", {
        "title": f"{PRAEFIX} Einstieg", "description": "Idee", "folder_id": ordner["id"],
        "topic_id": u.topic_id,
    }, erwartet=(201,))
    api.call("GET", "/api/methoden/list", erwartet=(200,))
    api.call("DELETE", f"/api/methoden/{methode['id']}", erwartet=(204,))
    api.call("DELETE", f"/api/methoden/folders/{ordner['id']}", erwartet=(204,))
    return "Methodensammlung mit Ordner, Eintrag und Thema"


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
    # Den Ausgangszustand festhalten, BEVOR etwas umgeschaltet wird: bricht der
    # Lauf ab (Strg-C, Netz weg), kann scripts/aufraeumen.py ihn wiederherstellen.
    merke_module(api.basis, vorher_aktiv)
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

        # Braucht aktive Module (Karten, Code-Detektiv), also hier drin.
        teste_schueler_wege(api, b, u)
        teste_papierkorb_rundweg(api, b, u)
        teste_archiv_zugaenge(api, b, u)
        teste_teilmengen(api, b, u)
        teste_art9_export(api, b, u)
        teste_fremdzugriff(api, b, u)
    finally:
        for key in zugeschaltet:
            try:
                api.call("DELETE", f"/api/modules/{key}/activate", erwartet=(200,))
            except Exception as e:
                b.reste.append(f"Modul {key} blieb zugeschaltet: {e}")
        # Zurueckgestellt — der gemerkte Zustand ist verbraucht. Ohne das wuerde
        # aufraeumen.py spaeter einen veralteten Stand wiederherstellen.
        vergiss_module(api.basis)


def teste_papierkorb_rundweg(api, b, u):
    """Der ganze Weg durch den Papierkorb — je Art, die `list_trash` kennt.

    Bisher wurde nur geprueft, dass `/api/trash` antwortet. Das sagt nichts
    darueber, ob Geloeschtes dort ankommt, ob es zurueckkommt und ob es sich
    endgueltig entfernen laesst. Genau daran haengt aber, ob ein Fehlgriff
    reparabel ist — und der Papierkorb ist die einzige Stelle, an der Module
    und Kern dieselbe Semantik teilen (`_AKTIONEN` in routers/trash.py ruft die
    Modul-Funktionen auf, statt eigene Logik zu bauen).

    Geprueft wird je Art: loeschen -> liegt im Papierkorb -> wiederherstellen ->
    ist wieder da (an seiner eigenen Liste nachgesehen, nicht am Papierkorb) ->
    wieder loeschen -> endgueltig weg.
    """
    arten = []

    def anlegen():
        kl = api.call("POST", "/api/classes", {
            "name": f"{PRAEFIX} Papierkorb-Klasse",
            "students": [{"card_id": 1, "name": f"{PRAEFIX} Kind"}]}, erwartet=(201,))
        kurs = api.call("POST", "/api/kurse", {"name": f"{PRAEFIX} Papierkorb-Kurs"},
                        erwartet=(201,))
        thema = api.call("POST", "/api/topics", {"name": f"{PRAEFIX} Papierkorb-Thema"},
                         erwartet=(201,))
        frage = api.call("POST", "/api/questions", {
            "text": f"{PRAEFIX} Papierkorb-Frage", "question_type": "mc",
            "choices": {"A": "1", "B": "2", "C": "3", "D": "4"}, "correct_answer": "A",
        }, erwartet=(201,))
        pfad = api.call("POST", "/api/lernpfad/paths", {"name": f"{PRAEFIX} Papierkorb-Pfad"},
                        erwartet=(201,))
        leiter = api.call("POST", f"/api/lernpfad/paths/{pfad['id']}/ladders",
                          {"class_id": u.class_id, "topic_id": u.topic_id}, erwartet=(201,))
        stapel = api.call("POST", f"/api/karten/classes/{u.class_id}/decks",
                          {"name": f"{PRAEFIX} Papierkorb-Stapel"}, erwartet=(201,))
        karte = api.call("POST", f"/api/karten/decks/{stapel['id']}/cards",
                         {"front": f"{PRAEFIX} Papierkorb-Karte", "back": "x"}, erwartet=(201,))

        def lebt_in(pfad_liste, oid, schluessel="id"):
            return lambda: any(x.get(schluessel) == oid
                               for x in (api.call("GET", pfad_liste, erwartet=(200,)) or []))

        def leiter_lebt():
            pfade = api.call("GET", "/api/lernpfad/paths", erwartet=(200,)) or []
            p = _finde_id(pfade, pfad["id"])
            return any(x.get("id") == leiter["id"] for x in ((p or {}).get("ladders") or []))

        arten.extend([
            ("class", kl["id"], f"/api/classes/{kl['id']}", lebt_in("/api/classes", kl["id"])),
            ("kurs", kurs["id"], f"/api/kurse/{kurs['id']}", lebt_in("/api/kurse", kurs["id"])),
            ("topic", thema["id"], f"/api/topics/{thema['id']}",
             lebt_in("/api/topics", thema["id"])),
            ("question", frage["id"], f"/api/questions/{frage['id']}",
             lebt_in("/api/questions", frage["id"])),
            ("ladder", leiter["id"], f"/api/lernpfad/ladders/{leiter['id']}", leiter_lebt),
            ("path", pfad["id"], f"/api/lernpfad/paths/{pfad['id']}",
             lebt_in("/api/lernpfad/paths", pfad["id"])),
            ("card", karte["id"], f"/api/karten/cards/{karte['id']}",
             lambda: any(c.get("id") == karte["id"] for c in
                         (_finde_id(api.call("GET", "/api/karten/decks", erwartet=(200,)),
                                    stapel["id"]) or {}).get("cards") or [])),
            ("deck", stapel["id"], f"/api/karten/decks/{stapel['id']}",
             lebt_in(f"/api/karten/classes/{u.class_id}/decks", stapel["id"])),
        ])
        return f"{len(arten)} Arten angelegt"

    def im_papierkorb(kind, oid):
        return any(e["kind"] == kind and e["id"] == oid
                   for e in api.call("GET", "/api/trash", erwartet=(200,)) or [])

    def rundweg():
        # Reihenfolge: Kind vor Elternteil (Karte vor Stapel, Leiter vor Pfad) —
        # sonst nimmt die Kaskade des Elternteils das Kind mit, und der
        # Rueckweg pruefte nichts mehr.
        fehler = []
        for kind, oid, weg, lebt in arten:
            try:
                api.call("DELETE", weg, erwartet=(204,))
                if not im_papierkorb(kind, oid):
                    fehler.append(f"{kind} {oid}: nach dem Loeschen nicht im Papierkorb")
                    continue
                api.call("POST", f"/api/trash/{kind}/{oid}/restore", erwartet=(204,))
                if im_papierkorb(kind, oid):
                    fehler.append(f"{kind} {oid}: liegt nach dem Wiederherstellen weiter im Papierkorb")
                if not lebt():
                    fehler.append(f"{kind} {oid}: wiederhergestellt, steht aber nicht in seiner Liste")
                api.call("DELETE", weg, erwartet=(204,))
                api.call("DELETE", f"/api/trash/{kind}/{oid}", erwartet=(204,))
                if im_papierkorb(kind, oid):
                    fehler.append(f"{kind} {oid}: nach dem endgueltigen Loeschen weiter im Papierkorb")
            except Exception as e:
                fehler.append(f"{kind} {oid}: {e}")
        if fehler:
            raise AssertionError("; ".join(fehler))
        return (f"{len(arten)} Arten: loeschen, wiederfinden, zurueckholen, "
                "endgueltig loeschen — je einmal durchgespielt")

    def lebendes_bleibt():
        """Der Papierkorb darf nur anfassen, was wirklich darin liegt.

        `purge_card` prueft das deleted_at nicht selbst — ueber diesen Router
        liess sich frueher eine LEBENDE Karte endgueltig loeschen. Die Schranke
        sitzt in `_im_papierkorb`, und genau die wird hier probiert.
        """
        thema = api.call("POST", "/api/topics", {"name": f"{PRAEFIX} Lebt-noch"}, erwartet=(201,))
        try:
            status, _ = api.call("DELETE", f"/api/trash/topic/{thema['id']}", roh=True)
            if status != 404:
                raise AssertionError(f"lebendes Thema endgueltig loeschbar (HTTP {status})")
            status, _ = api.call("POST", f"/api/trash/topic/{thema['id']}/restore", roh=True)
            if status != 404:
                raise AssertionError(f"lebendes Thema wiederherstellbar (HTTP {status})")
            if not any(t["id"] == thema["id"]
                       for t in api.call("GET", "/api/topics", erwartet=(200,))):
                raise AssertionError("das lebende Thema ist verschwunden")
        finally:
            api.call("DELETE", f"/api/topics/{thema['id']}", erwartet=(204, 404))
            api.call("DELETE", f"/api/trash/topic/{thema['id']}", erwartet=(204, 404))
        return "was nicht im Papierkorb liegt, laesst sich weder purgen noch zurueckholen"

    def leeren():
        """„Papierkorb leeren" muss alles nehmen — auch Fragen und Themen.

        Die Arten wachsen (zuletzt kamen CardVote-Fragen und Themen dazu), und
        `empty_trash` fuehrt eine EIGENE Reihenfolge-Liste. Wer dort eine Art
        vergisst, bekommt einen Papierkorb, der sich nicht leeren laesst — und
        merkt es nie, weil die Antwort trotzdem 204 ist.
        """
        angelegt = []
        thema = api.call("POST", "/api/topics", {"name": f"{PRAEFIX} Leeren-Thema"}, erwartet=(201,))
        angelegt.append(("topic", thema["id"], f"/api/topics/{thema['id']}"))
        frage = api.call("POST", "/api/questions", {
            "text": f"{PRAEFIX} Leeren-Frage", "question_type": "mc",
            "choices": {"A": "1", "B": "2", "C": "3", "D": "4"}, "correct_answer": "A",
        }, erwartet=(201,))
        angelegt.append(("question", frage["id"], f"/api/questions/{frage['id']}"))
        stapel = api.call("POST", f"/api/karten/classes/{u.class_id}/decks",
                          {"name": f"{PRAEFIX} Leeren-Stapel"}, erwartet=(201,))
        angelegt.append(("deck", stapel["id"], f"/api/karten/decks/{stapel['id']}"))
        for _kind, _oid, weg in angelegt:
            api.call("DELETE", weg, erwartet=(204,))
        try:
            api.call("DELETE", "/api/trash", erwartet=(204,))
            uebrig = [f"{k} {o}" for k, o, _w in angelegt if im_papierkorb(k, o)]
            if uebrig:
                raise AssertionError("nach dem Leeren liegt es immer noch da: " + ", ".join(uebrig))
        finally:
            for kind, oid, _weg in angelegt:
                api.call("DELETE", f"/api/trash/{kind}/{oid}", erwartet=(204, 404))
        return f"{len(angelegt)} Arten weich geloescht, Leeren nimmt alle"

    if b.pruefe("Papierkorb", "Testdaten je Art", anlegen):
        b.pruefe("Papierkorb", "Loeschen, zurueckholen, endgueltig loeschen", rundweg)
    b.pruefe("Papierkorb", "Lebendes bleibt unangetastet", lebendes_bleibt)
    b.pruefe("Papierkorb", "Leeren nimmt jede Art", leeren)


def _finde_id(liste, oid):
    for e in liste or []:
        if e.get("id") == oid:
            return e
    return None


def teste_archiv_zugaenge(api, b, u):
    """Eine archivierte Klasse verstummt nach aussen — ihre Daten bleiben.

    Archivieren heisst „Schuljahr vorbei", nicht „geloescht": die Klasse
    verschwindet aus den Auswahlfeldern, und die ausgeteilten QR-Codes duerfen
    nichts mehr herausgeben (`_student_by_token` in karten.py prueft das). Beides
    war ungeprueft — geprueft wurde nur, dass die Klasse aus der Liste faellt.
    """
    anonym = Api(api.basis, debug=api.debug)
    stapel = api.call("POST", f"/api/karten/classes/{u.class_id}/decks",
                      {"name": f"{PRAEFIX} Archiv-Stapel"}, erwartet=(201,))
    archiviert = False
    try:
        api.call("POST", f"/api/karten/decks/{stapel['id']}/cards",
                 {"front": "ARCHIVGEHEIM", "back": "ARCHIVGEHEIM-HINTEN"}, erwartet=(201,))
        api.call("POST", f"/api/karten/decks/{stapel['id']}/release", {"now": True},
                 erwartet=(200,))
        zugaenge = api.call("POST", f"/api/karten/classes/{u.class_id}/tokens",
                            erwartet=(200, 201))
        token = zugaenge[0]["token"]

        def offen():
            stand = anonym.call("GET", f"/api/karten/lernen/{token}", erwartet=(200,))
            if not any(c["front"] == "ARCHIVGEHEIM" for c in stand.get("cards") or []):
                raise AssertionError("Karte fehlt, obwohl die Klasse aktiv ist")
            return "vor dem Archivieren: der Zettel gilt"

        def stumm():
            nonlocal archiviert
            api.call("POST", f"/api/classes/{u.class_id}/archive", erwartet=(200,))
            archiviert = True
            status, text = anonym.call("GET", f"/api/karten/lernen/{token}", roh=True)
            if status < 400:
                raise AssertionError(f"archivierte Klasse liefert weiter aus (HTTP {status})")
            if "ARCHIVGEHEIM" in text:
                raise AssertionError("Karteninhalte stehen trotz Archiv in der Antwort")
            status, _ = anonym.call("POST", f"/api/karten/lernen/{token}/review",
                                    {"card_id": 1, "grade": 2}, roh=True)
            if status < 400:
                raise AssertionError(f"Schreiben ueber den Zettel einer archivierten Klasse "
                                     f"moeglich (HTTP {status})")
            return f"archiviert: HTTP {status}, keine Inhalte in der Antwort"

        def daten_bleiben():
            im_archiv = api.call("GET", "/api/classes?archiviert=true", erwartet=(200,))
            eintrag = _finde_id(im_archiv, u.class_id)
            if not eintrag:
                raise AssertionError("archivierte Klasse fehlt im Archiv")
            if len(eintrag.get("students") or []) != len(u.students):
                raise AssertionError(f"{len(eintrag.get('students') or [])} Schueler im Archiv "
                                     f"statt {len(u.students)}")
            # Der Stapel gehoert der Klasse und muss das Archivieren ueberleben.
            if not _finde_id(api.call("GET", "/api/karten/decks", erwartet=(200,)), stapel["id"]):
                raise AssertionError("der Kartenstapel der Klasse ist mit dem Archiv verschwunden")
            return f"{len(eintrag['students'])} Schueler und der Kartenstapel sind unversehrt"

        def zurueck():
            nonlocal archiviert
            api.call("POST", f"/api/classes/{u.class_id}/archive", erwartet=(200,))
            archiviert = False
            stand = anonym.call("GET", f"/api/karten/lernen/{token}", erwartet=(200,))
            if not any(c["front"] == "ARCHIVGEHEIM" for c in stand.get("cards") or []):
                raise AssertionError("nach dem Zurueckholen gilt der Zettel nicht mehr")
            return "aus dem Archiv zurueck: derselbe Zettel gilt wieder"

        b.pruefe("Archiv", "Zugang gilt vor dem Archivieren", offen)
        b.pruefe("Archiv", "Archivierte Klasse verstummt nach aussen", stumm)
        b.pruefe("Archiv", "Daten bleiben vollstaendig", daten_bleiben)
        b.pruefe("Archiv", "Zurueckholen belebt denselben Zettel", zurueck)
    finally:
        if archiviert:
            try:
                api.call("POST", f"/api/classes/{u.class_id}/archive", erwartet=(200,))
            except Exception as e:
                b.reste.append(f"Testklasse blieb archiviert: {e}")
        api.call("DELETE", f"/api/karten/decks/{stapel['id']}", erwartet=(204, 404))
        api.call("DELETE", f"/api/karten/decks/{stapel['id']}/purge", erwartet=(204, 404))


# Marker, die NUR in den besonders schuetzenswerten Feldern stehen. Taucht einer
# in einem Export auf, ist genau das passiert, was CLAUDE.md verbietet.
ART9_NOTIZ = "ZZ-Art9-Notiz-Geheim"
ART9_MASSNAHME = "ZZ-Art9-Massnahme-Geheim"


def teste_art9_export(api, b, u):
    """DSGVO Art. 9: foerder, massnahmen und notizen stehen in KEINEM Export.

    Es gibt einen pytest dafuer, der die Funktionen prueft. Hier zaehlt die
    laufende Installation: die Felder werden mit einem eindeutigen Marker
    beschrieben, danach wird jeder Export- und Marktplatzweg abgerufen und die
    Antwort danach durchsucht.

    Zwei Wege sind bewusst NICHT dabei, und das ist kein Versehen:
      * `/api/me/export` — die Selbstauskunft nach Art. 15. Sie MUSS die Daten
        enthalten (und sagt das auch), sie geht an niemanden sonst.
      * PDF-Ausgaben — ihre Textstroeme sind komprimiert, eine Textsuche darin
        faende auch einen echten Verstoss nicht. Ein Test, der nie anschlagen
        kann, ist schlechter als keiner: er sagt „geprueft", ohne zu pruefen.
    """
    import io
    import zipfile

    kl = api.call("GET", f"/api/classes/{u.class_id}", erwartet=(200,))
    original = kl["students"]

    def schreiben(mit_marker):
        api.call("PUT", f"/api/classes/{u.class_id}", {
            "name": kl["name"],
            "students": [{
                "card_id": s["card_id"], "name": s["name"], "niveau": s.get("niveau") or "",
                "foerder": ["Lernen"] if mit_marker and i == 0 else None,
                "massnahmen": ([{"art": "Zeitzuschlag", "detail": ART9_MASSNAHME, "arbeit": True}]
                               if mit_marker and i == 0 else None),
                "notizen": ART9_NOTIZ if mit_marker and i == 0 else "",
            } for i, s in enumerate(original)],
        }, erwartet=(200,))

    def sweep():
        schreiben(True)
        # Gegenprobe: der Marker steht wirklich in der Datenbank. Ohne sie wuerde
        # die Suche unten auch dann gruen, wenn nie etwas geschrieben wurde.
        nach = api.call("GET", f"/api/classes/{u.class_id}", erwartet=(200,))
        kind = nach["students"][0]
        if kind.get("notizen") != ART9_NOTIZ:
            raise AssertionError("der Marker steht nicht in students.notizen — "
                                 "die Suche darunter beweist dann nichts")
        if not any(m.get("detail") == ART9_MASSNAHME for m in kind.get("massnahmen") or []):
            raise AssertionError("der Marker steht nicht in students.massnahmen")
        if "Lernen" not in (kind.get("foerder") or []):
            raise AssertionError("der Foerderschwerpunkt wurde nicht gespeichert")

        # Eigene Ausgaben: hier wird auch nach den FELDNAMEN gesucht — der
        # Foerderschwerpunkt ist ein Wort aus einem festen Katalog und taugt
        # nicht als Marker, sein Schluessel schon.
        wege = [
            f"/api/export/class/{u.class_id}",
            f"/api/noten/classes/{u.class_id}/export",
            f"/api/klassenarbeit/classes/{u.class_id}/students",
            f"/api/noten/classes/{u.class_id}/students",
            f"/api/karten/classes/{u.class_id}/progress",
            "/api/kalender/export",
            "/api/methoden/export",
        ]
        # Der Marktplatz ist oeffentlich und zeigt auch fremde Eintraege. Dort
        # wird NUR nach den eigenen Markern gesucht: ein fremder Eintrag, der
        # zufaellig das Wort „notizen" enthaelt, waere sonst ein roter Lauf ohne
        # Befund — und ein Test, der gelegentlich grundlos rot ist, verdirbt den
        # gruenen.
        gefunden = []
        stumm = []
        for weg in wege + ["/api/marketplace"]:
            status, text = api.call("GET", weg, roh=True)
            if status != 200:
                # Nicht stillschweigend uebergehen: ein Weg, der nicht antwortet,
                # ist ein Weg, der nicht geprueft wurde — das gehoert in den
                # Bericht, sonst liest sich „gruen" wie „alles durchsucht".
                stumm.append(f"{weg} ({status})")
                continue
            for marker in (ART9_NOTIZ, ART9_MASSNAHME):
                if marker in text:
                    gefunden.append(f"{weg}: {marker}")
            if weg in wege:
                for feld in ('"foerder"', '"massnahmen"', '"notizen"'):
                    if feld in text:
                        gefunden.append(f"{weg}: Feld {feld}")

        # ZIP: hier hilft keine Textsuche auf der Antwort — die Eintraege sind
        # komprimiert. Also wirklich auspacken und in den Teilen suchen.
        status, roh = api.rohbytes(f"/api/noten/classes/{u.class_id}/export.zip")
        teile = 0
        if status == 200 and roh[:2] == b"PK":
            with zipfile.ZipFile(io.BytesIO(roh)) as z:
                for name in z.namelist():
                    if name.lower().endswith(".pdf"):
                        continue      # siehe Dokumentation oben
                    teile += 1
                    inhalt = z.read(name).decode("utf-8", "replace")
                    for marker in (ART9_NOTIZ, ART9_MASSNAHME):
                        if marker in inhalt:
                            gefunden.append(f"export.zip/{name}: {marker}")
        if gefunden:
            raise AssertionError("besonders schuetzenswerte Daten im Export: "
                                 + "; ".join(gefunden))
        return (f"{len(wege) + 1 - len(stumm)} Export- und Marktplatzwege plus {teile} Teil(e) "
                "der Noten-ZIP durchsucht — kein Foerder-, Massnahmen- oder Notizfeld darin"
                + (f"; ohne Antwort und daher ungeprueft: {', '.join(stumm)}" if stumm else ""))

    try:
        b.pruefe("Datenschutz", "Art.-9-Daten in keinem Export", sweep)
    finally:
        try:
            schreiben(False)
        except Exception as e:
            b.reste.append(f"Art-9-Marker nicht aus der Testklasse entfernt: {e}")


def teste_teilmengen(api, b, u):
    """Was ein PUT nicht mitschickt, darf es nicht loeschen.

    Seit die Oberflaeche erst auf Knopfdruck speichert, schicken die Masken
    ganze Zustaende an den Server. Das ist richtig so — aber dieselben
    Endpunkte werden auch von kleinen Handgriffen benutzt (umbenennen,
    verschieben), die nur einen Ausschnitt schicken. Wo der Server das als
    „alles andere loeschen" liest, verschwinden Daten lautlos. Genau so hat
    `eval_config` einmal die Zeitdaten einer laufenden Sitzung geloescht.

    Geprueft werden die Endpunkte, die ausdruecklich teilweise arbeiten (und
    fuer die es deshalb eine Zusicherung gibt) — nicht die Formularmasken, bei
    denen ein leeres Feld leeren SOLL.
    """
    def klassenarbeit():
        arbeit = api.call("POST", "/api/klassenarbeit/works",
                          {"class_id": u.class_id, "name": f"{PRAEFIX} Teilmenge"},
                          erwartet=(201,))
        try:
            api.call("PUT", f"/api/klassenarbeit/works/{arbeit['id']}", {
                "tasks": [{"id": "a1", "label": "Aufgabe 1", "topic_id": u.topic_id, "max": 5}],
                "results": {str(u.students[0]): {"a1": 3}},
                "scale": {"1": 90, "2": 75, "3": 60, "4": 45, "5": 20, "6": 0},
                "absent": [str(u.students[1])],
            }, erwartet=(200,))
            # Nur den Namen aendern — sonst nichts.
            api.call("PUT", f"/api/klassenarbeit/works/{arbeit['id']}",
                     {"name": f"{PRAEFIX} Teilmenge B"}, erwartet=(200,))
            w = _finde_id(api.call("GET", f"/api/klassenarbeit/classes/{u.class_id}/works",
                                   erwartet=(200,)), arbeit["id"])
            if not w:
                raise AssertionError("die Arbeit ist nach dem Umbenennen verschwunden")
            verloren = []
            if len(w.get("tasks") or []) != 1:
                verloren.append(f"tasks={w.get('tasks')}")
            if (w.get("results") or {}).get(str(u.students[0])) != {"a1": 3.0}:
                verloren.append(f"results={w.get('results')}")
            if not w.get("scale"):
                verloren.append("scale leer")
            if str(u.students[1]) not in (w.get("absent") or []):
                verloren.append(f"absent={w.get('absent')}")
            if verloren:
                raise AssertionError("Umbenennen hat mitgeloescht: " + ", ".join(verloren))
            return "Umbenennen laesst Aufgaben, Punkte, Notenschluessel und Abwesende stehen"
        finally:
            api.call("DELETE", f"/api/klassenarbeit/works/{arbeit['id']}", erwartet=(204, 404))

    def notenabschnitt():
        # `term` steht gar nicht in SectionIn — genau deshalb muss es haften.
        # Wuerde es beim Bearbeiten auf die Vorgabe "1" fallen, wanderte ein
        # Abschnitt des 2. Halbjahres beim Umbenennen ins erste.
        block = api.call("POST", f"/api/noten/classes/{u.class_id}/sections?term=2",
                         {"name": f"{PRAEFIX} 2. HJ", "weight": 30}, erwartet=(201,))
        try:
            api.call("PUT", f"/api/noten/sections/{block['id']}",
                     {"name": f"{PRAEFIX} 2. HJ neu", "weight": 30, "position": 0},
                     erwartet=(200,))
            alle = api.call("GET", f"/api/noten/classes/{u.class_id}/sections?term=all",
                            erwartet=(200,))
            mein = _finde_id(alle, block["id"])
            if not mein:
                raise AssertionError("der Abschnitt ist nach dem Umbenennen verschwunden")
            if str(mein.get("term")) != "2":
                raise AssertionError(f"Halbjahr beim Umbenennen verloren: term={mein.get('term')}")
            return "ein Abschnitt des 2. Halbjahres bleibt nach dem Umbenennen im 2. Halbjahr"
        finally:
            api.call("DELETE", f"/api/noten/sections/{block['id']}", erwartet=(204, 404))

    def kartenstapel():
        # Freigabe und Kurs-Zuweisung stehen nicht in DeckIn (bzw. werden beim
        # Bearbeiten bewusst nicht gelesen). Ein Umbenennen darf einen
        # ausgerollten Stapel weder zurueckziehen noch aus seinen Kursen nehmen —
        # sonst waeren die Karten der Klasse ueber Nacht weg.
        stapel = api.call("POST", "/api/karten/decks",
                          {"name": f"{PRAEFIX} Teilmengen-Stapel"}, erwartet=(201,))
        try:
            api.call("POST", f"/api/karten/decks/{stapel['id']}/release", {"now": True},
                     erwartet=(200,))
            if u.kurs_id:
                api.call("PUT", f"/api/karten/decks/{stapel['id']}/kurse",
                         {"kurs_ids": [u.kurs_id]}, erwartet=(200,))
            api.call("PUT", f"/api/karten/decks/{stapel['id']}",
                     {"name": f"{PRAEFIX} Teilmengen-Stapel B"}, erwartet=(200,))
            nach = _finde_id(api.call("GET", "/api/karten/decks", erwartet=(200,)), stapel["id"])
            if not nach:
                raise AssertionError("der Stapel ist nach dem Umbenennen aus der Sammlung weg")
            if not nach.get("released_at"):
                raise AssertionError("Umbenennen hat den Stapel wieder zum Entwurf gemacht")
            zugewiesen = api.call("GET", f"/api/karten/decks/{stapel['id']}/kurse",
                                  erwartet=(200,)).get("kurs_ids")
            if u.kurs_id and zugewiesen != [u.kurs_id]:
                raise AssertionError(f"Kurs-Zuweisung beim Umbenennen verloren: {zugewiesen}")
            return "Umbenennen laesst Freigabe und Kurs-Zuweisung stehen"
        finally:
            api.call("DELETE", f"/api/karten/decks/{stapel['id']}", erwartet=(204, 404))
            api.call("DELETE", f"/api/karten/decks/{stapel['id']}/purge", erwartet=(204, 404))

    b.pruefe("Teilmengen", "Klassenarbeit umbenennen", klassenarbeit)
    b.pruefe("Teilmengen", "Notenabschnitt umbenennen", notenabschnitt)
    b.pruefe("Teilmengen", "Kartenstapel umbenennen", kartenstapel)


def teste_schueler_wege(api, b, u):
    """Die einzigen Wege, die Lernende benutzen — ohne Konto, nur mit Token.

    Lernende haben in Nuvora keine Konten. Was sie erreichen, haengt an einem
    Token in der Adresse. Genau diese Pfade muessen ohne Anmeldung gehen und
    mit falschem Token dichthalten — beides wird hier durchgespielt.
    """
    # Eigener Client OHNE Anmeldung: sonst wuerde der Test sich selbst
    # bescheinigen, was nur mit Token der Lehrkraft funktioniert.
    anonym = Api(api.basis, debug=api.debug)

    def karten_lernen():
        stapel = api.call("POST", f"/api/karten/classes/{u.class_id}/decks",
                          {"name": f"{PRAEFIX} SuS-Stapel"}, erwartet=(201,))
        try:
            karte = api.call("POST", f"/api/karten/decks/{stapel['id']}/cards",
                             {"front": "3+4", "back": "7"}, erwartet=(201,))
            # Entwuerfe bleiben fuer Lernende unsichtbar — erst freigeben.
            api.call("POST", f"/api/karten/decks/{stapel['id']}/release", {"now": True},
                     erwartet=(200,))
            zugaenge = api.call("POST", f"/api/karten/classes/{u.class_id}/tokens",
                                erwartet=(200, 201))
            if not zugaenge:
                raise AssertionError("keine Schueler-Zugaenge erzeugt")
            token = zugaenge[0]["token"]

            sitzung = anonym.call("GET", f"/api/karten/lernen/{token}", erwartet=(200,))
            karten = sitzung.get("cards", sitzung) if isinstance(sitzung, dict) else sitzung
            if not karten:
                raise AssertionError("Lernender sieht keine Karte, obwohl der Stapel frei ist")
            anonym.call("POST", f"/api/karten/lernen/{token}/review",
                        {"card_id": karte["id"], "grade": 3}, erwartet=(200,))
            anonym.call("GET", f"/api/karten/lernen/{token}/results", erwartet=(200,))
            # Und dicht bei falschem Token.
            status, _ = anonym.call("GET", "/api/karten/lernen/ZZ-kein-gueltiger-token", roh=True)
            if status < 400:
                raise AssertionError(f"falscher Token liefert HTTP {status} statt einer Absage")
            return "Stapel freigeben, ohne Login lernen, Antwort zaehlt, falscher Token abgewiesen"
        finally:
            api.call("DELETE", f"/api/karten/decks/{stapel['id']}", erwartet=(204, 404))
            api.call("DELETE", f"/api/karten/decks/{stapel['id']}/purge", erwartet=(204, 404))

    def code_detektiv_beitreten():
        sitzung = api.call("POST", "/api/codedetektiv/sessions",
                           {"puzzles": [{"id": "zz1", "title": f"{PRAEFIX} Raetsel"}]},
                           erwartet=(201,))
        code = sitzung["code"]
        try:
            anonym.call("GET", f"/api/codedetektiv/sessions/{code}", erwartet=(200,))
            anonym.call("POST", f"/api/codedetektiv/sessions/{code}/join",
                        {"name": f"{PRAEFIX} Kind"}, erwartet=(200, 201))
            anonym.call("POST", f"/api/codedetektiv/sessions/{code}/result",
                        {"playerName": f"{PRAEFIX} Kind", "puzzleId": "zz1",
                         "solved": True, "attempts": 1, "time": 5.0}, erwartet=(200, 201))
            status, _ = anonym.call("GET", "/api/codedetektiv/sessions/ZZZZZZ", roh=True)
            if status < 400:
                raise AssertionError(f"unbekannter Code liefert HTTP {status} statt einer Absage")
            return "beitreten, Ergebnis melden, unbekannter Code abgewiesen"
        finally:
            api.call("DELETE", f"/api/codedetektiv/sessions/{code}", erwartet=(204, 404))

    b.pruefe("Schueler-Wege", "Karten lernen (/lernen/<token>)", karten_lernen)
    b.pruefe("Schueler-Wege", "Code-Detektiv beitreten (/cd/<code>)", code_detektiv_beitreten)


def teste_fremdzugriff(api, b, u):
    """Mandantentrennung an der laufenden Installation.

    Es gibt Regressionstests dafuer (test_tenant_isolation.py), die pruefen
    aber die Funktionen. Hier zaehlt, was hinter Proxy und Anmeldung wirklich
    passiert: fremde IDs anfragen und darauf bestehen, dass nichts durchkommt.
    """
    eigene = {k["id"] for k in api.call("GET", "/api/classes", erwartet=(200,))}
    fremde = [i for i in range(1, 40) if i not in eigene][:3]
    if not fremde:
        b.add("Mandantentrennung", "Fremde Klassen", True,
              "keine fremden IDs im Suchbereich")
        return

    def lesen():
        durchgelassen = []
        for fid in fremde:
            for pfad in (f"/api/classes/{fid}",
                         f"/api/karten/classes/{fid}/decks",
                         f"/api/noten/classes/{fid}/sections",
                         f"/api/orga/{fid}",
                         f"/api/sitzplan/{fid}"):
                status, _ = api.call("GET", pfad, roh=True)
                if status == 200:
                    durchgelassen.append(f"{pfad} -> 200")
        if durchgelassen:
            raise AssertionError("fremde Daten lesbar: " + ", ".join(durchgelassen[:5]))
        return f"{len(fremde) * 5} Anfragen auf fremde IDs, alle abgewiesen"

    def schreiben():
        # Ein harmloser Schreibversuch: gelingt er, ist die Trennung gebrochen —
        # dann wird der Eintrag sofort wieder entfernt.
        for fid in fremde:
            status, text = api.call("POST", f"/api/orga/{fid}",
                                    {"name": f"{PRAEFIX} Fremdzugriff"}, roh=True)
            if status in (200, 201):
                try:
                    api.call("DELETE", f"/api/orga/item/{json.loads(text)['id']}",
                             erwartet=(204, 404))
                except Exception as e:
                    # Der Befund ist der gelungene Schreibzugriff (gleich
                    # darunter). Klappt das Aufraeumen nicht, darf das nicht
                    # still bleiben: der Eintrag liegt dann in fremden Daten.
                    b.reste.append(f"Fremdzugriffs-Eintrag in Klasse {fid} nicht entfernt: {e}")
                raise AssertionError(f"Anlegen in fremder Klasse {fid} war erlaubt (HTTP {status})")
        return f"Schreibversuche auf {len(fremde)} fremde Klassen abgewiesen"

    b.pruefe("Mandantentrennung", "Fremde Daten lesen", lesen)
    b.pruefe("Mandantentrennung", "In fremde Klasse schreiben", schreiben)


BESTAND_DATEI = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                             ".selftest-bestand.json")


def teste_bestand(api, b):
    """Fruehwarnung: ist ueber Nacht Datenbestand verschwunden?

    Eine Kaskade, die zu viel mitreisst, faellt sonst erst auf, wenn jemand
    seine Noten sucht. Der Selbsttest merkt sich nach jedem Lauf die Zahlen und
    vergleicht beim naechsten Mal. Gemessen wird VOR den Testdaten.
    """
    quellen = {
        "Klassen": ("/api/classes", len),
        "Schueler": ("/api/classes", lambda d: sum(len(k.get("students", [])) for k in d)),
        "Kurse": ("/api/kurse", len),
        "Themen": ("/api/topics", len),
    }
    jetzt = {}
    for name, (pfad, zaehl) in quellen.items():
        try:
            jetzt[name] = zaehl(api.call("GET", pfad, erwartet=(200,)))
        except Exception as e:
            b.add("Bestand", name, False, f"nicht abfragbar: {e}")

    # Je Instanz getrennt merken: Test- und Produktivinstanz haben verschiedene
    # Bestaende, und ein gemeinsamer Stand meldet beim Wechsel sofort "Daten
    # verschwunden".
    alle = {}
    try:
        with open(BESTAND_DATEI) as f:
            alle = json.load(f)
        if "zahlen" in alle:   # altes Format ohne Instanz-Trennung
            alle = {}
    except Exception:
        # Bewusst still: beim ERSTEN Lauf gibt es die Datei nicht, und eine
        # unlesbare Datei darf den Selbsttest nicht anhalten. Fehlt der
        # Vergleichsstand, meldet der Bericht das unten selbst
        # ("erster Lauf — Zahlen gemerkt: ...").
        alle = {}
    vorher = alle.get(api.basis, {})

    if not vorher:
        b.add("Bestand", "Vergleich", True, schwere="warnung",
              detail="erster Lauf — Zahlen gemerkt: " +
                     ", ".join(f"{k} {v}" for k, v in jetzt.items()))
    else:
        for name, zahl in jetzt.items():
            alt = vorher.get(name)
            if alt is None:
                b.add("Bestand", name, True, f"{zahl} (neu erfasst)")
            elif zahl < alt and (alt - zahl) > max(1, alt * 0.1):
                b.add("Bestand", name, False,
                      f"{alt} -> {zahl}: {alt - zahl} verschwunden seit dem letzten Lauf. "
                      "Kein Selbstlaeufer — nachsehen, ob eine Kaskade zu viel mitgerissen hat.")
            else:
                b.add("Bestand", name, True, f"{zahl}" + (f" (vorher {alt})" if alt != zahl else ""))

    try:
        alle[api.basis] = jetzt
        with open(BESTAND_DATEI, "w") as f:
            json.dump(alle, f, ensure_ascii=False, indent=2)
    except Exception as e:
        b.reste.append(f"Bestandszahlen nicht gespeichert: {e}")


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

def raeume_reste(api, b):
    """Reste eines abgebrochenen Laufs abraeumen, BEVOR der Test etwas anlegt.

    Ein Lauf, der mittendrin abbricht (Strg-C, Netz weg, Browser tot), laesst
    seine ZZ-Testdaten stehen. Beim naechsten Mal scheiterte dann schon der
    Aufbau — `POST /api/topics -> 409: "Dieses Thema gibt es an dieser Stelle
    schon"` — und danach fiel der ganze Modulteil aus. Ein Test, der sich
    selbst dauerhaft blockiert, ist wertlos.

    Geloescht wird ausschliesslich, was ein Testpraefix traegt; das Netz dafuer
    sitzt in scripts/aufraeumen.py (Klasse `Fund`) und nicht hier.
    """
    verfuegbar, vorher = modulzustand(api)
    # Ohne aktives Modul antwortet dessen API mit 403 — dann faende die Suche
    # ausgerechnet die Modul-Reste nicht.
    setze_module(api, b, set(verfuegbar), vorher, verfuegbar)
    try:
        funde = Sammler(api, b).alles()
        loeschbar = [f for f in funde if f.pfade]
        for f in loeschbar:
            try:
                f.loesche(api)
            except Exception as e:
                b.reste.append(f"{f.art} '{f.label}' nicht abgeraeumt: {e}")
        nur_melden = [f for f in funde if not f.pfade]
        for f in nur_melden:
            b.reste.append(f"{f.art} '{f.label}' — {f.hinweis or 'nur meldbar'}")
        if not funde:
            b.add("Reste", "vom letzten Lauf", True, "nichts liegengeblieben")
        else:
            b.add("Reste", "vom letzten Lauf", True, schwere="warnung",
                  detail=f"{len(loeschbar)} Reste eines abgebrochenen Laufs abgeraeumt"
                         + (f", {len(nur_melden)} nur gemeldet" if nur_melden else ""))
    finally:
        # Ist-Zustand ist jetzt "alle zugeschaltet" — zurueck auf den Stand von
        # vorher, damit der Selbsttest die Einstellungen nicht veraendert.
        setze_module(api, b, vorher, set(verfuegbar), verfuegbar)


def main():
    p = argparse.ArgumentParser(description="Selbsttest der laufenden Nuvora-Installation")
    p.add_argument("--url", default=os.environ.get("SELFTEST_URL") or os.environ.get("SITE_URL"))
    p.add_argument("--email", default=os.environ.get("SELFTEST_EMAIL"))
    p.add_argument("--passwort", default=os.environ.get("SELFTEST_PASSWORD"))
    p.add_argument("--nur-system", action="store_true",
                   help="nur die Checks ohne Login (kein Schreib-Roundtrip)")
    p.add_argument("--json", action="store_true", help="Ergebnis als JSON ausgeben")
    p.add_argument("--token", default=os.environ.get("SELFTEST_TOKEN"),
                   help="Geheimnis fuer die Einrichtungs-Pruefungen (sonst nur mit "
                        "Administrationskonto)")
    p.add_argument("--debug", action="store_true",
                   help="jede Anfrage mitschreiben (Status, Dauer, Fehlertext) — "
                        "zum Suchen, wenn etwas rot ist")
    args = p.parse_args()

    if not args.url:
        print("Fehler: keine URL. --url oder SELFTEST_URL/SITE_URL setzen.", file=sys.stderr)
        return 2

    api = Api(args.url, debug=args.debug, selftest_token=args.token or "")
    b = Bericht()
    if not args.json:
        print(f"Nuvora-Selbsttest gegen {args.url}")

    teste_system(api, b)
    teste_erreichbarkeit(api, b)
    teste_sicherheit(api, b)
    teste_web_dateien(api, b)

    if args.nur_system or not (args.email and args.passwort):
        if not args.nur_system:
            b.add("Anmeldung", "Zugangsdaten", True, schwere="warnung",
                  detail="SELFTEST_EMAIL/SELFTEST_PASSWORD fehlen — "
                         "Module und Einrichtung ungeprueft")
    else:
        angemeldet = False

        def login():
            nonlocal angemeldet
            status, text = api.call("POST", "/api/auth/login",
                                    {"email": args.email, "password": args.passwort}, roh=True)
            # Das Testkonto legt der Selbsttest nicht selbst an: Registrieren
            # verlangt eine E-Mail-Bestaetigung, die kein Skript ersetzen kann.
            # Deshalb hier sagen, was zu tun ist, statt nur "401".
            if status == 401:
                raise AssertionError(
                    f"Konto '{args.email}' gibt es nicht (oder das Passwort stimmt nicht). "
                    f"Einmalig anlegen: unter {args.url}/login registrieren, "
                    "E-Mail bestaetigen, dann dieselben Zugangsdaten als "
                    "SELFTEST_EMAIL/SELFTEST_PASSWORD in .deploy.env eintragen.")
            if status == 403:
                raise AssertionError(
                    f"Konto '{args.email}' existiert, aber die E-Mail ist noch nicht "
                    "bestaetigt. Bestaetigungslink aus der Mail oeffnen (ohne SMTP "
                    "kommt keine Mail an — dann SMTP_* in der .env auf dem Server setzen).")
            if status != 200:
                raise AssertionError(f"HTTP {status}: {text[:150]}")
            d = json.loads(text)
            api.token = d["token"]
            api.call("GET", "/api/auth/me", erwartet=(200,))
            angemeldet = True
            return f"angemeldet als {d['user'].get('email')}"

        b.pruefe("Anmeldung", "Login", login)
        if angemeldet:
            teste_einrichtung(api, b)
            teste_seiten(api, b)
            # Erst aufraeumen, dann zaehlen: Reste eines abgebrochenen Laufs
            # wuerden sonst als Bestand mitgezaehlt und den naechsten Aufbau
            # blockieren.
            raeume_reste(api, b)
            # Vor den Testdaten messen, sonst zaehlt der Test seine eigene Klasse mit.
            teste_bestand(api, b)
            u = Umgebung(api, b)
            if b.pruefe("Kern", "Testdaten anlegen", u.aufbauen):
                try:
                    teste_kern(api, b, u)
                    teste_module(api, b, u)
                finally:
                    u.abbauen()
            else:
                # Ohne Klasse und Schueler kann kein Modul geprueft werden. Das
                # gehoert in den Bericht, sonst liest sich der fehlende
                # Modul-Block wie "nichts zu beanstanden".
                b.add("Module", "alle", False,
                      "uebersprungen — die Testdaten liessen sich nicht anlegen "
                      "(Fehler oben unter Kern)")

    if args.json:
        print(b.als_json())
    else:
        b.drucke()
    return 1 if b.fehler else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        # Wie im Systemtest: ruhiger Satz statt Stapelabzug.
        print("\n  Abgebrochen (Strg-C).\n  Falls Testdaten liegen blieben: "
              "python3 scripts/aufraeumen.py --loeschen", file=sys.stderr)
        sys.exit(130)
