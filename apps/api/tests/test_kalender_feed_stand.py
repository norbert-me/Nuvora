"""Modul Kalender, Abo-Feed: der Stand zaehlt nur mit, wenn sich der INHALT
aendert.

Warum das ein eigener Test ist: ein ICS-Abo wird vom Kalender GEHOLT, nicht
geschickt. Der einzige Hebel, den Nuvora hat, ist die Auslieferung selbst —
Apple merkt sich Art und Dauer eines Ereignisses pro UID und uebernimmt eine
Korrektur nur, wenn die `SEQUENCE` gestiegen ist. Ein Zaehler, den die 15
Schreib-Endpunkte pflegen muessten, waere frueher oder spaeter an einem davon
vergessen worden; deshalb bildet der Feed einen Fingerabdruck seines eigenen
Inhalts. Genau zwei Dinge muessen daran stimmen, und beide stehen hier:

  * ein zweiter Abruf OHNE Aenderung darf die Revision NICHT hochzaehlen
    (sonst laeuft SEQUENCE bei jedem Abruf hoch und der Client baut jeden
    Termin staendig neu),
  * ein Abruf NACH einer Aenderung muss sie hochzaehlen (sonst bleibt die
    Korrektur im Handy unsichtbar — das gemeldete Fehlerbild).
"""
from datetime import datetime

import pytest
import pytest_asyncio
from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, User, CalendarEntry
from app.routers.kalender import ics_feed


class _Req:
    """Nur so viel Request, wie der Feed anfasst (Kopfzeilen fuer If-None-Match)."""

    def __init__(self, headers=None):
        self.headers = headers or {}


@pytest_asyncio.fixture
async def s():
    e = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(e.sync_engine, "connect")
    def _fk(c, _):
        c.execute("PRAGMA foreign_keys=ON")

    async with e.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(e, class_=AsyncSession, expire_on_commit=False)() as ss:
        yield ss
    await e.dispose()


async def _user(s):
    u = User(email="feed@test.de", password_hash="x", calendar_token="tok123")
    s.add(u)
    await s.commit()
    return u


@pytest.mark.asyncio
async def test_gleicher_inhalt_zaehlt_nicht_hoch(s):
    u = await _user(s)
    s.add(CalendarEntry(owner_id=u.id, date=datetime(2026, 3, 3), title="Probe"))
    await s.commit()

    r1 = await ics_feed("tok123", _Req(), s)
    rev1 = u.calendar_rev
    assert rev1 == 1                      # erster Abruf: Inhalt ist neu
    assert "SEQUENCE:1" in r1.body.decode()
    geaendert1 = u.calendar_changed_at

    r2 = await ics_feed("tok123", _Req(), s)
    assert u.calendar_rev == rev1         # nichts passiert, nichts gezaehlt
    assert u.calendar_changed_at == geaendert1
    assert "SEQUENCE:1" in r2.body.decode()
    # ... der Abruf selbst wird aber festgehalten.
    assert u.calendar_fetched_at is not None


@pytest.mark.asyncio
async def test_aenderung_zaehlt_hoch_und_liegt_schon_in_dieser_auslieferung(s):
    u = await _user(s)
    e = CalendarEntry(owner_id=u.id, date=datetime(2026, 3, 3), title="Probe")
    s.add(e)
    await s.commit()
    await ics_feed("tok123", _Req(), s)

    e.title = "Probe (verschoben)"
    await s.commit()
    r = await ics_feed("tok123", _Req(), s)
    text = r.body.decode()
    assert u.calendar_rev == 2
    # Die frisch gezaehlte Revision muss in DIESER Antwort stehen — mit der
    # alten SEQUENCE waere die Aenderung fuer Apple keine.
    assert "SEQUENCE:2" in text and "SEQUENCE:1" not in text
    assert "Probe (verschoben)" in text


@pytest.mark.asyncio
async def test_unveraendert_beantwortet_der_feed_mit_304(s):
    u = await _user(s)
    s.add(CalendarEntry(owner_id=u.id, date=datetime(2026, 3, 3), title="Probe"))
    await s.commit()

    r1 = await ics_feed("tok123", _Req(), s)
    etag = r1.headers["ETag"]
    r2 = await ics_feed("tok123", _Req({"if-none-match": etag}), s)
    assert r2.status_code == 304

    # Nach einer Aenderung passt der alte ETag nicht mehr: volle Antwort.
    s.add(CalendarEntry(owner_id=u.id, date=datetime(2026, 3, 4), title="Zweiter"))
    await s.commit()
    r3 = await ics_feed("tok123", _Req({"if-none-match": etag}), s)
    assert r3.status_code == 200 and "Zweiter" in r3.body.decode()
