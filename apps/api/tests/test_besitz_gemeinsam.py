"""Die zusammengefuehrten Besitz- und Schuelerhelfer, festgenagelt.

`app/besitz.py` und `app/schueler.py` haben eingesammelt, was vorher in jedem
Router noch einmal stand. Dieser Test haelt genau die Unterschiede fest, die
dabei **nicht** eingeebnet werden durften:

* die nachsichtige Klassenpruefung antwortet auf eine fremde Klasse mit 403 und
  laesst eine Klasse ohne owner_id durch,
* die strenge antwortet auf beides mit 404,
* und beide Fassungen sind weiter im Router zu haben, unter ihrem alten Namen.
"""
import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.besitz import klasse_oder_403, eigene_klasse, eigenes, kurs_oder_klasse
from app.schueler import SORTIERUNG, kanonisch, roster_klasse, roster_kurs, sortiert
from app.models import (Base, User, SchoolClass, Student, Kurs, KursTag, Topic, OrgaItem)


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


async def _konten(s):
    a = User(email="a@b.de", password_hash="x", name="A")
    b = User(email="b@b.de", password_hash="x", name="B")
    s.add_all([a, b])
    await s.flush()
    return a, b


# ─── Klassenpruefung: zwei Fassungen, zwei Antworten ───

@pytest.mark.asyncio
async def test_nachsichtige_fassung(s):
    a, b = await _konten(s)
    eigen = SchoolClass(name="7a", owner_id=a.id)
    fremd = SchoolClass(name="7b", owner_id=b.id)
    herrenlos = SchoolClass(name="Alt", owner_id=None)
    s.add_all([eigen, fremd, herrenlos])
    await s.commit()

    assert (await klasse_oder_403(s, a, eigen.id)).id == eigen.id
    # Bestand ohne owner_id gehoert allen — das war der Grund fuer diese Fassung.
    assert (await klasse_oder_403(s, a, herrenlos.id)).id == herrenlos.id
    with pytest.raises(HTTPException) as e:
        await klasse_oder_403(s, a, fremd.id)
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        await klasse_oder_403(s, a, 9999)
    assert e.value.status_code == 404


@pytest.mark.asyncio
async def test_strenge_fassung(s):
    a, b = await _konten(s)
    eigen = SchoolClass(name="7a", owner_id=a.id)
    fremd = SchoolClass(name="7b", owner_id=b.id)
    herrenlos = SchoolClass(name="Alt", owner_id=None)
    s.add_all([eigen, fremd, herrenlos])
    await s.commit()

    assert (await eigene_klasse(s, a, eigen.id)).id == eigen.id
    for fremde in (fremd.id, herrenlos.id, 9999):
        with pytest.raises(HTTPException) as e:
            await eigene_klasse(s, a, fremde)
        assert e.value.status_code == 404, "fremd darf nicht als 403 verraten werden"


@pytest.mark.asyncio
async def test_router_behalten_ihre_fassung(s):
    """Die alten Namen zeigen weiter auf die richtige der beiden Fassungen."""
    from app.routers import zufall, orga, sitzplan, anwesenheit, klassenarbeit, karten, noten
    for mod in (zufall, orga, sitzplan, anwesenheit, klassenarbeit):
        assert mod._owned_class is klasse_oder_403, mod.__name__
    for mod in (karten, noten):
        assert mod._owned_class is eigene_klasse, mod.__name__


# ─── Der allgemeine Besitz-Einzeiler ───

@pytest.mark.asyncio
async def test_eigenes(s):
    a, b = await _konten(s)
    ka = SchoolClass(name="7a", owner_id=a.id)
    kb = SchoolClass(name="7b", owner_id=b.id)
    s.add_all([ka, kb])
    await s.flush()
    mein = OrgaItem(owner_id=a.id, class_id=ka.id, name="X")
    dein = OrgaItem(owner_id=b.id, class_id=kb.id, name="Y")
    s.add_all([mein, dein])
    await s.commit()

    assert (await eigenes(s, OrgaItem, mein.id, a, "Punkt nicht gefunden")).id == mein.id
    for falsch in (dein.id, 9999):
        with pytest.raises(HTTPException) as e:
            await eigenes(s, OrgaItem, falsch, a, "Punkt nicht gefunden")
        assert e.value.status_code == 404
        assert e.value.detail == "Punkt nicht gefunden"


