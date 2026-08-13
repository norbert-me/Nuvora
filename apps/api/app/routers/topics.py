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
from ..models import (
    Question, Topic, User, CardDeck, Exercise, CalendarEntry, CodePuzzle,
    LearningLadder, LearningPath, GradeCategory, Method, TimetableSlot, Material,
    QuestionSetItem, QuestionSet,
)
from .auth import get_current_user, rate_limit
from .modules import is_active

router = APIRouter(prefix="/api/topics", tags=["topics"])


class TopicIn(BaseModel):
    name: str
    parent_id: Optional[int] = None
    notes: str = ""
    # Anforderungen nach Niveau: was alle koennen muessen (G) und was im
    # E-Kurs dazukommt. Steht am Thema, nicht in der Jahresplanung.
    ziel_g: str = ""
    ziel_e: str = ""

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name darf nicht leer sein")
        if len(v) > 120:
            raise ValueError("Name ist zu lang (max. 120 Zeichen)")
        return v

    @field_validator("notes")
    @classmethod
    def notes_max(cls, v: str) -> str:
        if v and len(v) > 500:
            raise ValueError("Notiz ist zu lang (max. 500 Zeichen)")
        return v

    @field_validator("ziel_g", "ziel_e")
    @classmethod
    def ziel_max(cls, v: str) -> str:
        if v and len(v) > 500:
            raise ValueError("Anforderung ist zu lang (max. 500 Zeichen)")
        return v


class TopicOut(BaseModel):
    id: int
    name: str
    parent_id: Optional[int]
    position: int
    notes: str = ""
    ziel_g: str = ""
    ziel_e: str = ""
    # Wie viele CardVote-Fragen haengen an diesem Thema? Macht sichtbar, was
    # ein Loeschen kostet.
    question_count: int = 0
    model_config = {"from_attributes": True}


