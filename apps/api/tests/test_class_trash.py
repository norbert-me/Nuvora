"""Regressionstest: Papierkorb für Klassen (Soft-Delete, 30 Tage).

Klasse löschen darf nicht sofort die Kaskade (Schüler → Noten/Karten) auslösen —
sonst ist ein Fehlklick unwiederbringlich. Stattdessen Soft-Delete: raus aus der
Liste, aber wiederherstellbar; erst purge löscht endgültig.
"""
import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import event, select, func
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app import models as m
from app.models import Base, User, SchoolClass, Student
from app.routers import classes


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)() as s:
        yield s
    await engine.dispose()


async def _seed(s):
    u = User(email="a@b.de", password_hash="x", name="L")
    s.add(u); await s.flush()
    cls = SchoolClass(name="7a", owner_id=u.id)
    s.add(cls); await s.flush()
    st = Student(card_id=1, name="Max", class_id=cls.id)
    s.add(st); await s.flush()
    cat = m.GradeCategory(owner_id=u.id, class_id=cls.id, name="1. KA")
    s.add(cat); await s.flush()
    s.add(m.GradeEntry(category_id=cat.id, student_id=st.id, kind="grade", value=2.0))
    await s.commit()
    return u, cls


@pytest.mark.asyncio
async def test_soft_delete_haelt_daten(session):
    u, cls = await _seed(session)
    await classes.delete_class(cls.id, user=u, db=session)
    # Weg aus der Liste, aber im Papierkorb, und Note noch da.
    assert await classes.list_classes(user=u, db=session) == []
    trash = await classes.list_trash(user=u, db=session)
    assert len(trash) == 1 and trash[0].id == cls.id
    n = (await session.execute(select(func.count()).select_from(m.GradeEntry))).scalar()
    assert n == 1, "Soft-Delete hat die Note zerstört"


@pytest.mark.asyncio
async def test_restore(session):
    u, cls = await _seed(session)
    await classes.delete_class(cls.id, user=u, db=session)
    await classes.restore_class(cls.id, user=u, db=session)
    lst = await classes.list_classes(user=u, db=session)
    assert len(lst) == 1 and lst[0].id == cls.id
    assert await classes.list_trash(user=u, db=session) == []


@pytest.mark.asyncio
async def test_purge_loescht_kaskade(session):
    u, cls = await _seed(session)
    await classes.delete_class(cls.id, user=u, db=session)
    await classes.purge_class(cls.id, user=u, db=session)
    for model in (m.SchoolClass, m.Student, m.GradeEntry):
        n = (await session.execute(select(func.count()).select_from(model))).scalar()
        assert n == 0, f"{model.__tablename__} nach purge nicht leer"


@pytest.mark.asyncio
async def test_purge_nur_aus_papierkorb(session):
    u, cls = await _seed(session)
    with pytest.raises(HTTPException):
        await classes.purge_class(cls.id, user=u, db=session)  # nicht im Papierkorb
