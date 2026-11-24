"""Ausblenden im Kalender ist eine ANSICHT und sperrt nichts: nach draussen (ICS-Feed,
CalDAV) geht auch, was in Nuvora weggeschaltet ist. Nur der einzeln ausgeblendete
fremde Termin bleibt draussen (er ist das „Loeschen" aus dem Handy).
`ext_weitergeben` ist die eine Stelle, an der beide Wege fragen.
"""
from types import SimpleNamespace

from app.routers.kalender import ext_weitergeben, ganztaegig_weitergeben, ist_ganztaegig

SCHULE = {"cal": "https://a.example/schule.ics", "hidden": False}
FAMILIE = {"cal": "https://b.example/familie.ics", "hidden": False}


def _u(kal_ext=None, export=(True, True)):
    """Ein Konto mit zwei abonnierten Kalendern; `export` sagt je Kalender, ob er
    nach draussen geht (Schule, Familie)."""
    return SimpleNamespace(
        ansichten={"kal_ext": kal_ext} if kal_ext is not None else {},
        feed_external=any(export), external_ics_url=None, external_ics_color="",
        external_calendars=[{"url": SCHULE["cal"], "color": "", "name": "Schule", "export": export[0]},
                            {"url": FAMILIE["cal"], "color": "", "name": "Familie", "export": export[1]}])


def test_ohne_einstellung_geht_alles_sichtbare_hinaus():
    assert ext_weitergeben(_u(), SCHULE) and ext_weitergeben(_u(), FAMILIE)


def test_export_wird_je_kalender_entschieden():
    u = _u(export=(True, False))
    assert ext_weitergeben(u, SCHULE) and not ext_weitergeben(u, FAMILIE)


def test_altbestand_ohne_export_folgt_dem_frueheren_gesamtschalter():
    u = _u()
    u.external_calendars = [{"url": SCHULE["cal"], "color": "", "name": ""}]   # ohne "export"
    u.feed_external = True
    assert ext_weitergeben(u, SCHULE)
    u.feed_external = False
    assert not ext_weitergeben(u, SCHULE)


def test_einzeln_ausgeblendeter_termin_bleibt_draussen():
    assert not ext_weitergeben(_u(), {**SCHULE, "hidden": True})


def test_ausgeschalteter_kalender_geht_trotzdem_hinaus():
    u = _u({"an": True, "aus": [FAMILIE["cal"]]})
    assert ext_weitergeben(u, SCHULE) and ext_weitergeben(u, FAMILIE)


def test_alle_fremden_ausgeblendet_aendert_den_export_nicht():
    u = _u({"an": False, "aus": []})
    assert ext_weitergeben(u, SCHULE) and ext_weitergeben(u, FAMILIE)


def test_kaputte_einstellung_versteckt_nichts():
    assert ext_weitergeben(_u("quatsch"), SCHULE)


# ── Ganztaegiges ──


def test_ganztaegig_geht_hinaus_solange_nichts_eingestellt_ist():
    assert ganztaegig_weitergeben(SimpleNamespace(ansichten={}))
    assert ganztaegig_weitergeben(SimpleNamespace(ansichten={"kal_allday": {"an": True}}))


def test_ganztaegig_ausgeblendet_geht_trotzdem_ans_handy():
    assert ganztaegig_weitergeben(SimpleNamespace(ansichten={"kal_allday": {"an": False}}))


def test_ganztaegig_heisst_ohne_stunde_und_ohne_uhrzeit():
    assert ist_ganztaegig(SimpleNamespace(period=None, start_time=""))
    assert not ist_ganztaegig(SimpleNamespace(period=3, start_time=""))
    assert not ist_ganztaegig(SimpleNamespace(period=None, start_time="08:00"))


import pytest


@pytest.mark.asyncio
async def test_speichern_holt_den_namen_und_fuehrt_den_gesamtschalter_nach(s, monkeypatch):
    """Ohne Namen holt der Server ihn aus dem Kalender (X-WR-CALNAME), sonst aus
    der Adresse; `export` je Kalender, und `feed_external` = mindestens einer."""
    from app.models import User, UserModule
    from app.routers import kalender as K

    def fake(url):
        if "familie" in url:
            return "BEGIN:VCALENDAR\r\nX-WR-CALNAME:Familie Müller\r\nEND:VCALENDAR"
        raise OSError("nicht erreichbar")

    monkeypatch.setattr(K, "_fetch_ics", fake)
    u = User(email="ext@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    s.add(UserModule(user_id=u.id, module_key="kalender"))
    await s.commit()

    d = await K.set_external(K.ExtCalsIn(calendars=[
        K.ExtCalIn(url="https://p53-caldav.icloud.com/published/2/familie", export=False),
        K.ExtCalIn(url="https://outlook.office365.com/owa/calendar/x/reachcalendar.ics", name="Dienst", export=True),
        K.ExtCalIn(url="https://p53-caldav.icloud.com/published/2/andere"),
    ]), user=u, db=s)
    namen = [c["name"] for c in d["calendars"]]
    assert namen == ["Familie Müller", "Dienst", "iCloud"]
    assert [c["export"] for c in d["calendars"]] == [False, True, False]
    assert u.feed_external is True

    d = await K.set_external(K.ExtCalsIn(calendars=[
        K.ExtCalIn(url="https://x.example/a.ics", name="A", export=False)]), user=u, db=s)
    assert u.feed_external is False, "kein Kalender exportiert -> der Gesamtschalter geht aus"
