"""Kurse (Lerngruppen) — Phase 1: Fach-Klassen zu einem Kurs gruppieren.

Ein Kurs bündelt Fach-Klassen, die dieselbe Lerngruppe unterrichten (Mathe 7.5,
Lernzeit 7.5). Phase 1 verwaltet nur die Zuordnung Klasse↔Kurs; das Teilen von
Schülerliste und Anwesenheit über den Kurs kommt in Phase 2.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from datetime import datetime, timezone

from ..database import get_db
from ..models import Kurs, KursTag, SchoolClass, Student, User
from .auth import get_current_user

router = APIRouter(prefix="/api/kurse", tags=["kurse"])


class KursIn(BaseModel):
    name: str


class ClassRef(BaseModel):
    id: int
    name: str
    shared: bool = True   # True = Sharing-Klasse (SuS/Anwesenheit), False = loses Tag


class KursOut(BaseModel):
    id: int
    name: str
    classes: List[ClassRef] = []


async def _owned_kurs(db, user, kurs_id) -> Kurs:
    k = await db.get(Kurs, kurs_id)
    if not k or k.owner_id != user.id:
        raise HTTPException(404, "Kurs nicht gefunden")
    return k


async def _kurs_classes(db, user, kurse):
    """Je Kurs: Sharing-Klassen (kurs_id) shared=True + getaggte shared=False."""
    classes = {c.id: c for c in (await db.execute(select(SchoolClass).where(
        SchoolClass.owner_id == user.id, SchoolClass.deleted_at.is_(None)))).scalars().all()}
    tags = (await db.execute(select(KursTag).where(KursTag.kurs_id.in_([k.id for k in kurse] or [-1])))).scalars().all()
    out = {}
    for c in classes.values():
        if c.kurs_id:
            out.setdefault(c.kurs_id, []).append(ClassRef(id=c.id, name=c.name, shared=True))
    for tg in tags:
        c = classes.get(tg.class_id)
        if c and c.kurs_id != tg.kurs_id:  # Sharing-Klasse nicht doppelt als Tag zeigen
            out.setdefault(tg.kurs_id, []).append(ClassRef(id=c.id, name=c.name, shared=False))
    return out


@router.get("", response_model=List[KursOut])
async def list_kurse(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    kurse = (await db.execute(select(Kurs).where(
        Kurs.owner_id == user.id, Kurs.deleted_at.is_(None)).order_by(Kurs.name))).scalars().all()
    by_kurs = await _kurs_classes(db, user, kurse)
    return [KursOut(id=k.id, name=k.name, classes=by_kurs.get(k.id, [])) for k in kurse]


@router.get("/trash", response_model=List[KursOut])
async def list_kurs_trash(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    kurse = (await db.execute(select(Kurs).where(
        Kurs.owner_id == user.id, Kurs.deleted_at.is_not(None)).order_by(Kurs.deleted_at.desc()))).scalars().all()
    return [KursOut(id=k.id, name=k.name, classes=[]) for k in kurse]


@router.post("", response_model=KursOut, status_code=201)
async def create_kurs(body: KursIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Name darf nicht leer sein")
    k = Kurs(owner_id=user.id, name=name[:100])
    db.add(k)
    await db.commit()
    await db.refresh(k)
    return KursOut(id=k.id, name=k.name, classes=[])


@router.put("/{kurs_id}", response_model=KursOut)
async def rename_kurs(kurs_id: int, body: KursIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    k = await _owned_kurs(db, user, kurs_id)
    name = (body.name or "").strip()
    if name:
        k.name = name[:100]
    await db.commit()
    return KursOut(id=k.id, name=k.name, classes=[])


async def _own_class(db, user, class_id) -> SchoolClass:
    c = await db.get(SchoolClass, class_id)
    if not c or (c.owner_id and c.owner_id != user.id):
        raise HTTPException(404, "Klasse nicht gefunden")
    return c


@router.post("/{kurs_id}/classes/{class_id}", status_code=204)
async def assign_class(kurs_id: int, class_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Klasse diesem Kurs zuordnen (in die Lerngruppe aufnehmen)."""
    await _owned_kurs(db, user, kurs_id)
    c = await _own_class(db, user, class_id)
    c.kurs_id = kurs_id
    # Schüler der Klasse in den Kurs übernehmen (geteilte Anwesenheit).
    await db.execute(update(Student).where(Student.class_id == class_id).values(kurs_id=kurs_id))
    await db.commit()


