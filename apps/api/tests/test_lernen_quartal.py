"""Die Kinder sehen hinter dem QR-Code je Kurs auch Quartal und Halbjahr (Q1 · 1. HJ …)."""
from datetime import date

import pytest

from app import models as m
from app.routers import karten as K


@pytest.mark.asyncio
async def test_kind_sieht_quartal_und_halbjahr(s):
    u = m.User(email="lq@s.de", password_hash="x", name="L", email_verified=True)
    s.add(u)
    await s.flush()
    s.add_all([m.UserModule(user_id=u.id, module_key="cardvote"), m.UserModule(user_id=u.id, module_key="auswertung")])
    k = m.Kurs(owner_id=u.id, name="7.5 Mathe", fach="Mathe")
    s.add(k)
    await s.flush()
    c = m.SchoolClass(owner_id=u.id, name="7.5", kurs_id=k.id)
    s.add(c)
    await s.flush()
    st = m.Student(class_id=c.id, card_id=1, name="Anna", karten_token="tok-q")
    s.add(st)
    await s.flush()
    sec = m.GradeSection(owner_id=u.id, class_id=c.id, kurs_id=k.id, term="1", name="Schriftlich", weight=100)
    s.add(sec)
    await s.flush()
    for tag, wert in ((date(2026, 9, 20), 4.0), (date(2026, 12, 1), 2.0)):
        cat = m.GradeCategory(owner_id=u.id, class_id=c.id, section_id=sec.id, name=str(tag), date=tag)
        s.add(cat)
        await s.flush()
        s.add(m.GradeEntry(category_id=cat.id, student_id=st.id, kind="grade", value=wert))
    s.add(m.QuartalDatum(owner_id=u.id, class_id=c.id, kurs_id=k.id, term="1", datum=date(2026, 11, 10)))
    await s.commit()
    out = await K.student_aktuelle_note("tok-q", db=s)
    assert out and [(v["label"], v["wert"]) for v in out[0]["verlauf"]] == [("Q1", 4.0), ("1. HJ", 3.0)]
