"""Sitzplan haengt am Kurs (Fach): dieselbe Klasse sitzt in Mathe anders als in
Info. Der Plan wird nach kurs_id geschluesselt (Fallback class_id ohne Kurs).
"""
import pytest

from app.models import User, SchoolClass, Kurs, KursTag
from app.routers import sitzplan as S


async def _setup(s):
    u = User(email="a@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    A = SchoolClass(name="7.5", owner_id=u.id); s.add(A); await s.flush()
    mathe = Kurs(owner_id=u.id, name="Mathe"); info = Kurs(owner_id=u.id, name="Info")
    s.add(mathe); s.add(info); await s.flush()
    # Dieselbe Klasse A liegt in beiden Kursen.
    s.add(KursTag(kurs_id=mathe.id, class_id=A.id)); s.add(KursTag(kurs_id=info.id, class_id=A.id))
    await s.commit()
    return u, A, mathe, info


@pytest.mark.asyncio
async def test_plan_pro_kurs_getrennt(s):
    u, A, mathe, info = await _setup(s)
    # Plan im Mathe-Kurs speichern.
    await S.put_plan(A.id, S.PlanIn(seats=[{"sid": 1, "x": 10, "y": 20, "rot": 0}]), kurs_id=mathe.id, user=u, db=s)
    # Info-Kurs (gleiche Klasse) hat noch KEINEN Plan.
    info_plan = await S.get_plan(A.id, kurs_id=info.id, user=u, db=s)
    assert info_plan.get("seats") == [], "anderer Kurs derselben Klasse ist unabhaengig"
    # Mathe-Kurs behaelt seinen Plan.
    mathe_plan = await S.get_plan(A.id, kurs_id=mathe.id, user=u, db=s)
    assert len(mathe_plan.get("seats", [])) == 1


@pytest.mark.asyncio
async def test_tafel_rotation_bleibt(s):
    u, A, mathe, info = await _setup(s)
    await S.put_plan(A.id, S.PlanIn(seats=[], tafel={"x": 5, "y": 6, "rot": 90}), kurs_id=mathe.id, user=u, db=s)
    plan = await S.get_plan(A.id, kurs_id=mathe.id, user=u, db=s)
    assert plan["tafel"]["rot"] == 90
