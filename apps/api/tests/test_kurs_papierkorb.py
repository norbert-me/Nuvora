"""Kurse: löschen (Papierkorb, 30 Tage) + lose Mehrfach-Zuordnung (Tags).

Löschen entgruppiert die Sharing-Klassen (jede bekommt einen eigenen Kurs) und
legt den Kurs in den Papierkorb; Wiederherstellen gruppiert sie zurück. Tags =
zusätzliche, nicht teilende Zugehörigkeit (kein SuS/Anwesenheit-Sharing).
"""
import pytest
import pytest_asyncio
from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, User, SchoolClass
from app.routers import kurse as K, classes as clsr


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
    u = User(email="a@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    c1 = await clsr.create_class(clsr.ClassCreate(name="Mathe 7.5"), user=u, db=s)
    c2 = await clsr.create_class(clsr.ClassCreate(name="Lernzeit 7.5"), user=u, db=s)
    c3 = await clsr.create_class(clsr.ClassCreate(name="Förderband"), user=u, db=s)
    return u, c1.id, c2.id, c3.id, c1.kurs_id


@pytest.mark.asyncio
async def test_tags_und_sharing_getrennt(s):
    u, c1, c2, c3, kid = await _setup(s)
    await K.assign_class(kid, c2, user=u, db=s)   # sharing
    await K.add_tag(kid, c3, user=u, db=s)        # loses Tag
    k = [x for x in await K.list_kurse(user=u, db=s) if x.id == kid][0]
    assert {c.id for c in k.classes if c.shared} == {c1, c2}
    assert {c.id for c in k.classes if not c.shared} == {c3}


@pytest.mark.asyncio
async def test_loeschen_und_restore(s):
    u, c1, c2, c3, kid = await _setup(s)
    await K.assign_class(kid, c2, user=u, db=s)
    await K.delete_kurs(kid, user=u, db=s)
    assert not [x for x in await K.list_kurse(user=u, db=s) if x.id == kid]
    assert [x for x in await K.list_kurs_trash(user=u, db=s) if x.id == kid]
    # entgruppiert
    assert (await s.get(SchoolClass, c1)).kurs_id != kid
    assert (await s.get(SchoolClass, c2)).kurs_id != kid
    # restore gruppiert zurück
    await K.restore_kurs(kid, user=u, db=s)
    assert (await s.get(SchoolClass, c1)).kurs_id == kid
    assert (await s.get(SchoolClass, c2)).kurs_id == kid
