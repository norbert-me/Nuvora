"""Die Personen-Ebene: ein Kind, egal in wie vielen Listen es steht.

Bis hierher WAR die Zeile in `students` das Kind — dieselbe Anna hatte in
„7.5 LZ" und „7.5 Mathematik" zwei Zeilen. Diese Tests halten fest, was die
Uebernahme daraus macht und was sie ausdruecklich NICHT tut.
"""
import pytest

from app.models import Kurs, Person, SchoolClass, Student, User
from app.personen import uebernahme_personen


async def _welt(s):
    u = User(email="p@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    kurs = Kurs(owner_id=u.id, name="7.5")
    s.add(kurs)
    await s.flush()
    # Zwei Fach-Klassen desselben Kurses — die Kruecke, um die es geht.
    a = SchoolClass(name="7.5 LZ", owner_id=u.id, kurs_id=kurs.id)
    b = SchoolClass(name="7.5 Mathematik", owner_id=u.id, kurs_id=kurs.id)
    s.add_all([a, b])
    await s.flush()
    s.add_all([
        Student(class_id=a.id, name="Anna", card_id=1, niveau="E", notizen="LRS"),
        Student(class_id=b.id, name="Anna", card_id=1, niveau="E"),
        Student(class_id=a.id, name="Ben", card_id=2),
    ])
    await s.commit()
    return u, a, b


@pytest.mark.asyncio
async def test_gleiche_person_in_zwei_listen_wird_eine(s):
    u, a, b = await _welt(s)
    neu = await uebernahme_personen(s)
    assert neu == 2, "Anna und Ben — nicht vier Zeilen, vier Personen"

    leute = (await s.execute(__import__("sqlalchemy").select(Person))).scalars().all()
    anna = [p for p in leute if p.name == "Anna"][0]
    zeilen = (await s.execute(__import__("sqlalchemy").select(Student).where(
        Student.person_id == anna.id))).scalars().all()
    assert len(zeilen) == 2, "beide Listenzeilen zeigen auf dasselbe Kind"
    # Was der Person gehoert, ist mitgewandert.
    assert anna.niveau == "E" and anna.notizen == "LRS"


@pytest.mark.asyncio
async def test_zweiter_lauf_legt_keine_zwillinge_an(s):
    """Die Uebernahme laeuft bei JEDEM Start — beim zweiten Mal darf nichts
    mehr entstehen, sonst waechst die Personenliste mit jedem Neustart."""
    await _welt(s)
    assert await uebernahme_personen(s) == 2
    assert await uebernahme_personen(s) == 0


@pytest.mark.asyncio
async def test_die_alten_felder_bleiben_stehen(s):
    """Kein Datenverlust: solange die Module auf `students` rechnen, bleibt
    dort alles, wie es war — die Person ist zunaechst eine ZUSAETZLICHE Ebene."""
    import sqlalchemy as sa
    await _welt(s)
    await uebernahme_personen(s)
    zeile = (await s.execute(sa.select(Student).where(Student.name == "Anna"))).scalars().first()
    assert zeile.niveau == "E" and zeile.name == "Anna" and zeile.card_id == 1


@pytest.mark.asyncio
async def test_fremde_lehrkraft_bleibt_getrennt(s):
    """Zwei Konten, dasselbe Kind dem Namen nach — trotzdem zwei Personen.
    Mandantentrennung schlaegt jede Namensgleichheit."""
    import sqlalchemy as sa
    u1, a, _ = await _welt(s)
    u2 = User(email="zwei@b.de", password_hash="x", name="M")
    s.add(u2)
    await s.flush()
    c = SchoolClass(name="8a", owner_id=u2.id)
    s.add(c)
    await s.flush()
    s.add(Student(class_id=c.id, name="Anna", card_id=1))
    await s.commit()

    await uebernahme_personen(s)
    annas = (await s.execute(sa.select(Person).where(Person.name == "Anna"))).scalars().all()
    assert {p.owner_id for p in annas} == {u1.id, u2.id}
    assert len(annas) == 2