async def _owned(db: AsyncSession, user: User, topic_id: int) -> Topic:
    result = await db.execute(
        select(Topic).where(Topic.id == topic_id, Topic.owner_id == user.id,
                            Topic.deleted_at.is_(None))
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
                .where(Question.owner_id == user.id, Question.topic_id.isnot(None),
                       Question.deleted_at.is_(None))
                .group_by(Question.topic_id)
            )
        ).all()
    )
    result = await db.execute(
        select(Topic)
        .where(Topic.owner_id == user.id, Topic.deleted_at.is_(None))
        .order_by(Topic.position, Topic.name)
    )
    return [
        TopicOut(
            id=t.id, name=t.name, parent_id=t.parent_id, position=t.position,
            notes=t.notes or "", ziel_g=t.ziel_g or "", ziel_e=t.ziel_e or "",
            question_count=counts.get(t.id, 0),
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
        ziel_g=data.ziel_g or "", ziel_e=data.ziel_e or "",
    )
    db.add(topic)
    await db.commit()
    await db.refresh(topic)
    return TopicOut(id=topic.id, name=topic.name, parent_id=topic.parent_id, position=topic.position,
                    notes=topic.notes or "", ziel_g=topic.ziel_g or "", ziel_e=topic.ziel_e or "")


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
    # Ein Oberthema zeigt auch, was an seinen Unterthemen haengt. Sonst steht
    # ueberall "Nichts vorhanden", obwohl die Inhalte eine Ebene tiefer liegen —
    # und genau so sieht man ein Fach normalerweise an: mit allem darunter.
    kinder = (await db.execute(
        select(Topic.id).where(Topic.owner_id == user.id, Topic.parent_id == topic.id,
                               Topic.deleted_at.is_(None))
    )).scalars().all()
    themen_ids = [topic.id, *kinder]
    out = {
        "id": topic.id,
        "name": (f"{par.name} / {topic.name}" if par else topic.name),
        "mit_unterthemen": len(kinder),
        "active": {},
    }

    async def on(key):
        active = await is_active(db, user.id, key)
        out["active"][key] = active
        return active

    if await on("cardvote"):
        rows = (await db.execute(select(Question).where(
            Question.owner_id == user.id, Question.topic_id.in_(themen_ids),
            Question.deleted_at.is_(None)).limit(50))).scalars().all()
        # Das Quiz dazu, damit die Ansicht auf die Frage verlinken kann: der
        # Fragen-Editor oeffnet ein Set (`?set=`), eine Frage allein hat keinen
        # Ort. Eine Frage kann in mehreren Quizzen stecken — genommen wird das
        # erste; ohne Quiz bleibt `set_id` leer und die Zeile ist kein Link.
        #
        # Der Name des Quiz steht mit dabei, und zwar aus einem handfesten
        # Grund: dasselbe Thema kann acht Fragen haben, von denen nur fuenf in
        # einem Quiz stecken — dann sehen zwei gleich lautende Zeilen wie ein
        # Anzeigefehler aus. Mit „in keinem Quiz" daneben ist es eine Aussage.
        sets = {}
        if rows:
            for qid, sid, sname in (await db.execute(
                select(QuestionSetItem.question_id, QuestionSet.id, QuestionSet.name)
                .join(QuestionSet, QuestionSetItem.question_set_id == QuestionSet.id)
                .where(QuestionSetItem.question_id.in_([q.id for q in rows]))
                .order_by(QuestionSet.id)
            )).all():
                sets.setdefault(qid, (sid, sname))
        out["cardvote"] = [{"id": q.id, "text": (q.text or "")[:120],
                            "set_id": (sets.get(q.id) or (None, None))[0],
                            "set_name": (sets.get(q.id) or (None, None))[1]} for q in rows]
    if await on("karten"):
        rows = (await db.execute(select(CardDeck).where(CardDeck.owner_id == user.id, CardDeck.topic_id.in_(themen_ids), CardDeck.deleted_at.is_(None)).limit(50))).scalars().all()
        out["karten"] = [{"id": d.id, "name": d.name, "class_id": d.class_id, "released": d.released_at is not None} for d in rows]
    if await on("lernpfad"):
        # Lernleitern (Stufen von Lernpfaden) mit diesem Thema — NICHT die einzelnen
        # Aufgaben. Der Pfadname macht sie in der Übersicht wiedererkennbar.
        rows = (await db.execute(
            select(LearningLadder, LearningPath.name)
            .join(LearningPath, LearningLadder.path_id == LearningPath.id)
            .where(LearningPath.owner_id == user.id, LearningLadder.topic_id.in_(themen_ids), LearningPath.deleted_at.is_(None))
            .order_by(LearningPath.name, LearningLadder.position).limit(50)
        )).all()
        out["lernpfad"] = [{"id": lad.id, "path": pname, "class_id": lad.class_id} for (lad, pname) in rows]
    if await on("kalender"):
        rows = (await db.execute(select(CalendarEntry).where(CalendarEntry.owner_id == user.id, CalendarEntry.topic_id.in_(themen_ids)).order_by(CalendarEntry.date.desc()).limit(50))).scalars().all()
        out["kalender"] = [{"id": e.id, "date": e.date.isoformat() if e.date else None, "title": e.title, "class_id": e.class_id} for e in rows]
    if await on("code-detektiv"):
        rows = (await db.execute(select(CodePuzzle).where(CodePuzzle.owner_id == user.id, CodePuzzle.topic_id.in_(themen_ids)).limit(50))).scalars().all()
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
    topic.ziel_g = data.ziel_g or ""
    topic.ziel_e = data.ziel_e or ""
    await db.commit()
    await db.refresh(topic)
    return TopicOut(id=topic.id, name=topic.name, parent_id=topic.parent_id, position=topic.position,
                    notes=topic.notes or "", ziel_g=topic.ziel_g or "", ziel_e=topic.ziel_e or "")


@router.delete("/{topic_id}", status_code=204)
async def delete_topic(
    topic_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Loescht das Thema samt Unterthemen. Modulinhalte bleiben, verlieren nur
    ihr Thema.

    Das ON DELETE SET NULL der Modelle allein reicht dafuer nicht: die meisten
    topic_id-Spalten sind in gewachsenen Datenbanken per ALTER TABLE
    nachgezogen (siehe _ensure_columns in main.py) und tragen dort gar keinen
    Fremdschluessel. Ohne diesen Schritt behielten Fragen, Stapel & Co. die ID
    eines Themas, das es nicht mehr gibt. Also hier ausdruecklich loesen."""
    from datetime import datetime, timezone

    topic = await _owned(db, user, topic_id)
    # Thema samt aller Nachfahren (das Loeschen kaskadiert ueber parent_id).
    ids = {topic.id}
    rand = [topic.id]
    while rand:
        kinder = (await db.execute(select(Topic.id).where(Topic.parent_id.in_(rand)))).scalars().all()
        rand = [k for k in kinder if k not in ids]
        ids.update(rand)
    ids = list(ids)
    # Weich: Thema und Unterthemen wandern in den Papierkorb (30 Tage). Die
    # topic_id der Inhalte bleibt UNANGETASTET — wuerde sie jetzt geloest, kaeme
    # das Thema leer zurueck, und das Zurueckholen waere keins. Geloest wird
    # erst beim endgueltigen Loeschen (purge_topic).
    jetzt = datetime.now(timezone.utc)
    for t in (await db.execute(select(Topic).where(Topic.id.in_(ids)))).scalars().all():
        t.deleted_at = jetzt
    await db.commit()


async def restore_topic(topic_id: int, user: User, db: AsyncSession):
    """Aus dem Papierkorb zurueck — samt Unterthemen (wie beim Loeschen)."""
    from sqlalchemy import select as _select
    topic = (await db.execute(_select(Topic).where(
        Topic.id == topic_id, Topic.owner_id == user.id))).scalar_one_or_none()
    if not topic:
        raise HTTPException(404, "Thema nicht gefunden")
    ids, rand = {topic.id}, [topic.id]
    while rand:
        kinder = (await db.execute(_select(Topic.id).where(Topic.parent_id.in_(rand)))).scalars().all()
        rand = [k for k in kinder if k not in ids]
        ids.update(rand)
    for t in (await db.execute(_select(Topic).where(Topic.id.in_(list(ids))))).scalars().all():
        t.deleted_at = None
    # Das Oberthema muss mit zurueck, sonst haengt das Unterthema im Nichts:
    # die Liste baut den Baum ueber parent_id, ein Kind ohne Elternteil faellt
    # aus der Anzeige.
    eltern = topic.parent_id
    while eltern:
        oben = await db.get(Topic, eltern)
        if not oben:
            break
        oben.deleted_at = None
        eltern = oben.parent_id
    await db.commit()


async def purge_topic(topic_id: int, user: User, db: AsyncSession):
    """Endgueltig loeschen. JETZT erst verlieren die Inhalte ihr Thema.

    Das ON DELETE SET NULL der Modelle allein reicht dafuer nicht: die meisten
    topic_id-Spalten sind in gewachsenen Datenbanken per ALTER TABLE
    nachgezogen (siehe _ensure_columns in main.py) und tragen dort gar keinen
    Fremdschluessel. Ohne diesen Schritt behielten Fragen, Stapel & Co. die ID
    eines Themas, das es nicht mehr gibt.
    """
    from sqlalchemy import update, select as _select
    topic = (await db.execute(_select(Topic).where(
        Topic.id == topic_id, Topic.owner_id == user.id))).scalar_one_or_none()
    if not topic:
        raise HTTPException(404, "Thema nicht gefunden")
    ids, rand = {topic.id}, [topic.id]
    while rand:
        kinder = (await db.execute(_select(Topic.id).where(Topic.parent_id.in_(rand)))).scalars().all()
        rand = [k for k in kinder if k not in ids]
        ids.update(rand)
    ids = list(ids)
    for modell in (Question, CardDeck, Exercise, CalendarEntry, CodePuzzle,
                   LearningLadder, GradeCategory, Method, TimetableSlot, Material):
        await db.execute(update(modell).where(modell.topic_id.in_(ids)).values(topic_id=None))
    await db.delete(topic)
    await db.commit()
