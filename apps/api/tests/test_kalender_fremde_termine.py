"""Fremde (abonnierte) Termine im eigenen Export — und was „loeschen" dort heisst.

Drei Dinge muessen stimmen, und alle drei sind schon einmal die Stelle gewesen,
an der so etwas kippt:

  * **Aus ist aus.** Wer seinen iCloud-Kalender in Nuvora einblendet und Nuvora
    zurueck aufs selbe Handy spiegelt, saehe jeden Termin doppelt. Der Schalter
    (`users.feed_external`) ist deshalb die Vorgabe, nicht die Ausnahme.
  * **Der Schluessel bleibt stabil.** UID und Dateiname entstehen als Hash aus
    „uid|Datum"; wandert er, legt das Handy bei jedem Abgleich eine Kopie an.
  * **Ausgeblendetes ist weg, aber auffindbar.** `/external-hidden` beantwortet,
    WAS ausgeblendet ist — sonst gaebe es den Reiter „Ausgeblendet" umsonst.
"""
from datetime import date, timedelta

import pytest

import app.routers.kalender as K
from app.models import User


def _ics(tage_ab_heute=3, uid="fremd-1", titel="Zahnarzt"):
    tag = (date.today() + timedelta(days=tage_ab_heute)).strftime("%Y%m%d")
    return ("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\n"
            f"UID:{uid}\r\nDTSTART;VALUE=DATE:{tag}\r\n"
            f"SUMMARY:{titel}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n")


async def _user(s, mit=False):
    u = User(email="fremd@test.de", password_hash="x", calendar_token="tokfremd",
             external_calendars=[{"url": "https://example.org/x.ics", "color": "", "name": ""}],
             feed_external=mit)
    s.add(u)
    await s.commit()
    return u


@pytest.fixture(autouse=True)
def _kein_netz(monkeypatch):
    """Kein Testlauf haengt an einem fremden Server."""
    K._EXT_CACHE.clear()
    monkeypatch.setattr(K, "_fetch_ics", lambda url, **kw: _ics())


class _Req:
    def __init__(self, headers=None):
        self.headers = headers or {}


@pytest.mark.asyncio
async def test_ohne_schalter_bleibt_der_feed_bei_den_eigenen(s):
    await _user(s, mit=False)
    text = (await K.ics_feed("tokfremd", _Req(), s)).body.decode()
    assert "Zahnarzt" not in text


@pytest.mark.asyncio
async def test_mit_schalter_stehen_sie_im_feed(s):
    await _user(s, mit=True)
    text = (await K.ics_feed("tokfremd", _Req(), s)).body.decode()
    assert "Zahnarzt" in text
    assert "nuvora-ext-" in text


@pytest.mark.asyncio
async def test_ausgeblendetes_geht_nicht_mit_hinaus(s):
    u = await _user(s, mit=True)
    rows = await K.externe_ereignisse(u)
    u.external_hidden = [rows[0]["key"]]
    await s.commit()
    text = (await K.ics_feed("tokfremd", _Req(), s)).body.decode()
    assert "Zahnarzt" not in text


@pytest.mark.asyncio
async def test_schluessel_und_dateiname_bleiben_gleich(s):
    u = await _user(s, mit=True)
    rows1 = await K.externe_ereignisse(u)
    K._EXT_CACHE.clear()
    rows2 = await K.externe_ereignisse(u)
    assert rows1[0]["key"] == rows2[0]["key"]
    assert K.ext_dateiname(rows1[0]["key"]) == K.ext_dateiname(rows2[0]["key"])
    assert K.ext_dateiname(rows1[0]["key"]).startswith("ext-")


@pytest.mark.asyncio
async def test_ausgeblendete_liste_nennt_titel_und_verwaiste(s):
    u = await _user(s, mit=True)
    rows = await K.externe_ereignisse(u)
    u.external_hidden = [rows[0]["key"], "gibtsnichtmehr|2026-01-01"]
    await s.commit()
    liste = await K.external_hidden(user=u)
    nach_key = {e["key"]: e for e in liste}
    assert nach_key[rows[0]["key"]]["title"] == "Zahnarzt"
    verwaist = nach_key["gibtsnichtmehr|2026-01-01"]
    assert verwaist["verwaist"] is True
    assert verwaist["date"] == "2026-01-01"
