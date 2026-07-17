"""Nuvora-Kern: Wochenplanung.

Verbindet die Module, setzt aber keins voraus (Regel 3): eine Woche hat
Themenbloecke aus der Kern-Taxonomie und einen Test-Marker. Lernpfad liefert
Aufgaben zu den Themen, CardVote prueft sie — beides optional.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import PlanBlock, PlanWeek, SchoolClass, Topic, User
from .auth import get_current_user, rate_limit

router = APIRouter(prefix="/api/planung", tags=["planung"])


async def _owned_class(db: AsyncSession, user: User, class_id: int) -> SchoolClass:
    r = await db.execute(select(SchoolClass).where(SchoolClass.id == class_id, SchoolClass.owner_id == user.id))
    cls = r.scalar_one_or_none()
    if not cls:
        raise HTTPException(404, "Klasse nicht gefunden")
    return cls


async def _owned_week(db: AsyncSession, user: User, week_id: int) -> PlanWeek:
    r = await db.execute(select(PlanWeek).where(PlanWeek.id == week_id, PlanWeek.owner_id == user.id))
    w = r.scalar_one_or_none()
    if not w:
        raise HTTPException(404, "Woche nicht gefunden")
    return w


async def _check_topic(db: AsyncSession, user: User, topic_id: Optional[int]) -> None:
    if topic_id is None:
        return
    r = await db.execute(select(Topic.id).where(Topic.id == topic_id, Topic.owner_id == user.id))
    if not r.scalar_one_or_none():
        raise HTTPException(400, "Thema nicht gefunden")


class BlockIn(BaseModel):
    topic_id: Optional[int] = None
    position: int = 0


class BlockOut(BlockIn):
    id: int
    model_config = {"from_attributes": True}


class WeekIn(BaseModel):
    label: str = ""
    notiz: str = ""
    test_done: bool = False

    @field_validator("label", "notiz")
    @classmethod
    def not_too_long(cls, v: str) -> str:
        if len(v) > 500:
            raise ValueError("Zu lang")
        return v


class WeekOut(BaseModel):
    id: int
    class_id: int
    label: str
    position: int
    notiz: str
    test_done: bool
    blocks: List[BlockOut] = []
    model_config = {"from_attributes": True}


class ClassPlanOut(BaseModel):
    class_id: int
    plan_blocks: int
    weeks: List[WeekOut]


@router.get("/classes/{class_id}", response_model=ClassPlanOut)
async def get_plan(class_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    cls = await _owned_class(db, user, class_id)
    r = await db.execute(
        select(PlanWeek).where(PlanWeek.owner_id == user.id, PlanWeek.class_id == class_id)
        .options(selectinload(PlanWeek.blocks)).order_by(PlanWeek.position, PlanWeek.id)
    )
    return ClassPlanOut(class_id=class_id, plan_blocks=cls.plan_blocks, weeks=r.scalars().all())


class BlocksSetting(BaseModel):
    plan_blocks: int

    @field_validator("plan_blocks")
    @classmethod
    def range_ok(cls, v: int) -> int:
        if v < 1 or v > 10:
            raise ValueError("Blöcke pro Woche muss zwischen 1 und 10 liegen")
        return v


@router.put("/classes/{class_id}/setting", response_model=ClassPlanOut)
async def set_blocks(class_id: int, body: BlocksSetting, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    cls = await _owned_class(db, user, class_id)
    cls.plan_blocks = body.plan_blocks
    await db.commit()
    return await get_plan(class_id, user, db)


@router.post("/classes/{class_id}/weeks", response_model=WeekOut, status_code=201)
async def add_week(class_id: int, body: WeekIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rate_limit("plan_week", f"u{user.id}", 200, 60, "Zu viele Wochen in kurzer Zeit. Bitte kurz warten.")
    cls = await _owned_class(db, user, class_id)
    last = (await db.execute(
        select(PlanWeek.position).where(PlanWeek.owner_id == user.id, PlanWeek.class_id == class_id)
        .order_by(PlanWeek.position.desc())
    )).scalars().first()
    week = PlanWeek(class_id=class_id, owner_id=user.id, label=body.label, notiz=body.notiz,
                    position=(last or 0) + 1)
    db.add(week)
    await db.flush()
    # Standard-Anzahl leerer Bloecke anlegen (nur Vorschlag, spaeter aenderbar).
    for pos in range(cls.plan_blocks):
        db.add(PlanBlock(week_id=week.id, position=pos))
    await db.commit()
    await db.refresh(week, ["blocks"])
    return week


@router.put("/weeks/{week_id}", response_model=WeekOut)
async def update_week(week_id: int, body: WeekIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    week = await _owned_week(db, user, week_id)
    week.label = body.label
    week.notiz = body.notiz
    week.test_done = body.test_done
    await db.commit()
    await db.refresh(week, ["blocks"])
    return week


@router.delete("/weeks/{week_id}", status_code=204)
async def delete_week(week_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    week = await _owned_week(db, user, week_id)
    await db.delete(week)
    await db.commit()


@router.post("/weeks/{week_id}/blocks", response_model=BlockOut, status_code=201)
async def add_block(week_id: int, body: BlockIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    week = await _owned_week(db, user, week_id)
    await _check_topic(db, user, body.topic_id)
    last = (await db.execute(
        select(PlanBlock.position).where(PlanBlock.week_id == week_id).order_by(PlanBlock.position.desc())
    )).scalars().first()
    block = PlanBlock(week_id=week_id, topic_id=body.topic_id, position=(last if last is not None else -1) + 1)
    db.add(block)
    await db.commit()
    await db.refresh(block)
    return block


@router.put("/blocks/{block_id}", response_model=BlockOut)
async def update_block(block_id: int, body: BlockIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    block = await db.get(PlanBlock, block_id)
    if not block:
        raise HTTPException(404, "Block nicht gefunden")
    await _owned_week(db, user, block.week_id)
    await _check_topic(db, user, body.topic_id)
    block.topic_id = body.topic_id
    await db.commit()
    await db.refresh(block)
    return block


@router.delete("/blocks/{block_id}", status_code=204)
async def delete_block(block_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    block = await db.get(PlanBlock, block_id)
    if not block:
        raise HTTPException(404, "Block nicht gefunden")
    await _owned_week(db, user, block.week_id)
    await db.delete(block)
    await db.commit()
