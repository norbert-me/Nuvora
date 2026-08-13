from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select, or_, delete as sql_delete, update as sql_update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import Folder, Question, QuestionSet, QuestionSetItem, Scan, User
from .auth import get_current_user, rate_limit
from .modules import modul_pflicht

CARDVOTE = Depends(modul_pflicht("cardvote"))

router = APIRouter(prefix="/api", tags=["folders"], dependencies=[CARDVOTE])


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
    # Das Thema gehoert zur Frage, nicht zum Quiz — es muss trotzdem hier
    # stehen: der Fragen-Editor im Quiz baut sein Formular aus GENAU diesem
    # Objekt. Fehlte es, zeigte er "Kein Thema" und schickte beim Speichern
    # keins mit.
    topic_id: Optional[int] = None
    model_config = {"from_attributes": True}


class QuestionSetOut(BaseModel):
    id: int
    name: str
    folder_id: Optional[int]
    shuffle_questions: bool = False
    shuffle_answers: bool = False
    # E/G-Differenzierung und Minuspunkte gelten je Quiz (siehe QuestionSet).
    niveau_aktiv: bool = False
    minuspunkte: bool = False
    # Niveau je Frage IN DIESEM Quiz: {"<question_id>": "E"}. Fehlt ein Eintrag,
    # gilt G — das ist die Anforderung, die alle erfuellen sollen.
    niveaus: dict = {}
    questions: List[QuestionInSet] = []
    model_config = {"from_attributes": True}


class QuestionSetCreate(BaseModel):
    name: str
    folder_id: Optional[int] = None
    question_ids: List[int] = []
    shuffle_questions: bool = False
    shuffle_answers: bool = False
    niveau_aktiv: bool = False
    minuspunkte: bool = False
    niveaus: dict = {}

    @field_validator("niveaus")
    @classmethod
    def valid_niveaus(cls, v):
        for wert in (v or {}).values():
            if wert not in ("", "E", "G"):
                raise ValueError("Niveau muss E, G oder leer sein")
        return v


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

async def _eigene_fragen(db: AsyncSession, user: User, ids) -> None:
    """Gehoeren alle diese Fragen dieser Lehrkraft?

    Ohne die Pruefung liess sich ein Quiz aus FREMDEN Fragen bauen — und
    `GET /api/question-sets/{id}` gab danach deren vollstaendigen Text heraus.
    Eine unbekannte ID wurde ausserdem zum Fremdschluesselfehler und damit zu
    HTTP 500, statt zu einer verstaendlichen Absage.

    `owner_id IS NULL` zaehlt als eigen: Bestandsdaten aus der Zeit vor den
    Konten (siehe die Nachtragung in main.py).
    """
    ids = [i for i in (ids or [])]
    if not ids:
        return
    treffer = (await db.execute(select(Question.id).where(
        Question.id.in_(ids),
        Question.deleted_at.is_(None),
        or_(Question.owner_id == user.id, Question.owner_id.is_(None)),
    ))).scalars().all()
    fehlend = set(ids) - set(treffer)
    if fehlend:
        raise HTTPException(404, f"Frage nicht gefunden: {sorted(fehlend)}")


