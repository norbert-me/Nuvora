"""WebUntis anbinden — LESEN, nie schreiben.

Untis ist der Stundenplan der Schule. Nuvora hat einen eigenen (TimetableSlot),
den die Lehrkraft bisher von Hand pflegt — dieselbe Angabe zweimal. Dieses
Modul holt sie aus Untis und schlaegt sie vor.

Drei Entscheidungen, die nicht aufweichen sollen:

1. **Import, kein Abgleich.** Untis kennt Nuvoras Kurse und Klassen nicht. Was
   von dort kommt, sind Vorschlaege; uebernommen wird, was die Lehrkraft
   bestaetigt. Nuvora bleibt die Wahrheit ueber den eigenen Plan.
2. **Nie zurueckschreiben.** Der Schulstundenplan gehoert der Schulleitung,
   nicht einem Werkzeug einer einzelnen Lehrkraft.
3. **Zwei Wege, eine Form.** Die API liefert echte Struktur (Klasse, Fach,
   Raum, Vertretung, Ferien); der ICS-Abo-Link liefert nur Betreffzeilen, geht
   dafuer immer. Beide muenden in dieselbe Datenform (`Stunde`), damit die
   Uebernahme nur einmal existiert.

Warum die API oft NICHT geht — das ist der haeufige Fall, nicht die Ausnahme,
und die Oberflaeche muss es sagen koennen (siehe `GRUENDE`):

* Die Schule hat den Zugang fuer Fremdprogramme nicht freigeschaltet. Das ist
  eine Einstellung in WebUntis, die viele Schulen aus lassen.
* Die Anmeldung laeuft ueber SSO (IServ, Microsoft, Schul-Login) oder hat eine
  Zwei-Faktor-Bestaetigung. Dann gibt es kein Passwort, das hier passt.
* Server oder Schulkennung stimmen nicht. Jeder Kunde liegt auf einem eigenen
  Server (ajax/arche/… .webuntis.com), und die Schulkennung ist die interne,
  nicht der Anzeigename.

In allen diesen Faellen bleibt der ICS-Weg.
"""
import json
import logging
import os
import re
from datetime import date

from .netz import NetzFehler, hole, hole_mit_umleitung

_log = logging.getLogger("nuvora.untis")


class UntisFehler(Exception):
    """Fehlschlag mit einem Grund, den die Oberflaeche erklaeren kann.

    `grund` ist einer der Schluessel aus `GRUENDE` — die Oberflaeche zeigt dazu
    den passenden Text samt Hinweis auf den ICS-Weg. `text` ist die Meldung von
    WebUntis, falls es eine gab; sie steht daneben, weil eine uebersetzte
    Fehlermeldung ohne das Original nicht nachpruefbar ist.
    """

    def __init__(self, grund: str, text: str = ""):
        super().__init__(text or grund)
        self.grund = grund
        self.text = text


# Was schiefgehen kann, in der Sprache der Lehrkraft. Die Texte selbst stehen
# im Frontend (i18n); hier stehen nur die Schluessel, damit beide Seiten
# dieselbe Liste kennen.
GRUENDE = (
    "zugangsdaten",   # Benutzername oder Passwort falsch
    "schule",         # Schulkennung unbekannt
    "server",         # Server nicht erreichbar / falscher Host
    "gesperrt",       # Konto gesperrt (zu viele Versuche)
    "kein_zugriff",   # Anmeldung ging, aber die Schule erlaubt den Zugriff nicht
    "sso",            # Anmeldung nur ueber SSO/2FA moeglich
    "unbekannt",      # alles andere — mit Originaltext
)

# WebUntis-Fehlercodes, soweit sie sich sinnvoll uebersetzen lassen.
_CODES = {
    -8504: "zugangsdaten",
    -8500: "schule",
    -8998: "gesperrt",
    -8509: "kein_zugriff",
    -8520: "kein_zugriff",   # Sitzung weg -> in der Praxis fehlender Zugriff
    -32601: "kein_zugriff",  # Methode gibt es nicht (Zugang nicht freigeschaltet)
}


