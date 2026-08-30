"""CalDAV: die Uebersetzung und das Protokoll.

Zwei Teile, mit Absicht getrennt:

* **Uebersetzung** (`app/caldav.py`) — laeuft ohne Server. Hier sitzen die
  Fehler, die man sonst erst am Handy sieht: ein fehlendes „+1" beim
  Ganztags-Ende, eine still gekuerzte Serie, ein Escape zu viel.
* **Protokoll** (`routers/caldav.py`) — ueber die echte ASGI-Anwendung, ohne
  Netz. Apple richtet ein Konto in drei Schritten ein (Wurzel, Principal,
  Kalender); bricht einer ab, sagt das Geraet nur „Server nicht gefunden".
  Genau diese Kette wird hier durchgegangen.
"""
import asyncio
import base64
import os
import tempfile
from datetime import date, datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

os.environ.setdefault("NUVORA_UPLOAD_DIR", tempfile.mkdtemp(prefix="nuvora-caldav-"))

from app import caldav as X  # noqa: E402
from app.caldav import CaldavFehler  # noqa: E402


# ══════════════════════════════════════════════════════════════════════
# Teil 1 — die Uebersetzung
# ══════════════════════════════════════════════════════════════════════

TAG = date(2026, 8, 27)


def _wann(d):
    """Tagesbeginn in UTC — so legt der Kalender seine Eintraege ab."""
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)


def test_ganztags_endet_am_folgetag():
    """DTEND ist EXKLUSIV (RFC 5545) — genau ein „+1".

    Kein „+1" macht aus dem Tag einen Termin der Laenge null (Apple zeigt ihn
    dann an einem beliebigen Tag oder gar nicht), zwei ziehen ihn ueber zwei
    Tage. Beide Fehlerbilder gab es im ICS-Feed schon.
    """
    text = X.baue_vevent(uid="a@nuvora", tag=TAG, titel="Elternabend")
    assert "DTSTART;VALUE=DATE:20260827" in text
    assert "DTEND;VALUE=DATE:20260828" in text


def test_getaktet_endet_am_selben_tag():
    # Hier waere ein „+1 Tag" der Fehler — er zoege jede Stunde ueber Nacht.
    text = X.baue_vevent(uid="a@nuvora", tag=TAG, titel="Mathe", start_time="08:00", end_time="08:45")
    assert "DTSTART:20260827T080000" in text
    assert "DTEND:20260827T084500" in text


def test_rundlauf_bleibt_gleich():
    text = X.baue_vevent(uid="a@nuvora", tag=TAG, titel="Mathe · 7.5",
                         notiz="Zeile 1\nZeile 2; mit Semikolon, und Komma",
                         start_time="08:00", end_time="08:45")
    d = X.parse_vevent(text)
    assert d["datum"] == TAG and d["start_time"] == "08:00" and d["end_time"] == "08:45"
    assert d["title"] == "Mathe · 7.5"
    assert d["notes"] == "Zeile 1\nZeile 2; mit Semikolon, und Komma"


def test_ganztags_rundlauf_hat_keine_uhrzeit():
    d = X.parse_vevent(X.baue_vevent(uid="a@nuvora", tag=TAG, titel="Ferientag"))
    assert d["datum"] == TAG and d["start_time"] == "" and d["end_time"] == ""


def test_serie_laeuft_rund():
    """Eine Serie kommt an, geht wieder hinaus und bleibt dieselbe.

    Sie still auf ihren ersten Termin zu kuerzen hiesse: jemand traegt im Handy
    „jeden Montag" ein und findet in Nuvora einen einzigen Montag — der Verlust
    faellt erst Wochen spaeter auf.
    """
    text = X.baue_vevent(uid="a@nuvora", tag=TAG, titel="AG",
                         rrule="FREQ=WEEKLY;BYDAY=MO", exdate=["20260908"])
    d = X.parse_vevent(text)
    assert d["rrule"] == "FREQ=WEEKLY;BYDAY=MO" and d["exdate"] == ["20260908"]


def test_mehrere_exdate_zeilen_bleiben_alle():
    """EXDATE steht je geloeschtem Einzeltermin einmal im VEVENT. Behielte man
    nur die erste, waeren alle anderen beim naechsten Abgleich wieder da."""
    text = X.baue_vevent(uid="a@nuvora", tag=TAG, titel="AG", rrule="FREQ=WEEKLY").replace(
        "SUMMARY:AG", "EXDATE;VALUE=DATE:20260908\r\nEXDATE;VALUE=DATE:20260915\r\nSUMMARY:AG")
    assert X.parse_vevent(text)["exdate"] == ["20260908", "20260915"]


def test_unbekannte_wiederholung_wird_abgelehnt():
    """Was wir nicht aufzaehlen koennen, wird nicht halb uebernommen — sonst
    stuende die Serie in der Datenbank und faende im Kalender nicht statt."""
    text = X.baue_vevent(uid="a@nuvora", tag=TAG, titel="AG").replace(
        "SUMMARY:AG", "RRULE:FREQ=HOURLY;INTERVAL=3\r\nSUMMARY:AG")
    with pytest.raises(CaldavFehler) as e:
        X.parse_vevent(text)
    assert e.value.status == 403 and e.value.precondition == "supported-calendar-data"


