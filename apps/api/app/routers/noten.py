"""Modul Noten — Leistungsbewertung auf dem Nuvora-Kern.

Eigenstaendig (Regel 3). Der Kern liefert Klassen und Schueler.

Zwei Ebenen:
- ABSCHNITT (GradeSection): traegt das Gewicht, z.B. 'Klassenarbeiten' 50 %.
- SPALTE (GradeCategory): eine einzelne Arbeit/Test im Abschnitt, ohne eigenes
  Gewicht. Genau eine Note je Zelle.

Der Schnitt wird ueber die Abschnitte gewichtet; innerhalb eines Abschnitts
zaehlen die Spalten gleich. Beobachtungen zaehlen NIE — 'Anstrengungsbereitschaft'
ist kein Messwert.
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import (
    GradeCategory, GradeEntry, GradeSection, GradeOverride, QuartalDivider, SchoolClass,
    Session as TestSession, Student, User, CodeSession,
)
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
    r = await db.execute(select(SchoolClass).where(SchoolClass.id == class_id, SchoolClass.owner_id == user.id))
    cls = r.scalar_one_or_none()
    if not cls:
        raise HTTPException(404, "Klasse nicht gefunden")
    return cls


async def _kurs_roster(db, user, class_id):
    """Kanonische SuS des Kurses (gleichnamige Fach-Klassen-SuS dedupliziert).
    Noten-Zeilen kommen aus dem Kurs; die Spalten bleiben pro Fach-Klasse."""
    from .kurse import sibling_class_ids
    sib = await sibling_class_ids(db, class_id)
    studs = (await db.execute(select(Student).where(Student.class_id.in_(sib)).order_by(Student.id))).scalars().all()
    canon = {}
    for s in studs:
        canon.setdefault(s.name.strip(), s)
    return sorted(canon.values(), key=lambda s: (s.card_id, s.id))


async def _student_in_kurs(db, class_id, student_id) -> bool:
    from .kurse import sibling_class_ids
    sib = await sibling_class_ids(db, class_id)
    r = await db.execute(select(Student.id).where(Student.id == student_id, Student.class_id.in_(sib)))
    return r.scalar_one_or_none() is not None


async def _owned_section(db: AsyncSession, user: User, section_id: int) -> GradeSection:
    r = await db.execute(select(GradeSection).where(GradeSection.id == section_id, GradeSection.owner_id == user.id))
    sec = r.scalar_one_or_none()
    if not sec:
        raise HTTPException(404, "Abschnitt nicht gefunden")
    return sec


async def _owned_category(db: AsyncSession, user: User, category_id: int) -> GradeCategory:
    r = await db.execute(select(GradeCategory).where(GradeCategory.id == category_id, GradeCategory.owner_id == user.id))
    cat = r.scalar_one_or_none()
    if not cat:
        raise HTTPException(404, "Spalte nicht gefunden")
    return cat


# ─── Abschnitte ───

class SectionIn(BaseModel):
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


class CategoryOut(BaseModel):
    id: int
    section_id: Optional[int]
    name: str
    position: int
    # Aus welcher CardVote-Session übernommen (für den Link zur Auswertung).
    source_session_id: Optional[int] = None
    source_kind: Optional[str] = None  # "cardvote" | "karten" | "codedetektiv" | ""
    created_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


class SectionOut(BaseModel):
    id: int
    class_id: int
    term: str
    name: str
    weight: int
    position: int
    categories: List[CategoryOut] = []
    model_config = {"from_attributes": True}


@router.get("/classes/{class_id}/students")
async def kurs_students(class_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Noten-Zeilen: die kanonischen SuS des Kurses (dedupliziert)."""
    await _owned_class(db, user, class_id)
    return [{"id": s.id, "card_id": s.card_id, "name": s.name} for s in await _kurs_roster(db, user, class_id)]


def _sec_kurs_where(user, class_id, kurs_id):
    """Abschnitte hängen am Kurs (Fach); Fallback Klasse ohne Kurs."""
    if kurs_id is not None:
        return (GradeSection.owner_id == user.id, GradeSection.kurs_id == kurs_id)
    return (GradeSection.owner_id == user.id, GradeSection.class_id == class_id, GradeSection.kurs_id.is_(None))


