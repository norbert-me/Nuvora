"""Modul Kalender: die Zeitleiste eines Kurses.

Vier Quellen auf EINER Achse — Unterrichtsstunden, Klassenarbeiten,
Freischaltungen und Themen. Was hier bewacht wird:

  1. Alles landet auf derselben Achse und ist nach Tag (dann Stunde) sortiert.
  2. Regel 3: eine Freischaltung erscheint nur, wenn ihr Modul aktiv ist —
     ohne es faellt der Punkt heraus, nicht die Leiste.
  3. Ein Thema steht einmal je Tag, auch wenn es an dem Tag zwei Stunden hat.
  4. Fremde Kurse bleiben zu.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException

from app.models import ExamDate, Kurs, KursTag, SchoolClass, User, UserModule
from app.routers import kalender as KAL


async def _welt(s, module=("kalender",)):
    u = User(email="zl@b.de", password_hash="x", name="L",
             hj1_start=(datetime.now().date() - timedelta(days=10)),
             hj2_start=(datetime.now().date() + timedelta(days=120)))
    s.add(u)
    await s.flush()
    for m in module:
        s.add(UserModule(user_id=u.id, module_key=m))
    cls = SchoolClass(name="7a", owner_id=u.id)
    s.add(cls)
    await s.flush()
    k = Kurs(owner_id=u.id, name="Mathe 7a", fach="Mathe")
    s.add(k)
    await s.flush()
    s.add(KursTag(kurs_id=k.id, class_id=cls.id))
    await s.commit()
    return u, cls, k


@pytest.mark.asyncio
async def test_arbeiten_und_themen_auf_der_achse(s):
    u, cls, k = await _welt(s)
    tag = datetime.combine(datetime.now().date() + timedelta(days=3), datetime.min.time())
    s.add(ExamDate(owner_id=u.id, kurs_id=k.id, date=tag + timedelta(days=7), title="Arbeit 1"))
    await s.commit()
    # Zwei Stunden am selben Tag, dasselbe Thema.
    from app.models import Topic
    th = Topic(owner_id=u.id, name="Brüche")
    s.add(th)
    await s.flush()
    for p in (1, 2):
        await KAL.create_entry(KAL.EntryIn(date=tag, title=f"Stunde {p}", period=p,
                                           kurs_id=k.id, class_id=cls.id, topic_id=th.id), user=u, db=s)

    aus = await KAL.zeitleiste(kurs_id=k.id, user=u, db=s)
    arten = [p["art"] for p in aus["punkte"]]
    assert "arbeit" in arten
    assert arten.count("thema") == 1, "ein Thema steht einmal je Tag, nicht je Stunde"
    # Sortiert: nach Tag, innerhalb des Tages nach Stunde.
    daten = [p["date"] for p in aus["punkte"]]
    assert daten == sorted(daten)


@pytest.mark.asyncio
async def test_freischaltung_nur_mit_modul(s):
    u, cls, k = await _welt(s)          # nur Kalender aktiv
    from app.models import CardDeck
    deck = CardDeck(owner_id=u.id, name="Stapel")
    s.add(deck)
    await s.flush()
    tag = datetime.combine(datetime.now().date() + timedelta(days=2), datetime.min.time())
    # Ohne Modul Karten laesst der Kalender die Verknuepfung gar nicht zu —
    # deshalb Modul an, Eintrag anlegen, Modul wieder aus.
    s.add(UserModule(user_id=u.id, module_key="karten"))
    await s.commit()
    await KAL.create_entry(KAL.EntryIn(date=tag, title="Karten frei", kurs_id=k.id,
                                       class_id=cls.id, karten_deck_id=deck.id), user=u, db=s)
    mit = await KAL.zeitleiste(kurs_id=k.id, user=u, db=s)
    assert any(p["art"] == "freischaltung" for p in mit["punkte"])

    from sqlalchemy import delete
    await s.execute(delete(UserModule).where(UserModule.user_id == u.id, UserModule.module_key == "karten"))
    await s.commit()
    ohne = await KAL.zeitleiste(kurs_id=k.id, user=u, db=s)
    assert not any(p["art"] == "freischaltung" for p in ohne["punkte"]), \
        "ohne das Modul faellt der Punkt heraus — die Leiste bleibt"


@pytest.mark.asyncio
async def test_fremder_kurs_bleibt_zu(s):
    u, cls, k = await _welt(s)
    fremd = User(email="fremd@b.de", password_hash="x", name="F")
    s.add(fremd)
    await s.flush()
    s.add(UserModule(user_id=fremd.id, module_key="kalender"))
    await s.commit()
    with pytest.raises(HTTPException) as e:
        await KAL.zeitleiste(kurs_id=k.id, user=fremd, db=s)
    assert e.value.status_code in (403, 404)
