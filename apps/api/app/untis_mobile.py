"""WebUntis ueber den „Untis Mobile“-Schluessel statt ueber das Passwort.

In WebUntis (Mein Profil -> Freigaben) steht ein QR-Code fuer Apps. Er enthaelt
einen geheimen Schluessel, der NUR fuer Apps gilt und jederzeit widerrufbar ist —
das Schulpasswort bleibt draussen. Mit ihm meldet sich Nuvora an wie die
Untis-App: Einmalcode (TOTP, RFC 6238, SHA-1, 6 Stellen, 30 s) aus dem Schluessel
und der Uhrzeit, bei jedem Aufruf neu.

Gesehen und geprueft an einer echten Schule (09.11.2026):
`getUserData2017` liefert Stammdaten und die eigene Person, `getTimetable2017`
die Stunden mit `is` (REGULAR / IRREGULAR / CANCELLED), `elements`
(TEACHER/CLASS/SUBJECT/ROOM mit `id` und `orgId` = urspruenglicher Wert) und
`text` (lesson / substitution / info).
"""
import base64
import hashlib
import hmac
import json
import re
import struct
import time
import urllib.parse
from datetime import date

from .netz import NetzFehler, hole
from .untis import UntisFehler, _art, SCHUL_ZEITZONE, _CODES  # noqa: F401


