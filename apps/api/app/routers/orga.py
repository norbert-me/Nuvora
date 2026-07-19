"""Modul Orga — Sammel-/Orga-Checklisten je Klasse.

Eigenständig (Regel 3): Schüler kommen aus dem Kern, hier liegen nur die
Orga-Punkte und wer sie erledigt hat. Beispiel: „Unterschrift der Klassenarbeit
gesehen" — je Schüler abhaken.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import OrgaItem, SchoolClass, Student, User
from .auth import get_current_user, rate_limit
from .modules import is_active

router = APIRouter(prefix="/api/orga", tags=["orga"])
MODULE_KEY = "orga"


async def require_module(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> User:
    if not await is_active(db, user.id, MODULE_KEY):
        raise HTTPException(403, "Modul Orga ist nicht aktiviert")
    return user


async def _owned_class(db, user, class_id) -> SchoolClass:
    sc = await db.get(SchoolClass, class_id)
    if not sc:
        raise HTTPException(404, "Klasse nicht gefunden")
    if sc.owner_id and sc.owner_id != user.id:
        raise HTTPException(403, "Keine Berechtigung")
    return sc


async def _owned_item(db, user, item_id) -> OrgaItem:
    it = await db.get(OrgaItem, item_id)
    if not it or it.owner_id != user.id:
        raise HTTPException(404, "Punkt nicht gefunden")
    return it


class ItemIn(BaseModel):
    name: str


class ItemOut(BaseModel):
    id: int
    name: str
    position: int
    done: list = []
    model_config = {"from_attributes": True}


class ToggleIn(BaseModel):
    student_id: int


@router.get("/{class_id}", response_model=List[ItemOut])
async def list_items(class_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    rows = (await db.execute(select(OrgaItem).where(
        OrgaItem.class_id == class_id, OrgaItem.owner_id == user.id).order_by(OrgaItem.position, OrgaItem.id))).scalars().all()
    return rows


@router.post("/{class_id}", response_model=ItemOut, status_code=201)
async def create_item(class_id: int, body: ItemIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("orga", f"u{user.id}", 200, 60, "Zu viele Punkte. Bitte kurz warten.")
    await _owned_class(db, user, class_id)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Name darf nicht leer sein")
    pos = len((await db.execute(select(OrgaItem).where(OrgaItem.class_id == class_id, OrgaItem.owner_id == user.id))).scalars().all())
    it = OrgaItem(owner_id=user.id, class_id=class_id, name=name[:160], position=pos, done=[])
    db.add(it)
    await db.commit()
    await db.refresh(it)
    return it


@router.put("/item/{item_id}", response_model=ItemOut)
async def rename_item(item_id: int, body: ItemIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    it = await _owned_item(db, user, item_id)
    name = (body.name or "").strip()
    if name:
        it.name = name[:160]
    await db.commit()
    await db.refresh(it)
    return it


@router.delete("/item/{item_id}", status_code=204)
async def delete_item(item_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    it = await _owned_item(db, user, item_id)
    await db.delete(it)
    await db.commit()


@router.put("/item/{item_id}/toggle", response_model=ItemOut)
async def toggle(item_id: int, body: ToggleIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    it = await _owned_item(db, user, item_id)
    # Nur Schüler der Klasse zulassen.
    st = await db.get(Student, body.student_id)
    if not st or st.class_id != it.class_id:
        raise HTTPException(404, "Schüler nicht in dieser Klasse")
    done = list(it.done or [])
    if body.student_id in done:
        done.remove(body.student_id)
    else:
        done.append(body.student_id)
    it.done = done
    await db.commit()
    await db.refresh(it)
    return it
