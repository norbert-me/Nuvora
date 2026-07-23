"""Kurse (Lerngruppen).

Ein Kurs bündelt Fach-Klassen derselben Lerngruppe (Mathe 7.5, Lernzeit 7.5).
Klassen im selben Kurs teilen sich Schülerliste + Anwesenheit (per Name);
Karten/Noten bleiben pro Fach-Klasse.

Mitgliedschaft ist many-to-many (Tabelle kurs_tags): eine Klasse kann in
mehreren Kursen sein. Alle Mitglieder eines Kurses teilen — es gibt keinen
Unterschied „Sharing vs. Tag" mehr.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from datetime import datetime, timezone

from ..database import get_db
from ..models import Kurs, KursTag, KursStudent, SchoolClass, Student, User
from .auth import get_current_user

router = APIRouter(prefix="/api/kurse", tags=["kurse"])


class KursIn(BaseModel):
    name: str
    niveau_aktiv: Optional[bool] = None


class NiveauIn(BaseModel):
    name: str            # Person (Anzeigename, kursweit eindeutig)
    niveau: str = ""     # "" | "E" | "G"


class ClassRef(BaseModel):
    id: int
    name: str


class KursOut(BaseModel):
    id: int
    name: str
    classes: List[ClassRef] = []
    niveau_aktiv: bool = False
    color: str = ""
    member_count: int = 0    # einzeln hinzugefügte SuS (Kurs aus Teilen von Klassen)


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


async def member_student_ids(db, kurs_id) -> set:
    """Alle SuS-IDs eines Kurses: die aller Mitgliedsklassen UND die einzeln
    hinzugefügten (kurs_students). So funktionieren Kurse aus Teilen von Klassen."""
    classes = list(await member_class_ids(db, [kurs_id]))
    ids = set()
    if classes:
        ids |= set((await db.execute(select(Student.id).where(Student.class_id.in_(classes)))).scalars().all())
    ids |= set((await db.execute(select(KursStudent.student_id).where(KursStudent.kurs_id == kurs_id))).scalars().all())
    return ids


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


async def student_kurs_ids(db, student_id, only_active=True) -> set:
    """Teilkurse (kurs_students), in denen dieser SuS EINZELN Mitglied ist —
    Kurse aus Teilen von Klassen, unabhängig von der Klassen-Zugehörigkeit."""
    ids = set((await db.execute(select(KursStudent.kurs_id).where(KursStudent.student_id == student_id))).scalars().all())
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
    from sqlalchemy import func as _f
    mc = dict((await db.execute(
        select(KursStudent.kurs_id, _f.count(KursStudent.id))
        .where(KursStudent.kurs_id.in_([k.id for k in kurse] or [-1])).group_by(KursStudent.kurs_id)
    )).all())
    return [KursOut(id=k.id, name=k.name, classes=by.get(k.id, []), niveau_aktiv=k.niveau_aktiv, color=k.color, member_count=int(mc.get(k.id, 0))) for k in kurse]


@router.get("/trash", response_model=List[KursOut])
async def list_kurs_trash(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    kurse = (await db.execute(select(Kurs).where(
        Kurs.owner_id == user.id, Kurs.deleted_at.is_not(None)).order_by(Kurs.deleted_at.desc()))).scalars().all()
    return [KursOut(id=k.id, name=k.name, classes=[], niveau_aktiv=k.niveau_aktiv, color=k.color) for k in kurse]


@router.post("", response_model=KursOut, status_code=201)
async def create_kurs(body: KursIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Name darf nicht leer sein")
    k = Kurs(owner_id=user.id, name=name[:100])
    db.add(k)
    await db.commit()
    await db.refresh(k)
    return KursOut(id=k.id, name=k.name, classes=[], niveau_aktiv=k.niveau_aktiv, color=k.color)


@router.put("/{kurs_id}", response_model=KursOut)
async def rename_kurs(kurs_id: int, body: KursIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    k = await _owned_kurs(db, user, kurs_id)
    name = (body.name or "").strip()
    if name:
        k.name = name[:100]
    if body.niveau_aktiv is not None:
        k.niveau_aktiv = bool(body.niveau_aktiv)
    await db.commit()
    return KursOut(id=k.id, name=k.name, classes=[], niveau_aktiv=k.niveau_aktiv, color=k.color)


class ColorIn(BaseModel):
    color: str = ""


@router.put("/{kurs_id}/color", response_model=KursOut)
async def set_kurs_color(kurs_id: int, body: ColorIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Kursfarbe (Stundenplan/Kalender). Alle Fach-Klassen des Kurses teilen sie."""
    k = await _owned_kurs(db, user, kurs_id)
    c = (body.color or "").strip()[:9]
    k.color = c if (c.startswith("#") and len(c) in (4, 7, 9)) else ""
    await db.commit()
    return KursOut(id=k.id, name=k.name, classes=[], niveau_aktiv=k.niveau_aktiv, color=k.color)


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


