"""Material-/Dateiablage: an Thema/Stunde gehaengt, streng owner-scoped.

Fremdes Material ist nie sichtbar, ladbar oder loeschbar. Ohne Thema UND ohne
Stunde wird nichts gespeichert.
"""
import io

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import select

from app.models import User, Topic, Material
from app.routers import material as M


class _Anfrage:
    """Minimal-Attrappe fuer `Request`: die Endpunkte lesen nur `if-none-match`."""

    def __init__(self, etag=None):
        self.headers = {"if-none-match": etag} if etag else {}


def _upload(name, content, mime=None):
    from starlette.datastructures import Headers
    if mime is None:
        mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
                "pdf": "application/pdf"}.get(name.rsplit(".", 1)[-1].lower(), "application/octet-stream")
    return UploadFile(filename=name, file=io.BytesIO(content),
                      headers=Headers({"content-type": mime}))


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


def test_vorschau_nur_fuer_rasterbilder():
    """SVG bleibt draußen: es kann Skript tragen, und der Vorschau-Weg liefert
    inline aus. Alles andere hat kein Bild, das sich zeigen ließe."""
    from app.routers.material import vorschau_material  # noqa: F401  (Form, nicht Aufruf)

    erlaubt = {"image/png", "image/jpeg", "image/gif", "image/webp"}
    assert "image/svg+xml" not in erlaubt
    assert "application/pdf" not in erlaubt


@pytest.mark.asyncio
async def test_gleicher_inhalt_wird_nicht_doppelt_gespeichert(s):
    """Zweiter Upload desselben Bildes legt die Bytes nicht erneut ab, sondern
    zeigt auf die erste Zeile — und zaehlt nicht gegen das Speicherkonto."""
    u, tp = await _setup(s)
    bild = b"\x89PNG\r\n\x1a\n" + b"derselbe inhalt" * 100

    a = await M.upload_material(file=_upload("foto.png", bild), topic_id=tp.id, entry_id=None,
                                method_id=None, work_id=None, rolle="", user=u, db=s)
    b = await M.upload_material(file=_upload("nochmal.png", bild), topic_id=tp.id, entry_id=None,
                                method_id=None, work_id=None, rolle="", user=u, db=s)

    ra = (await s.execute(select(Material).where(Material.id == a.id))).scalar_one()
    rb = (await s.execute(select(Material).where(Material.id == b.id))).scalar_one()
    assert ra.quelle_id is None and ra.data == bild, "die erste Zeile traegt die Bytes"
    assert rb.quelle_id == a.id and rb.data is None, "die zweite zeigt nur darauf"
    assert rb.size == len(bild), "die Groesse wird ehrlich angezeigt"

    # Speicherzaehler zaehlt die Bytes nur einmal.
    from sqlalchemy import func
    belegt = (await s.execute(select(func.coalesce(func.sum(Material.size), 0)).where(
        Material.owner_id == u.id, Material.quelle_id.is_(None)))).scalar_one()
    assert belegt == len(bild)

    # Beide Verweise liefern denselben Inhalt aus.
    for mid in (a.id, b.id):
        resp = await M.download_material(mid, _Anfrage(), user=u, db=s)
        assert resp.body == bild


@pytest.mark.asyncio
async def test_loeschen_der_quelle_befoerdert_einen_verweis(s):
    """Wer die Bytes-tragende Zeile loescht, darf den Verweisen die Datei nicht
    wegnehmen: eine abhaengige Zeile wird zur neuen Quelle befoerdert."""
    u, tp = await _setup(s)
    bild = b"\x89PNG\r\n\x1a\n" + b"x" * 500
    a = await M.upload_material(file=_upload("a.png", bild), topic_id=tp.id, entry_id=None,
                                method_id=None, work_id=None, rolle="", user=u, db=s)
    b = await M.upload_material(file=_upload("b.png", bild), topic_id=tp.id, entry_id=None,
                                method_id=None, work_id=None, rolle="", user=u, db=s)
    c = await M.upload_material(file=_upload("c.png", bild), topic_id=tp.id, entry_id=None,
                                method_id=None, work_id=None, rolle="", user=u, db=s)

    # Die Quelle (a) loeschen.
    await M.delete_material(a.id, user=u, db=s)

    # Ueber Spalten lesen statt ORM-Objekte (kein Lazy-Load im Test).
    rb = (await s.execute(select(Material.quelle_id, Material.data).where(Material.id == b.id))).first()
    rc = (await s.execute(select(Material.quelle_id, Material.data).where(Material.id == c.id))).first()
    # b ist befoerdert (traegt jetzt die Bytes), c zeigt auf b.
    assert rb[0] is None and rb[1] == bild
    assert rc[0] == b.id and rc[1] is None
    # Beide sind weiterhin auslieferbar.
    for mid in (b.id, c.id):
        resp = await M.download_material(mid, _Anfrage(), user=u, db=s)
        assert resp.body == bild


@pytest.mark.asyncio
async def test_grosses_foto_wird_verlustarm_verkleinert(s):
    """Ein gering komprimiertes JPEG wird beim Upload kleiner gespeichert, ohne
    die Aufloesung anzutasten; die Bytes stimmen mit dem gespeicherten sha256."""
    from io import BytesIO
    from PIL import Image
    import hashlib
    from sqlalchemy import select
    from app.models import Material

    u, tp = await _setup(s)
    # Ein „Foto" mit Struktur (nicht komprimierbares Rauschen wuerde nicht
    # schrumpfen) bei absichtlich hoher Ausgangsqualitaet.
    import random; random.seed(1)
    bild = Image.new("RGB", (1200, 900))
    px = bild.load()
    for y in range(900):
        for x in range(0, 1200, 3):
            v = (x + y) % 256
            for dx in range(3):
                if x + dx < 1200:
                    px[x + dx, y] = (v, (v * 2) % 256, (v * 3) % 256)
    roh = BytesIO(); bild.save(roh, format="JPEG", quality=100); roh = roh.getvalue()

    out = await M.upload_material(file=_upload("foto.jpg", roh), topic_id=tp.id, entry_id=None,
                                  method_id=None, work_id=None, rolle="", user=u, db=s)
    assert out.size < len(roh), "verkleinert gespeichert"
    r = (await s.execute(select(Material.data, Material.sha256).where(Material.id == out.id))).first()
    assert hashlib.sha256(r[0]).hexdigest() == r[1], "Hash trifft die gespeicherte Form"
    # Aufloesung unangetastet.
    with Image.open(BytesIO(r[0])) as gespeichert:
        assert gespeichert.size == (1200, 900)


@pytest.mark.asyncio
async def test_png_bleibt_unangetastet(s):
    """PNG (Transparenz) wird nicht zu JPEG umkodiert."""
    from io import BytesIO
    from PIL import Image
    from sqlalchemy import select
    from app.models import Material

    u, tp = await _setup(s)
    bild = Image.new("RGBA", (50, 50), (255, 0, 0, 128))
    roh = BytesIO(); bild.save(roh, format="PNG"); roh = roh.getvalue()
    out = await M.upload_material(file=_upload("t.png", roh), topic_id=tp.id, entry_id=None,
                                  method_id=None, work_id=None, rolle="", user=u, db=s)
    r = (await s.execute(select(Material.mime, Material.data).where(Material.id == out.id))).first()
    assert r[0] == "image/png" and r[1] == roh