def test_rrule_pruefen_wirft_unbekanntes_raus():
    assert X.rrule_pruefen("FREQ=WEEKLY;INTERVAL=2;BYDAY=WE,MO;WKST=SU") == "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE"
    assert X.rrule_pruefen("FREQ=MONTHLY;BYDAY=MO") == "FREQ=MONTHLY"   # BYDAY nur woechentlich
    assert X.rrule_pruefen("FREQ=DAILY;COUNT=5;UNTIL=20270101") == "FREQ=DAILY;UNTIL=20270101"
    assert X.rrule_pruefen("") == "" and X.rrule_pruefen("FREQ=SECONDLY") == ""


def test_exdate_folgt_der_form_von_dtstart():
    """Ein DATE neben einem getakteten DTSTART ignoriert Apple stillschweigend —
    der geloeschte Einzeltermin waere am Geraet wieder da."""
    getaktet = X.baue_vevent(uid="a@x", tag=TAG, titel="AG", rrule="FREQ=WEEKLY",
                             exdate=["20260908"], start_time="08:00", end_time="08:45")
    assert "EXDATE:20260908T080000" in getaktet
    ganztags = X.baue_vevent(uid="a@x", tag=TAG, titel="AG", rrule="FREQ=WEEKLY", exdate=["20260908"])
    assert "EXDATE;VALUE=DATE:20260908" in ganztags


def test_ort_laeuft_rund():
    """Apple und Outlook fuehren den Ort. Fuehrte Nuvora ihn nicht, waere er
    beim ersten Abgleich weg."""
    d = X.parse_vevent(X.baue_vevent(uid="a@x", tag=TAG, titel="AG", ort="Raum 12"))
    assert d["location"] == "Raum 12"


def test_aufgabe_wird_abgelehnt():
    # Der Kalender sagt in seinen Eigenschaften, dass er nur VEVENT fuehrt —
    # dann muss er eine VTODO auch ablehnen statt sie wegzuwerfen.
    with pytest.raises(CaldavFehler) as e:
        X.parse_vevent("BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:x\r\nEND:VTODO\r\nEND:VCALENDAR\r\n")
    assert e.value.status == 403


def test_mehrtaegiger_termin_wird_abgelehnt():
    text = ("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\n"
            "DTSTART;VALUE=DATE:20260827\r\nDTEND;VALUE=DATE:20260901\r\n"
            "SUMMARY:Klassenfahrt\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n")
    with pytest.raises(CaldavFehler) as e:
        X.parse_vevent(text)
    assert e.value.status == 403


def test_termin_ohne_anfang_wird_abgelehnt():
    with pytest.raises(CaldavFehler) as e:
        X.parse_vevent("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nSUMMARY:?\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n")
    assert e.value.status == 400


def test_zeitzone_wird_nicht_umgerechnet():
    """Ein Termin um 8 Uhr heisst nach dem Speichern 8 Uhr.

    Nuvora speichert Tag plus „HH:MM" — die Uhrzeit aus dem Stundenplan. Eine
    Umrechnung brauchte die Zeitzone der Schule, und die steht nirgends; ein
    Termin, der beim Speichern eine Stunde wandert, waere schlimmer als gar
    keine Anbindung.
    """
    text = ("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\n"
            "DTSTART;TZID=Europe/Berlin:20260827T080000\r\n"
            "DTEND;TZID=Europe/Berlin:20260827T084500\r\n"
            "SUMMARY:Mathe\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n")
    d = X.parse_vevent(text)
    assert d["start_time"] == "08:00"


def test_lange_zeile_wird_gefaltet():
    # RFC 5545: keine Zeile ueber 75 Oktett. Strenge Leser brechen sonst ab.
    text = X.baue_vevent(uid="a@nuvora", tag=TAG, titel="Ä" * 200)
    for zeile in text.split("\r\n"):
        assert len(zeile.encode("utf-8")) <= 75, zeile[:40]
    # Und nach dem Entfalten steht wieder derselbe Titel da.
    assert X.parse_vevent(text)["title"] == "Ä" * 200


def test_etag_haengt_am_inhalt():
    a = X.baue_vevent(uid="a@nuvora", tag=TAG, titel="Mathe", stand=datetime(2026, 1, 1))
    b = X.baue_vevent(uid="a@nuvora", tag=TAG, titel="Deutsch", stand=datetime(2026, 1, 1))
    assert X.etag(a) != X.etag(b)
    assert X.etag(a) == X.etag(X.baue_vevent(uid="a@nuvora", tag=TAG, titel="Mathe",
                                             stand=datetime(2026, 1, 1)))


def test_ctag_aendert_sich_mit_jedem_termin():
    # Daran erkennt der Client, ob ein Abgleich ueberhaupt noetig ist.
    assert X.ctag(['"a"']) != X.ctag(['"a"', '"b"'])
    assert X.ctag(['"a"', '"b"']) == X.ctag(['"b"', '"a"'])   # Reihenfolge egal


