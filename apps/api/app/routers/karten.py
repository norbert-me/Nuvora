"""Modul Karten — Karteikarten mit Spaced Repetition (SM-2).

Eigenstaendig (Regel 3). Zwei Zugaenge:
- Lehrkraft (normaler Login): Stapel und Karten verwalten, Tokens/QR erzeugen,
  Fortschritt sehen.
- Schueler (KEIN Login): Zugriff ueber einen einzigartigen Token (Bearer-
  Secret, wie die gedruckte CardVote-Karte). Der Token identifiziert die Person.

Der Fortschritt liegt am Server (CardReview) — nur so sieht die Lehrkraft ihn,
anders als bei Anki, wo er am Geraet bleibt.
"""
import io
import secrets
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import qrcode
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, field_validator
from sqlalchemy import select, func as sa_func
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Card, CardDeck, CardReview, SchoolClass, Student, User
from .auth import get_current_user, rate_limit
from .modules import is_active

router = APIRouter(prefix="/api/karten", tags=["karten"])
MODULE_KEY = "karten"


def _now():
    return datetime.now(timezone.utc)


def _token():
    return secrets.token_urlsafe(24)  # ~32 Zeichen, unratbar


async def require_module(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> User:
    if not await is_active(db, user.id, MODULE_KEY):
        raise HTTPException(403, "Modul Karten ist nicht aktiviert")
    return user


async def _owned_class(db, user, class_id) -> SchoolClass:
    r = await db.execute(select(SchoolClass).where(SchoolClass.id == class_id, SchoolClass.owner_id == user.id))
    cls = r.scalar_one_or_none()
    if not cls:
        raise HTTPException(404, "Klasse nicht gefunden")
    return cls


async def _owned_deck(db, user, deck_id) -> CardDeck:
    r = await db.execute(select(CardDeck).where(CardDeck.id == deck_id, CardDeck.owner_id == user.id))
    d = r.scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Stapel nicht gefunden")
    return d


# ─── Lehrkraft: Stapel & Karten ───

class DeckIn(BaseModel):
    name: str = ""


class CardOut(BaseModel):
    id: int
    front: str
    back: str
    position: int
    model_config = {"from_attributes": True}


class DeckOut(BaseModel):
    id: int
    class_id: int
    name: str
    cards: List[CardOut] = []
    model_config = {"from_attributes": True}


@router.get("/classes/{class_id}/decks", response_model=List[DeckOut])
async def list_decks(class_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    from sqlalchemy.orm import selectinload
    r = await db.execute(
        select(CardDeck).where(CardDeck.owner_id == user.id, CardDeck.class_id == class_id)
        .options(selectinload(CardDeck.cards)).order_by(CardDeck.id)
    )
    return r.scalars().all()


@router.post("/classes/{class_id}/decks", response_model=DeckOut, status_code=201)
async def create_deck(class_id: int, body: DeckIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("karten_deck", f"u{user.id}", 100, 60, "Zu viele Stapel. Bitte kurz warten.")
    await _owned_class(db, user, class_id)
    deck = CardDeck(class_id=class_id, owner_id=user.id, name=body.name.strip())
    db.add(deck)
    await db.commit()
    await db.refresh(deck, ["cards"])
    return deck


@router.delete("/decks/{deck_id}", status_code=204)
async def delete_deck(deck_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    deck = await _owned_deck(db, user, deck_id)
    await db.delete(deck)
    await db.commit()


class CardIn(BaseModel):
    front: str
    back: str

    @field_validator("front", "back")
    @classmethod
    def not_too_long(cls, v: str) -> str:
        if len(v) > 5000:
            raise ValueError("Text zu lang")
        return v


@router.post("/decks/{deck_id}/cards", response_model=CardOut, status_code=201)
async def add_card(deck_id: int, body: CardIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("karten_card", f"u{user.id}", 600, 60, "Zu viele Karten. Bitte kurz warten.")
    await _owned_deck(db, user, deck_id)
    last = (await db.execute(select(Card.position).where(Card.deck_id == deck_id).order_by(Card.position.desc()))).scalars().first()
    card = Card(deck_id=deck_id, front=body.front.strip(), back=body.back.strip(), position=(last if last is not None else -1) + 1)
    db.add(card)
    await db.commit()
    await db.refresh(card)
    return card


@router.put("/cards/{card_id}", response_model=CardOut)
async def update_card(card_id: int, body: CardIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    card = await db.get(Card, card_id)
    if not card:
        raise HTTPException(404, "Karte nicht gefunden")
    await _owned_deck(db, user, card.deck_id)
    card.front = body.front.strip()
    card.back = body.back.strip()
    await db.commit()
    await db.refresh(card)
    return card


@router.delete("/cards/{card_id}", status_code=204)
async def delete_card(card_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    card = await db.get(Card, card_id)
    if not card:
        raise HTTPException(404, "Karte nicht gefunden")
    await _owned_deck(db, user, card.deck_id)
    await db.delete(card)
    await db.commit()


# ─── Tokens & QR ───

class StudentTokenOut(BaseModel):
    student_id: int
    name: str
    card_id: int
    token: str


@router.post("/classes/{class_id}/tokens", response_model=List[StudentTokenOut])
async def ensure_tokens(class_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Erzeugt fehlende Schueler-Tokens fuer die Klasse (idempotent)."""
    await _owned_class(db, user, class_id)
    students = (await db.execute(select(Student).where(Student.class_id == class_id).order_by(Student.card_id))).scalars().all()
    out = []
    changed = False
    for st in students:
        if not st.karten_token:
            st.karten_token = _token()
            changed = True
        out.append(StudentTokenOut(student_id=st.id, name=st.name, card_id=st.card_id, token=st.karten_token))
    if changed:
        await db.commit()
    return out


# ─── Lehrkraft: Fortschritt ───

class StudentProgress(BaseModel):
    student_id: int
    name: str
    reviewed: int   # wie viele Karten schon einmal gelernt
    due: int        # wie viele heute faellig


@router.get("/classes/{class_id}/progress", response_model=List[StudentProgress])
async def progress(class_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    students = (await db.execute(select(Student).where(Student.class_id == class_id).order_by(Student.card_id))).scalars().all()
    now = _now()
    out = []
    for st in students:
        reviews = (await db.execute(select(CardReview).where(CardReview.student_id == st.id))).scalars().all()
        out.append(StudentProgress(
            student_id=st.id, name=st.name,
            reviewed=len(reviews),
            due=len([r for r in reviews if r.due <= now]),
        ))
    return out


# ─── Schueler: Token-Zugang (KEIN Login) ───

async def _student_by_token(db: AsyncSession, token: str) -> Student:
    if not token:
        raise HTTPException(401, "Kein Token")
    r = await db.execute(select(Student).where(Student.karten_token == token))
    st = r.scalar_one_or_none()
    if not st:
        raise HTTPException(401, "Ungültiger Token")
    return st


class StudentCard(BaseModel):
    card_id: int
    front: str
    back: str


@router.get("/qr/{token}.png")
async def qr_png(token: str, base: str = "", db: AsyncSession = Depends(get_db)):
    """QR eines Lern-Links. Kein Login: der Token im Link ist ohnehin das
    Secret, die Lehrkraft haelt ihn bereits. base = origin des Rahmens."""
    st = await _student_by_token(db, token)  # 401 bei ungueltigem Token
    # Nur die eigene Origin zulassen, kein offener QR-Generator.
    base = base.rstrip("/")
    if base and not (base.startswith("http://") or base.startswith("https://")):
        base = ""
    url = f"{base}/lernen/{st.karten_token}"
    img = qrcode.make(url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


@router.get("/lernen/{token}")
async def student_session(token: str, db: AsyncSession = Depends(get_db)):
    """Faellige Karten fuer diesen Schueler. Token statt Login."""
    st = await _student_by_token(db, token)
    # Alle Karten der Stapel dieser Klasse.
    decks = (await db.execute(select(CardDeck.id).where(CardDeck.class_id == st.class_id))).scalars().all()
    if not decks:
        return {"name": st.name, "cards": []}
    cards = (await db.execute(select(Card).where(Card.deck_id.in_(decks)).order_by(Card.position))).scalars().all()
    reviews = {r.card_id: r for r in (await db.execute(select(CardReview).where(CardReview.student_id == st.id))).scalars().all()}
    now = _now()
    faellig = []
    for c in cards:
        rev = reviews.get(c.id)
        if rev is None or rev.due <= now:
            faellig.append({"card_id": c.id, "front": c.front, "back": c.back})
    return {"name": st.name, "cards": faellig, "total": len(cards)}


class ReviewIn(BaseModel):
    card_id: int
    # 0 = nochmal (falsch), 1 = schwer, 2 = gut, 3 = leicht
    grade: int

    @field_validator("grade")
    @classmethod
    def grade_ok(cls, v: int) -> int:
        if v not in (0, 1, 2, 3):
            raise ValueError("grade muss 0–3 sein")
        return v


@router.post("/lernen/{token}/review")
async def submit_review(token: str, body: ReviewIn, db: AsyncSession = Depends(get_db)):
    """SM-2-Schritt fuer eine Karte."""
    st = await _student_by_token(db, token)
    card = await db.get(Card, body.card_id)
    if not card:
        raise HTTPException(404, "Karte nicht gefunden")
    # Gehoert die Karte zur Klasse des Schuelers?
    deck = await db.get(CardDeck, card.deck_id)
    if not deck or deck.class_id != st.class_id:
        raise HTTPException(403, "Karte gehört nicht zu dieser Klasse")

    rev = (await db.execute(select(CardReview).where(
        CardReview.student_id == st.id, CardReview.card_id == card.id
    ))).scalar_one_or_none()
    if rev is None:
        rev = CardReview(student_id=st.id, card_id=card.id)
        db.add(rev)

    # SM-2 (vereinfacht): grade 0 zuruecksetzen, sonst Intervall/Ease anpassen.
    now = _now()
    if body.grade == 0:
        rev.reps = 0
        rev.interval_days = 0
        rev.lapses += 1
        rev.ease = max(130, rev.ease - 20)
        rev.due = now + timedelta(minutes=10)
    else:
        q = body.grade + 2  # 1..3 -> SM-2 q 3..5
        rev.ease = max(130, rev.ease + (q - 3) * 8 - (5 - q) * 2)
        rev.reps += 1
        if rev.reps == 1:
            rev.interval_days = 1
        elif rev.reps == 2:
            rev.interval_days = 3
        else:
            rev.interval_days = max(1, round(rev.interval_days * rev.ease / 100))
        rev.due = now + timedelta(days=rev.interval_days)
    rev.last_reviewed = now
    await db.commit()
    return {"ok": True, "interval_days": rev.interval_days}
