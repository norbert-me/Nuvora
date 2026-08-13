"""Das Thema an der Frage — es darf beim Speichern nicht verschwinden.

Der Fall aus dem Betrieb: der Fragen-Editor im Quiz bekam seine Felder aus
`_set_to_dict` (folders.py), und darin fehlte `topic_id`. Also zeigte er
„Kein Thema", obwohl eins gesetzt war, und schickte beim Speichern auch keins
mit. `update_question` setzte daraufhin jedes nicht genannte Feld auf seinen
Default — ein Klick auf „Speichern" loeschte die Themenzuordnung still.

Still ist das Teure daran: die Frage sieht danach unveraendert aus, faellt aber
aus der Themen-Ansicht, aus „schwache Themen" und aus jeder Bruecke zum
Lernpfad heraus. Deshalb beide Haelften hier festgehalten:

  * das Quiz nennt das Thema (sonst kann die Oberflaeche es gar nicht kennen),
  * ein PUT ohne `topic_id` laesst es stehen — mit `topic_id: null` faellt es
    weiter ausdruecklich weg.

Lauf:  cd apps/api && pytest tests/test_frage_thema.py
"""
import pytest
import pytest_asyncio
from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, User, Topic, Question, QuestionSet, QuestionSetItem
from app.routers import questions as Q
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


async def _welt(s):
    u = User(email="a@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    thema = Topic(name="Dreiecke", owner_id=u.id, position=0)
    s.add(thema)
    await s.flush()
    frage = Question(text="Wie gross ist gamma?", question_type="mc",
                     choices={"A": "60", "B": "70"}, correct_answer="A",
                     owner_id=u.id, topic_id=thema.id)
    s.add(frage)
    await s.flush()
    quiz = QuestionSet(name="Test", owner_id=u.id)
    s.add(quiz)
    await s.flush()
    s.add(QuestionSetItem(question_set_id=quiz.id, question_id=frage.id, position=0))
    await s.commit()
    return u, thema, frage, quiz


@pytest.mark.asyncio
async def test_quiz_nennt_das_thema_der_frage(s):
    """Ohne dieses Feld kann der Editor im Quiz das Thema nicht anzeigen — und
    was er nicht kennt, schickt er auch nicht zurueck."""
    u, thema, frage, quiz = await _welt(s)
    daten = await F._load_set(s, quiz.id)
    assert daten["questions"][0]["topic_id"] == thema.id


@pytest.mark.asyncio
async def test_speichern_ohne_thema_im_rumpf_laesst_das_thema_stehen(s):
    """Der eigentliche Schaden: ein PUT, das `topic_id` nicht nennt, darf die
    Zuordnung nicht loeschen."""
    u, thema, frage, quiz = await _welt(s)
    body = Q.QuestionCreate.model_validate({
        "text": "Wie gross ist gamma?",
        "choices": {"A": "60", "B": "70"},
        "correct_answer": "A",
    })
    await Q.update_question(frage.id, body, user=u, db=s)

    frisch = await s.get(Question, frage.id)
    assert frisch.topic_id == thema.id, "Speichern hat das Thema geloescht"


@pytest.mark.asyncio
async def test_thema_ausdruecklich_entfernen_geht_weiter(s):
    """Die Gegenrichtung: wer `topic_id: null` schickt, meint es auch so."""
    u, thema, frage, quiz = await _welt(s)
    body = Q.QuestionCreate.model_validate({
        "text": "Wie gross ist gamma?",
        "choices": {"A": "60", "B": "70"},
        "correct_answer": "A",
        "topic_id": None,
    })
    await Q.update_question(frage.id, body, user=u, db=s)

    frisch = await s.get(Question, frage.id)
    assert frisch.topic_id is None
