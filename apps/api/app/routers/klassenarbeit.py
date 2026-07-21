"""Modul „Klassenarbeit auswerten".

Eine Arbeit als Aufgaben-Raster (je Aufgabe ein Thema, je SuS richtig/falsch).
Daraus je SuS ein Fehlerprofil nach Thema → gezielte Wiederholung.

Eigenständig (Regel 3): eigene Tabelle, keine Abhängigkeit. Themen aus dem Kern;
Karten (wieder fällig setzen) sind eine optionale Brücke — ohne das Modul Karten
passiert dort nichts.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import WorkAnalysis, SchoolClass, Student, Topic, User
from .auth import get_current_user, rate_limit
from .modules import is_active

router = APIRouter(prefix="/api/klassenarbeit", tags=["klassenarbeit"])
MODULE_KEY = "klassenarbeit"


async def require_module(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> User:
    if not await is_active(db, user.id, MODULE_KEY):
        raise HTTPException(403, "Modul Klassenarbeit ist nicht aktiviert")
    return user


async def _owned_class(db, user, class_id) -> SchoolClass:
    sc = await db.get(SchoolClass, class_id)
    if not sc:
        raise HTTPException(404, "Klasse nicht gefunden")
    if sc.owner_id and sc.owner_id != user.id:
        raise HTTPException(403, "Keine Berechtigung")
    return sc


async def _owned_work(db, user, work_id) -> WorkAnalysis:
    w = await db.get(WorkAnalysis, work_id)
    if not w or w.owner_id != user.id:
        raise HTTPException(404, "Arbeit nicht gefunden")
    return w


async def _roster(db, class_id):
    """Kanonische SuS des Kurses (gleichnamige Fach-Klassen-SuS dedupliziert)."""
    from .kurse import sibling_class_ids
    sib = await sibling_class_ids(db, class_id)
    studs = (await db.execute(select(Student).where(Student.class_id.in_(sib)).order_by(Student.id))).scalars().all()
    canon = {}
    for s in studs:
        canon.setdefault(s.name.strip(), s)
    return sorted(canon.values(), key=lambda s: (s.card_id, s.id))


class WorkIn(BaseModel):
    class_id: int
    kurs_id: Optional[int] = None
    name: str = ""


class WorkPut(BaseModel):
    name: Optional[str] = None
    tasks: Optional[list] = None       # [{id,label,topic_id}]
    results: Optional[dict] = None      # {student_id: [wrong_task_id]}


class WorkOut(BaseModel):
    id: int
    class_id: int
    kurs_id: Optional[int] = None
    name: str
    tasks: list = []
    results: dict = {}
    model_config = {"from_attributes": True}


def _keyw(user, class_id, kurs_id):
    if kurs_id is not None:
        return (WorkAnalysis.owner_id == user.id, WorkAnalysis.kurs_id == kurs_id)
    return (WorkAnalysis.owner_id == user.id, WorkAnalysis.class_id == class_id, WorkAnalysis.kurs_id.is_(None))


@router.get("/classes/{class_id}/students")
async def roster(class_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    return [{"id": s.id, "name": s.name} for s in await _roster(db, class_id)]


@router.get("/classes/{class_id}/works", response_model=List[WorkOut])
async def list_works(class_id: int, kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    rows = (await db.execute(select(WorkAnalysis).where(*_keyw(user, class_id, kurs_id)).order_by(WorkAnalysis.created_at.desc()))).scalars().all()
    return [WorkOut(id=w.id, class_id=w.class_id, kurs_id=w.kurs_id, name=w.name, tasks=w.tasks or [], results=w.results or {}) for w in rows]


@router.post("/works", response_model=WorkOut, status_code=201)
async def create_work(body: WorkIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("ka_work", f"u{user.id}", 100, 60, "Zu viele Arbeiten. Bitte kurz warten.")
    await _owned_class(db, user, body.class_id)
    w = WorkAnalysis(owner_id=user.id, class_id=body.class_id, kurs_id=body.kurs_id, name=(body.name or "Klassenarbeit").strip()[:200], tasks=[], results={})
    db.add(w)
    await db.commit()
    await db.refresh(w)
    return WorkOut(id=w.id, class_id=w.class_id, kurs_id=w.kurs_id, name=w.name, tasks=[], results={})


@router.put("/works/{work_id}", response_model=WorkOut)
async def update_work(work_id: int, body: WorkPut, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    w = await _owned_work(db, user, work_id)
    if body.name is not None:
        w.name = body.name.strip()[:200]
    if body.tasks is not None:
        # Themenbindung nur aufs eigene Thema; fremdes/unbekanntes → None.
        own = {t for (t,) in (await db.execute(select(Topic.id).where(Topic.owner_id == user.id))).all()}
        clean = []
        for t in body.tasks[:100]:
            if not isinstance(t, dict) or not t.get("id"):
                continue
            tid = t.get("topic_id")
            mx = t.get("max")
            mx = int(mx) if isinstance(mx, (int, float)) and 0 < mx <= 1000 else 1  # Maximalpunkte, Default 1
            clean.append({"id": str(t["id"])[:40], "label": str(t.get("label") or "")[:200],
                          "topic_id": tid if (isinstance(tid, int) and tid in own) else None, "max": mx})
        w.tasks = clean
    if body.results is not None:
        # {student_id: {task_id: erreichte Punkte}}. Altformat (Liste falscher
        # Aufgaben) wird beim Lesen (_profile) mitübersetzt, hier nur Punkte-Maps.
        out = {}
        for k, v in list(body.results.items())[:400]:
            if v == "abwesend":
                out[str(k)] = "abwesend"                 # abwesend: zählt nicht in die Auswertung
            elif isinstance(v, dict):
                out[str(k)] = {str(tid)[:40]: (float(p) if isinstance(p, (int, float)) else 0) for tid, p in list(v.items())[:200]}
            elif isinstance(v, list):
                out[str(k)] = [str(x)[:40] for x in v]  # Altformat unverändert durchreichen
        w.results = out
    await db.commit()
    await db.refresh(w)
    return WorkOut(id=w.id, class_id=w.class_id, kurs_id=w.kurs_id, name=w.name, tasks=w.tasks or [], results=w.results or {})


@router.delete("/works/{work_id}", status_code=204)
async def delete_work(work_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    w = await _owned_work(db, user, work_id)
    await db.delete(w)
    await db.commit()


# ─── Auswertung + Wiederholung ───

class RemediateIn(BaseModel):
    # Anteil falscher Aufgaben eines Themas, ab dem das Thema für den SuS "schwach" ist.
    threshold: float = 0.5
    cards: bool = True       # Karten des Themas wieder fällig (nur mit Modul Karten)
    exercises: bool = True   # Lernpfad-Wiederholungsaufgabe je Thema (nur mit Modul Lernpfad)


def _profile(work: WorkAnalysis):
    """Je SuS je Thema: (erreichte Punkte, Maximalpunkte) über die Aufgaben des
    Themas. Punkte-Modell; Altformat (Liste falscher Aufgaben) wird übersetzt
    (gelistet = 0, sonst volle Punkte)."""
    tasks = work.tasks or []
    task_max = {t["id"]: (int(t["max"]) if isinstance(t.get("max"), (int, float)) and t["max"] > 0 else 1) for t in tasks}
    topic_tasks = {}
    for t in tasks:
        if t.get("topic_id"):
            topic_tasks.setdefault(t["topic_id"], []).append(t["id"])
    results = work.results or {}

    def pts(entry, tid):
        if isinstance(entry, list):
            return 0 if tid in entry else task_max.get(tid, 1)   # Altformat
        v = (entry or {}).get(tid)
        return float(v) if isinstance(v, (int, float)) else 0    # nicht bewertet = 0

    out = {}  # student_id -> {topic_id: [erreicht, max]}
    for sid, entry in results.items():
        if entry == "abwesend":
            continue   # abwesende SuS zählen nicht in die Auswertung/Wiederholung
        prof = {}
        for topic_id, tids in topic_tasks.items():
            erreicht = sum(pts(entry, tid) for tid in tids)
            mx = sum(task_max.get(tid, 1) for tid in tids)
            prof[topic_id] = [erreicht, mx]
        out[sid] = prof
    return out, topic_tasks


@router.get("/works/{work_id}/analysis")
async def analysis(work_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Auswertung: je Thema Trefferquote der Klasse + je SuS die schwachen Themen."""
    w = await _owned_work(db, user, work_id)
    prof, topic_tasks = _profile(w)
    names = {t.id: t.name for t in (await db.execute(select(Topic).where(Topic.owner_id == user.id))).scalars().all()}
    parents = {t.id: t.parent_id for t in (await db.execute(select(Topic).where(Topic.owner_id == user.id))).scalars().all()}
    def label(tid):
        nm = names.get(tid, "?"); p = parents.get(tid)
        return f"{names.get(p)} / {nm}" if p and names.get(p) else nm
    # Klassenweit je Thema: erreichte / maximale Punkte.
    klass = {}
    for tid in topic_tasks:
        erreicht = mx = 0
        for sid, pr in prof.items():
            e, m = pr.get(tid, [0, 0]); erreicht += e; mx += m
        klass[tid] = {"topic_id": tid, "label": label(tid), "pct": round(erreicht / mx * 100) if mx else 0}
    # Je SuS schwache Themen (< 50 % der Punkte erreicht)
    studs = {s.id: s.name for s in (await db.execute(select(Student).where(Student.id.in_([int(x) for x in prof.keys()])))).scalars().all()} if prof else {}
    per_student = []
    for sid, pr in prof.items():
        schwach = [label(tid) for tid, (e, m) in pr.items() if m and e / m < 0.5]
        if schwach:
            per_student.append({"student_id": int(sid), "name": studs.get(int(sid), "?"), "weak": sorted(schwach)})
    return {"topics": sorted(klass.values(), key=lambda x: x["pct"]), "students": sorted(per_student, key=lambda x: x["name"])}


