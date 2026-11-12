"""LE (Förderschwerpunkt Lernen) gilt, wenn Person ODER Listenzeile es sagt.

Vorher überdeckte eine nichtleere Angabe an der Person (z. B. nur „LRS") das „Lernen" an der Zeile —
das Kind bekam am Zugang trotzdem eine Note angezeigt."""
import pytest

from app.models import Person, SchoolClass, Student, User
from app.schueler import le_ids


async def _kinder(s, person_foerder, zeile_foerder):
    u = User(email="le@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    c = SchoolClass(name="7.5", owner_id=u.id)
    s.add(c)
    await s.flush()
    p = Person(owner_id=u.id, name="Anna", foerder=person_foerder)
    s.add(p)
    await s.flush()
    st = Student(class_id=c.id, name="Anna", card_id=1, person_id=p.id, foerder=zeile_foerder)
    s.add(st)
    await s.commit()
    return st


@pytest.mark.asyncio
async def test_person_nur_lrs_zeile_hat_lernen(s):
    st = await _kinder(s, ["LRS"], ["LRS", "Lernen"])
    assert st.id in await le_ids(s, [st])


@pytest.mark.asyncio
async def test_person_hat_lernen_zeile_leer(s):
    st = await _kinder(s, ["LRS", "Lernen"], [])
    assert st.id in await le_ids(s, [st])


@pytest.mark.asyncio
async def test_ohne_lernen_nicht_le(s):
    st = await _kinder(s, ["LRS"], ["Dyskalkulie"])
    assert st.id not in await le_ids(s, [st])
