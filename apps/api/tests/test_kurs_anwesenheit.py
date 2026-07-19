"""Kurs-Konzept Phase 2: Anwesenheit wird über den Kurs geteilt.

Zwei Fach-Klassen (Mathe 7.5, Lernzeit 7.5) im selben Kurs teilen sich die SuS
(per Name) für die Anwesenheit. In Mathe markiert = in Lernzeit sichtbar, eine
kanonische Zeile. Karten/Noten bleiben pro Klasse (nicht hier geprüft).
"""
from datetime import datetime

import pytest
import pytest_asyncio
from sqlalchemy import event, select, func
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, User, SchoolClass, Student, Kurs, Attendance
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


async def _kurs_zwei_klassen(s):
    u = User(email="a@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    k = Kurs(owner_id=u.id, name="7.5"); s.add(k); await s.flush()
    A = SchoolClass(name="Mathe 7.5", owner_id=u.id, kurs_id=k.id); s.add(A)
    B = SchoolClass(name="Lernzeit 7.5", owner_id=u.id, kurs_id=k.id); s.add(B); await s.flush()
    a = Student(card_id=1, name="Max", class_id=A.id, kurs_id=k.id); s.add(a)
    b = Student(card_id=1, name="Max", class_id=B.id, kurs_id=k.id); s.add(b); await s.flush()
    await s.commit()
    return u, A, B, a, b


@pytest.mark.asyncio
async def test_anwesenheit_kursweit_geteilt(s):
    u, A, B, a, b = await _kurs_zwei_klassen(s)
    d = datetime(2026, 7, 20)
    await an.mark(A.id, an.MarkIn(student_id=a.id, date=d, status="fehlt", period=1), user=u, db=s)
    # In Lernzeit (B) sichtbar, unter B's eigener student_id.
    m = await an.get_day(B.id, date=d, period=1, user=u, db=s)
    assert m.get(str(b.id), {}).get("status") == "fehlt"
    # Nur EINE kanonische Zeile für beide.
    assert (await s.execute(select(func.count()).select_from(Attendance))).scalar() == 1
    # Fehlzeiten in B auf B's id.
    assert (await an.summary(B.id, user=u, db=s)).get(str(b.id), {}).get("fehlt") == 1


@pytest.mark.asyncio
async def test_da_ueber_geschwisterklasse_loescht(s):
    u, A, B, a, b = await _kurs_zwei_klassen(s)
    d = datetime(2026, 7, 20)
    await an.mark(A.id, an.MarkIn(student_id=a.id, date=d, status="fehlt", period=1), user=u, db=s)
    await an.mark(B.id, an.MarkIn(student_id=b.id, date=d, status="da", period=1), user=u, db=s)
    assert (await s.execute(select(func.count()).select_from(Attendance))).scalar() == 0
