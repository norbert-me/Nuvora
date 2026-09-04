"""CalDAV-Server: den Kalender aus Apple und Outlook BESCHREIBEN.

Der Unterschied zum ICS-Abo (`/api/kalender/feed/…`) ist keine Feinheit,
sondern die ganze Sache: ein Abo wird geholt: der Client liest eine Datei und
bietet gar keinen „Termin hinzufuegen"-Knopf an. CalDAV ist dasselbe
Protokoll, das iCloud und Nextcloud sprechen — damit legt das Handy Termine an,
aendert und loescht sie, und sie stehen in Nuvora.

**Was in diesem Kalender liegt: nur die Kalender-Eintraege.** Freie Zeitraeume
und die wiederkehrenden Stundenplan-Stunden bleiben im ICS-Feed. CalDAV kennt
kein „dieses eine Ereignis ist schreibgeschuetzt"; waeren sie hier drin,
loeschte ein Wisch im Handy eine Stundenplan-Vorlage, die es als Ereignis gar
nicht gibt. Zwei Kalender im Handy sind ehrlicher als einer, der die Haelfte
nur so tut.

**Angemeldet wird mit einem Geraete-Passwort**, nie mit dem Kontopasswort:
Apple speichert die Zugangsdaten dauerhaft und schickt sie alle paar Minuten
mit, jahrelang, auf einem Geraet, das verloren gehen kann. Die Passwoerter
stehen in `caldav_tokens` und lassen sich einzeln zuruecknehmen.

**Der Zugang stirbt mit dem Modul.** Wie jeder ausgeteilte Zugang (QR-Code,
Sitzungscode) wird bei JEDEM Aufruf geprueft, ob das Modul Kalender noch an
ist — ein Geraet laesst sich nicht einsammeln.

Warum unter `/api/`: der Proxy leitet genau `/api/` und `/ws/` an die API,
alles andere an die Weboberflaeche. Apple sucht zuerst unter
`/.well-known/caldav`; dafuer steht in `nginx.conf` eine Weiterleitung hierher.
"""
import base64
import logging
import secrets
import time as _time
import uuid as _uuid
from collections import deque
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import PlainTextResponse as _Text
from pydantic import BaseModel
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from .. import caldav as X
from ..database import get_db
from ..models import (CaldavToken, CalendarEntry, Kurs, SchoolClass,
                      SlotCancellation, TimetableSlot, User)
from ..zeit import tagesbeginn
from .auth import _hash_pw, _verify_pw, rate_limit
from .kalender import (_d_iso, _kurs_label, ext_dateiname, ext_uid,
                       externe_ereignisse, stundenplan_vorkommen)
from .modules import is_active, modul_pflicht

router = APIRouter(prefix="/api/caldav", tags=["caldav"])

MODULE_KEY = "kalender"
# Wie das Sammelverzeichnis im Client heisst.
KALENDER_NAME = "Nuvora"
# Der eine Kalender je Konto. Ein zweiter Name waere ein zweiter Kalender, und
# den gibt es hier bewusst nicht.
KALENDER = "kalender"

_DAV_KOPF = {
    # Ohne diese Kopfzeile haelt Apple den Server nicht fuer einen Kalender.
    "DAV": "1, 2, 3, calendar-access",
    "Cache-Control": "no-store",
}


def user_props(u: User) -> dict:
    """Die Anzeige-Eigenschaften, die ein Client am Kalender gesetzt hat."""
    return u.caldav_props if isinstance(u.caldav_props, dict) else {}


def _pfad(user_id: int, name: str = "") -> str:
    basis = f"/api/caldav/p/{user_id}/{KALENDER}/"
    return basis + name if name else basis


# ─── Protokoll: was das Geraet wirklich versucht hat ───
#
# Wenn der Kalender im Handy nicht auftaucht, sagt Apple „Accountname oder
# Passwort konnte nicht ueberprueft werden" — egal, woran es lag. Die
# Wahrheit steht nur an einer Stelle: hier, beim Server, der die Anfrage
# entweder bekommen hat oder nicht.
#
# Frueher stand an dieser Stelle ein Knopf „Verbindung pruefen", der aus dem
# Browser eine CalDAV-Anfrage nachstellte. Der hat ein Problem, das er nicht
# loesen kann: er prueft, was der BROWSER erlebt — mit dessen Adresse, dessen
# Anmeldung, dessen Proxy. Das Geraet, um das es geht, kommt darin nicht vor.
# Ein gruener Haken hiess also nicht, dass das iPhone durchkommt, und ein roter
# nicht, dass es das nicht tut. Das Protokoll beantwortet dieselbe Frage
# ehrlich: es zeigt, was tatsaechlich ankam.
#
# **Steht hier nichts, ist das der Befund** — dann hat der Server noch keine
# einzige Anfrage gesehen, und es liegt an der Adresse oder am vorgeschalteten
# Proxy (der PROPFIND durchlassen muss), nicht an Nuvora.
#
# Im Arbeitsspeicher, nicht in der Datenbank: es ist eine Diagnose fuer die
# naechste halbe Stunde, kein Inhalt. Nach einem Neustart ist es leer, und das
# ist richtig so — ein Protokoll, das Wochen haelt, ist eine Datensammlung.
_log = logging.getLogger("nuvora.caldav")
_PROTOKOLL: dict[str, deque] = {}
_PROTOKOLL_MAX = 25
_PROTOKOLL_KONTEN = 200


def _pfad_maske(pfad: str) -> str:
    """IDs und Dateinamen aus dem Pfad nehmen.

    Dieselbe Regel wie im Fehlerprotokoll der Oberflaeche: ein Protokoll darf
    sagen, WAS versucht wurde, nicht, welcher Termin dahintersteckt — der
    Dateiname traegt die UID des Clients.
    """
    teile = []
    for stueck in (pfad or "").split("/"):
        if stueck.isdigit():
            teile.append("{id}")
        elif stueck.endswith(".ics"):
            teile.append("{termin}.ics")
        else:
            teile.append(stueck)
    return "/".join(teile)


def notiere(kennung: str, request: Request, status: int, grund: str) -> None:
    """Einen Zugriff festhalten — und ihn ins Serverprotokoll schreiben.

    Zwei Leser, ein Vorgang: die Lehrkraft sieht ihn im Teilen-Dialog, die
    Administration in `docker compose logs api`. Ohne die zweite Haelfte
    muesste sich jemand mit einem kaputten Zugang erst anmelden koennen, um zu
    sehen, warum er sich nicht anmelden kann.
    """
    schluessel = (kennung or "").strip().lower()[:120]
    if not schluessel:
        return
    if schluessel not in _PROTOKOLL and len(_PROTOKOLL) >= _PROTOKOLL_KONTEN:
        # Notbremse gegen Zumuellen mit erfundenen Benutzernamen: der aelteste
        # Eimer fliegt raus. Ohne die waere das Protokoll ein Weg, den Speicher
        # des Servers von aussen zu fuellen.
        _PROTOKOLL.pop(next(iter(_PROTOKOLL)), None)
    eimer = _PROTOKOLL.setdefault(schluessel, deque(maxlen=_PROTOKOLL_MAX))
    eintrag = {
        "zeit": datetime.now(timezone.utc).isoformat(),
        "methode": request.method,
        "pfad": _pfad_maske(request.url.path),
        "status": status,
        "grund": grund,
        # Woran man ein Geraet wiedererkennt, ohne es zu benennen: Apple und
        # Outlook stellen sich hier vor. Gekuerzt, weil manche Clients eine
        # halbe Zeile schicken.
        "geraet": (request.headers.get("user-agent") or "")[:80],
    }
    eimer.append(eintrag)
    _log.info("caldav %s %s -> %s (%s) fuer %s", eintrag["methode"], eintrag["pfad"],
              status, grund, schluessel)


