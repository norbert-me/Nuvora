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


@pytest.mark.asyncio
async def test_kurs_des_vorjahrs_und_archivierte_zeigen_keine_note(s):
    u = m.User(email="lv@s.de", password_hash="x", name="L", email_verified=True)
    s.add(u)
    await s.flush()
    s.add_all([m.UserModule(user_id=u.id, module_key="cardvote"), m.UserModule(user_id=u.id, module_key="auswertung")])
    alt = m.Kurs(owner_id=u.id, name="6.5 Mathe", fach="Mathematik")
    s.add(alt)
    await s.flush()
    neu = m.Kurs(owner_id=u.id, name="7.5 Mathe", fach="Mathematik", vorgaenger_id=alt.id)
    weg = m.Kurs(owner_id=u.id, name="7.5 AG", fach="Kunst")
    s.add_all([neu, weg])
    await s.flush()
    from datetime import datetime, timezone
    weg.archived_at = datetime.now(timezone.utc)
    c = m.SchoolClass(owner_id=u.id, name="7.5")
    s.add(c)
    await s.flush()
    s.add_all([m.KursTag(kurs_id=k.id, class_id=c.id) for k in (alt, neu, weg)])
    st = m.Student(class_id=c.id, card_id=1, name="Anna", karten_token="tok-v")
    s.add(st)
    await s.flush()
    for k in (alt, neu, weg):
        sec = m.GradeSection(owner_id=u.id, class_id=c.id, kurs_id=k.id, term="1", name="Alles", weight=100)
        s.add(sec)
        await s.flush()
        cat = m.GradeCategory(owner_id=u.id, class_id=c.id, section_id=sec.id, name="KA")
        s.add(cat)
        await s.flush()
        s.add(m.GradeEntry(category_id=cat.id, student_id=st.id, kind="grade", value=3.0))
    await s.commit()
    out = await K.student_aktuelle_note("tok-v", db=s)
    assert [o["kurs"] for o in out] == ["Mathematik"]
