from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import Folder, QuestionSet, QuestionSetItem, User
from .auth import get_current_user, rate_limit

router = APIRouter(prefix="/api", tags=["folders"])


# --- Schemas ---

class FolderCreate(BaseModel):
    name: str
    parent_id: Optional[int] = None


class FolderOut(BaseModel):
    id: int
    name: str
    parent_id: Optional[int]
    model_config = {"from_attributes": True}


class QuestionInSet(BaseModel):
    id: int
    text: str
    question_type: str
    choices: dict
    correct_answer: Optional[str]
    image_url: Optional[str] = None
    image_layout: str = "above"
    num_choices: int = 4
    choice_images: Optional[dict] = None
    model_config = {"from_attributes": True}


class QuestionSetOut(BaseModel):
    id: int
    name: str
    folder_id: Optional[int]
    shuffle_questions: bool = False
    shuffle_answers: bool = False
    questions: List[QuestionInSet] = []
    model_config = {"from_attributes": True}


class QuestionSetCreate(BaseModel):
    name: str
    folder_id: Optional[int] = None
    question_ids: List[int] = []
    shuffle_questions: bool = False
    shuffle_answers: bool = False


class FolderTree(BaseModel):
    id: int
    name: str
    parent_id: Optional[int]
    children: List["FolderTree"] = []
    question_sets: List[QuestionSetOut] = []
    model_config = {"from_attributes": True}


# --- Folder CRUD ---

@router.post("/folders", response_model=FolderOut, status_code=201)
async def create_folder(body: FolderCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rate_limit("folder_create", f"u{user.id}", 60, 60, "Zu viele Ordner in kurzer Zeit. Bitte kurz warten.")
    f = Folder(name=body.name, parent_id=body.parent_id, owner_id=user.id)
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return f


@router.get("/folders", response_model=List[FolderTree])
async def list_folders(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Folder)
        .options(selectinload(Folder.question_sets).selectinload(QuestionSet.items).selectinload(QuestionSetItem.question))
        .where((Folder.owner_id == user.id) | (Folder.owner_id.is_(None)))
    )
    all_folders = result.scalars().all()

    folder_map = {}
    for f in all_folders:
        folder_map[f.id] = {
            "id": f.id,
            "name": f.name,
            "parent_id": f.parent_id,
            "children": [],
            "question_sets": [_set_to_dict(qs) for qs in f.question_sets],
        }

    roots = []
    for f in all_folders:
        node = folder_map[f.id]
        if f.parent_id and f.parent_id in folder_map:
            folder_map[f.parent_id]["children"].append(node)
        else:
            roots.append(node)

    def sort_tree(nodes):
        nodes.sort(key=lambda n: n["name"].lower())
        for n in nodes:
            sort_tree(n["children"])

    sort_tree(roots)
    return roots