def _kennung_aus(request: Request) -> str:
    """Der Benutzername aus der Basic-Kopfzeile — auch wenn die Anmeldung
    scheitert. Genau dann wird er gebraucht: ein Tippfehler im Benutzernamen
    ist der haeufigste Grund, und ohne ihn stuende der Versuch nirgends."""
    kopf = request.headers.get("authorization", "")
    if not kopf.lower().startswith("basic "):
        return ""
    try:
        roh = base64.b64decode(kopf[6:].strip()).decode("utf-8", "replace")
    except Exception:
        return ""
    return roh.split(":", 1)[0] if ":" in roh else ""


# ─── Anmeldung ───

class _Unangemeldet(Exception):
    """Mit Grund. Der Grund ist der ganze Zweck: „401" beantwortet nicht die
    Frage, warum das iPad seit gestern nichts mehr abgleicht."""

    def __init__(self, grund: str = "keine Anmeldung mitgeschickt"):
        super().__init__(grund)
        self.grund = grund


async def _anmelden(request: Request, db: AsyncSession) -> User:
    """HTTP-Basic mit einem Geraete-Passwort.

    Basic ist hier kein Rueckschritt: CalDAV-Clients koennen nichts anderes,
    und die Verbindung laeuft ueber TLS. Der Schutz liegt darin, dass das
    Passwort NICHT das Kontopasswort ist und einzeln zurueckgenommen werden
    kann.
    """
    kopf = request.headers.get("authorization", "")
    if not kopf.lower().startswith("basic "):
        # Der Normalfall beim ERSTEN Schritt: auch Apple fragt zuerst ohne
        # Anmeldung und meldet sich erst nach der Aufforderung an.
        raise _Unangemeldet("ohne Anmeldung angefragt")
    try:
        roh = base64.b64decode(kopf[6:].strip()).decode("utf-8", "replace")
    except Exception:
        raise _Unangemeldet("Anmeldekopf unlesbar")
    if ":" not in roh:
        raise _Unangemeldet("Anmeldekopf unvollstaendig")
    kennung, passwort = roh.split(":", 1)

    # Bremse gegen Durchprobieren: ein CalDAV-Client meldet sich oft an, aber
    # nicht hundertmal in der Minute mit wechselnden Passwoertern.
    rate_limit("caldav", f"n{kennung.lower()[:80]}", 60, 60, "Zu viele Anmeldungen.")

    u = (await db.execute(select(User).where(User.email == kennung.strip().lower()))).scalar_one_or_none()
    if not u:
        raise _Unangemeldet("Benutzername unbekannt")
    marken = (await db.execute(select(CaldavToken).where(CaldavToken.owner_id == u.id))).scalars().all()
    for m in marken:
        if _verify_pw(passwort, m.token_hash):
            m.last_used_at = datetime.now(timezone.utc)
            await db.commit()
            return u
    raise _Unangemeldet("Geraete-Passwort stimmt nicht"
                        if marken else "fuer dieses Konto gibt es kein Geraete-Passwort")


def _fordere_anmeldung() -> Response:
    return Response(status_code=401, headers={
        "WWW-Authenticate": f'Basic realm="{KALENDER_NAME}", charset="UTF-8"', **_DAV_KOPF})


async def _zugang(request: Request, db: AsyncSession):
    """(User, None) bei Erfolg, sonst (None, fertige Antwort).

    Jeder Ausgang wird protokolliert — auch der erfolgreiche. „Seit heute
    frueh kommt nichts mehr an" ist eine Antwort, die man nur bekommt, wenn
    auch das Gelungene dasteht.
    """
    try:
        u = await _anmelden(request, db)
    except _Unangemeldet as e:
        notiere(_kennung_aus(request), request, 401, e.grund)
        return None, _fordere_anmeldung()
    if not await is_active(db, u.id, MODULE_KEY):
        # Dieselbe Regel wie bei jedem ausgeteilten Zugang: ein Geraet laesst
        # sich nicht einsammeln, also entscheidet der Server bei jedem Aufruf.
        notiere(u.email, request, 403, "Modul Kalender ist abgeschaltet")
        return None, Response(status_code=403, headers=_DAV_KOPF)
    # 200 heisst hier „die Anmeldung steht" — was die Anfrage danach ergibt,
    # steht gegebenenfalls als eigener Eintrag daneben.
    notiere(u.email, request, 200, "angemeldet")
    return u, None


# ─── Eintraege <-> Ressourcen ───

def _uid(e: CalendarEntry) -> str:
    """Die UID einer Ressource: die des Clients, sonst eine aus der ID."""
    return e.caldav_uid or f"nuvora-entry-{e.id}@nuvora"


def _dateiname(e: CalendarEntry) -> str:
    # Die UID kann alles Moegliche enthalten; im Pfad steht deshalb eine
    # entschaerfte Fassung. Eindeutig bleibt sie durch die angehaengte ID.
    sicher = "".join(c if c.isalnum() or c in "-_." else "-" for c in _uid(e))[:80]
    return f"{sicher}-{e.id}.ics"


async def _beschriftung(db: AsyncSession, user: User):
    """Eine Funktion, die einem Eintrag seinen Titel im fremden Kalender gibt.

    Der ist IMMER „Fach · Kursname", wenn ein Kurs am Eintrag haengt — im Handy
    steht der Termin zwischen Arztterminen, und „Station 3" beantwortet dort
    nicht die Frage, die man an einen Kalender stellt. Was die Lehrkraft
    geschrieben hat, geht nicht verloren: es wandert in die Beschreibung.
    Dieselbe Regel wie im ICS-Feed (`_kurs_label`) — zwei Fassungen hiessen,
    dass derselbe Termin im abonnierten Kalender anders heisst als im
    geschriebenen.
    """
    kurse = {k.id: k for k in (await db.execute(select(Kurs).where(
        Kurs.owner_id == user.id, Kurs.deleted_at.is_(None)))).scalars().all()}
    klassen = {c.id: c for c in (await db.execute(select(SchoolClass).where(
        SchoolClass.owner_id == user.id))).scalars().all()}

    def label(e: CalendarEntry) -> str:
        k = kurse.get(e.kurs_id) or kurse.get(getattr(klassen.get(e.class_id), "kurs_id", None))
        return (_kurs_label(k) or e.title
                or getattr(klassen.get(e.class_id), "name", "") or "Termin")
    return label


