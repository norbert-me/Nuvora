"""Nachholbedarf aus einer themen-getaggten Klassenarbeit: schwache SuS →
deren Karten des Themas werden WIEDER FÄLLIG. Bestehende Noten bleiben.
"""
from datetime import datetime, timezone, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import (
    Base, User, SchoolClass, Student, Topic, GradeSection, GradeCategory, GradeEntry,
    CardDeck, Card, CardReview,
)
from app.routers import noten as N


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
async def test_nachhol_setzt_karten_faellig(s):
    u = User(email="a@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    cls = SchoolClass(name="7a", owner_id=u.id); s.add(cls); await s.flush()
    tp = Topic(name="Brüche", owner_id=u.id); s.add(tp); await s.flush()
    schwach = Student(card_id=1, name="Schwach", class_id=cls.id)
    stark = Student(card_id=2, name="Stark", class_id=cls.id)
    s.add(schwach); s.add(stark); await s.flush()
    sec = GradeSection(name="Arbeiten", weight=50, term="1", class_id=cls.id, owner_id=u.id); s.add(sec); await s.flush()
    cat = GradeCategory(name="KA1", section_id=sec.id, class_id=cls.id, owner_id=u.id, topic_id=tp.id); s.add(cat); await s.flush()
    s.add(GradeEntry(category_id=cat.id, student_id=schwach.id, kind="grade", value=5.0))  # > 4.0 → Nachholbedarf
    s.add(GradeEntry(category_id=cat.id, student_id=stark.id, kind="grade", value=2.0))
    # Karten-Deck des Themas + eine gelernte Karte je SuS (Fälligkeit in der Zukunft)
    deck = CardDeck(owner_id=u.id, class_id=cls.id, name="Brüche-Deck", topic_id=tp.id, released_at=datetime.now(timezone.utc))
    s.add(deck); await s.flush()
    card = Card(deck_id=deck.id, front="1/2+1/2", back="1"); s.add(card); await s.flush()
    zukunft = datetime.now(timezone.utc) + timedelta(days=10)
    s.add(CardReview(student_id=schwach.id, card_id=card.id, reps=3, due=zukunft))
    s.add(CardReview(student_id=stark.id, card_id=card.id, reps=3, due=zukunft))
    await s.commit()

    res = await N.nachholbedarf(cat.id, N.NachholIn(threshold=4.0), user=u, db=s)
    assert res["weak"] == 1
    assert res["cards_requeued"] == 1  # nur die Karte des schwachen SuS

    rev = {r.student_id: r for r in (await s.execute(select(CardReview))).scalars().all()}
    naive = lambda d: d.replace(tzinfo=None) if d.tzinfo else d   # SQLite liefert tz-naiv
    now = datetime.utcnow()
    assert naive(rev[schwach.id].due) <= now + timedelta(minutes=1), "schwach: wieder fällig"
    assert naive(rev[stark.id].due) > now + timedelta(days=5), "stark: unverändert"


@pytest.mark.asyncio
async def test_nachhol_ohne_thema_wirft(s):
    u = User(email="a@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    cls = SchoolClass(name="7a", owner_id=u.id); s.add(cls); await s.flush()
    sec = GradeSection(name="Arbeiten", term="1", class_id=cls.id, owner_id=u.id); s.add(sec); await s.flush()
    cat = GradeCategory(name="KA1", section_id=sec.id, class_id=cls.id, owner_id=u.id); s.add(cat); await s.commit()
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as ei:
        await N.nachholbedarf(cat.id, N.NachholIn(), user=u, db=s)
    assert ei.value.status_code == 400
