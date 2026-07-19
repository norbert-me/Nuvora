"""Modul Zufallsschüler — serverseitiges Zieh-Gedächtnis.

Speichert je Schüler nur das letzte Zieh-Datum und wie oft gezogen. Daraus baut
das Frontend faire Gewichtung (lange nicht dran → höheres Gewicht) und die Regel
„nicht zweimal am Stück". Schüler bleiben im Kern (Regel 3).
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import SchoolClass, Student, User, ZufallDraw
from .auth import get_current_user
from .modules import is_active

router = APIRouter(prefix="/api/zufall", tags=["zufall"])
MODULE_KEY = "zufall"


async def require_module(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> User:
    if not await is_active(db, user.id, MODULE_KEY):
        raise HTTPException(403, "Modul Zufallsschüler ist nicht aktiviert")
    return user


async def _owned_class(db, user, class_id) -> SchoolClass:
    sc = await db.get(SchoolClass, class_id)
    if not sc:
        raise HTTPException(404, "Klasse nicht gefunden")
    if sc.owner_id and sc.owner_id != user.id:
        raise HTTPException(403, "Keine Berechtigung")
    return sc


class DrawIn(BaseModel):
    student_id: int


@router.get("/{class_id}")
async def get_history(class_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Zieh-Gedächtnis der Klasse: { student_id: {drawn_at, count} }, plus die
    zuletzt gezogene Person (für „nicht zweimal am Stück")."""
    await _owned_class(db, user, class_id)
    rows = (await db.execute(select(ZufallDraw).where(
        ZufallDraw.owner_id == user.id, ZufallDraw.class_id == class_id
    ))).scalars().all()
    last = max(rows, key=lambda r: r.drawn_at, default=None)
    return {
        "history": {str(r.student_id): {"drawn_at": r.drawn_at.isoformat(), "count": r.count} for r in rows},
        "last_student_id": last.student_id if last else None,
    }


@router.post("/{class_id}/draw")
async def record_draw(class_id: int, body: DrawIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    st = await db.get(Student, body.student_id)
    if not st or st.class_id != class_id:
        raise HTTPException(404, "Schüler nicht in dieser Klasse")
    row = (await db.execute(select(ZufallDraw).where(
        ZufallDraw.owner_id == user.id, ZufallDraw.student_id == body.student_id
    ))).scalar_one_or_none()
    if row:
        row.count += 1
        row.drawn_at = datetime.now(timezone.utc)
        row.class_id = class_id
    else:
        db.add(ZufallDraw(owner_id=user.id, class_id=class_id, student_id=body.student_id, count=1))
    await db.commit()
    return {"ok": True}


@router.delete("/{class_id}", status_code=204)
async def reset(class_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Zieh-Gedächtnis der Klasse leeren."""
    await _owned_class(db, user, class_id)
    await db.execute(delete(ZufallDraw).where(
        ZufallDraw.owner_id == user.id, ZufallDraw.class_id == class_id))
    await db.commit()