def _server_url(server: str, schule: str) -> str:
    """Aus Eingaben aller Art die JSON-RPC-Adresse bauen.

    Die Lehrkraft kopiert meist die ganze Adresse aus dem Browser
    (`https://ajax.webuntis.com/WebUntis/?school=xyz#/basic/login`) — daraus
    Host und Schulkennung zu ziehen ist freundlicher, als sie zu bitten, es
    auseinanderzunehmen.
    """
    s = (server or "").strip()
    s = re.sub(r"^webuntis://", "https://", s, flags=re.I)
    if not s:
        raise UntisFehler("server", "Kein Server angegeben")
    if not s.startswith("http"):
        s = "https://" + s
    m = re.match(r"^(https?://[^/?#]+)", s)
    if not m:
        raise UntisFehler("server", "Server unlesbar")
    basis = m.group(1)
    # Schulkennung: ausdrueckliche Eingabe gewinnt, sonst aus der URL.
    kennung = (schule or "").strip()
    if not kennung:
        aus_url = re.search(r"[?&]school=([^&#/]+)", s)
        kennung = aus_url.group(1) if aus_url else ""
    if not kennung:
        raise UntisFehler("schule", "Keine Schulkennung angegeben")
    import urllib.parse
    return f"{basis}/WebUntis/jsonrpc.do?school={urllib.parse.quote(kennung)}"


class UntisSitzung:
    """Eine angemeldete WebUntis-Sitzung. Als Kontextmanager benutzen, damit
    die Abmeldung auch bei einem Fehler passiert — eine offene Sitzung zaehlt
    bei WebUntis gegen das Sitzungslimit der Schule."""

    def __init__(self, server: str, schule: str, benutzer: str, passwort: str):
        self.url = _server_url(server, schule)
        self.benutzer = benutzer
        self.passwort = passwort
        self.person_id = None
        self.person_typ = None
        import http.cookiejar
        self._jar = http.cookiejar.CookieJar()

    # ─── Grundlage ───

    def _ruf(self, methode: str, params=None):
        rumpf = json.dumps({"id": "nuvora", "method": methode,
                            "params": params or {}, "jsonrpc": "2.0"}).encode()
        try:
            text = hole(self.url, daten=rumpf, cookie_jar=self._jar,
                        kopfzeilen={"Content-Type": "application/json"},
                        timeout=10, max_bytes=4_000_000)
        except NetzFehler as e:
            raise UntisFehler("server", str(e))
        except Exception as e:
            raise UntisFehler("server", str(e))
        try:
            antwort = json.loads(text)
        except ValueError:
            # Kein JSON: fast immer eine Anmeldeseite (SSO) oder eine
            # Fehlerseite des Servers.
            raise UntisFehler("sso" if "login" in text[:2000].lower() else "server",
                              "Unerwartete Antwort")
        if isinstance(antwort, dict) and antwort.get("error"):
            fehler = antwort["error"]
            code = fehler.get("code")
            raise UntisFehler(_CODES.get(code, "unbekannt"), fehler.get("message", ""))
        return (antwort or {}).get("result")

    def __enter__(self):
        erg = self._ruf("authenticate", {"user": self.benutzer,
                                         "password": self.passwort, "client": "Nuvora"})
        if not isinstance(erg, dict) or not erg.get("sessionId"):
            raise UntisFehler("zugangsdaten", "Keine Sitzung erhalten")
        self.person_id = erg.get("personId")
        self.person_typ = erg.get("personType")
        if not self.person_id:
            # Angemeldet, aber ohne Person: typisch fuer Konten ohne
            # Lehrer-Zuordnung — ohne sie gibt es keinen eigenen Stundenplan.
            raise UntisFehler("kein_zugriff", "Konto ohne eigene Person")
        return self

    def __exit__(self, *a):
        try:
            self._ruf("logout")
        except Exception as e:
            # Das Abmelden darf den Abruf nicht kippen: die Daten sind zu
            # diesem Zeitpunkt geholt, und die Sitzung laeuft bei Untis ohnehin
            # von selbst ab. Vermerkt wird es trotzdem — ein Fehler, den
            # niemand je sieht, ist ein Fehler, den niemand behebt.
            _log.info("WebUntis-Abmeldung fehlgeschlagen: %s", e)
        return False

    # ─── Abfragen ───

    def stammdaten(self):
        """Faecher, Klassen und Raeume als {id: Kuerzel/Name}. Der Stundenplan
        nennt nur IDs; ohne diese Tabellen stuende in jeder Stunde eine Zahl."""
        def tabelle(methode):
            try:
                zeilen = self._ruf(methode) or []
            except UntisFehler:
                # Einzelne Stammdaten duerfen fehlen (manche Schulen geben nur
                # den Stundenplan frei). Dann steht dort spaeter nichts — das
                # ist besser als gar kein Import.
                return {}
            out = {}
            for z in zeilen:
                if isinstance(z, dict) and z.get("id"):
                    out[z["id"]] = (z.get("name") or z.get("longName") or "").strip()
            return out
        return {"faecher": tabelle("getSubjects"), "klassen": tabelle("getKlassen"),
                "raeume": tabelle("getRooms")}

    def stundenplan(self, von: date, bis: date):
        """Der eigene Stundenplan im Zeitraum, als Liste von `Stunde`-Dicts."""
        stamm = self.stammdaten()
        roh = self._ruf("getTimetable", {
            "id": self.person_id, "type": self.person_typ or 2,
            "startDate": int(von.strftime("%Y%m%d")), "endDate": int(bis.strftime("%Y%m%d")),
        }) or []
        return [_stunde_aus_api(z, stamm) for z in roh if isinstance(z, dict) and z.get("date")]

    def ferien(self):
        """Unterrichtsfreie Zeitraeume (Ferien, Feiertage)."""
        try:
            roh = self._ruf("getHolidays") or []
        except UntisFehler:
            return []
        out = []
        for h in roh:
            von, bis = _datum(h.get("startDate")), _datum(h.get("endDate"))
            if von and bis:
                out.append({"von": von.isoformat(), "bis": bis.isoformat(),
                            "name": (h.get("longName") or h.get("name") or "").strip()[:120]})
        return out


