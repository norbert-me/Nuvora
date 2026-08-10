"""Der Selbsttest ist die einzige Stelle, die die ECHTE Datenbank sieht.

Es gibt kein Alembic: das Schema entsteht aus `create_all` plus `_ensure_columns`.
Namen von Tabellen und Spalten zu vergleichen reicht deshalb nicht — eine per
`ALTER TABLE` nachgezogene Spalte heisst richtig und trug jahrelang trotzdem
keinen Fremdschlüssel. An genau diesen ON-DELETE-Regeln hängen Kontolöschung
(Art. 17) und Themenlöschung (Regel 3).
"""
import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base
from app.routers.selftest import _check_schema


@pytest_asyncio.fixture
async def db():
    e = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with e.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(e, class_=AsyncSession, expire_on_commit=False)() as s:
        yield s
    await e.dispose()


def _fk_check(out):
    return next(c for c in out if c.gruppe == "Schema" and c.name == "Fremdschluessel")


@pytest.mark.asyncio
async def test_vollstaendiges_schema_meldet_keine_luecke(db):
    out = []
    await _check_schema(db, out)
    pruefung = _fk_check(out)
    assert pruefung.ok, pruefung.detail


@pytest.mark.asyncio
async def test_nackt_nachgezogene_spalte_wird_gemeldet(db):
    """Die Produktionslage: `questions.topic_id` steht da, aber ohne ON DELETE
    SET NULL. Vorher war das für den Selbsttest nicht von einer heilen Datenbank
    zu unterscheiden."""
    await db.execute(text("DROP TABLE questions"))
    await db.execute(text("CREATE TABLE questions (id INTEGER PRIMARY KEY, owner_id INTEGER, topic_id INTEGER)"))
    out = []
    await _check_schema(db, out)
    pruefung = _fk_check(out)
    assert not pruefung.ok
    assert "questions.topic_id" in pruefung.detail and "questions.owner_id" in pruefung.detail


@pytest.mark.asyncio
async def test_fehlender_fremdschluessel_ist_nur_eine_warnung(db):
    """Nachrüsten geht nur auf Postgres und erst beim nächsten Start — ein
    Fehler färbte den Selbsttest bis dahin rot, ohne dass jemand etwas falsch
    gemacht hat."""
    out = []
    await _check_schema(db, out)
    assert _fk_check(out).schwere == "warnung"