@router.post("/works/{work_id}/remediate")
async def remediate(work_id: int, body: RemediateIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Gezielte Wiederholung aus dem Fehlerprofil (Anteil falscher Aufgaben eines
    Themas ≥ Schwelle = schwach). Je aktivem Modul:
    - Karten: je SuS die Karten seiner schwachen Themen wieder fällig.
    - Lernpfad: je schwachem Thema eine Wiederholungs-Aufgabe im Pool anlegen.
    Beides Brücke (Regel 3) — ohne das jeweilige Modul passiert dort nichts.
    Bestehende Daten bleiben unberührt (nur Fälligkeiten vorziehen / neue Aufgabe)."""
    from datetime import datetime, timezone
    from sqlalchemy import update as _update
    from ..models import CardDeck, Card, CardReview, Exercise
    w = await _owned_work(db, user, work_id)
    prof, _ = _profile(w)
    weak_by_student = {}
    for sid, pr in prof.items():
        weak = {tid for tid, (e, m) in pr.items() if m and e / m < body.threshold}
        if weak:
            weak_by_student[int(sid)] = weak
    all_topics = set().union(*weak_by_student.values()) if weak_by_student else set()

    requeued = 0
    if body.cards and weak_by_student and await is_active(db, user.id, "karten"):
        deck_by_topic = {}
        for tid in all_topics:
            ids = (await db.execute(select(CardDeck.id).where(
                CardDeck.owner_id == user.id, CardDeck.topic_id == tid, CardDeck.deleted_at.is_(None)))).scalars().all()
            if ids:
                deck_by_topic[tid] = ids
        now = datetime.now(timezone.utc)
        for sid, topics in weak_by_student.items():
            deck_ids = [d for tid in topics for d in deck_by_topic.get(tid, [])]
            if not deck_ids:
                continue
            card_ids = (await db.execute(select(Card.id).where(Card.deck_id.in_(deck_ids)))).scalars().all()
            if not card_ids:
                continue
            res = await db.execute(_update(CardReview).where(
                CardReview.student_id == sid, CardReview.card_id.in_(card_ids), CardReview.reps > 0).values(due=now))
            requeued += res.rowcount or 0

    exercises = 0
    if body.exercises and all_topics and await is_active(db, user.id, "lernpfad"):
        names = {t.id: t.name for t in (await db.execute(select(Topic).where(Topic.id.in_(list(all_topics))))).scalars().all()}
        for tid in all_topics:
            text = f"Wiederholung: {names.get(tid, '')} (aus {w.name})"
            # Dedup: dieselbe Wiederholungsaufgabe nicht doppelt anlegen.
            exists = (await db.execute(select(Exercise.id).where(
                Exercise.owner_id == user.id, Exercise.topic_id == tid, Exercise.aufgabentext == text))).scalar_one_or_none()
            if exists:
                continue
            db.add(Exercise(owner_id=user.id, topic_id=tid, kategorie="Wiederholung", aufgabentext=text))
            exercises += 1

    await db.commit()
    return {"students": len(weak_by_student), "cards_requeued": requeued, "exercises_created": exercises}