async def _texte(db: AsyncSession, user: User, eintraege) -> dict:
    """Je Eintrag das fertige .ics — mit derselben Beschriftung wie ueberall
    („Fach · Kursname"), damit der Termin im Handy nicht anders heisst als im
    Browser."""
    label = await _beschriftung(db, user)

    # Uhrzeiten des Stundenrasters: ein Eintrag ohne eigene Uhrzeit gehoert zu
    # einer STUNDE, und die hat eine. Ohne diesen Rueckgriff wurde aus jedem
    # Termin, den man aus dem Stundenplan angelegt hat, im Handy ein
    # Tagestermin — waehrend derselbe Termin im Abo-Feed korrekt getaktet
    # ankam, weil der Feed genau diesen Rueckgriff schon macht.
    zeiten = user.timetable_times if isinstance(user.timetable_times, list) else []

    def _stundenzeit(e):
        if e.start_time and e.end_time:
            return e.start_time, e.end_time
        if e.period is not None:
            return X.stundenzeit(zeiten, user.timetable_zero, e.period)
        return "", ""

    out = {}
    for e in eintraege:
        titel = label(e)
        # Der eigene Titel geht nicht verloren, weil der Kurs die Ueberschrift
        # stellt — er steht ueber den Notizen in der Beschreibung.
        notiz = "\n".join(x for x in ((e.title if e.title != titel else ""), e.notes or "") if x)
        tag = e.date.date() if hasattr(e.date, "date") else e.date
        von, bis = _stundenzeit(e)
        ende = e.end_date.date() if hasattr(e.end_date, "date") else e.end_date
        out[e.id] = X.baue_vevent(uid=_uid(e), tag=tag, titel=titel, notiz=notiz,
                                  ort=e.location or "", rrule=e.rrule or "",
                                  exdate=list(e.exdate or []), ende_tag=ende,
                                  start_time=von, end_time=bis, stand=e.created_at)
    return out


# Wie weit der Kalender im Handy reicht, wenn der Client kein Fenster nennt.
# Dieselbe Spanne wie im ICS-Feed — zwei verschiedene Zeitraeume waeren zwei
# verschiedene Kalender.
VOR_TAGEN, VORAUS_TAGEN = 30, 121


def _slot_name(slot, tag) -> str:
    """Dateiname einer Stundenplan-Stunde an einem Tag."""
    return f"slot-{slot.id}-{tag.strftime('%Y%m%d')}.ics"


def _slot_lesen(name: str):
    """Aus dem Dateinamen (Slot-ID, Tag) — oder None, wenn es keiner ist."""
    teile = (name or "").removesuffix(".ics").split("-")
    if len(teile) != 3 or teile[0] != "slot" or not teile[1].isdigit():
        return None
    tag = X._ics_datum(teile[2])
    return (int(teile[1]), tag) if tag else None


async def _ressourcen(db: AsyncSession, u: User, fenster=None) -> list:
    """Alles, was im Kalender des Handys liegt — als [{name, text}].

    ZWEI Sorten, und die zweite ist der Grund, warum der Kalender im Handy
    ueberhaupt brauchbar ist: die einzeln angelegten Eintraege UND die
    wiederkehrenden Stundenplan-Stunden. Ohne die zweite stand im Handy nur,
    was jemand von Hand angefasst hatte — der normale Unterricht fehlte, und
    das ist der groesste Teil des Tages.

    Welche Stunden an einem Tag wirklich anfallen, entscheidet
    `stundenplan_vorkommen` in kalender.py — dieselbe Funktion wie im ICS-Feed.
    """
    eintraege = await _alle(db, u, fenster)
    texte = await _texte(db, u, eintraege)
    out = [{"name": _dateiname(e), "text": texte[e.id]} for e in eintraege]

    heute = date.today()
    von = (fenster[0] if fenster and fenster[0] else heute - timedelta(days=VOR_TAGEN))
    bis = (fenster[1] if fenster and fenster[1] else heute + timedelta(days=VORAUS_TAGEN))
    for v in await stundenplan_vorkommen(db, u, von, bis):
        tag = v["tag"]
        out.append({"name": _slot_name(v["slot"], tag), "text": X.baue_vevent(
            uid=f"nuvora-slot-{v['slot'].id}-{tag.strftime('%Y%m%d')}-t@nuvora",
            tag=tag, titel=v["titel"], ort=v.get("raum") or "",
            start_time=v["start"], end_time=v["ende"],
            # Fester Zeitstempel statt „jetzt": das ETag entsteht aus dem
            # Inhalt, und ein wanderndes DTSTAMP liesse es bei jedem Abruf
            # anders ausfallen. Der Client hielte dann jede Stunde fuer
            # geaendert und liefe in einen Dauerabgleich.
            stand=datetime(tag.year, tag.month, tag.day))})

    # DRITTE Sorte, nur auf Wunsch (users.feed_external): die Termine der
    # abonnierten fremden Kalender. Aus, weil sie sonst auf einem Handy, das
    # dieselben Kalender selbst abonniert hat, doppelt stehen.
    #
    # Sie sind hier READ-ONLY, und zwar mit Absicht: geaendert wird ein fremder
    # Termin dort, wo er herkommt (PUT gibt 403). Was das Handy hier loeschen
    # kann, ist keine Loeschung, sondern ein AUSBLENDEN in Nuvora — dieselbe
    # Bedeutung wie beim Wegwischen einer Stundenplan-Stunde, die als Datensatz
    # ebenfalls nicht existiert.
    for ev in await _externe(u):
        tag = _d_iso(ev["date"])
        if not tag or (von and tag < von) or (bis and tag > bis):
            continue
        out.append({"name": ext_dateiname(ev["key"]), "text": X.baue_vevent(
            uid=ext_uid(ev["key"]), tag=tag, titel=ev.get("title") or "Termin",
            ort=ev.get("location") or "",
            start_time=ev.get("time") or "", end_time=ev.get("endtime") or "",
            # Wie bei den Stunden ein fester Zeitstempel: ein wanderndes
            # DTSTAMP aenderte das ETag bei jedem Abruf und triebe den Client
            # in einen Dauerabgleich.
            stand=datetime(tag.year, tag.month, tag.day))})
    return out


async def _externe(u: User) -> list:
    """Die SICHTBAREN fremden Termine — leer, solange der Schalter aus ist."""
    if not u.feed_external:
        return []
    return [e for e in await externe_ereignisse(u) if not e["hidden"]]


def _externer_schluessel(name: str, rows) -> str:
    """Zu einem Dateinamen den Ereignis-Schluessel — oder "".

    Rueckwaerts gerechnet statt gespeichert: der Name ist der Hash des
    Schluessels, und die Liste der Ereignisse liegt ohnehin vor.
    """
    for ev in rows:
        if ext_dateiname(ev["key"]) == name:
            return ev["key"]
    return ""


async def _alle(db: AsyncSession, u: User, fenster=None):
    q = select(CalendarEntry).where(CalendarEntry.owner_id == u.id)
    if fenster and fenster[0]:
        # Serien bleiben immer dabei: ihr Kopf liegt am ERSTEN Termin und damit
        # fast immer vor dem Fenster. Filterte man ihn weg, waere eine seit
        # September laufende AG im Maerz aus dem Handykalender verschwunden —
        # und beim naechsten Abgleich als geloescht gemeldet.
        q = q.where(or_(CalendarEntry.date >= tagesbeginn(fenster[0]), CalendarEntry.rrule != ""))
    if fenster and fenster[1]:
        q = q.where(CalendarEntry.date < tagesbeginn(fenster[1]))
    return (await db.execute(q.order_by(CalendarEntry.date))).scalars().all()


# ─── Eigenschaften ───