def totp(geheim: str, jetzt: float, schritt: int = 30, stellen: int = 6) -> str:
    s = geheim.strip().replace(" ", "").upper()
    s += "=" * (-len(s) % 8)
    h = hmac.new(base64.b32decode(s), struct.pack(">Q", int(jetzt // schritt)), hashlib.sha1).digest()
    o = h[-1] & 0x0F
    return str((struct.unpack(">I", h[o:o + 4])[0] & 0x7FFFFFFF) % (10 ** stellen)).zfill(stellen)


_HOST = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.\-]{2,119}$")
_SCHULE = re.compile(r"^[\w.\-]{1,80}$")
_KEY = re.compile(r"^[A-Za-z2-7= ]{8,128}$")


def link_lesen(link: str) -> dict:
    """`untis://setschool?url=…&school=…&user=…&key=…` -> {host, schule, benutzer, key}.
    ValueError mit lesbarem Text, wenn etwas fehlt oder unplausibel ist."""
    q = urllib.parse.parse_qs(urllib.parse.urlparse((link or "").strip()).query)

    def feld(name):
        return (q.get(name) or [""])[0].strip()

    host = feld("url").replace("https://", "").replace("http://", "").strip("/")
    z = {"host": host, "schule": feld("school"), "benutzer": feld("user"), "key": feld("key")}
    if not (_HOST.match(z["host"]) and _SCHULE.match(z["schule"]) and z["benutzer"]
            and len(z["benutzer"]) <= 120 and _KEY.match(z["key"])):
        raise ValueError("Der Link ist unvollständig oder kein Untis-Mobile-Link")
    try:
        totp(z["key"], 0)
    except Exception:
        raise ValueError("Der Schlüssel im Link ist nicht lesbar")
    return z


class MobileSitzung:
    """Eine Anmeldung per Schluessel. Die Aufrufe tragen ihre Anmeldung selbst
    (`auth` in jedem Rumpf) — es gibt nichts abzumelden."""

    def __init__(self, z: dict):
        self.z = z
        self.url = (f"https://{z['host']}/WebUntis/jsonrpc_intern.do?"
                    + urllib.parse.urlencode({"m": "{m}", "school": z["schule"], "v": "i2.2"}))
        import http.cookiejar
        self._jar = http.cookiejar.CookieJar()

    def _ruf(self, methode: str, params: dict):
        jetzt = time.time()
        auth = {"clientTime": int(jetzt * 1000), "user": self.z["benutzer"],
                "otp": int(totp(self.z["key"], jetzt))}
        rumpf = json.dumps({"id": "nuvora", "method": methode,
                            "params": [{**params, "auth": auth}], "jsonrpc": "2.0"}).encode()
        url = self.url.replace("%7Bm%7D", urllib.parse.quote(methode))
        try:
            text = hole(url, daten=rumpf, cookie_jar=self._jar, timeout=12, max_bytes=8_000_000,
                        kopfzeilen={"Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest"})
        except NetzFehler as e:
            raise UntisFehler("server", str(e))
        except Exception as e:
            raise UntisFehler("server", str(e))
        try:
            antwort = json.loads(text)
        except ValueError:
            raise UntisFehler("server", "Unerwartete Antwort")
        if isinstance(antwort, dict) and antwort.get("error"):
            fehler = antwort["error"]
            raise UntisFehler(_CODES.get(fehler.get("code"), "zugangsdaten"), str(fehler.get("message", ""))[:200])
        res = (antwort or {}).get("result")
        if not isinstance(res, dict):
            raise UntisFehler("server", "Keine Daten erhalten")
        return res

    def pruefen(self):
        """Meldet sich an; wirft UntisFehler, wenn der Schluessel nicht (mehr) gilt."""
        return self._ruf("getUserData2017", {})

    def stundenplan(self, von: date, bis: date) -> list:
        nutzer = self.pruefen()
        ud = nutzer.get("userData") or {}
        md = nutzer.get("masterData") or {}
        if ud.get("elemId") is None:
            raise UntisFehler("kein_zugriff", "Konto ohne eigene Person")
        res = self._ruf("getTimetable2017", {
            "id": ud.get("elemId"), "type": ud.get("elemType"),
            "startDate": von.isoformat(), "endDate": bis.isoformat(),
            "masterDataTimestamp": md.get("timeStamp", 0), "timetableTimestamp": 0,
            "timetableTimestamps": []})
        perioden = ((res.get("timetable") or {}).get("periods")) or []
        return stunden_aus_perioden(perioden, md)


# ─── Antwort -> Nuvoras Stunde ───

def _ziffern(s) -> str:
    return re.sub(r"\D", "", str(s or ""))[:4].zfill(4)


def _zerlege(roh: str):
    """„2026-11-11T11:45Z" -> ("2026-11-11", "11:45", hat_z)."""
    roh = (roh or "").strip()
    return roh[:10], roh[11:16], roh.endswith("Z")


def _lokal(roh: str, utc: bool):
    """(Datum, "HH:MM") in Schulzeit. `utc`: der Zeitstempel ist UTC und wird umgerechnet."""
    tag, zeit, hat_z = _zerlege(roh)
    if not utc or not hat_z or len(zeit) != 5:
        return tag, zeit
    try:
        from datetime import datetime, timezone
        from zoneinfo import ZoneInfo
        p = datetime.strptime(f"{tag} {zeit}", "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        l = p.astimezone(ZoneInfo(SCHUL_ZEITZONE))
        return l.strftime("%Y-%m-%d"), l.strftime("%H:%M")
    except Exception:
        return tag, zeit


def _utc_noetig(perioden: list, md: dict) -> bool:
    """Ist der Zeitstempel UTC oder schon Ortszeit mit angehaengtem „Z“?

    Untis ist hier uneindeutig. Entschieden wird an der Stundenraster-Tabelle
    der Schule: welche Lesart trifft mehr Stundenanfaenge?"""
    raster = {_ziffern(u.get("startTime")) for tag in ((md.get("timeGrid") or {}).get("days") or [])
              for u in (tag.get("units") or []) if isinstance(u, dict)}
    probe = [p for p in perioden if isinstance(p, dict) and _zerlege(p.get("startDateTime"))[2]][:40]
    if not raster or not probe:
        return bool(probe)
    roh = sum(_ziffern(_zerlege(p.get("startDateTime"))[1]) in raster for p in probe)
    umg = sum(_ziffern(_lokal(p.get("startDateTime"), True)[1]) in raster for p in probe)
    return umg > roh


def stunden_aus_perioden(perioden: list, md: dict) -> list:
    def karte(name):
        out = {}
        for x in md.get(name) or []:
            if isinstance(x, dict) and x.get("id") is not None:
                out[x["id"]] = (x.get("name") or x.get("longName") or "").strip()
        return out

    namen = {"CLASS": karte("klassen"), "SUBJECT": karte("subjects"), "ROOM": karte("rooms"),
             "TEACHER": {x["id"]: (x.get("lastName") or x.get("name") or "").strip()
                         for x in (md.get("teachers") or []) if isinstance(x, dict) and x.get("id") is not None}}
    utc = _utc_noetig(perioden, md)
    out = []
    for p in perioden:
        if not isinstance(p, dict):
            continue
        tag, start = _lokal(p.get("startDateTime"), utc)
        _, ende = _lokal(p.get("endDateTime"), utc)
        if not tag or not start:
            continue
        gruppen = {"CLASS": [], "SUBJECT": [], "ROOM": []}
        statt = []
        for e in p.get("elements") or []:
            if not isinstance(e, dict):
                continue
            art = e.get("type")
            name = namen.get(art, {}).get(e.get("id"), "")
            if art in gruppen and name:
                gruppen[art].append(name)
            org = e.get("orgId")
            if org and org != e.get("id") and art in ("SUBJECT", "TEACHER"):
                alt = namen.get(art, {}).get(org, "")
                if alt:
                    statt.append(alt)
        text = p.get("text") or {}
        info = " · ".join(x for x in ((text.get(k) or "").strip() for k in ("lesson", "substitution", "info")) if x)
        kennz = set(p.get("is") or [])
        titel = (" ".join(x for x in [", ".join(gruppen["SUBJECT"]), ", ".join(gruppen["CLASS"])] if x)
                 or (text.get("lesson") or "").strip() or _art(p))
        out.append({
            "datum": tag, "start": start, "ende": ende, "titel": titel[:200],
            "klassen": gruppen["CLASS"], "faecher": gruppen["SUBJECT"],
            "raum": ", ".join(gruppen["ROOM"])[:60], "info": info[:300], "orig": ", ".join(statt)[:80],
            "faellt_aus": "CANCELLED" in kennz, "vertretung": "IRREGULAR" in kennz,
        })
    return out
