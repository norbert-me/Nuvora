"""Kurs-Mitgliedschaft: „welche Klassen, welche SuS, welche Geschwister?"

Ein Blatt wie `besitz.py` und `schueler.py`: nur SQLAlchemy, die Modelle und
`besitz` — **kein Router**. Deshalb darf jeder Router von hier oben holen.

Warum es dieses Modul gibt: die Antworten standen in `routers/kurse.py`, also in
einem Router. `schueler.py` (ein Blatt) brauchte sie ebenfalls und holte sie
darum **in** der Funktion — genau das Muster, das CLAUDE.md als Ringhalter
benennt. Der Ring war `schueler` → `routers.kurse` → `schueler`; ueber
`routers.kurse` → `routers.auth`/`routers.classes` haengten weitere daran
(sechs `py/cyclic-import`-Meldungen im Code Scanning). Die Mitgliedschaft ist
keine Sache des Kurs-Routers, sondern eine Frage an die Daten — hier
beantwortet, importiert der Router sie wie alle anderen auch.

`routers/kurse.py` bleibt die Adresse fuer die HTTP-Endpunkte und reicht diese
Namen weiter (`from ..kursmitglieder import …` oben), damit Aufrufer wie die
Tests `kurse.member_class_ids` weiter finden.
"""
from __future__ import annotations

import re

from sqlalchemy import select

from .besitz import eigenes
from .models import Kurs, KursStudent, KursTag, SchoolClass, Student

# Schuljahr aus einem Kursnamen lesen: "6.5 Mathematik (2025-2026)" -> "2025/26".
# Bestandskurse tragen es im Namen, weil es bisher kein Feld dafuer gab; der
# Backfill beim Start (main.py) fuellt daraus einmalig das Feld.
_JAHR = re.compile(r"(20\d{2})\s*[-/–]\s*(20\d{2}|\d{2})")


def schuljahr_aus_name(name: str) -> str:
    m = _JAHR.search(name or "")
    if not m:
        return ""
    von, bis = m.group(1), m.group(2)
    return f"{von}/{bis[-2:]}"


async def eigener_kurs(db, user, kurs_id) -> Kurs:
    """Kurs des angemeldeten Kontos, sonst 404.

    Hiess in `kurse.py` `_owned_kurs` und wurde von vier weiteren Routern per
    Funktions-Import geholt. Steht hier, weil „gehoert mir dieser Kurs?" keine
    Frage an einen Router ist.
    """
    return await eigenes(db, Kurs, kurs_id, user, "Kurs nicht gefunden")


async def member_class_ids(db, kurs_ids, mit_geloeschten=False) -> set:
    """Klassen-IDs, die Mitglied eines der Kurse sind (kurs_tags ∪ altes kurs_id).

    Klassen im Papierkorb zaehlen nicht mit: ihre SuS standen sonst weiter im
    Kurs-Roster (E/G-Liste, Massnahmen, Anwesenheit) und Schreibvorgaenge
    liefen in eine geloeschte Klasse. Die Mitgliedschaft selbst bleibt bestehen
    — wird die Klasse wiederhergestellt, ist sie wieder dabei."""
    if not kurs_ids:
        return set()
    kurs_ids = list(kurs_ids)
    a = (await db.execute(select(KursTag.class_id).where(KursTag.kurs_id.in_(kurs_ids)))).scalars().all()
    b = (await db.execute(select(SchoolClass.id).where(SchoolClass.kurs_id.in_(kurs_ids)))).scalars().all()
    ids = set(a) | set(b)
    if mit_geloeschten or not ids:
        return ids
    lebend = set((await db.execute(select(SchoolClass.id).where(
        SchoolClass.id.in_(list(ids)), SchoolClass.deleted_at.is_(None)))).scalars().all())
    return ids & lebend


async def member_student_ids(db, kurs_id) -> set:
    """Alle SuS-IDs eines Kurses: die aller Mitgliedsklassen UND die einzeln
    hinzugefügten (kurs_students). So funktionieren Kurse aus Teilen von Klassen."""
    classes = list(await member_class_ids(db, [kurs_id]))
    ids = set()
    if classes:
        ids |= set((await db.execute(select(Student.id).where(Student.class_id.in_(classes)))).scalars().all())
    einzeln = set((await db.execute(select(KursStudent.student_id).where(KursStudent.kurs_id == kurs_id))).scalars().all())
    if einzeln:  # nur solche, deren Klasse nicht im Papierkorb liegt
        einzeln &= set((await db.execute(
            select(Student.id).join(SchoolClass, Student.class_id == SchoolClass.id)
            .where(Student.id.in_(list(einzeln)), SchoolClass.deleted_at.is_(None))
        )).scalars().all())
    return ids | einzeln


async def class_kurs_ids(db, class_id, only_active=True) -> set:
    """Kurse (nicht gelöscht), in denen die Klasse Mitglied ist (kurs_tags ∪ kurs_id)."""
    ids = set((await db.execute(select(KursTag.kurs_id).where(KursTag.class_id == class_id))).scalars().all())
    sc = await db.get(SchoolClass, class_id)
    if sc and sc.kurs_id:
        ids.add(sc.kurs_id)
    if only_active and ids:
        alive = set((await db.execute(select(Kurs.id).where(Kurs.id.in_(list(ids)), Kurs.deleted_at.is_(None)))).scalars().all())
        return ids & alive
    return ids


async def student_kurs_ids(db, student_id, only_active=True) -> set:
    """Teilkurse (kurs_students), in denen dieser SuS EINZELN Mitglied ist —
    Kurse aus Teilen von Klassen, unabhängig von der Klassen-Zugehörigkeit."""
    ids = set((await db.execute(select(KursStudent.kurs_id).where(KursStudent.student_id == student_id))).scalars().all())
    if only_active and ids:
        alive = set((await db.execute(select(Kurs.id).where(Kurs.id.in_(list(ids)), Kurs.deleted_at.is_(None)))).scalars().all())
        return ids & alive
    return ids


async def sibling_class_ids(db, class_id) -> set:
    """Alle Klassen, die mit dieser einen Kurs teilen (inkl. sich selbst)."""
    kurse = await class_kurs_ids(db, class_id)
    ids = await member_class_ids(db, kurse)
    ids.add(class_id)
    return ids
