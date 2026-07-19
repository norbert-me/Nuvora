"""Kurse (Lerngruppen) — Phase 1: Fach-Klassen zu einem Kurs gruppieren.

Ein Kurs bündelt Fach-Klassen, die dieselbe Lerngruppe unterrichten (Mathe 7.5,
Lernzeit 7.5). Phase 1 verwaltet nur die Zuordnung Klasse↔Kurs; das Teilen von
Schülerliste und Anwesenheit über den Kurs kommt in Phase 2.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Kurs, SchoolClass, Student, User
from .auth import get_current_user

router = APIRouter(prefix="/api/kurse", tags=["kurse"])


class KursIn(BaseModel):
    name: str


class ClassRef(BaseModel):
    id: int
    name: str


class KursOut(BaseModel):
    id: int
    name: str
    classes: List[ClassRef] = []


async def _owned_kurs(db, user, kurs_id) -> Kurs:
    k = await db.get(Kurs, kurs_id)
    if not k or k.owner_id != user.id:
        raise HTTPException(404, "Kurs nicht gefunden")
    return k


@router.get("", response_model=List[KursOut])
async def list_kurse(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    kurse = (await db.execute(select(Kurs).where(Kurs.owner_id == user.id).order_by(Kurs.name))).scalars().all()
    classes = (await db.execute(select(SchoolClass).where(
        SchoolClass.owner_id == user.id, SchoolClass.deleted_at.is_(None)))).scalars().all()
    by_kurs = {}
    for c in classes:
        by_kurs.setdefault(c.kurs_id, []).append(ClassRef(id=c.id, name=c.name))
    return [KursOut(id=k.id, name=k.name, classes=by_kurs.get(k.id, [])) for k in kurse]


@router.post("", response_model=KursOut, status_code=201)
async def create_kurs(body: KursIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Name darf nicht leer sein")
    k = Kurs(owner_id=user.id, name=name[:100])
    db.add(k)
    await db.commit()
    await db.refresh(k)
    return KursOut(id=k.id, name=k.name, classes=[])


@router.put("/{kurs_id}", response_model=KursOut)
async def rename_kurs(kurs_id: int, body: KursIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    k = await _owned_kurs(db, user, kurs_id)
    name = (body.name or "").strip()
    if name:
        k.name = name[:100]
    await db.commit()
    return KursOut(id=k.id, name=k.name, classes=[])


async def _own_class(db, user, class_id) -> SchoolClass:
    c = await db.get(SchoolClass, class_id)
    if not c or (c.owner_id and c.owner_id != user.id):
        raise HTTPException(404, "Klasse nicht gefunden")
    return c


@router.post("/{kurs_id}/classes/{class_id}", status_code=204)
async def assign_class(kurs_id: int, class_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Klasse diesem Kurs zuordnen (in die Lerngruppe aufnehmen)."""
    await _owned_kurs(db, user, kurs_id)
    c = await _own_class(db, user, class_id)
    c.kurs_id = kurs_id
    # Schüler der Klasse in den Kurs übernehmen (geteilte Anwesenheit).
    await db.execute(update(Student).where(Student.class_id == class_id).values(kurs_id=kurs_id))
    await db.commit()


@router.delete("/classes/{class_id}", status_code=204)
async def unlink_class(class_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Klasse aus ihrem Kurs lösen — sie bekommt wieder einen eigenen Kurs."""
    c = await _own_class(db, user, class_id)
    k = Kurs(owner_id=user.id, name=c.name)
    db.add(k)
    await db.flush()
    c.kurs_id = k.id
    await db.execute(update(Student).where(Student.class_id == class_id).values(kurs_id=k.id))
    await db.commit()
