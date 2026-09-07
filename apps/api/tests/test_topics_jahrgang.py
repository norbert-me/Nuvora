"""Der Jahrgang nimmt Zahl UND Text.

„7/8" gibt es wirklich (Kombiklasse, WP-Kurs über zwei Stufen) — deshalb ist das
Feld Text geworden. Ältere Clients (und der Selbsttest) schicken aber weiter die
blanke 7; ein Feld, das jahrelang eine Zahl war, darf über Nacht kein 422 geben.
Genau daran ist der Selbsttest nach der Umstellung rot geworden.
"""
import pytest

from app.models import User
from app.routers import kurse as KUR
from app.routers import topics as TOP


@pytest.mark.asyncio
async def test_jahrgang_nimmt_zahl_und_text(s):
    u = User(email="jg@d.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()

    # Zahl (alter Client)
    t1 = await TOP.create_topic(TOP.TopicIn(name="Bruchrechnung", jahrgang=7), user=u, db=s)
    assert t1.jahrgang == "7"

    # Text mit Schrägstrich (der eigentliche Anlass)
    t2 = await TOP.create_topic(TOP.TopicIn(name="Wahlpflicht", jahrgang="7/8"), user=u, db=s)
    assert t2.jahrgang == "7/8"

    # Dasselbe am Kurs
    k = await KUR.create_kurs(KUR.KursIn(name="WP 7/8"), user=u, db=s)
    aus = await KUR.rename_kurs(k.id, KUR.KursIn(name="WP 7/8", jahrgang=8), user=u, db=s)
    assert aus.jahrgang == "8"
    aus = await KUR.rename_kurs(k.id, KUR.KursIn(name="WP 7/8", jahrgang="7/8"), user=u, db=s)
    assert aus.jahrgang == "7/8"
