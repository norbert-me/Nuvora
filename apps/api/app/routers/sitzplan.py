"""Modul Sitzplan — ein Rasterlayout je Klasse auf dem Nuvora-Kern.

Eigenstaendig (Regel 3): speichert nur Positionen (Schueler bleiben im Kern).
`data` = { "cols": int, "cells": [studentId|null, ...] }.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import SchoolClass, SeatingPlan, User
from .auth import get_current_user, rate_limit
from .modules import is_active

router = APIRouter(prefix="/api/sitzplan", tags=["sitzplan"])
# Sitzplan lebt jetzt als Tab im Modul „Orga" — daher über orga gegated.
MODULE_KEY = "orga"


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
    # Freie Flaeche: Sitze als {sid, x, y, rot}. (Alt: cols/cells-Raster.)
    seats: list = []
    # Bewegliche Tafel als {x, y, rot}. Optional.
    tafel: Optional[dict] = None


def _key_where(user, class_id, kurs_id):
    """Sitzplan haengt am Kurs (Fach). kurs_id gesetzt = je Kurs; sonst
    Fallback auf die Klasse (ohne Kurs)."""
    if kurs_id is not None:
        return (SeatingPlan.owner_id == user.id, SeatingPlan.kurs_id == kurs_id)
    return (SeatingPlan.owner_id == user.id, SeatingPlan.class_id == class_id, SeatingPlan.kurs_id.is_(None))


@router.get("/{class_id}")
async def get_plan(class_id: int, kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    row = (await db.execute(select(SeatingPlan).where(*_key_where(user, class_id, kurs_id)))).scalar_one_or_none()
    return row.data if row and row.data else {"seats": []}


def _num(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


@router.put("/{class_id}")
async def put_plan(class_id: int, body: PlanIn, kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("sitzplan", f"u{user.id}", 300, 60, "Zu viele Änderungen. Bitte kurz warten.")
    await _owned_class(db, user, class_id)
    seats = []
    for s in (body.seats or [])[:400]:
        if not isinstance(s, dict) or not isinstance(s.get("sid"), (int, float)):
            continue
        seats.append({
            "sid": int(s["sid"]),
            "x": round(_num(s.get("x")), 1),
            "y": round(_num(s.get("y")), 1),
            "rot": round(_num(s.get("rot")), 1),
        })
    data = {"seats": seats}
    if isinstance(body.tafel, dict):
        data["tafel"] = {"x": round(_num(body.tafel.get("x")), 1), "y": round(_num(body.tafel.get("y")), 1),
                         "rot": round(_num(body.tafel.get("rot")), 1)}
    row = (await db.execute(select(SeatingPlan).where(*_key_where(user, class_id, kurs_id)))).scalar_one_or_none()
    if row:
        row.data = data
    else:
        db.add(SeatingPlan(owner_id=user.id, class_id=class_id, kurs_id=kurs_id, data=data))
    await db.commit()
    return data
