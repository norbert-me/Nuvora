"""Modul Notizblock — freie Notizzettel der Lehrkraft.

Eigenständig (Regel 3): eigene Tabelle, keine Bindung an Schüler/Klasse (das ist
das Modul Beobachtungen). Reine private Ablage — kein Export, kein Marktplatz.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# `eigenes` ersetzt hier den Dreizeiler „holen, owner_id vergleichen, sonst 404",
# der in jedem Router noch einmal stand — die Regel steht jetzt in app/besitz.py.
from ..besitz import eigenes
from ..database import get_db
from ..models import NotepadNote, User
from .modules import modul_pflicht

router = APIRouter(prefix="/api/notizblock", tags=["notizblock"])
MODULE_KEY = "notizbrett"


require_module = modul_pflicht(MODULE_KEY)


class NoteIn(BaseModel):
    title: str = ""
    content: str = ""


class NotePatch(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None


class ReorderIn(BaseModel):
    ids: List[int]


def _out(n: NotepadNote) -> dict:
    return {"id": n.id, "title": n.title or "", "content": n.content or "", "position": n.position,
            "updated_at": n.updated_at.isoformat() if n.updated_at else None}


@router.get("")
async def list_notes(user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(NotepadNote).where(NotepadNote.owner_id == user.id).order_by(NotepadNote.position, NotepadNote.id)
    )).scalars().all()
    return [_out(n) for n in rows]


@router.post("", status_code=201)
async def create_note(body: NoteIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    mn = (await db.execute(select(NotepadNote.position).where(NotepadNote.owner_id == user.id).order_by(NotepadNote.position).limit(1))).scalar_one_or_none()
    pos = (mn - 1) if mn is not None else 0
    n = NotepadNote(owner_id=user.id, title=(body.title or "").strip()[:200], content=body.content or "", position=pos)
    db.add(n)
    await db.commit()
    await db.refresh(n)
    return _out(n)


@router.put("/reorder", status_code=204)
async def reorder_notes(body: ReorderIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(NotepadNote).where(NotepadNote.owner_id == user.id, NotepadNote.id.in_(body.ids)))).scalars().all()
    by_id = {n.id: n for n in rows}
    for i, nid in enumerate(body.ids):
        n = by_id.get(nid)
        if n is not None:
            n.position = i
    await db.commit()


@router.put("/{note_id}")
async def update_note(note_id: int, body: NotePatch, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    n = await eigenes(db, NotepadNote, note_id, user, "Notiz nicht gefunden")
    if body.title is not None:
        n.title = body.title.strip()[:200]
    if body.content is not None:
        n.content = body.content
    await db.commit()
    await db.refresh(n)
    return _out(n)


@router.delete("/{note_id}", status_code=204)
async def delete_note(note_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    n = await eigenes(db, NotepadNote, note_id, user, "Notiz nicht gefunden")
    await db.delete(n)
    await db.commit()
