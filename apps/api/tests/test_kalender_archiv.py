"""Vergangene fremde Termine bleiben — als read-only-Kopie im Archiv.

Ein abonnierter Feed zeigt nur ein Fenster (60 Tage zurueck), und viele Feeds
liefern selbst kaum Vergangenheit. Zugesagt sind mindestens fuenf Jahre. Was
hier bewacht wird:

  * Vergangenes wird archiviert, Kommendes nicht; ein zweiter Abruf schreibt
    nichts, was sich nicht geaendert hat.
  * Archiv und Live ergeben keine Dubletten (Live gewinnt).
  * Ein drueben geloeschter Termin bleibt aus dem Archiv sichtbar.
  * Ausgeblendet bleibt ausgeblendet — auch aus dem Archiv.
  * Die Abo-Adresse steht nicht im Klartext im Archiv.
  * Aufgeraeumt wird erst nach sechs Jahren; geloescht je Kalender oder ganz.
  * Mandantentrennung; der ICS-Feed exportiert das Archiv nicht.
"""
from datetime import date, timedelta

import pytest
from sqlalchemy import select

import app.routers.kalender as K
from app.models import ExternalEventArchive, User, UserModule

URL = "https://example.org/geheim-abc.ics"


def _vevent(tag: date, uid: str, titel: str) -> str:
    return (f"BEGIN:VEVENT\r\nUID:{uid}\r\nDTSTART;VALUE=DATE:{tag.strftime('%Y%m%d')}\r\n"
            f"SUMMARY:{titel}\r\nEND:VEVENT\r\n")


def _ics(*events) -> str:
    return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n" + "".join(events) + "END:VCALENDAR\r\n"


FEED = {"text": ""}


@pytest.fixture(autouse=True)
def _kein_netz(monkeypatch):
    K._EXT_CACHE.clear()
    heute = date.today()
    FEED["text"] = _ics(_vevent(heute - timedelta(days=10), "alt-1", "Elternabend"),
                        _vevent(heute + timedelta(days=5), "neu-1", "Zahnarzt"))
    monkeypatch.setattr(K, "_fetch_ics", lambda url, **kw: FEED["text"])


async def _user(s, mail="archiv@test.de", token="tokarchiv", mit=True):
    u = User(email=mail, password_hash="x", calendar_token=token, feed_external=mit,
             external_calendars=[{"url": URL, "color": "#ff0000", "name": "Privat"}])
    s.add(u)
    await s.flush()
    s.add(UserModule(user_id=u.id, module_key="kalender"))
    await s.commit()
    return u


async def _archiv(s, u):
    return (await s.execute(select(ExternalEventArchive)
                            .where(ExternalEventArchive.owner_id == u.id))).scalars().all()


@pytest.mark.asyncio
async def test_vergangenes_wird_archiviert_und_nicht_doppelt_geschrieben(s):
    u = await _user(s)
    await K.externe_ereignisse(u, db=s)
    rows = await _archiv(s, u)
    assert [r.title for r in rows] == ["Elternabend"], "nur Vergangenes"
    assert rows[0].cal_hash == K.cal_kennung(URL)
    assert rows[0].cal_name == "Privat"
    # Die Abo-Adresse ist ein Geheimnis und steht nirgends im Archiv.
    for r in rows:
        for c in r.__table__.columns:
            assert "geheim-abc" not in str(getattr(r, c.name) or "")

    # Zweiter frischer Abruf ohne Aenderung: nichts wird geschrieben.
    assert await K.archivieren(s, u, await K.externe_ereignisse(u, refresh=True)) == 0
    # Geaendert: genau eine Zeile wird nachgezogen, keine zweite angelegt.
    FEED["text"] = FEED["text"].replace("Elternabend", "Elternabend 7b")
    await K.externe_ereignisse(u, refresh=True, db=s)
    rows = await _archiv(s, u)
    assert [r.title for r in rows] == ["Elternabend 7b"]


@pytest.mark.asyncio
async def test_archiv_und_live_ohne_dublette_und_geloeschtes_bleibt(s):
    u = await _user(s)
    await K.externe_ereignisse(u, db=s)
    alle = await K.externe_ereignisse(u, db=s, archiv=True)
    assert [e["title"] for e in alle].count("Elternabend") == 1, "Live gewinnt, keine Dublette"
    assert not any(e.get("archiv") for e in alle)

    # Drueben geloescht (oder aus dem Fenster gerutscht): kommt aus dem Archiv.
    heute = date.today()
    FEED["text"] = _ics(_vevent(heute + timedelta(days=5), "neu-1", "Zahnarzt"))
    alle = await K.externe_ereignisse(u, refresh=True, db=s, archiv=True)
    alt = [e for e in alle if e["title"] == "Elternabend"]
    assert len(alt) == 1 and alt[0]["archiv"] is True
    # Noch abonniert: `cal` ist die Adresse, damit der Ansichtsfilter greift.
    assert alt[0]["cal"] == URL and alt[0]["color"] == "#ff0000"

    sichtbar = await K.external_events(user=u, db=s)
    assert any(e["title"] == "Elternabend" for e in sichtbar)
    # Eingrenzen per frm/to.
    ab = (heute - timedelta(days=1)).isoformat()
    assert not any(e["title"] == "Elternabend" for e in await K.external_events(frm=ab, user=u, db=s))

    # Suche findet den archivierten Termin.
    tr = await K.suche(q="elternabend", user=u, db=s)
    assert [t.art for t in tr] == ["extern"]


