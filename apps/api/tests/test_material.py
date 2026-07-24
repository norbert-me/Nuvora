"""Material-/Dateiablage: an Thema/Stunde gehaengt, streng owner-scoped.

Fremdes Material ist nie sichtbar, ladbar oder loeschbar. Ohne Thema UND ohne
Stunde wird nichts gespeichert.
"""
import io

import pytest
import pytest_asyncio
from fastapi import HTTPException, UploadFile
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, User, Topic, Material
from app.routers import material as M


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


def _upload(name, content):
    return UploadFile(filename=name, file=io.BytesIO(content))


async def _setup(s):
    u = User(email="a@b.de", password_hash="x", name="A"); s.add(u); await s.flush()
    tp = Topic(name="Brüche", owner_id=u.id); s.add(tp); await s.commit()
    return u, tp


@pytest.mark.asyncio
async def test_upload_und_liste(s):
    u, tp = await _setup(s)
    out = await M.upload_material(file=_upload("blatt.pdf", b"%PDF-1.4 data"), topic_id=tp.id, entry_id=None, method_id=None, user=u, db=s)
    assert out.filename == "blatt.pdf" and out.size == len(b"%PDF-1.4 data")
    lst = await M.list_material(topic_id=tp.id, user=u, db=s)
    assert len(lst) == 1 and lst[0].topic_id == tp.id


@pytest.mark.asyncio
async def test_ohne_thema_und_stunde_verboten(s):
    u, tp = await _setup(s)
    with pytest.raises(HTTPException) as ei:
        await M.upload_material(file=_upload("x.txt", b"x"), topic_id=None, entry_id=None, method_id=None, user=u, db=s)
    assert ei.value.status_code == 400


@pytest.mark.asyncio
async def test_fremdes_material_unsichtbar(s):
    u, tp = await _setup(s)
    await M.upload_material(file=_upload("geheim.pdf", b"data"), topic_id=tp.id, entry_id=None, method_id=None, user=u, db=s)
    mid = (await s.execute(select(Material.id))).scalar_one()

    v = User(email="v@b.de", password_hash="x", name="V"); s.add(v); await s.commit()
    # Liste des Fremden ist leer (topic_id gehoert ihm nicht, aber Filter ist owner-first)
    assert await M.list_material(topic_id=tp.id, user=v, db=s) == []
    # Download/Delete durch Fremden -> 404
    with pytest.raises(HTTPException) as ei:
        await M.download_material(mid, user=v, db=s)
    assert ei.value.status_code == 404
    with pytest.raises(HTTPException):
        await M.delete_material(mid, user=v, db=s)
    # Eigentuemer kann herunterladen
    resp = await M.download_material(mid, user=u, db=s)
    assert resp.body == b"data"


@pytest.mark.asyncio
async def test_material_am_einstieg(s):
    """Datei an einen Einstieg (Methode) haengen, per method_id auflisten; das
    Loeschen des Einstiegs nullt nur die Zuordnung (Material bleibt)."""
    from sqlalchemy import delete as sql_delete
    from app.models import Method
    u, _ = await _setup(s)
    m = Method(owner_id=u.id, title="Blitzlicht"); s.add(m); await s.commit()
    out = await M.upload_material(file=_upload("ab.pdf", b"data"), topic_id=None, entry_id=None, method_id=m.id, user=u, db=s)
    assert out.method_id == m.id
    liste = await M.list_material(method_id=m.id, user=u, db=s)
    assert [x.filename for x in liste] == ["ab.pdf"]
    # Einstieg loeschen -> Material bleibt, method_id genullt (ON DELETE SET NULL).
    await s.execute(sql_delete(Method).where(Method.id == m.id)); await s.commit()
    mid = (await s.execute(select(Material.method_id).where(Material.id == out.id))).scalar_one()
    assert mid is None
