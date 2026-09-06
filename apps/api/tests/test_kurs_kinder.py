"""Kinder werden im KURS gepflegt (Umbau vom 06.09.2026).

Traeger bleibt vorerst die Klasse — `students.class_id` haengt an Noten, Karten
und Scans. Ein Kurs ohne Klasse bekommt beim ersten Kind eine; sie ist im Alltag
unsichtbar und faellt in Etappe 4.
"""
import pytest
from fastapi import HTTPException

from app.models import Kurs, KursStudent, KursTag, Person, SchoolClass, Student, User
from app.routers import kurse as K


async def _konto(s):
    u = User(email="kk@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    k = Kurs(owner_id=u.id, name="WP8")
    s.add(k)
    await s.commit()
    return u, k


@pytest.mark.asyncio
async def test_erstes_kind_bekommt_traegerklasse_und_person(s):
    import sqlalchemy as sa
    u, kurs = await _konto(s)
    kind = await K.add_kind(kurs.id, K.KindIn(name="Anna"), user=u, db=s)

    assert kind.card_id == 1 and kind.position == 0
    assert kind.person_id, "ohne Person waere das Kind nur eine Listenzeile"
    # Die Traegerklasse entsteht still — und nur EINMAL.
    klassen = (await s.execute(sa.select(SchoolClass).where(SchoolClass.owner_id == u.id))).scalars().all()
    assert len(klassen) == 1 and klassen[0].name == "WP8"

    await K.add_kind(kurs.id, K.KindIn(name="Ben"), user=u, db=s)
    klassen = (await s.execute(sa.select(SchoolClass).where(SchoolClass.owner_id == u.id))).scalars().all()
    assert len(klassen) == 1, "das zweite Kind darf keine zweite Klasse anlegen"

    liste = await K.list_kinder(kurs.id, user=u, db=s)
    assert [x.name for x in liste] == ["Anna", "Ben"]
    assert [x.card_id for x in liste] == [1, 2]


@pytest.mark.asyncio
async def test_sortieren_laesst_die_kartennummern_stehen(s):
    """Die Kartennummer steht auf einer gedruckten Karte und wird von jedem
    Scan referenziert — Umsortieren darf sie nicht mitziehen."""
    u, kurs = await _konto(s)
    a = await K.add_kind(kurs.id, K.KindIn(name="Anna"), user=u, db=s)
    b = await K.add_kind(kurs.id, K.KindIn(name="Ben"), user=u, db=s)

    await K.set_reihenfolge(kurs.id, K.ReihenfolgeIn(student_ids=[b.student_id, a.student_id]), user=u, db=s)
    liste = await K.list_kinder(kurs.id, user=u, db=s)
    assert [x.name for x in liste] == ["Ben", "Anna"]
    assert {x.name: x.card_id for x in liste} == {"Anna": 1, "Ben": 2}


@pytest.mark.asyncio
async def test_kind_einer_geteilten_klasse_wird_nicht_still_entfernt(s):
    """Sitzt das Kind ueber eine Klasse im Kurs, die AUCH anderen Kursen
    gehoert, gehoert die Entscheidung dorthin — 409 statt stillem Nichtstun."""
    u, kurs = await _konto(s)
    zweiter = Kurs(owner_id=u.id, name="Chor")
    s.add(zweiter)
    await s.flush()
    c = SchoolClass(name="8a", owner_id=u.id)
    s.add(c)
    await s.flush()
    z = Student(class_id=c.id, name="Cem", card_id=1)
    s.add(z)
    await s.flush()
    s.add_all([KursTag(kurs_id=kurs.id, class_id=c.id), KursTag(kurs_id=zweiter.id, class_id=c.id)])
    await s.commit()

    with pytest.raises(HTTPException) as e:
        await K.remove_kind(kurs.id, z.id, user=u, db=s)
    assert e.value.status_code == 409
    assert await s.get(Student, z.id) is not None


@pytest.mark.asyncio
async def test_im_kurs_angelegtes_kind_geht_beim_entfernen_wirklich(s):
    """Ein hier angelegtes Kind hat nur diesen einen Ort. „Entfernt" muss dann
    auch entfernt heissen — die Oberflaeche fragt vorher, weil die Kaskade
    Noten und Karten-Fortschritt mitnimmt. Die PERSON bleibt: sie kann in
    anderen Kursen weiterleben."""
    import sqlalchemy as sa
    u, kurs = await _konto(s)
    a = await K.add_kind(kurs.id, K.KindIn(name="Anna"), user=u, db=s)
    await K.remove_kind(kurs.id, a.student_id, user=u, db=s)

    assert await s.get(Student, a.student_id) is None
    assert await s.get(Person, a.person_id) is not None
    assert (await K.list_kinder(kurs.id, user=u, db=s)) == []
    drin = (await s.execute(sa.select(KursStudent).where(KursStudent.kurs_id == kurs.id))).scalars().all()
    assert drin == []


@pytest.mark.asyncio
async def test_namensliste_auf_einmal(s):
    """Der Alltag: Namensliste aus der Schulverwaltung kopieren und einfuegen."""
    u, kurs = await _konto(s)
    neu = await K.import_kinder(kurs.id, K.KinderImportIn(
        text="Anna Meyer\nBen Schulz\n\n  Anna Meyer  \nCem Yilmaz\n"), user=u, db=s)
    # Leerzeilen fallen weg, Doppelte auch — ein Kind, nicht zwei.
    assert [x.name for x in neu] == ["Anna Meyer", "Ben Schulz", "Cem Yilmaz"]
    assert [x.card_id for x in neu] == [1, 2, 3]
    assert all(x.person_id for x in neu)


@pytest.mark.asyncio
async def test_import_haengt_hinten_an_und_zaehlt_weiter(s):
    u, kurs = await _konto(s)
    await K.add_kind(kurs.id, K.KindIn(name="Zuerst"), user=u, db=s)
    neu = await K.import_kinder(kurs.id, K.KinderImportIn(text="Danach"), user=u, db=s)
    assert neu[0].card_id == 2 and neu[0].position == 1
    liste = await K.list_kinder(kurs.id, user=u, db=s)
    assert [x.name for x in liste] == ["Zuerst", "Danach"]