@pytest.mark.asyncio
async def test_ausgeblendet_bleibt_auch_aus_dem_archiv_weg(s):
    u = await _user(s)
    await K.externe_ereignisse(u, db=s)
    key = (await _archiv(s, u))[0].schluessel
    u.external_hidden = [key]
    await s.commit()
    FEED["text"] = _ics()      # drueben weg: nur noch das Archiv kennt ihn
    K._EXT_CACHE.clear()
    assert not any(e["title"] == "Elternabend" for e in await K.external_events(user=u, db=s))
    assert await K.suche(q="elternabend", user=u, db=s) == []
    versteckt = await K.external_hidden(user=u, db=s)
    eintrag = [e for e in versteckt if e["key"] == key][0]
    assert eintrag["title"] == "Elternabend" and not eintrag.get("verwaist")


@pytest.mark.asyncio
async def test_abgemeldeter_kalender_bleibt_sichtbar_und_laesst_sich_loeschen(s):
    u = await _user(s)
    await K.externe_ereignisse(u, db=s)
    u.external_calendars = []
    u.external_ics_url = None
    await s.commit()
    alle = await K.external_events(user=u, db=s)
    assert [e["title"] for e in alle] == ["Elternabend"]
    assert alle[0]["cal"] == f"archiv:{K.cal_kennung(URL)}"
    assert alle[0]["cal_name"] == "Privat" and alle[0]["color"] == "#ff0000"

    liste = await K.external_archive(user=u, db=s)
    assert len(liste) == 1 and liste[0]["abonniert"] is False and liste[0]["anzahl"] == 1

    # Fremde Kennung loescht nichts; die richtige loescht genau diesen Kalender.
    assert (await K.delete_external_archive(cal="archiv:" + "0" * 24, user=u, db=s))["geloescht"] == 0
    assert (await K.delete_external_archive(cal=alle[0]["cal"], user=u, db=s))["geloescht"] == 1
    assert await K.external_events(user=u, db=s) == []


@pytest.mark.asyncio
async def test_loeschen_per_adresse_und_ganz(s):
    u = await _user(s)
    await K.externe_ereignisse(u, db=s)
    assert (await K.delete_external_archive(cal=URL.replace("https://", "webcal://"), user=u, db=s))["geloescht"] == 1
    await K.externe_ereignisse(u, refresh=True, db=s)
    assert len(await _archiv(s, u)) == 1
    assert (await K.delete_external_archive(user=u, db=s))["geloescht"] == 1


@pytest.mark.asyncio
async def test_aufraeumen_erst_nach_sechs_jahren(s):
    u = await _user(s)
    heute = date(2026, 9, 17)
    for i, tag in enumerate([date(2020, 9, 16), date(2020, 9, 18), date(2021, 9, 17)]):
        s.add(ExternalEventArchive(owner_id=u.id, schluessel=f"x{i}|{tag}", date=tag, title=f"T{i}"))
    await s.commit()
    assert await K.archiv_raeumen(s, heute=heute) == 1
    assert sorted(r.title for r in await _archiv(s, u)) == ["T1", "T2"], "fuenf Jahre bleiben sicher"
    # 29. Februar bricht nicht.
    assert await K.archiv_raeumen(s, heute=date(2028, 2, 29)) >= 0


@pytest.mark.asyncio
async def test_mandantentrennung(s):
    a = await _user(s)
    b = await _user(s, mail="b@test.de", token="tokb")
    await K.externe_ereignisse(a, db=s)
    K._EXT_CACHE.clear()
    FEED["text"] = _ics()
    assert await K.external_events(user=b, db=s) == [], "b sieht das Archiv von a nicht"
    assert await K.external_archive(user=b, db=s) == []
    assert (await K.delete_external_archive(user=b, db=s))["geloescht"] == 0
    assert len(await _archiv(s, a)) == 1


class _Req:
    headers: dict = {}


@pytest.mark.asyncio
async def test_ics_feed_exportiert_das_archiv_nicht(s):
    u = await _user(s)
    await K.externe_ereignisse(u, db=s)
    FEED["text"] = _ics()
    K._EXT_CACHE.clear()
    text = (await K.ics_feed("tokarchiv", _Req(), s)).body.decode()
    assert "Elternabend" not in text
    assert len(await _archiv(s, u)) == 1


@pytest.mark.asyncio
async def test_konto_loeschen_nimmt_das_archiv_mit(s):
    u = await _user(s)
    await K.externe_ereignisse(u, db=s)
    uid = u.id
    await s.delete(u)
    await s.commit()
    rest = (await s.execute(select(ExternalEventArchive)
                            .where(ExternalEventArchive.owner_id == uid))).scalars().all()
    assert rest == []
