"""Fuenf Loecher aus dem Sicherheitsdurchgang — je eins, das wieder zufallen soll.

Kein Sammelbecken fuer „Sicherheit allgemein": jeder Test haelt genau eine
Entscheidung fest, die schon einmal falsch war, und sagt im Namen, welche.
"""
import json

import pytest

from app.models import (CalendarEntry, Folder, QuestionSet, SchoolClass, Student,
                        User, UserModule)


# ── 1) Der ICS-Feed verstummt mit dem Modul ──────────────────────────────────
@pytest.mark.asyncio
async def test_ics_feed_verstummt_mit_dem_modul(s):
    """Ein Abo liegt im Handy und laesst sich nicht einsammeln — also
    entscheidet der Server bei jedem Abruf neu.

    Das CalDAV-Gegenstueck nebenan tat das seit jeher; der Feed nicht, und
    lieferte nach dem Abschalten weiter Termine samt Kurs- und Klassennamen.
    """
    from fastapi import HTTPException

    from app.routers.kalender import ics_feed

    class _Req:
        headers: dict = {}

    u = User(email="feed-modul@test.de", password_hash="x", calendar_token="tokmod")
    s.add(u)
    await s.flush()
    s.add(CalendarEntry(owner_id=u.id, date=__import__("datetime").datetime(2026, 3, 3),
                        title="Geheime Konferenz"))
    modul = UserModule(user_id=u.id, module_key="kalender")
    s.add(modul)
    await s.commit()

    # Mit Modul: der Termin steht drin.
    r = await ics_feed("tokmod", _Req(), s)
    assert "Geheime Konferenz" in r.body.decode()

    # Ohne Modul: derselbe, gueltige Token bekommt nichts mehr — und zwar
    # dieselbe Meldung wie ein unbekannter Token. Nach aussen darf nicht
    # erkennbar sein, welche Module eine Lehrkraft nutzt.
    await s.delete(modul)
    await s.commit()
    with pytest.raises(HTTPException) as e:
        await ics_feed("tokmod", _Req(), s)
    assert e.value.status_code == 404

    with pytest.raises(HTTPException) as unbekannt:
        await ics_feed("gibtesnicht", _Req(), s)
    assert unbekannt.value.detail == e.value.detail


# ── 2) Wer nicht ausgewiesen ist, hoert nicht mit ────────────────────────────
@pytest.mark.asyncio
async def test_websocket_verteilt_nur_an_ausgewiesene():
    """Die Sitzungsnummer ist eine fortlaufende Zahl.

    Vorher trug `connect` jede angenommene Verbindung sofort in die
    Verteilerliste ein; der Token entschied nur, wer SENDEN darf. Wer
    /ws/session/<n> durchzaehlte, sah ohne Anmeldung live mit, welche Karte in
    einer fremden Klasse gerade welche Antwort abgibt.
    """
    from app import websocket as ws

    class _Ws:
        def __init__(self):
            self.gehoert = []

        async def send_text(self, m):
            self.gehoert.append(json.loads(m))

    lauscher, besitzer = _Ws(), _Ws()
    ws.connections[4711] = [lauscher, besitzer]
    try:
        ws.freigeben(besitzer)           # nur dieser hat sich ausgewiesen
        await ws.broadcast(4711, {"type": "scan", "student_id": 3, "answer": "B"})
        assert besitzer.gehoert, "Der ausgewiesene Host muss die Scans bekommen"
        assert lauscher.gehoert == [], "Eine nicht ausgewiesene Leitung bekommt nichts"
    finally:
        ws.disconnect(4711, besitzer)
        ws.disconnect(4711, lauscher)
    # Und das Abmelden raeumt die Ausweis-Liste mit ab, sonst waechst sie ewig.
    assert besitzer not in ws.authentifiziert


# ── 3) Ein Frageset wandert nicht in einen fremden Ordner ────────────────────
async def _zwei_konten(s):
    a = User(email="a-ordner@test.de", password_hash="x")
    b = User(email="b-ordner@test.de", password_hash="x")
    s.add_all([a, b])
    await s.flush()
    fremd = Folder(name="Bs Ablage", owner_id=b.id)
    s.add(fremd)
    await s.commit()
    return a, b, fremd


