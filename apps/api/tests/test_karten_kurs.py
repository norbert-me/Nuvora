"""Karteikarten pro Fach: Decks + Fortschritt gelten je Fach-Klasse getrennt.

Ein Stapel, den man in einer Fach-Klasse anlegt, ist NICHT in den Geschwister-
Klassen desselben Kurses sichtbar — jede Fach-Klasse hat ihre eigenen Karten.
(SuS werden im Kern geteilt, der Karten-Fortschritt aber je Fach gefuehrt.)
"""
import pytest
import pytest_asyncio
from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, User, SchoolClass, Student, Kurs, KursTag
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


async def _kurs(s):
    u = User(email="a@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    k = Kurs(owner_id=u.id, name="7.5"); s.add(k); await s.flush()
    A = SchoolClass(name="Mathe 7.5", owner_id=u.id, kurs_id=k.id); s.add(A)
    B = SchoolClass(name="Lernzeit 7.5", owner_id=u.id, kurs_id=k.id); s.add(B); await s.flush()
    s.add(KursTag(kurs_id=k.id, class_id=A.id)); s.add(KursTag(kurs_id=k.id, class_id=B.id))
    s.add(Student(card_id=1, name="Max", class_id=A.id))
    s.add(Student(card_id=1, name="Max", class_id=B.id))
    s.add(Student(card_id=2, name="Lena", class_id=A.id))
    await s.commit()
    return u, A, B


@pytest.mark.asyncio
async def test_deck_pro_fach(s):
    u, A, B = await _kurs(s)
    await K.create_deck(A.id, K.DeckIn(name="Vokabeln"), user=u, db=s)
    decks_a = await K.list_decks(A.id, user=u, db=s)
    decks_b = await K.list_decks(B.id, user=u, db=s)
    assert any(d.name == "Vokabeln" for d in decks_a), "eigene Fach-Klasse sieht den Stapel"
    assert not any(d.name == "Vokabeln" for d in decks_b), "Geschwister-Klasse sieht ihn NICHT (pro Fach getrennt)"


@pytest.mark.asyncio
async def test_roster_pro_fach(s):
    u, A, B = await _kurs(s)
    toks = await K.ensure_tokens(A.id, user=u, db=s)
    assert sorted(t.name for t in toks) == ["Lena", "Max"], "Roster der Fach-Klasse A"
