"""Kurs-Konzept Phase 3: SuS einmal pflegen (Roster-Sync über den Kurs).

Anlegen/Bearbeiten von Schülern in einer Fach-Klasse spiegelt sich auf die
Geschwister-Klassen desselben Kurses (per Name). Entfernen wird bewusst NICHT
gespiegelt — Löschen kaskadiert (Noten/Karten) und bleibt pro Klasse eine
bewusste Handlung ([[live-daten-schuetzen]]).
"""
import pytest
import pytest_asyncio
from sqlalchemy import event, select, func
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, User, SchoolClass, Student, Kurs
from app.routers.classes import update_class, ClassCreate, StudentIn


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


async def _kurs(s):
    u = User(email="a@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    k = Kurs(owner_id=u.id, name="7.5"); s.add(k); await s.flush()
    A = SchoolClass(name="Mathe 7.5", owner_id=u.id, kurs_id=k.id); s.add(A)
    B = SchoolClass(name="Lernzeit 7.5", owner_id=u.id, kurs_id=k.id); s.add(B); await s.flush()
    await s.commit()
    return u, A, B


@pytest.mark.asyncio
async def test_anlegen_und_edit_spiegeln(s):
    u, A, B = await _kurs(s)
    await update_class(A.id, ClassCreate(name="Mathe 7.5", students=[
        StudentIn(card_id=1, name="Max", foerder=["LRS"]), StudentIn(card_id=2, name="Lena")]), user=u, db=s)
    bs = {x.name: x for x in (await s.execute(select(Student).where(Student.class_id == B.id))).scalars().all()}
    assert set(bs) == {"Max", "Lena"}, "SuS in Geschwisterklasse gespiegelt"
    assert bs["Max"].foerder == ["LRS"], "Felder gespiegelt"


@pytest.mark.asyncio
async def test_entfernen_nicht_gespiegelt(s):
    u, A, B = await _kurs(s)
    await update_class(A.id, ClassCreate(name="Mathe 7.5", students=[
        StudentIn(card_id=1, name="Max"), StudentIn(card_id=2, name="Lena")]), user=u, db=s)
    # Max in A entfernen -> in B bleibt er (kein kaskadierendes Auto-Löschen).
    await update_class(A.id, ClassCreate(name="Mathe 7.5", students=[StudentIn(card_id=2, name="Lena")]), user=u, db=s)
    b_names = {x.name for x in (await s.execute(select(Student).where(Student.class_id == B.id))).scalars().all()}
    assert "Max" in b_names
    assert (await s.execute(select(func.count()).select_from(Student).where(Student.class_id == A.id))).scalar() == 1
