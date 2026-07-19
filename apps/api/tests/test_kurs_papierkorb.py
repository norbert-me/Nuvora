"""Kurse: Mehrfach-Mitgliedschaft (Klasse in mehreren Kursen) + Papierkorb.

Mitgliedschaft ist many-to-many (kurs_tags): eine Klasse kann in mehreren Kursen
sein. Kurs löschen entfernt nur die Mitgliedschaften dieses Kurses (Klassen
bleiben, ggf. in anderen Kursen) und legt ihn 30 Tage in den Papierkorb.
"""
import pytest
import pytest_asyncio
from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, User
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
    return u, c1.id


@pytest.mark.asyncio
async def test_klasse_in_mehreren_kursen(s):
    u, c1 = await _setup(s)
    k1 = await K.create_kurs(K.KursIn(name="7.5"), user=u, db=s)
    k2 = await K.create_kurs(K.KursIn(name="Abschlussjahrgang"), user=u, db=s)
    await K.add_member(k1.id, c1, user=u, db=s)
    await K.add_member(k2.id, c1, user=u, db=s)
    lst = await K.list_kurse(user=u, db=s)
    in_k1 = {c.id for c in next(x for x in lst if x.id == k1.id).classes}
    in_k2 = {c.id for c in next(x for x in lst if x.id == k2.id).classes}
    assert c1 in in_k1 and c1 in in_k2, "Klasse in beiden Kursen"


@pytest.mark.asyncio
async def test_loeschen_und_restore(s):
    u, c1 = await _setup(s)
    k1 = await K.create_kurs(K.KursIn(name="7.5"), user=u, db=s)
    await K.add_member(k1.id, c1, user=u, db=s)
    await K.delete_kurs(k1.id, user=u, db=s)
    assert not [x for x in await K.list_kurse(user=u, db=s) if x.id == k1.id], "aus Liste weg"
    assert [x for x in await K.list_kurs_trash(user=u, db=s) if x.id == k1.id], "im Papierkorb"
    await K.restore_kurs(k1.id, user=u, db=s)
    back = next(x for x in await K.list_kurse(user=u, db=s) if x.id == k1.id)
    assert c1 in {c.id for c in back.classes}, "Mitglied nach Restore zurück"


@pytest.mark.asyncio
async def test_entfernen_bleibt_in_anderem_kurs(s):
    u, c1 = await _setup(s)
    k1 = await K.create_kurs(K.KursIn(name="A"), user=u, db=s)
    k2 = await K.create_kurs(K.KursIn(name="B"), user=u, db=s)
    await K.add_member(k1.id, c1, user=u, db=s)
    await K.add_member(k2.id, c1, user=u, db=s)
    await K.remove_member(k1.id, c1, user=u, db=s)
    lst = await K.list_kurse(user=u, db=s)
    assert c1 not in {c.id for c in next(x for x in lst if x.id == k1.id).classes}
    assert c1 in {c.id for c in next(x for x in lst if x.id == k2.id).classes}
