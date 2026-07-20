"""Marktplatz: Quiz veroeffentlichen, suchen, bewerten und in eigene Sammlung kopieren."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import (
    MarketplaceQuiz, MarketplaceRating, QuestionSet, QuestionSetItem, Question, User, Folder,
    CardDeck, Card, Method, SchoolClass,
)
from .auth import get_current_user, rate_limit

router = APIRouter(prefix="/api/marketplace", tags=["marketplace"])


class PublishBody(BaseModel):
    set_id: int
    description: str = ""
    author_name: str = ""


class PublishDeckBody(BaseModel):
    deck_id: int
    description: str = ""
    author_name: str = ""


class PublishMethodBody(BaseModel):
    method_id: int
    description: str = ""
    author_name: str = ""


class CopyBody(BaseModel):
    # Nur fuer karten_deck noetig: Zielklasse, an die der uebernommene Stapel haengt.
    class_id: Optional[int] = None


class RateBody(BaseModel):
    stars: int


def _snapshot_from_items(qs: QuestionSet, items: list[QuestionSetItem]) -> dict:
    return {
        "type": "cardvote_questionset",
        "version": 1,
        "name": qs.name,
        "shuffle_questions": qs.shuffle_questions,
        "shuffle_answers": qs.shuffle_answers,
        "questions": [
            {
                "text": it.question.text,
                "choices": it.question.choices,
                "correct_answer": it.question.correct_answer,
                "image_url": it.question.image_url,
                "image_layout": it.question.image_layout,
                "num_choices": it.question.num_choices,
                "choice_images": it.question.choice_images,
            }
            for it in items
        ],
    }


def _snapshot_from_deck(deck: CardDeck, cards: list[Card]) -> dict:
    # Kein Klassenbezug, kein Ausroll-Status, keine Schuelerdaten — nur die Karten.
    return {
        "type": "karten_deck",
        "version": 1,
        "name": deck.name,
        "cards": [{"front": c.front, "back": c.back, "position": c.position} for c in cards],
    }


def _snapshot_from_method(m: Method) -> dict:
    return {
        "type": "method",
        "version": 1,
        "title": m.title,
        "description": m.description,
        "ablauf": m.ablauf,
        "material": m.material,
        "dauer": m.dauer,
    }


def _live_author_name(quiz: MarketplaceQuiz, current_names: dict) -> str:
    # Zeigt den AKTUELLEN Benutzernamen der veroeffentlichenden Person (Live-Pointer),
    # nicht den zum Veroeffentlichungszeitpunkt gespeicherten Schnappschuss. Fallback auf
    # den Schnappschuss, falls das Konto inzwischen geloescht wurde oder nie einen Namen gesetzt hat.
    live = (current_names.get(quiz.author_id) or "").strip() if quiz.author_id else ""
    return live or quiz.author_name or "Unbekannt"


async def _quiz_to_dict(quiz: MarketplaceQuiz, user_id: int, current_names: dict, is_admin: bool = False, author_email: str | None = None) -> dict:
    ratings = quiz.ratings
    count = len(ratings)
    avg = round(sum(r.stars for r in ratings) / count, 2) if count else 0
    my = next((r.stars for r in ratings if r.user_id == user_id), None)
    out = {
        "id": quiz.id,
        "kind": quiz.kind or "cardvote_questionset",
        "title": quiz.title,
        "description": quiz.description,
        "author_name": _live_author_name(quiz, current_names),
        "author_id": quiz.author_id,
        "question_count": quiz.question_count,
        "copies": quiz.copies or 0,
        "created_at": quiz.created_at.isoformat() if quiz.created_at else None,
        "avg_rating": avg,
        "rating_count": count,
        "my_rating": my,
    }
    # E-Mail nur fuer Admin sichtbar (Moderation), nie oeffentlich
    if is_admin:
        out["author_email"] = author_email
    return out


@router.get("")
async def list_quizzes(
    search: str = "",
    sort: str = "newest",
    kind: str = "",
    author_id: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(MarketplaceQuiz).options(selectinload(MarketplaceQuiz.ratings))
    if author_id is not None:
        stmt = stmt.where(MarketplaceQuiz.author_id == author_id)
    if kind.strip():
        stmt = stmt.where((MarketplaceQuiz.kind == kind.strip()))
    if search.strip():
        term = f"%{search.strip().lower()}%"
        stmt = stmt.where(
            func.lower(MarketplaceQuiz.title).like(term)
            | func.lower(MarketplaceQuiz.description).like(term)
            | func.lower(MarketplaceQuiz.author_name).like(term)
        )
    result = await db.execute(stmt)
    quizzes = result.scalars().all()
    is_admin = user.id == 1
    author_ids = {q.author_id for q in quizzes if q.author_id}
    current_names = {}
    emails_by_id = {}
    if author_ids:
        r = await db.execute(select(User.id, User.marketplace_name, User.email).where(User.id.in_(author_ids)))
        for uid, mname, email in r.all():
            current_names[uid] = mname
            if is_admin:
                emails_by_id[uid] = email
    out = [await _quiz_to_dict(q, user.id, current_names, is_admin, emails_by_id.get(q.author_id)) for q in quizzes]
    if sort == "top":
        out.sort(key=lambda q: (q["avg_rating"], q["rating_count"], q["id"]), reverse=True)
    else:  # newest
        out.sort(key=lambda q: q["id"], reverse=True)
    return out


@router.get("/{quiz_id}")
async def get_quiz(quiz_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(MarketplaceQuiz).options(selectinload(MarketplaceQuiz.ratings)).where(MarketplaceQuiz.id == quiz_id)
    )
    quiz = result.scalar_one_or_none()
    if not quiz:
        raise HTTPException(404, "Quiz nicht gefunden")
    is_admin = user.id == 1
    current_names = {}
    author_email = None
    if quiz.author_id:
        author = await db.get(User, quiz.author_id)
        if author:
            current_names[quiz.author_id] = author.marketplace_name
            if is_admin:
                author_email = author.email
    base = await _quiz_to_dict(quiz, user.id, current_names, is_admin, author_email)
    data = quiz.payload or {}
    kind = quiz.kind or "cardvote_questionset"
    if kind == "karten_deck":
        # Vorschau: die Karten (Vorder-/Rueckseite).
        base["cards"] = [{"front": c.get("front", ""), "back": c.get("back", "")} for c in data.get("cards", [])]
    elif kind == "method":
        base["method"] = {"description": data.get("description", ""), "ablauf": data.get("ablauf", ""), "material": data.get("material", ""), "dauer": data.get("dauer")}
    else:
        # Fragen mit Loesung, damit die Lehrkraft pruefen kann.
        base["questions"] = [
            {
                "text": q.get("text", ""),
                "choices": q.get("choices", {}),
                "correct_answer": q.get("correct_answer"),
                "num_choices": q.get("num_choices", 4),
            }
            for q in data.get("questions", [])
        ]
    return base


@router.post("/publish", status_code=201)
async def publish_quiz(body: PublishBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rate_limit("mp_publish", f"u{user.id}", 30, 3600, "Zu viele Veröffentlichungen. Bitte später erneut versuchen.")
    qs = await db.get(QuestionSet, body.set_id)
    if not qs:
        raise HTTPException(404, "Frageset nicht gefunden")
    # Nur eigene Fragesets veroeffentlichen (Ordner-Eigentuemer pruefen)
    if qs.folder_id is not None:
        folder = await db.get(Folder, qs.folder_id)
        if folder and folder.owner_id and folder.owner_id != user.id:
            raise HTTPException(403, "Nur eigene Fragesets koennen veroeffentlicht werden")
    result = await db.execute(
        select(QuestionSetItem)
        .options(selectinload(QuestionSetItem.question))
        .where(QuestionSetItem.question_set_id == body.set_id)
        .order_by(QuestionSetItem.position)
    )
    items = result.scalars().all()
    if not items:
        raise HTTPException(400, "Frageset ist leer")
    payload = _snapshot_from_items(qs, items)
    # Nie die E-Mail als oeffentlichen Anzeigenamen verwenden (Datenschutz)
    author = (body.author_name or "").strip() or (getattr(user, "marketplace_name", "") or "").strip() or user.name.strip() or "Unbekannt"
    quiz = MarketplaceQuiz(
        title=qs.name,
        description=(body.description or "").strip()[:2000],
        author_id=user.id,
        author_name=author[:100],
        payload=payload,
        question_count=len(items),
    )
    db.add(quiz)
    await db.commit()
    await db.refresh(quiz)
    return {"id": quiz.id, "title": quiz.title}


@router.post("/publish/deck", status_code=201)
async def publish_deck(body: PublishDeckBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rate_limit("mp_publish", f"u{user.id}", 30, 3600, "Zu viele Veröffentlichungen. Bitte später erneut versuchen.")
    deck = await db.get(CardDeck, body.deck_id)
    if not deck:
        raise HTTPException(404, "Stapel nicht gefunden")
    if deck.owner_id and deck.owner_id != user.id:
        raise HTTPException(403, "Nur eigene Stapel koennen veroeffentlicht werden")
    cards = (await db.execute(select(Card).where(Card.deck_id == deck.id).order_by(Card.position))).scalars().all()
    if not cards:
        raise HTTPException(400, "Stapel ist leer")
    author = (body.author_name or "").strip() or (getattr(user, "marketplace_name", "") or "").strip() or user.name.strip() or "Unbekannt"
    quiz = MarketplaceQuiz(
        kind="karten_deck", title=deck.name or "Kartenstapel",
        description=(body.description or "").strip()[:2000], author_id=user.id, author_name=author[:100],
        payload=_snapshot_from_deck(deck, cards), question_count=len(cards),
    )
    db.add(quiz)
    await db.commit()
    await db.refresh(quiz)
    return {"id": quiz.id, "title": quiz.title}


@router.post("/publish/method", status_code=201)
async def publish_method(body: PublishMethodBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rate_limit("mp_publish", f"u{user.id}", 30, 3600, "Zu viele Veröffentlichungen. Bitte später erneut versuchen.")
    m = await db.get(Method, body.method_id)
    if not m:
        raise HTTPException(404, "Eintrag nicht gefunden")
    if m.owner_id != user.id:
        raise HTTPException(403, "Nur eigene Eintraege koennen veroeffentlicht werden")
    author = (body.author_name or "").strip() or (getattr(user, "marketplace_name", "") or "").strip() or user.name.strip() or "Unbekannt"
    quiz = MarketplaceQuiz(
        kind="method", title=m.title or "Einstieg",
        description=(body.description or "").strip()[:2000] or m.description[:2000], author_id=user.id, author_name=author[:100],
        payload=_snapshot_from_method(m), question_count=1,
    )
    db.add(quiz)
    await db.commit()
    await db.refresh(quiz)
    return {"id": quiz.id, "title": quiz.title}


@router.post("/{quiz_id}/copy", status_code=201)
async def copy_quiz(quiz_id: int, body: Optional[CopyBody] = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rate_limit("mp_copy", f"u{user.id}", 120, 3600, "Zu viele Übernahmen. Bitte kurz warten.")
    quiz = await db.get(MarketplaceQuiz, quiz_id)
    if not quiz:
        raise HTTPException(404, "Eintrag nicht gefunden")
    quiz.copies = (quiz.copies or 0) + 1  # Übernahme zählen (wird mit dem Copy committet)
    data = quiz.payload or {}
    kind = quiz.kind or "cardvote_questionset"
    if kind == "karten_deck":
        return await _copy_deck(quiz, data, body, user, db)
    if kind == "method":
        return await _copy_method(quiz, data, user, db)
    questions = data.get("questions", [])
    if len(questions) > 200:
        raise HTTPException(400, "Maximal 200 Fragen pro Set")
    # Uebernommene Quiz landen im (bei Bedarf angelegten) Ordner "Marktplatz",
    # damit sie in der Ordner-Uebersicht sichtbar sind (Root zeigt keine ordnerlosen Sets).
    result = await db.execute(
        select(Folder).where(Folder.owner_id == user.id, Folder.name == "Marktplatz", Folder.parent_id.is_(None))
    )
    mp_folder = result.scalars().first()
    if not mp_folder:
        mp_folder = Folder(name="Marktplatz", owner_id=user.id, parent_id=None)
        db.add(mp_folder)
        await db.flush()
    qs = QuestionSet(
        name=quiz.title,
        folder_id=mp_folder.id,
        shuffle_questions=data.get("shuffle_questions", False),
        shuffle_answers=data.get("shuffle_answers", False),
    )
    db.add(qs)
    await db.flush()
    for pos, qdata in enumerate(questions):
        q = Question(
            text=qdata.get("text", ""),
            choices=qdata.get("choices", {"A": "", "B": "", "C": "", "D": ""}),
            correct_answer=qdata.get("correct_answer"),
            image_url=qdata.get("image_url"),
            image_layout=qdata.get("image_layout", "above"),
            num_choices=qdata.get("num_choices", 4),
            choice_images=qdata.get("choice_images"),
            owner_id=user.id,
        )
        db.add(q)
        await db.flush()
        db.add(QuestionSetItem(question_set_id=qs.id, question_id=q.id, position=pos))
    await db.commit()
    return {"id": qs.id, "name": qs.name}


async def _copy_deck(quiz, data, body, user, db):
    class_id = body.class_id if body else None
    if not class_id:
        raise HTTPException(400, "Zielklasse fehlt")
    cls = await db.get(SchoolClass, class_id)
    if not cls or (cls.owner_id and cls.owner_id != user.id):
        raise HTTPException(403, "Klasse nicht gefunden")
    cards = data.get("cards", [])
    if len(cards) > 500:
        raise HTTPException(400, "Maximal 500 Karten pro Stapel")
    # Entwurf (released_at NULL), keine Themenbindung — nichts von den SuS uebernommen.
    deck = CardDeck(owner_id=user.id, class_id=class_id, name=data.get("name", quiz.title), topic_id=None, released_at=None)
    db.add(deck)
    await db.flush()
    for pos, c in enumerate(cards):
        db.add(Card(deck_id=deck.id, front=c.get("front", ""), back=c.get("back", ""), position=c.get("position", pos)))
    await db.commit()
    return {"id": deck.id, "name": deck.name}


async def _copy_method(quiz, data, user, db):
    m = Method(owner_id=user.id, title=data.get("title", quiz.title),
               description=data.get("description", ""), ablauf=data.get("ablauf", ""),
               material=data.get("material", ""), dauer=data.get("dauer"))
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return {"id": m.id, "title": m.title}


@router.post("/{quiz_id}/rate")
async def rate_quiz(quiz_id: int, body: RateBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rate_limit("mp_rate", f"u{user.id}", 240, 3600, "Zu viele Bewertungen. Bitte kurz warten.")
    if body.stars < 1 or body.stars > 5:
        raise HTTPException(400, "Bewertung muss zwischen 1 und 5 liegen")
    quiz = await db.get(MarketplaceQuiz, quiz_id)
    if not quiz:
        raise HTTPException(404, "Quiz nicht gefunden")
    result = await db.execute(
        select(MarketplaceRating).where(
            MarketplaceRating.quiz_id == quiz_id, MarketplaceRating.user_id == user.id
        )
    )
    rating = result.scalar_one_or_none()
    if rating:
        rating.stars = body.stars
    else:
        db.add(MarketplaceRating(quiz_id=quiz_id, user_id=user.id, stars=body.stars))
    await db.commit()
    return {"ok": True}


@router.delete("/{quiz_id}", status_code=204)
async def delete_quiz(quiz_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    quiz = await db.get(MarketplaceQuiz, quiz_id)
    if not quiz:
        raise HTTPException(404, "Quiz nicht gefunden")
    if quiz.author_id != user.id and user.id != 1:
        raise HTTPException(403, "Nur die erstellende Person oder Admin darf loeschen")
    await db.delete(quiz)
    await db.commit()
