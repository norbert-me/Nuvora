"""Eine eigene Klasse ist kein Freibrief fuer ein fremdes Kind.

Anwesenheit, Losung und Orga-Checkliste nehmen die Klasse aus der Adresse und
die `student_id` aus dem Rumpf. Die Klasse pruefen sie — das Kind muss aber
zusaetzlich **in dieser Klasse** sitzen, sonst schreibt die eigene Klasse in den
Datensatz eines fremden Kindes.

Die Pruefung stand in `orga.py`, `zufall.py` und zweimal in `anwesenheit.py`
wortgleich als Dreizeiler; sie ist jetzt `schueler.in_klasse`. Ohne diesen Test
waere die Zusammenfuehrung nur plausibel — hier steht sie fuer jeden der Wege
nachgerechnet.
"""
from datetime import datetime

import pytest
from fastapi import HTTPException

from app.models import SchoolClass, Student, User, UserModule
from app.routers import anwesenheit as A, orga as O, zufall as Z
from app.schueler import in_klasse


async def _welt(s):
    u = User(email="a@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    for key in ("anwesenheit", "zufall", "orga"):
        s.add(UserModule(user_id=u.id, module_key=key))
    meine = SchoolClass(name="7a", owner_id=u.id)
    fremde = SchoolClass(name="7b", owner_id=u.id)
    s.add_all([meine, fremde])
    await s.flush()
    drin = Student(card_id=1, name="Anna", class_id=meine.id)
    draussen = Student(card_id=1, name="Ben", class_id=fremde.id)
    s.add_all([drin, draussen])
    await s.commit()
    return u, meine, drin, draussen


@pytest.mark.asyncio
async def test_in_klasse_laesst_das_eigene_kind_durch(s):
    u, meine, drin, draussen = await _welt(s)
    assert (await in_klasse(s, drin.id, meine.id)).id == drin.id


@pytest.mark.asyncio
@pytest.mark.parametrize("wer", ["fremdes_kind", "unbekannte_id"])
async def test_in_klasse_weist_alles_andere_ab(s, wer):
    u, meine, drin, draussen = await _welt(s)
    sid = draussen.id if wer == "fremdes_kind" else 999999
    with pytest.raises(HTTPException) as e:
        await in_klasse(s, sid, meine.id)
    assert e.value.status_code == 404
    assert e.value.detail == "Schüler nicht in dieser Klasse"


@pytest.mark.asyncio
async def test_anwesenheit_zufall_orga_halten_dieselbe_tuer_zu(s):
    """Alle drei Wege muessen ein klassenfremdes Kind mit 404 abweisen."""
    u, meine, drin, draussen = await _welt(s)

    with pytest.raises(HTTPException) as e:
        await A.mark(meine.id, A.MarkIn(student_id=draussen.id, date=datetime(2026, 3, 2),
                                        status="fehlt"), user=u, db=s)
    assert e.value.status_code == 404

    with pytest.raises(HTTPException) as e:
        await Z.record_draw(meine.id, Z.DrawIn(student_id=draussen.id), user=u, db=s)
    assert e.value.status_code == 404

    item = await O.create_item(meine.id, O.ItemIn(name="Heft"), kurs_id=None, user=u, db=s)
    with pytest.raises(HTTPException) as e:
        await O.toggle(item.id, O.ToggleIn(student_id=draussen.id), user=u, db=s)
    assert e.value.status_code == 404
