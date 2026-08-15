"""Vor-Validatoren fuer Pydantic: „fehlt" wird zu einem Wert.

Ein Blatt: nur Pydantic, sonst nichts.

Aeltere Dateien (Sicherungen, Importe) schreiben fehlende Werte als `null`, die
Oberflaeche schickt sie als leeren Text. Beides darf kein 422 sein, sondern
bekommt den Ersatzwert des Feldes. Genau dafuer stand in jedem Modell ein
eigener Dreizeiler — `_leer`, `_leer_text`, `_leer_zahl`, `_leer_liste`,
`_leer_tt` —, insgesamt ueber zwanzig davon.

**Zwei Ausloeser, bewusst zwei Fabriken.** Es gab beide Fassungen im Bestand:
manche Felder ersetzen nur `None`, andere auch den leeren Text. Zusammengelegt
haetten sie stillschweigend Verhalten geaendert — eine `0`, die vorher als
gueltige Eingabe durchging, waere zum Ersatzwert geworden.

Eingehaengt wird ohne `@classmethod`, weil hier nur der Wert geprueft wird:

    _leer_text = field_validator("title", mode="before")(ohne_none(""))
"""
from __future__ import annotations


def _frisch(ersatz):
    """Jeder Aufruf bekommt seine eigene Liste/sein eigenes Dict.

    Wichtig, nicht Kosmetik: die Dreizeiler schrieben `[] if v is None else v`
    und legten damit **je Aufruf** ein neues leeres Gefaess an. Gaebe die Fabrik
    stattdessen immer dasselbe Objekt heraus, teilten sich alle Datensaetze
    einer Sicherung eine Liste — und der erste, der sie fuellt, fuellt sie fuer
    alle.
    """
    return type(ersatz)(ersatz) if isinstance(ersatz, (list, dict, set)) else ersatz


def ohne_none(ersatz):
    """Vor-Validator: nur `None` wird zu `ersatz`."""
    def pruefe(v):
        return _frisch(ersatz) if v is None else v
    return pruefe


def ohne_leer(ersatz, leere=(None, "")):
    """Vor-Validator: alles aus `leere` wird zu `ersatz`.

    `leere` ist einstellbar, weil ein Feld im Bestand auch die `0` als „nichts
    angegeben" behandelt (Stundenzahl eines freien Tages).
    """
    def pruefe(v):
        return _frisch(ersatz) if v in leere else v
    return pruefe
