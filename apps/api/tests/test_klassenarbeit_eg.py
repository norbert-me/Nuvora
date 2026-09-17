"""E- und G-Blatt sind EINE Arbeit mit zwei Blaettern (partner_id).

Festgehalten: das zweite Blatt verbindet sich beidseitig und uebernimmt Name
und Kurs, passt nur zum anderen Niveau, und ein Umbenennen gilt beiden.
"""
import pytest
from fastapi import HTTPException

from app.models import SchoolClass, User, WorkAnalysis
from app.routers import klassenarbeit as KA


async def _grund(s):
    u = User(email="eg@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    c = SchoolClass(name="8a", owner_id=u.id); s.add(c); await s.commit()
    return u, c


@pytest.mark.asyncio
async def test_zweites_blatt_verbindet_sich(s):
    u, c = await _grund(s)
    e = await KA.create_work(KA.WorkIn(class_id=c.id, name="2. KA", niveau="E"), user=u, db=s)
    g = await KA.create_work(KA.WorkIn(class_id=c.id, name="egal", niveau="G", partner_id=e.id), user=u, db=s)
    assert g.partner_id == e.id and g.name == "2. KA"
    assert (await s.get(WorkAnalysis, e.id)).partner_id == g.id

    # Ein drittes Blatt passt nicht mehr, auch nicht mit gleichem Niveau.
    with pytest.raises(HTTPException):
        await KA.create_work(KA.WorkIn(class_id=c.id, niveau="G", partner_id=e.id), user=u, db=s)

    # Umbenennen gilt beiden Blaettern.
    await KA.update_work(e.id, KA.WorkPut(name="Bruchrechnung"), user=u, db=s)
    assert (await s.get(WorkAnalysis, g.id)).name == "Bruchrechnung"


@pytest.mark.asyncio
async def test_gleiches_niveau_wird_abgewiesen(s):
    u, c = await _grund(s)
    e = await KA.create_work(KA.WorkIn(class_id=c.id, name="KA", niveau="E"), user=u, db=s)
    with pytest.raises(HTTPException):
        await KA.create_work(KA.WorkIn(class_id=c.id, niveau="E", partner_id=e.id), user=u, db=s)
    ohne = await KA.create_work(KA.WorkIn(class_id=c.id, name="Alle"), user=u, db=s)
    with pytest.raises(HTTPException):
        await KA.create_work(KA.WorkIn(class_id=c.id, niveau="G", partner_id=ohne.id), user=u, db=s)