def _props(u: User, *, art: str, href: str, etag_wert: str = "",
           ctag_wert: str = "", gefragt=None) -> str:
    """Die Antwort auf ein PROPFIND fuer EINE Ressource.

    `art` ist einer von vier Werten, und der Unterschied ist nicht kosmetisch —
    Apple prueft beim Anmelden genau daran, ob es einen Kalenderserver vor sich
    hat:

    * "wurzel"    — nur ein Verzeichnis. Es sagt, wo der Principal liegt.
    * "principal" — WER angemeldet ist. Muss `<D:principal/>` im resourcetype
      tragen; ein Principal, der sich als Kalender ausgibt, laesst die
      Kontoeinrichtung mit „Accountname/Passwort konnte nicht ueberprueft
      werden" abbrechen — Apple sucht dort einen Principal und findet keinen.
      Er ist zugleich das calendar-home (so macht es auch Radicale): die
      Sammlung, in der die Kalender liegen.
    * "kalender"  — DER Kalender. Nur er traegt `<C:calendar/>`.
    * "datei"     — ein einzelner Termin.
    """
    ich = f"/api/caldav/p/{u.id}/"
    alle = {
        "current-user-principal": f"<D:current-user-principal><D:href>{ich}</D:href></D:current-user-principal>",
    }
    if art == "wurzel":
        alle["resourcetype"] = "<D:resourcetype><D:collection/></D:resourcetype>"
        alle["displayname"] = f"<D:displayname>{KALENDER_NAME}</D:displayname>"
    elif art == "principal":
        # `<D:principal/>` ist der Punkt, an dem Apple erkennt, dass die
        # Anmeldung geglueckt ist. `<C:calendar/>` darf hier NICHT stehen —
        # sonst haelt der Client die Sammlung selbst fuer einen Kalender und
        # legt sie neben dem echten noch einmal an.
        alle["resourcetype"] = "<D:resourcetype><D:collection/><D:principal/></D:resourcetype>"
        alle["displayname"] = f"<D:displayname>{_xml(u.name or KALENDER_NAME)}</D:displayname>"
        alle["principal-URL"] = f"<D:principal-URL><D:href>{ich}</D:href></D:principal-URL>"
        # Wo Principals ueberhaupt liegen. Apple fragt das beim Einrichten ab;
        # fehlt es, gilt der Server manchen Fassungen als unvollstaendig.
        alle["principal-collection-set"] = "<D:principal-collection-set><D:href>/api/caldav/</D:href></D:principal-collection-set>"
        alle["calendar-home-set"] = f"<C:calendar-home-set><D:href>{ich}</D:href></C:calendar-home-set>"
        # Leer, aber vorhanden: fehlt sie ganz, fragt Apple sie bei jedem
        # Abgleich erneut ab. Eine E-Mail-Adresse gehoert nicht hinein — dieser
        # Kalender laedt niemanden ein.
        alle["calendar-user-address-set"] = "<C:calendar-user-address-set/>"
        alle["supported-report-set"] = _REPORTS
    elif art == "kalender":
        eigene = user_props(u)
        alle["resourcetype"] = "<D:resourcetype><D:collection/><C:calendar/></D:resourcetype>"
        alle["displayname"] = f"<D:displayname>{_xml(eigene.get('displayname') or KALENDER_NAME)}</D:displayname>"
        # Zurueckgeben, was der Client gesetzt hat — sonst faerbt er den
        # Kalender bei jedem Abgleich erneut ein.
        if eigene.get("calendar-color"):
            alle["calendar-color"] = f"<ICAL:calendar-color>{_xml(eigene['calendar-color'])}</ICAL:calendar-color>"
        if eigene.get("calendar-order"):
            alle["calendar-order"] = f"<ICAL:calendar-order>{_xml(eigene['calendar-order'])}</ICAL:calendar-order>"
        alle["calendar-description"] = f"<C:calendar-description>{KALENDER_NAME}</C:calendar-description>"
        # Nur Termine. Genau deshalb lehnt PUT eine VTODO ab, statt sie
        # stillschweigend wegzuwerfen.
        alle["supported-calendar-component-set"] = '<C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>'
        alle["supported-report-set"] = _REPORTS
        alle["owner"] = f"<D:owner><D:href>{ich}</D:href></D:owner>"
    else:   # datei
        alle["resourcetype"] = "<D:resourcetype/>"
        alle["getcontenttype"] = "<D:getcontenttype>text/calendar; charset=utf-8; component=VEVENT</D:getcontenttype>"
        alle["owner"] = f"<D:owner><D:href>{ich}</D:href></D:owner>"

    if ctag_wert:
        alle["getctag"] = f"<CS:getctag>{ctag_wert}</CS:getctag>"
    if etag_wert:
        alle["getetag"] = f"<D:getetag>{etag_wert}</D:getetag>"

    if gefragt is None:
        return X.response(href, alle)
    gefunden, fehlend = {}, []
    for raum, name in gefragt:
        if name in alle:
            gefunden[name] = alle[name]
        else:
            # Was wir nicht fuehren, muss ausdruecklich als 404 kommen — sonst
            # fragt der Client es bei jedem Abgleich erneut. Und zwar im
            # Namensraum, in dem GEFRAGT wurde: ein CalDAV-Merkmal als
            # <D:…> zurueckzumelden waere eine andere Eigenschaft.
            fehlend.append(f"{_PRAEFIX.get(raum, 'D')}:{name}")
    return X.response(href, gefunden, fehlend)


_REPORTS = ("<D:supported-report-set>"
            "<D:supported-report><D:report><C:calendar-query/></D:report></D:supported-report>"
            "<D:supported-report><D:report><C:calendar-multiget/></D:report></D:supported-report>"
            "</D:supported-report-set>")

# Namensraum -> Praefix, damit eine fehlende Eigenschaft dort gemeldet wird, wo
# nach ihr gefragt wurde.
_PRAEFIX = {u: p for p, u in X.NS.items()}


def _multistatus(inhalt: str) -> Response:
    return Response(content=inhalt, status_code=207,
                    media_type="application/xml; charset=utf-8", headers=_DAV_KOPF)


# ─── Endpunkte ───

@router.api_route("/", methods=["OPTIONS", "PROPFIND", "GET"])
@router.api_route("/p/{user_id}/", methods=["OPTIONS", "PROPFIND", "GET"])
async def wurzel(request: Request, user_id: Optional[int] = None,
                 db: AsyncSession = Depends(get_db)):
    """Der Einstieg: „wer bin ich" und „wo liegt mein Kalender".

    Apple geht diesen Weg in drei Schritten (Wurzel, Principal, Kalender), und
    jeder Schritt muss antworten — bricht einer ab, sagt die Kontoeinrichtung
    nur „Server nicht gefunden", ohne zu sagen, welcher.
    """
    if request.method == "OPTIONS":
        return Response(status_code=200, headers={
            **_DAV_KOPF, "Allow": "OPTIONS, PROPFIND, REPORT, GET, PUT, DELETE, HEAD"})
    if request.method == "GET":
        # Wer die Adresse in den Browser tippt, bekam bisher „Method Not
        # Allowed" — richtig (ein Browser spricht kein CalDAV), aber es liest
        # sich wie ein Fehler und hat genau so schon einmal zu einer falschen
        # Fehlersuche gefuehrt. Ein Satz Klartext kostet nichts und beantwortet
        # die Frage, die derjenige wirklich hat.
        return _Text(
            "Das ist der CalDAV-Zugang von Nuvora.\n\n"
            "Diese Adresse gehoert in die Kalender-App (Apple, Outlook, "
            "Thunderbird), nicht in den Browser — ein Browser kann CalDAV "
            "nicht sprechen.\n\n"
            "Serveradresse, Benutzername und ein Geraete-Passwort stehen in "
            "Nuvora unter Kalender -> Kalender teilen.\n",
            media_type="text/plain; charset=utf-8", headers=_DAV_KOPF)
    u, absage = await _zugang(request, db)
    if absage:
        return absage
    # Ein fremder Principal-Pfad darf nicht die eigenen Daten zeigen. Der
    # Zugang haengt am angemeldeten Konto, nicht am Pfad.
    if user_id is not None and user_id != u.id:
        return Response(status_code=403, headers=_DAV_KOPF)

    gefragt = X.gefragte_props(X.parse_xml(await request.body()))
    tiefe = request.headers.get("depth", "0")
    href = f"/api/caldav/p/{u.id}/" if user_id is not None else "/api/caldav/"
    antworten = [_props(u, art=("principal" if user_id is not None else "wurzel"),
                        href=href, gefragt=gefragt)]
    if tiefe != "0" and user_id is not None:
        alles = await _ressourcen(db, u)
        antworten.append(_props(u, art="kalender", href=_pfad(u.id),
                                ctag_wert=X.ctag([X.etag(r["text"]) for r in alles]),
                                gefragt=gefragt))
    return _multistatus(X.multistatus(antworten))


