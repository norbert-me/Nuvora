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


class _Anfrage:
    """Minimal-Attrappe fuer `Request`: die Endpunkte lesen nur `if-none-match`."""

    def __init__(self, etag=None):
        self.headers = {"if-none-match": etag} if etag else {}


def _upload(name, content):
    return UploadFile(filename=name, file=io.BytesIO(content))


async def _setup(s):
    u = User(email="a@b.de", password_hash="x", name="A"); s.add(u); await s.flush()
    tp = Topic(name="Brüche", owner_id=u.id); s.add(tp); await s.commit()
    return u, tp


@pytest.mark.asyncio
async def test_upload_und_liste(s):
    u, tp = await _setup(s)
    out = await M.upload_material(file=_upload("blatt.pdf", b"%PDF-1.4 data"), topic_id=tp.id, entry_id=None, method_id=None, work_id=None, rolle="", user=u, db=s)
    assert out.filename == "blatt.pdf" and out.size == len(b"%PDF-1.4 data")
    lst = await M.list_material(topic_id=tp.id, user=u, db=s)
    assert len(lst) == 1 and lst[0].topic_id == tp.id


@pytest.mark.asyncio
async def test_ohne_thema_und_stunde_verboten(s):
    u, tp = await _setup(s)
    with pytest.raises(HTTPException) as ei:
        await M.upload_material(file=_upload("x.txt", b"x"), topic_id=None, entry_id=None, method_id=None, work_id=None, rolle="", user=u, db=s)
    assert ei.value.status_code == 400


@pytest.mark.asyncio
async def test_fremdes_material_unsichtbar(s):
    u, tp = await _setup(s)
    await M.upload_material(file=_upload("geheim.pdf", b"data"), topic_id=tp.id, entry_id=None, method_id=None, work_id=None, rolle="", user=u, db=s)
    mid = (await s.execute(select(Material.id))).scalar_one()

    v = User(email="v@b.de", password_hash="x", name="V"); s.add(v); await s.commit()
    # Liste des Fremden ist leer (topic_id gehoert ihm nicht, aber Filter ist owner-first)
    assert await M.list_material(topic_id=tp.id, user=v, db=s) == []
    # Download/Delete durch Fremden -> 404
    with pytest.raises(HTTPException) as ei:
        await M.download_material(mid, _Anfrage(), user=v, db=s)
    assert ei.value.status_code == 404
    with pytest.raises(HTTPException):
        await M.delete_material(mid, user=v, db=s)
    # Eigentuemer kann herunterladen
    resp = await M.download_material(mid, _Anfrage(), user=u, db=s)
    assert resp.body == b"data"


@pytest.mark.asyncio
async def test_material_am_einstieg(s):
    """Datei an einen Einstieg (Methode) haengen, per method_id auflisten; das
    Loeschen des Einstiegs nullt nur die Zuordnung (Material bleibt)."""
    from sqlalchemy import delete as sql_delete
    from app.models import Method
    u, _ = await _setup(s)
    m = Method(owner_id=u.id, title="Blitzlicht"); s.add(m); await s.commit()
    out = await M.upload_material(file=_upload("ab.pdf", b"data"), topic_id=None, entry_id=None, method_id=m.id, work_id=None, rolle="", user=u, db=s)
    assert out.method_id == m.id
    liste = await M.list_material(method_id=m.id, work_id=None, rolle="", user=u, db=s)
    assert [x.filename for x in liste] == ["ab.pdf"]
    # Einstieg loeschen -> Material bleibt, method_id genullt (ON DELETE SET NULL).
    await s.execute(sql_delete(Method).where(Method.id == m.id)); await s.commit()
    mid = (await s.execute(select(Material.method_id).where(Material.id == out.id))).scalar_one()
    assert mid is None


@pytest.mark.asyncio
async def test_zweiter_abruf_spart_die_bytes(s):
    """Dieselbe Datei zweimal oeffnen darf nur einmal Daten kosten.

    In einem Schulnetz sind 5 MB je Klick spuerbar. Der Server schickt eine
    Kennung (ETag) mit; bringt der Browser sie zurueck, gibt es 304 und keinen
    Inhalt.
    """
    u, tp = await _setup(s)
    await M.upload_material(file=_upload("blatt.pdf", b"%PDF-1.4 " + b"x" * 500),
                            topic_id=tp.id, entry_id=None, method_id=None, work_id=None, rolle="", user=u, db=s)
    mid = (await s.execute(select(Material.id))).scalar_one()

    erst = await M.download_material(mid, _Anfrage(), user=u, db=s)
    etag = erst.headers.get("etag")
    assert etag, "ohne Kennung kann der Browser nichts wiedererkennen"
    assert erst.headers.get("cache-control", "").startswith("private"), "fremde Zwischenspeicher duerfen die Datei nicht halten"

    zweit = await M.download_material(mid, _Anfrage(etag), user=u, db=s)
    assert zweit.status_code == 304
    assert not zweit.body, "bei 304 darf kein Inhalt mitgehen"

    # Andere Kennung (Datei geaendert) -> wieder der volle Inhalt.
    dritt = await M.download_material(mid, _Anfrage('"d999-1"'), user=u, db=s)
    assert dritt.status_code == 200 and dritt.body


@pytest.mark.asyncio
async def test_kleines_pdf_bekommt_auch_eine_kennung(s):
    """Auch ohne gebaute Ansichtsfassung muss der zweite Abruf 304 liefern.

    Ein PDF unter der Verkleinerungsgrenze wird unverändert durchgereicht,
    `pdf_data` bleibt leer — die erste Fassung dieser Prüfung hing die Kennung
    aber genau daran und gab für kleine Dateien nie ein 304. Aufgefallen ist es
    dem Selbsttest gegen die laufende Installation, nicht hier.
    """
    u, tp = await _setup(s)
    # content_type mitgeben: die Ansicht entscheidet daran, ob sie das PDF
    # durchreicht oder eine Office-Datei wandeln muss.
    await M.upload_material(file=UploadFile(filename="klein.pdf", file=io.BytesIO(b"%PDF-1.4 klein"),
                                            headers={"content-type": "application/pdf"}),
                            topic_id=tp.id, entry_id=None, method_id=None, work_id=None, rolle="", user=u, db=s)
    mid = (await s.execute(select(Material.id))).scalar_one()

    erst = await M.material_als_pdf(mid, _Anfrage(), user=u, db=s)
    assert erst.status_code == 200
    etag = erst.headers.get("etag")
    assert etag, "Ansicht ohne Kennung — jedes Öffnen lädt neu"

    zweit = await M.material_als_pdf(mid, _Anfrage(etag), user=u, db=s)
    assert zweit.status_code == 304 and not zweit.body
