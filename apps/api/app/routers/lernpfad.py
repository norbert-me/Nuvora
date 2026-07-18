"""Modul Lernpfad — auf dem Nuvora-Kern.

Loest Lernpfads eigene SQLite-Datei ab. Was sich dabei aendert, ist mehr als
der Speicherort:

- `thema`/`unterthema` (freier Text) -> `topic_id` aus der Kern-Taxonomie
- eigene `users` -> `owner_id` auf dem Kern-Konto
- Klassenname als Text -> `class_id` auf `school_classes`

Alle Endpunkte pruefen die Modulaktivierung: ein abgeschaltetes Modul
antwortet nicht, auch wenn jemand die Adresse kennt.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import Exercise, LearningLadder, LearningPath, SchoolClass, Topic, User
from .auth import get_current_user, rate_limit
from .modules import is_active

router = APIRouter(prefix="/api/lernpfad", tags=["lernpfad"])

MODULE_KEY = "lernpfad"


async def require_module(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Modul-Router haengen hinter der Aktivierung — sonst waere das Register
    eine reine Anzeige und die Daten trotzdem erreichbar."""
    if not await is_active(db, user.id, MODULE_KEY):
        raise HTTPException(403, "Modul Lernpfad ist nicht aktiviert")
    return user


async def _check_topic(db: AsyncSession, user: User, topic_id: Optional[int]) -> None:
    if topic_id is None:
        return
    result = await db.execute(select(Topic.id).where(Topic.id == topic_id, Topic.owner_id == user.id))
    if not result.scalar_one_or_none():
        raise HTTPException(400, "Thema nicht gefunden")


