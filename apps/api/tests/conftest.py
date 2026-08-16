"""Gemeinsame Vorbereitung fuer alle Tests.

Der Upload-Ordner liegt im Container unter /app/uploads. Beim Testen gibt es
den nicht — ohne diese Umleitung scheitert schon der Import.

Dazu die **eine Testdatenbank**: eine leere SQLite im Arbeitsspeicher, das
Schema aus den Modellen, eine Sitzung. Dieselben elf Zeilen standen in vierzig
Testdateien — wortgleich bis auf die Namen der lokalen Variablen. Wer den
Aufbau aendern musste (das `PRAGMA foreign_keys=ON` kam genau so nachtraeglich
dazu), musste vierzig Stellen anfassen und traf nicht alle: zwei Dateien haben
es bis heute nicht.

Dieselbe Sitzung unter drei Namen, weil die Tests sie unter drei Namen
angefordert haben — `s`, `session`, `db`. Das ist kein Unterschied in der
Sache, sondern gewachsene Schreibweise; die Alias-Fixtures sparen eine
Umbenennung quer durch elf Dateien, die nichts pruefen wuerde.

**Nicht** hier stehen die Datenbanken, die etwas anderes sind: die Datei-DB fuer
gleichzeitige Schreiber (`test_gleichzeitig.py`), die ohne Fremdschluessel
(`test_kern_datenmodell.s_ohne_fk` — sie bildet die gewachsene Produktions-DB
nach) und die des Sicherungstests, die als Datei auf der Platte liegen muss.
"""
import os
import tempfile

import pytest_asyncio
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

os.environ.setdefault("NUVORA_UPLOAD_DIR", tempfile.mkdtemp(prefix="nuvora-test-uploads-"))

from app.models import Base  # noqa: E402 — erst nach der Umleitung importierbar


@pytest_asyncio.fixture
async def s():
    """Leere Datenbank im Arbeitsspeicher, Schema aus den Modellen, eine Sitzung."""
    e = create_async_engine("sqlite+aiosqlite:///:memory:")

    # SQLite erzwingt Fremdschluessel nur mit diesem PRAGMA — ohne ihn greift
    # keine Kaskade und kein ON DELETE SET NULL, und ein Test uebersaehe genau
    # die Regression, fuer die er geschrieben wurde.
    @event.listens_for(e.sync_engine, "connect")
    def _fk(c, _):
        c.execute("PRAGMA foreign_keys=ON")

    async with e.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(e, class_=AsyncSession, expire_on_commit=False)() as ss:
        yield ss
    await e.dispose()


@pytest_asyncio.fixture
async def session(s):
    """Dieselbe Sitzung wie `s`, unter dem Namen, den diese Dateien benutzen."""
    return s


@pytest_asyncio.fixture
async def db(s):
    """Dieselbe Sitzung wie `s`, unter dem Namen, den diese Dateien benutzen."""
    return s