@router.api_route("/p/{user_id}/" + KALENDER + "/",
                  methods=["OPTIONS", "PROPFIND", "REPORT", "PROPPATCH", "MKCALENDAR", "MKCOL"])
async def sammlung(request: Request, user_id: int, db: AsyncSession = Depends(get_db)):
    """Der Kalender selbst: seine Eigenschaften, seine Termine, seine Abfragen."""
    if request.method == "OPTIONS":
        return Response(status_code=200, headers={
            **_DAV_KOPF, "Allow": "OPTIONS, PROPFIND, REPORT, GET, PUT, DELETE, HEAD"})
    u, absage = await _zugang(request, db)
    if absage:
        return absage
    if user_id != u.id:
        return Response(status_code=403, headers=_DAV_KOPF)

    if request.method in ("MKCALENDAR", "MKCOL"):
        # Es gibt genau EINEN Kalender je Konto, und er existiert schon. 405
        # waere hier falsch verstanden worden („Server kaputt"); eine
        # WebDAV-Absage sagt dem Client, dass die Stelle belegt ist, und er
        # macht danach ruhig weiter.
        return Response(status_code=405, headers={
            **_DAV_KOPF, "Allow": "OPTIONS, PROPFIND, PROPPATCH, REPORT"})

    try:
        baum = X.parse_xml(await request.body())
    except X.CaldavFehler as e:
        return Response(status_code=e.status, headers=_DAV_KOPF)
    gefragt = X.gefragte_props(baum)

    if request.method == "PROPPATCH":
        # Apple stellt nach dem Einrichten Farbe und Reihenfolge ein. Kennt der
        # Server die Methode nicht, bricht der GANZE Abgleich ab — die
        # Kalender-App meldet „Dies ist keine gueltige URL, die diese Anfrage
        # unterstuetzt", und danach kommt auch keine Aenderung aus Nuvora mehr
        # an. Es sieht aus wie ein Sync-Problem, ist aber eine fehlende Methode.
        #
        # Gespeichert wird wirklich (users.caldav_props), nicht nur bestaetigt:
        # eine Farbe, die nach dem Neustart weg ist, waere eine Antwort, die
        # nicht stimmt. Was wir nicht fuehren, bekommt ausdruecklich 403 —
        # ebenfalls eine Antwort, mit der der Client umgehen kann.
        setzen, loeschen = X.proppatch_wuensche(baum)
        props = dict(user_props(u))
        ok, abgelehnt = [], []
        for name, wert in setzen.items():
            if name in X.SETZBAR:
                props[name] = wert
                ok.append(name)
            else:
                abgelehnt.append(name)
        for name in loeschen:
            if name in X.SETZBAR:
                props.pop(name, None)
                ok.append(name)
            else:
                abgelehnt.append(name)
        u.caldav_props = props
        await db.commit()
        teile = []
        if ok:
            teile.append("<D:propstat><D:prop>" + "".join(f"<D:{n}/>" for n in ok)
                         + "</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>")
        if abgelehnt:
            teile.append("<D:propstat><D:prop>" + "".join(f"<D:{n}/>" for n in abgelehnt)
                         + "</D:prop><D:status>HTTP/1.1 403 Forbidden</D:status></D:propstat>")
        return _multistatus(X.multistatus(
            [f"<D:response><D:href>{_pfad(u.id)}</D:href>{''.join(teile)}</D:response>"]))

    if request.method == "REPORT":
        art = X.lokal(baum.tag) if baum is not None else ""
        if art == "calendar-multiget":
            gewuenscht = {h.rstrip("/").rsplit("/", 1)[-1] for h in X.multiget_hrefs(baum)}
            alles = [r for r in await _ressourcen(db, u) if r["name"] in gewuenscht]
        else:
            # calendar-query. Das Zeitfenster zu beachten ist nicht Pflicht (der
            # Client filtert selbst), spart beim ersten Abgleich aber die ganze
            # Historie.
            alles = await _ressourcen(db, u, X.zeitfenster(baum))
        antworten = []
        for r in alles:
            props = {"getetag": f"<D:getetag>{X.etag(r['text'])}</D:getetag>",
                     "calendar-data": f"<C:calendar-data>{_xml(r['text'])}</C:calendar-data>"}
            antworten.append(X.response(_pfad(u.id, r["name"]), props))
        return _multistatus(X.multistatus(antworten))

    # PROPFIND
    alles = await _ressourcen(db, u)
    antworten = [_props(u, art="kalender", href=_pfad(u.id),
                        ctag_wert=X.ctag([X.etag(r["text"]) for r in alles]), gefragt=gefragt)]
    if request.headers.get("depth", "0") != "0":
        for r in alles:
            antworten.append(_props(u, art="datei", href=_pfad(u.id, r["name"]),
                                    etag_wert=X.etag(r["text"]), gefragt=gefragt))
    return _multistatus(X.multistatus(antworten))


def _xml(text: str) -> str:
    from xml.sax.saxutils import escape
    return escape(text)


@router.api_route("/p/{user_id}/" + KALENDER + "/{name}",
                  methods=["GET", "PUT", "DELETE", "HEAD", "PROPFIND", "OPTIONS"])
