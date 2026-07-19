"""Modul Code-Detektiv — Rätsel serverseitig speichern.

Damit Rätsel themen-getaggt und im Kalender planbar sind, liegen die eigenen
Rätsel der Lehrkraft im Kern (nicht mehr nur im Browser-localStorage). Die App
arbeitet weiter mit ihrer stabilen `client_id`; upsert läuft darüber.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import CodePuzzle, Topic, User
from .auth import get_current_user, rate_limit
from .modules import is_active

router = APIRouter(prefix="/api/codedetektiv", tags=["codedetektiv"])
MODULE_KEY = "code-detektiv"


async def require_module(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> User:
    if not await is_active(db, user.id, MODULE_KEY):
        raise HTTPException(403, "Modul Code-Detektiv ist nicht aktiviert")
    return user


class PuzzleIn(BaseModel):
    client_id: str
    title: str = ""
    topic_id: Optional[int] = None
    payload: dict = {}


class PuzzleOut(BaseModel):
    id: int
    client_id: str
    title: str
    topic_id: Optional[int] = None
    payload: dict
    model_config = {"from_attributes": True}


@router.get("/puzzles", response_model=List[PuzzleOut])
async def list_puzzles(user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(CodePuzzle).where(CodePuzzle.owner_id == user.id).order_by(CodePuzzle.id))).scalars().all()
    return rows


@router.put("/puzzles")
async def upsert_puzzle(body: PuzzleIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("cd_puzzle", f"u{user.id}", 300, 60, "Zu viele Änderungen. Bitte kurz warten.")
    if body.topic_id is not None:
        ok = (await db.execute(select(Topic.id).where(Topic.id == body.topic_id, Topic.owner_id == user.id))).scalar_one_or_none()
        if not ok:
            body.topic_id = None
    row = (await db.execute(select(CodePuzzle).where(
        CodePuzzle.owner_id == user.id, CodePuzzle.client_id == body.client_id))).scalar_one_or_none()
    if row:
        row.title = (body.title or "")[:200]
        row.topic_id = body.topic_id
        row.payload = body.payload or {}
    else:
        row = CodePuzzle(owner_id=user.id, client_id=body.client_id[:64], title=(body.title or "")[:200],
                         topic_id=body.topic_id, payload=body.payload or {})
        db.add(row)
    await db.commit()
    await db.refresh(row)
    return {"id": row.id, "client_id": row.client_id}


@router.delete("/puzzles/{client_id}", status_code=204)
async def delete_puzzle(client_id: str, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(CodePuzzle).where(
        CodePuzzle.owner_id == user.id, CodePuzzle.client_id == client_id))).scalar_one_or_none()
    if row:
        await db.delete(row)
        await db.commit()