@pytest.mark.asyncio
async def test_eigenes_weich_uebergeht_papierkorb(s):
    from datetime import datetime, timezone
    a, _ = await _konten(s)
    t = Topic(owner_id=a.id, name="Bruch")
    s.add(t)
    await s.commit()
    assert (await eigenes(s, Topic, t.id, a, "Thema nicht gefunden", weich=True)).id == t.id

    t.deleted_at = datetime.now(timezone.utc)
    await s.commit()
    with pytest.raises(HTTPException) as e:
        await eigenes(s, Topic, t.id, a, "Thema nicht gefunden", weich=True)
    assert e.value.status_code == 404
    # Ohne weich=True bleibt der Datensatz erreichbar — das brauchen die
    # Papierkorb-Wege, die genau das Geloeschte anfassen.
    assert (await eigenes(s, Topic, t.id, a, "Thema nicht gefunden")).id == t.id


def test_kurs_oder_klasse_schluessel():
    a = User(id=1, email="a@b.de", password_hash="x")
    mit = kurs_oder_klasse(OrgaItem, a, 5, 7)
    ohne = kurs_oder_klasse(OrgaItem, a, 5, None)
    assert len(mit) == 2 and len(ohne) == 3, "mit Kurs zwei, ohne Kurs drei Bedingungen"
    assert str(mit[1]) == str(OrgaItem.kurs_id == 7)
    assert str(ohne[2]) == str(OrgaItem.kurs_id.is_(None))


# ─── Schuelerlisten ───

async def _lerngruppe(s):
    a, _ = await _konten(s)
    mathe = Kurs(owner_id=a.id, name="Mathe")
    s.add(mathe)
    k1 = SchoolClass(name="7a Mathe", owner_id=a.id)
    k2 = SchoolClass(name="7a Info", owner_id=a.id)
    s.add_all([k1, k2])
    await s.flush()
    s.add_all([KursTag(kurs_id=mathe.id, class_id=k1.id), KursTag(kurs_id=mathe.id, class_id=k2.id)])
    # Dieselbe Person steht in beiden Fach-Klassen; Anna sitzt hinten.
    s.add_all([
        Student(class_id=k1.id, card_id=1, name="Anna", position=2),
        Student(class_id=k1.id, card_id=2, name="Bert", position=1),
        Student(class_id=k2.id, card_id=1, name="Anna", position=2),
    ])
    await s.commit()
    return a, k1, mathe


@pytest.mark.asyncio
async def test_sortierung_nach_position(s):
    a, k1, _ = await _lerngruppe(s)
    namen = [x.name for x in await sortiert(s, Student.class_id == k1.id)]
    assert namen == ["Bert", "Anna"], "position schlaegt card_id"
    assert SORTIERUNG[0] is Student.position


@pytest.mark.asyncio
async def test_roster_dedupliziert_gleichnamige(s):
    a, k1, mathe = await _lerngruppe(s)
    namen = [x.name for x in await roster_klasse(s, k1.id)]
    assert namen == ["Bert", "Anna"], "Anna steht in zwei Fach-Klassen, gemeint ist eine"
    assert [x.name for x in await roster_kurs(s, mathe.id)] == ["Bert", "Anna"]


@pytest.mark.asyncio
async def test_roster_kurs_leer(s):
    a, _ = await _konten(s)
    leer = Kurs(owner_id=a.id, name="Leer")
    s.add(leer)
    await s.commit()
    assert await roster_kurs(s, leer.id) == []


def test_kanonisch_haelt_reihenfolge():
    class S:
        def __init__(self, name, position, card_id, id):
            self.name, self.position, self.card_id, self.id = name, position, card_id, id
    raus = kanonisch([S("Zoe", 3, 9, 3), S("Anna", 1, 1, 1), S("Zoe ", 3, 9, 7)])
    assert [x.name for x in raus] == ["Anna", "Zoe"]