async def ressource(request: Request, user_id: int, name: str,
                    db: AsyncSession = Depends(get_db)):
    """Ein einzelner Termin: lesen, anlegen/aendern, loeschen."""
    u, absage = await _zugang(request, db)
    if absage:
        return absage
    if user_id != u.id:
        return Response(status_code=403, headers=_DAV_KOPF)

    if request.method == "OPTIONS":
        return Response(status_code=200, headers={
            **_DAV_KOPF, "Allow": "OPTIONS, PROPFIND, GET, PUT, DELETE, HEAD"})

    # Ist die Adresse eine Stundenplan-Stunde? Die gibt es nicht als Zeile in
    # der Datenbank — sie entsteht aus Vorlage + Tag. Lesen geht wie bei allem
    # anderen; Schreiben und Loeschen bedeuten hier etwas Eigenes (siehe unten).
    stunde = _slot_lesen(name)
    # Ein fremder (abonnierter) Termin? Auch den gibt es nicht als Zeile: er
    # kommt aus einem anderen Kalender und wird nur mit ausgeliefert.
    fremd = name.startswith("ext-")
    eintraege = await _alle(db, u)
    treffer = next((e for e in eintraege if _dateiname(e) == name), None)
    if stunde is not None or fremd:
        alles = await _ressourcen(db, u)
        vorhanden = next((r for r in alles if r["name"] == name), None)
    else:
        vorhanden = None

    if request.method == "PROPFIND":
        # Ein Client darf auch einen EINZELNEN Termin abfragen, statt die ganze
        # Sammlung zu holen — Apple tut das beim Nachfassen zu einem Termin,
        # den es gerade geschrieben hat. Ohne diesen Zweig gab es dafuer 405,
        # und die Kalender-App meldete „Dies ist keine gueltige URL".
        text = vorhanden["text"] if vorhanden else (
            (await _texte(db, u, [treffer]))[treffer.id] if treffer else None)
        if text is None:
            return Response(status_code=404, headers=_DAV_KOPF)
        return _multistatus(X.multistatus([_props(
            u, art="datei", href=_pfad(u.id, name), etag_wert=X.etag(text),
            gefragt=X.gefragte_props(X.parse_xml(await request.body())))]))

    if request.method in ("GET", "HEAD"):
        text = vorhanden["text"] if vorhanden else (
            (await _texte(db, u, [treffer]))[treffer.id] if treffer else None)
        if text is None:
            return Response(status_code=404, headers=_DAV_KOPF)
        return Response(content="" if request.method == "HEAD" else text, status_code=200,
                        media_type="text/calendar; charset=utf-8",
                        headers={**_DAV_KOPF, "ETag": X.etag(text)})

    if request.method == "DELETE":
        if fremd:
            # Ein fremder Termin laesst sich von hier aus nicht loeschen — er
            # gehoert dem anderen Kalender. Was der Nutzer meint, wenn er ihn
            # in Nuvoras Kalender wegwischt, kennt Nuvora aber seit jeher:
            # ausblenden (external_hidden). Er steht danach im Reiter
            # „Ausgeblendet" und laesst sich dort zurueckholen; im fremden
            # Kalender bleibt er unangetastet.
            schluessel = _externer_schluessel(name, await _externe(u))
            if not schluessel:
                return Response(status_code=404, headers=_DAV_KOPF)
            hid = list(u.external_hidden or [])
            if schluessel not in hid:
                hid.append(schluessel)
                u.external_hidden = hid[:2000]
                await db.commit()
            notiere(u.email, request, 204, "fremder Termin ausgeblendet")
            return Response(status_code=204, headers=_DAV_KOPF)
        if stunde is not None:
            # Eine Stundenplan-Stunde laesst sich nicht loeschen — es gibt sie
            # als Datensatz gar nicht. Was der Nutzer meint, wenn er sie im
            # Handy wegwischt, kennt Nuvora aber: die Stunde faellt an diesem
            # Tag AUS. Genau das wird eingetragen (SlotCancellation) — dieselbe
            # Wirkung wie „Stunde entfaellt" in der Weboberflaeche. Die Vorlage
            # bleibt, naechste Woche steht sie wieder da.
            slot_id, tag = stunde
            if not vorhanden:
                return Response(status_code=404, headers=_DAV_KOPF)
            s_obj = (await db.execute(select(TimetableSlot).where(
                TimetableSlot.id == slot_id, TimetableSlot.owner_id == u.id))).scalar_one_or_none()
            if not s_obj:
                return Response(status_code=404, headers=_DAV_KOPF)
            db.add(SlotCancellation(owner_id=u.id, date=tagesbeginn(tag), period=s_obj.period))
            await db.commit()
            return Response(status_code=204, headers=_DAV_KOPF)
        if not treffer:
            return Response(status_code=404, headers=_DAV_KOPF)
        await db.delete(treffer)
        await db.commit()
        return Response(status_code=204, headers=_DAV_KOPF)

    # PUT: anlegen oder aendern.
    if fremd:
        # Aendern geht dort, wo der Termin herkommt. Ihn hier zu uebernehmen
        # hiesse, eine Kopie anzulegen, die beim naechsten Abgleich neben dem
        # Original steht — und die Aenderung waere im fremden Kalender trotzdem
        # nicht angekommen.
        notiere(u.email, request, 403, "fremder Termin ist nicht aenderbar")
        return Response(content=X.fehler_xml("valid-calendar-object-resource"), status_code=403,
                        media_type="application/xml; charset=utf-8", headers=_DAV_KOPF)
    try:
        daten = X.parse_vevent((await request.body()).decode("utf-8", "replace"))
    except X.CaldavFehler as e:
        # Mit Vorbedingung, damit Apple sagen kann, WAS nicht ging — ein
        # nacktes 403 liest sich am Geraet als „keine Berechtigung". Und ins
        # Protokoll, weil das Geraet die Meldung selten zeigt.
        notiere(u.email, request, e.status, e.text or e.precondition or "abgelehnt")
        if e.precondition:
            return Response(content=X.fehler_xml(e.precondition), status_code=e.status,
                            media_type="application/xml; charset=utf-8", headers=_DAV_KOPF)
        return Response(status_code=e.status, headers=_DAV_KOPF)

    # If-Match / If-None-Match: der Schutz gegen verlorene Aenderungen. Zwei
    # Geraete am selben Termin ueberschrieben sich sonst gegenseitig, ohne dass
    # eines davon etwas merkt.
    if_match = request.headers.get("if-match")
    if_none = request.headers.get("if-none-match")
    if treffer:
        vorher = (await _texte(db, u, [treffer]))[treffer.id]
        if if_none == "*":
            return Response(status_code=412, headers=_DAV_KOPF)
        if if_match and if_match != "*" and X.etag(vorher) not in if_match:
            return Response(status_code=412, headers=_DAV_KOPF)
    elif if_match:
        return Response(status_code=412, headers=_DAV_KOPF)

    if stunde is not None and not treffer:
        # Aus der Vorlage wird ein echter Eintrag — genau das, was ein Klick auf
        # die Stunde in der Weboberflaeche tut. Klasse und Kurs kommen aus der
        # Vorlage, damit der Termin dort haengt, wo er hingehoert; Titel und
        # Uhrzeit aus dem, was im Handy steht.
        slot_id, tag = stunde
        s_obj = (await db.execute(select(TimetableSlot).where(
            TimetableSlot.id == slot_id, TimetableSlot.owner_id == u.id))).scalar_one_or_none()
        if not s_obj:
            return Response(status_code=404, headers=_DAV_KOPF)
        e = CalendarEntry(owner_id=u.id, date=tagesbeginn(daten["datum"] or tag),
                          period=s_obj.period, class_id=s_obj.class_id, kurs_id=s_obj.kurs_id,
                          topic_id=s_obj.topic_id, title=daten["title"], notes=daten["notes"],
                          location=daten["location"], rrule=daten["rrule"], exdate=daten["exdate"],
                          start_time=daten["start_time"], end_time=daten["end_time"],
                          caldav_uid=daten["uid"] or None)
        db.add(e)
        await db.commit()
        await db.refresh(e)
        text = (await _texte(db, u, [e]))[e.id]
        return Response(status_code=201, headers={
            **_DAV_KOPF, "ETag": X.etag(text), "Content-Location": _pfad(u.id, _dateiname(e))})

    if treffer:
        # Der Titel, den das Geraet zurueckschickt, ist der, den wir ihm gegeben
        # haben — bei einem Termin mit Kurs also „Fach · Kursname". Den in
        # `title` zu schreiben hiesse, den eigenen Titel der Lehrkraft bei jedem
        # Abgleich durch das Kurs-Etikett zu ersetzen. Also: nur uebernehmen,
        # was WIRKLICH jemand geaendert hat.
        label = await _beschriftung(db, u)
        titel = daten["title"]
        if titel == label(treffer):
            titel = treffer.title
        # Dasselbe fuer die Beschreibung: wir schicken „eigener Titel + Notiz"
        # hinaus, und ohne diesen Abzug staende der Titel nach zwei Abgleichen
        # zweimal in den Notizen.
        notiz = daten["notes"]
        kopf = treffer.title if treffer.title and treffer.title != label(treffer) else ""
        if kopf and notiz == kopf:
            notiz = ""
        elif kopf and notiz.startswith(kopf + "\n"):
            notiz = notiz[len(kopf) + 1:]
        treffer.date = tagesbeginn(daten["datum"])
        treffer.end_date = tagesbeginn(daten["ende_datum"]) if daten.get("ende_datum") else None
        treffer.title = titel
        treffer.notes = notiz
        treffer.location = daten["location"]
        treffer.rrule = daten["rrule"]
        treffer.exdate = daten["exdate"]
        treffer.start_time = daten["start_time"]
        treffer.end_time = daten["end_time"]
        if daten["uid"]:
            treffer.caldav_uid = daten["uid"]
        e = treffer
        status = 204
    else:
        rate_limit("caldav_neu", f"u{u.id}", 200, 3600, "Zu viele neue Termine.")
        e = CalendarEntry(owner_id=u.id, date=tagesbeginn(daten["datum"]),
                          end_date=tagesbeginn(daten["ende_datum"]) if daten.get("ende_datum") else None,
                          title=daten["title"], notes=daten["notes"],
                          location=daten["location"], rrule=daten["rrule"], exdate=daten["exdate"],
                          start_time=daten["start_time"], end_time=daten["end_time"],
                          caldav_uid=daten["uid"] or None)
        db.add(e)
        status = 201
    await db.commit()
    await db.refresh(e)
    text = (await _texte(db, u, [e]))[e.id]
    # Der Ort der Ressource kann sich vom hochgeladenen Namen unterscheiden
    # (unsere Namen tragen die ID). Content-Location sagt dem Client, wo sie
    # wirklich liegt — sonst legt er sie beim naechsten Abgleich noch einmal an.
    return Response(status_code=status, headers={
        **_DAV_KOPF, "ETag": X.etag(text), "Content-Location": _pfad(u.id, _dateiname(e))})


