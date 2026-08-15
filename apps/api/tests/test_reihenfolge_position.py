"""Regressionstest: Schueler-Reihenfolge ist `position`, niemals `card_id`.

Hintergrund: card_id ist die Nummer der GEDRUCKTEN ArUco-Karte und wird nie
neu vergeben — sie sagt nichts darueber, an welcher Stelle der Klassenliste ein
Kind steht. Mehrere Stellen sortierten trotzdem nach card_id (Karten-Roster,
Kurs-Roster, Kartenbogen-PDF) oder nach Namen (Auswertungs-Exporte). Nach dem
ersten Umsortieren stand dieselbe Klasse dann in jeder Ansicht anders da.

Der Aufbau ist ueberall gleich: die Namen stehen in position-Reihenfolge
absichtlich umgekehrt zur card_id-Reihenfolge — wer nach card_id sortiert,
faellt sofort auf.

Lauf:  cd apps/api && pip install -r requirements-dev.txt && pytest
"""
import pytest
import pytest_asyncio
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, User, SchoolClass, Student, Kurs, KursTag
from app.routers import karten as K
from app.routers import kurse as KU
from app.routers import classes as C


@pytest_asyncio.fixture
async def s():
    e = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(e.sync_engine, "connect")
    def _fk(c, _):
        c.execute("PRAGMA foreign_keys=ON")

    async with e.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(e, class_=AsyncSession, expire_on_commit=False)() as ss:
        yield ss
    await e.dispose()


# position-Reihenfolge: Anna, Bea, Cem — card_id-Reihenfolge: Cem, Bea, Anna.
NACH_POSITION = ["Anna", "Bea", "Cem"]


async def _klasse(s):
    u = User(email="a@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    k = Kurs(owner_id=u.id, name="7.5")
    s.add(k)
    await s.flush()
    cls = SchoolClass(name="Mathe 7.5", owner_id=u.id, kurs_id=k.id)
    s.add(cls)
    await s.flush()
    s.add(KursTag(kurs_id=k.id, class_id=cls.id))
    s.add(Student(card_id=3, name="Anna", class_id=cls.id, position=0))
    s.add(Student(card_id=2, name="Bea", class_id=cls.id, position=1))
    s.add(Student(card_id=1, name="Cem", class_id=cls.id, position=2))
    await s.commit()
    return u, k, cls


@pytest.mark.asyncio
async def test_karten_roster_nach_position(s):
    u, k, cls = await _klasse(s)
    roster = await K._kurs_roster(s, u, cls.id)
    assert [x.name for x in roster] == NACH_POSITION


@pytest.mark.asyncio
async def test_karten_roster_teilkurs_nach_position(s):
    u, k, cls = await _klasse(s)
    roster = await K._kurs_roster(s, u, cls.id, subset_kurs=k.id)
    assert [x.name for x in roster] == NACH_POSITION


@pytest.mark.asyncio
async def test_kurs_students_nach_position(s):
    u, k, cls = await _klasse(s)
    assert [x["name"] for x in await KU.kurs_students(k.id, user=u, db=s)] == NACH_POSITION


@pytest.mark.asyncio
async def test_kurs_massnahmen_nach_position(s):
    u, k, cls = await _klasse(s)
    assert [x["name"] for x in await KU.kurs_massnahmen(k.id, user=u, db=s)] == NACH_POSITION


@pytest.mark.asyncio
async def test_klassen_massnahmen_nach_position(s):
    u, k, cls = await _klasse(s)
    # Die Liste zeigt nur Kinder MIT Eintrag — also allen dreien einen geben.
    for st in (await s.execute(select(Student))).scalars().all():
        st.massnahmen = [{"art": "Zeitzuschlag", "detail": "", "arbeit": True}]
    await s.commit()
    rows = await C.list_massnahmen(cls.id, user=u, db=s)
    assert [x.name for x in rows] == NACH_POSITION


@pytest.mark.asyncio
async def test_klasse_liefert_position_mit(s):
    """Die Oberflaeche mischt SuS mehrerer Fach-Klassen zu einem Kurs-Roster und
    muss danach neu sortieren koennen — ohne position bliebe ihr nur card_id."""
    u, k, cls = await _klasse(s)
    out = C.ClassOut.model_validate(await C.get_class(cls.id, user=u, db=s))
    assert [(x.name, x.position) for x in out.students] == [("Anna", 0), ("Bea", 1), ("Cem", 2)]
