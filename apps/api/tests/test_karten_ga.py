"""Klassen-Stapel ohne Kurs gehen nur ueber einen AKTIVEN Kurs desselben Fachs hinaus.

Gemeldet: 7.5 GA bekam Karteikarten von 7.5 Mathe, obwohl Mathe die Karten abgeschaltet hat — der Stapel hing an
der Klasse, und versteckt wurde nur bei exakt gleichem Fachnamen."""
import pytest
from sqlalchemy import select

from app import models as m
from app.routers import karten as K


async def _welt(s, ga_fach="GA"):
    u = m.User(email="ga@s.de", password_hash="x", name="L", email_verified=True)
    s.add(u)
    await s.flush()
    mathe = m.Kurs(owner_id=u.id, name="7.5 Mathe", fach="Mathe", karten_aktiv=False)
    ga = m.Kurs(owner_id=u.id, name="7.5 GA", fach=ga_fach)
    s.add_all([mathe, ga])
    await s.flush()
    c = m.SchoolClass(owner_id=u.id, name="7.5", kurs_id=mathe.id)
    s.add(c)
    await s.flush()
    s.add(m.KursTag(kurs_id=ga.id, class_id=c.id))
    st = m.Student(class_id=c.id, card_id=1, name="Anna")
    tp = m.Topic(owner_id=u.id, name="Brüche", fach="Mathematik")
    s.add_all([st, tp])
    await s.flush()
    d = m.CardDeck(owner_id=u.id, class_id=c.id, kurs_id=None, name="Brüche üben", topic_id=tp.id)
    s.add(d)
    await s.commit()
    return st, d


async def _sichtbar(s, st):
    return [x.id for x in (await s.execute(select(m.CardDeck).where(await K._student_deck_where(s, st)))).scalars().all()]


@pytest.mark.asyncio
async def test_mathe_stapel_geht_nicht_ueber_ga(s):
    st, d = await _welt(s)
    assert d.id not in await _sichtbar(s, st)


@pytest.mark.asyncio
async def test_mathe_stapel_geht_auch_nicht_ueber_kurs_ohne_fach(s):
    st, d = await _welt(s, ga_fach="")
    assert d.id not in await _sichtbar(s, st)


@pytest.mark.asyncio
async def test_lehrkraft_sieht_mathe_stapel_nur_im_mathekurs(s):
    st, d = await _welt(s)
    c = await s.get(m.SchoolClass, st.class_id)
    mathe, ga = (await s.execute(select(m.Kurs).order_by(m.Kurs.id))).scalars().all()
    for kurs, soll in ((mathe, True), (ga, False)):
        ids = [x.id for x in (await s.execute(select(m.CardDeck).where(await K._kurs_decks_where(c, kurs.id, s)))).scalars().all()]
        assert (d.id in ids) is soll, kurs.name