def test_xml_ohne_doctype():
    """Kein DOCTYPE: `xml.etree` expandiert interne Entitaeten, „Billion
    Laughs" waere sonst erreichbar. In CalDAV braucht sie niemand."""
    with pytest.raises(CaldavFehler) as e:
        X.parse_xml(b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><D:propfind xmlns:D="DAV:"/>')
    assert e.value.status == 400


def test_xml_groessengrenze():
    with pytest.raises(CaldavFehler) as e:
        X.parse_xml(b"<x>" + b"a" * 600_000 + b"</x>")
    assert e.value.status == 413


def test_gefragte_props_und_zeitfenster():
    baum = X.parse_xml(
        b'<?xml version="1.0"?><C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">'
        b"<D:prop><D:getetag/><C:calendar-data/></D:prop>"
        b'<C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT">'
        b'<C:time-range start="20260801T000000Z" end="20260901T000000Z"/>'
        b"</C:comp-filter></C:comp-filter></C:filter></C:calendar-query>")
    assert [n for _, n in X.gefragte_props(baum)] == ["getetag", "calendar-data"]
    assert X.zeitfenster(baum) == (date(2026, 8, 1), date(2026, 9, 1))


def test_allprop_heisst_alles():
    baum = X.parse_xml(b'<D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>')
    assert X.gefragte_props(baum) is None


# ══════════════════════════════════════════════════════════════════════
# Teil 2 — das Protokoll ueber die echte Anwendung
# ══════════════════════════════════════════════════════════════════════

PASSWORT = "test-caldav-1234"


class Antwort:
    def __init__(self, status, body, headers):
        self.status, self.body, self.headers = status, body, headers

    @property
    def text(self):
        return self.body.decode("utf-8", "replace")


async def _ruf(app, method, pfad, *, body=b"", kopf=None, auth=True):
    """Ein Aufruf gegen die ASGI-Anwendung, ohne Netz.

    Von Hand statt mit einem Client, weil die WebDAV-Methoden (PROPFIND,
    REPORT) durch die meisten Testclients nicht durchkommen.
    """
    headers = [(b"host", b"testserver"), (b"content-length", str(len(body)).encode())]
    if auth:
        marke = base64.b64encode(f"caldav@test.de:{PASSWORT}".encode()).decode()
        headers.append((b"authorization", f"Basic {marke}".encode()))
    for k, v in (kopf or {}).items():
        headers.append((k.lower().encode(), str(v).encode()))
    scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.3"},
             "http_version": "1.1", "method": method, "scheme": "http",
             "path": pfad, "raw_path": pfad.encode(), "query_string": b"",
             "root_path": "", "client": ("127.0.0.1", 12345),
             "server": ("testserver", 80), "headers": headers}
    zustand = {"status": 500, "body": b"", "headers": {}}
    geschickt = False
    fertig = asyncio.Event()

    async def receive():
        nonlocal geschickt
        if not geschickt:
            geschickt = True
            return {"type": "http.request", "body": body, "more_body": False}
        await fertig.wait()
        return {"type": "http.disconnect"}

    async def send(ereignis):
        if ereignis["type"] == "http.response.start":
            zustand["status"] = ereignis["status"]
            zustand["headers"] = {k.decode().lower(): v.decode() for k, v in ereignis.get("headers", [])}
        elif ereignis["type"] == "http.response.body":
            zustand["body"] += ereignis.get("body", b"")
            if not ereignis.get("more_body"):
                fertig.set()

    await app(scope, receive, send)
    return Antwort(zustand["status"], zustand["body"], zustand["headers"])


@pytest_asyncio.fixture
async def welt():
    """Anwendung, Konto mit Geraete-Passwort, Modul Kalender an."""
    from app.main import app
    from app.database import get_db
    from app.models import Base, CaldavToken, User, UserModule
    from app.routers.auth import _hash_pw, _buckets

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk(c, _):
        c.execute("PRAGMA foreign_keys=ON")

    # Die Rate-Limit-Zaehler leben im Prozess; ohne Leeren faerbt ein frueherer
    # Test diesen hier mit 429 ein.
    _buckets.clear()

    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    Sitzung = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Sitzung() as s:
        u = User(email="caldav@test.de", password_hash="x", name="Test", email_verified=True)
        s.add(u)
        await s.commit()
        s.add(UserModule(user_id=u.id, module_key="kalender"))
        s.add(CaldavToken(owner_id=u.id, name="Testgeraet", token_hash=_hash_pw(PASSWORT)))
        await s.commit()
        uid = u.id

    async def _db():
        async with Sitzung() as s:
            yield s

    app.dependency_overrides[get_db] = _db
    try:
        yield {"app": app, "user_id": uid, "sitzung": Sitzung}
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


def _kal(welt, name=""):
    return f"/api/caldav/p/{welt['user_id']}/kalender/" + name


@pytest.mark.asyncio
async def test_ohne_anmeldung_401_mit_aufforderung(welt):
    """Ohne WWW-Authenticate fragt kein Client nach Zugangsdaten — die
    Kontoeinrichtung bricht dann wortlos ab."""
    r = await _ruf(welt["app"], "PROPFIND", "/api/caldav/", auth=False)
    assert r.status == 401
    assert "basic" in r.headers.get("www-authenticate", "").lower()


@pytest.mark.asyncio
async def test_falsches_passwort_401(welt):
    marke = base64.b64encode(b"caldav@test.de:falsch").decode()
    r = await _ruf(welt["app"], "PROPFIND", "/api/caldav/", auth=False,
                   kopf={"authorization": f"Basic {marke}"})
    assert r.status == 401


@pytest.mark.asyncio
async def test_options_nennt_dav_faehigkeiten(welt):
    """Ohne die DAV-Kopfzeile haelt Apple den Server nicht fuer einen Kalender."""
    r = await _ruf(welt["app"], "OPTIONS", "/api/caldav/")
    assert r.status == 200
    assert "calendar-access" in r.headers.get("dav", "")