# ─── Geraete-Passwoerter (normale, angemeldete API) ───

verwaltung = APIRouter(prefix="/api/caldav-zugaenge", tags=["caldav"])

# Die Geraete-Passwoerter gehoeren zum Modul Kalender — ohne das Modul gibt es
# nichts, wofuer sich ein Geraet anmelden koennte. Dieselbe Schranke wie ueberall
# (modules.modul_pflicht), damit hier keine zweite Fassung entsteht.
verwaltung_pflicht = modul_pflicht(MODULE_KEY)


@verwaltung.get("")
async def liste(request: Request, db: AsyncSession = Depends(get_db),
                user: User = Depends(verwaltung_pflicht)):
    """Die Geraete-Passwoerter dieses Kontos — ohne die Passwoerter selbst."""
    rows = (await db.execute(select(CaldavToken).where(CaldavToken.owner_id == user.id)
                             .order_by(CaldavToken.id))).scalars().all()
    return {
        "benutzer": user.email,
        # Die volle Adresse, wie sie ins Geraet gehoert. Selbst
        # zusammensetzen zu lassen ist die Stelle, an der die Einrichtung
        # scheitert — Apple sagt dazu nur „Server nicht gefunden".
        "server": str(request.base_url).rstrip("/") + "/api/caldav/",
        # Getrennt noch einmal Host und Pfad — fuer den Kontotyp „Erweitert".
        #
        # Der ist nicht die Notloesung, sondern oft der einzige Weg: im
        # Dialog „Manuell" benutzt macOS den eingetippten Pfad teilweise gar
        # nicht, sondern sucht selbst unter /.well-known/caldav (RFC 6764) —
        # und genau diesen Pfad fangen viele vorgeschaltete Proxys fuer
        # Let's Encrypt selbst ab. Dann laeuft Apples Suche ins Leere, waehrend
        # /api/caldav/ einwandfrei antwortet. Unter „Erweitert" wird der Pfad
        # ausdruecklich gesetzt und gar nicht erst gesucht.
        "host": request.url.hostname or "",
        "pfad": f"/api/caldav/p/{user.id}/",
        "port": request.url.port or (443 if request.url.scheme == "https" else 80),
        "ssl": request.url.scheme == "https",
        "zugaenge": [{"id": r.id, "name": r.name,
                      "angelegt": r.created_at.isoformat() if r.created_at else None,
                      "zuletzt": r.last_used_at.isoformat() if r.last_used_at else None}
                     for r in rows],
    }


class ZugangIn(BaseModel):
    name: str = ""


@verwaltung.get("/protokoll")
async def protokoll(user: User = Depends(verwaltung_pflicht)):
    """Was an CalDAV-Anfragen fuer DIESES Konto ankam — neueste zuerst.

    Nur die eigenen: der Schluessel ist die eigene E-Mail-Adresse, und fremde
    Versuche gehen niemanden etwas an. Ist die Liste leer, ist das der Befund
    (siehe `notiere`): dann hat der Server nichts gesehen, und es liegt an der
    Adresse oder am vorgeschalteten Proxy.
    """
    eintraege = list(_PROTOKOLL.get((user.email or "").strip().lower(), ()))
    return {"eintraege": list(reversed(eintraege))}


@verwaltung.post("", status_code=201)
async def anlegen(body: ZugangIn, db: AsyncSession = Depends(get_db),
                  user: User = Depends(verwaltung_pflicht)):
    """Ein neues Geraete-Passwort. Der Klartext kommt GENAU EINMAL zurueck.

    Danach steht nur noch der Hash in der Datenbank — ein Passwort, das sich
    nachtraeglich auslesen laesst, ist keins. Wer es verliert, legt ein neues
    an und nimmt das alte zurueck; das ist genau der Zweck von einem Passwort
    je Geraet.
    """
    rate_limit("caldav_zugang", f"u{user.id}", 10, 3600, "Zu viele Zugaenge. Bitte kurz warten.")
    vorhanden = (await db.execute(select(CaldavToken).where(
        CaldavToken.owner_id == user.id))).scalars().all()
    if len(vorhanden) >= 20:
        raise HTTPException(400, "Zu viele Geraete-Passwoerter. Bitte zuerst eins zuruecknehmen.")
    # Vier Gruppen zu fuenf Zeichen: lang genug gegen Raten, und man kann es
    # von einem Bildschirm auf ein Handy abtippen, ohne sich zu verzaehlen.
    klartext = "-".join(secrets.token_urlsafe(4)[:5] for _ in range(4))
    z = CaldavToken(owner_id=user.id, name=(body.name or "").strip()[:80] or "Gerät",
                    token_hash=_hash_pw(klartext))
    db.add(z)
    await db.commit()
    await db.refresh(z)
    # Die Einmal-Adresse fuers Konfigurationsprofil entsteht GENAU HIER — im
    # einzigen Augenblick, in dem der Klartext vorliegt. Siehe unten.
    return {"id": z.id, "name": z.name, "passwort": klartext,
            "profil": f"/api/caldav-zugaenge/profil/{_profil_merken(user.id, z.name, klartext)}"}


