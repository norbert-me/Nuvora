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
import re
from datetime import datetime, date as _date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..besitz import eigene_klasse, eigenes, kurs_oder_klasse
from ..felder import ohne_leer, ohne_none
from ..pdfdruck import als_anhang, neue_seite
from ..database import get_db
# `roster_kurs` heisst hier unten schon ein Endpunkt — deshalb umbenannt
# importiert, sonst ueberdeckt der Endpunkt den Helfer.
from ..schueler import roster_klasse, roster_kurs as _kanon_kurs
from ..importe import geprueft
from ..models import (
    GradeCategory, GradeEntry, GradeSection, GradeOverride, QuartalDivider, SchoolClass,
    Session as TestSession, Student, User, CodeSession,
)
from .auth import rate_limit
from .modules import is_active, modul_pflicht

router = APIRouter(prefix="/api/noten", tags=["noten"])

MODULE_KEY = "auswertung"


require_module = modul_pflicht(MODULE_KEY)


# Frueher stand die strenge Klassenpruefung hier und in karten.py doppelt;
# jetzt eine Quelle (app/besitz.py).
_owned_class = eigene_klasse


async def _kurs_roster(db, user, class_id, kurs_id=None):
    """Kanonische SuS des Kurses (gleichnamige Fach-Klassen-SuS dedupliziert).
    Noten-Zeilen kommen aus dem Kurs; die Spalten bleiben pro Fach-Klasse.

    Mit kurs_id: der Roster des Kurses selbst — inkl. der EINZELN hinzugefügten
    SuS (Kurse aus Teilen von Klassen). Für normale Fach-Kurse identisch zum
    Klassen-Roster (die Klasse ist dort immer Mitglied); zusätzlich greifen die
    kurs_students-Teilmengen."""
    if kurs_id is not None:
        # Der Kurs gehoert geprueft. Ohne das reichte ein fremder kurs_id im
        # Query-Parameter, um die Namen fremder Schueler zu lesen — der
        # Parameter kam roh aus der Adresse, und `user` wurde hier gar nicht
        # benutzt. Betroffen waren summary, year, das Zeugnis-PDF und der
        # Export, also alle Wege, die eine Namensliste ausgeben.
        from .kurse import _owned_kurs
        await _owned_kurs(db, user, kurs_id)
        return await _kanon_kurs(db, kurs_id)
    # Beide Zweige rechneten dieselbe kanonische Liste aus; sie steht jetzt in
    # app/schueler.py und wird auch von results.py und klassenarbeit.py benutzt.
    return await roster_klasse(db, class_id)


async def _student_in_kurs(db, class_id, student_id, kurs_id=None) -> bool:
    if kurs_id is not None:
        from .kurse import member_student_ids
        return student_id in await member_student_ids(db, kurs_id)
    from .kurse import sibling_class_ids
    sib = await sibling_class_ids(db, class_id)
    r = await db.execute(select(Student.id).where(Student.id == student_id, Student.class_id.in_(sib)))
    return r.scalar_one_or_none() is not None


async def _owned_section(db: AsyncSession, user: User, section_id: int) -> GradeSection:
    return await eigenes(db, GradeSection, section_id, user, "Abschnitt nicht gefunden")


async def _owned_category(db: AsyncSession, user: User, category_id: int) -> GradeCategory:
    return await eigenes(db, GradeCategory, category_id, user, "Spalte nicht gefunden")


# ─── Regeln, die Eingabe UND Import teilen ───
#
# Jede dieser Regeln stand zweimal im Modul: einmal an den In-Modellen der
# Oberflaeche, einmal wortgleich an den Import-Modellen weiter unten (mit dem
# Kommentar „gleiche Regel wie …" — der Hinweis war da, die Kopie auch). Jetzt
# ist es eine Funktion, die beide als Validator einhaengen: der Importweg kann
# nicht mehr aus Versehen mehr duerfen als die Maske.

def _pruefe_note(v):
    """Note: nichts oder 1,0 bis 6,0, auf zwei Stellen."""
    if v is None:
        return v
    if v < 1.0 or v > 6.0:
        raise ValueError("Note muss zwischen 1,0 und 6,0 liegen")
    return round(v, 2)


def _pruefe_gewicht(v: int) -> int:
    """Gewicht in Prozent."""
    if v < 0 or v > 100:
        raise ValueError("Gewicht muss zwischen 0 und 100 Prozent liegen")
    return v


