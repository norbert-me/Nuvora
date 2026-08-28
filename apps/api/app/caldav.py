"""CalDAV — die Uebersetzung, ohne Router und ohne Datenbank.

Warum es das gibt: ein ICS-Abo ist einseitig. Apple und Outlook HOLEN die
Datei; einen „Termin hinzufuegen"-Knopf bieten sie darin gar nicht erst an.
Wer im Handykalender einen Termin anlegen und ihn in Nuvora wiederfinden will,
braucht CalDAV — dasselbe Protokoll, das iCloud und Nextcloud sprechen.

Dieses Modul ist ein Blatt: es baut und liest XML und ICS, kennt aber weder
FastAPI noch SQLAlchemy. Der Router (routers/caldav.py) setzt es zusammen. So
laesst sich die Uebersetzung testen, ohne einen Server zu starten — und genau
dort sitzen die Fehler, die man sonst erst am Handy sieht.

Was der schreibbare Kalender enthaelt: **nur die Kalender-Eintraege**. Freie
Zeitraeume und die wiederkehrenden Stundenplan-Stunden bleiben im ICS-Feed
(`/api/kalender/feed/…`), weil CalDAV kein „dieses eine Ereignis ist
schreibgeschuetzt" kennt: waeren sie hier drin, koennte ein Wisch im Handy eine
Stundenplan-Vorlage loeschen, die es als Ereignis gar nicht gibt. Zwei
Kalender im Handy sind ehrlicher als einer, der die Haelfte nur so tut.
"""
import hashlib
import re
from datetime import date, datetime, timedelta
from xml.sax.saxutils import escape as _xml_escape

# Namensraeume. Apple erwartet genau diese Praefixe nicht, aber genau diese
# URIs — der Praefix ist frei, der Namensraum nicht.
NS = {
    "D": "DAV:",
    "C": "urn:ietf:params:xml:ns:caldav",
    "CS": "http://calendarserver.org/ns/",
    "ICAL": "http://apple.com/ns/ical/",
}


class CaldavFehler(Exception):
    """Ein Fehlschlag mit HTTP-Status und optionaler Vorbedingung.

    `precondition` ist der CalDAV-Fehlername (z.B. "supported-calendar-data");
    Apple zeigt daraufhin eine eigene Meldung statt eines nackten 403.
    """

    def __init__(self, status: int, text: str = "", precondition: str = ""):
        super().__init__(text or str(status))
        self.status = status
        self.text = text
        self.precondition = precondition


# ─── XML lesen ───

def parse_xml(rumpf: bytes):
    """Einen Anfragekoerper als XML-Baum lesen — oder None bei leerem Koerper.

    Zwei Absicherungen, beide notwendig und beide billig:

    * **Groessengrenze.** Der Koerper kommt von einem fremden Programm; ein
      PROPFIND mit 50 MB waere sonst ein Weg, den Server zu fuellen.
    * **Kein DOCTYPE.** `xml.etree` loest zwar keine EXTERNEN Entitaeten auf,
      expandiert aber interne — die „Billion Laughs" ist damit erreichbar. Eine
      Dokumenttypdeklaration braucht in CalDAV niemand, also fliegt sie raus,
      statt sie zu entschaerfen.
    """
    if not rumpf or not rumpf.strip():
        return None
    if len(rumpf) > 512_000:
        raise CaldavFehler(413, "Anfrage zu gross")
    kopf = rumpf.lstrip()[:200].lower()
    if b"<!doctype" in kopf or b"<!entity" in kopf:
        raise CaldavFehler(400, "DOCTYPE nicht erlaubt")
    import xml.etree.ElementTree as ET
    try:
        return ET.fromstring(rumpf)
    except ET.ParseError:
        raise CaldavFehler(400, "XML unlesbar")


def lokal(tag: str) -> str:
    """"{DAV:}propfind" -> "propfind" — der Name ohne seinen Namensraum."""
    return tag.rsplit("}", 1)[-1]


