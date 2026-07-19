"""Modul Anwesenheit — Anwesenheit/Fehlzeiten je Klasse und Datum.

Eigenstaendig (Regel 3): Schueler kommen aus dem Kern, hier liegt nur der
Status je (Schueler, Datum). status: da | fehlt | spaet | entsch.
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Attendance, SchoolClass, Student, User
from .auth import get_current_user, rate_limit
from .modules import is_active

router = APIRouter(prefix="/api/anwesenheit", tags=["anwesenheit"])
MODULE_KEY = "anwesenheit"
_STATUS = {"da", "fehlt", "spaet", "entsch"}


async def require_module(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> User:
    if not await is_active(db, user.id, MODULE_KEY):
        raise HTTPException(403, "Modul Anwesenheit ist nicht aktiviert")
    return user


async def _owned_class(db: AsyncSession, user: User, class_id: int) -> SchoolClass:
    sc = await db.get(SchoolClass, class_id)
    if not sc:
        raise HTTPException(404, "Klasse nicht gefunden")
    if sc.owner_id and sc.owner_id != user.id:
        raise HTTPException(403, "Keine Berechtigung")
    return sc


def _day_bounds(d: datetime):
    start = d.replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start.replace(hour=23, minute=59, second=59)


@router.get("/{class_id}")
async def get_day(class_id: int, date: datetime, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Status je Schueler an einem Tag: { student_id: {status, note} }."""
    await _owned_class(db, user, class_id)
    lo, hi = _day_bounds(date)
    rows = (await db.execute(select(Attendance).where(
        Attendance.class_id == class_id, Attendance.owner_id == user.id,
        Attendance.date >= lo, Attendance.date <= hi,
    ))).scalars().all()
    return {str(r.student_id): {"status": r.status, "note": r.note} for r in rows}


class MarkIn(BaseModel):
    student_id: int
    date: datetime
    status: str
    note: str = ""


@router.put("/{class_id}")
async def mark(class_id: int, body: MarkIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("anwesenheit", f"u{user.id}", 600, 60, "Zu viele Änderungen. Bitte kurz warten.")
    await _owned_class(db, user, class_id)
    if body.status not in _STATUS:
        raise HTTPException(400, "Unbekannter Status")
    st = await db.get(Student, body.student_id)
    if not st or st.class_id != class_id:
        raise HTTPException(404, "Schüler nicht in dieser Klasse")
    lo, hi = _day_bounds(body.date)
    row = (await db.execute(select(Attendance).where(
        Attendance.student_id == body.student_id, Attendance.date >= lo, Attendance.date <= hi,
    ))).scalar_one_or_none()
    # "da" ist der Normalfall: kein Eintrag noetig -> vorhandenen loeschen.
    if body.status == "da" and not body.note.strip():
        if row:
            await db.delete(row)
        await db.commit()
        return {"ok": True}
    if row:
        row.status = body.status
        row.note = body.note.strip()[:500]
    else:
        db.add(Attendance(owner_id=user.id, class_id=class_id, student_id=body.student_id,
                          date=lo, status=body.status, note=body.note.strip()[:500]))
    await db.commit()
    return {"ok": True}


@router.get("/{class_id}/summary")
async def summary(class_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Zusammenfassung je Schueler: Zaehler fehlt/spaet/entsch (ueber alles)."""
    await _owned_class(db, user, class_id)
    rows = (await db.execute(select(Attendance).where(
        Attendance.class_id == class_id, Attendance.owner_id == user.id,
    ))).scalars().all()
    agg: dict = {}
    for r in rows:
        a = agg.setdefault(str(r.student_id), {"fehlt": 0, "spaet": 0, "entsch": 0})
        if r.status in a:
            a[r.status] += 1
    return agg
