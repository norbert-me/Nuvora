"""Kern-Sicht auf EIN Kind — ueber alle Kurse hinweg.

Das ist der Grund, warum es die Personen-Ebene gibt: „wie steht Anna da?" liess
sich bisher nur je Liste beantworten. In Mathe sah man die Mathe-Noten, in
Deutsch die Deutsch-Noten, und dass beides dasselbe Kind ist, wusste nur, wer
die Namen verglich.

Regel 3 gilt auch hier: jede Quelle wird einzeln gefragt (`is_active`), ein
fehlendes Modul laesst seinen Teil weg — es gibt kein 403 und keine leere
Seite, nur weniger Zeilen.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Kurs, KursTag, Person, SchoolClass, Student, User
from .auth import get_current_user
from .modules import is_active

router = APIRouter(prefix="/api/personen", tags=["personen"])


class PersonOut(BaseModel):
    id: int
    name: str
    niveau: str = ""
    kurse: List[str] = []
    has_photo: bool = False
    model_config = {"from_attributes": True}


async def _eigene(db: AsyncSession, person_id: int, user: User) -> Person:
    p = await db.get(Person, person_id)
    if not p or p.owner_id != user.id or p.deleted_at is not None:
        raise HTTPException(404, "Person nicht gefunden")
    return p


async def _zeilen(db: AsyncSession, person: Person) -> List[Student]:
    """Alle Listenzeilen dieser Person — die Bruecke zu allem Bestehenden.

    Noten, Karten-Fortschritt und Scans haengen weiter an `students`; solange
    das so ist, ist diese Liste der Weg von der Person zu ihren Daten.
    """
    return list((await db.execute(
        select(Student).where(Student.person_id == person.id))).scalars().all())


@router.get("", response_model=List[PersonOut])
async def list_personen(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Alle Kinder dieser Lehrkraft — einmal je Kind, nicht je Liste."""
    leute = (await db.execute(select(Person).where(
        Person.owner_id == user.id, Person.deleted_at.is_(None)
    ).order_by(Person.name))).scalars().all()
    if not leute:
        return []
    # Kurse je Person: ueber die Zeilen und deren Klassen. Zwei Wege fuehren
    # dorthin (Kurs an der Zeile, Kurs an der Klasse) — beide zaehlen, doppelt
    # zaehlt nichts.
    zeilen = (await db.execute(select(Student).where(
        Student.person_id.in_([p.id for p in leute])))).scalars().all()
    klassen = {c.id: c for c in (await db.execute(select(SchoolClass).where(
        SchoolClass.owner_id == user.id))).scalars().all()}
    kurse = {k.id: k for k in (await db.execute(select(Kurs).where(
        Kurs.owner_id == user.id, Kurs.deleted_at.is_(None)))).scalars().all()}
    je_person = {}
    for z in zeilen:
        namen = je_person.setdefault(z.person_id, [])
        for kid in (z.kurs_id, getattr(klassen.get(z.class_id), "kurs_id", None)):
            k = kurse.get(kid)
            if k and k.name not in namen:
                namen.append(k.name)
    return [PersonOut(id=p.id, name=p.name, niveau=p.niveau or "",
                      kurse=je_person.get(p.id, []), has_photo=p.has_photo) for p in leute]


@router.get("/{person_id}/photo")
async def photo(person_id: int, klein: bool = False,
                user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Das Foto der Person. Personenbezogen — nie in Export oder Marktplatz.

    Eigener Endpunkt statt des Umwegs ueber eine Listenzeile: das Bild gehoert
    dem Kind, nicht einer seiner Zugehoerigkeiten.
    """
    from fastapi import Response
    from sqlalchemy.orm import undefer

    p = (await db.execute(select(Person).where(Person.id == person_id)
                          .options(undefer(Person.photo), undefer(Person.photo_thumb)))).scalar_one_or_none()
    if not p or p.owner_id != user.id:
        raise HTTPException(404, "Person nicht gefunden")
    daten = (p.photo_thumb if klein and p.photo_thumb else p.photo)
    if not daten:
        raise HTTPException(404, "Kein Foto")
    return Response(content=daten, media_type=(("image/jpeg" if klein and p.photo_thumb else p.photo_mime) or "image/jpeg"),
                    headers={"Cache-Control": "private, max-age=300"})


@router.get("/{person_id}/auswertung")
async def auswertung(person_id: int, user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)):
    """Ein Kind quer ueber seine Kurse: Themenstand und Notenverlauf je Liste.

    Gerechnet wird NICHT hier — beides gibt es laengst (themenprofil,
    notenverlauf), und eine zweite Rechnung waere eine zweite Wahrheit. Diese
    Sicht sammelt nur ein.
    """
    person = await _eigene(db, person_id, user)
    zeilen = await _zeilen(db, person)
    klassen = {c.id: c for c in (await db.execute(select(SchoolClass).where(
        SchoolClass.owner_id == user.id))).scalars().all()}
    kurse = {k.id: k for k in (await db.execute(select(Kurs).where(
        Kurs.owner_id == user.id))).scalars().all()}

    aus = {"id": person.id, "name": person.name, "niveau": person.niveau or "", "teile": []}
    # Die Module werden EINMAL gefragt, nicht je Zeile.
    cardvote = await is_active(db, user.id, "cardvote")
    auswertung_an = await is_active(db, user.id, "auswertung")
    karten = await is_active(db, user.id, "karten")

    # Der Themenstand wird nicht nachgebaut, sondern geholt: dieselbe Rechnung
    # wie auf der Schuelerseite (results.themenprofil, Kern-Router). Eine
    # zweite Fassung waere eine zweite Wahrheit — derselbe Grund, aus dem
    # trash.py die Modul-Funktionen aufruft statt sie abzuschreiben.
    from .results import themenprofil as _themenstand
    for z in zeilen:
        kurs = kurse.get(z.kurs_id) or kurse.get(getattr(klassen.get(z.class_id), "kurs_id", None))
        teil = {"student_id": z.id, "class_id": z.class_id,
                "kurs": kurs.name if kurs else (getattr(klassen.get(z.class_id), "name", "") or ""),
                "themen": [], "verlauf": []}
        if cardvote or auswertung_an or karten:
            try:
                stand = await _themenstand(z.class_id, student_id=z.id, user=user, db=db)
                teil["themen"] = (stand or {}).get("themen") or (stand or {}).get("schueler") or []
            except Exception:
                teil["themen"] = []       # eine stumme Quelle darf die Sicht nicht kippen
        aus["teile"].append(teil)
    return aus
