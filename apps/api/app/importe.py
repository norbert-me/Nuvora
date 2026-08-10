"""Importdateien pruefen — eine Stelle fuer alle Import-Endpunkte.

Eine Importdatei kommt aus einem aelteren Nuvora-Stand oder wurde von Hand
bearbeitet. Frueher landete ein falsches Feld als roher Wert in der Datenbank
(``value=99`` als Note) oder riss den Aufruf mit ``int()``/``KeyError`` in einen
HTTP 500 — die Lehrkraft sah "Interner Serverfehler" und erfuhr nie, welches
Feld schuld war.

``geprueft`` schiebt die Datei durch ein Pydantic-Modell und uebersetzt einen
Validierungsfehler in **HTTP 400 mit Feldnamen**. Bewusst hier und nicht ueber
die Signatur des Endpunkts: FastAPI beantwortet ein Modell in der Signatur mit
422 und einer englischen Meldung — der Import soll dieselbe deutsche 400 geben
wie die uebrigen Fehler eines Import-Laufs.
"""
from typing import Type, TypeVar

from fastapi import HTTPException
from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)

# Pydantic meldet Typfehler auf Englisch. Die Lehrkraft soll lesen, was zu tun ist.
_TEXTE = {
    "missing": "fehlt",
    "int_parsing": "muss eine ganze Zahl sein",
    "int_type": "muss eine ganze Zahl sein",
    "int_from_float": "muss eine ganze Zahl sein",
    "float_parsing": "muss eine Zahl sein",
    "float_type": "muss eine Zahl sein",
    "decimal_parsing": "muss eine Zahl sein",
    "string_type": "muss Text sein",
    "bool_parsing": "muss wahr oder falsch sein",
    "bool_type": "muss wahr oder falsch sein",
    "list_type": "muss eine Liste sein",
    "dict_type": "muss ein Objekt sein",
    "model_type": "muss ein Objekt sein",
    "model_attributes_type": "muss ein Objekt sein",
    "datetime_parsing": "muss ein Datum sein",
    "datetime_type": "muss ein Datum sein",
    "datetime_from_date_parsing": "muss ein Datum sein",
    "json_invalid": "ist kein gueltiges JSON",
}


def _pfad(loc) -> str:
    """('entries', 3, 'value') -> 'entries[3].value'."""
    teile = []
    for p in loc:
        if isinstance(p, int):
            teile.append(f"[{p}]")
        elif p in ("__root__", "root"):
            continue
        else:
            teile.append(("." if teile else "") + str(p))
    return "".join(teile) or "Datei"


def _meldung(err: dict) -> str:
    msg = err.get("msg") or ""
    if err.get("type") == "value_error":
        # Eigene Validatoren melden schon auf Deutsch — Pydantic stellt nur
        # "Value error, " davor.
        return msg.split("Value error, ", 1)[-1]
    return _TEXTE.get(err.get("type", ""), msg)


def geprueft(model: Type[T], rohdaten, was: str = "Datei") -> T:
    """Rohdaten gegen das Modell pruefen. Fehler -> HTTP 400 mit Feldnamen."""
    try:
        return model.model_validate(rohdaten)
    except ValidationError as e:
        err = e.errors()[0]
        raise HTTPException(400, f"{was}: Feld „{_pfad(err['loc'])}“ — {_meldung(err)}")
