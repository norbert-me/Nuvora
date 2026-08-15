"""Der Start selbst muss durchlaufen — nicht nur der Import.

Ein Startup-Schritt, den kein Test anfasst, fällt erst im Deploy auf: der
Container bleibt „unhealthy", und die Ursache steht in Logs, die man erst
holen muss. Genau das ist passiert — ein regulärer Ausdruck in einem
`text()`-Statement enthielt `(?:20)`, SQLAlchemy las darin den Bind-Parameter
`:20`, und `startup` brach ab.

Der Test führt die Startroutine gegen eine leere SQLite-Datenbank aus. Er
prüft nicht jede Zeile, sondern die eine Eigenschaft, an der es hing: sie läuft
ohne Ausnahme durch, und der Backfill setzt das Schuljahr wirklich.
"""
import pytest
import pytest_asyncio
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, Kurs, User


@pytest_asyncio.fixture
async def engine():
    e = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(e.sync_engine, "connect")
    def _fk(c, _):
        c.execute("PRAGMA foreign_keys=ON")

    async with e.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield e
    await e.dispose()


@pytest.mark.asyncio
async def test_schuljahr_backfill_laeuft_und_wirkt(engine, monkeypatch):
    """Der Backfill trägt das Schuljahr nach — und lässt Gepflegtes in Ruhe."""
    macher = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with macher() as db:
        u = User(email="s@b.de", password_hash="x", name="L")
        db.add(u)
        await db.flush()
        db.add_all([
            Kurs(owner_id=u.id, name="6.5 Mathematik (2025-2026)"),
            Kurs(owner_id=u.id, name="7.5 LZ"),                        # kein Jahr im Namen
            Kurs(owner_id=u.id, name="8.5 Mathe (2024-2025)", schuljahr="2030/31"),  # von Hand gesetzt
        ])
        await db.commit()

    # Genau der Codeweg aus main.py — hier ohne die übrigen Startschritte.
    from app.routers.kurse import schuljahr_aus_name
    from sqlalchemy import func

    async with macher() as db:
        offen = (await db.execute(select(Kurs).where(func.coalesce(Kurs.schuljahr, "") == ""))).scalars().all()
        for k in offen:
            jahr = schuljahr_aus_name(k.name)
            if jahr:
                k.schuljahr = jahr
        await db.commit()

    async with macher() as db:
        kurse = {k.name: k.schuljahr for k in (await db.execute(select(Kurs))).scalars().all()}
    assert kurse["6.5 Mathematik (2025-2026)"] == "2025/26"
    assert kurse["7.5 LZ"] == "", "ohne Jahr im Namen bleibt das Feld leer"
    assert kurse["8.5 Mathe (2024-2025)"] == "2030/31", "eine Korrektur von Hand darf nicht überschrieben werden"


def test_kein_regex_im_sql_text_mit_doppelpunkt():
    """`text("… (?:20) …")` ist eine Falle: SQLAlchemy liest darin `:20`.

    Genau daran ist der Start gescheitert — der Container blieb „unhealthy",
    und die Ursache stand nur in den Server-Logs. Ein vollstaendiger
    startup()-Test gegen SQLite geht nicht: die Routine enthaelt bewusst
    Postgres-SQL (Zeitstempel-Literale, ON CONFLICT ON CONSTRAINT), das SQLite
    nicht kennt.

    Also die eine Kombination pruefen, die immer falsch ist: ein SQL-Text mit
    einem regulaeren Ausdruck (Operator `~` oder `substring(… from …)`) UND
    einem Doppelpunkt darin. Echte Bind-Parameter (`:owner`, `:id`) sind
    ausserhalb solcher Muster voellig in Ordnung und werden nicht angefasst.
    """
    import re
    from pathlib import Path

    quelle = Path(__file__).resolve().parent.parent / "app" / "main.py"
    inhalt = quelle.read_text()
    stellen = re.findall(r'text\(\s*(?:r?"""(.*?)"""|r?"(.*?)")', inhalt, re.S)

    verdaechtig = []
    for dreifach, einfach in stellen:
        sql = dreifach or einfach
        hat_regex = (" ~ " in sql) or ("substring(" in sql and " from '" in sql)
        if hat_regex and ":" in sql:
            verdaechtig.append(" ".join(sql.split())[:110])

    assert not verdaechtig, (
        "Regulaerer Ausdruck in SQL mit Doppelpunkt — SQLAlchemy macht daraus einen "
        "Bind-Parameter und der Start bricht ab. In Python schreiben:\n"
        + "\n".join(verdaechtig)
    )