def _pruefe_notiz(v: str) -> str:
    if len(v) > 2000:
        raise ValueError("Notiz zu lang (max. 2000 Zeichen)")
    return v


def _pflicht_spaltenname(v: str) -> str:
    """Name einer Notenspalte — stand dreimal wortgleich an den Uebernahme-Modellen."""
    v = (v or "").strip()
    if not v:
        raise ValueError("Spaltenname darf nicht leer sein")
    return v


def _pflichtname(v: str) -> str:
    """Name der Maske: leer ist ein Fehler, kein Ersatzwert."""
    v = v.strip()
    if not v:
        raise ValueError("Name darf nicht leer sein")
    return v


# ─── Abschnitte ───

class SectionIn(BaseModel):
    name: str
    weight: int = 0
    position: int = 0

    name_ok = field_validator("name")(_pflichtname)
    weight_ok = field_validator("weight")(_pruefe_gewicht)


class CategoryOut(BaseModel):
    id: int
    section_id: Optional[int]
    name: str
    position: int
    # Aus welcher CardVote-Session übernommen (für den Link zur Auswertung).
    source_session_id: Optional[int] = None
    source_kind: Optional[str] = None  # "cardvote" | "karten" | "codedetektiv" | ""
    topic_id: Optional[int] = None
    # Tag der Leistung — Eigenschaft, kein Namensbestandteil (siehe models.py).
    date: Optional[str] = None
    created_at: Optional[datetime] = None
    model_config = {"from_attributes": True}

    @field_validator("date", mode="before")
    @classmethod
    def datum_als_text(cls, v):
        return v.isoformat() if hasattr(v, "isoformat") else v


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


