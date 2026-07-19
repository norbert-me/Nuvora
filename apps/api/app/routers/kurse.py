"""Kurse (Lerngruppen).

Ein Kurs bündelt Fach-Klassen derselben Lerngruppe (Mathe 7.5, Lernzeit 7.5).
Klassen im selben Kurs teilen sich Schülerliste + Anwesenheit (per Name);
Karten/Noten bleiben pro Fach-Klasse.

Mitgliedschaft ist many-to-many (Tabelle kurs_tags): eine Klasse kann in
mehreren Kursen sein. Alle Mitglieder eines Kurses teilen — es gibt keinen
Unterschied „Sharing vs. Tag" mehr.
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from datetime import datetime, timezone

from ..database import get_db
from ..models import Kurs, KursTag, SchoolClass, User
from .auth import get_current_user

router = APIRouter(prefix="/api/kurse", tags=["kurse"])


class KursIn(BaseModel):
    name: str


class ClassRef(BaseModel):
    id: int
    name: str


class KursOut(BaseModel):
    id: int
    name: str
    classes: List[ClassRef] = []


async def _owned_kurs(db, user, kurs_id) -> Kurs:
    k = await db.get(Kurs, kurs_id)
    if not k or k.owner_id != user.id:
        raise HTTPException(404, "Kurs nicht gefunden")
    return k


async def _own_class(db, user, class_id) -> SchoolClass:
    c = await db.get(SchoolClass, class_id)
    if not c or (c.owner_id and c.owner_id != user.id):
        raise HTTPException(404, "Klasse nicht gefunden")
    return c


# ─── Mitgliedschaft (wird auch von Anwesenheit/Klassen genutzt) ───

async def member_class_ids(db, kurs_ids) -> set:
    """Klassen-IDs, die Mitglied eines der Kurse sind (kurs_tags ∪ altes kurs_id)."""
    if not kurs_ids:
        return set()
    kurs_ids = list(kurs_ids)
    a = (await db.execute(select(KursTag.class_id).where(KursTag.kurs_id.in_(kurs_ids)))).scalars().all()
    b = (await db.execute(select(SchoolClass.id).where(SchoolClass.kurs_id.in_(kurs_ids)))).scalars().all()
    return set(a) | set(b)


async def class_kurs_ids(db, class_id, only_active=True) -> set:
    """Kurse (nicht gelöscht), in denen die Klasse Mitglied ist (kurs_tags ∪ kurs_id)."""
    ids = set((await db.execute(select(KursTag.kurs_id).where(KursTag.class_id == class_id))).scalars().all())
    sc = await db.get(SchoolClass, class_id)
    if sc and sc.kurs_id:
        ids.add(sc.kurs_id)
    if only_active and ids:
        alive = set((await db.execute(select(Kurs.id).where(Kurs.id.in_(list(ids)), Kurs.deleted_at.is_(None)))).scalars().all())
        return ids & alive
    return ids


async def sibling_class_ids(db, class_id) -> set:
    """Alle Klassen, die mit dieser einen Kurs teilen (inkl. sich selbst)."""
    kurse = await class_kurs_ids(db, class_id)
    ids = await member_class_ids(db, kurse)
    ids.add(class_id)
    return ids


async def _classes_by_kurs(db, user, kurse):
    names = {c.id: c.name for c in (await db.execute(select(SchoolClass).where(
        SchoolClass.owner_id == user.id, SchoolClass.deleted_at.is_(None)))).scalars().all()}
    tags = (await db.execute(select(KursTag).where(KursTag.kurs_id.in_([k.id for k in kurse] or [-1])))).scalars().all()
    out = {}
    for tg in tags:
        if tg.class_id in names:
            out.setdefault(tg.kurs_id, []).append(ClassRef(id=tg.class_id, name=names[tg.class_id]))
    return out


@router.get("", response_model=List[KursOut])
async def list_kurse(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    kurse = (await db.execute(select(Kurs).where(
        Kurs.owner_id == user.id, Kurs.deleted_at.is_(None)).order_by(Kurs.name))).scalars().all()
    by = await _classes_by_kurs(db, user, kurse)
    return [KursOut(id=k.id, name=k.name, classes=by.get(k.id, [])) for k in kurse]


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


@router.post("/{kurs_id}/classes/{class_id}", status_code=204)
async def add_member(kurs_id: int, class_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Klasse dem Kurs hinzufügen. Eine Klasse darf in mehreren Kursen sein."""
    await _owned_kurs(db, user, kurs_id)
    await _own_class(db, user, class_id)
    exists = (await db.execute(select(KursTag).where(KursTag.kurs_id == kurs_id, KursTag.class_id == class_id))).scalar_one_or_none()
    if not exists:
        db.add(KursTag(kurs_id=kurs_id, class_id=class_id))
        await db.commit()


@router.delete("/{kurs_id}/classes/{class_id}", status_code=204)
async def remove_member(kurs_id: int, class_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Klasse aus diesem Kurs entfernen (bleibt in ihren anderen Kursen)."""
    await _owned_kurs(db, user, kurs_id)
    await db.execute(delete(KursTag).where(KursTag.kurs_id == kurs_id, KursTag.class_id == class_id))
    await db.commit()


# ─── Kurs löschen / Papierkorb ───

@router.delete("/{kurs_id}", status_code=204)
async def delete_kurs(kurs_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """In den Papierkorb (30 Tage). Die Mitgliedschaften werden entfernt (die
    Klassen bleiben, ggf. in ihren anderen Kursen); Restore stellt sie wieder her."""
    from sqlalchemy import update
    k = await _owned_kurs(db, user, kurs_id)
    members = list(await member_class_ids(db, [kurs_id]))
    k.deleted_members = members
    await db.execute(delete(KursTag).where(KursTag.kurs_id == kurs_id))
    await db.execute(update(SchoolClass).where(SchoolClass.kurs_id == kurs_id).values(kurs_id=None))
    k.deleted_at = datetime.now(timezone.utc)
    await db.commit()


@router.post("/{kurs_id}/restore", response_model=KursOut)
async def restore_kurs(kurs_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    k = await _owned_kurs(db, user, kurs_id)
    for cid in (k.deleted_members or []):
        c = await db.get(SchoolClass, cid)
        if c and c.owner_id == user.id and c.deleted_at is None:
            exists = (await db.execute(select(KursTag).where(KursTag.kurs_id == kurs_id, KursTag.class_id == cid))).scalar_one_or_none()
            if not exists:
                db.add(KursTag(kurs_id=kurs_id, class_id=cid))
    k.deleted_at = None
    k.deleted_members = None
    await db.commit()
    by = await _classes_by_kurs(db, user, [k])
    return KursOut(id=k.id, name=k.name, classes=by.get(k.id, []))


@router.delete("/{kurs_id}/purge", status_code=204)
async def purge_kurs(kurs_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    k = await _owned_kurs(db, user, kurs_id)
    if k.deleted_at is None:
        raise HTTPException(400, "Kurs ist nicht im Papierkorb")
    await db.delete(k)
    await db.commit()