@router.delete("/classes/{class_id}", status_code=204)
async def unlink_class(class_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Klasse aus ihrem Kurs lösen — sie bekommt wieder einen eigenen Kurs."""
    c = await _own_class(db, user, class_id)
    k = Kurs(owner_id=user.id, name=c.name)
    db.add(k)
    await db.flush()
    c.kurs_id = k.id
    await db.execute(update(Student).where(Student.class_id == class_id).values(kurs_id=k.id))
    await db.commit()


# ─── Lose Tags: Klasse in weitere Kurse (ohne Sharing) ───

@router.post("/{kurs_id}/tag/{class_id}", status_code=204)
async def add_tag(kurs_id: int, class_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await _owned_kurs(db, user, kurs_id)
    c = await _own_class(db, user, class_id)
    if c.kurs_id == kurs_id:
        return  # ist schon Sharing-Mitglied
    exists = (await db.execute(select(KursTag).where(KursTag.kurs_id == kurs_id, KursTag.class_id == class_id))).scalar_one_or_none()
    if not exists:
        db.add(KursTag(kurs_id=kurs_id, class_id=class_id))
        await db.commit()


@router.delete("/{kurs_id}/tag/{class_id}", status_code=204)
async def remove_tag(kurs_id: int, class_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await _owned_kurs(db, user, kurs_id)
    row = (await db.execute(select(KursTag).where(KursTag.kurs_id == kurs_id, KursTag.class_id == class_id))).scalar_one_or_none()
    if row:
        await db.delete(row)
        await db.commit()


# ─── Kurs löschen / Papierkorb ───

@router.delete("/{kurs_id}", status_code=204)
async def delete_kurs(kurs_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """In den Papierkorb (30 Tage). Die Sharing-Klassen werden entgruppiert
    (jede bekommt einen eigenen Kurs); beim Wiederherstellen kommen sie zurück."""
    k = await _owned_kurs(db, user, kurs_id)
    members = (await db.execute(select(SchoolClass).where(SchoolClass.kurs_id == kurs_id))).scalars().all()
    k.deleted_members = [c.id for c in members]
    for c in members:
        solo = Kurs(owner_id=user.id, name=c.name)
        db.add(solo)
        await db.flush()
        c.kurs_id = solo.id
        await db.execute(update(Student).where(Student.class_id == c.id).values(kurs_id=solo.id))
    # Tags bleiben an diesem Kurs hängen (CASCADE bei purge, greifen wieder bei restore).
    k.deleted_at = datetime.now(timezone.utc)
    await db.commit()


@router.post("/{kurs_id}/restore", response_model=KursOut)
async def restore_kurs(kurs_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    k = await _owned_kurs(db, user, kurs_id)
    for cid in (k.deleted_members or []):
        c = await db.get(SchoolClass, cid)
        if c and c.owner_id == user.id and c.deleted_at is None:
            c.kurs_id = kurs_id
            await db.execute(update(Student).where(Student.class_id == cid).values(kurs_id=kurs_id))
    k.deleted_at = None
    k.deleted_members = None
    await db.commit()
    by = await _kurs_classes(db, user, [k])
    return KursOut(id=k.id, name=k.name, classes=by.get(k.id, []))


@router.delete("/{kurs_id}/purge", status_code=204)
async def purge_kurs(kurs_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    k = await _owned_kurs(db, user, kurs_id)
    if k.deleted_at is None:
        raise HTTPException(400, "Kurs ist nicht im Papierkorb")
    await db.delete(k)
    await db.commit()
