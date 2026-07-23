"""Karten-Ordner (wie CardVote): anlegen, verschachteln, Deck zuordnen. Löschen
eines Ordners kaskadiert Unterordner; Decks darin wandern in die Wurzel (SET NULL)."""
import pytest
import pytest_asyncio
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, User, SchoolClass, CardDeck, CardFolder, UserModule
from app.routers import karten as K


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
async def test_card_folder_crud_and_delete(s):
    u = User(email="a@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    s.add(UserModule(user_id=u.id, module_key="karten"))
    cls = SchoolClass(name="7a", owner_id=u.id); s.add(cls); await s.commit()

    root = await K.create_card_folder(cls.id, K.CardFolderIn(name="Mathe"), kurs_id=None, user=u, db=s)
    sub = await K.create_card_folder(cls.id, K.CardFolderIn(name="Brüche", parent_id=root.id), kurs_id=None, user=u, db=s)
    lst = await K.list_card_folders(cls.id, kurs_id=None, user=u, db=s)
    assert {f.name for f in lst} == {"Mathe", "Brüche"}

    # Deck im Unterordner.
    deck = await K.create_deck(cls.id, K.DeckIn(name="Kürzen", folder_id=sub.id), kurs_id=None, user=u, db=s)
    assert deck.folder_id == sub.id

    # Wurzel-Ordner löschen -> Unterordner weg, Deck folder_id genullt (Deck bleibt).
    await K.delete_card_folder(root.id, user=u, db=s)
    # Frisch per Core-SELECT lesen (ORM-Cache umgehen).
    folders = (await s.execute(select(CardFolder.id))).scalars().all()
    assert folders == []
    fid = (await s.execute(select(CardDeck.folder_id).where(CardDeck.id == deck.id))).scalar_one()
    assert fid is None   # Deck bleibt, Ordner-Zuordnung genullt
