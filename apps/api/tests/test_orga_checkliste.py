"""Checklisten: Abhaken merkt den Tag, Aufheben vergisst ihn; Export als Excel mit Datum je Zelle."""
import io

import pytest
from openpyxl import load_workbook

from app import models as m
from app.routers import orga as O


async def _welt(s):
    u = m.User(email="o@s.de", password_hash="x", name="L", email_verified=True)
    s.add(u)
    await s.flush()
    c = m.SchoolClass(owner_id=u.id, name="7a")
    s.add(c)
    await s.flush()
    a = m.Student(class_id=c.id, card_id=1, name="Anna")
    b = m.Student(class_id=c.id, card_id=2, name="=Ben")
    s.add_all([a, b])
    await s.flush()
    it = m.OrgaItem(owner_id=u.id, class_id=c.id, name="Unterschrift KA1", done=[])
    s.add(it)
    await s.commit()
    return u, c, a, b, it


@pytest.mark.asyncio
async def test_abhaken_merkt_den_tag(s):
    u, c, a, _, it = await _welt(s)
    out = await O.toggle(it.id, O.ToggleIn(student_id=a.id), user=u, db=s)
    assert a.id in out.done and len(out.done_at[str(a.id)]) == 10
    out = await O.toggle(it.id, O.ToggleIn(student_id=a.id), user=u, db=s)
    assert a.id not in out.done and str(a.id) not in out.done_at


@pytest.mark.asyncio
async def test_export_zeigt_datum_und_fehlende(s):
    u, c, a, b, it = await _welt(s)
    await O.toggle(it.id, O.ToggleIn(student_id=a.id), user=u, db=s)
    resp = await O.export_xlsx(c.id, user=u, db=s)
    daten = b"".join([x async for x in resp.body_iterator])
    ws = load_workbook(io.BytesIO(daten)).active
    zeilen = {ws.cell(r, 1).value: ws.cell(r, 2).value for r in (2, 3)}
    assert zeilen["Anna"] and zeilen["Anna"].count(".") == 2
    assert zeilen["=Ben"] is None                      # fehlt; der Name bleibt Text, keine Formel
    assert ws.cell(5, 2).value == "1/2"
