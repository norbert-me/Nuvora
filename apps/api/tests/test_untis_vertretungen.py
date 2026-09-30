"""Vertretungen aus dem Untis-Abo im Kalender.

Der Abo-Link liefert den ganzen Plan; gezeigt wird nur, was davon abweicht —
sonst stuende jede Stunde doppelt neben dem Stundenplan. Angezeigt, nicht
geschrieben: faellt die Vertretung in Untis weg, ist sie beim naechsten Abruf
auch hier weg.
"""
from datetime import date, timedelta

import pytest

import app.routers.kalender as K
from app.models import TimetableSlot, User

UNTIS = "https://untis.example/ical/abo.ics"


def _montag(woche):
    heute = date.today()
    return heute - timedelta(days=heute.weekday()) + timedelta(weeks=woche)


def _ev(tag, titel, zeit="060000"):
    d = tag.strftime("%Y%m%d")
    return (f"BEGIN:VEVENT\r\nUID:{d}{titel}\r\nDTSTART:{d}T{zeit}Z\r\n"
            f"DTEND:{d}T064500Z\r\nSUMMARY:{titel}\r\nEND:VEVENT\r\n")


def _feed(*events):
    return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n" + "".join(events) + "END:VCALENDAR\r\n"


FEED = {"text": ""}


@pytest.fixture(autouse=True)
def _kein_netz(monkeypatch):
    K._EXT_CACHE.clear()
    monkeypatch.setattr(K, "_fetch_ics", lambda url, **kw: FEED["text"])


async def _user(s, **kw):
    u = User(email="untis@test.de", password_hash="x", untis_ics_url=UNTIS,
             timetable_times=[{"start": "08:00", "end": "08:45"}, {"start": "08:50", "end": "09:35"}], **kw)
    s.add(u)
    await s.commit()
    return u


@pytest.mark.asyncio
async def test_nur_die_abweichung_erscheint(s):
    FEED["text"] = _feed(*[_ev(_montag(w), "M 7.5") for w in (-2, -1, 1)],
                         _ev(_montag(0), "E 9.2"))
    u = await _user(s)
    rows = await K.externe_ereignisse(u, db=s)
    assert [(r["date"], r["title"]) for r in rows] == [(_montag(0).isoformat(), "Vertretung: E 9.2")]
    assert rows[0]["time"] == "08:00" and rows[0]["cal"] == UNTIS


@pytest.mark.asyncio
async def test_eigener_plan_macht_regulaer(s):
    # Nur eine Woche im Feed: das Muster traegt nicht, der eigene Plan schon.
    FEED["text"] = _feed(_ev(_montag(0), "M 7.5"))
    u = await _user(s)
    s.add(TimetableSlot(owner_id=u.id, weekday=0, period=1, title="M 7.5"))
    await s.commit()
    assert await K.externe_ereignisse(u, db=s) == []


@pytest.mark.asyncio
async def test_ohne_abo_link_nichts(s):
    FEED["text"] = _feed(_ev(_montag(0), "E 9.2"))
    u = await _user(s)
    u.untis_ics_url = None
    await s.commit()
    assert await K.externe_ereignisse(u, db=s) == []
    assert (await K.get_external(u))["untis"] is False
