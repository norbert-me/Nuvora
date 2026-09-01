"""Schuelerlisten: Reihenfolge und Roster an einer Stelle.

Ein Blatt wie `besitz.py`. Die Kurs-Mitgliedschaft kommt aus dem Blatt
`kursmitglieder.py` und wird **oben** importiert. Frueher stand sie im
Kurs-**Router**, und dieses Modul holte sie deshalb erst in der Funktion — ein
Importring, den nur genau dieser Import offenhielt.

Zusammengefuehrt: die **Sortierung** `(position, card_id, id)`, die rund
achtzehnmal ausgeschrieben dastand (keine Kosmetik — `card_id` ist die Nummer
der gedruckten ArUco-Karte, sortiert wird nach `position`), und der **kanonische
Kurs-Roster**, den klassenarbeit.py und results.py Zeile fuer Zeile gleich
hatten und noten.py mit einem zweiten Zweig davor.
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select

from .kursmitglieder import member_student_ids, sibling_class_ids
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


async def in_klasse(db, student_id, class_id) -> Student:
    """Das Kind holen — und nur, wenn es wirklich in dieser Klasse sitzt.

    Der Aufrufer hat die **Klasse** schon als seine geprueft; ohne diesen
    zweiten Schritt liesse sich ueber eine fremde `student_id` an einem eigenen
    Klassenpfad Anwesenheit, Losung oder Checkliste eines fremden Kindes
    schreiben. Stand wortgleich in `orga.py`, `zufall.py` und zweimal in
    `anwesenheit.py`.

    Absichtlich **nicht** kurs-weit: hier ist die Klasse gemeint, nicht die
    Lerngruppe. Wer die Geschwisterklassen mitmeinen will, nimmt
    `roster_klasse`.
    """
    st = await db.get(Student, student_id)
    if not st or st.class_id != class_id:
        raise HTTPException(404, "Schüler nicht in dieser Klasse")
    return st


async def sortiert(db, *bedingungen) -> list[Student]:
    """SuS zu beliebigen WHERE-Bedingungen, in der einen Reihenfolge."""
    return list((await db.execute(
        select(Student).where(*bedingungen).order_by(*SORTIERUNG))).scalars().all())


async def roster_klasse(db, class_id) -> list[Student]:
    """Kanonische SuS des Kurses ueber die Geschwisterklassen dieser Klasse."""
    sib = await sibling_class_ids(db, class_id)
    return kanonisch(await sortiert(db, Student.class_id.in_(sib)))


async def roster_kurs(db, kurs_id) -> list[Student]:
    """Kanonische SuS eines Kurses — inklusive der EINZELN hinzugefuegten
    (Kurse aus Teilen von Klassen)."""
    sids = list(await member_student_ids(db, kurs_id))
    if not sids:
        return []
    return kanonisch(await sortiert(db, Student.id.in_(sids)))


async def zeilen_der_person(db, name: str, class_ids) -> list[Student]:
    """Alle Zeilen EINER Person — ueber die Geschwisterklassen hinweg.

    Dieselbe Person steht in jeder ihrer Fach-Klassen als eigene Zeile. Was zur
    Person gehoert (E/G, Foerderschwerpunkte, Notizen), gehoert deshalb auf
    jede davon: sonst waere ein Kind in Mathe „E" und in Deutsch ohne Niveau,
    und niemand wuesste, welche Zeile stimmt. `_rows_of_person` in kurse.py
    macht dasselbe fuer die Kurs-Sicht; hier ist der Weg ueber die Klasse.
    """
    name = (name or "").strip()
    if not name or not class_ids:
        return []
    alle: set = set()
    for cid in class_ids:
        alle |= await sibling_class_ids(db, cid)
    rows = (await db.execute(select(Student).where(Student.class_id.in_(list(alle))))).scalars().all()
    return [s for s in rows if s.name.strip() == name]
