"""Klassenarbeit -> Notenspalte als VERKNUEPFUNG, nicht als einmaliger Abzug.

Die Spalte merkt sich ihre Arbeit (`source_work_id`); jedes Speichern der
Arbeit schickt die Noten neu, und die Spalte folgt: neue Noten kommen hinzu,
geaenderte werden ueberschrieben, weggefallene (abwesend, Punkte geleert)
verschwinden. Angefasst werden nur die Kinder des sendenden Blatts — das
G-Blatt einer E/G-Arbeit darf die Noten der E-Kinder nicht loeschen.
"""
import pytest
from sqlalchemy import select

from app.models import User, SchoolClass, Student, GradeSection, GradeEntry, WorkAnalysis
from app.routers import noten as N


async def _grund(s):
    u = User(email="a@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    cls = SchoolClass(name="7a", owner_id=u.id); s.add(cls); await s.flush()
    a = Student(card_id=1, name="Ali", class_id=cls.id)
    b = Student(card_id=2, name="Bea", class_id=cls.id)
    c = Student(card_id=3, name="Cem", class_id=cls.id)
    s.add_all([a, b, c]); await s.flush()
    sec = GradeSection(name="Arbeiten", weight=50, position=0, term="1", class_id=cls.id, owner_id=u.id)
    e = WorkAnalysis(owner_id=u.id, class_id=cls.id, name="KA1", niveau="E")
    s.add_all([sec, e]); await s.flush()
    g = WorkAnalysis(owner_id=u.id, class_id=cls.id, name="KA1", niveau="G", partner_id=e.id)
    s.add(g); await s.flush()
    e.partner_id = g.id
    await s.commit()
    return u, cls, sec, e, g, a, b, c


async def _werte(s):
    return {x.student_id: x.value for x in (await s.execute(select(GradeEntry))).scalars().all()}


@pytest.mark.asyncio
async def test_verknuepfte_spalte_folgt_der_arbeit(s):
    u, cls, sec, e, g, a, b, c = await _grund(s)
    # Verknuepfen darf leer anfangen — korrigiert wird danach.
    await N.import_grades(N.ImportGradesBody(class_id=cls.id, section_id=sec.id, column_name="KA1",
                                             source_kind="klassenarbeit", source_work_id=e.id, grades=[]), user=u, db=s)
    spalten = await N.verknuepft(e.id, user=u, db=s)
    assert len(spalten) == 1 and spalten[0]["section"] == "Arbeiten"
    # Vom anderen Blatt aus ist es dieselbe Spalte.
    assert [x["id"] for x in await N.verknuepft(g.id, user=u, db=s)] == [spalten[0]["id"]]

    # E-Blatt: Ali und Bea korrigiert.
    await N.verknuepft_sync(e.id, N.VerknuepftSyncBody(student_ids=[a.id, b.id], grades=[
        N.GradeCell(student_id=a.id, value=2.0), N.GradeCell(student_id=b.id, value=3.3)]), user=u, db=s)
    assert await _werte(s) == {a.id: 2.0, b.id: 3.3}

    # G-Blatt: Cem — die E-Kinder bleiben unberuehrt.
    await N.verknuepft_sync(g.id, N.VerknuepftSyncBody(student_ids=[c.id], grades=[
        N.GradeCell(student_id=c.id, value=4.0)]), user=u, db=s)
    assert await _werte(s) == {a.id: 2.0, b.id: 3.3, c.id: 4.0}

    # Weiter korrigiert: Ali besser, Bea abwesend (keine Note mehr).
    await N.verknuepft_sync(e.id, N.VerknuepftSyncBody(student_ids=[a.id, b.id], grades=[
        N.GradeCell(student_id=a.id, value=1.7)]), user=u, db=s)
    assert await _werte(s) == {a.id: 1.7, c.id: 4.0}


@pytest.mark.asyncio
async def test_ohne_verknuepfung_passiert_nichts_und_fremde_arbeit_gesperrt(s):
    u, cls, sec, e, g, a, b, c = await _grund(s)
    res = await N.verknuepft_sync(e.id, N.VerknuepftSyncBody(student_ids=[a.id], grades=[
        N.GradeCell(student_id=a.id, value=2.0)]), user=u, db=s)
    assert res == {"spalten": 0} and await _werte(s) == {}
    fremd = User(email="x@y.de", password_hash="x", name="F"); s.add(fremd); await s.commit()
    with pytest.raises(Exception):
        await N.verknuepft(e.id, user=fremd, db=s)
    with pytest.raises(Exception):
        await N.import_grades(N.ImportGradesBody(class_id=cls.id, section_id=sec.id, column_name="X",
                                                 source_work_id=e.id, grades=[]), user=fremd, db=s)
