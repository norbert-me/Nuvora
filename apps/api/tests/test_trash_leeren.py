"""„Papierkorb leeren" muss jede Art nehmen — auch die zuletzt dazugekommenen.

Befund aus dem Selbsttest: `empty_trash` fuehrte eine EIGENE Liste der Arten
(`card, ladder, deck, path, class, kurs`), waehrend `_AKTIONEN` und `list_trash`
laengst auch Fragen und Themen kannten. Wer den Papierkorb leerte, bekam 204 —
und Fragen und Themen lagen weiter darin. Ein Fehler, den niemand sieht: die
Antwort meldet Erfolg.

Zwei Tests, in dieser Reihenfolge gedacht:

1. der Fall selbst (Frage und Thema im Papierkorb, leeren, weg),
2. die Regel dahinter — jede Art aus `_AKTIONEN` steht in der Reihenfolge.
   Ohne den zweiten faellt die naechste neue Art genauso durch.
"""
import pytest
from sqlalchemy import func, select

from app import models as m
from app.models import SchoolClass, User
from app.routers import trash


def test_jede_art_wird_beim_leeren_angefasst():
    fehlend = [k for k in trash._AKTIONEN if k not in trash.LEER_REIHENFOLGE]
    assert not fehlend, (
        f"diese Arten kennt der Papierkorb, das Leeren aber nicht: {fehlend} — "
        "sie bleiben nach „Papierkorb leeren“ liegen, und die Antwort ist trotzdem 204")


@pytest.mark.asyncio
async def test_leeren_nimmt_frage_und_thema(session):
    from datetime import datetime, timezone
    jetzt = datetime.now(timezone.utc)

    u = User(email="a@b.de", password_hash="x", name="L")
    session.add(u)
    await session.flush()
    c = SchoolClass(name="7a", owner_id=u.id, deleted_at=jetzt)
    session.add(c)
    thema = m.Topic(owner_id=u.id, name="Bruchrechnen", deleted_at=jetzt)
    frage = m.Question(owner_id=u.id, text="3 · 2/7?", question_type="mc",
                       choices={"A": "1", "B": "2"}, correct_answer="A", deleted_at=jetzt)
    session.add_all([thema, frage])
    await session.commit()

    assert {i.kind for i in await trash.list_trash(u, session)} == {"class", "topic", "question"}

    await trash.empty_trash(user=u, db=session)

    assert await trash.list_trash(u, session) == []
    for modell in (m.Topic, m.Question, SchoolClass):
        uebrig = (await session.execute(select(func.count()).select_from(modell))).scalar()
        assert uebrig == 0, f"{modell.__name__} hat das Leeren des Papierkorbs ueberlebt"
