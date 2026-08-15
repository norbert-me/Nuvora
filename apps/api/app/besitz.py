"""„Gehoert das dem angemeldeten Konto?" — an einer Stelle.

Ein Blatt: nur FastAPI, SQLAlchemy und die Modelle, kein Router. Deshalb darf
jeder Router von hier holen, ohne einen Importring zu bauen (wie `spalten.py`).

Vorher stand die Pruefung in jedem Router noch einmal: `_owned_class` fuenfmal
wortgleich, in einer zweiten Fassung noch zweimal, und „hol das Objekt,
vergleiche owner_id, sonst 404" ein rundes Dutzend Mal. Zusammengefuehrt ist
nur, was dieselbe Sache meint — die zwei Klassen-Fassungen bleiben zwei
Funktionen, weil sie sich im Statuscode unterscheiden.
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select

from .models import SchoolClass


async def klasse_oder_403(db, user, class_id) -> SchoolClass:
    """Klasse holen; fremde Klasse ist 403, unbekannte 404.

    Die nachsichtige Fassung: eine Klasse **ohne** owner_id (Bestand aus der
    Zeit vor der Mandantentrennung) gehoert allen und wird durchgelassen.
    Vorher wortgleich in zufall.py, orga.py, sitzplan.py, anwesenheit.py und
    klassenarbeit.py.
    """
    sc = await db.get(SchoolClass, class_id)
    if not sc:
        raise HTTPException(404, "Klasse nicht gefunden")
    if sc.owner_id and sc.owner_id != user.id:
        raise HTTPException(403, "Keine Berechtigung")
    return sc


async def eigene_klasse(db, user, class_id) -> SchoolClass:
    """Klasse holen; alles, was nicht dem Konto gehoert, ist 404.

    Die strenge Fassung: hier reicht „owner_id ist leer" **nicht**, und fremd
    ist nicht 403 sondern 404 — nach aussen soll nicht erkennbar sein, ob es
    die ID ueberhaupt gibt. Vorher wortgleich in karten.py und noten.py.

    Bewusst nicht mit `klasse_oder_403` zusammengelegt: der Statuscode ist Teil
    der Antwort, und beide Fassungen werden von Tests in ihrer Form geprueft.
    """
    cls = (await db.execute(select(SchoolClass).where(
        SchoolClass.id == class_id, SchoolClass.owner_id == user.id))).scalar_one_or_none()
    if not cls:
        raise HTTPException(404, "Klasse nicht gefunden")
    return cls


async def eigenes(db, model, obj_id, user, fehlt: str, *, weich: bool = False):
    """Einen Datensatz holen, der dem Konto gehoeren muss — sonst 404 `fehlt`.

    Stand in fast jedem Router als eigener `_owned_*`-Helfer (Arbeit, Abschnitt,
    Spalte, Kurs, Lernpfad, Ordner, Stapel, Punkt …); unterschieden haben sich
    die Kopien nur im Modell und im Meldungstext — jetzt Argumente.

    `weich=True` schliesst zusaetzlich aus, was im Papierkorb liegt.
    """
    obj = await db.get(model, obj_id)
    if obj is None or obj.owner_id != user.id:
        raise HTTPException(404, fehlt)
    if weich and getattr(obj, "deleted_at", None) is not None:
        raise HTTPException(404, fehlt)
    return obj


def kurs_oder_klasse(model, user, class_id, kurs_id):
    """WHERE-Bedingungen fuer „haengt am Kurs, sonst an der Klasse".

    Dieselbe Schluesselregel lag fuenfmal als eigenes `_key_where` herum
    (orga, sitzplan zweimal, klassenarbeit, noten) — unterschieden haben sich
    die Kopien nur im Modell. Ergebnis ist eine **unterschiedlich lange** Liste
    und wird darum immer per `*` entpackt.
    """
    if kurs_id is not None:
        return [model.owner_id == user.id, model.kurs_id == kurs_id]
    return [model.owner_id == user.id, model.class_id == class_id, model.kurs_id.is_(None)]
