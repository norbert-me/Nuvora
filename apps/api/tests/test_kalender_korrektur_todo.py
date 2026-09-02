"""Bruecke Kalender -> Notizbrett: das To-do „korrigieren" am Arbeitstermin.

Regel 3: die Bruecke ist Zusatz — ohne aktives Modul entsteht nichts. Was hier
bewacht wird, ist der Gleichlauf: der Name der Arbeit steht im Aufgabentext,
und wird die Arbeit umbenannt, muss die Aufgabe mitgehen — sonst heisst sie
weiter „Nr. 1 korrigieren", waehrend im Kalender „Bruchrechnung" steht. Einen
selbst umformulierten Text fasst Nuvora dabei nicht an: der gehoert der
Lehrkraft.
"""
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from app.models import SchoolClass, Todo, User, UserModule
from app.routers import kalender as KAL


async def _welt(s):
    u = User(email="ka@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    s.add(UserModule(user_id=u.id, module_key="notizbrett"))
    s.add(UserModule(user_id=u.id, module_key="kalender"))
    cls = SchoolClass(name="7a", owner_id=u.id)
    s.add(cls)
    await s.commit()
    return u, cls


async def _todo(s):
    return (await s.execute(select(Todo))).scalars().first()


@pytest.mark.asyncio
async def test_notiz_stellt_den_namen(s):
    # Der Titel ist meist die Nummer, die Notiz sagt, worum es geht — in der
    # Aufgabenliste liest man das Zweite.
    u, cls = await _welt(s)
    tag = datetime(2026, 9, 10, 8)
    e = await KAL.create_exam(KAL.ExamIn(class_id=cls.id, date=tag, title="Nr. 1", notiz="Bruchrechnung"), user=u, db=s)
    td = await _todo(s)
    assert td.text == f"Bruchrechnung korrigieren #ka{e.id}"
    # Aendert sich die Notiz, heisst die Aufgabe mit.
    await KAL.update_exam(e.id, KAL.ExamIn(class_id=cls.id, date=tag, title="Nr. 1", notiz="Dezimalzahlen"), user=u, db=s)
    td = await _todo(s)
    assert td.text == f"Dezimalzahlen korrigieren #ka{e.id}"


@pytest.mark.asyncio
async def test_umbenennen_zieht_die_aufgabe_mit(s):
    u, cls = await _welt(s)
    tag = datetime(2026, 9, 10, 8)
    e = await KAL.create_exam(KAL.ExamIn(class_id=cls.id, date=tag, title="Nr. 1"), user=u, db=s)
    td = await _todo(s)
    assert td and td.text == f"Nr. 1 korrigieren #ka{e.id}"

    await KAL.update_exam(e.id, KAL.ExamIn(class_id=cls.id, date=tag, title="Bruchrechnung"), user=u, db=s)
    td = await _todo(s)
    assert td.text == f"Bruchrechnung korrigieren #ka{e.id}"
    # Genau EINE Aufgabe je Termin — nicht bei jeder Aenderung eine neue.
    assert len((await s.execute(select(Todo))).scalars().all()) == 1


@pytest.mark.asyncio
async def test_eigener_text_bleibt_unangetastet(s):
    u, cls = await _welt(s)
    tag = datetime(2026, 9, 10, 8)
    e = await KAL.create_exam(KAL.ExamIn(class_id=cls.id, date=tag, title="Nr. 1"), user=u, db=s)
    td = await _todo(s)
    td.text = f"Zweitkorrektur abstimmen #ka{e.id}"
    await s.commit()

    await KAL.update_exam(e.id, KAL.ExamIn(class_id=cls.id, date=tag, title="Bruchrechnung"), user=u, db=s)
    td = await _todo(s)
    assert td.text == f"Zweitkorrektur abstimmen #ka{e.id}"


@pytest.mark.asyncio
async def test_erledigtes_bleibt_stehen(s):
    u, cls = await _welt(s)
    tag = datetime(2026, 9, 10, 8)
    e = await KAL.create_exam(KAL.ExamIn(class_id=cls.id, date=tag, title="Nr. 1"), user=u, db=s)
    td = await _todo(s)
    td.done = True
    await s.commit()
    await KAL.update_exam(e.id, KAL.ExamIn(class_id=cls.id, date=tag + timedelta(days=3), title="Bruchrechnung"), user=u, db=s)
    td = await _todo(s)
    assert td.text == f"Nr. 1 korrigieren #ka{e.id}", "eine abgehakte Aufgabe wird nicht mehr angefasst"
