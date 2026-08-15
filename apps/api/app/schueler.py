"""Schuelerlisten: Reihenfolge und Roster an einer Stelle.

Ein Blatt wie `besitz.py`. Den Kurs-Router holt es erst **in** der Funktion,
weil `kurse.py` selbst Router ist und der Import oben ein Ring waere — genau so
machten es vorher die Aufrufer, jeder fuer sich.

Zusammengefuehrt: die **Sortierung** `(position, card_id, id)`, die rund
achtzehnmal ausgeschrieben dastand (keine Kosmetik — `card_id` ist die Nummer
der gedruckten ArUco-Karte, sortiert wird nach `position`), und der **kanonische
Kurs-Roster**, den klassenarbeit.py und results.py Zeile fuer Zeile gleich
hatten und noten.py mit einem zweiten Zweig davor.
"""
from __future__ import annotations

from sqlalchemy import select

from .models import Student

# Die eine Reihenfolge. Immer per * entpackt: `order_by(*SORTIERUNG)`.
SORTIERUNG = (Student.position, Student.card_id, Student.id)


def _sortschluessel(s: Student):
    return (s.position or 0, s.card_id, s.id)


def kanonisch(studs) -> list[Student]:
    """Gleichnamige SuS aus Fach-Klassen desselben Kurses zu einer Person.

    Dieselbe Person steht in mehreren Fach-Klassen als eigene Zeile; fuer eine
    Namensliste ist sie einmal gemeint. Es gewinnt der erste Treffer in der
    sortierten Liste, danach wird erneut sortiert (die Auswahl per dict haelt
    die Reihenfolge nicht zu).
    """
    canon: dict[str, Student] = {}
    for s in studs:
        canon.setdefault(s.name.strip(), s)
    return sorted(canon.values(), key=_sortschluessel)


async def sortiert(db, *bedingungen) -> list[Student]:
    """SuS zu beliebigen WHERE-Bedingungen, in der einen Reihenfolge."""
    return list((await db.execute(
        select(Student).where(*bedingungen).order_by(*SORTIERUNG))).scalars().all())


async def roster_klasse(db, class_id) -> list[Student]:
    """Kanonische SuS des Kurses ueber die Geschwisterklassen dieser Klasse."""
    from .routers.kurse import sibling_class_ids
    sib = await sibling_class_ids(db, class_id)
    return kanonisch(await sortiert(db, Student.class_id.in_(sib)))


async def roster_kurs(db, kurs_id) -> list[Student]:
    """Kanonische SuS eines Kurses — inklusive der EINZELN hinzugefuegten
    (Kurse aus Teilen von Klassen)."""
    from .routers.kurse import member_student_ids
    sids = list(await member_student_ids(db, kurs_id))
    if not sids:
        return []
    return kanonisch(await sortiert(db, Student.id.in_(sids)))
