"""Quartalsstriche als Datum: setzen, entfernen, aus alten Spaltenstrichen umwandeln."""
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import select

from app import models as m
from app.quartal import striche_zu_daten
from app.routers import noten as N


async def _welt(s):
    u = m.User(email="q@s.de", password_hash="x", name="L", email_verified=True)
    s.add(u)
    await s.flush()
    c = m.SchoolClass(owner_id=u.id, name="7a")
    s.add(c)
    await s.flush()
    sec = m.GradeSection(owner_id=u.id, class_id=c.id, term="1", name="Mündlich")
    s.add(sec)
    await s.flush()
    return u, c, sec


@pytest.mark.asyncio
async def test_setzen_ist_idempotent_und_entfernen_geht(s):
    u, c, _ = await _welt(s)
    assert await N.set_quartalsstrich(c.id, N.StrichIn(datum="2026-11-01"), user=u, db=s) == ["2026-11-01"]
    assert await N.set_quartalsstrich(c.id, N.StrichIn(datum="2026-11-01"), user=u, db=s) == ["2026-11-01"]
    assert await N.set_quartalsstrich(c.id, N.StrichIn(datum="2026-09-15"), user=u, db=s) == ["2026-09-15", "2026-11-01"]
    assert await N.delete_quartalsstrich(c.id, datum="2026-11-01", user=u, db=s) == ["2026-09-15"]
    assert await N.list_quartalsstriche(c.id, user=u, db=s) == ["2026-09-15"]


@pytest.mark.asyncio
async def test_kein_gueltiges_datum_wird_abgelehnt(s):
    from fastapi import HTTPException
    u, c, _ = await _welt(s)
    with pytest.raises(HTTPException) as e:
        await N.set_quartalsstrich(c.id, N.StrichIn(datum="gestern"), user=u, db=s)
    assert e.value.status_code == 400


@pytest.mark.asyncio
async def test_fremde_klasse_bleibt_zu(s):
    from fastapi import HTTPException
    u, c, _ = await _welt(s)
    fremd = m.User(email="f@s.de", password_hash="x", name="F", email_verified=True)
    s.add(fremd)
    await s.commit()
    with pytest.raises(HTTPException):
        await N.set_quartalsstrich(c.id, N.StrichIn(datum="2026-11-01"), user=fremd, db=s)


@pytest.mark.asyncio
async def test_alte_spaltenstriche_werden_zum_datum_der_spalte(s):
    u, c, sec = await _welt(s)
    mit_datum = m.GradeCategory(owner_id=u.id, class_id=c.id, section_id=sec.id, name="A", date=date(2026, 10, 2))
    ohne_datum = m.GradeCategory(owner_id=u.id, class_id=c.id, section_id=sec.id, name="B",
                                 created_at=datetime(2026, 11, 9, 12, 0, tzinfo=timezone.utc))
    doppelt = m.GradeCategory(owner_id=u.id, class_id=c.id, section_id=sec.id, name="C", date=date(2026, 10, 2))
    s.add_all([mit_datum, ohne_datum, doppelt])
    await s.flush()
    for cat in (mit_datum, ohne_datum, doppelt):
        s.add(m.QuartalDivider(class_id=c.id, owner_id=u.id, term="1", after_category_id=cat.id))
    await s.commit()

    assert await striche_zu_daten(s) == 3
    # der doppelte Tag fällt weg; die alte Tabelle ist leer
    assert await N.list_quartalsstriche(c.id, user=u, db=s) == ["2026-10-02", "2026-11-09"]
    assert (await s.execute(select(m.QuartalDivider))).first() is None
    assert await striche_zu_daten(s) == 0           # idempotent