# ─── Einzelne SuS im Kurs (Kurse aus Teilen von Klassen) ───

async def _own_student(db, user, student_id) -> Student:
    s = await db.get(Student, student_id)
    if s:
        c = await db.get(SchoolClass, s.class_id)
        if c and (not c.owner_id or c.owner_id == user.id):
            return s
    raise HTTPException(404, "Schüler nicht gefunden")


@router.get("/{kurs_id}/members")
async def list_student_members(kurs_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Einzeln hinzugefügte SuS des Kurses (mit Herkunftsklasse)."""
    await _owned_kurs(db, user, kurs_id)
    sids = (await db.execute(select(KursStudent.student_id).where(KursStudent.kurs_id == kurs_id))).scalars().all()
    if not sids:
        return []
    rows = (await db.execute(
        select(Student.id, Student.name, Student.class_id, SchoolClass.name)
        .join(SchoolClass, Student.class_id == SchoolClass.id)
        .where(Student.id.in_(list(sids))).order_by(Student.name)
    )).all()
    return [{"student_id": sid, "name": n, "class_id": cid, "class_name": cn} for (sid, n, cid, cn) in rows]


@router.post("/{kurs_id}/members/{student_id}", status_code=204)
async def add_student_member(kurs_id: int, student_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Einzelnen Schüler dem Kurs hinzufügen (Teilmenge einer Klasse)."""
    await _owned_kurs(db, user, kurs_id)
    await _own_student(db, user, student_id)
    exists = (await db.execute(select(KursStudent).where(KursStudent.kurs_id == kurs_id, KursStudent.student_id == student_id))).scalar_one_or_none()
    if not exists:
        db.add(KursStudent(kurs_id=kurs_id, student_id=student_id))
        await db.commit()


@router.delete("/{kurs_id}/members/{student_id}", status_code=204)
async def remove_student_member(kurs_id: int, student_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Einzelnen Schüler aus dem Kurs entfernen."""
    await _owned_kurs(db, user, kurs_id)
    await db.execute(delete(KursStudent).where(KursStudent.kurs_id == kurs_id, KursStudent.student_id == student_id))
    await db.commit()


# ─── E-/G-Niveau (pro Kurs gepflegt, betrifft die Person) ───

@router.get("/{kurs_id}/students")
async def kurs_students(kurs_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """SuS des Kurses (per Name dedupliziert) mit ihrem E/G-Niveau. E/G ist eine
    Eigenschaft der Person, nicht der Fach-Klasse — darum hier gepflegt."""
    await _owned_kurs(db, user, kurs_id)
    sids = list(await member_student_ids(db, kurs_id))
    if not sids:
        return []
    studs = (await db.execute(select(Student).where(Student.id.in_(sids)).order_by(Student.card_id, Student.id))).scalars().all()
    out = {}
    for s in studs:
        n = s.name.strip()
        if not n:
            continue
        if n not in out:
            out[n] = {"name": n, "niveau": s.niveau or ""}
        elif not out[n]["niveau"] and s.niveau:
            out[n]["niveau"] = s.niveau
    return list(out.values())


@router.put("/{kurs_id}/niveau", status_code=204)
async def set_niveau(kurs_id: int, body: NiveauIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """E/G einer Person im Kurs setzen — wirkt auf ALLE ihre Fach-Klassen-Zeilen
    (gleicher Name), damit z.B. Karten je Niveau überall greifen."""
    await _owned_kurs(db, user, kurs_id)
    niveau = body.niveau if body.niveau in ("E", "G") else ""
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Name fehlt")
    members = list(await member_class_ids(db, [kurs_id]))
    if not members:
        return
    studs = (await db.execute(select(Student).where(Student.class_id.in_(members)))).scalars().all()
    for s in studs:
        if s.name.strip() == name:
            s.niveau = niveau
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
    return KursOut(id=k.id, name=k.name, classes=by.get(k.id, []), niveau_aktiv=k.niveau_aktiv, color=k.color)


@router.delete("/{kurs_id}/purge", status_code=204)
async def purge_kurs(kurs_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    k = await _owned_kurs(db, user, kurs_id)
    if k.deleted_at is None:
        raise HTTPException(400, "Kurs ist nicht im Papierkorb")
    await db.delete(k)
    await db.commit()
