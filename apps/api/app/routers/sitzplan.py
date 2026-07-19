"""Modul Sitzplan — ein Rasterlayout je Klasse auf dem Nuvora-Kern.

Eigenstaendig (Regel 3): speichert nur Positionen (Schueler bleiben im Kern).
`data` = { "cols": int, "cells": [studentId|null, ...] }.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import SchoolClass, SeatingPlan, User
from .auth import get_current_user, rate_limit
from .modules import is_active

router = APIRouter(prefix="/api/sitzplan", tags=["sitzplan"])
MODULE_KEY = "sitzplan"


async def require_module(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> User:
    if not await is_active(db, user.id, MODULE_KEY):
        raise HTTPException(403, "Modul Sitzplan ist nicht aktiviert")
    return user


async def _owned_class(db: AsyncSession, user: User, class_id: int) -> SchoolClass:
    sc = await db.get(SchoolClass, class_id)
    if not sc:
        raise HTTPException(404, "Klasse nicht gefunden")
    if sc.owner_id and sc.owner_id != user.id:
        raise HTTPException(403, "Keine Berechtigung")
    return sc


class PlanIn(BaseModel):
    cols: int = 6
    cells: list = []  # [studentId|null, ...]


@router.get("/{class_id}")
async def get_plan(class_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    row = (await db.execute(
        select(SeatingPlan).where(SeatingPlan.owner_id == user.id, SeatingPlan.class_id == class_id)
    )).scalar_one_or_none()
    return row.data if row and row.data else {"cols": 6, "cells": []}


@router.put("/{class_id}")
async def put_plan(class_id: int, body: PlanIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("sitzplan", f"u{user.id}", 300, 60, "Zu viele Änderungen. Bitte kurz warten.")
    await _owned_class(db, user, class_id)
    cols = max(1, min(20, int(body.cols)))
    # Nur echte IDs oder None uebernehmen; Laenge begrenzen.
    cells = [(int(c) if isinstance(c, (int, float)) else None) for c in (body.cells or [])][:400]
    data = {"cols": cols, "cells": cells}
    row = (await db.execute(
        select(SeatingPlan).where(SeatingPlan.owner_id == user.id, SeatingPlan.class_id == class_id)
    )).scalar_one_or_none()
    if row:
        row.data = data
    else:
        db.add(SeatingPlan(owner_id=user.id, class_id=class_id, data=data))
    await db.commit()
    return data
