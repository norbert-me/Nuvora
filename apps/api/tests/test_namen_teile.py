"""Ein Nachname aus zwei Woertern bleibt beim Speichern zusammen (geschuetztes Leerzeichen U+00A0)."""
import pytest

from app import models as m
from app.routers import personen as P


@pytest.mark.asyncio
async def test_doppelname_bleibt_zusammen(s):
    u = m.User(email="nt@s.de", password_hash="x", name="L", email_verified=True)
    s.add(u)
    await s.flush()
    p = m.Person(owner_id=u.id, name="Anna Klein")
    s.add(p)
    await s.commit()
    name = "Anna  Lena Klein Müller "
    out = await P.update_person(p.id, P.PersonPatch(name=name), user=u, db=s)
    assert out.name == "Anna Lena Klein Müller"
