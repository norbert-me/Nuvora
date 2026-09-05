"""Netzgrenzen — wer fragt da, und wohin duerfen WIR fragen.

Ein Blatt: importiert nichts aus der Anwendung. Es steht hier und nicht in
`auth.py`, weil `main.py` dieselbe Rechnung braucht und jeden Router importiert;
eine zweite Fassung dort war genau die Stelle, an der die beiden auseinander
laufen konnten — und diese hier entscheidet, ob ein Rate-Limit greift.

Dazu die andere Richtung: `hole()` ruft fremde Server auf (externe ICS-Kalender,
WebUntis). Beide Adressen gibt die Lehrkraft selbst ein, und genau das ist die
Gefahr — eine URL wie `http://169.254.169.254/…` liesse den Server Dinge aus
seinem eigenen Netz holen und zurueckgeben (SSRF). Der Schutz steht deshalb
hier, an EINER Stelle, statt in jedem Aufrufer noch einmal.
"""
from __future__ import annotations

import ipaddress
import socket
import urllib.error
import urllib.parse
import urllib.request


def client_ip(request) -> str:
    """IP des Aufrufers.

    X-Real-IP zuerst: die setzt UNSER nginx aus `$remote_addr`, sie ist nicht
    faelschbar. X-Forwarded-For kaeme dagegen direkt vom Client durch — wer sie
    selbst setzt, umginge damit jedes Rate-Limit.

    Stand wortgleich in `routers/auth.py` (`client_ip`) und in `main.py`
    (`_req_ip`); beide Namen zeigen weiter hierher.
    """
    real = request.headers.get("X-Real-IP")
    if real:
        return real.strip()
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class NetzFehler(Exception):
    """Abruf nicht moeglich — mit einem Text, der der Lehrkraft etwas sagt."""


def _pruefe_ziel(url: str):
    """URL zerlegen und die Zieladressen pruefen. Gibt (host, port, infos)."""
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise NetzFehler("Adresse muss mit http:// oder https:// beginnen")
    host = parsed.hostname
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        infos = socket.getaddrinfo(host, port)
    except OSError:
        raise NetzFehler("Adresse nicht gefunden")
    for res in infos:
        ip = ipaddress.ip_address(res[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise NetzFehler("Ziel-IP nicht erlaubt")
    return host, port, infos


class _KeineWeiterleitung(urllib.request.HTTPRedirectHandler):
    """Weiterleitungen fangen wir SELBST — siehe `hole()`.

    urllib wuerde ihnen folgen, ohne das neue Ziel noch einmal zu pruefen; genau
    darueber laeuft der Umweg auf eine interne Adresse (SSRF). Sie hier komplett
    zu verbieten war der erste Anlauf und ging in die andere Richtung schief:
    WebUntis, iCloud und Google antworten auf ihre Kalender-Adressen regelmaessig
    mit 301/302, und der Abruf starb dann mit "HTTP Error 302: Found".
    """

    def redirect_request(self, *a, **k):
        return None


def hole(url: str, *, daten: bytes = None, kopfzeilen: dict = None,
         timeout: int = 8, max_bytes: int = 2_000_000,
         cookie_jar=None) -> str:
    """Eine fremde URL abrufen und den Text zurueckgeben.

    `daten` macht daraus ein POST. `cookie_jar` ist ein `http.cookiejar.CookieJar`,
    falls der Aufrufer eine Sitzung ueber mehrere Aufrufe halten muss (WebUntis
    gibt seine Sitzung als JSESSIONID-Cookie zurueck).
    """
    host, port, infos = _pruefe_ziel(url)

    _echtes_gai = socket.getaddrinfo

    def _festgenagelt(h, p, *a, **k):
        if h == host and p == port:
            return infos
        return _echtes_gai(h, p, *a, **k)

    handler = [_KeineWeiterleitung()]
    if cookie_jar is not None:
        handler.append(urllib.request.HTTPCookieProcessor(cookie_jar))
    opener = urllib.request.build_opener(*handler)
    kopf = {"User-Agent": "Nuvora"}
    kopf.update(kopfzeilen or {})
    req = urllib.request.Request(url, data=daten, headers=kopf)
    socket.getaddrinfo = _festgenagelt
    try:
        with opener.open(req, timeout=timeout) as r:
            return r.read(max_bytes).decode("utf-8", "replace")
    finally:
        socket.getaddrinfo = _echtes_gai


# Wie viele Weiterleitungen wir mitgehen. Drei reichen fuer jeden echten Fall
# (http->https, Host->CDN, Freigabe-Adresse->Datei); mehr ist eine Schleife.
_MAX_UMLEITUNGEN = 3


def hole_mit_umleitung(url: str, *, kopfzeilen: dict = None, timeout: int = 8,
                       max_bytes: int = 2_000_000) -> str:
    """Wie `hole()`, folgt aber bis zu drei Weiterleitungen — jede geprueft.

    Der Unterschied zu urllibs eigenem Folgen ist die Pruefung: JEDES neue Ziel
    laeuft wieder durch `_pruefe_ziel`, sonst waere die Weiterleitung genau das
    Loch, das der Schutz stopfen soll ("hole https://harmlos.example", das auf
    169.254.169.254 zeigt).
    """
    ziel = url
    for _ in range(_MAX_UMLEITUNGEN + 1):
        try:
            return hole(ziel, kopfzeilen=kopfzeilen, timeout=timeout, max_bytes=max_bytes)
        except urllib.error.HTTPError as e:
            if e.code not in (301, 302, 303, 307, 308):
                raise
            ort = e.headers.get("Location") or ""
            if not ort:
                raise
            ziel = urllib.parse.urljoin(ziel, ort)
    raise NetzFehler("Zu viele Weiterleitungen")
