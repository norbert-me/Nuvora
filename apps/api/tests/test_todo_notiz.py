"""Modul Notizbrett: die Notiz an einer Aufgabe.

Der `text` ist die Zeile in der Liste und bleibt kurz. Was man sich zur Sache
merkt (drei Stichpunkte zur Konferenz, eine Telefonnummer), passte dort nicht
hinein — und landete deshalb gar nicht erst in Nuvora.

Was hier bewacht wird: die Notiz kommt mit, laesst sich LEEREN (anders als der
Text: sie ist ein Zusatz, kein Pflichtfeld) und ist in der Laenge begrenzt.
"""
import pytest

from app.models import User, UserModule
from app.routers import todos as T


async def _konto(s):
    u = User(email="todo@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    s.add(UserModule(user_id=u.id, module_key="notizbrett"))
    await s.commit()
    return u


@pytest.mark.asyncio
async def test_notiz_anlegen_aendern_leeren(s):
    u = await _konto(s)
    t = await T.create_todo(T.TodoIn(text="Konferenz", notiz="Punkt 1\nPunkt 2"), user=u, db=s)
    assert t["notiz"] == "Punkt 1\nPunkt 2"
    liste = await T.list_todos(user=u, db=s)
    assert liste[0]["notiz"] == "Punkt 1\nPunkt 2", "die Notiz kommt auch in der Liste mit"

    t = await T.update_todo(t["id"], T.TodoPatch(notiz="nur noch das"), user=u, db=s)
    assert t["notiz"] == "nur noch das"
    t = await T.update_todo(t["id"], T.TodoPatch(notiz=""), user=u, db=s)
    assert t["notiz"] == "", "leeren muss gehen — die Notiz ist ein Zusatz"
    assert t["text"] == "Konferenz", "der Text bleibt davon unberuehrt"


@pytest.mark.asyncio
async def test_notiz_wird_begrenzt(s):
    u = await _konto(s)
    t = await T.create_todo(T.TodoIn(text="Lang", notiz="x" * 9000), user=u, db=s)
    assert len(t["notiz"]) == 5000


@pytest.mark.asyncio
async def test_ohne_notiz_bleibt_alles_wie_bisher(s):
    u = await _konto(s)
    t = await T.create_todo(T.TodoIn(text="Schlicht"), user=u, db=s)
    assert t["notiz"] == ""