@router.get("/root-question-sets")
async def list_root_question_sets(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Fragensets OHNE Ordner (Top-Level) des Nutzers — analog zu den Sets in
    einem Ordner, nur eben ordnerlos."""
    rows = (await db.execute(
        select(QuestionSet)
        .options(selectinload(QuestionSet.items).selectinload(QuestionSetItem.question))
        .where(QuestionSet.folder_id.is_(None), QuestionSet.owner_id == user.id)
    )).scalars().all()
    return [_set_to_dict(qs) for qs in rows]


@router.put("/folders/{folder_id}", response_model=FolderOut)
async def update_folder(folder_id: int, body: FolderCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    f = await db.get(Folder, folder_id)
    if not f:
        raise HTTPException(404)
    if f.owner_id and f.owner_id != user.id:
        raise HTTPException(403, "Keine Berechtigung")
    f.name = body.name
    f.parent_id = body.parent_id
    if not f.owner_id:
        f.owner_id = user.id
    await db.commit()
    await db.refresh(f)
    return f


@router.delete("/folders/{folder_id}", status_code=204)
async def delete_folder(folder_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    f = await db.get(Folder, folder_id)
    if not f:
        raise HTTPException(404)
    if f.owner_id and f.owner_id != user.id:
        raise HTTPException(403, "Keine Berechtigung")
    # Ganze Struktur löschen: Core-DELETE statt ORM-Objekt-Delete. Die DB kaskadiert
    # über parent_id (Unterordner, rekursiv) und folder_id (Fragensets) selbst —
    # der ORM-Cascade müsste die Kinder erst laden (in async = Lazy-Load-Fehler bei
    # Ordnern MIT Inhalt), darum bewusst über die DB-Fremdschlüssel.
    await db.execute(sql_delete(Folder).where(Folder.id == folder_id))
    await db.commit()


# --- QuestionSet CRUD ---

@router.post("/question-sets", response_model=QuestionSetOut, status_code=201)
async def create_question_set(body: QuestionSetCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rate_limit("set_create", f"u{user.id}", 60, 60, "Zu viele Fragesets in kurzer Zeit. Bitte kurz warten.")
    qs = QuestionSet(
        name=body.name, folder_id=body.folder_id, owner_id=user.id,
        shuffle_questions=body.shuffle_questions, shuffle_answers=body.shuffle_answers,
    )
    db.add(qs)
    await db.flush()
    for pos, qid in enumerate(body.question_ids):
        db.add(QuestionSetItem(question_set_id=qs.id, question_id=qid, position=pos))
    await db.commit()
    return await _load_set(db, qs.id)


@router.get("/question-sets/{set_id}", response_model=QuestionSetOut)
async def get_question_set(set_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Zugriff auf dem ORM-Objekt pruefen, dann als dict ausliefern — _load_set
    # gibt bereits ein dict zurueck, das ensure_set_access nicht lesen kann.
    orm = await db.get(QuestionSet, set_id)
    if not orm:
        raise HTTPException(404)
    await ensure_set_access(db, orm, user.id)
    return await _load_set(db, set_id)


@router.put("/question-sets/{set_id}", response_model=QuestionSetOut)
async def update_question_set(set_id: int, body: QuestionSetCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    qs = await db.get(QuestionSet, set_id)
    if not qs:
        raise HTTPException(404)
    await ensure_set_access(db, qs, user.id)
    qs.name = body.name
    qs.folder_id = body.folder_id
    qs.shuffle_questions = body.shuffle_questions
    qs.shuffle_answers = body.shuffle_answers

    existing = await db.execute(select(QuestionSetItem).where(QuestionSetItem.question_set_id == set_id))
    for item in existing.scalars().all():
        await db.delete(item)

    for pos, qid in enumerate(body.question_ids):
        db.add(QuestionSetItem(question_set_id=set_id, question_id=qid, position=pos))

    await db.commit()
    return await _load_set(db, set_id)


@router.delete("/question-sets/{set_id}", status_code=204)
async def delete_question_set(set_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    qs = await db.get(QuestionSet, set_id)
    if not qs:
        raise HTTPException(404)
    await ensure_set_access(db, qs, user.id)
    # Core-DELETE: die DB kaskadiert die Set-Einträge (question_set_items) und
    # NULLt die Verknüpfungen in Kalender-Einträgen (cardvote_set_id ON DELETE
    # SET NULL). ORM-Objekt-Delete müsste die items erst laden (async Lazy-Load).
    await db.execute(sql_delete(QuestionSet).where(QuestionSet.id == set_id))
    await db.commit()


# --- Helpers ---

async def ensure_set_access(db: AsyncSession, qs: QuestionSet, user_id: int):
    """403, wenn das Frageset einem fremden Ordner ODER (ordnerlos) einem fremden
    Besitzer gehoert. Ordnerlose Sets ohne owner_id (Altbestand) bleiben zugelassen."""
    if qs is None:
        return
    if qs.folder_id is not None:
        folder = await db.get(Folder, qs.folder_id)
        if folder and folder.owner_id and folder.owner_id != user_id:
            raise HTTPException(403, "Kein Zugriff auf dieses Frageset")
    elif qs.owner_id is not None and qs.owner_id != user_id:
        raise HTTPException(403, "Kein Zugriff auf dieses Frageset")


def _set_to_dict(qs: QuestionSet) -> dict:
    return {
        "id": qs.id,
        "name": qs.name,
        "folder_id": qs.folder_id,
        "shuffle_questions": qs.shuffle_questions,
        "shuffle_answers": qs.shuffle_answers,
        "questions": [
            {
                "id": item.question.id,
                "text": item.question.text,
                "question_type": item.question.question_type,
                "choices": item.question.choices,
                "correct_answer": item.question.correct_answer,
                "image_url": item.question.image_url,
                "image_layout": item.question.image_layout,
                "num_choices": item.question.num_choices,
                "choice_images": item.question.choice_images,
            }
            for item in qs.items
        ],
    }


async def _load_set(db: AsyncSession, set_id: int):
    result = await db.execute(
        select(QuestionSet)
        .options(selectinload(QuestionSet.items).selectinload(QuestionSetItem.question))
        .where(QuestionSet.id == set_id)
    )
    qs = result.scalar_one_or_none()
    if not qs:
        return None
    return _set_to_dict(qs)