async def _check_class(db: AsyncSession, user: User, class_id: Optional[int]) -> None:
    if class_id is None:
        return
    result = await db.execute(
        select(SchoolClass.id).where(SchoolClass.id == class_id, SchoolClass.owner_id == user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(400, "Klasse nicht gefunden")


# ─── Aufgaben ───

class ExerciseIn(BaseModel):
    topic_id: Optional[int] = None
    code: str = ""
    kategorie: str = ""
    aufgabentext: str = ""
    loesung: str = ""
    operator: str = ""
    kompetenz: str = ""
    methode: str = ""
    unteraufgaben: int = 1
    quelle_typ: str = ""
    quelle_detail: str = ""
    lrs: bool = False
    lrs_text: str = ""
    # Liste von Foerderschwerpunkt-Kuerzeln (Checkboxen im Frontend). War
    # faelschlich als dict typisiert — dadurch schlug jeder Aufgaben-POST mit
    # ausgewaehlten Schwerpunkten mit 422 fehl und nichts wurde gespeichert.
    foerderschwerpunkte: Optional[list] = None
    latex: str = ""

    @field_validator("unteraufgaben")
    @classmethod
    def positive(cls, v: int) -> int:
        if v < 1 or v > 99:
            raise ValueError("Unteraufgaben muss zwischen 1 und 99 liegen")
        return v


class ExerciseOut(ExerciseIn):
    id: int
    model_config = {"from_attributes": True}


@router.get("/exercises", response_model=List[ExerciseOut])
async def list_exercises(
    topic_id: Optional[int] = None,
    user: User = Depends(require_module),
    db: AsyncSession = Depends(get_db),
):
    q = select(Exercise).where(Exercise.owner_id == user.id)
    if topic_id is not None:
        q = q.where(Exercise.topic_id == topic_id)
    result = await db.execute(q.order_by(Exercise.id))
    return result.scalars().all()


@router.post("/exercises", response_model=ExerciseOut, status_code=201)
async def create_exercise(
    body: ExerciseIn,
    user: User = Depends(require_module),
    db: AsyncSession = Depends(get_db),
):
    rate_limit("ex_create", f"u{user.id}", 400, 60, "Zu viele Aufgaben in kurzer Zeit. Bitte kurz warten.")
    await _check_topic(db, user, body.topic_id)
    ex = Exercise(**body.model_dump(), owner_id=user.id)
    db.add(ex)
    await db.commit()
    await db.refresh(ex)
    return ex


@router.put("/exercises/{exercise_id}", response_model=ExerciseOut)
async def update_exercise(
    exercise_id: int,
    body: ExerciseIn,
    user: User = Depends(require_module),
    db: AsyncSession = Depends(get_db),
):
    ex = await db.get(Exercise, exercise_id)
    if not ex or ex.owner_id != user.id:
        raise HTTPException(404, "Aufgabe nicht gefunden")
    await _check_topic(db, user, body.topic_id)
    for k, v in body.model_dump().items():
        setattr(ex, k, v)
    await db.commit()
    await db.refresh(ex)
    return ex


@router.delete("/exercises/{exercise_id}", status_code=204)
async def delete_exercise(
    exercise_id: int,
    user: User = Depends(require_module),
    db: AsyncSession = Depends(get_db),
):
    ex = await db.get(Exercise, exercise_id)
    if not ex or ex.owner_id != user.id:
        raise HTTPException(404, "Aufgabe nicht gefunden")
    await db.delete(ex)
    await db.commit()


# ─── Lernpfade und ihre Lernleitern ───

class LadderIn(BaseModel):
    class_id: Optional[int] = None
    topic_id: Optional[int] = None
    position: int = 0
    notizen: str = ""
    # [{"student_id": 12, "exercise_ids": [3, 7]}, ...]
    assignments: Optional[list] = None
    config: Optional[dict] = None


class LadderOut(LadderIn):
    id: int
    model_config = {"from_attributes": True}


class PathIn(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name darf nicht leer sein")
        return v


class PathOut(BaseModel):
    id: int
    name: str
    ladders: List[LadderOut] = []
    model_config = {"from_attributes": True}


@router.get("/paths", response_model=List[PathOut])
async def list_paths(
    user: User = Depends(require_module),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(LearningPath)
        .where(LearningPath.owner_id == user.id)
        .options(selectinload(LearningPath.ladders))
        .order_by(LearningPath.name)
    )
    return result.scalars().all()


@router.post("/paths", response_model=PathOut, status_code=201)
async def create_path(
    body: PathIn,
    user: User = Depends(require_module),
    db: AsyncSession = Depends(get_db),
):
    dup = await db.execute(
        select(LearningPath.id).where(LearningPath.owner_id == user.id, LearningPath.name == body.name)
    )
    rate_limit("path_create", f"u{user.id}", 100, 60, "Zu viele Lernpfade in kurzer Zeit. Bitte kurz warten.")
    if dup.scalar_one_or_none():
        raise HTTPException(409, "Ein Lernpfad mit diesem Namen existiert schon")
    path = LearningPath(name=body.name, owner_id=user.id)
    db.add(path)
    await db.commit()
    await db.refresh(path, ["ladders"])
    return path


@router.delete("/paths/{path_id}", status_code=204)
async def delete_path(
    path_id: int,
    user: User = Depends(require_module),
    db: AsyncSession = Depends(get_db),
):
    """Loescht den Pfad samt seiner Lernleitern. Die Aufgaben bleiben — sie
    gehoeren nicht dem Pfad, er verweist nur auf sie."""
    path = await db.get(LearningPath, path_id)
    if not path or path.owner_id != user.id:
        raise HTTPException(404, "Lernpfad nicht gefunden")
    await db.delete(path)
    await db.commit()


async def _owned_path(db: AsyncSession, user: User, path_id: int) -> LearningPath:
    path = await db.get(LearningPath, path_id)
    if not path or path.owner_id != user.id:
        raise HTTPException(404, "Lernpfad nicht gefunden")
    return path


@router.post("/paths/{path_id}/ladders", response_model=LadderOut, status_code=201)
async def add_ladder(
    path_id: int,
    body: LadderIn,
    user: User = Depends(require_module),
    db: AsyncSession = Depends(get_db),
):
    await _owned_path(db, user, path_id)
    await _check_class(db, user, body.class_id)
    await _check_topic(db, user, body.topic_id)
    ladder = LearningLadder(**body.model_dump(), path_id=path_id)
    db.add(ladder)
    await db.commit()
    await db.refresh(ladder)
    return ladder


@router.put("/ladders/{ladder_id}", response_model=LadderOut)
async def update_ladder(
    ladder_id: int,
    body: LadderIn,
    user: User = Depends(require_module),
    db: AsyncSession = Depends(get_db),
):
    ladder = await db.get(LearningLadder, ladder_id)
    if not ladder:
        raise HTTPException(404, "Lernleiter nicht gefunden")
    await _owned_path(db, user, ladder.path_id)
    await _check_class(db, user, body.class_id)
    await _check_topic(db, user, body.topic_id)
    for k, v in body.model_dump().items():
        setattr(ladder, k, v)
    await db.commit()
    await db.refresh(ladder)
    return ladder


@router.delete("/ladders/{ladder_id}", status_code=204)
async def delete_ladder(
    ladder_id: int,
    user: User = Depends(require_module),
    db: AsyncSession = Depends(get_db),
):
    ladder = await db.get(LearningLadder, ladder_id)
    if not ladder:
        raise HTTPException(404, "Lernleiter nicht gefunden")
    await _owned_path(db, user, ladder.path_id)
    await db.delete(ladder)
    await db.commit()
