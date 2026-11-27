"""Mehrere Sitzplaene je Kurs: getrennt gespeichert, Kopie moeglich, fremde Plan-ID ist 404."""
import pytest
from fastapi import HTTPException

from app import models as m
from app.routers import sitzplan as S


async def _welt(s):
    u = m.User(email="sp@s.de", password_hash="x", name="L", email_verified=True)
    s.add(u)
    await s.flush()
    k = m.Kurs(owner_id=u.id, name="7a")
    s.add(k)
    await s.flush()
    c = m.SchoolClass(owner_id=u.id, name="7a", kurs_id=k.id)
    s.add(c)
    await s.commit()
    return u, k, c


@pytest.mark.asyncio
async def test_zwei_plaene_bleiben_getrennt(s):
    u, k, c = await _welt(s)
    await S.put_plan(c.id, S.PlanIn(seats=[{"sid": 1, "x": 10, "y": 10}]), kurs_id=k.id, user=u, db=s)
    erster = (await S.list_plaene(c.id, kurs_id=k.id, user=u, db=s))[0]
    zweiter = await S.neuer_plan(c.id, S.PlanNeu(name="Computerraum", kopie_von=erster["id"]), kurs_id=k.id, user=u, db=s)
    await S.put_plan(c.id, S.PlanIn(seats=[{"sid": 1, "x": 99, "y": 99}]), kurs_id=k.id, plan_id=zweiter["id"], user=u, db=s)
    a = await S.get_plan(c.id, kurs_id=k.id, user=u, db=s)
    b = await S.get_plan(c.id, kurs_id=k.id, plan_id=zweiter["id"], user=u, db=s)
    assert a["seats"][0]["x"] == 10 and b["seats"][0]["x"] == 99
    assert [p["name"] for p in await S.list_plaene(c.id, kurs_id=k.id, user=u, db=s)] == ["", "Computerraum"]
    await S.plan_umbenennen(erster["id"], S.PlanName(name="Klassenraum"), user=u, db=s)
    await S.plan_loeschen(zweiter["id"], user=u, db=s)
    assert [p["name"] for p in await S.list_plaene(c.id, kurs_id=k.id, user=u, db=s)] == ["Klassenraum"]


@pytest.mark.asyncio
async def test_fremde_plan_id_ist_404(s):
    u, k, c = await _welt(s)
    p = await S.neuer_plan(c.id, S.PlanNeu(name="X"), kurs_id=k.id, user=u, db=s)
    fremd = m.User(email="f2@s.de", password_hash="x", name="F", email_verified=True)
    s.add(fremd)
    await s.commit()
    with pytest.raises(HTTPException):
        await S.plan_loeschen(p["id"], user=fremd, db=s)
    with pytest.raises(HTTPException):
        await S.get_plan(c.id, kurs_id=k.id, plan_id=p["id"] + 999, user=u, db=s)
