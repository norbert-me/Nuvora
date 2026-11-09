#!/usr/bin/env python3
"""Prueft den Untis-Mobile-Zugang (geheimer Schluessel statt Passwort).

Laeuft auf DEINEM Rechner, nichts davon geht an Nuvora. Gibt nur die STRUKTUR der
Antworten aus (Feldnamen, Typen, Zaehlungen) — keine Namen, Raeume oder Texte —,
damit du die Ausgabe schicken kannst, ohne etwas Persoenliches preiszugeben.

Aufruf:   python3 scripts/untis-mobile-probe.py
Du wirst nach dem Link aus dem QR-Code gefragt (untis://setschool?url=...&school=...
&user=...&key=...). Er steht in WebUntis unter Mein Profil -> Freigaben ->
„Untis Mobile“ -> QR-Code anzeigen; ein Handy zeigt beim Scannen den Link als Text.
Der Schluessel ist der Zugang einer App: in WebUntis jederzeit widerrufbar.
"""
import base64
import getpass
import hashlib
import hmac
import json
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta
from http.cookiejar import CookieJar


def totp(secret: str, jetzt: float, schritt: int = 30, stellen: int = 6) -> str:
    """RFC 6238 mit SHA-1 — die Vorgabe von otplib, das die bekannten Clients nutzen."""
    s = secret.strip().replace(" ", "").upper()
    s += "=" * (-len(s) % 8)
    schluessel = base64.b32decode(s)
    zaehler = struct.pack(">Q", int(jetzt // schritt))
    h = hmac.new(schluessel, zaehler, hashlib.sha1).digest()
    o = h[-1] & 0x0F
    code = (struct.unpack(">I", h[o:o + 4])[0] & 0x7FFFFFFF) % (10 ** stellen)
    return str(code).zfill(stellen)


def form(wert, tiefe=0, name=""):
    """Eine Struktur ohne Inhalte: Schluessel und Typen, Listen mit Laenge."""
    if tiefe > 7:
        return "…"
    if isinstance(wert, dict):
        return {k: form(v, tiefe + 1, k) for k, v in list(wert.items())[:40]}
    if isinstance(wert, list):
        if name in ("is", "can"):                    # Kennzeichen wie CANCELLED — keine Personendaten
            return [str(x) for x in wert][:20]
        return [f"{len(wert)} Eintraege", form(wert[0], tiefe + 1, name)] if wert else []
    if isinstance(wert, bool) or wert is None:
        return repr(wert)
    if isinstance(wert, (int, float)):
        return "<zahl>"
    if wert == "":
        return "<leer>"
    # Aufzaehlungswerte (kein Personenbezug) im Klartext, alles andere nur als Typ.
    if name in ("cellState", "state", "lessonType", "type", "code", "status", "lstype",
                "activityType", "elemType", "substType", "periodState", "missing", "orgId") and len(str(wert)) < 30:
        return str(wert)
    return "<text>"


def main():
    link = getpass.getpass("Link aus dem QR-Code (Eingabe bleibt unsichtbar): ").strip()
    q = urllib.parse.parse_qs(urllib.parse.urlparse(link).query)
    try:
        host = q["url"][0]
        schule = q["school"][0]
        benutzer = q["user"][0]
        geheim = q["key"][0]
    except (KeyError, IndexError):
        print("Im Link fehlen url, school, user oder key.")
        return 1
    host = host.replace("https://", "").replace("http://", "").strip("/")
    basis = f"https://{host}/WebUntis/jsonrpc_intern.do"
    cj = CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

    def ruf(methode, params):
        jetzt_ms = int(time.time() * 1000)
        auth = {"clientTime": jetzt_ms, "user": benutzer, "otp": int(totp(geheim, jetzt_ms / 1000))}
        p = dict(params)
        p["auth"] = auth
        url = f"{basis}?" + urllib.parse.urlencode({"m": methode, "school": schule, "v": "i2.2"})
        rumpf = json.dumps({"id": "nuvora", "method": methode, "params": [p], "jsonrpc": "2.0"}).encode()
        req = urllib.request.Request(url, rumpf, {"Content-Type": "application/json",
                                                  "X-Requested-With": "XMLHttpRequest"})
        try:
            with opener.open(req, timeout=15) as r:
                text = r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            return {"_http": e.code, "_text": e.read().decode("utf-8", "replace")[:200]}
        except Exception as e:
            return {"_fehler": str(e)[:200]}
        try:
            return json.loads(text)
        except ValueError:
            return {"_kein_json": text[:120]}

    print("\n== 1. Anmeldung (getUserData2017)")
    erg = ruf("getUserData2017", {})
    if not isinstance(erg, dict) or erg.get("error") or "result" not in erg:
        print("Fehlgeschlagen:", json.dumps(erg)[:300])
        print("-> Schule hat den Zugang nicht freigegeben, Schluessel widerrufen oder Uhr falsch.")
        return 2
    res = erg["result"]
    print("Angemeldet. Struktur:")
    print(json.dumps(form(res), indent=1, ensure_ascii=False)[:3500])

    ud = (res.get("userData") or {}) if isinstance(res, dict) else {}
    elem_id = ud.get("elemId")
    elem_typ = ud.get("elemType")
    md = (res.get("masterData") or {}) if isinstance(res, dict) else {}
    zeit_md = md.get("timeStamp", 0) if isinstance(md, dict) else 0
    print("\nelemType:", elem_typ, "| elemId vorhanden:", elem_id is not None)

    print("\n== 2. Stundenplan (getTimetable2017), 2 Wochen")
    von = date.today()
    bis = von + timedelta(days=14)
    versuche = [
        {"id": elem_id, "type": elem_typ, "startDate": von.isoformat(), "endDate": bis.isoformat(),
         "masterDataTimestamp": zeit_md, "timetableTimestamp": 0, "timetableTimestamps": []},
        {"id": elem_id, "type": elem_typ, "startDate": von.isoformat(), "endDate": bis.isoformat()},
        {"id": elem_id, "type": elem_typ, "startDate": int(von.strftime("%Y%m%d")),
         "endDate": int(bis.strftime("%Y%m%d")), "masterDataTimestamp": zeit_md},
    ]
    for i, v in enumerate(versuche, 1):
        t = ruf("getTimetable2017", v)
        if isinstance(t, dict) and t.get("result") is not None:
            print(f"Versuch {i} geht. Struktur:")
            tt = (t["result"].get("timetable") or {}) if isinstance(t["result"], dict) else {}
            ps = tt.get("periods") or []
            print(json.dumps(form(ps[0] if ps else {}), indent=1, ensure_ascii=False)[:5000])
            from collections import Counter
            print("\n== 3. Haeufigkeiten ueber alle", len(ps), "Stunden (nur Kennzeichen, keine Namen)")
            print("is:", Counter(x for p in ps for x in (p.get("is") or [])))
            print("Elementtypen/-zustaende:", Counter(
                (e.get("type"), e.get("state"), "orgId" in e) for p in ps for e in (p.get("elements") or [])
                if isinstance(e, dict)))
            print("Texte vorhanden (lesson/substitution/info):", Counter(
                tuple(bool((p.get("text") or {}).get(k)) for k in ("lesson", "substitution", "info")) for p in ps))
            return 0
        print(f"Versuch {i}:", json.dumps(t)[:200])
    print("Kein Aufbau hat funktioniert — schick mir die obigen Zeilen.")
    return 3


if __name__ == "__main__":
    sys.exit(main())
