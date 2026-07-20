"""Integrationstests der Modul-Bruecken ins Notenbuch bzw. den Marktplatz.

Sensibler Bereich (Noten): jede Bruecke wird hier festgehalten.
- import_grades: generische Spalte aus fertigen Noten; nur SuS des Kurses.
- import_code_session: CD-Session -> Note, Namensmatch, ungematchte gemeldet.
- copy_ladder: Lernleiter aus dem Marktplatz uebernehmen -> eigene Aufgaben,
  KEINE Zuweisungen/Notizen (Schuelerbezug bleibt lokal).

Lauf:  cd apps/api && pip install -r requirements-dev.txt && pytest
"""
import pytest
import pytest_asyncio
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import (
    Base, User, SchoolClass, Student, GradeSection, GradeCategory, GradeEntry,
    CodeSession, Topic, Exercise, LearningPath, LearningLadder,
)
from app.routers import noten as N
from app.routers import marketplace as M


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


async def _grund(s):
    u = User(email="a@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    cls = SchoolClass(name="7a", owner_id=u.id); s.add(cls); await s.flush()
    max_ = Student(card_id=1, name="Max", class_id=cls.id)
    lena = Student(card_id=2, name="Lena", class_id=cls.id)
    s.add(max_); s.add(lena); await s.flush()
    sec = GradeSection(name="Tests", weight=50, position=0, term="1", class_id=cls.id, owner_id=u.id)
    s.add(sec); await s.commit()
    return u, cls, sec, max_, lena


@pytest.mark.asyncio
async def test_import_grades_nur_kurs_sus(s):
    u, cls, sec, max_, lena = await _grund(s)
    body = N.ImportGradesBody(class_id=cls.id, section_id=sec.id, column_name="Probe",
                              grades=[N.GradeCell(student_id=max_.id, value=2.0),
                                      N.GradeCell(student_id=99999, value=1.0)])  # 99999 nicht im Kurs
    res = await N.import_grades(body, user=u, db=s)
    assert res["imported"] == 1, "fremde student_id wird verworfen"
    rows = (await s.execute(select(GradeEntry))).scalars().all()
    assert len(rows) == 1 and rows[0].student_id == max_.id and rows[0].value == 2.0


@pytest.mark.asyncio
async def test_import_code_session_matcht_namen(s):
    u, cls, sec, max_, lena = await _grund(s)
    sess = CodeSession(owner_id=u.id, code="ABCD", ended=True,
                       puzzles=[{"id": "p1"}, {"id": "p2"}],
                       results=[
                           {"playerName": "Max", "puzzleId": "p1", "solved": True},
                           {"playerName": "Max", "puzzleId": "p2", "solved": False},
                           {"playerName": "Geist", "puzzleId": "p1", "solved": True},  # kein Schueler
                       ])
    s.add(sess); await s.commit()
    body = N.ImportCodeBody(code_session_id=sess.id, class_id=cls.id, section_id=sec.id, column_name="CD")
    res = await N.import_code_session(body, user=u, db=s)
    assert res["imported"] == 1, "nur Max passt zu einem Schueler"
    assert res["unmatched"] == ["Geist"], "nicht zuordenbarer Name wird gemeldet, nicht geraten"
    e = (await s.execute(select(GradeEntry))).scalars().one()
    assert e.student_id == max_.id
    assert 1.0 <= e.value <= 6.0  # 1 von 2 geloest -> mittlere Note


@pytest.mark.asyncio
async def test_import_code_session_kein_treffer_wirft(s):
    u, cls, sec, max_, lena = await _grund(s)
    sess = CodeSession(owner_id=u.id, code="EFGH", ended=True, puzzles=[{"id": "p1"}],
                       results=[{"playerName": "Niemand", "puzzleId": "p1", "solved": True}])
    s.add(sess); await s.commit()
    body = N.ImportCodeBody(code_session_id=sess.id, class_id=cls.id, section_id=sec.id, column_name="CD")
    with pytest.raises(Exception):
        await N.import_code_session(body, user=u, db=s)
    # keine leere Spalte zurueckgelassen
    assert (await s.execute(select(GradeCategory))).scalars().first() is None


@pytest.mark.asyncio
async def test_ladder_marktplatz_copy_ohne_schuelerbezug(s):
    u, cls, sec, max_, lena = await _grund(s)
    tp = Topic(name="Brüche", owner_id=u.id); s.add(tp); await s.flush()
    ex = Exercise(owner_id=u.id, topic_id=tp.id, kategorie="Basis", aufgabentext="1/2 + 1/2 = ?")
    s.add(ex); await s.flush()
    path = LearningPath(name="Pfad A", owner_id=u.id); s.add(path); await s.flush()
    lad = LearningLadder(path_id=path.id, topic_id=tp.id, position=0, class_id=cls.id,
                         notizen="Max braucht mehr Zeit",
                         assignments=[{"student_id": max_.id, "exercise_ids": [ex.id]}])
    s.add(lad); await s.commit()

    quiz = await M.publish_ladder(M.PublishLadderBody(ladder_id=lad.id), user=u, db=s)

    v = User(email="v@b.de", password_hash="x", name="V"); s.add(v); await s.commit()
    out = await M.copy_quiz(quiz["id"], None, user=v, db=s)

    # v hat eine eigene Aufgabenkopie + einen Pfad mit einer leeren Lernleiter
    v_ex = (await s.execute(select(Exercise).where(Exercise.owner_id == v.id))).scalars().all()
    assert len(v_ex) == 1 and v_ex[0].aufgabentext == "1/2 + 1/2 = ?"
    v_lad = (await s.execute(select(LearningLadder).join(LearningPath).where(LearningPath.owner_id == v.id))).scalars().all()
    assert len(v_lad) == 1
    assert (v_lad[0].assignments or []) == [], "keine Schueler-Zuweisungen uebernommen"
    assert not v_lad[0].notizen, "keine Notiz uebernommen (Datenschutz)"
    assert v_lad[0].class_id is None, "kein Klassenbezug uebernommen"