@pytest.mark.asyncio
async def test_frageset_kann_nicht_in_fremden_ordner_gelegt_werden(s):
    """Der Ordner entscheidet spaeter ueber den Zugriff (`ensure_set_access`).

    Ein Set in fremder Ablage steht im Baum des anderen Kontos — samt
    Fragentext und richtiger Antwort — und das eigene Konto verliert zugleich
    den Zugriff darauf. Beim Anlegen UND beim Verschieben.
    """
    from fastapi import HTTPException

    from app.routers.folders import (QuestionSetCreate, create_question_set,
                                     update_question_set)

    a, b, fremd = await _zwei_konten(s)

    body = QuestionSetCreate(name="Probe", folder_id=fremd.id, question_ids=[])
    with pytest.raises(HTTPException) as e:
        await create_question_set(body, a, s)
    assert e.value.status_code == 404

    # Der eigene Ordner geht weiterhin — die Schranke darf nicht alles sperren.
    eigen = Folder(name="As Ablage", owner_id=a.id)
    s.add(eigen)
    await s.commit()
    qs = await create_question_set(
        QuestionSetCreate(name="Probe", folder_id=eigen.id, question_ids=[]), a, s)
    set_id = qs["id"] if isinstance(qs, dict) else qs.id

    # ... und das Verschieben in die fremde Ablage ebenso wenig.
    with pytest.raises(HTTPException) as e2:
        await update_question_set(
            set_id, QuestionSetCreate(name="Probe", folder_id=fremd.id, question_ids=[]), a, s)
    assert e2.value.status_code == 404


# ── 4) Ein uebernommenes Quiz gehoert dem, der es uebernimmt ─────────────────
@pytest.mark.asyncio
async def test_marktplatz_uebernahme_setzt_den_besitzer(s):
    """`ensure_set_access` laesst besitzerlose Sets als Altbestand durch.

    Die Uebernahme legte bisher genau solche an — jede Uebernahme fuellte den
    Topf der fuer JEDES Konto lesbaren Datensaetze neu auf. Die beiden anderen
    Importwege setzen `owner_id` mit genau dieser Begruendung.
    """
    from sqlalchemy import select

    from app.models import MarketplaceQuiz
    from app.routers.marketplace import copy_quiz

    u = User(email="uebernehmer@test.de", password_hash="x")
    s.add(u)
    await s.flush()
    s.add(UserModule(user_id=u.id, module_key="cardvote"))
    s.add(MarketplaceQuiz(
        kind="cardvote_questionset", title="Geteiltes Quiz", payload={"questions": [
            {"text": "1+1?", "choices": {"A": "2", "B": "3", "C": "4", "D": "5"},
             "correct_answer": "A"}]}))
    await s.commit()
    quiz = (await s.execute(select(MarketplaceQuiz))).scalar_one()

    await copy_quiz(quiz.id, None, u, s)

    kopie = (await s.execute(select(QuestionSet))).scalars().all()
    assert len(kopie) == 1
    assert kopie[0].owner_id == u.id, (
        "Das uebernommene Frageset hat keinen Besitzer — damit ist es fuer "
        "jedes Konto lesbar und aenderbar."
    )


# ── 5) Ein Wagenruecklauf zerlegt keinen Kalender ────────────────────────────
def test_ics_escape_entschaerft_auch_den_wagenruecklauf():
    """ICS trennt Zeilen mit CRLF.

    Ein einzelnes \\r aus einem Titel, einer Notiz oder einem Ort beendete den
    VEVENT mitten im Feld; der Rest galt dem Client als eigene Property. Die
    Regel steht doppelt (hier und in routers/kalender.py) und muss dieselbe
    bleiben — genau das war sie nicht mehr.
    """
    from app.caldav import _ics_escape as caldav_escape
    from app.routers.kalender import _ics_escape as feed_escape

    for roh in ("Titel\rSUMMARY:untergeschoben", "a\r\nb", "a\nb", "a;b,c\\d"):
        assert "\r" not in caldav_escape(roh)
        assert "\n" not in caldav_escape(roh)
        # Beide Fassungen muessen dasselbe liefern, sonst laufen sie wieder
        # auseinander.
        assert caldav_escape(roh) == feed_escape(roh), roh
