"""Einen Kurs aus einem anderen entwickeln.

Der Normalfall im Schuljahr: dieselbe Lerngruppe, anderes Fach (Mathe und die
AG) oder das naechste Jahr. Uebernommen werden PERSONEN — Noten, Karten und
Anwesenheit des Vorbilds bleiben, wo sie entstanden sind.
"""
import pytest
from fastapi import HTTPException

from app.models import Kurs, KursStudent, KursTag, SchoolClass, Student, User
from app.routers import kurse as K


async def _welt(s):
    u = User(email="k@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    alt = Kurs(owner_id=u.id, name="7.5 Mathe")
    s.add(alt)
    await s.flush()
    c = SchoolClass(name="7.5", owner_id=u.id, kurs_id=alt.id)
    s.add(c)
    await s.flush()
    kinder = [Student(class_id=c.id, name=n, card_id=i + 1) for i, n in enumerate(["Anna", "Ben"])]
    s.add_all(kinder)
    await s.flush()
    # Ein Kind haengt einzeln am Kurs, die Klasse als Ganzes ebenfalls — beide
    # Wege muessen mitkommen.
    s.add(KursTag(kurs_id=alt.id, class_id=c.id))
    await s.commit()
    return u, alt, kinder


@pytest.mark.asyncio
async def test_kinder_kommen_mit(s):
    u, alt, kinder = await _welt(s)
    neu = await K.create_kurs(K.KursIn(name="7.5 AG", aus_kurs_id=alt.id), user=u, db=s)
    assert neu.member_count == 2

    import sqlalchemy as sa
    drin = (await s.execute(sa.select(KursStudent.student_id).where(
        KursStudent.kurs_id == neu.id))).scalars().all()
    assert sorted(drin) == sorted(k.id for k in kinder)


@pytest.mark.asyncio
async def test_ohne_vorbild_bleibt_der_kurs_leer(s):
    u, _, _ = await _welt(s)
    neu = await K.create_kurs(K.KursIn(name="Leer"), user=u, db=s)
    assert neu.member_count == 0


@pytest.mark.asyncio
async def test_fremdes_vorbild_wird_abgewiesen(s):
    """Sonst waere die Kurs-ID ein Weg, fremde Namenslisten abzuschreiben."""
    u, _, _ = await _welt(s)
    fremd = User(email="f@b.de", password_hash="x", name="F")
    s.add(fremd)
    await s.flush()
    fk = Kurs(owner_id=fremd.id, name="fremd")
    s.add(fk)
    await s.commit()
    with pytest.raises(HTTPException) as e:
        await K.create_kurs(K.KursIn(name="Klau", aus_kurs_id=fk.id), user=u, db=s)
    assert e.value.status_code in (403, 404)
