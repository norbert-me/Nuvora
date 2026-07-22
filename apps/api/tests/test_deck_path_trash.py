"""Papierkorb auch für Karten-Decks und Lernpfade: Löschen = Soft-Delete,
wiederherstellbar, erst purge kaskadiert (Karten bzw. Lernleitern)."""
import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import event, select, func
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app import models as m
from app.models import Base, User, SchoolClass
from app.routers import karten, lernpfad


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk(c, _):
        c.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)() as s:
        yield s
    await engine.dispose()


async def _user_class(s):
    u = User(email="a@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    c = SchoolClass(name="7a", owner_id=u.id); s.add(c); await s.flush()
    await s.commit()
    return u, c


@pytest.mark.asyncio
async def test_deck_trash(session):
    u, c = await _user_class(session)
    deck = m.CardDeck(owner_id=u.id, class_id=c.id, name="Vokabeln"); session.add(deck); await session.flush()
    session.add(m.Card(deck_id=deck.id, front="a", back="b")); await session.commit()
    await karten.delete_deck(deck.id, user=u, db=session)
    assert await karten.list_decks(c.id, user=u, db=session) == []
    assert len(await karten.list_deck_trash(c.id, user=u, db=session)) == 1
    # Karte lebt noch (Soft-Delete).
    assert (await session.execute(select(func.count()).select_from(m.Card))).scalar() == 1
    await karten.restore_deck(deck.id, user=u, db=session)
    assert len(await karten.list_decks(c.id, user=u, db=session)) == 1
    await karten.delete_deck(deck.id, user=u, db=session)
    await karten.purge_deck(deck.id, user=u, db=session)
    assert (await session.execute(select(func.count()).select_from(m.Card))).scalar() == 0


@pytest.mark.asyncio
async def test_path_trash(session):
    u, c = await _user_class(session)
    p = m.LearningPath(owner_id=u.id, name="Bruch"); session.add(p); await session.flush()
    session.add(m.LearningLadder(path_id=p.id, position=0)); await session.commit()
    await lernpfad.delete_path(p.id, user=u, db=session)
    assert await lernpfad.list_paths(user=u, db=session) == []
    assert len(await lernpfad.list_path_trash(user=u, db=session)) == 1
    assert (await session.execute(select(func.count()).select_from(m.LearningLadder))).scalar() == 1
    await lernpfad.restore_path(p.id, user=u, db=session)
    assert len(await lernpfad.list_paths(user=u, db=session)) == 1
    await lernpfad.delete_path(p.id, user=u, db=session)
    await lernpfad.purge_path(p.id, user=u, db=session)
    assert (await session.execute(select(func.count()).select_from(m.LearningLadder))).scalar() == 0


@pytest.mark.asyncio
async def test_ladder_trash(session):
    """Einzelne Lernleiter loeschen = Soft-Delete (Papierkorb), wiederherstellbar;
    erst purge entfernt sie physisch. list_paths liefert nur aktive Lernleitern."""
    u, c = await _user_class(session)
    p = m.LearningPath(owner_id=u.id, name="Bruch"); session.add(p); await session.flush()
    l1 = m.LearningLadder(path_id=p.id, position=0)
    l2 = m.LearningLadder(path_id=p.id, position=1)
    session.add_all([l1, l2]); await session.commit()
    l1_id = l1.id
    aktiv = lambda: session.execute(select(func.count()).select_from(m.LearningLadder).where(m.LearningLadder.deleted_at.is_(None)))
    gesamt = lambda: session.execute(select(func.count()).select_from(m.LearningLadder))

    await lernpfad.delete_ladder(l1_id, user=u, db=session)     # Soft-Delete
    assert (await gesamt()).scalar() == 2                        # physisch noch beide
    assert (await aktiv()).scalar() == 1                         # aktiv nur eine
    trash = await lernpfad.list_ladder_trash(user=u, db=session)
    assert len(trash) == 1 and trash[0]["id"] == l1_id and trash[0]["path_name"] == "Bruch"

    await lernpfad.restore_ladder(l1_id, user=u, db=session)
    assert len(await lernpfad.list_ladder_trash(user=u, db=session)) == 0
    assert (await aktiv()).scalar() == 2

    await lernpfad.delete_ladder(l1_id, user=u, db=session)
    await lernpfad.purge_ladder(l1_id, user=u, db=session)      # endgueltig
    assert (await gesamt()).scalar() == 1
