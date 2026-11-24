"""Welcher Kurs gilt in der CardVote-Auswertung? Gemeldet: die Note landete im Notenbuch des falschen Kurses.

Hat die Sitzung keinen eigenen Kurs und liegt die Klasse in mehreren, wird nicht mehr der Standard-Kurs der
Klasse stillschweigend genommen — sonst steht die Spalte im Notenbuch eines anderen Fachs."""
import pytest

from app import models as m
from app.routers.results import get_evaluation


async def _aufbau(s, mit_zweitem_kurs):
    u = m.User(email="k@s.de", password_hash="x", name="L", email_verified=True)
    s.add(u)
    await s.flush()
    a = m.Kurs(owner_id=u.id, name="Mathe 7")
    b = m.Kurs(owner_id=u.id, name="Info 7")
    s.add_all([a, b])
    await s.flush()
    c = m.SchoolClass(owner_id=u.id, name="7a", kurs_id=a.id)       # Standard-Kurs der Klasse
    s.add(c)
    await s.flush()
    if mit_zweitem_kurs:
        s.add(m.KursTag(kurs_id=b.id, class_id=c.id))
    sess = m.Session(owner_id=u.id, class_id=c.id, name="Test")
    s.add(sess)
    await s.commit()
    return u, a, b, sess


@pytest.mark.asyncio
async def test_mehrere_kurse_ohne_zuweisung_wird_nicht_geraten(s):
    u, a, b, sess = await _aufbau(s, mit_zweitem_kurs=True)
    erg = await get_evaluation(sess.id, user=u, db=s)
    assert erg["kurs_id"] is None, "der Standard-Kurs der Klasse ist einer von zwei — nicht still nehmen"
    assert {k["id"] for k in erg["kurse"]} == {a.id, b.id}


@pytest.mark.asyncio
async def test_ein_einziger_kurs_gilt_von_selbst(s):
    u, a, b, sess = await _aufbau(s, mit_zweitem_kurs=False)
    assert (await get_evaluation(sess.id, user=u, db=s))["kurs_id"] == a.id


@pytest.mark.asyncio
async def test_zugewiesener_kurs_gilt_immer(s):
    u, a, b, sess = await _aufbau(s, mit_zweitem_kurs=True)
    sess.kurs_id = b.id
    await s.commit()
    assert (await get_evaluation(sess.id, user=u, db=s))["kurs_id"] == b.id
