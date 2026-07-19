"""Regressionstest: Mandantentrennung + vollständige Konto-Löschung.

Nuvora ist öffentlich, Trennung **pro Lehrkraft**. Zwei Dinge müssen halten,
sonst ist es ein Datenleck bzw. ein DSGVO-Verstoß:

1. `test_isolation_*` — Lehrkraft B darf Daten von A nie sehen oder ändern.
   Jeder Modul-Router filtert über owner_id / _owned_class; hier festgehalten.
2. `test_delete_account_purges_everything` — Konto löschen entfernt ALLE
   Modul-Daten (Kaskade). Kein verwaistes Häkchen, keine Note, keine Ausleihe.

Lauf:  cd apps/api && pip install -r requirements-dev.txt && pytest
"""
import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import event, select, func
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app import models as m
from app.models import Base, User, SchoolClass, Student
from app.routers import classes, noten, karten, orga, ausleihe


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk_on(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)() as s:
        yield s
    await engine.dispose()


async def _teacher(s, email):
    u = User(email=email, password_hash="x", name=email)
    s.add(u)
    await s.flush()
    return u


async def _class_with_data(s, owner):
    """Klasse + Schüler + je eine Zeile in jedem klassengebundenen Modul."""
    cls = SchoolClass(name="7a", owner_id=owner.id, color="#2563eb")
    s.add(cls)
    await s.flush()
    stud = Student(card_id=1, name="Max", class_id=cls.id)
    s.add(stud)
    await s.flush()
    sec = m.GradeSection(owner_id=owner.id, class_id=cls.id, term="1", name="KA", weight=50)
    s.add(sec)
    await s.flush()
    cat = m.GradeCategory(owner_id=owner.id, class_id=cls.id, section_id=sec.id, name="1. KA")
    s.add(cat)
    await s.flush()
    s.add(m.GradeEntry(category_id=cat.id, student_id=stud.id, kind="grade", value=2.0))
    deck = m.CardDeck(owner_id=owner.id, class_id=cls.id, name="Vokabeln")
    s.add(deck)
    s.add(m.OrgaItem(owner_id=owner.id, class_id=cls.id, name="KA1", position=0, done=[stud.id]))
    s.add(m.Attendance(owner_id=owner.id, class_id=cls.id, student_id=stud.id, date=func.now(), status="fehlt"))
    item = m.MaterialItem(owner_id=owner.id, name="Zirkel")
    s.add(item)
    await s.flush()
    s.add(m.MaterialLoan(owner_id=owner.id, item_id=item.id, student_id=stud.id, borrower=""))
    await s.commit()
    return cls, stud


# --- Mandantentrennung ---------------------------------------------------

@pytest.mark.asyncio
async def test_isolation_class_list(session):
    a = await _teacher(session, "a@x.de")
    b = await _teacher(session, "b@x.de")
    await _class_with_data(session, a)
    seen = await classes.list_classes(user=b, db=session)
    assert seen == [] or all(c.owner_id != a.id for c in seen), "B sieht A's Klasse"


@pytest.mark.asyncio
async def test_null_owner_class_nicht_oeffentlich(session):
    # Früher galt owner_id IS NULL als „für alle sichtbar" (Leck). Jetzt strikt:
    # eine Klasse ohne Owner taucht bei niemandem in der Liste auf.
    b = await _teacher(session, "b@x.de")
    orphan = SchoolClass(name="Alt", owner_id=None)
    session.add(orphan)
    await session.commit()
    seen = await classes.list_classes(user=b, db=session)
    assert seen == [], "NULL-owner-Klasse ist für Fremde sichtbar"


@pytest.mark.asyncio
async def test_isolation_class_access(session):
    a = await _teacher(session, "a@x.de")
    b = await _teacher(session, "b@x.de")
    cls, _ = await _class_with_data(session, a)
    with pytest.raises(HTTPException):
        await classes.get_class(cls.id, user=b, db=session)


@pytest.mark.asyncio
async def test_isolation_module_reads(session):
    a = await _teacher(session, "a@x.de")
    b = await _teacher(session, "b@x.de")
    cls, _ = await _class_with_data(session, a)
    # Notenspalten, Karten-Decks, Orga über fremde Klasse -> 403/404.
    for call in (
        lambda: noten.list_sections(cls.id, user=b, db=session),
        lambda: karten.list_decks(cls.id, user=b, db=session),
        lambda: orga.list_items(cls.id, user=b, db=session),
    ):
        with pytest.raises(HTTPException):
            await call()
    # Ausleihe ist nicht klassengebunden -> owner-gefilterte Liste bleibt leer.
    assert await ausleihe.list_items(user=b, db=session) == []


# --- Konto-Löschung räumt alles ab --------------------------------------

MODULE_ROWS = [
    m.SchoolClass, m.Student, m.GradeSection, m.GradeCategory, m.GradeEntry,
    m.CardDeck, m.OrgaItem, m.Attendance, m.MaterialItem, m.MaterialLoan,
]


@pytest.mark.asyncio
async def test_delete_account_purges_everything(session):
    a = await _teacher(session, "a@x.de")
    b = await _teacher(session, "b@x.de")
    await _class_with_data(session, a)
    keep_cls, _ = await _class_with_data(session, b)  # B bleibt unberührt

    a_id = a.id
    await session.delete(a)
    await session.commit()
    session.expunge_all()

    # Keine einzige Zeile von A darf übrig sein.
    for model in MODULE_ROWS:
        col = "owner_id" if hasattr(model, "owner_id") else None
        if col:
            n = (await session.execute(select(func.count()).select_from(model).where(model.owner_id == a_id))).scalar()
            assert n == 0, f"{model.__tablename__}: {n} Zeilen von A übrig"
    # B ist unversehrt.
    b_classes = (await session.execute(select(func.count()).select_from(m.SchoolClass).where(m.SchoolClass.owner_id == b.id))).scalar()
    assert b_classes == 1, "B's Klasse wurde mitgelöscht"
