"""Nuvora-Kern: Themen.

Der gemeinsame Wortschatz beider Module. Themen gehoeren dem Kern, nicht
CardVote und nicht Lernpfad — nur deshalb kann ein in CardVote schwach
ausgefallenes Thema spaeter passende Lernpfad-Aufgaben nach sich ziehen.

Hierarchie ueber parent_id. Lernpfad nutzt heute zwei Ebenen (Thema >
Unterthema); erzwungen wird das nicht.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select, func as sa_func
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Question, Topic, User, CardDeck, Exercise, CalendarEntry, CodePuzzle
from .auth import get_current_user, rate_limit
from .modules import is_active

router = APIRouter(prefix="/api/topics", tags=["topics"])


class TopicIn(BaseModel):
    name: str
    parent_id: Optional[int] = None
    notes: str = ""

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name darf nicht leer sein")
        if len(v) > 120:
            raise ValueError("Name ist zu lang (max. 120 Zeichen)")
        return v


class TopicOut(BaseModel):
    id: int
    name: str
    parent_id: Optional[int]
    position: int
    notes: str = ""
    # Wie viele CardVote-Fragen haengen an diesem Thema? Macht sichtbar, was
    # ein Loeschen kostet.
    question_count: int = 0
    model_config = {"from_attributes": True}


async def _owned(db: AsyncSession, user: User, topic_id: int) -> Topic:
    result = await db.execute(
        select(Topic).where(Topic.id == topic_id, Topic.owner_id == user.id)
    )
    topic = result.scalar_one_or_none()
    if not topic:
        raise HTTPException(404, "Thema nicht gefunden")
    return topic


async def _would_cycle(db: AsyncSession, topic_id: int, new_parent_id: int) -> bool:
    """Haengt new_parent unter topic? Dann wuerde der Zug einen Kreis bauen."""
    current: Optional[int] = new_parent_id
    seen = set()
    while current is not None:
        if current == topic_id:
            return True
        if current in seen:  # kaputte Daten: nicht endlos laufen
            return True
        seen.add(current)
        result = await db.execute(select(Topic.parent_id).where(Topic.id == current))
        current = result.scalar_one_or_none()
    return False


@router.get("", response_model=List[TopicOut])
async def list_topics(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Flache Liste — der Baum wird im Frontend aus parent_id gebaut."""
    counts = dict(
        (
            await db.execute(
                select(Question.topic_id, sa_func.count(Question.id))
                .where(Question.owner_id == user.id, Question.topic_id.isnot(None))
                .group_by(Question.topic_id)
            )
        ).all()
    )
    result = await db.execute(
        select(Topic)
        .where(Topic.owner_id == user.id)
        .order_by(Topic.position, Topic.name)
    )
    return [
        TopicOut(
            id=t.id, name=t.name, parent_id=t.parent_id, position=t.position,
            notes=t.notes or "", question_count=counts.get(t.id, 0),
        )
        for t in result.scalars().all()
    ]


