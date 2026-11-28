"""Diagnose fuer die Entwicklerkonsole: warum sieht ein Kind welchen Stapel? (nuvoraDebug.karten)"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app import models as m
from app.routers import karten as K


@pytest.mark.asyncio
async def test_diagnose_nennt_sichtbare_und_versteckte_stapel(s):
    u = m.User(email="kd@s.de", password_hash="x", name="L", email_verified=True)
    s.add(u)
    await s.flush()
    s.add(m.UserModule(user_id=u.id, module_key="karten"))
    mathe = m.Kurs(owner_id=u.id, name="7.5 Mathe", fach="Mathematik", karten_aktiv=False)
    ga = m.Kurs(owner_id=u.id, name="7.5 GA", fach="GA")
    s.add_all([mathe, ga])
    await s.flush()
    c = m.SchoolClass(owner_id=u.id, name="7.5")
    s.add(c)
    await s.flush()
    s.add_all([m.KursTag(kurs_id=mathe.id, class_id=c.id), m.KursTag(kurs_id=ga.id, class_id=c.id)])
    st = m.Student(class_id=c.id, card_id=1, name="Anna", karten_token="tok-debug-0123456789abc")
    s.add(st)
    gestern = datetime.now(timezone.utc) - timedelta(days=1)
    d1 = m.CardDeck(owner_id=u.id, class_id=c.id, name="Zugewiesen GA", released_at=gestern)
    d2 = m.CardDeck(owner_id=u.id, class_id=c.id, name="Zugewiesen Mathe", released_at=gestern)
    s.add_all([d1, d2])
    await s.flush()
    s.add_all([m.CardDeckKurs(deck_id=d1.id, kurs_id=ga.id), m.CardDeckKurs(deck_id=d2.id, kurs_id=mathe.id)])
    await s.commit()
    out = await K.debug_zugang("tok-debug-0123456789abc", user=u, db=s)
    je = {z["stapel"]: z for z in out["stapel"]}
    assert je["Zugewiesen GA"]["sieht_es"] and "aktiven Kurs 7.5 GA" in je["Zugewiesen GA"]["grund"]
    assert not je["Zugewiesen Mathe"]["sieht_es"] and "zugewiesen nur an" in je["Zugewiesen Mathe"]["grund"]
    assert {k["name"]: k["karten_aktiv"] for k in out["kurse"]} == {"7.5 Mathe": False, "7.5 GA": True}
    # Fremde Lehrkraft kommt nicht heran.
    f = m.User(email="kf@s.de", password_hash="x", name="F", email_verified=True)
    s.add(f)
    await s.commit()
    with pytest.raises(HTTPException):
        await K.debug_zugang("tok-debug-0123456789abc", user=f, db=s)


@pytest.mark.asyncio
async def test_archivierter_vorjahreskurs_gibt_keine_karten_mehr_aus(s):
    u = m.User(email="ka@s.de", password_hash="x", name="L", email_verified=True)
    s.add(u)
    await s.flush()
    s.add(m.UserModule(user_id=u.id, module_key="karten"))
    alt = m.Kurs(owner_id=u.id, name="6.5 Mathematik")          # Karten an, aber archiviert
    neu = m.Kurs(owner_id=u.id, name="7.5 Mathematik", fach="Mathematik", karten_aktiv=False)
    ga = m.Kurs(owner_id=u.id, name="7.5 GA")
    s.add_all([alt, neu, ga])
    await s.flush()
    alt.archived_at = datetime.now(timezone.utc)
    c = m.SchoolClass(owner_id=u.id, name="7.5")
    s.add(c)
    await s.flush()
    s.add_all([m.KursTag(kurs_id=k.id, class_id=c.id) for k in (alt, neu, ga)])
    st = m.Student(class_id=c.id, card_id=1, name="Jesus", karten_token="tok-archiv-0123456789abc")
    s.add(st)
    d = m.CardDeck(owner_id=u.id, class_id=c.id, kurs_id=neu.id, name="Rationale Zahlen",
                   released_at=datetime.now(timezone.utc) - timedelta(days=1))
    s.add(d)
    await s.flush()
    s.add_all([m.CardDeckKurs(deck_id=d.id, kurs_id=k.id) for k in (alt, neu)])
    await s.commit()
    out = await K.debug_zugang("tok-archiv-0123456789abc", user=u, db=s)
    assert not {z["stapel"]: z for z in out["stapel"]}["Rationale Zahlen"]["sieht_es"]
