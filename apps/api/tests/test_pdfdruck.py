"""Die gemeinsamen PDF-Handgriffe drucken wirklich.

`neue_seite` und `als_anhang` (app/pdfdruck.py) haben die vier Zeilen
„A4-Leinwand" und den Rueckgabe-Dreizeiler eingesammelt, die an acht bzw. sechs
Stellen wortgleich standen. Ein Fehler darin faellt sonst erst auf, wenn jemand
drucken will — deshalb baut dieser Test ein echtes PDF und schaut es an.
"""
import io

import pytest

from app.models import User, SchoolClass, Student
from app.pdfdruck import als_anhang, neue_seite
from app.routers import anwesenheit as A


def test_neue_seite_liefert_leinwand_und_masse():
    buf = io.BytesIO()
    c, w, h = neue_seite(buf)
    assert h > w > 0, "A4 hochkant"
    c.drawString(10, 10, "Test")
    c.showPage()
    c.save()
    assert buf.getvalue().startswith(b"%PDF")


@pytest.mark.asyncio
async def test_als_anhang_setzt_kopfzeile_und_spult_zurueck():
    buf = io.BytesIO(b"%PDF-1.4 abc")
    buf.seek(12)   # absichtlich am Ende — der Helfer muss zurueckspulen
    r = als_anhang(buf, "Zeugnis.pdf")
    assert r.media_type == "application/pdf"
    assert r.headers["content-disposition"] == 'attachment; filename="Zeugnis.pdf"'
    assert buf.tell() == 0
    # Auch rohe Bytes muessen gehen (das Zeugnis liefert welche).
    assert als_anhang(b"%PDF-1.4", "x.pdf").media_type == "application/pdf"


@pytest.mark.asyncio
async def test_fehlzeiten_pdf_entsteht_wirklich(s):
    u = User(email="a@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    k = SchoolClass(name="7a", owner_id=u.id)
    s.add(k)
    await s.flush()
    s.add(Student(class_id=k.id, card_id=1, name="Anna", position=1))
    await s.commit()

    r = await A.class_report(k.id, user=u, db=s)
    assert r.media_type == "application/pdf"
    inhalt = b"".join([teil async for teil in r.body_iterator])
    assert inhalt.startswith(b"%PDF") and len(inhalt) > 500