def gefragte_props(baum) -> list:
    """Welche Eigenschaften ein PROPFIND wissen will — als (namensraum, name).

    Ein `<D:allprop/>` oder ein leerer Koerper heisst „alles, was du hast";
    dafuer steht `None` in der Rueckgabe statt einer Liste.
    """
    if baum is None:
        return None
    for kind in baum:
        if lokal(kind.tag) == "allprop":
            return None
    for kind in baum:
        if lokal(kind.tag) == "prop":
            return [(k.tag.split("}")[0].strip("{") if "}" in k.tag else "", lokal(k.tag)) for k in kind]
    return None


# Was ein Client am Kalender einstellen darf. Bewusst kurz: es ist reiner
# Anzeigekram (Farbe, Reihenfolge, Name). Alles andere wird mit 403 abgelehnt
# statt stillschweigend geschluckt — ein „gespeichert", das nichts speichert,
# faellt dem Nutzer erst beim naechsten Start auf.
SETZBAR = ("calendar-color", "calendar-order", "displayname", "calendar-description")


def proppatch_wuensche(baum):
    """Aus einem PROPPATCH die gewuenschten Aenderungen lesen.

    Rueckgabe: (setzen, loeschen) — `setzen` ist {name: text}, `loeschen` eine
    Liste von Namen. Der Namensraum ist dabei egal: `calendar-color` gibt es
    nur einmal, und Apple schickt es im eigenen (ICAL-)Namensraum.
    """
    setzen, loeschen = {}, []
    if baum is None:
        return setzen, loeschen
    for teil in baum:
        art = lokal(teil.tag)
        if art not in ("set", "remove"):
            continue
        for prop in teil:
            if lokal(prop.tag) != "prop":
                continue
            for feld in prop:
                name = lokal(feld.tag)
                if art == "set":
                    setzen[name] = (feld.text or "").strip()[:200]
                else:
                    loeschen.append(name)
    return setzen, loeschen


def zeitfenster(baum):
    """Das `<C:time-range>` einer calendar-query, als (von, bis) oder None.

    Apple fragt beim ersten Verbinden gern nur ein Jahr ab. Das Fenster zu
    ignorieren waere erlaubt (der Client filtert selbst), kostet aber bei jedem
    Abgleich die ganze Historie.
    """
    if baum is None:
        return None
    for el in baum.iter():
        if lokal(el.tag) == "time-range":
            return (_ics_datum(el.get("start")), _ics_datum(el.get("end")))
    return None


def multiget_hrefs(baum) -> list:
    if baum is None:
        return []
    return [(el.text or "").strip() for el in baum.iter() if lokal(el.tag) == "href" and el.text]


# ─── XML schreiben ───

def _xmlns() -> str:
    return " ".join(f'xmlns:{p}="{u}"' for p, u in NS.items())


def multistatus(antworten: list) -> str:
    """Ein 207-Dokument aus fertigen `<D:response>`-Stuecken."""
    inhalt = "".join(antworten)
    return f'<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus {_xmlns()}>{inhalt}</D:multistatus>'


def response(href: str, gefunden: dict, fehlend: list = ()) -> str:
    """Ein `<D:response>`: was gefunden wurde (200) und was nicht (404).

    Das 404-Stueck ist kein Schmuck: Apple prueft, ob eine Eigenschaft
    ausdruecklich fehlt, und fragt sie sonst bei jedem Abgleich erneut.
    """
    teile = []
    if gefunden:
        werte = "".join(gefunden.values())
        teile.append(f"<D:propstat><D:prop>{werte}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>")
    if fehlend:
        leer = "".join(f"<{n}/>" for n in fehlend)
        teile.append(f"<D:propstat><D:prop>{leer}</D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat>")
    return f"<D:response><D:href>{_xml_escape(href)}</D:href>{''.join(teile)}</D:response>"


def fehler_xml(precondition: str) -> str:
    return (f'<?xml version="1.0" encoding="utf-8"?>\n<D:error {_xmlns()}>'
            f"<C:{precondition}/></D:error>")


# ─── ICS lesen und schreiben ───

def _ics_escape(text: str) -> str:
    return (str(text or "").replace("\\", "\\\\").replace("\n", "\\n")
            .replace(",", "\\,").replace(";", "\\;"))


