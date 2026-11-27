"""Vergleich eines Kindes im Notenbuch: Quartalsnoten (Stand am Strich), Halbjahre, Jahr und das Vorjahr."""
from datetime import date

import pytest
from fastapi import HTTPException

from app import models as m
from app.routers import noten as N


async def _welt(s):
    u = m.User(email="v@s.de", password_hash="x", name="L", email_verified=True)
    s.add(u)
    await s.flush()
    vor = m.Kurs(owner_id=u.id, name="6a", fach="Mathe", schuljahr="2025/26")
    s.add(vor)
    await s.flush()
    jetzt = m.Kurs(owner_id=u.id, name="7a", fach="Mathe", schuljahr="2026/27", vorgaenger_id=vor.id)
    s.add(jetzt)
    await s.flush()
    c6 = m.SchoolClass(owner_id=u.id, name="6a", kurs_id=vor.id)
    c7 = m.SchoolClass(owner_id=u.id, name="7a", kurs_id=jetzt.id)
    s.add_all([c6, c7])
    await s.flush()
    p = m.Person(owner_id=u.id, name="Anna")
    s.add(p)
    await s.flush()
    a6 = m.Student(class_id=c6.id, card_id=1, name="Anna", person_id=p.id)
    a7 = m.Student(class_id=c7.id, card_id=1, name="Anna", person_id=p.id)
    b7 = m.Student(class_id=c7.id, card_id=2, name="Ben")
    s.add_all([a6, a7, b7])
    await s.flush()

    def spalte(cls, kurs, term, tag, noten):
        sec = m.GradeSection(owner_id=u.id, class_id=cls.id, kurs_id=kurs.id, term=term, name="Schriftlich", weight=100)
        s.add(sec)
        return sec, tag, noten

    async def note(sec, cls, tag, werte):
        await s.flush()
        cat = m.GradeCategory(owner_id=u.id, class_id=cls.id, section_id=sec.id, name=str(tag), date=tag)
        s.add(cat)
        await s.flush()
        for st, v in werte:
            s.add(m.GradeEntry(category_id=cat.id, student_id=st.id, kind="grade", value=v))

    # Vorjahr: 1. HJ 3,0, 2. HJ 2,0 → Jahr 2,5
    v1, _, _ = spalte(c6, vor, "1", None, None)
    v2, _, _ = spalte(c6, vor, "2", None, None)
    await note(v1, c6, date(2025, 10, 1), [(a6, 3.0)])
    await note(v2, c6, date(2026, 3, 1), [(a6, 2.0)])
    # Dieses Jahr, 1. HJ: 4,0 im September, 2,0 im Dezember; Strich am 10.11. → Q1 = 4,0, 1. HJ = 3,0
    j1, _, _ = spalte(c7, jetzt, "1", None, None)
    await note(j1, c7, date(2026, 9, 20), [(a7, 4.0), (b7, 1.0)])
    await note(j1, c7, date(2026, 12, 1), [(a7, 2.0), (b7, 1.0)])
    s.add(m.QuartalDatum(owner_id=u.id, class_id=c7.id, kurs_id=jetzt.id, term="1", datum=date(2026, 11, 10)))
    await s.commit()
    return u, jetzt, c7, a7, b7


@pytest.mark.asyncio
async def test_quartal_ist_stand_am_strich_und_vorjahr_kommt_ueber_die_person(s):
    u, jetzt, c7, a7, _ = await _welt(s)
    v = await N.vergleich(c7.id, a7.id, kurs_id=jetzt.id, user=u, db=s)
    punkte = [(p.label, p.note) for p in v.verlauf]
    assert punkte == [("Q1", 4.0), ("1. HJ", 3.0), ("2. HJ", None)]
    assert v.verlauf[0].bis == "2026-11-10"
    assert v.jahr == 3.0
    assert v.vorjahr is not None
    assert v.vorjahr.halbjahre == {"1": 3.0, "2": 2.0}
    assert v.vorjahr.jahr == 2.5
    assert v.vorjahr.schuljahr == "2025/26"


@pytest.mark.asyncio
async def test_ohne_vorjahr_in_der_gruppe_kein_vorjahr(s):
    u, jetzt, c7, _, b7 = await _welt(s)
    v = await N.vergleich(c7.id, b7.id, kurs_id=jetzt.id, user=u, db=s)
    assert v.vorjahr is None
    assert [p.note for p in v.verlauf][:2] == [1.0, 1.0]


@pytest.mark.asyncio
async def test_von_hand_gesetzte_halbjahresnote_zaehlt_nicht_fuers_quartal(s):
    u, jetzt, c7, a7, _ = await _welt(s)
    s.add(m.GradeOverride(owner_id=u.id, class_id=c7.id, kurs_id=jetzt.id, student_id=a7.id,
                          section_id=None, term="1", value=2.0))
    await s.commit()
    v = await N.vergleich(c7.id, a7.id, kurs_id=jetzt.id, user=u, db=s)
    assert [(p.label, p.note) for p in v.verlauf][:2] == [("Q1", 4.0), ("1. HJ", 2.0)]


@pytest.mark.asyncio
async def test_fremdes_konto_bleibt_draussen(s):
    u, jetzt, c7, a7, _ = await _welt(s)
    fremd = m.User(email="f@s.de", password_hash="x", name="F", email_verified=True)
    s.add(fremd)
    await s.commit()
    with pytest.raises(HTTPException):
        await N.vergleich(c7.id, a7.id, kurs_id=jetzt.id, user=fremd, db=s)


@pytest.mark.asyncio
async def test_vorjahr_aus_dem_notenbuch_der_klasse(s):
    """Bestand von vor dem Kurs-Umbau: das Vorjahres-Notenbuch haengt an der KLASSE (Abschnitte ohne kurs_id)."""
    u, jetzt, c7, a7, _ = await _welt(s)
    vor = await s.get(m.Kurs, jetzt.vorgaenger_id)
    alt = (await s.execute(m.GradeSection.__table__.select().where(m.GradeSection.kurs_id == vor.id))).all()
    for row in alt:
        sec = await s.get(m.GradeSection, row.id)
        sec.kurs_id = None
    await s.commit()
    v = await N.vergleich(c7.id, a7.id, kurs_id=jetzt.id, user=u, db=s)
    assert v.vorjahr is not None and v.vorjahr.jahr == 2.5