def _datum(zahl):
    """20260827 -> date(2026, 8, 27); alles Unlesbare -> None."""
    s = str(zahl or "")
    if len(s) != 8 or not s.isdigit():
        return None
    try:
        return date(int(s[:4]), int(s[4:6]), int(s[6:]))
    except ValueError:
        return None


def _zeit(zahl):
    """805 -> "08:05"; Untis zaehlt Uhrzeiten als HMM/HHMM ohne Doppelpunkt."""
    s = str(zahl or "").zfill(4)
    if len(s) != 4 or not s.isdigit() or int(s[:2]) > 23 or int(s[2:]) > 59:
        return ""
    return f"{s[:2]}:{s[2:]}"


def _stunde_aus_api(z: dict, stamm: dict) -> dict:
    """Eine Untis-Stunde in Nuvoras Form.

    `code` ist Untis' eigenes Kennzeichen: "cancelled" (faellt aus) oder
    "irregular" (Vertretung/Aenderung). Genau die zwei brauchen wir — eine
    ausgefallene Stunde wird bei uns zur SlotCancellation.
    """
    def namen(schluessel, tabelle):
        return [t for t in ((stamm.get(tabelle) or {}).get(x.get("id"), "")
                            for x in (z.get(schluessel) or []) if isinstance(x, dict)) if t]

    klassen = namen("kl", "klassen")
    faecher = namen("su", "faecher")
    raeume = namen("ro", "raeume")
    d = _datum(z.get("date"))
    titel = " ".join(x for x in [", ".join(faecher), ", ".join(klassen)] if x) or (z.get("lstext") or "").strip()
    return {
        "datum": d.isoformat() if d else "",
        "start": _zeit(z.get("startTime")), "ende": _zeit(z.get("endTime")),
        "titel": titel[:200], "klassen": klassen, "faecher": faecher,
        "raum": ", ".join(raeume)[:60],
        "faellt_aus": (z.get("code") or "") == "cancelled",
        "vertretung": (z.get("code") or "") == "irregular",
    }