@router.get("/classes/{class_id}/sections", response_model=List[SectionOut])
async def list_sections(class_id: int, term: str = "1", kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    # term="all": alle Halbjahre (fuer die Import-Dialoge, die kein Halbjahr kennen —
    # sonst waeren im 2. Halbjahr keine Abschnitte waehlbar).
    where = [*_sec_kurs_where(user, class_id, kurs_id)]
    if term != "all":
        where.append(GradeSection.term == term)
    r = await db.execute(
        select(GradeSection)
        .where(*where)
        .options(selectinload(GradeSection.categories))
        .order_by(GradeSection.term, GradeSection.position, GradeSection.id)
    )
    return r.scalars().all()


@router.post("/classes/{class_id}/sections", response_model=SectionOut, status_code=201)
async def create_section(class_id: int, body: SectionIn, term: str = "1", kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("noten_sec", f"u{user.id}", 100, 60, "Zu viele Abschnitte in kurzer Zeit. Bitte kurz warten.")
    await _owned_class(db, user, class_id)
    sec = GradeSection(**body.model_dump(), term=term, class_id=class_id, kurs_id=kurs_id, owner_id=user.id)
    db.add(sec)
    await db.commit()
    await db.refresh(sec, ["categories"])
    return sec


class ReorderIn(BaseModel):
    ids: list[int]


@router.put("/classes/{class_id}/sections/reorder", status_code=204)
async def reorder_sections(class_id: int, body: ReorderIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Setzt die Reihenfolge der Abschnitte anhand der uebergebenen ID-Liste."""
    await _owned_class(db, user, class_id)
    result = await db.execute(
        select(GradeSection).where(GradeSection.class_id == class_id, GradeSection.owner_id == user.id)
    )
    secs = {s.id: s for s in result.scalars().all()}
    for pos, sid in enumerate(body.ids):
        sec = secs.get(sid)
        if sec is not None:
            sec.position = pos
    await db.commit()


@router.get("/classes/{class_id}/dividers")
async def list_dividers(class_id: int, term: str = "1", user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Quartalsstriche: nach welchen Spalten sie stehen (rein optisch)."""
    await _owned_class(db, user, class_id)
    rows = (await db.execute(select(QuartalDivider).where(
        QuartalDivider.class_id == class_id, QuartalDivider.owner_id == user.id, QuartalDivider.term == term,
    ))).scalars().all()
    return [r.after_category_id for r in rows]


class DividerIn(BaseModel):
    after_category_id: int


@router.post("/classes/{class_id}/dividers/toggle")
async def toggle_divider(class_id: int, body: DividerIn, term: str = "1", user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Strich nach einer Spalte an/aus. Gibt die neue Liste zurueck."""
    await _owned_class(db, user, class_id)
    existing = (await db.execute(select(QuartalDivider).where(
        QuartalDivider.class_id == class_id, QuartalDivider.owner_id == user.id,
        QuartalDivider.term == term, QuartalDivider.after_category_id == body.after_category_id,
    ))).scalar_one_or_none()
    if existing:
        await db.delete(existing)
    else:
        db.add(QuartalDivider(class_id=class_id, owner_id=user.id, term=term, after_category_id=body.after_category_id))
    await db.commit()
    rows = (await db.execute(select(QuartalDivider).where(
        QuartalDivider.class_id == class_id, QuartalDivider.owner_id == user.id, QuartalDivider.term == term,
    ))).scalars().all()
    return [r.after_category_id for r in rows]


@router.put("/sections/{section_id}/categories/reorder", status_code=204)
async def reorder_categories(section_id: int, body: ReorderIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Setzt die Reihenfolge der Spalten eines Abschnitts anhand der ID-Liste."""
    await _owned_section(db, user, section_id)
    result = await db.execute(
        select(GradeCategory).where(GradeCategory.section_id == section_id, GradeCategory.owner_id == user.id)
    )
    cats = {c.id: c for c in result.scalars().all()}
    for pos, cid in enumerate(body.ids):
        cat = cats.get(cid)
        if cat is not None:
            cat.position = pos
    await db.commit()


@router.put("/sections/{section_id}", response_model=SectionOut)
async def update_section(section_id: int, body: SectionIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    sec = await _owned_section(db, user, section_id)
    for k, v in body.model_dump().items():
        setattr(sec, k, v)
    await db.commit()
    await db.refresh(sec, ["categories"])
    return sec


@router.delete("/sections/{section_id}", status_code=204)
async def delete_section(section_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Loescht den Abschnitt samt Spalten und Noten darin."""
    sec = await _owned_section(db, user, section_id)
    await db.delete(sec)
    await db.commit()


# ─── Spalten ───

class CategoryIn(BaseModel):
    name: str
    section_id: int
    position: int = 0

    @field_validator("name")
    @classmethod
    def name_ok(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name darf nicht leer sein")
        return v


@router.post("/categories", response_model=CategoryOut, status_code=201)
async def create_category(body: CategoryIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("noten_cat", f"u{user.id}", 200, 60, "Zu viele Spalten in kurzer Zeit. Bitte kurz warten.")
    sec = await _owned_section(db, user, body.section_id)
    cat = GradeCategory(name=body.name, position=body.position, section_id=sec.id, class_id=sec.class_id, owner_id=user.id)
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return cat


@router.put("/categories/{category_id}", response_model=CategoryOut)
async def update_category(category_id: int, body: CategoryIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    cat = await _owned_category(db, user, category_id)
    sec = await _owned_section(db, user, body.section_id)
    cat.name = body.name
    cat.position = body.position
    cat.section_id = sec.id
    cat.class_id = sec.class_id
    await db.commit()
    await db.refresh(cat)
    return cat


@router.delete("/categories/{category_id}", status_code=204)
async def delete_category(category_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
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
        return round(v, 2)

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
    if not await _student_in_kurs(db, cat.class_id, body.student_id):
        raise HTTPException(400, "Schüler gehört nicht zu diesem Kurs")
    if body.kind == "grade" and body.value is None:
        raise HTTPException(400, "Eine Note braucht einen Wert")
    if body.kind == "observation" and body.value is not None:
        raise HTTPException(400, "Eine Beobachtung ist keine Note und darf keinen Notenwert haben")
    return cat


@router.get("/classes/{class_id}/entries", response_model=List[EntryOut])
async def list_entries(class_id: int, kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    # Noten hängen (über Spalte→Abschnitt) am Kurs (Fach): nur die des Kurses.
    r = await db.execute(
        select(GradeEntry)
        .join(GradeCategory, GradeEntry.category_id == GradeCategory.id)
        .join(GradeSection, GradeCategory.section_id == GradeSection.id)
        .where(GradeCategory.owner_id == user.id, *_sec_kurs_where(user, class_id, kurs_id))
        .order_by(GradeEntry.date.desc(), GradeEntry.id.desc())
    )
    return r.scalars().all()


@router.post("/entries", response_model=EntryOut, status_code=201)
async def create_entry(body: EntryIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("noten_entry", f"u{user.id}", 600, 60, "Zu viele Einträge in kurzer Zeit. Bitte kurz warten.")
    await _check_entry(db, user, body)
    data = body.model_dump()
    if data.get("date") is None:
        data.pop("date")

    # Genau EINE Note pro Zelle: existiert schon eine Note fuer diese Spalte und
    # Person, wird sie ersetzt statt eine zweite anzulegen. Beobachtungen
    # (kind="observation") duerfen dagegen mehrere sein.
    if body.kind == "grade":
        vorhanden = (await db.execute(
            select(GradeEntry).where(
                GradeEntry.category_id == body.category_id,
                GradeEntry.student_id == body.student_id,
                GradeEntry.kind == "grade",
            )
        )).scalar_one_or_none()
        if vorhanden:
            vorhanden.value = body.value
            vorhanden.note = body.note
            await db.commit()
            await db.refresh(vorhanden)
            return vorhanden

    entry = GradeEntry(**data)
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


@router.delete("/entries/{entry_id}", status_code=204)
async def delete_entry(entry_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    entry = await db.get(GradeEntry, entry_id)
    if not entry:
        raise HTTPException(404, "Eintrag nicht gefunden")
    await _owned_category(db, user, entry.category_id)
    await db.delete(entry)
    await db.commit()


# ─── Manuelle Noten (Bereichs- und Endnote ueberschreiben) ───

class OverrideIn(BaseModel):
    class_id: int
    kurs_id: Optional[int] = None     # Kurs (Fach) — für die Endnote (section_id None) relevant
    student_id: int
    section_id: Optional[int] = None  # None = Endnote
    term: str = "1"                   # nur fuer die Endnote (section_id None) relevant
    value: float

    @field_validator("value")
    @classmethod
    def value_ok(cls, v):
        if v < 1.0 or v > 6.0:
            raise ValueError("Note muss zwischen 1,0 und 6,0 liegen")
        return round(v, 2)


async def _find_override(db, user, class_id, student_id, section_id, term, kurs_id=None):
    q = select(GradeOverride).where(
        GradeOverride.owner_id == user.id,
        GradeOverride.class_id == class_id,
        GradeOverride.student_id == student_id,
    )
    if section_id is None:
        # Endnote hängt am Kurs (Fach).
        q = q.where(GradeOverride.section_id.is_(None), GradeOverride.term == term,
                    GradeOverride.kurs_id == kurs_id if kurs_id is not None else GradeOverride.kurs_id.is_(None))
    else:
        q = q.where(GradeOverride.section_id == section_id)
    return (await db.execute(q)).scalar_one_or_none()


@router.put("/overrides", status_code=204)
async def set_override(body: OverrideIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("noten_over", f"u{user.id}", 600, 60, "Zu viele Änderungen in kurzer Zeit. Bitte kurz warten.")
    await _owned_class(db, user, body.class_id)
    if body.section_id is not None:
        await _owned_section(db, user, body.section_id)
    if not await _student_in_kurs(db, body.class_id, body.student_id):
        raise HTTPException(400, "Schüler gehört nicht zu diesem Kurs")
    ex = await _find_override(db, user, body.class_id, body.student_id, body.section_id, body.term, body.kurs_id)
    if ex:
        ex.value = body.value
    else:
        db.add(GradeOverride(owner_id=user.id, class_id=body.class_id, kurs_id=body.kurs_id, student_id=body.student_id,
                             section_id=body.section_id, term=body.term, value=body.value))
    await db.commit()


@router.delete("/overrides", status_code=204)
async def clear_override(class_id: int, student_id: int, section_id: Optional[int] = None, term: str = "1",
                         kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    ex = await _find_override(db, user, class_id, student_id, section_id, term, kurs_id)
    if ex:
        await db.delete(ex)
        await db.commit()


# ─── Uebersicht ───

class StudentSummary(BaseModel):
    student_id: int
    name: str
    # Schnitt je Spalte (nur Noten), key = category_id als String.
    per_category: dict
    # Schnitt je Abschnitt, key = section_id als String.
    per_section: dict
    # Manuell gesetzte Bereichsnoten, key = section_id als String.
    section_overrides: dict
    # Effektive Bereichsnote (Override sonst Schnitt), key = section_id.
    section_effective: dict
    # Gewichteter Gesamtschnitt (rechnet mit den effektiven Bereichsnoten). Ist
    # kein Gewicht gesetzt, faellt es auf den ungewichteten Mittelwert zurueck.
    weighted: Optional[float]
    # Manuell gesetzte Endnote; ueberschreibt weighted in der Anzeige.
    total_override: Optional[float]
    # true = ungewichteter Rueckfall (keine Gewichte gesetzt).
    unweighted_fallback: bool
    observations: int


def _agg(werte, mode):
    """Mehrere Noten zu einer zusammenfassen: Mittel oder Median. Die
    Abschnitts-Gewichtung bleibt davon unberuehrt — sie ist Fachkonferenz-Recht."""
    if not werte:
        return None
    if mode == "median":
        s = sorted(werte)
        n = len(s)
        m = n // 2
        return round(s[m] if n % 2 else (s[m - 1] + s[m]) / 2, 2)
    return round(sum(werte) / len(werte), 2)


async def _summarize(db, user, class_id, term, agg="mean", kurs_id=None):
    """Berechnet die Uebersicht eines Halbjahrs. Gibt (sections, out) zurueck.
    agg steuert nur, wie mehrere Einzelnoten zusammengefasst werden.
    Abschnitte/Endnoten hängen am Kurs (Fach)."""
    sections = (await db.execute(
        select(GradeSection).where(*_sec_kurs_where(user, class_id, kurs_id), GradeSection.term == term)
        .order_by(GradeSection.position, GradeSection.id)
    )).scalars().all()
    sec_weight = {s.id: s.weight for s in sections}
    sec_ids = {s.id for s in sections}

    # Nur Spalten der Abschnitte dieses Halbjahrs.
    cats = [c for c in (await db.execute(
        select(GradeCategory).where(GradeCategory.owner_id == user.id, GradeCategory.class_id == class_id)
    )).scalars().all() if c.section_id in sec_ids]
    cat_section = {c.id: c.section_id for c in cats}
    cat_ids = {c.id for c in cats}

    students = await _kurs_roster(db, user, class_id)

    entries = (await db.execute(
        select(GradeEntry)
        .join(GradeCategory, GradeEntry.category_id == GradeCategory.id)
        .where(GradeCategory.owner_id == user.id, GradeCategory.class_id == class_id)
    )).scalars().all()

    overrides = (await db.execute(
        select(GradeOverride).where(GradeOverride.owner_id == user.id, GradeOverride.class_id == class_id)
    )).scalars().all()
    # (student_id, section_id) -> value; section_id None = Endnote
    sec_over = {(o.student_id, o.section_id): o.value for o in overrides if o.section_id in sec_ids}
    # Endnote-Override (section_id NULL) am Kurs: nur die des gewaehlten Kurses.
    total_over = {o.student_id: o.value for o in overrides
                  if o.section_id is None and o.term == term and (o.kurs_id == kurs_id if kurs_id is not None else o.kurs_id is None)}

    out = []
    for st in students:
        eigene = [e for e in entries if e.student_id == st.id]
        grades = [e for e in eigene if e.kind == "grade" and e.value is not None and e.category_id in cat_ids]

        # Schnitt je Spalte
        per_cat = {}
        for c in cats:
            werte = [e.value for e in grades if e.category_id == c.id]
            if werte:
                per_cat[str(c.id)] = _agg(werte, agg)

        # Schnitt je Abschnitt: Mittel/Median aller Noten seiner Spalten
        per_sec = {}
        for s in sections:
            werte = [e.value for e in grades if cat_section.get(e.category_id) == s.id]
            if werte:
                per_sec[str(s.id)] = _agg(werte, agg)

        # Effektive Bereichsnote: manuell gesetzte schlaegt den Schnitt.
        sec_ovr = {str(s.id): sec_over[(st.id, s.id)] for s in sections if (st.id, s.id) in sec_over}
        sec_eff = dict(per_sec)
        sec_eff.update(sec_ovr)

        # Gewichteter Gesamtschnitt ueber die effektiven Bereichsnoten
        wsum = sum(sec_weight.get(int(sid), 0) for sid in sec_eff)
        weighted = None
        fallback = False
        if wsum > 0:
            weighted = round(sum(sec_eff[sid] * sec_weight.get(int(sid), 0) for sid in sec_eff) / wsum, 2)
        elif sec_eff:
            # Kein Gewicht gesetzt: ungewichtete Zusammenfassung der Bereichsnoten.
            weighted = _agg(list(sec_eff.values()), agg)
            fallback = True
        elif grades:
            weighted = _agg([e.value for e in grades], agg)
            fallback = True

        out.append(StudentSummary(
            student_id=st.id, name=st.name,
            per_category=per_cat, per_section=per_sec,
            section_overrides=sec_ovr, section_effective=sec_eff,
            weighted=weighted, total_override=total_over.get(st.id),
            unweighted_fallback=fallback,
            observations=len([e for e in eigene if e.kind == "observation" and e.category_id in cat_ids]),
        ))
    return sections, out


@router.get("/classes/{class_id}/summary", response_model=List[StudentSummary])
async def summary(class_id: int, term: str = "1", agg: str = "mean", kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    _, out = await _summarize(db, user, class_id, term, agg="median" if agg == "median" else "mean", kurs_id=kurs_id)
    return out


# ─── Jahresuebersicht: beide Halbjahre plus Jahresnote ───

class YearSection(BaseModel):
    term: str
    id: int
    name: str
    weight: int


class YearRow(BaseModel):
    student_id: int
    name: str
    # Effektive Bereichsnote je Abschnitt (beide Halbjahre), key = section_id.
    section_grades: dict
    # Halbjahres-Endnote, key = "1"/"2".
    term_ends: dict
    # Jahresnote: manuell gesetzt sonst Mittel der beiden Halbjahresnoten.
    year: Optional[float]
    year_override: Optional[float]


class YearOut(BaseModel):
    sections: List[YearSection]
    rows: List[YearRow]


@router.get("/classes/{class_id}/year", response_model=YearOut)
async def year_summary(class_id: int, agg: str = "mean", kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    mode = "median" if agg == "median" else "mean"
    sec1, sum1 = await _summarize(db, user, class_id, "1", agg=mode, kurs_id=kurs_id)
    sec2, sum2 = await _summarize(db, user, class_id, "2", agg=mode, kurs_id=kurs_id)

    year_over = {o.student_id: o.value for o in (await db.execute(
        select(GradeOverride).where(
            GradeOverride.owner_id == user.id, GradeOverride.class_id == class_id,
            GradeOverride.section_id.is_(None), GradeOverride.term == "year",
            GradeOverride.kurs_id == kurs_id if kurs_id is not None else GradeOverride.kurs_id.is_(None),
        )
    )).scalars().all()}

    sections = [YearSection(term="1", id=s.id, name=s.name, weight=s.weight) for s in sec1] \
             + [YearSection(term="2", id=s.id, name=s.name, weight=s.weight) for s in sec2]

    by_id1 = {r.student_id: r for r in sum1}
    by_id2 = {r.student_id: r for r in sum2}
    rows = []
    for r in sum1:  # sum1/sum2 haben dieselben Schueler in gleicher Reihenfolge
        sid = r.student_id
        r2 = by_id2.get(sid)
        end1 = r.total_override if r.total_override is not None else r.weighted
        end2 = (r2.total_override if r2.total_override is not None else r2.weighted) if r2 else None
        ends = [e for e in (end1, end2) if e is not None]
        year = year_over.get(sid)
        if year is None and ends:
            year = round(sum(ends) / len(ends), 2)
        sg = {}
        sg.update(r.section_effective)
        if r2:
            sg.update(r2.section_effective)
        rows.append(YearRow(
            student_id=sid, name=r.name, section_grades=sg,
            term_ends={"1": end1, "2": end2}, year=year, year_override=year_over.get(sid),
        ))
    return YearOut(sections=sections, rows=rows)


# ─── CardVote-Testergebnis als Noten uebernehmen ───

class ImportGrade(BaseModel):
    card_id: int
    value: float

    @field_validator("value")
    @classmethod
    def v_ok(cls, v):
        if v < 1.0 or v > 6.0:
            raise ValueError("Note muss zwischen 1,0 und 6,0 liegen")
        return round(v, 1)


class ImportBody(BaseModel):
    session_id: int
    # Uebernahme legt eine NEUE Spalte im gewaehlten Abschnitt an.
    section_id: int
    column_name: str
    grades: List[ImportGrade]

    @field_validator("column_name")
    @classmethod
    def name_ok(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Spaltenname darf nicht leer sein")
        return v


@router.post("/import-session", status_code=201)
async def import_session(body: ImportBody, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("noten_import", f"u{user.id}", 30, 60, "Zu viele Übernahmen in kurzer Zeit. Bitte kurz warten.")
    sess = await db.get(TestSession, body.session_id)
    if not sess or sess.owner_id != user.id:
        raise HTTPException(404, "Session nicht gefunden")
    if not sess.class_id:
        raise HTTPException(400, "Diese Session hat keine Klasse — keine Zuordnung möglich")

    sec = await _owned_section(db, user, body.section_id)
    if sec.class_id != sess.class_id:
        raise HTTPException(400, "Abschnitt und Session gehören zu verschiedenen Klassen")

    # Neue Spalte im Abschnitt anlegen (ans Ende).
    pos = len((await db.execute(
        select(GradeCategory).where(GradeCategory.section_id == sec.id)
    )).scalars().all())
    cat = GradeCategory(name=body.column_name, section_id=sec.id, class_id=sec.class_id, owner_id=user.id, position=pos, source_session_id=sess.id, source_kind="cardvote")
    db.add(cat)
    await db.flush()

    students = (await db.execute(select(Student).where(Student.class_id == sess.class_id))).scalars().all()
    by_card = {st.card_id: st.id for st in students}

    angelegt = 0
    for g in body.grades:
        sid = by_card.get(g.card_id)
        if not sid:
            continue
        db.add(GradeEntry(
            category_id=cat.id, student_id=sid, kind="grade", value=g.value,
            note=f"Aus Test: {sess.name}" if sess.name else "Aus CardVote-Test",
        ))
        angelegt += 1
    await db.commit()
    return {"imported": angelegt}


class GradeCell(BaseModel):
    student_id: int
    value: float

    @field_validator("value")
    @classmethod
    def value_ok(cls, v):
        if v < 1.0 or v > 6.0:
            raise ValueError("Note muss zwischen 1,0 und 6,0 liegen")
        return round(v, 1)


class ImportGradesBody(BaseModel):
    class_id: int
    kurs_id: Optional[int] = None
    section_id: int
    column_name: str
    note: str = ""
    source_kind: str = ""   # Herkunft, z.B. "karten" (fuer die Kennzeichnung im Notenbuch)
    grades: List[GradeCell]

    @field_validator("column_name")
    @classmethod
    def name_ok(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Spaltenname darf nicht leer sein")
        return v


@router.post("/import-grades", status_code=201)
async def import_grades(body: ImportGradesBody, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Generische Notenspalte aus vorberechneten Werten (student_id → Note).

    Bewusst modulunabhaengig (Regel 3): Noten weiss nichts vom Karten-Modul.
    Der Aufrufer (z.B. Karten-Meisterung) rechnet den Wert selbst und liefert
    fertige Noten — die Note bleibt eine paedagogische Entscheidung, die Spalte
    ist frei editierbar."""
    rate_limit("noten_import", f"u{user.id}", 30, 60, "Zu viele Übernahmen in kurzer Zeit. Bitte kurz warten.")
    await _owned_class(db, user, body.class_id)
    sec = await _owned_section(db, user, body.section_id)
    if sec.class_id != body.class_id:
        raise HTTPException(400, "Abschnitt und Klasse passen nicht zusammen")

    pos = len((await db.execute(
        select(GradeCategory).where(GradeCategory.section_id == sec.id)
    )).scalars().all())
    cat = GradeCategory(name=body.column_name, section_id=sec.id, class_id=sec.class_id, owner_id=user.id, position=pos,
                        source_kind=(body.source_kind or "")[:20])
    db.add(cat)
    await db.flush()

    roster = {s.id for s in await _kurs_roster(db, user, body.class_id)}
    angelegt = 0
    for g in body.grades:
        if g.student_id not in roster:
            continue
        db.add(GradeEntry(category_id=cat.id, student_id=g.student_id, kind="grade", value=g.value, note=body.note or ""))
        angelegt += 1
    await db.commit()
    return {"imported": angelegt}


# ─── Code-Detektiv-Session als Notenspalte ───
# CD ist klassenlos: Schueler treten oeffentlich mit einem frei getippten Namen
# bei. Uebernahme matcht diesen Namen gegen die SuS des Kurses (normalisiert).
# Nicht zuordenbare Namen werden gemeldet, nicht geraten.

_DEFAULT_SCALE = {"1": 87, "2": 73, "3": 59, "4": 45, "5": 20, "6": 0}


def _grade_from_pct(pct: float, scale: dict) -> float:
    """Prozent -> Note, identisch zur Frontend-Skala (core/grades.js)."""
    try:
        s = {int(k): v for k, v in (scale or {}).items()}
        s = {g: s[g] for g in (1, 2, 3, 4, 5, 6)}  # vollstaendig? sonst Default
    except (ValueError, TypeError, KeyError):
        s = {int(k): v for k, v in _DEFAULT_SCALE.items()}
    ranges = [(1, s[1], 100), (2, s[2], s[1]), (3, s[3], s[2]), (4, s[4], s[3]), (5, s[5], s[4])]
    for grade, lower, upper in ranges:
        if pct >= lower:
            span = upper - lower
            if span <= 0:
                return float(grade)
            return round(grade + (upper - pct) / span, 1)
    return 6.0


def _norm(name: str) -> str:
    return " ".join((name or "").strip().lower().split())


@router.get("/code-sessions")
async def list_code_sessions(user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Beendete Code-Detektiv-Sessions der Lehrkraft (Quelle fuer eine Notenspalte)."""
    rows = (await db.execute(
        select(CodeSession).where(CodeSession.owner_id == user.id, CodeSession.ended.is_(True))
        .order_by(CodeSession.created_at.desc())
    )).scalars().all()
    out = []
    for s in rows:
        names = {r.get("playerName") for r in (s.results or []) if r.get("playerName")}
        out.append({"id": s.id, "code": s.code, "puzzles": len(s.puzzles or []),
                    "players": len(names), "created_at": s.created_at})
    return out


class ImportCodeBody(BaseModel):
    code_session_id: int
    class_id: int
    kurs_id: Optional[int] = None
    section_id: int
    column_name: str

    @field_validator("column_name")
    @classmethod
    def name_ok(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Spaltenname darf nicht leer sein")
        return v


@router.post("/import-code-session", status_code=201)
async def import_code_session(body: ImportCodeBody, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Aus einer CD-Session eine Notenspalte: je Spieler geloeste Raetsel / Anzahl
    -> Prozent -> Note (Skala der Lehrkraft). Name gegen den Kurs gematcht."""
    rate_limit("noten_import", f"u{user.id}", 30, 60, "Zu viele Übernahmen in kurzer Zeit. Bitte kurz warten.")
    sess = await db.get(CodeSession, body.code_session_id)
    if not sess or sess.owner_id != user.id:
        raise HTTPException(404, "Session nicht gefunden")
    await _owned_class(db, user, body.class_id)
    sec = await _owned_section(db, user, body.section_id)
    if sec.class_id != body.class_id:
        raise HTTPException(400, "Abschnitt und Klasse passen nicht zusammen")
    total = len(sess.puzzles or [])
    if total == 0:
        raise HTTPException(400, "Die Session hat keine Rätsel")

    # Je Spieler die Menge geloester Raetsel (distinct puzzleId mit solved).
    solved: dict[str, set] = {}
    for r in (sess.results or []):
        pn = r.get("playerName")
        if not pn:
            continue
        solved.setdefault(pn, set())
        if r.get("solved"):
            solved[pn].add(r.get("puzzleId"))

    roster = await _kurs_roster(db, user, body.class_id)
    by_name = {}
    for st in roster:
        by_name.setdefault(_norm(st.name), st.id)

    scale = user.grade_scale or _DEFAULT_SCALE
    pos = len((await db.execute(select(GradeCategory).where(GradeCategory.section_id == sec.id))).scalars().all())
    cat = GradeCategory(name=body.column_name, section_id=sec.id, class_id=sec.class_id, owner_id=user.id, position=pos, source_kind="codedetektiv")
    db.add(cat)
    await db.flush()

    angelegt, unmatched = 0, []
    for pn, done in solved.items():
        sid = by_name.get(_norm(pn))
        if not sid:
            unmatched.append(pn)
            continue
        pct = (len(done) / total) * 100
        db.add(GradeEntry(category_id=cat.id, student_id=sid, kind="grade",
                          value=_grade_from_pct(pct, scale), note="Aus Code-Detektiv (Vorschlag)"))
        angelegt += 1
    if angelegt == 0:
        # Keine einzige Zuordnung -> leere Spalte waere nur Ballast.
        await db.rollback()
        raise HTTPException(400, "Kein Spielername passte zu einem Schüler dieses Kurses")
    await db.commit()
    return {"imported": angelegt, "unmatched": sorted(set(unmatched))}


# ─── Export / Import je Klasse+Halbjahr (JSON-Sicherung) ───
# Portabel ueber Schueler card_id und Abschnitts-/Spalten-Indizes, damit ein
# Import auch in eine andere (deckungsgleiche) Klasse passt. Beobachtungen sind
# mit dabei; Foerderdaten der Schueler nie (die liegen im Kern, nicht hier).

@router.get("/classes/{class_id}/export")
async def export_noten(class_id: int, term: str = "1", kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    secs = (await db.execute(
        select(GradeSection).options(selectinload(GradeSection.categories))
        .where(*_sec_kurs_where(user, class_id, kurs_id), GradeSection.term == term).order_by(GradeSection.position)
    )).scalars().all()
    # Index-Zuordnung fuer Spalten.
    cat_index = {}   # category_id -> (s_idx, c_idx)
    out_secs = []
    for si, sec in enumerate(secs):
        cats = sorted(sec.categories, key=lambda c: c.position)
        for ci, c in enumerate(cats):
            cat_index[c.id] = (si, ci)
        out_secs.append({"name": sec.name, "weight": sec.weight, "position": sec.position,
                         "categories": [{"name": c.name, "position": c.position} for c in cats]})
    students = await _kurs_roster(db, user, class_id)
    sid2card = {s.id: s.card_id for s in students}
    cat_ids = list(cat_index.keys())
    entries = []
    if cat_ids:
        rows = (await db.execute(select(GradeEntry).where(GradeEntry.category_id.in_(cat_ids)))).scalars().all()
        for e in rows:
            if e.student_id not in sid2card:
                continue
            s_idx, c_idx = cat_index[e.category_id]
            entries.append({"card_id": sid2card[e.student_id], "s": s_idx, "c": c_idx, "kind": e.kind,
                            "value": e.value, "tendency": e.tendency, "note": e.note,
                            "date": e.date.isoformat() if e.date else None})
    sec_idx = {sec.id: si for si, sec in enumerate(secs)}
    ov_rows = (await db.execute(select(GradeOverride).where(
        GradeOverride.class_id == class_id, GradeOverride.owner_id == user.id))).scalars().all()
    overrides = []
    for o in ov_rows:
        if o.student_id not in sid2card:
            continue
        if o.section_id is not None and o.section_id not in sec_idx:
            continue
        # Endnote gilt je Halbjahr; Bereichsnote haengt am Abschnitt.
        if o.section_id is None and o.term != term:
            continue
        overrides.append({"card_id": sid2card[o.student_id], "s": sec_idx.get(o.section_id), "value": o.value})
    div_rows = (await db.execute(select(QuartalDivider).where(
        QuartalDivider.class_id == class_id, QuartalDivider.owner_id == user.id, QuartalDivider.term == term))).scalars().all()
    dividers = [cat_index[d.after_category_id] for d in div_rows if d.after_category_id in cat_index]
    return {"type": "nuvora_noten", "version": 1, "term": term, "sections": out_secs,
            "entries": entries, "overrides": overrides,
            "dividers": [{"s": s, "c": c} for (s, c) in dividers]}


@router.post("/classes/{class_id}/import")
async def import_noten(class_id: int, body: dict, term: str = "1", kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    if body.get("type") != "nuvora_noten":
        raise HTTPException(400, "Falsches Dateiformat")
    await _owned_class(db, user, class_id)
    students = await _kurs_roster(db, user, class_id)
    card2sid = {s.card_id: s.id for s in students}
    # Abschnitte + Spalten neu anlegen, Index -> neue ID merken.
    cat_map = {}  # (s_idx, c_idx) -> category_id
    sec_map = {}  # s_idx -> section_id
    pos0 = (await db.execute(select(GradeSection).where(*_sec_kurs_where(user, class_id, kurs_id), GradeSection.term == term))).scalars().all()
    base = len(pos0)
    for si, sec in enumerate(body.get("sections") or []):
        gs = GradeSection(owner_id=user.id, class_id=class_id, kurs_id=kurs_id, term=term, name=(sec.get("name") or "Abschnitt")[:120],
                          weight=int(sec.get("weight") or 0), position=base + si)
        db.add(gs)
        await db.flush()
        sec_map[si] = gs.id
        for ci, c in enumerate(sec.get("categories") or []):
            gc = GradeCategory(owner_id=user.id, class_id=class_id, section_id=gs.id,
                               name=(c.get("name") or "Spalte")[:120], position=ci)
            db.add(gc)
            await db.flush()
            cat_map[(si, ci)] = gc.id
    for e in (body.get("entries") or []):
        sid = card2sid.get(e.get("card_id"))
        cid = cat_map.get((e.get("s"), e.get("c")))
        if not sid or not cid:
            continue
        dt = None
        if e.get("date"):
            try:
                dt = datetime.fromisoformat(e["date"])
            except ValueError:
                dt = None
        ge = GradeEntry(category_id=cid, student_id=sid, kind=e.get("kind") or "grade",
                        value=e.get("value"), tendency=e.get("tendency"), note=e.get("note") or "")
        if dt:
            ge.date = dt
        db.add(ge)
    for o in (body.get("overrides") or []):
        sid = card2sid.get(o.get("card_id"))
        if not sid or o.get("value") is None:
            continue
        section_id = sec_map.get(o.get("s")) if o.get("s") is not None else None
        if o.get("s") is not None and section_id is None:
            continue
        db.add(GradeOverride(owner_id=user.id, class_id=class_id, kurs_id=(None if section_id is not None else kurs_id),
                             student_id=sid, section_id=section_id, term=term, value=o["value"]))
    for d in (body.get("dividers") or []):
        cid = cat_map.get((d.get("s"), d.get("c")))
        if cid:
            db.add(QuartalDivider(class_id=class_id, owner_id=user.id, term=term, after_category_id=cid))
    await db.commit()
    return {"imported": len(body.get("sections") or [])}


# ─── Zeugnis-/Eltern-Export: ein gebuendeltes PDF je Schueler ───

@router.get("/classes/{class_id}/zeugnis.pdf")
async def zeugnis_export(class_id: int, term: str = "1", agg: str = "mean", kurs_id: Optional[int] = None,
                         student_id: Optional[int] = None,
                         user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Gebuendelter Eltern-/Zeugnis-Export: je Schueler eine Seite mit Noten
    (gewichteter Schnitt + Abschnitte), Fehlzeiten und Karten-Fortschritt.
    Fehlzeiten/Karten nur, wenn die Module aktiv sind (Regel 3 — Noten laeuft
    ohne sie voll). Besonders schuetzenswerte Daten (foerder/notizen) sind
    bewusst NICHT enthalten."""
    sc = await _owned_class(db, user, class_id)
    sections, summaries = await _summarize(db, user, class_id, term, agg="median" if agg == "median" else "mean", kurs_id=kurs_id)
    sum_by_id = {s.student_id: s for s in summaries}
    students = await _kurs_roster(db, user, class_id)
    if student_id is not None:  # nur ein Schueler (Einzel-Zeugnis)
        students = [s for s in students if s.id == student_id]
    halb = "1. Halbjahr" if term == "1" else "2. Halbjahr"

    # Optional: Fehlzeiten (Modul Orga/Anwesenheit) und Karten-Fortschritt.
    fehl: dict = {}
    if await is_active(db, user.id, "orga"):
        try:
            from .anwesenheit import summary as _att_summary
            fehl = await _att_summary(class_id, user=user, db=db)
        except Exception:
            fehl = {}
    karten: dict = {}
    if await is_active(db, user.id, "karten"):
        try:
            from .karten import progress as _card_progress
            for p in await _card_progress(class_id, user=user, db=db):
                karten[p.student_id] = {"reviewed": p.reviewed, "total": p.total}
        except Exception:
            karten = {}

    def build(buf):
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.units import mm
        from reportlab.pdfgen import canvas
        c = canvas.Canvas(buf, pagesize=A4)
        w, h = A4
        for st in students:
            s = sum_by_id.get(st.id)
            y = h - 25 * mm
            c.setFont("Helvetica-Bold", 16)
            c.drawString(20 * mm, y, st.name[:60])
            c.setFont("Helvetica", 9)
            c.drawString(20 * mm, y - 6 * mm, f"{sc.name} · {halb} · erstellt am {datetime.now().strftime('%d.%m.%Y')} · Nuvora")
            y -= 18 * mm

            # Noten je Abschnitt
            c.setFont("Helvetica-Bold", 12)
            c.drawString(20 * mm, y, "Noten")
            y -= 8 * mm
            c.setFont("Helvetica", 10)
            eff = (s.section_effective if s else {}) or {}
            if sections:
                for sec in sections:
                    val = eff.get(str(sec.id))
                    txt = f"{val:.2f}".replace(".", ",") if val is not None else "–"
                    gew = f"  ({sec.weight} %)" if sec.weight else ""
                    if y < 30 * mm:
                        c.showPage(); y = h - 25 * mm; c.setFont("Helvetica", 10)
                    c.drawString(24 * mm, y, f"{sec.name[:48]}{gew}")
                    c.drawRightString(120 * mm, y, txt)
                    y -= 6 * mm
            else:
                c.drawString(24 * mm, y, "keine Abschnitte angelegt"); y -= 6 * mm
            y -= 2 * mm
            # Gewichteter Schnitt (Endnote-Override schlaegt den Schnitt)
            gesamt = None
            if s:
                gesamt = s.total_override if s.total_override is not None else s.weighted
            c.setFont("Helvetica-Bold", 11)
            gtxt = f"{gesamt:.2f}".replace(".", ",") if gesamt is not None else "–"
            hinweis = "" if (s and not s.unweighted_fallback) else "  (ungewichtet — keine Gewichte gesetzt)"
            c.drawString(24 * mm, y, "Gewichteter Schnitt")
            c.drawRightString(120 * mm, y, gtxt)
            if hinweis:
                c.setFont("Helvetica", 8); c.drawString(122 * mm, y, hinweis.strip())
            y -= 6 * mm
            c.setFont("Helvetica-Oblique", 8)
            c.drawString(24 * mm, y, "Der Schnitt ist eine Rechenhilfe. Die Zeugnisnote bleibt eine paedagogische Entscheidung.")
            y -= 12 * mm

            # Fehlzeiten
            if fehl:
                a = fehl.get(str(st.id), {"fehlt": 0, "spaet": 0, "entsch": 0})
                c.setFont("Helvetica-Bold", 12); c.drawString(20 * mm, y, "Fehlzeiten"); y -= 8 * mm
                c.setFont("Helvetica", 10)
                c.drawString(24 * mm, y, f"Fehltage: {a.get('fehlt', 0)}   davon entschuldigt: {a.get('entsch', 0)}   Verspaetungen: {a.get('spaet', 0)}")
                y -= 12 * mm

            # Karten-Fortschritt
            if karten:
                k = karten.get(st.id)
                if k:
                    c.setFont("Helvetica-Bold", 12); c.drawString(20 * mm, y, "Karteikarten"); y -= 8 * mm
                    c.setFont("Helvetica", 10)
                    c.drawString(24 * mm, y, f"Gelernt: {k['reviewed']} von {k['total']} Karten")
                    y -= 12 * mm

            c.showPage()
        # Leeres PDF vermeiden
        if not students:
            c.setFont("Helvetica", 12); c.drawString(20 * mm, h - 30 * mm, "Keine Schueler in dieser Klasse."); c.showPage()
        c.save()

    import io
    from fastapi.responses import StreamingResponse
    buf = io.BytesIO(); build(buf); buf.seek(0)
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="Zeugnis_{sc.name}_{halb}.pdf"'})