@pytest.mark.asyncio
async def test_browser_bekommt_klartext_statt_405(welt):
    """Wer die Adresse in den Browser tippt, soll erfahren, was sie ist.

    „Method Not Allowed" ist technisch richtig — ein Browser spricht kein
    CalDAV — liest sich aber wie ein Serverfehler und hat genau so schon einmal
    eine falsche Fehlersuche ausgeloest.
    """
    r = await _ruf(welt["app"], "GET", "/api/caldav/", auth=False)
    assert r.status == 200
    assert "CalDAV" in r.text and "Kalender-App" in r.text


@pytest.mark.asyncio
async def test_einrichtungskette(welt):
    """Wurzel -> Principal -> Kalender. Apple geht genau diese drei Schritte."""
    r = await _ruf(welt["app"], "PROPFIND", "/api/caldav/", kopf={"depth": 0}, body=(
        b'<D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>'))
    assert r.status == 207
    assert f"/api/caldav/p/{welt['user_id']}/" in r.text

    r = await _ruf(welt["app"], "PROPFIND", f"/api/caldav/p/{welt['user_id']}/", kopf={"depth": 0}, body=(
        b'<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">'
        b"<D:prop><C:calendar-home-set/></D:prop></D:propfind>"))
    assert r.status == 207 and "calendar-home-set" in r.text

    r = await _ruf(welt["app"], "PROPFIND", _kal(welt), kopf={"depth": 0}, body=(
        b'<D:propfind xmlns:D="DAV:" xmlns:CS="http://calendarserver.org/ns/">'
        b"<D:prop><D:resourcetype/><D:displayname/><CS:getctag/></D:prop></D:propfind>"))
    assert r.status == 207
    assert "<C:calendar/>" in r.text and "getctag" in r.text


@pytest.mark.asyncio
async def test_principal_ist_ein_principal_und_kein_kalender(welt):
    """Woran Apple die geglueckte Anmeldung erkennt.

    Der Principal muss `<D:principal/>` tragen. Gibt er sich stattdessen als
    Kalender aus, bricht die Kontoeinrichtung mit „Accountname/Passwort konnte
    nicht ueberprueft werden" ab — Apple sucht dort einen Principal und findet
    keinen. Genau so ist es beim ersten Anlauf am Mac passiert.
    """
    r = await _ruf(welt["app"], "PROPFIND", f"/api/caldav/p/{welt['user_id']}/",
                   kopf={"depth": 0}, body=(
        b'<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">'
        b"<D:prop><D:resourcetype/><D:principal-URL/><D:principal-collection-set/>"
        b"<C:calendar-home-set/></D:prop></D:propfind>"))
    assert r.status == 207
    assert "<D:principal/>" in r.text
    # Und NICHT als Kalender: sonst legt der Client die Sammlung selbst noch
    # einmal neben dem echten Kalender an.
    assert "<C:calendar/>" not in r.text
    assert "principal-collection-set" in r.text and "calendar-home-set" in r.text


@pytest.mark.asyncio
async def test_nur_der_kalender_ist_ein_kalender(welt):
    r = await _ruf(welt["app"], "PROPFIND", _kal(welt), kopf={"depth": 0}, body=(
        b'<D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>'))
    assert "<C:calendar/>" in r.text


@pytest.mark.asyncio
async def test_heim_listet_den_kalender(welt):
    """Apple zaehlt die Kalender ueber ein PROPFIND mit Depth: 1 auf dem
    calendar-home ab. Kommt dort keiner, ist das Konto leer."""
    r = await _ruf(welt["app"], "PROPFIND", f"/api/caldav/p/{welt['user_id']}/",
                   kopf={"depth": 1}, body=(
        b'<D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/><D:displayname/></D:prop></D:propfind>'))
    assert r.status == 207
    assert _kal(welt) in r.text and "<C:calendar/>" in r.text


@pytest.mark.asyncio
async def test_unbekannte_eigenschaft_kommt_im_richtigen_namensraum_zurueck(welt):
    """Ein CalDAV-Merkmal als <D:…> zurueckzumelden waere eine ANDERE
    Eigenschaft — der Client fragt sie dann bei jedem Abgleich erneut."""
    r = await _ruf(welt["app"], "PROPFIND", _kal(welt), kopf={"depth": 0}, body=(
        b'<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">'
        b"<D:prop><C:calendar-timezone/></D:prop></D:propfind>"))
    assert "<C:calendar-timezone/>" in r.text
    assert "404" in r.text


@pytest.mark.asyncio
async def test_fremder_principal_wird_abgewiesen(welt):
    """Der Zugang haengt am angemeldeten Konto, nicht am Pfad."""
    r = await _ruf(welt["app"], "PROPFIND", f"/api/caldav/p/{welt['user_id'] + 999}/kalender/",
                   kopf={"depth": 0})
    assert r.status == 403


