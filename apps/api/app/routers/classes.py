from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import SchoolClass, Student, User
from .auth import get_current_user, rate_limit

router = APIRouter(prefix="/api/classes", tags=["classes"])


# Feste Auswahl statt Freitext: die Werte steuern spaeter die Differenzierung
# in Lernpfad — Tippfehler wuerden dort still zu einer eigenen Kategorie.
FOERDER_VALUES = {
    "LRS", "Dyskalkulie", "DaZ", "Lernen", "Sprache", "Hoeren", "Sehen",
    "Motorik", "Sozial-Emotional", "Konzentration", "Lesen",
    "Auditive Wahrnehmung",
}


class StudentIn(BaseModel):
    card_id: int
    name: str
    # Angaben zur Person (siehe Student in models.py). foerder und notizen sind
    # besonders schuetzenswert (DSGVO Art. 9) — nie veroeffentlichen.
    niveau: str = ""
    foerder: Optional[List[str]] = None
    notizen: str = ""

    @field_validator("niveau")
    @classmethod
    def valid_niveau(cls, v: str) -> str:
        if v not in ("", "E", "G"):
            raise ValueError("Niveau muss E, G oder leer sein")
        return v

    @field_validator("foerder")
    @classmethod
    def valid_foerder(cls, v):
        if v is None:
            return v
        unknown = set(v) - FOERDER_VALUES
        if unknown:
            raise ValueError(f"Unbekannter Foerderschwerpunkt: {', '.join(sorted(unknown))}")
        return v

    @field_validator("notizen")
    @classmethod
    def notizen_len(cls, v: str) -> str:
        if len(v) > 2000:
            raise ValueError("Notiz zu lang (max. 2000 Zeichen)")
        return v


class StudentOut(BaseModel):
    id: int
    card_id: int
    name: str
    niveau: str = ""
    foerder: Optional[List[str]] = None
    notizen: str = ""
    model_config = {"from_attributes": True}


class ClassCreate(BaseModel):
    name: str
    students: List[StudentIn] = []

    @field_validator("students")
    @classmethod
    def limit_students(cls, v):
        if len(v) > 60:
            raise ValueError("Zu viele Lernende (max. 60 pro Klasse)")
        return v

    @field_validator("name")
    @classmethod
    def name_len(cls, v):
        if len(v) > 100:
            raise ValueError("Klassenname zu lang")
        return v


class ClassOut(BaseModel):
    id: int
    name: str
    students: List[StudentOut] = []
    model_config = {"from_attributes": True}


@router.post("", response_model=ClassOut, status_code=201)
async def create_class(body: ClassCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rate_limit("cls_create", f"u{user.id}", 30, 60, "Zu viele Klassen in kurzer Zeit. Bitte kurz warten.")
    sc = SchoolClass(name=body.name, owner_id=user.id)
    db.add(sc)
    await db.flush()
    for s in body.students:
        db.add(Student(card_id=s.card_id, name=s.name, class_id=sc.id,
                       niveau=s.niveau, foerder=s.foerder, notizen=s.notizen))
    await db.commit()
    return await _load_class(db, sc.id)


@router.get("", response_model=List[ClassOut])
async def list_classes(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(SchoolClass)
        .options(selectinload(SchoolClass.students))
        .where((SchoolClass.owner_id == user.id) | (SchoolClass.owner_id.is_(None)))
        .order_by(SchoolClass.name)
    )
    return result.scalars().all()


@router.get("/{class_id}", response_model=ClassOut)
async def get_class(class_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    sc = await _load_class(db, class_id)
    if not sc:
        raise HTTPException(404)
    if sc.owner_id and sc.owner_id != user.id:
        raise HTTPException(403)
    return sc


@router.put("/{class_id}", response_model=ClassOut)
async def update_class(class_id: int, body: ClassCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    sc = await db.get(SchoolClass, class_id)
    if not sc:
        raise HTTPException(404)
    if sc.owner_id and sc.owner_id != user.id:
        raise HTTPException(403, "Keine Berechtigung")
    sc.name = body.name
    if not sc.owner_id:
        sc.owner_id = user.id

    existing = await db.execute(select(Student).where(Student.class_id == class_id))
    for s in existing.scalars().all():
        await db.delete(s)

    for s in body.students:
        db.add(Student(card_id=s.card_id, name=s.name, class_id=class_id,
                       niveau=s.niveau, foerder=s.foerder, notizen=s.notizen))

    await db.commit()
    return await _load_class(db, class_id)


@router.delete("/{class_id}", status_code=204)
async def delete_class(class_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    sc = await db.get(SchoolClass, class_id)
    if not sc:
        raise HTTPException(404)
    if sc.owner_id and sc.owner_id != user.id:
        raise HTTPException(403, "Keine Berechtigung")
    await db.delete(sc)
    await db.commit()


async def _load_class(db: AsyncSession, class_id: int) -> Optional[SchoolClass]:
    result = await db.execute(
        select(SchoolClass).options(selectinload(SchoolClass.students)).where(SchoolClass.id == class_id)
    )
    return result.scalar_one_or_none()
