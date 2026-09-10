"""Modul Notizbrett: die Uhrzeit einer Aufgabe laesst sich wieder WEGNEHMEN.

Gemeldet aus dem Betrieb (iPhone): „Einstellung fuer Uhrzeit kann nicht
entfernt werden." Der Waehler eines gefuellten `<input type="time">` kennt auf
dem iPhone kein „nichts" — die Oberflaeche hat dafuer jetzt einen Knopf. Damit
das ankommt, muss die Grenze dahinter halten: `due_time=""` heisst „weg", nicht
„nicht mitgeschickt" (None). Genau das haelt dieser Test fest, samt der Folge —
ohne Uhrzeit ist die Aufgabe im Kalender wieder ganztaegig.
"""
import pytest

from app.models import User, UserModule
from app.routers import todos as T


async def _konto(s):
    u = User(email="todo-zeit@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    s.add(UserModule(user_id=u.id, module_key="notizbrett"))
    await s.commit()
    return u


@pytest.mark.asyncio
async def test_uhrzeit_laesst_sich_leeren(s):
    u = await _konto(s)
    t = await T.create_todo(T.TodoIn(text="Konferenz", due_date="2026-09-10", due_time="14:30"), user=u, db=s)
    assert t["due_time"] == "14:30"

    t = await T.update_todo(t["id"], T.TodoPatch(due_time=""), request=None, user=u, db=s)
    assert t["due_time"] == "", "leeren muss ankommen — die Uhrzeit ist ein Zusatz"
    assert t["due_date"] == "2026-09-10", "das Datum bleibt davon unberuehrt"

    # Unabhaengig neu lesen: der Wert ist wirklich weg, nicht nur in der Antwort.
    liste = await T.list_todos(user=u, db=s)
    assert liste[0]["due_time"] == ""
    # Und der Kalender zeigt sie danach wieder ganztaegig (keine Uhrzeit).
    kal = await T.calendar_todos(user=u, db=s)
    assert kal[0]["time"] == ""


@pytest.mark.asyncio
async def test_uhrzeit_bleibt_ohne_angabe_stehen(s):
    """None heisst weiterhin „nicht mitgeschickt" — sonst raeumte jedes
    Umbenennen die Uhrzeit mit weg."""
    u = await _konto(s)
    t = await T.create_todo(T.TodoIn(text="AG", due_date="2026-09-11", due_time="08:00"), user=u, db=s)
    t = await T.update_todo(t["id"], T.TodoPatch(text="AG Schach"), request=None, user=u, db=s)
    assert t["due_time"] == "08:00"


@pytest.mark.asyncio
async def test_ohne_datum_keine_uhrzeit(s):
    u = await _konto(s)
    t = await T.create_todo(T.TodoIn(text="Irgendwann", due_date="2026-09-12", due_time="09:15"), user=u, db=s)
    t = await T.update_todo(t["id"], T.TodoPatch(due_date=""), request=None, user=u, db=s)
    assert t["due_date"] is None and t["due_time"] == ""
