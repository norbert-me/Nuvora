"""Die Schranke muss das Modul beim Namen nennen, den die Lehrkraft sieht.

Solange jeder Modul-Router seine eigene `require_module`-Kopie hatte, lief der
Text in der 403-Meldung vom Register weg: nach dem Zusammenlegen von Modulen
sagte die Schranke „Modul Anwesenheit ist nicht aktiviert", waehrend in der
Modeluebersicht nur „Orga" steht. Die Lehrkraft bekommt so den Namen eines
Moduls genannt, das es fuer sie gar nicht gibt — sie kann den Fehler nicht
beheben.

Der Test liest die Schranken aus den gemounteten Routen (nicht aus dem
Quelltext) und ordnet sie einem Modul zu, indem er genau dieses eine Modul
aktiviert und schaut, welche Schranke dann durchlaesst. Damit haengt er an
keiner Bauform: ob eine Schranke aus `modul_pflicht` kommt oder handgeschrieben
ist, spielt keine Rolle.
"""
import pytest
from fastapi import HTTPException
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.main import app
from app.models import Base, User, UserModule
from app.routers.modules import REGISTRY

from test_modul_schranke import _routen


def _schranken_callables():
    """Alle Modulschranken, die irgendwo in der App haengen — je einmal."""
    raus = {}

    def sammeln(dep):
        for d in dep.dependencies:
            if d.call is not None:
                name = getattr(d.call, "__qualname__", "")
                if "require_module" in name or "modul_pflicht" in name:
                    raus[id(d.call)] = d.call
            sammeln(d)

    for r in _routen():
        sammeln(r.dependant)
    return list(raus.values())


@pytest.mark.asyncio
async def test_schranken_nennen_den_registernamen():
    e = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with e.begin() as c:
        await c.run_sync(Base.metadata.create_all)

    schranken = _schranken_callables()
    assert schranken, "keine einzige Modulschranke gefunden — der Test misst nichts"

    falsch = []
    ohne_schranke = []
    async with async_sessionmaker(e, class_=AsyncSession, expire_on_commit=False)() as db:
        u = User(email="name@test.de", password_hash="x", name="L")
        db.add(u)
        await db.commit()

        for mod in REGISTRY:
            # Genau dieses Modul aktivieren — dann laesst nur seine Schranke durch.
            await db.execute(delete(UserModule).where(UserModule.user_id == u.id))
            db.add(UserModule(user_id=u.id, module_key=mod.key))
            await db.commit()

            meine = []
            for s in schranken:
                try:
                    await s(user=u, db=db)
                except HTTPException:
                    continue
                meine.append(s)

            if not meine:
                # Module ohne Backend (reine Frontend-Werkzeuge) haben keine.
                ohne_schranke.append(mod.key)
                continue

            await db.execute(delete(UserModule).where(UserModule.user_id == u.id))
            await db.commit()
            for s in meine:
                with pytest.raises(HTTPException) as ex:
                    await s(user=u, db=db)
                assert ex.value.status_code == 403
                if mod.name not in str(ex.value.detail):
                    falsch.append(
                        f"{mod.key}: erwartet '{mod.name}', gesagt '{ex.value.detail}'"
                    )

    await e.dispose()
    assert not falsch, (
        "Schranken nennen einen Modulnamen, den es in der Modeluebersicht nicht "
        f"gibt: {falsch}"
    )
    # Rein informativ: welche Register-Module gar kein Backend haben.
    assert set(ohne_schranke) <= {"tafel", "mathespiele"}, (
        f"Modul im Register ohne jede Backend-Schranke: {ohne_schranke}"
    )
