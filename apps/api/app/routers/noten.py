"""Modul Noten — Leistungsbewertung auf dem Nuvora-Kern.

Eigenstaendig nutzbar: ohne CardVote, ohne Lernpfad (Regel 3). Der Kern liefert
Klassen und Schueler, das Modul haelt Kategorien, Noten und Beobachtungen.

Was das Modul bewusst NICHT tut: die Zeugnisnote ausrechnen. Kriterien wie
"Anstrengungsbereitschaft" lassen sich nicht mitteln, und ein Schnitt aus
Beobachtungen waere Scheinobjektivitaet. Es rechnet den gewichteten Schnitt der
eingetragenen NOTEN — die Entscheidung bleibt bei der Lehrkraft.
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import GradeCategory, GradeEntry, SchoolClass, Student, User
from .auth import get_current_user, rate_limit
from .modules import is_active

router = APIRouter(prefix="/api/noten", tags=["noten"])

MODULE_KEY = "noten"


async def require_module(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not await is_active(db, user.id, MODULE_KEY):
        raise HTTPException(403, "Modul Noten ist nicht aktiviert")
    return user


async def _owned_class(db: AsyncSession, user: User, class_id: int) -> SchoolClass:
    result = await db.execute(
        select(SchoolClass).where(SchoolClass.id == class_id, SchoolClass.owner_id == user.id)
    )
    cls = result.scalar_one_or_none()
    if not cls:
        raise HTTPException(404, "Klasse nicht gefunden")
    return cls


async def _owned_category(db: AsyncSession, user: User, category_id: int) -> GradeCategory:
    result = await db.execute(
        select(GradeCategory).where(GradeCategory.id == category_id, GradeCategory.owner_id == user.id)
    )
    cat = result.scalar_one_or_none()
    if not cat:
        raise HTTPException(404, "Kategorie nicht gefunden")
    return cat


# ─── Kategorien ───

class CategoryIn(BaseModel):
    name: str
    weight: int = 0
    position: int = 0

    @field_validator("name")
    @classmethod
    def name_ok(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name darf nicht leer sein")
        return v

    @field_validator("weight")
    @classmethod
    def weight_ok(cls, v: int) -> int:
        if v < 0 or v > 100:
            raise ValueError("Gewicht muss zwischen 0 und 100 Prozent liegen")
        return v


class CategoryOut(CategoryIn):
    id: int
    class_id: int
    model_config = {"from_attributes": True}


@router.get("/classes/{class_id}/categories", response_model=List[CategoryOut])
async def list_categories(
    class_id: int,
    user: User = Depends(require_module),
    db: AsyncSession = Depends(get_db),
):
    await _owned_class(db, user, class_id)
    result = await db.execute(
        select(GradeCategory)
        .where(GradeCategory.owner_id == user.id, GradeCategory.class_id == class_id)
        .order_by(GradeCategory.position, GradeCategory.id)
    )
    return result.scalars().all()


@router.post("/classes/{class_id}/categories", response_model=CategoryOut, status_code=201)
async def create_category(
    class_id: int,
    body: CategoryIn,
    user: User = Depends(require_module),
    db: AsyncSession = Depends(get_db),
):
    rate_limit("noten_cat", f"u{user.id}", 100, 60, "Zu viele Kategorien in kurzer Zeit. Bitte kurz warten.")
    await _owned_class(db, user, class_id)
    cat = GradeCategory(**body.model_dump(), class_id=class_id, owner_id=user.id)
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return cat


@router.put("/categories/{category_id}", response_model=CategoryOut)
async def update_category(
    category_id: int,
    body: CategoryIn,
    user: User = Depends(require_module),
    db: AsyncSession = Depends(get_db),
):
    cat = await _owned_category(db, user, category_id)
    for k, v in body.model_dump().items():
        setattr(cat, k, v)
    await db.commit()
    await db.refresh(cat)
    return cat


@router.delete("/categories/{category_id}", status_code=204)
async def delete_category(
    category_id: int,
    user: User = Depends(require_module),
    db: AsyncSession = Depends(get_db),
):
    """Loescht die Kategorie samt ihrer Eintraege — die Eintraege haengen an
    ihr, nicht an der Person."""
    cat = await _owned_category(db, user, category_id)
    await db.delete(cat)
    await db.commit()


# ─── Eintraege: Noten und Beobachtungen ───

class EntryIn(BaseModel):
    category_id: int
    student_id: int
    kind: str = "grade"
    value: Optional[float] = None
    tendency: Optional[int] = None
    note: str = ""
    date: Optional[datetime] = None

    @field_validator("kind")
    @classmethod
    def kind_ok(cls, v: str) -> str:
        if v not in ("grade", "observation"):
            raise ValueError("kind muss 'grade' oder 'observation' sein")
        return v

    @field_validator("value")
    @classmethod
    def value_ok(cls, v):
        if v is None:
            return v
        if v < 1.0 or v > 6.0:
            raise ValueError("Note muss zwischen 1,0 und 6,0 liegen")
        return round(v, 1)

    @field_validator("tendency")
    @classmethod
    def tendency_ok(cls, v):
        if v is None:
            return v
        if v not in (-1, 0, 1):
            raise ValueError("Tendenz muss -1, 0 oder 1 sein")
        return v

    @field_validator("note")
    @classmethod
    def note_ok(cls, v: str) -> str:
        if len(v) > 2000:
            raise ValueError("Notiz zu lang (max. 2000 Zeichen)")
        return v


class EntryOut(BaseModel):
    id: int
    category_id: int
    student_id: int
    kind: str
    value: Optional[float]
    tendency: Optional[int]
    note: str
    date: datetime
    model_config = {"from_attributes": True}


async def _check_entry(db: AsyncSession, user: User, body: EntryIn) -> GradeCategory:
    cat = await _owned_category(db, user, body.category_id)
    # Der Schueler muss in der Klasse dieser Kategorie sein — sonst liesse sich
    # ein fremdes Kind an eine eigene Kategorie haengen.
    result = await db.execute(
        select(Student.id).where(Student.id == body.student_id, Student.class_id == cat.class_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(400, "Schüler gehört nicht zu dieser Klasse")

    if body.kind == "grade" and body.value is None:
        raise HTTPException(400, "Eine Note braucht einen Wert")
    if body.kind == "observation" and body.value is not None:
        raise HTTPException(400, "Eine Beobachtung ist keine Note und darf keinen Notenwert haben")
    return cat


@router.get("/classes/{class_id}/entries", response_model=List[EntryOut])
async def list_entries(
    class_id: int,
    user: User = Depends(require_module),
    db: AsyncSession = Depends(get_db),
):
    await _owned_class(db, user, class_id)
    result = await db.execute(
        select(GradeEntry)
        .join(GradeCategory, GradeEntry.category_id == GradeCategory.id)
        .where(GradeCategory.owner_id == user.id, GradeCategory.class_id == class_id)
        .order_by(GradeEntry.date.desc(), GradeEntry.id.desc())
    )
    return result.scalars().all()


@router.post("/entries", response_model=EntryOut, status_code=201)
async def create_entry(
    body: EntryIn,
    user: User = Depends(require_module),
    db: AsyncSession = Depends(get_db),
):
    rate_limit("noten_entry", f"u{user.id}", 600, 60, "Zu viele Einträge in kurzer Zeit. Bitte kurz warten.")
    await _check_entry(db, user, body)
    data = body.model_dump()
    if data.get("date") is None:
        data.pop("date")
    entry = GradeEntry(**data)
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


@router.delete("/entries/{entry_id}", status_code=204)
async def delete_entry(
    entry_id: int,
    user: User = Depends(require_module),
    db: AsyncSession = Depends(get_db),
):
    entry = await db.get(GradeEntry, entry_id)
    if not entry:
        raise HTTPException(404, "Eintrag nicht gefunden")
    await _owned_category(db, user, entry.category_id)
    await db.delete(entry)
    await db.commit()


# ─── Uebersicht ───

class StudentSummary(BaseModel):
    student_id: int
    name: str
    # Schnitt je Kategorie, nur aus Noten. Kategorien ohne Note fehlen hier.
    per_category: dict
    # Gewichteter Schnitt ueber die Kategorien, die eine Note haben.
    weighted: Optional[float]
    # Summe der Gewichte, die tatsaechlich eingeflossen sind: sagt, wie
    # belastbar der Wert ist. 40 % heisst, 60 % des Konzepts fehlen noch.
    weight_covered: int
    observations: int


@router.get("/classes/{class_id}/summary", response_model=List[StudentSummary])
async def summary(
    class_id: int,
    user: User = Depends(require_module),
    db: AsyncSession = Depends(get_db),
):
    """Gewichteter Schnitt je Person — ausschliesslich aus Noten.

    Beobachtungen werden gezaehlt, aber nie gerechnet: "Anstrengungsbereitschaft"
    ist kein Messwert. Der Wert ist eine Rechenhilfe, keine Zeugnisnote.
    """
    await _owned_class(db, user, class_id)

    cats = (await db.execute(
        select(GradeCategory)
        .where(GradeCategory.owner_id == user.id, GradeCategory.class_id == class_id)
    )).scalars().all()
    cat_weight = {c.id: c.weight for c in cats}

    students = (await db.execute(
        select(Student).where(Student.class_id == class_id).order_by(Student.card_id)
    )).scalars().all()

    entries = (await db.execute(
        select(GradeEntry)
        .join(GradeCategory, GradeEntry.category_id == GradeCategory.id)
        .where(GradeCategory.owner_id == user.id, GradeCategory.class_id == class_id)
    )).scalars().all()

    out = []
    for st in students:
        eigene = [e for e in entries if e.student_id == st.id]
        per_cat = {}
        for c in cats:
            noten = [e.value for e in eigene if e.category_id == c.id and e.kind == "grade" and e.value is not None]
            if noten:
                per_cat[str(c.id)] = round(sum(noten) / len(noten), 2)

        gewicht = sum(cat_weight.get(int(cid), 0) for cid in per_cat)
        weighted = None
        if gewicht > 0:
            weighted = round(
                sum(per_cat[cid] * cat_weight.get(int(cid), 0) for cid in per_cat) / gewicht, 2
            )

        out.append(StudentSummary(
            student_id=st.id, name=st.name, per_category=per_cat,
            weighted=weighted, weight_covered=gewicht,
            observations=len([e for e in eigene if e.kind == "observation"]),
        ))
    return out
