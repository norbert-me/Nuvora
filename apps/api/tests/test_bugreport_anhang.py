"""Fehlermeldung mit selbst gewaehltem Anhang.

Protokoll und Umgebung bleiben inhaltsfrei — der Anhang darf Inhalte tragen,
weil ihn die Lehrkraft ausgesucht hat. Was hier bewacht wird, ist die Grenze:
zu Grosses wird ABGELEHNT statt abgeschnitten (ein halber Screenshot ist
keiner), und Dateiname wie MIME-Typ werden entschaerft, bevor sie irgendwo
landen.

Seit dem Umbau (06.09.2026) wird die Meldung GESPEICHERT statt gemailt: sie
war sonst weg, sobald das Postfach aufgeraeumt wurde, liess sich nicht
durchsehen und ging ohne funktionierendes SMTP verloren. Geprueft wird
deshalb die gespeicherte Zeile.
"""
import base64

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import undefer

from app.main import BugBody, bugreport
from app.models import BugReport, User


class _Anfrage:
    headers = {"user-agent": "Testbrowser", "X-Real-IP": "203.0.113.9"}
    client = None


@pytest.fixture
async def konto(s):
    u = User(email="l@schule.de", password_hash="x", name="L")
    s.add(u)
    await s.commit()
    return u


async def _melden(s, konto, **felder):
    await bugreport(BugBody(**felder), _Anfrage(), user=konto, db=s)
    # `anhang` ist deferred (Listen sollen die Bytes nicht mitschleppen) — hier
    # ausdruecklich mitladen, sonst laeuft der Zugriff in ein Nachladen, das
    # async nicht darf.
    return (await s.execute(select(BugReport).options(undefer(BugReport.anhang)))).scalars().all()



@pytest.mark.asyncio
async def test_anhang_wird_gespeichert(s, konto):
    daten = b"%PDF-1.4 Beispiel"
    rows = await _melden(s, konto, message="Knopf klemmt", anhang_name="fehler.pdf",
                         anhang_typ="application/pdf",
                         anhang_daten=base64.b64encode(daten).decode())
    assert len(rows) == 1
    r = rows[0]
    assert (r.anhang_name, r.anhang_typ) == ("fehler.pdf", "application/pdf")
    assert r.anhang == daten
    assert r.email == "l@schule.de" and r.message == "Knopf klemmt"


@pytest.mark.asyncio
async def test_zu_grosser_anhang_wird_abgelehnt(s, konto):
    zu_gross = base64.b64encode(b"x" * (3 * 1024 * 1024 + 1)).decode()
    with pytest.raises(HTTPException) as e:
        await _melden(s, konto, message="Bild", anhang_name="a.png",
                      anhang_typ="image/png", anhang_daten=zu_gross)
    assert e.value.status_code == 413


@pytest.mark.asyncio
async def test_name_und_typ_werden_entschaerft(s, konto):
    rows = await _melden(s, konto, message="Test",
                         anhang_name="../../etc/passwd\nX: y",
                         anhang_typ="image/png; charset=evil",
                         anhang_daten=base64.b64encode(b"abc").decode())
    r = rows[0]
    assert "/" not in r.anhang_name and "\n" not in r.anhang_name
    assert r.anhang_typ == "application/octet-stream"


@pytest.mark.asyncio
async def test_kaputte_base64_wird_abgewiesen(s, konto):
    with pytest.raises(HTTPException) as e:
        await _melden(s, konto, message="Test", anhang_name="a.png",
                      anhang_typ="image/png", anhang_daten="kein base64!!")
    assert e.value.status_code == 400


@pytest.mark.asyncio
async def test_ohne_anhang_bleibt_alles_wie_bisher(s, konto):
    rows = await _melden(s, konto, message="Nur Text")
    assert rows[0].anhang is None and rows[0].anhang_name == ""


@pytest.mark.asyncio
async def test_abgeschaltet_heisst_abgeschaltet(s, konto):
    """Die Administration kann den Melde-Knopf im Ganzen abschalten."""
    from app.models import AppSetting

    s.add(AppSetting(key="bugreport_aus", value="1"))
    await s.commit()
    with pytest.raises(HTTPException) as e:
        await _melden(s, konto, message="Test")
    assert e.value.status_code == 403


@pytest.mark.asyncio
async def test_browserkennung_nur_mit_umgebung(s, konto):
    """Ohne das Haekchen „Technische Angaben" bleibt auch die Kennung des
    Browsers draussen. Sie stand vorher immer im Bericht, weil der Server sie
    aus der Kopfzeile las — der Dialog versprach etwas anderes."""
    rows = await _melden(s, konto, message="ohne Umgebung")
    assert rows[0].browser == ""

    for r in rows:
        await s.delete(r)
    await s.commit()

    rows = await _melden(s, konto, message="mit Umgebung", umgebung="Fenster: 390x844")
    assert rows[0].browser == "Testbrowser"
    assert rows[0].umgebung == "Fenster: 390x844"