@router.post("/question-sets", response_model=QuestionSetOut, status_code=201)
async def create_question_set(body: QuestionSetCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rate_limit("set_create", f"u{user.id}", 60, 60, "Zu viele Fragesets in kurzer Zeit. Bitte kurz warten.")
    qs = QuestionSet(
        name=body.name, folder_id=body.folder_id, owner_id=user.id,
        shuffle_questions=body.shuffle_questions, shuffle_answers=body.shuffle_answers,
        niveau_aktiv=body.niveau_aktiv, minuspunkte=body.minuspunkte,
    )
    await _eigene_fragen(db, user, body.question_ids)
    db.add(qs)
    await db.flush()
    for pos, qid in enumerate(body.question_ids):
        db.add(QuestionSetItem(question_set_id=qs.id, question_id=qid, position=pos,
                               niveau=_niveau_of(body.niveaus, qid)))
    await db.commit()
    return await _load_set(db, qs.id)


class FragenAnhaengen(BaseModel):
    question_ids: List[int] = []


@router.post("/question-sets/{set_id}/questions", response_model=QuestionSetOut)
async def fragen_anhaengen(set_id: int, body: FragenAnhaengen, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Vorhandene Fragen an ein Quiz anhaengen — ohne die uebrigen anzufassen.

    Der Weg ueber `PUT /question-sets/{id}` verlangt die VOLLSTAENDIGE Liste
    der Fragen. Wer nur eine anhaengen will, muesste sie erst holen und
    komplett zurueckschicken; zwei Personen gleichzeitig, und die eine
    ueberschreibt die Aenderung der anderen. Deshalb hier additiv.

    Fragen, die schon drin sind, werden still uebergangen — sonst scheitert
    eine Zuweisung von 40 Fragen an der einen, die schon drinsteht.
    """
    qs = await db.get(QuestionSet, set_id)
    if not qs:
        raise HTTPException(404)
    await ensure_set_access(db, qs, user.id)
    rate_limit("set_anhaengen", f"u{user.id}", 60, 60, "Zu viele Zuweisungen. Bitte kurz warten.")
    await _eigene_fragen(db, user, body.question_ids)

    vorhanden = set((await db.execute(
        select(QuestionSetItem.question_id).where(QuestionSetItem.question_set_id == set_id)
    )).scalars().all())
    letzte = (await db.execute(
        select(QuestionSetItem.position).where(QuestionSetItem.question_set_id == set_id)
        .order_by(QuestionSetItem.position.desc())
    )).scalars().first()
    pos = (letzte if letzte is not None else -1) + 1
    for qid in body.question_ids:
        if qid in vorhanden:
            continue
        db.add(QuestionSetItem(question_set_id=set_id, question_id=qid, position=pos, niveau=""))
        vorhanden.add(qid)
        pos += 1
    await db.commit()
    return await _load_set(db, set_id)


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
    qs.niveau_aktiv = body.niveau_aktiv
    qs.minuspunkte = body.minuspunkte

    # Die alten Niveaus merken: schickt ein alter Client (oder ein Aufruf, der
    # nur den Namen aendert) keine niveaus mit, duerfen sie nicht verschwinden.
    existing = (await db.execute(select(QuestionSetItem).where(QuestionSetItem.question_set_id == set_id))).scalars().all()
    alt = {str(i.question_id): i.niveau or "" for i in existing}
    for item in existing:
        await db.delete(item)

    for pos, qid in enumerate(body.question_ids):
        niv = _niveau_of(body.niveaus, qid) if str(qid) in (body.niveaus or {}) else alt.get(str(qid), "")
        db.add(QuestionSetItem(question_set_id=set_id, question_id=qid, position=pos, niveau=niv))

    await db.commit()
    return await _load_set(db, set_id)


@router.delete("/question-sets/{set_id}", status_code=204)
async def delete_question_set(set_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    qs = await db.get(QuestionSet, set_id)
    if not qs:
        raise HTTPException(404)
    await ensure_set_access(db, qs, user.id)
    # Welche Fragen haengen NUR an diesem Quiz? Nach dem Loeschen waeren sie
    # nirgends mehr erreichbar — an eine Frage kommt man ausschliesslich ueber
    # ein Quiz. Sie blieben unsichtbar in der Datenbank liegen und tauchten nur
    # noch in der Themen-Ansicht auf, wo sie neben ihrem Zwilling aus einem
    # anderen Quiz wie eine doppelte Zeile aussehen. Genau so sind die Reste
    # entstanden, die niemand mehr zuordnen konnte.
    eigene = (await db.execute(
        select(QuestionSetItem.question_id).where(QuestionSetItem.question_set_id == set_id)
    )).scalars().all()
    nur_hier = []
    if eigene:
        woanders = set((await db.execute(
            select(QuestionSetItem.question_id)
            .where(QuestionSetItem.question_id.in_(eigene), QuestionSetItem.question_set_id != set_id)
        )).scalars().all())
        # Fragen mit Scans bleiben — daran haengen die Auswertungen gehaltener
        # Sitzungen. Lieber eine Waise als eine geloeschte Auswertung.
        mit_ergebnissen = set((await db.execute(
            select(Scan.question_id).where(Scan.question_id.in_(eigene)).distinct()
        )).scalars().all())
        nur_hier = [qid for qid in set(eigene) if qid not in woanders and qid not in mit_ergebnissen]

    # Core-DELETE: die DB kaskadiert die Set-Einträge (question_set_items) und
    # NULLt die Verknüpfungen in Kalender-Einträgen (cardvote_set_id ON DELETE
    # SET NULL). ORM-Objekt-Delete müsste die items erst laden (async Lazy-Load).
    await db.execute(sql_delete(QuestionSet).where(QuestionSet.id == set_id))
    if nur_hier:
        # Weich: die Fragen liegen danach im Papierkorb (30 Tage) statt weg zu
        # sein. Ein geloeschtes Quiz nimmt oft Fragen mit, die man doch noch
        # braucht — zurueckholbar ist das die halbe Miete.
        from datetime import datetime, timezone
        await db.execute(sql_update(Question).where(Question.id.in_(nur_hier))
                         .values(deleted_at=datetime.now(timezone.utc)))
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


def _niveau_of(niveaus: dict, qid: int) -> str:
    """Nur „E" wird gespeichert — G ist der Normalfall und bleibt leer."""
    wert = (niveaus or {}).get(str(qid), (niveaus or {}).get(qid, ""))
    return "E" if wert == "E" else ""


def _set_to_dict(qs: QuestionSet) -> dict:
    return {
        "id": qs.id,
        "name": qs.name,
        "folder_id": qs.folder_id,
        "shuffle_questions": qs.shuffle_questions,
        "shuffle_answers": qs.shuffle_answers,
        "niveau_aktiv": bool(qs.niveau_aktiv),
        "minuspunkte": bool(qs.minuspunkte),
        "niveaus": {str(item.question_id): (item.niveau or "G") for item in qs.items
                    if item.question and item.question.deleted_at is None},
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
                "topic_id": item.question.topic_id,
            }
            # Eine Frage im Papierkorb steht nicht mehr im Quiz — ihr
            # Set-Eintrag bleibt aber liegen, damit sie beim Zurueckholen
            # wieder an ihrem Platz steht.
            for item in qs.items if item.question and item.question.deleted_at is None
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
