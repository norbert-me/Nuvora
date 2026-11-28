"""CardVote: Antworten eines Kindes in der Auswertung aendern — das Original bleibt.

Die Lehrkraft korrigiert eine falsch erkannte Karte; die gescannte Antwort
merkt sich der Scan (`original`) und laesst sich jederzeit zurueckholen. Eine
nachgetragene Antwort (es gab keinen Scan) verschwindet beim Zuruecksetzen
wieder. Die uebernommene Notenspalte folgt der Auswertung wie bei der
Klassenarbeit (`/api/noten/verknuepft-session`).
"""
import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models import (GradeCategory, GradeEntry, GradeSection, Question, QuestionSet, QuestionSetItem,
                        Scan, SchoolClass, Session, Student, User)
from app.routers import noten as N
from app.routers import results as R


async def _grund(s):
    u = User(email="cv@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    c = SchoolClass(name="7a", owner_id=u.id); s.add(c); await s.flush()
    a = Student(card_id=1, name="Ali", class_id=c.id)
    b = Student(card_id=2, name="Bea", class_id=c.id)
    s.add_all([a, b]); await s.flush()
    q1 = Question(text="1+1", correct_answer="A", owner_id=u.id)
    q2 = Question(text="2+2", correct_answer="B", owner_id=u.id)
    qs = QuestionSet(name="Quiz", owner_id=u.id)
    s.add_all([q1, q2, qs]); await s.flush()
    s.add_all([QuestionSetItem(question_set_id=qs.id, question_id=q1.id, position=0),
               QuestionSetItem(question_set_id=qs.id, question_id=q2.id, position=1)])
    sess = Session(owner_id=u.id, class_id=c.id, name="Test", code="CVK001", question_set_id=qs.id)
    s.add(sess); await s.flush()
    s.add(Scan(session_id=sess.id, question_id=q1.id, student_id=1, answer="C"))
    await s.commit()
    return u, c, sess, q1, q2, a, b


async def _scan(s, sess, q, card):
    return (await s.execute(select(Scan).where(Scan.session_id == sess.id, Scan.question_id == q.id,
                                               Scan.student_id == card))).scalar_one_or_none()


@pytest.mark.asyncio
async def test_aendern_und_original_wiederherstellen(s):
    u, c, sess, q1, q2, a, b = await _grund(s)
    r = await R.antwort_aendern(sess.id, R.AntwortIn(card_id=1, question_id=q1.id, answer="A"), user=u, db=s)
    assert r == {"answer": "A", "korrigiert": True, "original": "C"}
    # Zweites Aendern ueberschreibt das Original NICHT.
    await R.antwort_aendern(sess.id, R.AntwortIn(card_id=1, question_id=q1.id, answer="B"), user=u, db=s)
    sc = await _scan(s, sess, q1, 1)
    assert (sc.answer, sc.korrigiert, sc.original) == ("B", True, "C")
    # Auswertung zeigt die Korrektur samt Original und wertet die neue Antwort.
    ev = await R.get_evaluation(sess.id, user=u, db=s)
    zelle = next(x for x in ev["students"] if x["card_id"] == 1)["answers"][0]
    assert zelle["answer"] == "B" and zelle["korrigiert"] and zelle["original"] == "C"
    # Zurueck.
    r = await R.antwort_aendern(sess.id, R.AntwortIn(card_id=1, question_id=q1.id, original=True), user=u, db=s)
    assert r == {"answer": "C", "korrigiert": False, "original": None}


@pytest.mark.asyncio
async def test_nachgetragene_antwort_verschwindet_beim_zuruecksetzen(s):
    u, c, sess, q1, q2, a, b = await _grund(s)
    r = await R.antwort_aendern(sess.id, R.AntwortIn(card_id=2, question_id=q2.id, answer="B"), user=u, db=s)
    assert r["korrigiert"] and r["original"] is None
    r = await R.antwort_aendern(sess.id, R.AntwortIn(card_id=2, question_id=q2.id, original=True), user=u, db=s)
    assert r["answer"] is None
    assert await _scan(s, sess, q2, 2) is None


@pytest.mark.asyncio
async def test_zurueck_auf_den_scan_ist_keine_korrektur(s):
    u, c, sess, q1, q2, a, b = await _grund(s)
    await R.antwort_aendern(sess.id, R.AntwortIn(card_id=1, question_id=q1.id, answer="A"), user=u, db=s)
    r = await R.antwort_aendern(sess.id, R.AntwortIn(card_id=1, question_id=q1.id, answer="C"), user=u, db=s)
    assert r == {"answer": "C", "korrigiert": False, "original": None}


@pytest.mark.asyncio
async def test_fremde_frage_karte_und_sitzung_abgelehnt(s):
    u, c, sess, q1, q2, a, b = await _grund(s)
    fremd_q = Question(text="x", correct_answer="A", owner_id=u.id); s.add(fremd_q); await s.commit()
    with pytest.raises(HTTPException) as f:
        await R.antwort_aendern(sess.id, R.AntwortIn(card_id=1, question_id=fremd_q.id, answer="A"), user=u, db=s)
    assert f.value.status_code == 404
    with pytest.raises(HTTPException) as f:
        await R.antwort_aendern(sess.id, R.AntwortIn(card_id=9, question_id=q1.id, answer="A"), user=u, db=s)
    assert f.value.status_code == 404
    with pytest.raises(HTTPException) as f:
        await R.antwort_aendern(sess.id, R.AntwortIn(card_id=1, question_id=q1.id, answer="X"), user=u, db=s)
    assert f.value.status_code == 400
    andere = User(email="x@b.de", password_hash="x", name="X"); s.add(andere); await s.commit()
    with pytest.raises(HTTPException) as f:
        await R.antwort_aendern(sess.id, R.AntwortIn(card_id=1, question_id=q1.id, answer="A"), user=andere, db=s)
    assert f.value.status_code in (403, 404)


@pytest.mark.asyncio
async def test_neuer_scan_hebt_die_korrektur_auf(s):
    u, c, sess, q1, q2, a, b = await _grund(s)
    await R.antwort_aendern(sess.id, R.AntwortIn(card_id=1, question_id=q1.id, answer="A"), user=u, db=s)
    sess.current_question_id = q1.id
    await s.commit()
    await R.submit_scan(R.ScanCreate(session_id=sess.id, student_id=1, answer="D"), user=u, db=s)
    sc = await _scan(s, sess, q1, 1)
    assert (sc.answer, sc.korrigiert, sc.original) == ("D", False, None)


@pytest.mark.asyncio
async def test_verknuepfte_spalte_folgt_der_auswertung(s):
    u, c, sess, q1, q2, a, b = await _grund(s)
    sec = GradeSection(name="Tests", weight=50, position=0, term="1", class_id=c.id, owner_id=u.id)
    s.add(sec); await s.commit()
    await N.import_session(N.ImportBody(session_id=sess.id, section_id=sec.id, column_name="Quiz",
                                        grades=[N.ImportGrade(card_id=1, value=5.0)]), user=u, db=s)
    spalten = await N.verknuepft_session(sess.id, user=u, db=s)
    assert len(spalten) == 1
    # Korrektur: Ali besser, Bea kommt dazu.
    r = await N.verknuepft_session_sync(sess.id, N.SessionSyncBody(grades=[
        N.SessionSyncGrade(card_id=1, value=2.0), N.SessionSyncGrade(card_id=2, value=3.0)]), user=u, db=s)
    assert r["spalten"] == 1
    werte = {e.student_id: e.value for e in (await s.execute(select(GradeEntry))).scalars().all()}
    assert werte == {a.id: 2.0, b.id: 3.0}
    # Bea krank: Zelle geht.
    await N.verknuepft_session_sync(sess.id, N.SessionSyncBody(grades=[N.SessionSyncGrade(card_id=1, value=2.0)]),
                                    user=u, db=s)
    werte = {e.student_id: e.value for e in (await s.execute(select(GradeEntry))).scalars().all()}
    assert werte == {a.id: 2.0}
    # Unverknuepfte Sitzung: nichts passiert.
    cat = (await s.execute(select(GradeCategory))).scalars().one()
    cat.source_session_id = None
    await s.commit()
    assert (await N.verknuepft_session_sync(sess.id, N.SessionSyncBody(grades=[]), user=u, db=s))["spalten"] == 0