def _ics_unescape(text: str) -> str:
    out, i = [], 0
    s = str(text or "")
    while i < len(s):
        if s[i] == "\\" and i + 1 < len(s):
            n = s[i + 1]
            out.append({"n": "\n", "N": "\n"}.get(n, n))
            i += 2
        else:
            out.append(s[i])
            i += 1
    return "".join(out)


def _ics_datum(wert):
    """"20260827" oder "20260827T101500Z" -> date; alles andere -> None."""
    s = (wert or "").strip()
    if len(s) < 8 or not s[:8].isdigit():
        return None
    try:
        return date(int(s[:4]), int(s[4:6]), int(s[6:8]))
    except ValueError:
        return None


def _ics_zeit(wert):
    """Die Uhrzeit aus "20260827T101500" als "10:15" — oder "" bei Ganztags.

    **Zeitzonen werden bewusst NICHT umgerechnet.** Nuvora speichert einen
    Termin als Tag plus „HH:MM" — die Uhrzeit, die im Stundenplan steht. Eine
    Umrechnung in UTC und zurueck brauchte die Zeitzone der Schule, und die
    steht nirgends; ein Termin um 8 Uhr, der nach dem Speichern 7 Uhr heisst,
    waere schlimmer als gar keine Anbindung. Ein `Z` am Ende wird also als
    Ortszeit gelesen — bei Apple kommt es an Ganztags- und
    Stundenplan-Terminen ohnehin nicht vor.
    """
    s = (wert or "").strip()
    if "T" not in s or len(s) < 13:
        return ""
    hh, mm = s[9:11], s[11:13]
    if not (hh.isdigit() and mm.isdigit()) or int(hh) > 23 or int(mm) > 59:
        return ""
    return f"{hh}:{mm}"


_RRULE_FREQ = ("DAILY", "WEEKLY", "MONTHLY", "YEARLY")
_RRULE_TAGE = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")


def rrule_pruefen(roh: str) -> str:
    """Eine Wiederholregel auf das eindampfen, was Nuvora wirklich aufzaehlt.

    Unbekannte Teile fliegen **raus**, statt mitgespeichert zu werden: eine
    Regel, die keiner rechnet (BYSETPOS, WKST, BYMONTHDAY …), waere eine Serie,
    die es nur in der Datenbank gibt — im Kalender fehlte sie, und niemand
    saehe, warum. Rueckgabe ist die normalisierte Regel oder "" (= einmalig).
    """
    teile = {}
    for kv in (roh or "").strip().upper().split(";"):
        if "=" in kv:
            k, v = kv.split("=", 1)
            teile[k.strip()] = v.strip()
    freq = teile.get("FREQ", "")
    if freq not in _RRULE_FREQ:
        return ""
    out = [f"FREQ={freq}"]
    try:
        iv = int(teile.get("INTERVAL", "1"))
    except ValueError:
        iv = 1
    if iv > 1:
        out.append(f"INTERVAL={min(iv, 52)}")
    if freq == "WEEKLY":
        tage = [d for d in teile.get("BYDAY", "").split(",") if d in _RRULE_TAGE]
        if tage:
            out.append("BYDAY=" + ",".join(sorted(set(tage), key=_RRULE_TAGE.index)))
    # COUNT und UNTIL schliessen einander aus (RFC 5545). Kommt beides an,
    # gewinnt UNTIL — ein Enddatum ist die Angabe, die der Nutzer wirklich
    # gemacht hat; COUNT setzt Apple gern zusaetzlich dazu.
    u = teile.get("UNTIL", "")[:8]
    if len(u) == 8 and u.isdigit():
        out.append(f"UNTIL={u}")
    elif teile.get("COUNT", "").isdigit():
        out.append(f"COUNT={min(int(teile['COUNT']), 400)}")
    return ";".join(out)