@pytest.mark.asyncio
async def test_anlegen_lesen_aendern_loeschen(welt):
    ics = X.baue_vevent(uid="apple-1@example.com", tag=TAG, titel="Zahnarzt",
                        start_time="15:00", end_time="16:00").encode()
    r = await _ruf(welt["app"], "PUT", _kal(welt, "apple-1.ics"), body=ics,
                   kopf={"content-type": "text/calendar"})
    assert r.status == 201, r.text[:300]
    ort = r.headers.get("content-location") or _kal(welt, "apple-1.ics")

    # Der Termin ist wirklich in Nuvora angekommen — nicht nur im Protokoll.
    from app.models import CalendarEntry
    from sqlalchemy import select
    async with welt["sitzung"]() as s:
        zeilen = (await s.execute(select(CalendarEntry))).scalars().all()
        assert len(zeilen) == 1
        assert zeilen[0].title == "Zahnarzt" and zeilen[0].start_time == "15:00"
        # Die UID des Clients wird behalten: eine abgeleitete zurueckzugeben
        # hiesse, dass Apple den Termin beim naechsten Abgleich als zweiten,
        # fremden Termin ansieht.
        assert zeilen[0].caldav_uid == "apple-1@example.com"

    r = await _ruf(welt["app"], "GET", ort)
    assert r.status == 200 and "SUMMARY:Zahnarzt" in r.text
    etag = r.headers.get("etag")
    assert etag

    # Aendern mit passendem If-Match.
    neu = X.baue_vevent(uid="apple-1@example.com", tag=TAG, titel="Zahnarzt verschoben",
                        start_time="16:00", end_time="17:00").encode()
    r = await _ruf(welt["app"], "PUT", ort, body=neu, kopf={"if-match": etag})
    assert r.status == 204
    r = await _ruf(welt["app"], "GET", ort)
    assert "Zahnarzt verschoben" in r.text

    r = await _ruf(welt["app"], "DELETE", ort)
    assert r.status == 204
    r = await _ruf(welt["app"], "GET", ort)
    assert r.status == 404


@pytest.mark.asyncio
async def test_if_match_verhindert_ueberschreiben(welt):
    """Zwei Geraete am selben Termin ueberschrieben sich sonst gegenseitig,
    ohne dass eines davon etwas merkt."""
    ics = X.baue_vevent(uid="apple-2@example.com", tag=TAG, titel="A").encode()
    r = await _ruf(welt["app"], "PUT", _kal(welt, "apple-2.ics"), body=ics)
    ort = r.headers["content-location"]
    r = await _ruf(welt["app"], "PUT", ort,
                   body=X.baue_vevent(uid="apple-2@example.com", tag=TAG, titel="B").encode(),
                   kopf={"if-match": '"veraltet"'})
    assert r.status == 412


@pytest.mark.asyncio
async def test_unbekannte_wiederholung_wird_mit_grund_abgelehnt(welt):
    """Mit Vorbedingung, damit Apple sagen kann, WAS nicht ging — ein nacktes
    403 liest sich am Geraet als „keine Berechtigung"."""
    ics = X.baue_vevent(uid="apple-3@example.com", tag=TAG, titel="AG").replace(
        "SUMMARY:AG", "RRULE:FREQ=HOURLY\r\nSUMMARY:AG").encode()
    r = await _ruf(welt["app"], "PUT", _kal(welt, "apple-3.ics"), body=ics)
    assert r.status == 403 and "supported-calendar-data" in r.text


@pytest.mark.asyncio
async def test_serie_wird_gespeichert(welt):
    """Aus dem Handy angelegt, in Nuvora eine Serie — nicht ein einzelner Tag."""
    from app.models import CalendarEntry
    from sqlalchemy import select
    ics = X.baue_vevent(uid="apple-4@example.com", tag=TAG, titel="AG",
                        rrule="FREQ=WEEKLY", exdate=["20260908"], ort="Raum 12").encode()
    r = await _ruf(welt["app"], "PUT", _kal(welt, "apple-4.ics"), body=ics)
    assert r.status == 201
    async with welt["sitzung"]() as s:
        e = (await s.execute(select(CalendarEntry))).scalars().all()[-1]
        assert e.rrule == "FREQ=WEEKLY" and e.exdate == ["20260908"] and e.location == "Raum 12"


@pytest.mark.asyncio
async def test_propfind_tiefe_1_listet_die_termine(welt):
    await _ruf(welt["app"], "PUT", _kal(welt, "a.ics"),
               body=X.baue_vevent(uid="a@x", tag=TAG, titel="Eins").encode())
    await _ruf(welt["app"], "PUT", _kal(welt, "b.ics"),
               body=X.baue_vevent(uid="b@x", tag=TAG, titel="Zwei").encode())
    r = await _ruf(welt["app"], "PROPFIND", _kal(welt), kopf={"depth": 1}, body=(
        b'<D:propfind xmlns:D="DAV:"><D:prop><D:getetag/></D:prop></D:propfind>'))
    assert r.status == 207
    assert r.text.count("<D:getetag>") == 2       # die Sammlung selbst hat keins


@pytest.mark.asyncio
async def test_report_liefert_die_termine_mit_daten(welt):
    await _ruf(welt["app"], "PUT", _kal(welt, "a.ics"),
               body=X.baue_vevent(uid="a@x", tag=TAG, titel="Konferenz").encode())
    r = await _ruf(welt["app"], "REPORT", _kal(welt), kopf={"depth": 1}, body=(
        b'<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">'
        b"<D:prop><D:getetag/><C:calendar-data/></D:prop>"
        b'<C:filter><C:comp-filter name="VCALENDAR"/></C:filter></C:calendar-query>'))
    assert r.status == 207
    assert "Konferenz" in r.text and "calendar-data" in r.text


