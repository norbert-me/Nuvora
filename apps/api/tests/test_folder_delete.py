"""Ganze Ordner-Struktur löschen: ein Ordner mit Unterordnern (rekursiv) und
Fragensets verschwindet komplett — die DB kaskadiert über parent_id/folder_id.
Regression: der ORM-Objekt-Delete scheiterte in async an Lazy-Load der Kinder."""
import pytest
import pytest_asyncio
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, User, Folder, QuestionSet
from app.routers import folders as F


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
async def test_delete_folder_structure(s):
    u = User(email="a@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    root = Folder(name="Root", owner_id=u.id); s.add(root); await s.flush()
    sub = Folder(name="Sub", parent_id=root.id, owner_id=u.id); s.add(sub); await s.flush()
    subsub = Folder(name="SubSub", parent_id=sub.id, owner_id=u.id); s.add(subsub); await s.flush()
    s.add(QuestionSet(name="Set A", folder_id=root.id))
    s.add(QuestionSet(name="Set B", folder_id=subsub.id))
    await s.commit()

    # Den Wurzel-Ordner löschen -> alles darunter muss weg sein.
    await F.delete_folder(root.id, user=u, db=s)

    folders = (await s.execute(select(Folder))).scalars().all()
    sets = (await s.execute(select(QuestionSet))).scalars().all()
    assert folders == []
    assert sets == []
