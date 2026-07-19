"""Anwesenheit pro Stunde: Vorbelegen aus der vorherigen Stunde + Tages-Dedup.

Wer in der 1. Stunde fehlt, fehlt oft auch später. Beim Öffnen einer späteren
Stunde übernimmt der Server den Status aus der letzten erfassten Stunde (und
persistiert ihn), die Lehrkraft prüft nur. Mehrere Stunden am selben Tag sind
EINE Abwesenheit (Fehlzeiten-Zählung, Verlauf).
"""
from datetime import datetime

import pytest
import pytest_asyncio
from sqlalchemy import event, select, func
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, User, SchoolClass, Student, Attendance
from app.routers import anwesenheit as an


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


async def _seed(s):
    u = User(email="a@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    c = SchoolClass(name="7a", owner_id=u.id); s.add(c); await s.flush()
    st = Student(card_id=1, name="Max", class_id=c.id); s.add(st); await s.flush()
    await s.commit()
    return u, c, st


@pytest.mark.asyncio
async def test_vorbelegen_und_dedup(s):
    u, c, st = await _seed(s)
    d = datetime(2026, 7, 20)
    await an.mark(c.id, an.MarkIn(student_id=st.id, date=d, status="fehlt", period=1), user=u, db=s)
    # Stunde 3 öffnen -> aus Stunde 1 übernommen und persistiert.
    m = await an.get_day(c.id, date=d, period=3, user=u, db=s)
    assert m[str(st.id)]["status"] == "fehlt" and m[str(st.id)]["period"] == 3
    assert (await s.execute(select(func.count()).select_from(Attendance))).scalar() == 2
    # Fehlzeiten: 1 Tag, nicht 2.
    assert (await an.summary(c.id, user=u, db=s))[str(st.id)]["fehlt"] == 1
    assert len(await an.student_history(c.id, st.id, user=u, db=s)) == 1
    # Tagesansicht (ohne Stunde) zeigt den stärksten Status.
    assert (await an.get_day(c.id, date=d, user=u, db=s))[str(st.id)]["status"] == "fehlt"


@pytest.mark.asyncio
async def test_da_loescht_nur_diese_stunde(s):
    u, c, st = await _seed(s)
    d = datetime(2026, 7, 20)
    await an.mark(c.id, an.MarkIn(student_id=st.id, date=d, status="fehlt", period=1), user=u, db=s)
    await an.get_day(c.id, date=d, period=3, user=u, db=s)  # legt P3 an
    await an.mark(c.id, an.MarkIn(student_id=st.id, date=d, status="da", period=3), user=u, db=s)
    # Nur P3 weg, P1 bleibt.
    assert (await s.execute(select(func.count()).select_from(Attendance))).scalar() == 1
