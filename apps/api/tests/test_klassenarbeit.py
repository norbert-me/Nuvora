"""Modul Klassenarbeit: Fehlerprofil je SuS nach Thema + gezielte Wiederholung
(Karten des schwachen Themas wieder fällig). Bestehende Daten unberührt.
"""
from datetime import datetime, timezone, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import (
    Base, User, SchoolClass, Student, Topic, CardDeck, Card, CardReview, WorkAnalysis, UserModule,
)
from app.routers import klassenarbeit as K


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
    # Karten-Brücke: remediate setzt nur bei aktivem Modul Karten die Fälligkeit.
    s.add(UserModule(user_id=u.id, module_key="karten"))
    cls = SchoolClass(name="7a", owner_id=u.id); s.add(cls); await s.flush()
    A = Topic(name="Brüche", owner_id=u.id); B = Topic(name="Geometrie", owner_id=u.id)
    s.add(A); s.add(B); await s.flush()
    s1 = Student(card_id=1, name="Ann", class_id=cls.id); s2 = Student(card_id=2, name="Bob", class_id=cls.id)
    s.add(s1); s.add(s2); await s.commit()
    return u, cls, A, B, s1, s2


@pytest.mark.asyncio
async def test_analyse_und_wiederholung(s):
    u, cls, A, B, s1, s2 = await _setup(s)
    w = await K.create_work(K.WorkIn(class_id=cls.id, name="KA1"), user=u, db=s)
    tasks = [{"id": "t1", "label": "", "topic_id": A.id}, {"id": "t2", "label": "", "topic_id": A.id}, {"id": "t3", "label": "", "topic_id": B.id}]
    results = {str(s1.id): ["t1", "t2"], str(s2.id): ["t1"]}  # Ann 2/2 A falsch, Bob 1/2 A falsch
    await K.update_work(w.id, K.WorkPut(tasks=tasks, results=results), user=u, db=s)

    an = await K.analysis(w.id, user=u, db=s)
    # Thema A: 3 richtig von 6 (Ann 0/2, Bob 1/2, plus B 2/2 richtig) → A = 25%
    a_stat = next(x for x in an["topics"] if x["topic_id"] == A.id)
    assert a_stat["pct"] == 25
    weak_names = {x["name"] for x in an["students"]}
    assert weak_names == {"Ann", "Bob"}  # beide schwach in Brüche

    # Karten des Themas A + Reviews (gelernt, in der Zukunft fällig)
    deck = CardDeck(owner_id=u.id, class_id=cls.id, name="Brüche", topic_id=A.id, released_at=datetime.now(timezone.utc))
    s.add(deck); await s.flush()
    card = Card(deck_id=deck.id, front="x", back="y"); s.add(card); await s.flush()
    zukunft = datetime.now(timezone.utc) + timedelta(days=10)
    s.add(CardReview(student_id=s1.id, card_id=card.id, reps=2, due=zukunft))
    s.add(CardReview(student_id=s2.id, card_id=card.id, reps=2, due=zukunft))
    await s.commit()

    res = await K.remediate(w.id, K.RemediateIn(threshold=0.5), user=u, db=s)
    assert res["students"] == 2 and res["cards_requeued"] == 2

    naive = lambda d: d.replace(tzinfo=None) if d.tzinfo else d
    now = datetime.utcnow()
    for r in (await s.execute(select(CardReview))).scalars().all():
        assert naive(r.due) <= now + timedelta(minutes=1)


@pytest.mark.asyncio
async def test_fremdes_thema_verworfen(s):
    u, cls, A, B, s1, s2 = await _setup(s)
    v = User(email="v@b.de", password_hash="x", name="V"); s.add(v); await s.flush()
    fremd = Topic(name="Fremd", owner_id=v.id); s.add(fremd); await s.commit()
    w = await K.create_work(K.WorkIn(class_id=cls.id, name="KA"), user=u, db=s)
    out = await K.update_work(w.id, K.WorkPut(tasks=[{"id": "t1", "label": "x", "topic_id": fremd.id}]), user=u, db=s)
    assert out.tasks[0]["topic_id"] is None  # fremdes Thema wird verworfen
