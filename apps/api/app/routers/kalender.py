"""Modul Kalender — Unterrichtsplanung.

Eigenstaendig (Regel 3): eigene Eintraege, aber Klassen und Themen kommen aus
dem Kern. Ein Eintrag kann optional an eine Klasse und ein Thema haengen; das
Thema ist ON DELETE SET NULL, damit das Loeschen eines Themas keinen Eintrag
mitreisst.
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import CalendarEntry, SchoolClass, Topic, User
from .auth import get_current_user, rate_limit
from .modules import is_active

router = APIRouter(prefix="/api/kalender", tags=["kalender"])
MODULE_KEY = "kalender"


async def require_module(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> User:
    if not await is_active(db, user.id, MODULE_KEY):
        raise HTTPException(403, "Modul Kalender ist nicht aktiviert")
    return user


async def _check_class(db: AsyncSession, user: User, class_id: Optional[int]) -> None:
    if class_id is None:
        return
    r = await db.execute(select(SchoolClass.id).where(SchoolClass.id == class_id, SchoolClass.owner_id == user.id))
    if not r.scalar_one_or_none():
        raise HTTPException(404, "Klasse nicht gefunden")


async def _check_topic(db: AsyncSession, user: User, topic_id: Optional[int]) -> None:
    if topic_id is None:
        return
    r = await db.execute(select(Topic.id).where(Topic.id == topic_id, Topic.owner_id == user.id))
    if not r.scalar_one_or_none():
        raise HTTPException(404, "Thema nicht gefunden")


class EntryIn(BaseModel):
    date: datetime
    title: str = ""
    notes: str = ""
    class_id: Optional[int] = None
    topic_id: Optional[int] = None


class EntryOut(EntryIn):
    id: int
    model_config = {"from_attributes": True}


@router.get("/entries", response_model=List[EntryOut])
async def list_entries(frm: Optional[datetime] = None, to: Optional[datetime] = None,
                       user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Eintraege, optional auf einen Zeitraum (frm..to) eingegrenzt."""
    q = select(CalendarEntry).where(CalendarEntry.owner_id == user.id)
    if frm is not None:
        q = q.where(CalendarEntry.date >= frm)
    if to is not None:
        q = q.where(CalendarEntry.date <= to)
    rows = (await db.execute(q.order_by(CalendarEntry.date))).scalars().all()
    return rows


@router.post("/entries", response_model=EntryOut, status_code=201)
async def create_entry(body: EntryIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("kalender_entry", f"u{user.id}", 300, 60, "Zu viele Eintraege. Bitte kurz warten.")
    await _check_class(db, user, body.class_id)
    await _check_topic(db, user, body.topic_id)
    e = CalendarEntry(owner_id=user.id, **body.model_dump())
    db.add(e)
    await db.commit()
    await db.refresh(e)
    return e


@router.put("/entries/{entry_id}", response_model=EntryOut)
async def update_entry(entry_id: int, body: EntryIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    e = await db.get(CalendarEntry, entry_id)
    if not e or e.owner_id != user.id:
        raise HTTPException(404, "Eintrag nicht gefunden")
    await _check_class(db, user, body.class_id)
    await _check_topic(db, user, body.topic_id)
    for k, v in body.model_dump().items():
        setattr(e, k, v)
    await db.commit()
    await db.refresh(e)
    return e


@router.delete("/entries/{entry_id}", status_code=204)
async def delete_entry(entry_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    e = await db.get(CalendarEntry, entry_id)
    if not e or e.owner_id != user.id:
        raise HTTPException(404, "Eintrag nicht gefunden")
    await db.delete(e)
    await db.commit()
