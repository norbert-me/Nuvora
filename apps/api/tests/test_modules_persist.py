"""Regressionstest: die eigenständigen Zusatzmodule speichern dauerhaft.

Hintergrund: Orga und Material-Ausleihe erschienen einmal als „speichert nicht"
— tatsächlich fehlten auf dem Server die Tabellen (orga_items, material_items,
material_loans), weil nur `web`, nicht `api` neu gestartet wurde. Der Code war
korrekt, aber nichts hielt das fest. Dieser Test tut es:

1. `test_module_tables_registered` — jede Modultabelle hängt an Base.metadata,
   d.h. `create_all` legt sie beim Start an. Faellt ein Modell mal aus dem
   Import (Tippfehler, vergessene Zeile), schlaegt das hier sofort fehl.
2. Funktionstests — Schreiben + Reload (expunge) beweisen echte Persistenz,
   nicht nur In-Memory-Optimismus im Frontend.

Lauf:  cd apps/api && pip install -r requirements-dev.txt && pytest
"""
import pytest
import pytest_asyncio
from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, User, SchoolClass, Student
from app.routers import orga, ausleihe


# Neue Modultabellen: fehlt eine hier, ist ihr Modell nicht importiert und
# create_all wuerde sie nie anlegen — dann speichert das Modul live nichts.
EXPECTED_TABLES = ["orga_items", "material_items", "material_loans"]


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    # SQLite erzwingt Fremdschluessel nur mit PRAGMA — sonst greifen Kaskaden nicht.
    @event.listens_for(engine.sync_engine, "connect")
    def _fk_on(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)() as s:
        yield s
    await engine.dispose()


async def _seed(s):
    user = User(email="a@b.de", password_hash="x", name="Lehrkraft")
    s.add(user)
    await s.flush()
    cls = SchoolClass(name="7a", owner_id=user.id, color="#2563eb")
    s.add(cls)
    await s.flush()
    stud = Student(card_id=1, name="Max", class_id=cls.id)
    s.add(stud)
    await s.flush()
    await s.commit()
    return user, cls, stud


def test_module_tables_registered():
    for name in EXPECTED_TABLES:
        assert name in Base.metadata.tables, (
            f"Tabelle {name} fehlt in Base.metadata — Modell nicht importiert? "
            f"create_all wuerde sie nicht anlegen, das Modul speichert live nichts."
        )


@pytest.mark.asyncio
async def test_orga_haekchen_persistiert(session):
    user, cls, stud = await _seed(session)
    it = await orga.create_item(cls.id, orga.ItemIn(name="Unterschrift KA1"), user=user, db=session)
    await orga.toggle(it.id, orga.ToggleIn(student_id=stud.id), user=user, db=session)
    # Alles aus der Session werfen — erzwingt frisches Laden aus der DB.
    session.expunge_all()
    rows = await orga.list_items(cls.id, user=user, db=session)
    assert len(rows) == 1
    assert rows[0].done == [stud.id], f"Haekchen nicht persistiert: {rows[0].done}"


@pytest.mark.asyncio
async def test_ausleihe_persistiert(session):
    user, cls, stud = await _seed(session)
    it = await ausleihe.create_item(ausleihe.ItemIn(name="Zirkel"), user=user, db=session)
    await ausleihe.create_loan(
        ausleihe.LoanIn(item_id=it["id"], student_id=stud.id, borrower=""), user=user, db=session
    )
    session.expunge_all()
    items = await ausleihe.list_items(user=user, db=session)
    assert len(items) == 1
    assert items[0]["open"] == 1, f"Offene Ausleihe nicht persistiert: {items[0]}"
