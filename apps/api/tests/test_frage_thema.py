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


# ─── Fragen, die in keinem Quiz mehr stecken ───
#
# Sie sind ueber den Editor nicht erreichbar (dorthin kommt man nur ueber ein
# Quiz), stehen aber in der Themen-Ansicht — neben ihrem Zwilling aus dem Quiz
# sieht das aus wie eine doppelte Zeile. Aufgeraeumt wird deshalb ausdruecklich,
# und mit einer Ausnahme, die wichtiger ist als eine leere Liste.


@pytest.mark.asyncio
async def test_verwaiste_frage_wird_gefunden_und_geloescht(s):
    u, thema, frage, quiz = await _welt(s)
    from app.models import Session as CvSession, SchoolClass

    waise = Question(text="Reste einer geloeschten Reihe", question_type="mc",
                     choices={"A": "x"}, correct_answer="A", owner_id=u.id)
    s.add(waise)
    await s.commit()

    stand = await Q.verwaiste_fragen(user=u, db=s)
    assert stand["anzahl"] == 1 and stand["loeschbar"] == 1
    assert stand["fragen"][0]["id"] == waise.id

    weg = await Q.verwaiste_fragen_loeschen(user=u, db=s)
    assert weg["geloescht"] == 1
    assert await s.get(Question, waise.id) is None
    # Die Frage im Quiz bleibt selbstverstaendlich stehen.
    assert await s.get(Question, frage.id) is not None


@pytest.mark.asyncio
async def test_frage_mit_ergebnissen_bleibt_stehen(s):
    """Die Ausnahme: an Scans haengen die Auswertungen gehaltener Sitzungen.
    Eine Frage dafuer zu loeschen, waere ein stiller Datenverlust — und der
    Bericht sagt, dass sie stehen blieb."""
    u, thema, frage, quiz = await _welt(s)
    from app.models import Session as CvSession, SchoolClass, Scan

    cls = SchoolClass(name="7a", owner_id=u.id)
    s.add(cls)
    await s.flush()
    waise = Question(text="War mal in einem Quiz", question_type="mc",
                     choices={"A": "x"}, correct_answer="A", owner_id=u.id)
    s.add(waise)
    await s.flush()
    sitzung = CvSession(question_set_id=quiz.id, class_id=cls.id, owner_id=u.id)
    s.add(sitzung)
    await s.flush()
    s.add(Scan(session_id=sitzung.id, question_id=waise.id, student_id=1, answer="A"))
    await s.commit()

    stand = await Q.verwaiste_fragen(user=u, db=s)
    assert stand["anzahl"] == 1 and stand["loeschbar"] == 0
    assert stand["fragen"][0]["hat_ergebnisse"] is True

    weg = await Q.verwaiste_fragen_loeschen(user=u, db=s)
    assert weg["geloescht"] == 0 and weg["behalten"] == 1
    assert await s.get(Question, waise.id) is not None


@pytest.mark.asyncio
async def test_quiz_loeschen_nimmt_seine_eigenen_fragen_mit(s):
    """Die Ursache der Reste: ein geloeschtes Quiz liess seine Fragen liegen.

    Danach waren sie nirgends mehr erreichbar (an eine Frage kommt man nur
    ueber ein Quiz) und standen doch weiter in der Themen-Ansicht — neben dem
    Zwilling aus einem anderen Quiz sah das aus wie eine doppelte Zeile.

    Drei Faelle in einem Test, weil nur ihr Zusammenspiel die Regel ergibt:
    allein-am-Quiz faellt weg, auch-woanders bleibt, mit-Ergebnissen bleibt.
    """
    u, thema, frage, quiz = await _welt(s)
    from app.models import Session as CvSession, SchoolClass, Scan

    cls = SchoolClass(name="7a", owner_id=u.id)
    s.add(cls)
    nur_hier = Question(text="nur in diesem Quiz", question_type="mc",
                        choices={"A": "x"}, correct_answer="A", owner_id=u.id)
    geteilt = Question(text="auch woanders", question_type="mc",
                       choices={"A": "x"}, correct_answer="A", owner_id=u.id)
    gescannt = Question(text="hat Ergebnisse", question_type="mc",
                        choices={"A": "x"}, correct_answer="A", owner_id=u.id)
    s.add_all([nur_hier, geteilt, gescannt])
    await s.flush()

    zweites = QuestionSet(name="Zweites Quiz", owner_id=u.id)
    s.add(zweites)
    await s.flush()
    s.add_all([
        QuestionSetItem(question_set_id=quiz.id, question_id=nur_hier.id, position=1),
        QuestionSetItem(question_set_id=quiz.id, question_id=geteilt.id, position=2),
        QuestionSetItem(question_set_id=quiz.id, question_id=gescannt.id, position=3),
        QuestionSetItem(question_set_id=zweites.id, question_id=geteilt.id, position=0),
    ])
    # Die Sitzung haengt am ZWEITEN Quiz: `sessions.question_set_id` hat kein
    # ON DELETE, ein Quiz mit gehaltener Sitzung laesst sich ohnehin nicht
    # loeschen. Geprueft wird hier der Schutz der Frage, nicht diese Sperre.
    sitzung = CvSession(question_set_id=zweites.id, class_id=cls.id, owner_id=u.id)
    s.add(sitzung)
    await s.flush()
    s.add(Scan(session_id=sitzung.id, question_id=gescannt.id, student_id=1, answer="A"))
    await s.commit()

    await F.delete_question_set(quiz.id, user=u, db=s)

    assert await s.get(Question, nur_hier.id) is None, "Waise blieb liegen"
    assert await s.get(Question, geteilt.id) is not None, "Frage aus einem anderen Quiz mitgerissen"
    assert await s.get(Question, gescannt.id) is not None, "Frage mit Ergebnissen geloescht"
