"""Auswertung und Zugang der Kinder müssen dieselbe Note rechnen.

Die Auswertungsseite fällt ohne eigene Angabe auf das Profil zurück (Notenschlüssel,
Bonusregel); die anderen Wege rechneten mit der eingebauten Vorgabe."""
from types import SimpleNamespace

from app.scoring import konfig_mit_vorgaben, note_aus_pct

SCHARF = {"1": 95, "2": 85, "3": 70, "4": 55, "5": 30, "6": 0}


def test_profil_schluessel_gilt_ohne_eigenen():
    user = SimpleNamespace(grade_scale=SCHARF, ansichten={})
    cfg = konfig_mit_vorgaben({}, user)
    assert cfg["grade_scale"] == SCHARF
    # 90 % liegen beim scharfen Profilschlüssel zwischen 1 und 2, bei der eingebauten Skala besser.
    assert note_aus_pct(90, cfg["grade_scale"]) > note_aus_pct(90, None)


def test_eigene_angabe_der_auswertung_gewinnt():
    user = SimpleNamespace(grade_scale=SCHARF, ansichten={"bonus_regel": {"max_stufen": 2}})
    eigen = {"grade_scale": {"1": 90, "2": 80, "3": 65, "4": 50, "5": 25, "6": 0}, "bonus_regel": {"max_stufen": 0}}
    cfg = konfig_mit_vorgaben(eigen, user)
    assert cfg["grade_scale"]["1"] == 90
    assert cfg["bonus_regel"]["max_stufen"] == 0


def test_bonusregel_aus_dem_profil_und_originalen_bleiben_unberuehrt():
    user = SimpleNamespace(grade_scale=None, ansichten={"bonus_regel": {"max_stufen": 2, "mindest_nenner": 3, "falsch_zehrt": False}})
    roh = {"krank": [1]}
    cfg = konfig_mit_vorgaben(roh, user)
    assert cfg["bonus_regel"]["max_stufen"] == 2
    assert "bonus_regel" not in roh and cfg["krank"] == [1]     # die gespeicherte Konfiguration wird nicht verändert


def test_ohne_benutzer_und_ohne_config_kein_fehler():
    assert konfig_mit_vorgaben(None, None) == {}