@verwaltung.delete("/{zugang_id}", status_code=204)
async def zuruecknehmen(zugang_id: int, db: AsyncSession = Depends(get_db),
                        user: User = Depends(verwaltung_pflicht)):
    """Ein Geraet aussperren. Wirkt beim naechsten Abgleich — es gibt keine
    Sitzung, die noch weiterlaufen koennte."""
    z = (await db.execute(select(CaldavToken).where(
        CaldavToken.id == zugang_id, CaldavToken.owner_id == user.id))).scalar_one_or_none()
    if not z:
        raise HTTPException(404, "Zugang nicht gefunden")
    await db.delete(z)
    await db.commit()


# ─── Konfigurationsprofil (.mobileconfig) ───
#
# Auf dem iPhone ist die Einrichtung von Hand die eigentliche Huerde: Serveradresse,
# Port, Pfad, Benutzername und ein zwanzigstelliges Passwort abtippen, und das im
# Dialog „Erweitert", den man erst finden muss. Ein Konfigurationsprofil erledigt
# das in zwei Tipps.
#
# Drei Entscheidungen:
#
# (a) **Der Weg ist eine GET-Navigation, kein Download.** iOS startet den
#     Installationsdialog nur, wenn Safari eine Adresse ANSTEUERT, die mit
#     `application/x-apple-aspen-config` antwortet. Eine per JavaScript gebaute
#     Blob-Datei landet stattdessen in „Dateien" und muss von dort geoeffnet
#     werden. Eine Navigation traegt aber keinen Bearer-Token — deshalb eine
#     eigene, unerratbare Einmal-Adresse statt der normalen Anmeldung.
#
# (b) **Nur beim Anlegen, nur einmal, nur kurz.** Das Profil enthaelt das
#     Geraete-Passwort im Klartext; anders koennte es nichts einrichten. Es
#     entsteht deshalb genau in dem Augenblick, in dem der Klartext ohnehin
#     einmal ueber die Leitung geht, liegt zehn Minuten im Arbeitsspeicher und
#     ist nach dem ersten Abruf weg. Kein zweiter Weg, an ein bestehendes
#     Passwort zu kommen — sonst waere „genau einmal sichtbar" eine Behauptung.
#
# (c) **Unsigniert.** Signieren ginge mit dem TLS-Zertifikat des Servers, dafuer
#     braeuchte die API dessen privaten Schluessel — fuer einen gruenen Haken
#     statt eines roten Hinweises ein schlechter Tausch (und bei jeder
#     Erneuerung eine Stelle, an der das Profil ploetzlich ABGELEHNT statt nur
#     bemaengelt wird). iOS meldet „Nicht signiert" und installiert es trotzdem.
_PROFIL_TTL = 600           # Sekunden
_PROFIL_MAX = 200           # Obergrenze, damit der Speicher nicht waechst
# token -> (ablauf, owner_id, name, klartext)
_PROFILE: dict[str, tuple[float, int, str, str]] = {}


def _profil_merken(owner_id: int, name: str, klartext: str) -> str:
    """Einmal-Adresse fuer ein frisch angelegtes Geraete-Passwort."""
    jetzt = _time.time()
    for k in [k for k, v in _PROFILE.items() if v[0] <= jetzt]:
        _PROFILE.pop(k, None)
    while len(_PROFILE) >= _PROFIL_MAX:
        _PROFILE.pop(next(iter(_PROFILE)), None)
    token = secrets.token_urlsafe(32)
    _PROFILE[token] = (jetzt + _PROFIL_TTL, owner_id, name, klartext)
    return token


def _plist_text(s: str) -> str:
    """XML-Escape. Ein Kursname mit & zerlegt sonst die ganze Datei."""
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def _mobileconfig(*, host: str, port: int, ssl: bool, pfad: str, benutzer: str,
                  passwort: str, name: str, uuid_profil: str, uuid_payload: str) -> str:
    """Ein CalDAV-Konto als Apple-Konfigurationsprofil."""
    e = _plist_text
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key><string>com.apple.caldav.account</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>PayloadIdentifier</key><string>de.nuvora.caldav.{e(uuid_payload)}</string>
      <key>PayloadUUID</key><string>{e(uuid_payload)}</string>
      <key>PayloadDisplayName</key><string>{e(KALENDER_NAME)}</string>
      <key>CalDAVAccountDescription</key><string>{e(KALENDER_NAME)}</string>
      <key>CalDAVHostName</key><string>{e(host)}</string>
      <key>CalDAVPort</key><integer>{int(port)}</integer>
      <key>CalDAVUseSSL</key><{'true' if ssl else 'false'}/>
      <key>CalDAVPrincipalURL</key><string>{e(pfad)}</string>
      <key>CalDAVUsername</key><string>{e(benutzer)}</string>
      <key>CalDAVPassword</key><string>{e(passwort)}</string>
    </dict>
  </array>
  <key>PayloadDisplayName</key><string>{e(KALENDER_NAME)} ({e(name)})</string>
  <key>PayloadDescription</key><string>Richtet den Nuvora-Kalender auf diesem Geraet ein.</string>
  <key>PayloadIdentifier</key><string>de.nuvora.profil.{e(uuid_profil)}</string>
  <key>PayloadUUID</key><string>{e(uuid_profil)}</string>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadVersion</key><integer>1</integer>
  <key>PayloadRemovalDisallowed</key><false/>
</dict>
</plist>
"""


@verwaltung.get("/profil/{token}")
async def profil(token: str, request: Request, db: AsyncSession = Depends(get_db)):
    """Das Konfigurationsprofil zu einem frisch angelegten Geraete-Passwort.

    Ohne die normale Anmeldung, weil Safari beim Ansteuern der Adresse keinen
    Bearer-Token mitschickt — dafuer einmalig, zehn Minuten gueltig und mit
    32 Byte Zufall als Adresse. Der zweite Abruf findet nichts mehr.
    """
    eintrag = _PROFILE.pop(token, None)
    if not eintrag or eintrag[0] <= _time.time():
        raise HTTPException(404, "Dieser Link ist abgelaufen. Bitte ein neues Geraete-Passwort anlegen.")
    _, owner_id, name, klartext = eintrag
    u = (await db.execute(select(User).where(User.id == owner_id))).scalar_one_or_none()
    # Auch hier stirbt der Zugang mit dem Modul — ein Profil einzurichten, das
    # sofort 403 bekaeme, waere eine Einladung in eine Sackgasse.
    if not u or not await is_active(db, u.id, MODULE_KEY):
        raise HTTPException(404, "Dieser Link ist abgelaufen.")
    ssl = request.url.scheme == "https"
    text = _mobileconfig(
        host=request.url.hostname or "", port=request.url.port or (443 if ssl else 80),
        ssl=ssl, pfad=f"/api/caldav/p/{u.id}/", benutzer=u.email or "", passwort=klartext,
        name=name, uuid_profil=str(_uuid.uuid4()), uuid_payload=str(_uuid.uuid4()))
    return Response(text, media_type="application/x-apple-aspen-config", headers={
        "Content-Disposition": 'attachment; filename="nuvora-kalender.mobileconfig"',
        "Cache-Control": "no-store",
    })
