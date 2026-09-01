"""Beobachtungen haengen an KEINER Spalte.

Eine Beobachtung ("hat heute geholfen") zaehlt nie in einen Schnitt — sie
braucht deshalb keine Zelle, in der sie sitzt. Vorher war genau das eine
Sackgasse: ohne Abschnitt und Spalte lehnte das Notenbuch sie ab, obwohl sie
am ersten Schultag anfaellt, lange bevor irgendeine Bewertungsstruktur steht.

Die Regeln, die dieser Test festhaelt:
  1. Beobachtung ohne Spalte geht — mit Klasse (und je nach Kurs kurs_id/term).
  2. Eine NOTE ohne Spalte geht nicht (sie IST der Inhalt einer Zelle).
  3. Eine Beobachtung mit Notenwert oder ohne Text wird abgewiesen.
  4. Lesen und Zaehlen finden sie: list_entries und summary.
  5. Loeschen geht ueber die Klasse, nicht ueber die Spalte.

Lauf:  cd apps/api && pip install -r requirements-dev.txt && pytest
"""
import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models import User, SchoolClass, Student, GradeEntry, UserModule
from app.routers import noten as N


async def _grund(s):
    u = User(email="a@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    s.add(UserModule(user_id=u.id, module_key="auswertung"))
    cls = SchoolClass(name="7a", owner_id=u.id); s.add(cls); await s.flush()
    max_ = Student(card_id=1, name="Max", class_id=cls.id); s.add(max_)
    await s.commit()
    return u, cls, max_


def _beob(cls, st, **kw):
    body = {"student_id": st.id, "class_id": cls.id, "kind": "observation",
            "tendency": 1, "note": "hat geholfen", "term": "1"}
    body.update(kw)
    return N.EntryIn(**body)


@pytest.mark.asyncio
async def test_beobachtung_braucht_keine_spalte(s):
    u, cls, max_ = await _grund(s)
    out = await N.create_entry(_beob(cls, max_), user=u, db=s)
    assert out.category_id is None
    assert out.class_id == cls.id and out.term == "1"


@pytest.mark.asyncio
async def test_note_ohne_spalte_wird_abgewiesen(s):
    u, cls, max_ = await _grund(s)
    with pytest.raises(HTTPException) as e:
        await N.create_entry(N.EntryIn(student_id=max_.id, class_id=cls.id, kind="grade", value=2.0), user=u, db=s)
    assert e.value.status_code == 400


@pytest.mark.asyncio
async def test_beobachtung_ohne_klasse_und_ohne_text(s):
    u, cls, max_ = await _grund(s)
    with pytest.raises(HTTPException):
        await N.create_entry(_beob(cls, max_, class_id=None), user=u, db=s)
    with pytest.raises(HTTPException):
        await N.create_entry(_beob(cls, max_, note="   "), user=u, db=s)
    # Ein Notenwert an einer Beobachtung ist die Vermischung, die nie passieren darf.
    with pytest.raises(HTTPException):
        await N.create_entry(_beob(cls, max_, value=2.0), user=u, db=s)


@pytest.mark.asyncio
async def test_liste_und_zaehler_finden_sie(s):
    u, cls, max_ = await _grund(s)
    await N.create_entry(_beob(cls, max_), user=u, db=s)
    rows = await N.list_entries(cls.id, user=u, db=s)
    assert [r.note for r in rows] == ["hat geholfen"]
    summe = await N.summary(cls.id, term="1", user=u, db=s)
    assert [x.observations for x in summe] == [1]
    # Anderes Halbjahr: die Beobachtung gehoert dorthin nicht.
    assert [x.observations for x in await N.summary(cls.id, term="2", user=u, db=s)] == [0]


@pytest.mark.asyncio
async def test_loeschen_geht_ueber_die_klasse(s):
    u, cls, max_ = await _grund(s)
    e = await N.create_entry(_beob(cls, max_), user=u, db=s)
    await N.delete_entry(e.id, user=u, db=s)
    assert (await s.execute(select(GradeEntry))).scalars().all() == []


@pytest.mark.asyncio
async def test_fremde_klasse_bleibt_zu(s):
    u, cls, max_ = await _grund(s)
    fremd = User(email="f@b.de", password_hash="x", name="F"); s.add(fremd); await s.flush()
    s.add(UserModule(user_id=fremd.id, module_key="auswertung"))
    await s.commit()
    with pytest.raises(HTTPException) as e:
        await N.create_entry(_beob(cls, max_), user=fremd, db=s)
    assert e.value.status_code in (403, 404)
