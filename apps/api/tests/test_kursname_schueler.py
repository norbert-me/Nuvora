"""Am Zugang der Kinder steht das Fach, nicht „7.5 Mathematik"."""
from types import SimpleNamespace

from app.routers.karten import _kurs_ohne_klasse


def test_das_fach_gilt_zuerst():
    assert _kurs_ohne_klasse(SimpleNamespace(name="7.5 Mathematik", fach="Mathe"), "7.5") == "Mathe"


def test_ohne_fach_faellt_die_klasse_vorn_weg_auch_wenn_sie_nicht_der_klassenname_ist():
    # Die Klasse heisst hier selbst „7.5 Mathematik" (Fach-Klasse), der Kurs auch.
    assert _kurs_ohne_klasse(SimpleNamespace(name="7.5 Mathematik", fach=""), "7.5 Mathematik") == "Mathematik"
    assert _kurs_ohne_klasse(SimpleNamespace(name="7.5 – LZ", fach=""), "7.5") == "LZ"
    assert _kurs_ohne_klasse(SimpleNamespace(name="10b Deutsch", fach=""), "irgendwas") == "Deutsch"


def test_nichts_uebrig_dann_bleibt_der_name():
    assert _kurs_ohne_klasse(SimpleNamespace(name="7.5", fach=""), "7.5") == "7.5"
    assert _kurs_ohne_klasse(SimpleNamespace(name="Gruppe rot", fach=""), "7.5") == "Gruppe rot"
