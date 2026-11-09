"""Ausblenden im Kalender ist eine ANSICHT und sperrt nichts: nach draussen (ICS-Feed,
CalDAV) geht auch, was in Nuvora weggeschaltet ist. Nur der einzeln ausgeblendete
fremde Termin bleibt draussen (er ist das „Loeschen" aus dem Handy).
`ext_weitergeben` ist die eine Stelle, an der beide Wege fragen.
"""
from types import SimpleNamespace

from app.routers.kalender import ext_weitergeben, ganztaegig_weitergeben, ist_ganztaegig

SCHULE = {"cal": "https://a.example/schule.ics", "hidden": False}
FAMILIE = {"cal": "https://b.example/familie.ics", "hidden": False}


def _u(kal_ext=None):
    return SimpleNamespace(ansichten={"kal_ext": kal_ext} if kal_ext is not None else {})


def test_ohne_einstellung_geht_alles_sichtbare_hinaus():
    assert ext_weitergeben(_u(), SCHULE) and ext_weitergeben(_u(), FAMILIE)


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
