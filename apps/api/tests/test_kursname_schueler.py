"""Am Zugang der Kinder steht das Fach, nicht „7.5 Mathematik"."""
from types import SimpleNamespace

from app.routers.karten import _kurs_ohne_klasse


def test_klasse_vorn_wird_abgeschnitten():
    assert _kurs_ohne_klasse(SimpleNamespace(name="7.5 Mathematik", fach="Mathe"), "7.5") == "Mathematik"
    assert _kurs_ohne_klasse(SimpleNamespace(name="7.5 – LZ", fach=""), "7.5") == "LZ"


def test_ohne_klasse_im_namen_gilt_das_fach_dann_der_name():
    assert _kurs_ohne_klasse(SimpleNamespace(name="Gruppe rot", fach="Mathematik"), "7.5") == "Mathematik"
    assert _kurs_ohne_klasse(SimpleNamespace(name="Gruppe rot", fach=""), "7.5") == "Gruppe rot"


def test_nur_die_klasse_als_name_bleibt_der_name():
    assert _kurs_ohne_klasse(SimpleNamespace(name="7.5", fach=""), "7.5") == "7.5"