@router.get("/kurse/{kurs_id}/students")
async def roster_kurs(kurs_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Noten-Zeilen eines Teilkurses — inkl. der EINZELN hinzugefügten SuS
    (Kurse aus Teilen von Klassen). Deduplikat per Name wie beim Klassen-Roster."""
    from .kurse import _owned_kurs
    await _owned_kurs(db, user, kurs_id)
    ordered = await _kanon_kurs(db, kurs_id)
    return [{"id": s.id, "card_id": s.card_id, "name": s.name, "class_id": s.class_id} for s in ordered]


def _sec_kurs_where(user, class_id, kurs_id):
    """Abschnitte haengen am Kurs (Fach); Fallback Klasse ohne Kurs.

    Die Schluesselregel steht seit dem Zusammenfuehren in
    `app/besitz.kurs_oder_klasse` — sie lag fuenfmal als eigenes `_key_where`
    herum und unterschied sich nur im Modell. Liste von WHERE-Bedingungen
    (unterschiedlich lang) — immer per * entpackt."""
    return kurs_oder_klasse(GradeSection, user, class_id, kurs_id)


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
    topic_id: Optional[int] = None   # Thema der Spalte (z.B. was die Klassenarbeit abdeckt)
    date: Optional[str] = None       # "YYYY-MM-DD" — Tag der Leistung, optional

    name_ok = field_validator("name")(_pflichtname)


def _parse_date(v: Optional[str]):
    """„YYYY-MM-DD" oder nichts. Unlesbares wird abgewiesen, nicht stillschweigend
    verworfen — sonst steht die Spalte am Ende ohne Termin da und niemand weiss,
    warum."""
    if not v:
        return None
    if isinstance(v, _date):
        return v
    v = str(v).strip()[:10]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        raise HTTPException(400, "Ungültiges Datum (YYYY-MM-DD)")
    y, m, d = v.split("-")
    return _date(int(y), int(m), int(d))


async def _check_topic(db: AsyncSession, user_id: int, topic_id: Optional[int]) -> Optional[int]:
    """Themenbindung nur aufs eigene Thema; fremdes/unbekanntes -> None."""
    if topic_id is None:
        return None
    from ..models import Topic
    ok = (await db.execute(select(Topic.id).where(Topic.id == topic_id, Topic.owner_id == user_id))).scalar_one_or_none()
    return ok


@router.post("/categories", response_model=CategoryOut, status_code=201)
async def create_category(body: CategoryIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("noten_cat", f"u{user.id}", 200, 60, "Zu viele Spalten in kurzer Zeit. Bitte kurz warten.")
    sec = await _owned_section(db, user, body.section_id)
    tid = await _check_topic(db, user.id, body.topic_id)
    cat = GradeCategory(name=body.name, position=body.position, section_id=sec.id, class_id=sec.class_id,
                        owner_id=user.id, topic_id=tid, date=_parse_date(body.date))
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
    cat.topic_id = await _check_topic(db, user.id, body.topic_id)
    cat.date = _parse_date(body.date)
    await db.commit()
    await db.refresh(cat)
    return cat


@router.delete("/categories/{category_id}", status_code=204)
async def delete_category(category_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    cat = await _owned_category(db, user, category_id)
    await db.delete(cat)
    await db.commit()


# ─── Nachholbedarf: aus einer (themen-getaggten) Klassenarbeit ───
# Schwache SuS (Note schlechter als der Schwellwert) → deren Karten des Themas
# WIEDER FÄLLIG setzen, damit sie im Üben erneut auftauchen ("verschieben").
# Bridge (Zusatz, Regel 3): Karten-Modelle lazy importiert; ohne gelernte Karten
# passiert nichts. BESTEHENDE Noten werden nicht angefasst.

class NachholIn(BaseModel):
    threshold: float = 4.0   # Note > threshold gilt als Nachholbedarf


@router.post("/categories/{category_id}/nachholbedarf")
async def nachholbedarf(category_id: int, body: NachholIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    from datetime import timezone
    from sqlalchemy import update as _update
    from ..models import CardDeck, Card, CardReview
    cat = await _owned_category(db, user, category_id)
    if not cat.topic_id:
        raise HTTPException(400, "Die Spalte hat kein Thema — bitte zuerst ein Thema zuweisen.")
    rows = (await db.execute(select(GradeEntry).where(
        GradeEntry.category_id == category_id, GradeEntry.kind == "grade", GradeEntry.value.is_not(None)))).scalars().all()
    weak = sorted({r.student_id for r in rows if r.value is not None and r.value > body.threshold})
    requeued = 0
    if weak:
        deck_ids = (await db.execute(select(CardDeck.id).where(
            CardDeck.owner_id == user.id, CardDeck.topic_id == cat.topic_id, CardDeck.deleted_at.is_(None)))).scalars().all()
        if deck_ids:
            card_ids = (await db.execute(select(Card.id).where(Card.deck_id.in_(deck_ids)))).scalars().all()
            if card_ids:
                res = await db.execute(_update(CardReview).where(
                    CardReview.student_id.in_(weak), CardReview.card_id.in_(card_ids), CardReview.reps > 0
                ).values(due=datetime.now(timezone.utc)))
                requeued = res.rowcount or 0
        await db.commit()
    names = {}
    if weak:
        names = {s.id: s.name for s in (await db.execute(select(Student).where(Student.id.in_(weak)))).scalars().all()}
    return {"weak": len(weak), "cards_requeued": requeued, "student_names": sorted(names.values())}


# ─── Klassenarbeit vergleichen: mit anderen Klassen (Kurs) + über die Zeit ───

def _grade_stats(vals):
    vals = [v for v in vals if v is not None]
    if not vals:
        return {"n": 0, "avg": None, "dist": [0, 0, 0, 0, 0, 0]}
    dist = [sum(1 for v in vals if round(v) == g) for g in (1, 2, 3, 4, 5, 6)]
    return {"n": len(vals), "avg": round(sum(vals) / len(vals), 2), "dist": dist}


async def _cat_vals(db, category_id):
    rows = (await db.execute(select(GradeEntry.value).where(
        GradeEntry.category_id == category_id, GradeEntry.kind == "grade", GradeEntry.value.is_not(None)))).scalars().all()
    return list(rows)


@router.get("/categories/{category_id}/compare")
async def compare_category(category_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Vergleich einer Spalte (Klassenarbeit): dieselbe Arbeit in den anderen
    Fach-Klassen des Kurses + der Verlauf der Spalten dieser Klasse im Halbjahr."""
    cat = await _owned_category(db, user, category_id)
    sec = await db.get(GradeSection, cat.section_id) if cat.section_id else None
    term = sec.term if sec else "1"
    cls_names = {c.id: c.name for c in (await db.execute(select(SchoolClass).where(SchoolClass.owner_id == user.id))).scalars().all()}

    # Über Klassen: gleichnamige Spalte in den Geschwister-Klassen des Kurses.
    from .kurse import sibling_class_ids
    sib = await sibling_class_ids(db, cat.class_id) if cat.class_id else {cat.class_id}
    same = (await db.execute(
        select(GradeCategory).join(GradeSection, GradeCategory.section_id == GradeSection.id)
        .where(GradeCategory.owner_id == user.id, GradeCategory.name == cat.name,
               GradeCategory.class_id.in_(list(sib)), GradeSection.term == term))).scalars().all()
    classes = []
    for c in same:
        st = _grade_stats(await _cat_vals(db, c.id))
        st["class_name"] = cls_names.get(c.class_id, "?")
        st["is_self"] = (c.id == cat.id)
        classes.append(st)
    classes.sort(key=lambda x: (not x["is_self"], x["class_name"]))

    # Über die Zeit: die Spalten DIESER Klasse im Halbjahr, chronologisch.
    my_cats = (await db.execute(
        select(GradeCategory).join(GradeSection, GradeCategory.section_id == GradeSection.id)
        .where(GradeCategory.owner_id == user.id, GradeCategory.class_id == cat.class_id, GradeSection.term == term)
        .order_by(GradeSection.position, GradeCategory.position, GradeCategory.id))).scalars().all()
    over_time = []
    for c in my_cats:
        st = _grade_stats(await _cat_vals(db, c.id))
        if st["n"]:
            over_time.append({"name": c.name, "avg": st["avg"], "is_self": c.id == cat.id})

    return {"name": cat.name, "term": term, "classes": classes, "over_time": over_time}


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

    value_ok = field_validator("value")(_pruefe_note)
    note_ok = field_validator("note")(_pruefe_notiz)

    @field_validator("tendency")
    @classmethod
    def tendency_ok(cls, v):
        if v is None:
            return v
        if v not in (-1, 0, 1):
            raise ValueError("Tendenz muss -1, 0 oder 1 sein")
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
    # Kurs (Fach) der Spalte über ihren Abschnitt — für Teilkurse (kurs_students).
    sec = await db.get(GradeSection, cat.section_id) if cat.section_id else None
    if not await _student_in_kurs(db, cat.class_id, body.student_id, sec.kurs_id if sec else None):
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


class KommentarIn(BaseModel):
    category_id: int
    student_id: int
    text: str = ""


@router.put("/entries/comment", status_code=200)
async def set_comment(body: KommentarIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Kommentar an eine Notenzelle — auch ohne Note.

    Das frühere Modul „Beobachtungen" lag neben dem Notenbuch: man trug die
    Note hier ein und die Bemerkung dazu woanders. Jetzt hängt die Bemerkung an
    der Zelle, zu der sie gehört („Formel vergessen", „krank, nachgeschrieben").

    Sie zählt NIE in einen Schnitt — das ist dieselbe Trennung wie vorher, nur
    an der richtigen Stelle: gerechnet wird `value`, der Text steht daneben.
    Ein leerer Text löscht den Kommentar; eine Zelle, die dann weder Note noch
    Kommentar hat, verschwindet ganz.
    """
    rate_limit("noten_entry", f"u{user.id}", 600, 60, "Zu viele Einträge in kurzer Zeit. Bitte kurz warten.")
    await _owned_category(db, user, body.category_id)
    text_ = (body.text or "").strip()[:2000]
    vorhanden = (await db.execute(select(GradeEntry).where(
        GradeEntry.category_id == body.category_id,
        GradeEntry.student_id == body.student_id,
        GradeEntry.kind == "grade",
    ))).scalar_one_or_none()

    if vorhanden:
        vorhanden.note = text_
        # Weder Note noch Text: die Zelle ist leer, der Eintrag hat keinen Zweck.
        if not text_ and vorhanden.value is None:
            await db.delete(vorhanden)
        await db.commit()
        return {"ok": True}
    if not text_:
        return {"ok": True}          # nichts zu löschen
    db.add(GradeEntry(category_id=body.category_id, student_id=body.student_id,
                      kind="grade", value=None, note=text_))
    await db.commit()
    return {"ok": True}


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

    value_ok = field_validator("value")(_pruefe_note)


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
    if not await _student_in_kurs(db, body.class_id, body.student_id, body.kurs_id):
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
    cat_ids = {c.id for c in cats}

    students = await _kurs_roster(db, user, class_id, kurs_id)

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

        # Schnitt je Abschnitt: Mittel/Median ueber die SPALTEN des Abschnitts
        # (nicht ueber die Eintraege) — innerhalb eines Abschnitts zaehlen die
        # Spalten gleich. Haette eine Zelle zwei Eintraege (Altbestand,
        # JSON-Import), zoege sie den Abschnitt sonst doppelt.
        per_sec = {}
        for s in sections:
            werte = [per_cat[str(c.id)] for c in cats
                     if c.section_id == s.id and str(c.id) in per_cat]
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

    name_ok = field_validator("column_name")(_pflicht_spaltenname)


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

    # Zweimal uebernommen stuende derselbe Test als zwei Spalten im Notenbuch
    # und zaehlte im Abschnitts-Schnitt doppelt. Wer neu uebernehmen will,
    # loescht die alte Spalte.
    schon = (await db.execute(select(GradeCategory).where(
        GradeCategory.owner_id == user.id, GradeCategory.source_session_id == sess.id,
        GradeCategory.class_id == sec.class_id))).scalars().first()
    if schon:
        raise HTTPException(409, f"Dieses Testergebnis wurde bereits übernommen (Spalte „{schon.name}“).")

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
    if angelegt == 0:
        # Keine einzige Zuordnung -> leere Spalte waere nur Ballast.
        await db.rollback()
        raise HTTPException(400, "Keine Karte passte zu einem Schüler dieser Klasse")
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

    name_ok = field_validator("column_name")(_pflicht_spaltenname)


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

    roster = {s.id for s in await _kurs_roster(db, user, body.class_id, body.kurs_id)}
    angelegt = 0
    for g in body.grades:
        if g.student_id not in roster:
            continue
        db.add(GradeEntry(category_id=cat.id, student_id=g.student_id, kind="grade", value=g.value, note=body.note or ""))
        angelegt += 1
    if angelegt == 0:
        # Keine einzige Zuordnung -> leere Spalte waere nur Ballast.
        await db.rollback()
        raise HTTPException(400, "Kein Schüler der Übernahme gehört zu diesem Kurs")
    await db.commit()
    return {"imported": angelegt}


# ─── Code-Detektiv-Session als Notenspalte ───
# CD ist klassenlos: Schueler treten oeffentlich mit einem frei getippten Namen
# bei. Uebernahme matcht diesen Namen gegen die SuS des Kurses (normalisiert).
# Nicht zuordenbare Namen werden gemeldet, nicht geraten.

# Frueher stand die Standardskala hier noch einmal (mit Text-Schluesseln).
# `note_aus_pct` normalisiert die Schluessel ohnehin, gerechnet wird an einer
# Stelle — also auch nur eine Skala.
from ..scoring import DEFAULT_SCALE as _DEFAULT_SCALE  # noqa: E402


def _grade_from_pct(pct: float, scale: dict) -> float:
    """Duenner Durchgriff auf scoring.note_aus_pct — die eine Notenrechnung."""
    from ..scoring import note_aus_pct
    return note_aus_pct(pct, scale)


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

    name_ok = field_validator("column_name")(_pflicht_spaltenname)


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

    roster = await _kurs_roster(db, user, body.class_id, body.kurs_id)
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
    students = await _kurs_roster(db, user, class_id, kurs_id)
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


class ImportSection(BaseModel):
    """Abschnitt aus der Datei — dieselben Regeln wie SectionIn (Name, Gewicht)."""
    name: str = "Abschnitt"
    weight: int = 0
    position: int = 0
    categories: List["ImportCategory"] = []

    # Aeltere Dateien schrieben fehlende Werte als null.
    _leer_name = field_validator("name", mode="before")(ohne_none(""))

    _leer_zahl = field_validator("weight", "position", mode="before")(ohne_leer(0))

    @field_validator("name")
    @classmethod
    def name_ok(cls, v: str) -> str:
        return (v or "").strip()[:120] or "Abschnitt"

    weight_ok = field_validator("weight")(_pruefe_gewicht)


class ImportCategory(BaseModel):
    name: str = "Spalte"
    position: int = 0

    _leer_name = field_validator("name", mode="before")(ohne_none(""))

    _leer_zahl = field_validator("position", mode="before")(ohne_leer(0))

    @field_validator("name")
    @classmethod
    def name_ok(cls, v: str) -> str:
        return (v or "").strip()[:120] or "Spalte"


ImportSection.model_rebuild()


def _weich_datum(v):
    """Datum bewusst weich: ein unlesbares Datum aus einer alten Datei kostet nur
    den Zeitstempel, nicht die Note. Frueher wurde es ebenso verworfen."""
    if v in (None, ""):
        return None
    if isinstance(v, datetime):
        return v
    try:
        return datetime.fromisoformat(str(v))
    except ValueError:
        return None


class ImportEntry(BaseModel):
    """Ein Noteneintrag aus der Datei — dieselben Regeln wie EntryIn.

    Hier lief frueher gar keine Pruefung: value/tendency gingen roh in die
    Datenbank, eine 99 oder ein Text als Note sprengte danach jeden gewichteten
    Schnitt. s/c durften Listen sein und rissen den Import in einen 500.
    """
    card_id: Optional[int] = None
    s: Optional[int] = None
    c: Optional[int] = None
    kind: str = "grade"
    value: Optional[float] = None
    tendency: Optional[int] = None
    note: str = ""
    date: Optional[datetime] = None

    _leer = field_validator("kind", "note", mode="before")(ohne_none(""))

    @field_validator("date", mode="before")
    @classmethod
    def _datum(cls, v):
        return _weich_datum(v)

    @field_validator("kind")
    @classmethod
    def kind_ok(cls, v: str) -> str:
        v = v or "grade"
        if v not in ("grade", "observation"):
            raise ValueError("muss 'grade' oder 'observation' sein")
        return v

    value_ok = field_validator("value")(_pruefe_note)
    note_ok = field_validator("note")(_pruefe_notiz)

    @field_validator("tendency")
    @classmethod
    def tendency_ok(cls, v):
        if v is not None and v not in (-1, 0, 1):
            raise ValueError("Tendenz muss -1, 0 oder 1 sein")
        return v


class ImportOverride(BaseModel):
    card_id: Optional[int] = None
    s: Optional[int] = None
    value: Optional[float] = None

    value_ok = field_validator("value")(_pruefe_note)


class ImportDivider(BaseModel):
    s: Optional[int] = None
    c: Optional[int] = None


class NotenImport(BaseModel):
    """Sicherungsdatei einer Klasse. Unbekannte Felder werden ignoriert, damit
    eine Datei aus einem NEUEREN Stand hier nicht scheitert."""
    type: str = ""
    version: int = 1
    term: Optional[str] = None
    sections: List[ImportSection] = []
    entries: List[ImportEntry] = []
    overrides: List[ImportOverride] = []
    dividers: List[ImportDivider] = []

    _leer = field_validator("sections", "entries", "overrides", "dividers", mode="before")(ohne_none([]))


@router.post("/classes/{class_id}/import")
async def import_noten(class_id: int, body: dict, term: str = "1", kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Sicherung zurueckspielen. Die Datei wird gegen NotenImport geprueft —
    dieselben Regeln wie beim Tippen im Notenbuch (Note 1,0–6,0, Gewicht
    0–100 %). Ein falsches Feld gibt 400 samt Feldnamen, nie 500.

    `body: dict` in der Signatur ist Absicht: geprueft() liefert 400 mit
    deutscher Meldung, ein Modell in der Signatur nur FastAPIs englische 422."""
    rate_limit("noten_import", f"u{user.id}", 30, 60, "Zu viele Importe in kurzer Zeit. Bitte kurz warten.")
    if not isinstance(body, dict) or body.get("type") != "nuvora_noten":
        raise HTTPException(400, "Falsches Dateiformat")
    daten = geprueft(NotenImport, body, "Notendatei")
    await _owned_class(db, user, class_id)
    students = await _kurs_roster(db, user, class_id, kurs_id)
    card2sid = {s.card_id: s.id for s in students}
    # Abschnitte + Spalten neu anlegen, Index -> neue ID merken.
    cat_map = {}  # (s_idx, c_idx) -> category_id
    sec_map = {}  # s_idx -> section_id
    pos0 = (await db.execute(select(GradeSection).where(*_sec_kurs_where(user, class_id, kurs_id), GradeSection.term == term))).scalars().all()
    base = len(pos0)
    for si, sec in enumerate(daten.sections):
        gs = GradeSection(owner_id=user.id, class_id=class_id, kurs_id=kurs_id, term=term, name=sec.name,
                          weight=sec.weight, position=base + si)
        db.add(gs)
        await db.flush()
        sec_map[si] = gs.id
        for ci, c in enumerate(sec.categories):
            gc = GradeCategory(owner_id=user.id, class_id=class_id, section_id=gs.id,
                               name=c.name, position=ci)
            db.add(gc)
            await db.flush()
            cat_map[(si, ci)] = gc.id
    for e in daten.entries:
        sid = card2sid.get(e.card_id)
        cid = cat_map.get((e.s, e.c))
        if not sid or not cid:
            continue
        ge = GradeEntry(category_id=cid, student_id=sid, kind=e.kind,
                        value=e.value, tendency=e.tendency, note=e.note)
        if e.date:
            ge.date = e.date
        db.add(ge)
    for o in daten.overrides:
        sid = card2sid.get(o.card_id)
        if not sid or o.value is None:
            continue
        section_id = sec_map.get(o.s) if o.s is not None else None
        if o.s is not None and section_id is None:
            continue
        db.add(GradeOverride(owner_id=user.id, class_id=class_id, kurs_id=(None if section_id is not None else kurs_id),
                             student_id=sid, section_id=section_id, term=term, value=o.value))
    for d in daten.dividers:
        cid = cat_map.get((d.s, d.c))
        if cid:
            db.add(QuartalDivider(class_id=class_id, owner_id=user.id, term=term, after_category_id=cid))
    await db.commit()
    return {"imported": len(daten.sections)}


# ─── Zeugnis-/Eltern-Export: ein gebuendeltes PDF je Schueler ───

async def _zeugnis_pdf(class_id: int, term: str, agg: str, kurs_id: Optional[int],
                       student_id: Optional[int], user: User, db: AsyncSession):
    """Baut das Zeugnis-PDF und gibt (bytes, dateiname) zurueck. Genutzt vom
    PDF-Endpoint und vom gebuendelten ZIP-Export."""
    sc = await _owned_class(db, user, class_id)
    sections, summaries = await _summarize(db, user, class_id, term, agg="median" if agg == "median" else "mean", kurs_id=kurs_id)
    sum_by_id = {s.student_id: s for s in summaries}
    students = await _kurs_roster(db, user, class_id, kurs_id)
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
        from reportlab.lib.units import mm
        # A4-Leinwand aus app/pdfdruck.py — dieselben Zeilen standen an acht Stellen.
        c, w, h = neue_seite(buf)
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
    buf = io.BytesIO(); build(buf)
    safe = re.sub(r"[^\w-]+", "_", sc.name) or "klasse"
    return buf.getvalue(), f"Zeugnis_{safe}_{halb.replace('. ', '')}.pdf"


@router.get("/classes/{class_id}/zeugnis.pdf")
async def zeugnis_export(class_id: int, term: str = "1", agg: str = "mean", kurs_id: Optional[int] = None,
                         student_id: Optional[int] = None,
                         user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Gebuendelter Eltern-/Zeugnis-Export: je Schueler eine Seite mit Noten
    (gewichteter Schnitt + Abschnitte), Fehlzeiten und Karten-Fortschritt.
    Fehlzeiten/Karten nur, wenn die Module aktiv sind (Regel 3 — Noten laeuft
    ohne sie voll). Besonders schuetzenswerte Daten (foerder/notizen) sind
    bewusst NICHT enthalten."""
    pdf, name = await _zeugnis_pdf(class_id, term, agg, kurs_id, student_id, user, db)
    return als_anhang(pdf, name)


@router.get("/classes/{class_id}/export.zip")
async def export_bundle(class_id: int, term: str = "1", agg: str = "mean", kurs_id: Optional[int] = None,
                        user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Gebuendelter Noten-Export: die Daten (JSON, re-importierbar) UND das
    Zeugnis-PDF in einer ZIP. foerder/notizen bleiben aussen vor (wie im JSON/PDF)."""
    import io, json, zipfile
    from fastapi.responses import StreamingResponse
    sc = await _owned_class(db, user, class_id)
    data = await export_noten(class_id, term, kurs_id, user, db)
    pdf, pdf_name = await _zeugnis_pdf(class_id, term, agg, kurs_id, None, user, db)
    safe = re.sub(r"[^\w-]+", "_", sc.name) or "klasse"
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"noten-{safe}-hj{term}.json", json.dumps(data, ensure_ascii=False, indent=2))
        z.writestr(pdf_name, pdf)
    zbuf.seek(0)
    return StreamingResponse(zbuf, media_type="application/zip",
                             headers={"Content-Disposition": f'attachment; filename="noten-{safe}-hj{term}.zip"'})
