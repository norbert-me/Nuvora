"""Marktplatz: teilen und übernehmen nur mit dem passenden Modul (Regel 3).

Stöbern darf jeder mit Konto — der Marktplatz gehört dem Kern. Aber eine
Übernahme legt Inhalte IM Modul an: ein Kartenstapel ohne Modul Karteikarten
liegt in einer Oberfläche, die es nicht gibt, taucht nirgends auf und ist nur
über den Papierkorb wiederzufinden. Deshalb hängen `publish` und `copy` am
aktiven Modul.
"""
import pytest
import pytest_asyncio
from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from fastapi import HTTPException

from app.models import Base, User, UserModule, SchoolClass, CardDeck, Card
from app.routers import marketplace as M


@pytest_asyncio.fixture
async def s():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk_on(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)() as sess:
        yield sess
    await engine.dispose()


async def _stapel(s, mit_modul: bool):
    u = User(email="a@b.de", password_hash="x", name="A")
    s.add(u)
    await s.flush()
    if mit_modul:
        s.add(UserModule(user_id=u.id, module_key="karten"))
    cls = SchoolClass(name="7a", owner_id=u.id)
    s.add(cls)
    await s.flush()
    deck = CardDeck(owner_id=u.id, class_id=cls.id, name="Bruchrechnung")
    s.add(deck)
    await s.flush()
    s.add(Card(deck_id=deck.id, front="1/2 + 1/2", back="1", position=0))
    await s.commit()
    return u, deck


@pytest.mark.asyncio
async def test_veroeffentlichen_braucht_das_modul(s):
    u, deck = await _stapel(s, mit_modul=False)
    with pytest.raises(HTTPException) as fehler:
        await M.publish_deck(M.PublishDeckBody(deck_id=deck.id), user=u, db=s)
    assert fehler.value.status_code == 403
    assert "Karteikarten" in fehler.value.detail


@pytest.mark.asyncio
async def test_uebernehmen_braucht_das_modul(s):
    u, deck = await _stapel(s, mit_modul=True)
    eintrag = await M.publish_deck(M.PublishDeckBody(deck_id=deck.id), user=u, db=s)

    ohne = User(email="ohne@b.de", password_hash="x", name="Ohne")
    s.add(ohne)
    await s.commit()
    with pytest.raises(HTTPException) as fehler:
        await M.copy_quiz(eintrag["id"], None, user=ohne, db=s)
    assert fehler.value.status_code == 403

    # Mit Modul geht dieselbe Übernahme durch (ein Kartenstapel braucht eine
    # Zielklasse — die liegt im Kern, nicht im Modul).
    s.add(UserModule(user_id=ohne.id, module_key="karten"))
    ziel = SchoolClass(name="8b", owner_id=ohne.id)
    s.add(ziel)
    await s.commit()
    out = await M.copy_quiz(eintrag["id"], M.CopyBody(class_id=ziel.id), user=ohne, db=s)
    assert out