@router.post("", response_model=TopicOut, status_code=201)
async def create_topic(
    data: TopicIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rate_limit("topic_create", f"u{user.id}", 600, 60, "Zu viele Themen in kurzer Zeit. Bitte kurz warten.")
    if data.parent_id is not None:
        await _owned(db, user, data.parent_id)

    dup = await db.execute(
        select(Topic.id).where(
            Topic.owner_id == user.id,
            Topic.parent_id.is_(data.parent_id) if data.parent_id is None else Topic.parent_id == data.parent_id,
            sa_func.lower(Topic.name) == data.name.lower(),
        )
    )
    if dup.scalar_one_or_none():
        raise HTTPException(409, "Dieses Thema gibt es an dieser Stelle schon")

    last = await db.execute(
        select(sa_func.max(Topic.position)).where(
            Topic.owner_id == user.id,
            Topic.parent_id.is_(None) if data.parent_id is None else Topic.parent_id == data.parent_id,
        )
    )
    topic = Topic(
        name=data.name, parent_id=data.parent_id, owner_id=user.id,
        position=(last.scalar_one_or_none() or 0) + 1, notes=data.notes or "",
    )
    db.add(topic)
    await db.commit()
    await db.refresh(topic)
    return TopicOut(id=topic.id, name=topic.name, parent_id=topic.parent_id, position=topic.position, notes=topic.notes or "")


class ReorderIn(BaseModel):
    ids: List[int]


@router.get("/{topic_id}/usage")
async def topic_usage(topic_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Modulübergreifende Themen-Ansicht: was hängt alles an diesem Thema?
    Nur Abschnitte aktiver Module (Regel 3). Das Thema gehört dem Kern, die
    Module arbeiten darauf."""
    topic = await _owned(db, user, topic_id)
    par = None
    if topic.parent_id:
        par = (await db.execute(select(Topic).where(Topic.id == topic.parent_id))).scalar_one_or_none()
    out = {
        "id": topic.id,
        "name": (f"{par.name} / {topic.name}" if par else topic.name),
        "active": {},
    }

    async def on(key):
        active = await is_active(db, user.id, key)
        out["active"][key] = active
        return active

    if await on("cardvote"):
        rows = (await db.execute(select(Question).where(Question.owner_id == user.id, Question.topic_id == topic_id).limit(50))).scalars().all()
        out["cardvote"] = [{"id": q.id, "text": (q.text or "")[:120]} for q in rows]
    if await on("karten"):
        rows = (await db.execute(select(CardDeck).where(CardDeck.owner_id == user.id, CardDeck.topic_id == topic_id, CardDeck.deleted_at.is_(None)).limit(50))).scalars().all()
        out["karten"] = [{"id": d.id, "name": d.name, "class_id": d.class_id, "released": d.released_at is not None} for d in rows]
    if await on("lernpfad"):
        rows = (await db.execute(select(Exercise).where(Exercise.owner_id == user.id, Exercise.topic_id == topic_id).limit(50))).scalars().all()
        out["lernpfad"] = [{"id": e.id, "code": e.code, "text": (e.aufgabentext or "")[:120], "kategorie": e.kategorie} for e in rows]
    if await on("kalender"):
        rows = (await db.execute(select(CalendarEntry).where(CalendarEntry.owner_id == user.id, CalendarEntry.topic_id == topic_id).order_by(CalendarEntry.date.desc()).limit(50))).scalars().all()
        out["kalender"] = [{"id": e.id, "date": e.date.isoformat() if e.date else None, "title": e.title, "class_id": e.class_id} for e in rows]
    if await on("code-detektiv"):
        rows = (await db.execute(select(CodePuzzle).where(CodePuzzle.owner_id == user.id, CodePuzzle.topic_id == topic_id).limit(50))).scalars().all()
        out["codedetektiv"] = [{"id": p.id, "client_id": p.client_id, "title": p.title} for p in rows]
    return out


@router.put("/reorder", status_code=204)
async def reorder_topics(body: ReorderIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Setzt die Reihenfolge anhand der ID-Liste (nur eigene Themen)."""
    result = await db.execute(select(Topic).where(Topic.owner_id == user.id, Topic.id.in_(body.ids)))
    by_id = {t.id: t for t in result.scalars().all()}
    for pos, tid in enumerate(body.ids):
        if tid in by_id:
            by_id[tid].position = pos
    await db.commit()


@router.put("/{topic_id}", response_model=TopicOut)
async def update_topic(
    topic_id: int,
    data: TopicIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    topic = await _owned(db, user, topic_id)

    if data.parent_id is not None:
        if data.parent_id == topic_id:
            raise HTTPException(400, "Ein Thema kann nicht sein eigenes Oberthema sein")
        await _owned(db, user, data.parent_id)
        if await _would_cycle(db, topic_id, data.parent_id):
            raise HTTPException(400, "Ein Thema kann nicht unter eines seiner Unterthemen ziehen")

    topic.name = data.name
    topic.parent_id = data.parent_id
    topic.notes = data.notes or ""
    await db.commit()
    await db.refresh(topic)
    return TopicOut(id=topic.id, name=topic.name, parent_id=topic.parent_id, position=topic.position, notes=topic.notes or "")


@router.delete("/{topic_id}", status_code=204)
async def delete_topic(
    topic_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Loescht das Thema samt Unterthemen. Fragen bleiben, verlieren nur ihr
    Thema (FK ist ON DELETE SET NULL) — Modulinhalte gehen nie verloren, weil
    im Kern aufgeraeumt wird."""
    topic = await _owned(db, user, topic_id)
    await db.delete(topic)
    await db.commit()
