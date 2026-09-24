"""Unterthemen lassen sich ordnen — und nur die eigenen.

Die Oberfläche schickt EINE Liste: erst die Themen, dann die Unterthemen je
Thema. Innerhalb eines Themas muss die Reihenfolge danach stimmen, und eine
fremde ID in der Liste darf nichts verschieben.
"""
import pytest
from sqlalchemy import select

from app.models import Topic, User
from app.routers import topics as TOP


@pytest.mark.asyncio
async def test_unterthemen_folgen_der_liste(s):
    u = User(email="ord@d.de", password_hash="x", name="L")
    fremd = User(email="ord2@d.de", password_hash="x", name="F")
    s.add_all([u, fremd])
    await s.flush()

    netz = await TOP.create_topic(TOP.TopicIn(name="Netzwerk"), user=u, db=s)
    k = {}
    for name in ["2 IP", "4 Vermittlung", "1 Komponenten", "3 Trennung"]:
        k[name[0]] = await TOP.create_topic(TOP.TopicIn(name=name, parent_id=netz.id), user=u, db=s)
    andere = await TOP.create_topic(TOP.TopicIn(name="X"), user=fremd, db=s)
    alt = (await s.get(Topic, andere.id)).position

    ids = [netz.id] + [k[n].id for n in "1234"] + [andere.id]
    await TOP.reorder_topics(TOP.ReorderIn(ids=ids), user=u, db=s)

    rows = (await s.execute(
        select(Topic).where(Topic.parent_id == netz.id).order_by(Topic.position, Topic.name)
    )).scalars().all()
    assert [r.name[0] for r in rows] == list("1234")
    assert (await s.get(Topic, andere.id)).position == alt


@pytest.mark.asyncio
async def test_nummer_wird_gespeichert_und_bleibt_ohne_angabe(s):
    u = User(email="nr@d.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()

    t = await TOP.create_topic(TOP.TopicIn(name="Netzwerk", nummer="9.1", jahrgang="9", fach="Informatik"), user=u, db=s)
    assert t.nummer == "9.1" and t.jahrgang == "9"

    # Ein alter Client schickt keine Nummer — sie darf nicht verschwinden.
    aus = await TOP.update_topic(t.id, TOP.TopicIn(name="Netzwerke", fach="Informatik", jahrgang="9"), user=u, db=s)
    assert aus.nummer == "9.1"

    aus = await TOP.update_topic(t.id, TOP.TopicIn(name="Netzwerke", nummer=""), user=u, db=s)
    assert aus.nummer == ""
