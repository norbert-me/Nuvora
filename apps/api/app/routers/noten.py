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
    GradeCategory, GradeEntry, GradeSection, GradeOverride, SchoolClass,
    Session as TestSession, Student, User,
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


@router.get("/classes/{class_id}/sections", response_model=List[SectionOut])
async def list_sections(class_id: int, term: str = "1", user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    r = await db.execute(
        select(GradeSection)
        .where(GradeSection.owner_id == user.id, GradeSection.class_id == class_id, GradeSection.term == term)
        .options(selectinload(GradeSection.categories))
        .order_by(GradeSection.position, GradeSection.id)
    )
    return r.scalars().all()


@router.post("/classes/{class_id}/sections", response_model=SectionOut, status_code=201)
async def create_section(class_id: int, body: SectionIn, term: str = "1", user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("noten_sec", f"u{user.id}", 100, 60, "Zu viele Abschnitte in kurzer Zeit. Bitte kurz warten.")
    await _owned_class(db, user, class_id)
    sec = GradeSection(**body.model_dump(), term=term, class_id=class_id, owner_id=user.id)
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
    r = await db.execute(select(Student.id).where(Student.id == body.student_id, Student.class_id == cat.class_id))
    if not r.scalar_one_or_none():
        raise HTTPException(400, "Schüler gehört nicht zu dieser Klasse")
    if body.kind == "grade" and body.value is None:
        raise HTTPException(400, "Eine Note braucht einen Wert")
    if body.kind == "observation" and body.value is not None:
        raise HTTPException(400, "Eine Beobachtung ist keine Note und darf keinen Notenwert haben")
    return cat


@router.get("/classes/{class_id}/entries", response_model=List[EntryOut])
async def list_entries(class_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    r = await db.execute(
        select(GradeEntry)
        .join(GradeCategory, GradeEntry.category_id == GradeCategory.id)
        .where(GradeCategory.owner_id == user.id, GradeCategory.class_id == class_id)
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


async def _find_override(db, user, class_id, student_id, section_id, term):
    q = select(GradeOverride).where(
        GradeOverride.owner_id == user.id,
        GradeOverride.class_id == class_id,
        GradeOverride.student_id == student_id,
    )
    if section_id is None:
        q = q.where(GradeOverride.section_id.is_(None), GradeOverride.term == term)
    else:
        q = q.where(GradeOverride.section_id == section_id)
    return (await db.execute(q)).scalar_one_or_none()


@router.put("/overrides", status_code=204)
async def set_override(body: OverrideIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("noten_over", f"u{user.id}", 600, 60, "Zu viele Änderungen in kurzer Zeit. Bitte kurz warten.")
    await _owned_class(db, user, body.class_id)
    if body.section_id is not None:
        await _owned_section(db, user, body.section_id)
    r = await db.execute(select(Student.id).where(Student.id == body.student_id, Student.class_id == body.class_id))
    if not r.scalar_one_or_none():
        raise HTTPException(400, "Schüler gehört nicht zu dieser Klasse")
    ex = await _find_override(db, user, body.class_id, body.student_id, body.section_id, body.term)
    if ex:
        ex.value = body.value
    else:
        db.add(GradeOverride(owner_id=user.id, class_id=body.class_id, student_id=body.student_id,
                             section_id=body.section_id, term=body.term, value=body.value))
    await db.commit()


@router.delete("/overrides", status_code=204)
async def clear_override(class_id: int, student_id: int, section_id: Optional[int] = None, term: str = "1",
                         user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    ex = await _find_override(db, user, class_id, student_id, section_id, term)
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


async def _summarize(db, user, class_id, term):
    """Berechnet die Uebersicht eines Halbjahrs. Gibt (sections, out) zurueck."""
    sections = (await db.execute(
        select(GradeSection).where(GradeSection.owner_id == user.id, GradeSection.class_id == class_id, GradeSection.term == term)
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

    students = (await db.execute(
        select(Student).where(Student.class_id == class_id).order_by(Student.card_id)
    )).scalars().all()

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
    total_over = {o.student_id: o.value for o in overrides if o.section_id is None and o.term == term}

    out = []
    for st in students:
        eigene = [e for e in entries if e.student_id == st.id]
        grades = [e for e in eigene if e.kind == "grade" and e.value is not None and e.category_id in cat_ids]

        # Schnitt je Spalte
        per_cat = {}
        for c in cats:
            werte = [e.value for e in grades if e.category_id == c.id]
            if werte:
                per_cat[str(c.id)] = round(sum(werte) / len(werte), 2)

        # Schnitt je Abschnitt: Mittel aller Noten seiner Spalten
        per_sec = {}
        for s in sections:
            werte = [e.value for e in grades if cat_section.get(e.category_id) == s.id]
            if werte:
                per_sec[str(s.id)] = round(sum(werte) / len(werte), 2)

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
            # Kein Gewicht gesetzt: ungewichteter Mittelwert der Bereichsnoten.
            weighted = round(sum(sec_eff.values()) / len(sec_eff), 2)
            fallback = True
        elif grades:
            weighted = round(sum(e.value for e in grades) / len(grades), 2)
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
async def summary(class_id: int, term: str = "1", user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    _, out = await _summarize(db, user, class_id, term)
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
async def year_summary(class_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    sec1, sum1 = await _summarize(db, user, class_id, "1")
    sec2, sum2 = await _summarize(db, user, class_id, "2")

    year_over = {o.student_id: o.value for o in (await db.execute(
        select(GradeOverride).where(
            GradeOverride.owner_id == user.id, GradeOverride.class_id == class_id,
            GradeOverride.section_id.is_(None), GradeOverride.term == "year",
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
    category_id: int
    grades: List[ImportGrade]


@router.post("/import-session", status_code=201)
async def import_session(body: ImportBody, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("noten_import", f"u{user.id}", 30, 60, "Zu viele Übernahmen in kurzer Zeit. Bitte kurz warten.")
    sess = await db.get(TestSession, body.session_id)
    if not sess or sess.owner_id != user.id:
        raise HTTPException(404, "Session nicht gefunden")
    if not sess.class_id:
        raise HTTPException(400, "Diese Session hat keine Klasse — keine Zuordnung möglich")

    cat = await _owned_category(db, user, body.category_id)
    if cat.class_id != sess.class_id:
        raise HTTPException(400, "Spalte und Session gehören zu verschiedenen Klassen")

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
