"""Terminierte To-dos in den Kalendern, die nach draussen gehen.

Ein faelliges To-do gehoert dorthin, wo die Lehrkraft ihren Tag sieht — ins
Handy, nach Outlook. Was dieser Test festhaelt:

  1. **Regel 3**: der Kalender haengt nicht am Notizbrett. Ohne das Modul (oder
     mit abgeschaltetem Teil „Aufgaben") fallen die To-dos einfach weg — kein
     Fehler, keine leere Sonderbehandlung.
  2. **Nur Terminiertes, nichts Erledigtes**: ein abgehaktes To-do hat im
     fremden Kalender nichts mehr verloren (in Nuvora bleibt es sichtbar).
  3. **DTEND**: ohne Uhrzeit ganztaegig und damit EXKLUSIV (genau ein „+1"),
     mit Uhrzeit ein echter Endzeitpunkt am selben Tag (Faelligkeit + 30 min).
  4. **Read-only in CalDAV**: PUT und DELETE geben 403 mit Vorbedingung. Eine
     drueben geaenderte Aufgabe kaeme sonst als Kopie an, und das Abhaken
     gehoert ins Notizbrett.
"""
from datetime import date

import pytest

from app.models import Todo, User, UserModule
from app.routers.kalender import ics_feed

# Die CalDAV-Werkbank (Anwendung, Geraete-Passwort, ASGI-Aufruf) steht schon in
# test_caldav.py — sie hier abzuschreiben waere eine zweite Fassung, die beim
# ersten Umbau veraltet.
from test_caldav import PASSWORT, _kal, _ruf, welt  # noqa: F401


class _Req:
    """So viel Request, wie der Feed anfasst."""

    def __init__(self):
        self.headers = {}


async def _konto(s, mail="todo-feed@test.de", *, modul=True, optionen=None):
    u = User(email=mail, password_hash="x", calendar_token=mail.split("@")[0])
    s.add(u)
    await s.flush()
    if modul:
        s.add(UserModule(user_id=u.id, module_key="notizbrett", optionen=optionen))
    await s.commit()
    return u


async def _feed(s, u):
    return (await ics_feed(u.calendar_token, _Req(), s)).body.decode()


@pytest.mark.asyncio
async def test_terminiertes_todo_steht_im_feed(s):
    u = await _konto(s)
    s.add(Todo(owner_id=u.id, text="Zeugnisse schreiben", notiz="Erst 7a", due_date=date(2026, 3, 3)))
    await s.commit()
    text = await _feed(s, u)
    assert "SUMMARY:Aufgabe: Zeugnisse schreiben" in text
    assert "DESCRIPTION:Erst 7a" in text
    # Ganztaegig: DTEND ist exklusiv, also genau ein Tag weiter.
    assert "DTSTART;VALUE=DATE:20260303" in text
    assert "DTEND;VALUE=DATE:20260304" in text
    # Eigene UID-Form: ein Client darf die Aufgabe nicht mit einem
    # Kalender-Eintrag verwechseln, und eine Formkorrektur muss ankommen.
    assert "UID:nuvora-todo-" in text and "-t1@nuvora" in text


@pytest.mark.asyncio
async def test_mit_uhrzeit_getaktet_und_eine_halbe_stunde_lang(s):
    u = await _konto(s, "todo-zeit@test.de")
    s.add(Todo(owner_id=u.id, text="Anruf Eltern", due_date=date(2026, 3, 3), due_time="14:20"))
    await s.commit()
    text = await _feed(s, u)
    # Getaktet: DTEND ist ein Zeitpunkt am SELBEN Tag — ein „+1 Tag" waere hier
    # der Fehler, der die Aufgabe ueber Nacht zoege.
    assert "DTSTART:20260303T142000" in text
    assert "DTEND:20260303T145000" in text
    assert "VALUE=DATE:20260303" not in text


@pytest.mark.asyncio
async def test_spaete_aufgabe_bleibt_am_selben_tag(s):
    """23:50 + 30 min waere der Folgetag — geklemmt auf 23:59."""
    u = await _konto(s, "todo-spaet@test.de")
    s.add(Todo(owner_id=u.id, text="Sicherung pruefen", due_date=date(2026, 3, 3), due_time="23:50"))
    await s.commit()
    text = await _feed(s, u)
    assert "DTEND:20260303T235900" in text


@pytest.mark.asyncio
async def test_erledigtes_und_undatiertes_bleiben_draussen(s):
    u = await _konto(s, "todo-fertig@test.de")
    s.add(Todo(owner_id=u.id, text="Schon erledigt", due_date=date(2026, 3, 3), done=True))
    s.add(Todo(owner_id=u.id, text="Irgendwann mal"))
    await s.commit()
    text = await _feed(s, u)
    assert "Schon erledigt" not in text and "Irgendwann mal" not in text


@pytest.mark.asyncio
async def test_ohne_modul_und_ohne_teil_aufgaben_faellt_es_weg(s):
    """Regel 3 in beiden Stufen — und ohne Fehler: der Feed liefert weiter."""
    ohne = await _konto(s, "todo-ohne@test.de", modul=False)
    s.add(Todo(owner_id=ohne.id, text="Unsichtbar", due_date=date(2026, 3, 3)))
    await s.commit()
    text = await _feed(s, ohne)
    assert "Unsichtbar" not in text and text.startswith("BEGIN:VCALENDAR")

    aus = await _konto(s, "todo-teil-aus@test.de", optionen={"aufgaben": False})
    s.add(Todo(owner_id=aus.id, text="Abgeschaltet", due_date=date(2026, 3, 3)))
    await s.commit()
    assert "Abgeschaltet" not in await _feed(s, aus)


@pytest.mark.asyncio
async def test_todos_sind_in_caldav_lesbar_aber_nicht_schreibbar(welt):  # noqa: F811
    """Lesen ja, schreiben nein — dieselbe Bauform wie beim fremden Termin."""
    from app.models import Todo as _Todo, UserModule as _UM
    async with welt["sitzung"]() as s:
        s.add(_UM(user_id=welt["user_id"], module_key="notizbrett"))
        t = _Todo(owner_id=welt["user_id"], text="Kopien holen", due_date=date.today())
        s.add(t)
        await s.commit()
        name = f"todo-{t.id}-t1.ics"

    r = await _ruf(welt["app"], "GET", _kal(welt, name))
    assert r.status == 200 and "SUMMARY:Aufgabe: Kopien holen" in r.text

    for methode in ("PUT", "DELETE"):
        r = await _ruf(welt["app"], methode, _kal(welt, name), body=b"BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n")
        assert r.status == 403, methode
        # Mit Vorbedingung, damit das Geraet sagen kann, WAS nicht ging.
        assert "valid-calendar-object-resource" in r.text

    # Und die Aufgabe steht danach unveraendert in Nuvora.
    async with welt["sitzung"]() as s:
        from sqlalchemy import select
        rows = (await s.execute(select(_Todo))).scalars().all()
        assert [(x.text, x.done) for x in rows] == [("Kopien holen", False)]
