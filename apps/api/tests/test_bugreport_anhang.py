"""Fehlermeldung mit selbst gewaehltem Anhang.

Protokoll und Umgebung bleiben inhaltsfrei — der Anhang darf Inhalte tragen,
weil ihn die Lehrkraft ausgesucht hat. Was hier bewacht wird, ist die Grenze:
eine Mail, die der naechste Server wegen ihrer Groesse verwirft, kommt nirgends
an und meldet es niemandem. Deshalb wird zu Grosses ABGELEHNT statt
abgeschnitten (ein halber Screenshot ist keiner), und Dateiname wie MIME-Typ
werden entschaerft, bevor sie in Kopfzeilen landen.
"""
import base64

import pytest
from fastapi import HTTPException

from app import mailer
from app.main import BugBody, bugreport


class _Anfrage:
    headers = {"user-agent": "Testbrowser", "X-Real-IP": "203.0.113.9"}
    client = None


class _Konto:
    id = 4711
    email = "l@schule.de"


@pytest.fixture
def gesendet(monkeypatch):
    """Nichts verschicken — nur festhalten, WAS verschickt worden waere."""
    box = {}

    async def _fake(to, subject, body, reply_to="", anhang=None):
        box.update(to=to, subject=subject, body=body, anhang=anhang)
        return True

    monkeypatch.setattr(mailer, "send_email", _fake)
    monkeypatch.setenv("ADMIN_EMAIL", "betreiber@schule.de")
    return box


@pytest.mark.asyncio
async def test_anhang_geht_mit(gesendet):
    daten = b"%PDF-1.4 Beispiel"
    await bugreport(BugBody(message="Knopf klemmt", anhang_name="fehler.pdf",
                            anhang_typ="application/pdf",
                            anhang_daten=base64.b64encode(daten).decode()),
                    request=_Anfrage(), user=_Konto())
    name, typ, roh = gesendet["anhang"]
    assert (name, typ, roh) == ("fehler.pdf", "application/pdf", daten)
    assert "fehler.pdf" in gesendet["body"], "der Anhang wird im Text genannt"


@pytest.mark.asyncio
async def test_zu_grosser_anhang_wird_abgelehnt(gesendet):
    zu_gross = base64.b64encode(b"x" * (mailer.ANHANG_MAX + 1)).decode()
    with pytest.raises(HTTPException) as e:
        await bugreport(BugBody(message="Bild", anhang_name="a.png", anhang_typ="image/png",
                                anhang_daten=zu_gross), request=_Anfrage(), user=_Konto())
    assert e.value.status_code == 413


@pytest.mark.asyncio
async def test_name_und_typ_werden_entschaerft(gesendet):
    await bugreport(BugBody(message="x", anhang_name="../../etc/passwd\nBcc: wer@anders.de",
                            anhang_typ="text/plain; charset=utf-8\nX-Spam: nein",
                            anhang_daten=base64.b64encode(b"hallo").decode()),
                    request=_Anfrage(), user=_Konto())
    name, typ, _ = gesendet["anhang"]
    assert "\n" not in name and "/" not in name
    assert typ == "application/octet-stream", "ein Typ mit Zusaetzen wird nicht uebernommen"


@pytest.mark.asyncio
async def test_kaputte_base64_wird_abgewiesen(gesendet):
    with pytest.raises(HTTPException) as e:
        await bugreport(BugBody(message="x", anhang_name="a.png", anhang_typ="image/png",
                                anhang_daten="das ist kein base64!!"),
                        request=_Anfrage(), user=_Konto())
    assert e.value.status_code == 400


@pytest.mark.asyncio
async def test_ohne_anhang_bleibt_alles_wie_bisher(gesendet):
    await bugreport(BugBody(message="Nur Text"), request=_Anfrage(), user=_Konto())
    assert gesendet["anhang"] is None
