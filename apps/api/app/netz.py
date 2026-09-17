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
import threading
import time
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
        if not ip_erlaubt(res[4][0]):
            raise NetzFehler("Ziel-IP nicht erlaubt")
    return host, port, infos


_NAT64 = ipaddress.ip_network("64:ff9b::/96")


def ip_erlaubt(adresse: str) -> bool:
    """Nur oeffentlich routbare Adressen.

    Eine Positivliste (`is_global`) statt einer Aufzaehlung verbotener Netze:
    die Aufzaehlung hatte CGNAT (100.64.0.0/10) vergessen, und in vielen
    Heimnetzen und Clouds liegen genau dort interne Dienste. IPv6-Huellen um
    eine IPv4-Adresse (::ffff:…, 6to4, NAT64) werden ausgepackt und die innere
    Adresse geprueft — sonst waere `::ffff:127.0.0.1` der Umweg.
    """
    try:
        ip = ipaddress.ip_address(adresse.split("%", 1)[0])
    except ValueError:
        return False
    if ip.version == 6:
        innen = ip.ipv4_mapped or ip.sixtofour
        if innen is None and ip in _NAT64:
            innen = ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)
        if innen is not None and not ip_erlaubt(str(innen)):
            return False
    return ip.is_global and not ip.is_multicast


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
         cookie_jar=None, frist: float = None) -> str:
    """Eine fremde URL abrufen und den Text zurueckgeben.

    `daten` macht daraus ein POST. `cookie_jar` ist ein `http.cookiejar.CookieJar`,
    falls der Aufrufer eine Sitzung ueber mehrere Aufrufe halten muss (WebUntis
    gibt seine Sitzung als JSESSIONID-Cookie zurueck).

    `timeout` gilt je Socket-Vorgang — ein Server, der alle sieben Sekunden ein
    Byte schickt, liefe damit ewig und hielte einen Thread des Pools fest.
    Deshalb zusaetzlich `frist`: ein Zeitpunkt (`time.monotonic()`), bis zu dem
    der ganze Abruf fertig sein muss; ohne Angabe `GESAMTFRIST` ab jetzt.
    """
    if frist is None:
        frist = time.monotonic() + GESAMTFRIST
    host, port, infos = _pruefe_ziel(url)

    handler = [_KeineWeiterleitung()]
    if cookie_jar is not None:
        handler.append(urllib.request.HTTPCookieProcessor(cookie_jar))
    opener = urllib.request.build_opener(*handler)
    kopf = {"User-Agent": "Nuvora"}
    kopf.update(kopfzeilen or {})
    req = urllib.request.Request(url, data=daten, headers=kopf)
    rest = frist - time.monotonic()
    if rest <= 0:
        raise NetzFehler("Zeitüberschreitung beim Abruf")
    # Der Nagel gilt nur fuer DIESEN Thread (siehe `_aufloesen`). Frueher wurde
    # `socket.getaddrinfo` fuer die Dauer des ganzen Abrufs global ersetzt und
    # ein Schloss darum gehalten — ein einziger langsamer Server legte damit
    # jeden anderen Abruf (Kalender, Untis, Release-Liste) lahm.
    _NAEGEL.pins = {(host, port): infos}
    try:
        with opener.open(req, timeout=min(timeout, rest)) as r:
            teile, gelesen = [], 0
            lesen = getattr(r, "read1", r.read)
            while gelesen < max_bytes:
                if time.monotonic() > frist:
                    raise NetzFehler("Zeitüberschreitung beim Abruf")
                stueck = lesen(min(65536, max_bytes - gelesen))
                if not stueck:
                    break
                teile.append(stueck)
                gelesen += len(stueck)
            return b"".join(teile).decode("utf-8", "replace")
    finally:
        _NAEGEL.pins = None


# Die echte Aufloesung, EINMAL beim Import gesichert.
_ECHTES_GAI = socket.getaddrinfo
_NAEGEL = threading.local()

# Obergrenze fuer einen ganzen Abruf samt Weiterleitungen (Sekunden).
GESAMTFRIST = 20.0


def _aufloesen(host, port, *a, **k):
    """`socket.getaddrinfo` mit Nagel je Thread (DNS-Rebinding-Schutz).

    Waehrend `hole()` laeuft, beantwortet dieser Thread die Aufloesung des
    geprueften Hosts aus dem Ergebnis der Pruefung — ein zweiter DNS-Blick
    koennte sonst eine interne Adresse liefern. Alle anderen Threads und alle
    anderen Hosts gehen an die echte Funktion. Einmal beim Import eingesetzt
    und nie zurueckgetauscht: damit gibt es keinen Wettlauf ums Wiederherstellen
    mehr, und kein Schloss, das Abrufe hintereinander zwingt.
    """
    pins = getattr(_NAEGEL, "pins", None)
    if pins:
        try:
            p = int(port) if port is not None else None
        except (TypeError, ValueError):
            p = port
        infos = pins.get((host, p))
        if infos is not None:
            typ = k.get("type", a[1] if len(a) > 1 else 0)
            if typ:
                gefiltert = [i for i in infos if i[1] == typ]
                return gefiltert or infos
            return infos
    return _ECHTES_GAI(host, port, *a, **k)


socket.getaddrinfo = _aufloesen


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
    frist = time.monotonic() + GESAMTFRIST   # EINE Frist fuer alle Spruenge
    for _ in range(_MAX_UMLEITUNGEN + 1):
        try:
            return hole(ziel, kopfzeilen=kopfzeilen, timeout=timeout, max_bytes=max_bytes,
                        frist=frist)
        except urllib.error.HTTPError as e:
            if e.code not in (301, 302, 303, 307, 308):
                raise
            ort = e.headers.get("Location") or ""
            if not ort:
                raise
            ziel = urllib.parse.urljoin(ziel, ort)
    raise NetzFehler("Zu viele Weiterleitungen")
