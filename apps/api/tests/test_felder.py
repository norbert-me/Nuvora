"""Die zusammengefuehrten Vor-Validatoren.

Ueber zwanzig Dreizeiler („null wird zu leer") sind zu zwei Fabriken in
`app/felder.py` geworden. Zwei Dinge muessen dabei gehalten haben, und beide
faende man sonst erst in den Daten:

* die zwei Ausloeser bleiben getrennt (nur `None` gegen auch `""`/`0`),
* und jedes Feld bekommt sein EIGENES leeres Gefaess, keine geteilte Liste.
"""
from pydantic import BaseModel, field_validator

from app.felder import ohne_leer, ohne_none


def test_ohne_none_faellt_nicht_auf_leeren_text_herein():
    f = ohne_none("")
    assert f(None) == ""
    assert f("") == ""
    assert f(0) == 0, "die 0 ist ein Wert, kein fehlender Eintrag"
    assert f(False) is False


def test_ohne_leer_kennt_seine_eigene_leere():
    assert ohne_leer(0)(None) == 0 and ohne_leer(0)("") == 0
    assert ohne_leer(0)(7) == 7
    # Variante mit der 0 als „nichts angegeben" (freie Tage im Kalender).
    assert ohne_leer(None, ("", 0))(0) is None
    assert ohne_leer(None, ("",))(0) == 0, "hier bleibt die 0 ein Wert"


def test_jedes_feld_bekommt_seine_eigene_liste():
    class M(BaseModel):
        items: list = []
        _leer = field_validator("items", mode="before")(ohne_none([]))

    a, b = M(items=None), M(items=None)
    a.items.append("x")
    assert b.items == [], "sonst teilen sich alle Datensaetze eine Liste"


def test_jedes_feld_bekommt_sein_eigenes_dict():
    class M(BaseModel):
        tt: dict = {}
        _leer = field_validator("tt", mode="before")(ohne_none({}))

    a, b = M(tt=None), M(tt=None)
    a.tt["mo"] = 1
    assert b.tt == {}
