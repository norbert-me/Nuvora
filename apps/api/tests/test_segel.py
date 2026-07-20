"""SEGEL-Stufen am Sitzplatz: je SuS/Kurs, owner-scoped, gueltige Stufen.

Stufen Hafen/Küste/Meer/Welt (Helios-Konzept). Setzen ist Upsert; fremde Klasse
ist tabu; ungueltige Stufe wird abgewiesen.
"""
import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, User, SchoolClass, Student
from app.routers import sitzplan as SP


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


async def _setup(s):
    u = User(email="a@b.de", password_hash="x", name="A"); s.add(u); await s.flush()
    cls = SchoolClass(name="7a", owner_id=u.id); s.add(cls); await s.flush()
    st = Student(card_id=1, name="Max", class_id=cls.id); s.add(st); await s.commit()
    return u, cls, st


@pytest.mark.asyncio
async def test_setzen_und_lesen_upsert(s):
    u, cls, st = await _setup(s)
    await SP.set_segel(cls.id, SP.SegelIn(student_id=st.id, stage="hafen"), user=u, db=s)
    assert (await SP.get_segel(cls.id, user=u, db=s)) == {str(st.id): "hafen"}
    # Upsert: gleiche Zeile, neue Stufe
    await SP.set_segel(cls.id, SP.SegelIn(student_id=st.id, stage="welt"), user=u, db=s)
    assert (await SP.get_segel(cls.id, user=u, db=s)) == {str(st.id): "welt"}
    # Leeren
    await SP.set_segel(cls.id, SP.SegelIn(student_id=st.id, stage=""), user=u, db=s)
    assert (await SP.get_segel(cls.id, user=u, db=s)) == {}


@pytest.mark.asyncio
async def test_ungueltige_stufe(s):
    u, cls, st = await _setup(s)
    with pytest.raises(HTTPException) as ei:
        await SP.set_segel(cls.id, SP.SegelIn(student_id=st.id, stage="ozean"), user=u, db=s)
    assert ei.value.status_code == 400


@pytest.mark.asyncio
async def test_fremde_klasse_verboten(s):
    u, cls, st = await _setup(s)
    v = User(email="v@b.de", password_hash="x", name="V"); s.add(v); await s.commit()
    with pytest.raises(HTTPException) as ei:
        await SP.set_segel(cls.id, SP.SegelIn(student_id=st.id, stage="meer"), user=v, db=s)
    assert ei.value.status_code == 403
