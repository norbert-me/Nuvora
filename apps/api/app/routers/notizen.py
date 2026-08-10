"""Modul Beobachtungen — formative Notizen je Schüler.

Eigenständig (Regel 3). Bewusst getrennt von der Note: hier stehen Beobachtungen
(Anstrengung, Sozialverhalten, Fortschritt), die NIE als Messwert zählen. Wie
foerder/notizen im Kern sind diese Daten schützenswert — kein Export, kein Markt.
"""
import re
from datetime import date as _date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Observation, SchoolClass, Student, User
from .modules import modul_pflicht

router = APIRouter(prefix="/api/notizen", tags=["notizen"])
MODULE_KEY = "notizen"


require_module = modul_pflicht(MODULE_KEY)


async def _owned_student(db: AsyncSession, user: User, student_id: int) -> Student:
    s = await db.get(Student, student_id)
    if s is None:
        raise HTTPException(404, "Schüler nicht gefunden")
    cls = await db.get(SchoolClass, s.class_id)
    if cls is None or cls.owner_id != user.id:
        raise HTTPException(404, "Schüler nicht gefunden")
    return s


def _parse_date(v):
    if not v:
        return None
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v.strip()):
        raise HTTPException(400, "Ungültiges Datum (YYYY-MM-DD)")
    y, m, d = v.strip().split("-")
    return _date(int(y), int(m), int(d))


class ObsIn(BaseModel):
    student_id: int
    date: Optional[str] = None
    category: Optional[str] = ""
    text: str = ""


class ObsPatch(BaseModel):
    date: Optional[str] = None
    category: Optional[str] = None
    text: Optional[str] = None


def _out(o: Observation) -> dict:
    return {"id": o.id, "student_id": o.student_id,
            "date": o.date.isoformat() if o.date else None,
            "category": o.category or "", "text": o.text or "",
            "created_at": o.created_at.isoformat() if o.created_at else None}


@router.get("")
async def list_observations(student_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_student(db, user, student_id)
    rows = (await db.execute(select(Observation).where(
        Observation.owner_id == user.id, Observation.student_id == student_id
    ).order_by(Observation.date.desc().nullslast(), Observation.id.desc()))).scalars().all()
    return [_out(o) for o in rows]


@router.post("", status_code=201)
async def create_observation(body: ObsIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_student(db, user, body.student_id)
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "Text fehlt")
    o = Observation(owner_id=user.id, student_id=body.student_id, date=_parse_date(body.date),
                    category=(body.category or "").strip()[:60], text=text)
    db.add(o)
    await db.commit()
    await db.refresh(o)
    return _out(o)


@router.put("/{obs_id}")
async def update_observation(obs_id: int, body: ObsPatch, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    o = await db.get(Observation, obs_id)
    if not o or o.owner_id != user.id:
        raise HTTPException(404, "Notiz nicht gefunden")
    if body.text is not None:
        o.text = body.text.strip() or o.text
    if body.category is not None:
        o.category = body.category.strip()[:60]
    if body.date is not None:
        o.date = _parse_date(body.date)
    await db.commit()
    await db.refresh(o)
    return _out(o)


@router.delete("/{obs_id}", status_code=204)
async def delete_observation(obs_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    o = await db.get(Observation, obs_id)
    if not o or o.owner_id != user.id:
        raise HTTPException(404, "Notiz nicht gefunden")
    await db.delete(o)
    await db.commit()


@router.get("/counts")
async def counts(class_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Anzahl Beobachtungen je Schüler der Klasse (für die Übersicht)."""
    cls = await db.get(SchoolClass, class_id)
    if not cls or cls.owner_id != user.id:
        raise HTTPException(404, "Klasse nicht gefunden")
    sids = [s.id for s in (await db.execute(select(Student).where(Student.class_id == class_id))).scalars().all()]
    if not sids:
        return {}
    rows = (await db.execute(select(Observation.student_id).where(
        Observation.owner_id == user.id, Observation.student_id.in_(sids)))).scalars().all()
    out: dict = {}
    for sid in rows:
        out[str(sid)] = out.get(str(sid), 0) + 1
    return out