def parse_vevent(text: str) -> dict:
    """Ein hochgeladenes .ics lesen und auf Nuvoras Felder abbilden.

    **Wiederholungen** werden uebernommen, soweit Nuvora sie aufzaehlen kann
    (`rrule_pruefen`): FREQ taeglich/woechentlich/monatlich/jaehrlich mit
    INTERVAL, BYDAY, COUNT/UNTIL, dazu EXDATE fuer geloeschte Einzeltermine.
    Was darueber hinausgeht, wird **abgelehnt** statt gekuerzt — eine Serie
    stillschweigend auf ihren ersten Termin zu kuerzen hiesse, dass jemand im
    Handy „jeden Montag" eintraegt und in Nuvora einen einzigen Montag
    vorfindet; der Datenverlust faellt erst Wochen spaeter auf.

    Ebenfalls abgelehnt:

    * **Aufgaben (VTODO) und alles andere ausser VEVENT.** Der Kalender sagt in
      seinen Eigenschaften, dass er nur VEVENT fuehrt.
    * **Mehrtaegige Termine.** Auch die gibt es bei uns nicht; ein Eintrag
      gehoert zu einem Tag.
    """
    if len(text or "") > 200_000:
        raise CaldavFehler(413, "Termin zu gross")
    roh = re.sub(r"\r?\n[ \t]", "", text or "")
    if "BEGIN:VTODO" in roh or "BEGIN:VJOURNAL" in roh:
        raise CaldavFehler(403, "Nur Termine", "supported-calendar-component")

    felder, drin, exdates = {}, False, []
    for zeile in roh.split("\n"):
        zeile = zeile.rstrip("\r")
        if zeile.startswith("BEGIN:VEVENT"):
            drin = True
            continue
        if zeile.startswith("END:VEVENT"):
            break
        if not drin or ":" not in zeile:
            continue
        name, wert = zeile.split(":", 1)
        schluessel = name.split(";", 1)[0].upper()
        if schluessel == "EXDATE":
            # EXDATE steht mehrfach im VEVENT — je geloeschtem Einzeltermin eine
            # Zeile. `setdefault` behielte nur den ersten, und alle anderen
            # geloeschten Termine waeren beim naechsten Abgleich wieder da.
            exdates += [p.strip()[:8] for p in wert.split(",") if p.strip()[:8].isdigit()]
            continue
        felder.setdefault(schluessel, (name, wert.strip()))

    if not felder.get("DTSTART"):
        raise CaldavFehler(400, "Termin ohne Anfang")
    roh_regel = felder.get("RRULE", (None, ""))[1]
    regel = rrule_pruefen(roh_regel)
    if roh_regel and not regel:
        raise CaldavFehler(403, "Diese Wiederholung wird nicht unterstuetzt", "supported-calendar-data")

    _, start = felder["DTSTART"]
    tag = _ics_datum(start)
    if not tag:
        raise CaldavFehler(400, "Anfang unlesbar")
    ende_name, ende = felder.get("DTEND", (None, ""))
    ende_tag = _ics_datum(ende)
    ganztags = "T" not in start
    if ganztags and ende_tag and ende_tag > tag + timedelta(days=1):
        raise CaldavFehler(403, "Mehrtaegige Termine werden nicht unterstuetzt", "supported-calendar-data")
    if not ganztags and ende_tag and ende_tag != tag:
        raise CaldavFehler(403, "Termine ueber Mitternacht werden nicht unterstuetzt", "supported-calendar-data")

    return {
        "uid": _ics_unescape(felder.get("UID", (None, ""))[1])[:200],
        "datum": tag,
        "start_time": _ics_zeit(start),
        "end_time": _ics_zeit(ende) if ende else "",
        "title": _ics_unescape(felder.get("SUMMARY", (None, ""))[1])[:200],
        "notes": _ics_unescape(felder.get("DESCRIPTION", (None, ""))[1])[:5000],
        "location": _ics_unescape(felder.get("LOCATION", (None, ""))[1])[:200],
        "rrule": regel,
        "exdate": sorted(set(exdates))[:400] if regel else [],
    }


