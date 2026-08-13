import os
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Question, Topic, User
from ..uploads import bildtyp
from .auth import get_current_user, rate_limit
from .modules import modul_pflicht

CARDVOTE = Depends(modul_pflicht("cardvote"))

router = APIRouter(prefix="/api/questions", tags=["questions"], dependencies=[CARDVOTE])

# Im Container /app/uploads (Volume). Ueberschreibbar, damit Tests und die
# lokale Pruefinstanz nicht ins Wurzelverzeichnis schreiben muessen.
UPLOAD_DIR = os.environ.get("NUVORA_UPLOAD_DIR", "/app/uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


class QuestionCreate(BaseModel):
    text: str
    question_type: str = "mc"
    choices: dict = {"A": "", "B": "", "C": "", "D": ""}
    correct_answer: Optional[str] = None
    image_url: Optional[str] = None
    image_layout: str = "above"
    num_choices: int = 4
    choice_images: Optional[dict] = None
    # Thema aus dem Kern. Optional und ohne Wirkung auf CardVote selbst —
    # es verbindet die Frage nur mit Aufgaben desselben Themas.
    topic_id: Optional[int] = None

    @model_validator(mode="after")
    def validate_fields(self):
        if len(self.text) > 5000:
            raise ValueError("Frage zu lang")
        if self.question_type not in ("mc",):
            raise ValueError("Ungültiger Fragetyp")
        if self.correct_answer and not all(c in "ABCD" for c in self.correct_answer):
            raise ValueError("Ungültige richtige Antwort")
        if self.num_choices not in (2, 3, 4):
            raise ValueError("Ungültige Antwortanzahl")
        if self.image_layout not in ("above", "left", "right", "below"):
            raise ValueError("Ungültiges Bildlayout")
        for k, v in self.choices.items():
            if k not in ("A", "B", "C", "D"):
                raise ValueError("Ungültiger Antwortkey")
            if isinstance(v, str) and len(v) > 2000:
                raise ValueError("Antworttext zu lang")
        return self


class QuestionOut(BaseModel):
    id: int
    text: str
    question_type: str
    choices: dict
    correct_answer: Optional[str]
    image_url: Optional[str]
    image_layout: str
    num_choices: int
    choice_images: Optional[dict] = None
    topic_id: Optional[int] = None

    model_config = {"from_attributes": True}


async def _check_topic(db: AsyncSession, user: User, topic_id):
    """Themen gehoeren dem Kern und der Lehrkraft — kein Fremdthema anhaengen."""
    if topic_id is None:
        return
    result = await db.execute(
        select(Topic.id).where(Topic.id == topic_id, Topic.owner_id == user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(400, "Thema nicht gefunden")


@router.post("", response_model=QuestionOut, status_code=201)
async def create_question(body: QuestionCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rate_limit("q_create", f"u{user.id}", 200, 60, "Zu viele Fragen in kurzer Zeit. Bitte kurz warten.")
    await _check_topic(db, user, body.topic_id)
    q = Question(**body.model_dump())
    q.owner_id = user.id
    db.add(q)
    await db.commit()
    await db.refresh(q)
    return q


@router.put("/{question_id}", response_model=QuestionOut)
async def update_question(question_id: int, body: QuestionCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    q = await db.get(Question, question_id)
    if not q:
        raise HTTPException(404)
    if q.owner_id and q.owner_id != user.id:
        raise HTTPException(403, "Kein Zugriff auf diese Frage")
    await _check_topic(db, user, body.topic_id)
    # `exclude_unset`: nur schreiben, was die Anfrage wirklich genannt hat.
    # Vorher setzte jedes nicht gesendete Feld seinen Default — und weil der
    # Fragen-Editor im Quiz das Thema gar nicht kannte, loeschte ein Klick auf
    # „Speichern" die Themenzuordnung still. Ein Feld ausdruecklich leeren geht
    # weiter: `topic_id: null` steht dann in der Anfrage.
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(q, k, v)
    await db.commit()
    await db.refresh(q)
    return q


@router.get("", response_model=list[QuestionOut])
async def list_questions(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Question)
        .where((Question.owner_id == user.id) | (Question.owner_id.is_(None)))
        .order_by(Question.id.desc())
    )
    return result.scalars().all()


@router.get("/{question_id}", response_model=QuestionOut)
async def get_question(question_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    q = await db.get(Question, question_id)
    if not q:
        raise HTTPException(404)
    if q.owner_id and q.owner_id != user.id:
        raise HTTPException(403, "Kein Zugriff auf diese Frage")
    return q


@router.delete("/{question_id}", status_code=204)
async def delete_question(question_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    q = await db.get(Question, question_id)
    if not q:
        raise HTTPException(404)
    if q.owner_id and q.owner_id != user.id:
        raise HTTPException(403, "Kein Zugriff auf diese Frage")
    await db.delete(q)
    await db.commit()


MAX_UPLOAD_BYTES = 10 * 1024 * 1024


@router.post("/upload-image")
async def upload_image(file: UploadFile = File(...), user: User = Depends(get_current_user)):
    rate_limit("frage_bild", f"u{user.id}", 120, 60, "Zu viele Uploads. Bitte kurz warten.")
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, "Bild zu gross (max 10 MB)")

    # SVG wird nicht mehr angenommen — bewusst.
    #
    # Frueher stand hier ein Filter, der Skripte, Event-Handler und aktive URLs
    # aus dem SVG schneiden sollte. Ein Sicherheits-Audit hat ihn mit fuenf von
    # sechs Nutzlasten ueberwunden: GROSSGESCHRIEBENES ONLOAD (der Ausdruck war
    # ohne re.I), ein Namensraum-Praefix vor <script>, javascript: ohne
    # Anfuehrungszeichen, entity-kodiertes javascript: und SMIL (<set
    # attributeName="onload">). Eine Filterliste ist fuer diese Aufgabe die
    # falsche Bauform: sie muss ALLE Umgehungen kennen, der Angreifer nur eine.
    #
    # Die Folge waere kein harmloser Anzeigefehler gewesen: /api/uploads liegt
    # ohne Anmeldung offen, ein SVG wird als Dokument gerendert, und ein Skript
    # darin laeuft auf Nuvoras eigener Herkunft — also mit Zugriff auf den Token
    # im localStorage.
    #
    # Fuer den Zweck (Bild an einer Quizfrage) genuegen Rasterformate. bildtyp()
    # entscheidet am Inhalt und wird auf allen anderen Bildwegen ebenso benutzt.
    ext = {"image/jpeg": "jpg", "image/png": "png",
           "image/gif": "gif", "image/webp": "webp"}[bildtyp(content)]
    name = f"{uuid.uuid4().hex}.{ext}"
    with open(os.path.join(UPLOAD_DIR, name), "wb") as f:
        f.write(content)
    return {"url": f"/api/uploads/{name}"}