@pytest.mark.asyncio
async def test_report_zeitfenster_grenzt_ein(welt):
    await _ruf(welt["app"], "PUT", _kal(welt, "a.ics"),
               body=X.baue_vevent(uid="a@x", tag=date(2026, 1, 15), titel="Frueh").encode())
    await _ruf(welt["app"], "PUT", _kal(welt, "b.ics"),
               body=X.baue_vevent(uid="b@x", tag=date(2026, 8, 15), titel="Spaet").encode())
    r = await _ruf(welt["app"], "REPORT", _kal(welt), kopf={"depth": 1}, body=(
        b'<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">'
        b"<D:prop><C:calendar-data/></D:prop><C:filter><C:comp-filter name=\"VEVENT\">"
        b'<C:time-range start="20260801T000000Z" end="20260901T000000Z"/>'
        b"</C:comp-filter></C:filter></C:calendar-query>"))
    assert "Spaet" in r.text and "Frueh" not in r.text


@pytest.mark.asyncio
async def test_proppatch_speichert_farbe_und_reihenfolge(welt):
    """Apple stellt nach dem Einrichten Farbe und Reihenfolge ein.

    Kennt der Server PROPPATCH nicht, bricht der GANZE Abgleich ab — die
    Kalender-App meldet „Dies ist keine gueltige URL, die diese Anfrage
    unterstuetzt", und danach kommt auch keine Aenderung aus Nuvora mehr an.
    Es sieht aus wie ein Sync-Problem und ist eine fehlende Methode.
    """
    r = await _ruf(welt["app"], "PROPPATCH", _kal(welt), body=(
        b'<D:propertyupdate xmlns:D="DAV:" xmlns:I="http://apple.com/ns/ical/">'
        b"<D:set><D:prop><I:calendar-color>#FF2968FF</I:calendar-color>"
        b"<I:calendar-order>3</I:calendar-order></D:prop></D:set></D:propertyupdate>"))
    assert r.status == 207 and "200 OK" in r.text

    # Wirklich gespeichert, nicht nur bestaetigt: eine Farbe, die nach dem
    # Neustart weg ist, waere eine Antwort, die nicht stimmt.
    r = await _ruf(welt["app"], "PROPFIND", _kal(welt), kopf={"depth": 0}, body=(
        b'<D:propfind xmlns:D="DAV:" xmlns:I="http://apple.com/ns/ical/">'
        b"<D:prop><I:calendar-color/></D:prop></D:propfind>"))
    assert "#FF2968FF" in r.text


@pytest.mark.asyncio
async def test_proppatch_lehnt_fremde_eigenschaften_ab(welt):
    """403 statt eines stillen „gespeichert". Was wir nicht führen, soll der
    Client wissen, statt es bei jedem Abgleich neu zu versuchen."""
    r = await _ruf(welt["app"], "PROPPATCH", _kal(welt), body=(
        b'<D:propertyupdate xmlns:D="DAV:"><D:set><D:prop>'
        b"<D:gibtsnicht>x</D:gibtsnicht></D:prop></D:set></D:propertyupdate>"))
    assert r.status == 207 and "403 Forbidden" in r.text


@pytest.mark.asyncio
async def test_propfind_auf_einen_einzelnen_termin(welt):
    """Apple fasst zu einem gerade geschriebenen Termin einzeln nach."""
    put = await _ruf(welt["app"], "PUT", _kal(welt, "a.ics"),
                     body=X.baue_vevent(uid="a@x", tag=TAG, titel="Einzeln").encode())
    ort = put.headers["content-location"]
    r = await _ruf(welt["app"], "PROPFIND", ort, kopf={"depth": 0}, body=(
        b'<D:propfind xmlns:D="DAV:"><D:prop><D:getetag/></D:prop></D:propfind>'))
    assert r.status == 207 and "<D:getetag>" in r.text


@pytest.mark.asyncio
async def test_geloeschter_termin_verschwindet_aus_der_liste(welt):
    """Was in Nuvora gelöscht wird, muss im Handy verschwinden.

    Der Client merkt das am ctag und holt danach die Liste neu — steht der
    Termin dort weiter, bleibt er auf dem Gerät stehen.
    """
    from sqlalchemy import select
    from app.models import CalendarEntry

    await _ruf(welt["app"], "PUT", _kal(welt, "a.ics"),
               body=X.baue_vevent(uid="a@x", tag=TAG, titel="Wieder weg").encode())
    frage = b'<D:propfind xmlns:D="DAV:"><D:prop><D:getetag/></D:prop></D:propfind>'
    vorher = await _ruf(welt["app"], "PROPFIND", _kal(welt), kopf={"depth": 1}, body=frage)
    assert "<D:getetag>" in vorher.text

    # Löschen wie in der Weboberfläche — nicht über CalDAV.
    async with welt["sitzung"]() as s:
        eintrag = (await s.execute(select(CalendarEntry))).scalars().first()
        await s.delete(eintrag)
        await s.commit()

    nachher = await _ruf(welt["app"], "PROPFIND", _kal(welt), kopf={"depth": 1}, body=frage)
    assert nachher.text.count("<D:getetag>") == 0


async def _stundenplan(welt, weekday=0, period=1):
    """Eine Stundenplan-Stunde plus Uhrzeiten anlegen (wie in der Oberfläche)."""
    from app.models import TimetableSlot, User
    async with welt["sitzung"]() as s:
        u = await s.get(User, welt["user_id"])
        u.timetable_times = [{"start": "08:00", "end": "08:45"},
                             {"start": "08:50", "end": "09:35"}]
        u.timetable_periods = 2
        slot = TimetableSlot(owner_id=u.id, weekday=weekday, period=period, title="Mathe")
        s.add(slot)
        await s.commit()
        return slot.id


