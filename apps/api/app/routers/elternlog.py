"""Modul Elternkontakte — dokumentierte Kontakte je Schüler.

Eigenständig (Regel 3). Datum, Kanal (Telefon/Mail/Gespräch/Brief), Notiz.
Dokumentationspflicht; schützenswert — kein Export, kein Marktplatz.
"""
import re
from datetime import date as _date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import ParentContact, SchoolClass, Student, User
from .auth import get_current_user
from .modules import is_active

router = APIRouter(prefix="/api/elternlog", tags=["elternlog"])
MODULE_KEY = "elternlog"
_CHANNELS = {"telefon", "mail", "gespraech", "brief", "sonstiges"}


async def require_module(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> User:
    if not await is_active(db, user.id, MODULE_KEY):
        raise HTTPException(403, "Modul Elternkontakte ist nicht aktiviert")
    return user


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


def _clean_channel(v):
    c = (v or "").strip().lower()
    return c if c in _CHANNELS else ""


class ContactIn(BaseModel):
    student_id: int
    date: Optional[str] = None
    channel: Optional[str] = ""
    text: str = ""


class ContactPatch(BaseModel):
    date: Optional[str] = None
    channel: Optional[str] = None
    text: Optional[str] = None


def _out(c: ParentContact) -> dict:
    return {"id": c.id, "student_id": c.student_id,
            "date": c.date.isoformat() if c.date else None,
            "channel": c.channel or "", "text": c.text or "",
            "created_at": c.created_at.isoformat() if c.created_at else None}


@router.get("")
async def list_contacts(student_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_student(db, user, student_id)
    rows = (await db.execute(select(ParentContact).where(
        ParentContact.owner_id == user.id, ParentContact.student_id == student_id
    ).order_by(ParentContact.date.desc().nullslast(), ParentContact.id.desc()))).scalars().all()
    return [_out(c) for c in rows]


@router.post("", status_code=201)
async def create_contact(body: ContactIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_student(db, user, body.student_id)
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "Text fehlt")
    c = ParentContact(owner_id=user.id, student_id=body.student_id, date=_parse_date(body.date),
                      channel=_clean_channel(body.channel), text=text)
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return _out(c)


@router.put("/{contact_id}")
async def update_contact(contact_id: int, body: ContactPatch, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    c = await db.get(ParentContact, contact_id)
    if not c or c.owner_id != user.id:
        raise HTTPException(404, "Kontakt nicht gefunden")
    if body.text is not None:
        c.text = body.text.strip() or c.text
    if body.channel is not None:
        c.channel = _clean_channel(body.channel)
    if body.date is not None:
        c.date = _parse_date(body.date)
    await db.commit()
    await db.refresh(c)
    return _out(c)


@router.delete("/{contact_id}", status_code=204)
async def delete_contact(contact_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    c = await db.get(ParentContact, contact_id)
    if not c or c.owner_id != user.id:
        raise HTTPException(404, "Kontakt nicht gefunden")
    await db.delete(c)
    await db.commit()


@router.get("/counts")
async def counts(class_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    cls = await db.get(SchoolClass, class_id)
    if not cls or cls.owner_id != user.id:
        raise HTTPException(404, "Klasse nicht gefunden")
    sids = [s.id for s in (await db.execute(select(Student).where(Student.class_id == class_id))).scalars().all()]
    if not sids:
        return {}
    rows = (await db.execute(select(ParentContact.student_id).where(
        ParentContact.owner_id == user.id, ParentContact.student_id.in_(sids)))).scalars().all()
    out: dict = {}
    for sid in rows:
        out[str(sid)] = out.get(str(sid), 0) + 1
    return out
