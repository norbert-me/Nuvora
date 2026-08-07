"""Modul Stoffverteilung — Jahresplanung der Themen je Kurs/Klasse.

Eigenständig (Regel 3). Themen in eine Reihenfolge bringen (grobe KW, Stunden,
Notiz), abhaken. Optionaler Kern-Themenbezug (topic_id). Ergänzt den Kalender um
die Jahressicht, ohne von ihm abzuhängen.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import CurriculumItem, ExamDate, Kurs, SchoolClass, User
from .auth import get_current_user
from .modules import is_active

router = APIRouter(prefix="/api/stoffplan", tags=["stoffplan"])
MODULE_KEY = "unterrichtsplanung"


async def require_module(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> User:
    if not await is_active(db, user.id, MODULE_KEY):
        raise HTTPException(403, "Modul Stoffverteilung ist nicht aktiviert")
    return user


async def _check_kurs(db, user, kurs_id):
    if kurs_id is None:
        return
    k = await db.get(Kurs, kurs_id)
    if not k or k.owner_id != user.id:
        raise HTTPException(404, "Kurs nicht gefunden")


async def _check_class(db, user, class_id):
    if class_id is None:
        return
    c = await db.get(SchoolClass, class_id)
    if not c or c.owner_id != user.id:
        raise HTTPException(404, "Klasse nicht gefunden")


class ItemIn(BaseModel):
    kurs_id: Optional[int] = None
    class_id: Optional[int] = None
    topic_id: Optional[int] = None
    title: str = ""
    kw: Optional[str] = ""
    hours: Optional[int] = None
    notes: Optional[str] = ""


class ItemPatch(BaseModel):
    title: Optional[str] = None
    kw: Optional[str] = None
    hours: Optional[int] = None
    notes: Optional[str] = None
    done: Optional[bool] = None
    topic_id: Optional[int] = None


class ReorderIn(BaseModel):
    ids: List[int]


def _out(i: CurriculumItem) -> dict:
    return {"id": i.id, "kurs_id": i.kurs_id, "class_id": i.class_id, "topic_id": i.topic_id,
            "title": i.title or "", "kw": i.kw or "", "hours": i.hours,
            "notes": i.notes or "", "done": i.done, "position": i.position}


@router.get("")
async def list_items(kurs_id: Optional[int] = None, class_id: Optional[int] = None,
                     user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    q = select(CurriculumItem).where(CurriculumItem.owner_id == user.id)
    if kurs_id is not None:
        q = q.where(CurriculumItem.kurs_id == kurs_id)
    elif class_id is not None:
        q = q.where(CurriculumItem.class_id == class_id, CurriculumItem.kurs_id.is_(None))
    rows = (await db.execute(q.order_by(CurriculumItem.position, CurriculumItem.id))).scalars().all()
    return [_out(i) for i in rows]


@router.get("/klassenarbeiten")
async def list_exams(kurs_id: Optional[int] = None, class_id: Optional[int] = None,
                     user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Klassenarbeitstermine dieses Kurses — damit sie in der Jahresplanung
    stehen, ohne dort ein zweites Mal gepflegt zu werden.

    Regel 3: der Stoffplan liest nur. Ohne Modul Kalender gibt es schlicht keine
    Termine (leere Liste), und die Jahresplanung funktioniert unverändert.
    """
    if not await is_active(db, user.id, "kalender"):
        return []
    q = select(ExamDate).where(ExamDate.owner_id == user.id)
    if kurs_id is not None:
        q = q.where(ExamDate.kurs_id == kurs_id)
    elif class_id is not None:
        q = q.where(ExamDate.class_id == class_id)
    else:
        return []
    rows = (await db.execute(q.order_by(ExamDate.date))).scalars().all()
    return [{
        "id": e.id,
        "date": e.date.isoformat() if e.date else None,
        # Kalenderwoche, damit die Arbeit zwischen den Themen derselben Woche steht.
        "kw": e.date.isocalendar()[1] if e.date else None,
        "title": e.title or "",
        "class_id": e.class_id,
        "kurs_id": e.kurs_id,
        "work_id": e.work_id,
    } for e in rows]


@router.post("", status_code=201)
async def create_item(body: ItemIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _check_kurs(db, user, body.kurs_id)
    await _check_class(db, user, body.class_id)
    title = (body.title or "").strip()[:200]
    if not title:
        raise HTTPException(400, "Titel fehlt")
    # ans Ende der jeweiligen Liste
    scope = [CurriculumItem.owner_id == user.id]
    if body.kurs_id is not None:
        scope.append(CurriculumItem.kurs_id == body.kurs_id)
    else:
        scope.append(CurriculumItem.class_id == body.class_id)
        scope.append(CurriculumItem.kurs_id.is_(None))
    mx = (await db.execute(select(CurriculumItem.position).where(*scope).order_by(CurriculumItem.position.desc()).limit(1))).scalar_one_or_none()
    pos = (mx + 1) if mx is not None else 0
    i = CurriculumItem(owner_id=user.id, kurs_id=body.kurs_id, class_id=body.class_id, topic_id=body.topic_id,
                       title=title, kw=(body.kw or "").strip()[:20], hours=body.hours,
                       notes=(body.notes or "").strip(), position=pos)
    db.add(i)
    await db.commit()
    await db.refresh(i)
    return _out(i)


@router.put("/reorder", status_code=204)
async def reorder_items(body: ReorderIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(CurriculumItem).where(
        CurriculumItem.owner_id == user.id, CurriculumItem.id.in_(body.ids)))).scalars().all()
    by_id = {i.id: i for i in rows}
    for idx, iid in enumerate(body.ids):
        it = by_id.get(iid)
        if it is not None:
            it.position = idx
    await db.commit()


@router.put("/{item_id}")
async def update_item(item_id: int, body: ItemPatch, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    i = await db.get(CurriculumItem, item_id)
    if not i or i.owner_id != user.id:
        raise HTTPException(404, "Eintrag nicht gefunden")
    if body.title is not None:
        i.title = body.title.strip()[:200] or i.title
    if body.kw is not None:
        i.kw = body.kw.strip()[:20]
    if body.hours is not None:
        i.hours = body.hours
    if body.notes is not None:
        i.notes = body.notes.strip()
    if body.done is not None:
        i.done = body.done
    if body.topic_id is not None:
        i.topic_id = body.topic_id or None
    await db.commit()
    await db.refresh(i)
    return _out(i)


@router.delete("/{item_id}", status_code=204)
async def delete_item(item_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    i = await db.get(CurriculumItem, item_id)
    if not i or i.owner_id != user.id:
        raise HTTPException(404, "Eintrag nicht gefunden")
    await db.delete(i)
    await db.commit()