# ─── Der andere Weg: ICS-Abo-Link ───

# Untis schreibt seine ICS-Zeiten haeufig in UTC ("20260907T060000Z"). Roh
# gelesen wird daraus 06:00, und die Zuordnung zur Stundennummer trifft die
# falsche Stunde oder gar keine — der Import blieb dann leer, ohne Fehler.
# Umgerechnet wird nach der Schulzeitzone; sie steht nirgends in Nuvora, deshalb
# Europe/Berlin als Vorgabe und `SCHOOL_TZ` fuer alle anderen.
SCHUL_ZEITZONE = os.environ.get("SCHOOL_TZ", "Europe/Berlin")


def _zeitpunkt(roh: str):
    """Ein ICS-DTSTART/DTEND zerlegen: ("YYYYMMDD", "HH:MM").

    Ohne Uhrzeit (reines Datum) ist der zweite Teil leer. Ein "Z" am Ende heisst
    UTC und wird umgerechnet; alles andere gilt als Ortszeit — genau wie im
    uebrigen Nuvora, das Tag und "HH:MM" ohne Zeitzone speichert.
    """
    roh = (roh or "").strip()
    if "T" not in roh or len(roh) < 15:
        return roh[:8], ""
    tag, zeit = roh[:8], roh[9:15]
    if not roh.endswith("Z"):
        return tag, zeit[:2] + ":" + zeit[2:4]
    try:
        from datetime import datetime as _dt, timezone as _tz
        from zoneinfo import ZoneInfo
        p = _dt.strptime(tag + zeit, "%Y%m%d%H%M%S").replace(tzinfo=_tz.utc)
        lokal = p.astimezone(ZoneInfo(SCHUL_ZEITZONE))
        return lokal.strftime("%Y%m%d"), lokal.strftime("%H:%M")
    except Exception:
        return tag, zeit[:2] + ":" + zeit[2:4]


def stunden_aus_ics(url: str, von: date, bis: date) -> list:
    """Denselben Stundenplan aus einem WebUntis-ICS-Abo lesen.

    Der Weg fuer alle Schulen, die den API-Zugang nicht freigeschaltet haben.
    Er liefert deutlich weniger: nur Betreff, Datum und Uhrzeit — keine
    getrennten Felder fuer Klasse, Fach und Raum, und **kein Kennzeichen fuer
    Ausfall oder Vertretung**. Untis traegt einen Ausfall dort meist gar nicht
    erst ein; die Stunde fehlt dann einfach. Daraus „faellt aus" zu schliessen
    waere geraten — deshalb setzt dieser Weg das Kennzeichen nie, und die
    Uebernahme von Ausfaellen bleibt dem API-Weg vorbehalten.
    """
    try:
        # Mit Weiterleitungen: der persoenliche Untis-Abo-Link antwortet je nach
        # Installation mit 302 auf die eigentliche Datei.
        text = hole_mit_umleitung(url.replace("webcal://", "https://", 1),
                                  timeout=10, max_bytes=4_000_000)
    except NetzFehler as e:
        raise UntisFehler("server", str(e))
    except Exception as e:
        raise UntisFehler("server", str(e))

    text = re.sub(r"\r?\n[ \t]", "", text)
    out, cur = [], None
    for zeile in text.split("\n"):
        zeile = zeile.rstrip("\r")
        if zeile == "BEGIN:VEVENT":
            cur = {}
        elif zeile == "END:VEVENT":
            if cur and cur.get("datum"):
                d = _datum(cur["datum"])
                if d and von <= d <= bis and cur.get("status") != "CANCELLED":
                    out.append({
                        "datum": d.isoformat(), "start": cur.get("start", ""), "ende": cur.get("ende", ""),
                        "titel": (cur.get("titel") or "")[:200], "klassen": [], "faecher": [],
                        "raum": (cur.get("raum") or "")[:60],
                        "faellt_aus": False, "vertretung": False,
                    })
            cur = None
        elif cur is not None and ":" in zeile:
            schluessel, wert = zeile.split(":", 1)
            k = schluessel.split(";", 1)[0].upper()
            roh = wert.strip()
            if k == "DTSTART":
                d0, t0 = _zeitpunkt(roh)
                cur["datum"] = d0 or roh[:8]
                if t0:
                    cur["start"] = t0
            elif k == "DTEND":
                _, t1 = _zeitpunkt(roh)
                if t1:
                    cur["ende"] = t1
            elif k == "SUMMARY":
                cur["titel"] = roh.replace("\\,", ",").replace(r"\;", ";").replace("\\n", " ")
            elif k == "LOCATION":
                cur["raum"] = roh.replace("\\,", ",").replace(r"\;", ";")
            elif k == "STATUS":
                cur["status"] = roh.upper()
    return out


