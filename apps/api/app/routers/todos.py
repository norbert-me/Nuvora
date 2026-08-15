"""Modul To-do — einfache Aufgabenliste der Lehrkraft.

Eigenstaendig (Regel 3): eigene Tabelle, keine Abhaengigkeit zu anderen Modulen.
Ein Eintrag kann ein Datum (und optional eine Uhrzeit) tragen; solche Eintraege
liefert `calendar` an das Kalender-Modul, das sie mit anzeigt — reine Zusatz-
Bruecke. Ohne Kalender funktioniert die Liste voll, ohne To-do der Kalender.
"""
import re
from datetime import date as _date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# `eigenes` ersetzt hier den Dreizeiler „holen, owner_id vergleichen, sonst 404",
# der in jedem Router noch einmal stand — die Regel steht jetzt in app/besitz.py.
from ..besitz import eigenes
from ..database import get_db
from ..models import Todo, User
from .modules import modul_pflicht

router = APIRouter(prefix="/api/todo", tags=["todo"])
MODULE_KEY = "notizbrett"


require_module = modul_pflicht(MODULE_KEY)


class TodoIn(BaseModel):
    text: str = ""
    due_date: Optional[str] = None   # "YYYY-MM-DD" oder "" / None
    due_time: Optional[str] = None   # "HH:MM" oder "" / None


class TodoPatch(BaseModel):
    text: Optional[str] = None
    done: Optional[bool] = None
    due_date: Optional[str] = None   # "" leert das Datum; None = unveraendert
    due_time: Optional[str] = None


class TodoOut(BaseModel):
    id: int
    text: str
    done: bool
    due_date: Optional[str] = None
    due_time: str = ""
    position: int = 0
    model_config = {"from_attributes": True}


def _parse_date(v):
    if not v:
        return None
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", v.strip())
    if not m:
        raise HTTPException(400, "Ungueltiges Datum (YYYY-MM-DD)")
    return _date(int(m[1]), int(m[2]), int(m[3]))


def _clean_time(v):
    if not v:
        return ""
    t = v.strip()
    if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", t):
        raise HTTPException(400, "Ungueltige Uhrzeit (HH:MM)")
    return t


def _out(t: Todo) -> dict:
    return {"id": t.id, "text": t.text, "done": t.done,
            "due_date": t.due_date.isoformat() if t.due_date else None,
            "due_time": t.due_time or "", "position": t.position}


@router.get("", response_model=List[TodoOut])
async def list_todos(user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Todo).where(Todo.owner_id == user.id).order_by(Todo.done, Todo.position, Todo.id)
    )).scalars().all()
    return [_out(t) for t in rows]


@router.post("", response_model=TodoOut, status_code=201)
async def create_todo(body: TodoIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    text = (body.text or "").strip()[:500]
    if not text:
        raise HTTPException(400, "Text fehlt")
    d = _parse_date(body.due_date)
    tm = _clean_time(body.due_time) if d else ""  # Uhrzeit nur mit Datum sinnvoll
    # Neue Eintraege oben (kleinste Position).
    mn = (await db.execute(select(Todo.position).where(Todo.owner_id == user.id).order_by(Todo.position).limit(1))).scalar_one_or_none()
    pos = (mn - 1) if mn is not None else 0
    t = Todo(owner_id=user.id, text=text, due_date=d, due_time=tm, position=pos)
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return _out(t)


class ReorderIn(BaseModel):
    ids: List[int]  # neue Reihenfolge (nur offene To-dos)


@router.put("/reorder", status_code=204)
async def reorder_todos(body: ReorderIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Reihenfolge setzen (position nach Listenindex). Vor /{todo_id} definiert,
    damit „reorder" nicht als todo_id interpretiert wird."""
    rows = (await db.execute(select(Todo).where(Todo.owner_id == user.id, Todo.id.in_(body.ids)))).scalars().all()
    by_id = {t.id: t for t in rows}
    for i, tid in enumerate(body.ids):
        t = by_id.get(tid)
        if t is not None:
            t.position = i
    await db.commit()


@router.put("/{todo_id}", response_model=TodoOut)
async def update_todo(todo_id: int, body: TodoPatch, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    t = await eigenes(db, Todo, todo_id, user, "To-do nicht gefunden")
    if body.text is not None:
        t.text = body.text.strip()[:500] or t.text
    if body.done is not None:
        t.done = body.done
    if body.due_date is not None:
        t.due_date = _parse_date(body.due_date)
        if t.due_date is None:
            t.due_time = ""  # ohne Datum keine Uhrzeit
    if body.due_time is not None:
        t.due_time = _clean_time(body.due_time) if t.due_date else ""
    await db.commit()
    await db.refresh(t)
    return _out(t)


@router.delete("/{todo_id}", status_code=204)
async def delete_todo(todo_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    t = await eigenes(db, Todo, todo_id, user, "To-do nicht gefunden")
    await db.delete(t)
    await db.commit()


@router.get("/calendar")
async def calendar_todos(frm: str = "", to: str = "", user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Datierte To-dos in einem Zeitraum (fuer die Kalender-Anzeige). Nur mit Datum;
    erledigte bleiben sichtbar (durchgestrichen im Kalender), aber markiert."""
    f = _parse_date(frm[:10]) if frm else None
    t2 = _parse_date(to[:10]) if to else None
    q = select(Todo).where(Todo.owner_id == user.id, Todo.due_date.is_not(None))
    if f:
        q = q.where(Todo.due_date >= f)
    if t2:
        q = q.where(Todo.due_date <= t2)
    rows = (await db.execute(q.order_by(Todo.due_date, Todo.due_time))).scalars().all()
    return [{"id": t.id, "date": t.due_date.isoformat(), "time": t.due_time or "",
             "text": t.text, "done": t.done} for t in rows]