def baue_vevent(*, uid: str, tag, titel: str, notiz: str = "", ort: str = "",
                rrule: str = "", exdate=None,
                start_time: str = "", end_time: str = "", stand=None) -> str:
    """Einen Eintrag als vollstaendiges VCALENDAR ausgeben (eine Ressource)."""
    def d8(d):
        return d.strftime("%Y%m%d")

    def hm(s):
        teile = (s or "").split(":")
        if len(teile) == 2 and teile[0].isdigit() and teile[1].isdigit():
            return f"{int(teile[0]):02d}{int(teile[1]):02d}00"
        return None

    a, b = hm(start_time), hm(end_time)
    if a and b:
        # Getaktet: Ende ist ein Zeitpunkt am selben Tag — hier waere ein
        # "+1 Tag" der Fehler, der den Termin ueber Nacht zoege.
        zeit = [f"DTSTART:{d8(tag)}T{a}", f"DTEND:{d8(tag)}T{b}"]
    else:
        # Ganztaegig: DTEND ist EXKLUSIV, also der Folgetag (RFC 5545). Genau
        # ein "+1" — keins macht den Termin null Tage lang, zwei ziehen ihn
        # ueber zwei Tage.
        zeit = [f"DTSTART;VALUE=DATE:{d8(tag)}", f"DTEND;VALUE=DATE:{d8(tag + timedelta(days=1))}"]

    stempel = (stand or datetime.utcnow()).strftime("%Y%m%dT%H%M%SZ")
    zeilen = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Nuvora//Kalender//DE",
              "CALSCALE:GREGORIAN", "BEGIN:VEVENT", f"UID:{_ics_escape(uid)}",
              f"DTSTAMP:{stempel}", f"LAST-MODIFIED:{stempel}", *zeit,
              f"SUMMARY:{_ics_escape(titel or 'Termin')}"]
    if rrule:
        zeilen.append(f"RRULE:{rrule}")
        if exdate:
            # Die Form von EXDATE muss zu DTSTART passen: bei einem getakteten
            # Termin ein Zeitpunkt, bei einem Ganztags-Termin ein Datum. Passt
            # sie nicht, ignoriert Apple die Zeile — und der geloeschte
            # Einzeltermin steht am Geraet wieder da.
            if a and b:
                zeilen.append("EXDATE:" + ",".join(f"{d}T{a}" for d in exdate))
            else:
                zeilen.append("EXDATE;VALUE=DATE:" + ",".join(exdate))
    if ort:
        zeilen.append(f"LOCATION:{_ics_escape(ort)}")
    if notiz:
        zeilen.append(f"DESCRIPTION:{_ics_escape(notiz)}")
    zeilen += ["END:VEVENT", "END:VCALENDAR"]
    return "\r\n".join(falte(z) for z in zeilen) + "\r\n"


def falte(zeile: str) -> str:
    """RFC 5545: keine Zeile ueber 75 Oktett. Strenge Leser brechen sonst ab."""
    roh = zeile.encode("utf-8")
    if len(roh) <= 75:
        return zeile
    teile, rest = [], roh
    while len(rest) > 75:
        schnitt = 75
        # Nicht mitten in ein Mehrbyte-Zeichen schneiden.
        while schnitt > 1 and (rest[schnitt] & 0xC0) == 0x80:
            schnitt -= 1
        teile.append(rest[:schnitt].decode("utf-8"))
        rest = rest[schnitt:]
    teile.append(rest.decode("utf-8"))
    return "\r\n ".join(teile)


def etag(text: str) -> str:
    """Die Version einer Ressource — aus ihrem Inhalt, nicht aus einem Zaehler.

    Ein Zaehler muesste von jedem Schreibweg gepflegt werden (auch von denen in
    der Weboberflaeche), und einer wird immer vergessen. Aus dem Inhalt
    gerechnet stimmt er immer.
    """
    return '"' + hashlib.sha256(text.encode("utf-8")).hexdigest()[:32] + '"'


def ctag(etags) -> str:
    """Die Version der ganzen Sammlung. Aendert sich genau dann, wenn sich
    irgendein Termin geaendert hat — daran erkennt der Client, ob ein Abgleich
    ueberhaupt noetig ist."""
    h = hashlib.sha256()
    for e in sorted(etags):
        h.update(e.encode("utf-8"))
    return "nuvora-" + h.hexdigest()[:32]
