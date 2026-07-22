"""Modul Kalender: der Stundenplan-Slot merkt sich den GEWÄHLTEN Kurs (kurs_id),
nicht nur die Fach-Klasse. Eine Klasse kann in mehreren Kursen liegen — ohne
kurs_id riete die Anzeige den falschen Kurs (Bug: Kurs „mathe 7.5" gewählt,
Plan zeigt Klassenname „7.5 LZ").
"""
import pytest
import pytest_asyncio
from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, User, SchoolClass, Kurs, KursTag
from app.routers import kalender as KAL


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


@pytest.mark.asyncio
async def test_slot_behaelt_kurs(s):
    u = User(email="a@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    cls = SchoolClass(name="7.5 LZ", owner_id=u.id); s.add(cls); await s.flush()
    kurs = Kurs(owner_id=u.id, name="mathe 7.5"); s.add(kurs); await s.flush()
    s.add(KursTag(kurs_id=kurs.id, class_id=cls.id)); await s.commit()

    body = KAL.SlotIn(weekday=0, period=1, class_id=cls.id, kurs_id=kurs.id)
    out = await KAL.upsert_slot(body, user=u, db=s)
    assert out.class_id == cls.id and out.kurs_id == kurs.id

    tt = await KAL.get_timetable(user=u, db=s)
    slot = tt["slots"][0]
    assert slot.kurs_id == kurs.id   # Anzeige kann so „mathe 7.5" auflösen

    # Fremder Kurs wird abgewiesen (Owner-Check).
    v = User(email="v@b.de", password_hash="x", name="V"); s.add(v); await s.flush()
    fremd = Kurs(owner_id=v.id, name="fremd"); s.add(fremd); await s.commit()
    with pytest.raises(Exception):
        await KAL.upsert_slot(KAL.SlotIn(weekday=1, period=1, class_id=cls.id, kurs_id=fremd.id), user=u, db=s)
