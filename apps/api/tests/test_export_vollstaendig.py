"""Die Auskunft nach Art. 15 DSGVO muss vollständig sein.

`GET /api/me/export` verspricht im eigenen Datenschutztext eine vollständige
Kopie. Eine neue Tabelle wird dort aber leicht vergessen — genau so fehlten
zeitweise die Beobachtungen, die Elternkontakte, der Notizblock und der
Kartenfortschritt, also ausgerechnet das Persönlichste.

Dieser Test vergleicht die Tabellen der Modelle mit denen, die der Export
anfasst. Neue Tabelle ohne Eintrag im Export = roter Test. Was bewusst nicht
hineingehört, steht in NICHT_IM_EXPORT — mit Begründung.
"""
import json
import pathlib
import re

import pytest
import pytest_asyncio
from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, User, SchoolClass, Student
from app.routers import me as ME

ME_QUELLE = pathlib.Path(__file__).resolve().parents[1] / "app" / "routers" / "me.py"


@pytest_asyncio.fixture
async def s():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk_on(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)() as sess:
        yield sess
    await engine.dispose()

# Tabellen, die bewusst nicht in der Auskunft stehen.
NICHT_IM_EXPORT = {
    # Technisch, ohne Personenbezug zur auskunftsuchenden Person.
    "app_settings": "globale Einstellung der Installation, kein Personenbezug",
    "users": "das Profil steht als eigener Abschnitt drin (nicht als Tabelle)",
}


def _exportierte_modelle() -> set:
    """Modellnamen, die me.py im Export verwendet (m.Xxx)."""
    return set(re.findall(r"\bm\.([A-Z]\w+)", ME_QUELLE.read_text()))


def _tabelle_zu_modell() -> dict:
    """Tabellenname -> Modellname für jedes gemappte Modell."""
    return {
        mapper.local_table.name: mapper.class_.__name__
        for mapper in Base.registry.mappers if mapper.local_table is not None
    }


def test_jede_tabelle_ist_in_der_auskunft():
    exportiert = _exportierte_modelle()
    fehlend = {tabelle: modell for tabelle, modell in _tabelle_zu_modell().items()
               if tabelle not in NICHT_IM_EXPORT and modell not in exportiert}
    assert not fehlend, (
        "Diese Tabellen fehlen in GET /api/me/export (DSGVO Art. 15 verlangt "
        "Vollständigkeit) — entweder dort ergänzen oder mit Begründung in "
        "NICHT_IM_EXPORT eintragen: "
        + ", ".join(f"{t} ({mod})" for t, mod in sorted(fehlend.items()))
    )


@pytest.mark.asyncio
async def test_export_laeuft_mit_deferred_spalten(s):
    """Der Export darf nicht an absichtlich nicht geladenen Spalten scheitern.

    Schülerfotos und Kartenbilder sind im Modell `deferred` — sie werden nicht
    mitgeladen. Sie beim Serialisieren anzufassen löste eine Nachladung mitten
    in der Antwort aus, die im asynchronen Kontext scheitert (MissingGreenlet):
    HTTP 500 statt Auskunft, ausgerechnet bei der DSGVO-Anfrage.
    """
    u = User(email="a@b.de", password_hash="x", name="A")
    s.add(u)
    await s.flush()
    cls = SchoolClass(name="7a", owner_id=u.id)
    s.add(cls)
    await s.flush()
    s.add(Student(card_id=1, name="Anna", class_id=cls.id, photo=b"\x89PNG-Testbild", photo_mime="image/png"))
    await s.commit()

    antwort = await ME.export_me(user=u, db=s)
    daten = json.loads(antwort.body)
    assert daten["schueler"], "Schüler fehlen in der Auskunft"
    # Das Foto steht als Hinweis drin, nicht als Bytes — und ohne Nachladung.
    assert "photo" in daten["schueler"][0]