@pytest.mark.asyncio
async def test_stundenplan_stunden_stehen_im_kalender(welt):
    """Ohne sie stünde im Handy nur, was jemand von Hand angefasst hat.

    Der normale Unterricht ist der größte Teil des Tages; ein Kalender, der
    ihn nicht zeigt, ist im Gebrauch wertlos.
    """
    await _stundenplan(welt)
    r = await _ruf(welt["app"], "PROPFIND", _kal(welt), kopf={"depth": 1}, body=(
        b'<D:propfind xmlns:D="DAV:"><D:prop><D:getetag/></D:prop></D:propfind>'))
    assert r.status == 207
    assert "/slot-" in r.text, "keine Stundenplan-Stunde im Kalender"


@pytest.mark.asyncio
async def test_stunde_ist_getaktet_und_kein_tagestermin(welt):
    """Eine Unterrichtsstunde hat eine Uhrzeit. Ohne sie steht im Handy ein
    Tagesbalken statt einer Stunde — und der Tag sieht aus, als wäre nichts."""
    await _stundenplan(welt)
    r = await _ruf(welt["app"], "REPORT", _kal(welt), kopf={"depth": 1}, body=(
        b'<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">'
        b"<D:prop><C:calendar-data/></D:prop><C:filter><C:comp-filter name=\"VCALENDAR\"/>"
        b"</C:filter></C:calendar-query>"))
    assert "DTSTART:" in r.text and "T080000" in r.text
    assert "DTSTART;VALUE=DATE" not in r.text


@pytest.mark.asyncio
async def test_eintrag_aus_einer_stunde_behaelt_seine_uhrzeit(welt):
    """Der Fehler aus dem Gebrauch: „manche zeitlichen Termine sind plötzlich
    Tagestermine."

    Ein Eintrag, der aus dem Stundenplan entstanden ist, hat keine eigene
    Uhrzeit — er hat eine STUNDE. Ohne den Rückgriff auf deren Zeiten wurde er
    im Handy ganztägig, während er im Abo-Feed korrekt getaktet ankam.
    """
    from app.models import CalendarEntry
    await _stundenplan(welt)
    async with welt["sitzung"]() as s:
        s.add(CalendarEntry(owner_id=welt["user_id"], date=_wann(TAG), period=1,
                            title="Klassenarbeit"))
        await s.commit()
    r = await _ruf(welt["app"], "REPORT", _kal(welt), kopf={"depth": 1}, body=(
        b'<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">'
        b"<D:prop><C:calendar-data/></D:prop><C:filter><C:comp-filter name=\"VCALENDAR\"/>"
        b"</C:filter></C:calendar-query>"))
    assert "Klassenarbeit" in r.text
    zeile = [z for z in r.text.split("\n") if "Klassenarbeit" in z]
    assert "T080000" in r.text and "DTSTART;VALUE=DATE" not in r.text, zeile


@pytest.mark.asyncio
async def test_stunde_im_handy_loeschen_heisst_sie_faellt_aus(welt):
    """Eine Stundenplan-Stunde gibt es als Datensatz gar nicht.

    Was der Nutzer meint, wenn er sie wegwischt, kennt Nuvora aber: die Stunde
    entfällt an diesem Tag. Die Vorlage bleibt — nächste Woche steht sie wieder
    da.
    """
    from sqlalchemy import select
    from app.models import SlotCancellation, TimetableSlot

    slot_id = await _stundenplan(welt)
    liste = await _ruf(welt["app"], "PROPFIND", _kal(welt), kopf={"depth": 1}, body=(
        b'<D:propfind xmlns:D="DAV:"><D:prop><D:getetag/></D:prop></D:propfind>'))
    name = liste.text.split("/slot-")[1].split("<")[0]
    r = await _ruf(welt["app"], "DELETE", _kal(welt, "slot-" + name))
    assert r.status == 204

    async with welt["sitzung"]() as s:
        aus = (await s.execute(select(SlotCancellation))).scalars().all()
        assert len(aus) == 1 and aus[0].period == 1
        # Die Vorlage steht noch: gelöscht wurde ein Tag, nicht der Stundenplan.
        assert (await s.get(TimetableSlot, slot_id)) is not None

    # Und die Stunde ist an diesem Tag aus dem Kalender verschwunden.
    danach = await _ruf(welt["app"], "PROPFIND", _kal(welt), kopf={"depth": 1}, body=(
        b'<D:propfind xmlns:D="DAV:"><D:prop><D:getetag/></D:prop></D:propfind>'))
    assert ("slot-" + name) not in danach.text


@pytest.mark.asyncio
async def test_stunde_im_handy_bearbeiten_macht_daraus_einen_eintrag(welt):
    """Genau das, was ein Klick auf die Stunde in der Oberfläche tut — Klasse
    und Kurs kommen aus der Vorlage, damit der Termin dort hängt, wo er
    hingehört."""
    from sqlalchemy import select
    from app.models import CalendarEntry

    await _stundenplan(welt)
    liste = await _ruf(welt["app"], "PROPFIND", _kal(welt), kopf={"depth": 1}, body=(
        b'<D:propfind xmlns:D="DAV:"><D:prop><D:getetag/></D:prop></D:propfind>'))
    name = "slot-" + liste.text.split("/slot-")[1].split("<")[0]
    tag = date(int(name[-12:-8]), int(name[-8:-6]), int(name[-6:-4]))

    r = await _ruf(welt["app"], "PUT", _kal(welt, name),
                   body=X.baue_vevent(uid="apple-slot@x", tag=tag, titel="Vertretung",
                                      start_time="08:00", end_time="08:45").encode())
    assert r.status == 201
    async with welt["sitzung"]() as s:
        zeilen = (await s.execute(select(CalendarEntry))).scalars().all()
        assert len(zeilen) == 1
        assert zeilen[0].title == "Vertretung" and zeilen[0].period == 1