# ─── Aus Tagen ein Wochenraster machen ───

def zu_wochenraster(stunden: list, zeiten: list) -> dict:
    """Aus den Tagen des Zeitraums den WIEDERKEHRENDEN Plan ableiten.

    Nuvoras Stundenplan ist ein Wochenraster (Wochentag x Stunde); Untis
    liefert einzelne Tage. Uebernommen wird deshalb, was sich wiederholt: je
    (Wochentag, Stunde) gewinnt der haeufigste Titel des Zeitraums. Eine
    einzelne Vertretung faerbt den Plan damit nicht ein — sie kommt einmal vor,
    der regulaere Unterricht zehnmal.

    `zeiten` ist Nuvoras eigenes Stundenraster (["08:00", "08:50", …]); die
    Untis-Uhrzeit wird auf die naechstliegende Stunde gelegt. Ohne diese
    Zuordnung waere „3. Stunde" bei uns und in Untis nicht dieselbe: viele
    Schulen zaehlen Pausen als eigene Einheit mit.

    Rueckgabe: {"(wochentag, stunde)": {"titel", "raum", "anzahl", "klassen"}}
    — Schluessel als Text, damit es sich unveraendert als JSON senden laesst.
    """
    zaehler = {}
    for s in stunden:
        if s.get("faellt_aus") or not s.get("titel"):
            continue
        try:
            d = date.fromisoformat(s["datum"])
        except (ValueError, KeyError):
            continue
        nr = _stunde_nr(s.get("start", ""), zeiten)
        if not nr:
            continue
        schluessel = f"{d.weekday()},{nr}"
        eintrag = zaehler.setdefault(schluessel, {})
        titel = s["titel"]
        treffer = eintrag.setdefault(titel, {"anzahl": 0, "raum": s.get("raum", ""),
                                             "klassen": s.get("klassen") or []})
        treffer["anzahl"] += 1

    out = {}
    for schluessel, titel_map in zaehler.items():
        titel, info = max(titel_map.items(), key=lambda kv: kv[1]["anzahl"])
        out[schluessel] = {"titel": titel, "raum": info["raum"],
                           "anzahl": info["anzahl"], "klassen": info["klassen"]}
    return out


def ausfaelle(stunden: list, zeiten: list) -> list:
    """Die einzelnen ausgefallenen Stunden — Datum und Stundennummer.

    Nur aus dem API-Weg; der ICS-Weg setzt `faellt_aus` nie (siehe dort).
    """
    out = []
    for s in stunden:
        if not s.get("faellt_aus"):
            continue
        nr = _stunde_nr(s.get("start", ""), zeiten)
        if nr:
            out.append({"datum": s["datum"], "stunde": nr, "titel": s.get("titel", "")})
    return out


def _stunde_nr(uhrzeit: str, zeiten: list):
    """Untis-Uhrzeit auf Nuvoras Stundennummer legen (1-basiert), sonst None."""
    if not uhrzeit or not zeiten:
        return None
    try:
        minuten = int(uhrzeit[:2]) * 60 + int(uhrzeit[3:5])
    except (ValueError, IndexError):
        return None
    beste, abstand = None, 10 ** 9
    for i, z in enumerate(zeiten):
        try:
            m = int(str(z)[:2]) * 60 + int(str(z)[3:5])
        except (ValueError, IndexError):
            continue
        if abs(m - minuten) < abstand:
            beste, abstand = i + 1, abs(m - minuten)
    return beste if abstand <= 30 else None