@pytest.mark.asyncio
async def test_zugang_stirbt_mit_dem_modul(welt):
    """Wie jeder ausgeteilte Zugang: ein Geraet laesst sich nicht einsammeln,
    also entscheidet der Server bei jedem Aufruf."""
    from app.models import UserModule
    from sqlalchemy import delete as sa_delete
    async with welt["sitzung"]() as s:
        await s.execute(sa_delete(UserModule).where(UserModule.user_id == welt["user_id"]))
        await s.commit()
    r = await _ruf(welt["app"], "PROPFIND", _kal(welt), kopf={"depth": 0})
    assert r.status == 403


@pytest.mark.asyncio
async def test_ctag_aendert_sich_nach_einer_aenderung(welt):
    """Daran erkennt der Client, dass ein Abgleich noetig ist. Bliebe er
    gleich, sähe das Handy die Aenderung erst beim naechsten Vollabgleich."""
    frage = (b'<D:propfind xmlns:D="DAV:" xmlns:CS="http://calendarserver.org/ns/">'
             b"<D:prop><CS:getctag/></D:prop></D:propfind>")
    vorher = (await _ruf(welt["app"], "PROPFIND", _kal(welt), kopf={"depth": 0}, body=frage)).text
    await _ruf(welt["app"], "PUT", _kal(welt, "a.ics"),
               body=X.baue_vevent(uid="a@x", tag=TAG, titel="Neu").encode())
    nachher = (await _ruf(welt["app"], "PROPFIND", _kal(welt), kopf={"depth": 0}, body=frage)).text
    assert vorher != nachher


# ─── Konfigurationsprofil (.mobileconfig) ───
#
# Der Ein-Klick-Weg auf iPhone und iPad. Geprueft wird das, was die Einrichtung
# scheitern liesse: der falsche Content-Type (dann bietet iOS die Installation
# gar nicht an), fehlende Angaben im Profil (dann steht ein halb eingerichtetes
# Konto im Geraet) — und dass die Adresse wirklich nur EINMAL traegt: sie
# enthaelt das Geraete-Passwort im Klartext.

@pytest.mark.asyncio
async def test_profil_liefert_ein_apple_profil_mit_allen_angaben(welt):
    from app.routers.caldav import _profil_merken
    token = _profil_merken(welt["user_id"], "iPhone", "geheim-1234")
    r = await _ruf(welt["app"], "GET", f"/api/caldav-zugaenge/profil/{token}", auth=False)
    assert r.status == 200
    # Ohne diesen Content-Type behandelt iOS die Datei als Download und der
    # Installationsdialog kommt nie.
    assert r.headers.get("content-type", "").startswith("application/x-apple-aspen-config")
    text = r.body.decode()
    assert "com.apple.caldav.account" in text
    assert "<string>caldav@test.de</string>" in text          # Benutzername
    assert "<string>geheim-1234</string>" in text             # Passwort
    assert f"/api/caldav/p/{welt['user_id']}/" in text        # Serverpfad
    assert "<key>CalDAVPort</key>" in text


@pytest.mark.asyncio
async def test_profil_traegt_nur_einmal(welt):
    """Die Adresse enthaelt das Passwort im Klartext — der zweite Abruf muss
    ins Leere laufen, sonst waere ein weitergegebener Link ein Dauerzugang."""
    from app.routers.caldav import _profil_merken
    token = _profil_merken(welt["user_id"], "iPhone", "geheim-1234")
    assert (await _ruf(welt["app"], "GET", f"/api/caldav-zugaenge/profil/{token}", auth=False)).status == 200
    assert (await _ruf(welt["app"], "GET", f"/api/caldav-zugaenge/profil/{token}", auth=False)).status == 404


@pytest.mark.asyncio
async def test_profil_laeuft_ab(welt):
    import app.routers.caldav as X
    token = X._profil_merken(welt["user_id"], "iPhone", "geheim-1234")
    ablauf, *rest = X._PROFILE[token]
    X._PROFILE[token] = (0.0, *rest)
    assert (await _ruf(welt["app"], "GET", f"/api/caldav-zugaenge/profil/{token}", auth=False)).status == 404


@pytest.mark.asyncio
async def test_profil_unbekannter_token_404(welt):
    r = await _ruf(welt["app"], "GET", "/api/caldav-zugaenge/profil/gibtesnicht", auth=False)
    assert r.status == 404


@pytest.mark.asyncio
async def test_profil_stirbt_mit_dem_modul(welt):
    """Wie jeder ausgeteilte Zugang: ohne das Modul Kalender richtet das Profil
    ein Konto ein, das sofort 403 bekaeme."""
    from sqlalchemy import delete
    from app.models import UserModule
    from app.routers.caldav import _profil_merken
    token = _profil_merken(welt["user_id"], "iPhone", "geheim-1234")
    async with welt["sitzung"]() as s:
        await s.execute(delete(UserModule).where(UserModule.user_id == welt["user_id"]))
        await s.commit()
    r = await _ruf(welt["app"], "GET", f"/api/caldav-zugaenge/profil/{token}", auth=False)
    assert r.status == 404
