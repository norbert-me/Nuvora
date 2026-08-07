from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import SchoolClass, Student, User, Kurs, KursTag
from .auth import get_current_user, rate_limit

router = APIRouter(prefix="/api/classes", tags=["classes"])


# Feste Auswahl statt Freitext: die Werte steuern die Differenzierung in
# Lernpfad — Tippfehler wuerden dort still zu einer eigenen Kategorie.
#
# Wortlaut exakt wie in der bisherigen Lernleiter-App (inkl. Umlaut in
# "Hoeren" -> "Hören"): die Bestandsdaten benutzen genau diese Zeichenketten,
# jede Abweichung macht sie beim Uebernehmen unbrauchbar.
FOERDER_VALUES = {
    "LRS", "Dyskalkulie", "Lesen", "DaZ", "Lernen", "Sozial-Emotional",
    "Auditive Wahrnehmung", "Motorik", "Konzentration", "Sehen", "Hören",
    "Sprache",
}

# Foerdermassnahmen: was zum Schwerpunkt konkret vereinbart ist. Feste Auswahl
# aus einem Grund — die Massnahme mit „arbeit" steuert, was der Kalender am
# Klassenarbeitstermin anzeigt; Freitext waere dort nicht wiederfindbar. Das
# Konkrete steht im Detail-Feld ("+25 %", "nur Aufgaben 1-4").
MASSNAHMEN_VALUES = {
    "Zeitzuschlag", "Abweichende Lernziele", "Weniger Aufgaben", "Vorlesen",
    "Größere Schrift", "Hilfsmittel", "Eigener Raum", "Zusätzliche Pausen",
    "Assistenz", "Rechtschreibung nicht bewertet", "Mündlich statt schriftlich",
    "Sonstiges",
}


class MassnahmeIn(BaseModel):
    art: str
    detail: str = ""
    # Gilt in Klassenarbeiten? Genau diese zeigt der Kalender am Termin.
    arbeit: bool = False

    @field_validator("art")
    @classmethod
    def valid_art(cls, v: str) -> str:
        v = (v or "").strip()
        if v not in MASSNAHMEN_VALUES:
            raise ValueError(f"Unbekannte Fördermaßnahme: {v}")
        return v

    @field_validator("detail")
    @classmethod
    def detail_len(cls, v: str) -> str:
        v = (v or "").strip()
        if len(v) > 300:
            raise ValueError("Beschreibung zu lang (max. 300 Zeichen)")
        return v


class StudentIn(BaseModel):
    card_id: int
    name: str
    # Angaben zur Person (siehe Student in models.py). foerder und notizen sind
    # besonders schuetzenswert (DSGVO Art. 9) — nie veroeffentlichen.
    niveau: str = ""
    foerder: Optional[List[str]] = None
    massnahmen: Optional[List[MassnahmeIn]] = None
    notizen: str = ""
    klassenlehrer: str = ""

    @field_validator("massnahmen")
    @classmethod
    def massnahmen_anzahl(cls, v):
        if v is not None and len(v) > 20:
            raise ValueError("Zu viele Fördermaßnahmen (max. 20)")
        return v

    @field_validator("klassenlehrer")
    @classmethod
    def kl_len(cls, v: str) -> str:
        v = v.strip()
        if len(v) > 120:
            raise ValueError("Name der Klassenleitung zu lang (max. 120 Zeichen)")
        return v

    @field_validator("niveau")
    @classmethod
    def valid_niveau(cls, v: str) -> str:
        if v not in ("", "E", "G"):
            raise ValueError("Niveau muss E, G oder leer sein")
        return v

    @field_validator("foerder")
    @classmethod
    def valid_foerder(cls, v):
        if v is None:
            return v
        unknown = set(v) - FOERDER_VALUES
        if unknown:
            raise ValueError(f"Unbekannter Foerderschwerpunkt: {', '.join(sorted(unknown))}")
        return v

    @field_validator("notizen")
    @classmethod
    def notizen_len(cls, v: str) -> str:
        if len(v) > 2000:
            raise ValueError("Notiz zu lang (max. 2000 Zeichen)")
        return v


def _massnahmen(s: "StudentIn"):
    """Pydantic-Objekte in die JSON-Spalte schreiben — dicts, keine Modelle."""
    if s.massnahmen is None:
        return None
    return [m.model_dump() for m in s.massnahmen]


class StudentOut(BaseModel):
    id: int
    card_id: int
    name: str
    niveau: str = ""
    foerder: Optional[List[str]] = None
    massnahmen: Optional[List[MassnahmeIn]] = None
    notizen: str = ""
    klassenlehrer: str = ""
    has_photo: bool = False
    model_config = {"from_attributes": True}


# Farbpalette fuer Klassen — gut unterscheidbar, in Hell/Dunkel lesbar.
_CLASS_COLORS = ["#2563eb", "#0a7d3e", "#b8860b", "#7c3aed", "#d1350f", "#0891b2", "#db2777", "#65a30d", "#ea580c", "#4f46e5"]


def _auto_color(name: str) -> str:
    h = sum(ord(c) for c in (name or "")) if name else 0
    return _CLASS_COLORS[h % len(_CLASS_COLORS)]


class ClassCreate(BaseModel):
    name: str
    color: str = ""
    students: List[StudentIn] = []

    @field_validator("students")
    @classmethod
    def limit_students(cls, v):
        if len(v) > 60:
            raise ValueError("Zu viele Lernende (max. 60 pro Klasse)")
        return v

    @field_validator("name")
    @classmethod
    def name_len(cls, v):
        if len(v) > 100:
            raise ValueError("Klassenname zu lang")
        return v


class ClassOut(BaseModel):
    id: int
    name: str
    color: str = ""
    kurs_id: Optional[int] = None
    students: List[StudentOut] = []
    model_config = {"from_attributes": True}


@router.post("", response_model=ClassOut, status_code=201)
async def create_class(body: ClassCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rate_limit("cls_create", f"u{user.id}", 30, 60, "Zu viele Klassen in kurzer Zeit. Bitte kurz warten.")
    # Neue Klasse bekommt ihren eigenen Kurs (Phase 1: 1:1). Gruppieren später.
    kurs = Kurs(owner_id=user.id, name=body.name)
    db.add(kurs)
    await db.flush()
    sc = SchoolClass(name=body.name, owner_id=user.id, color=body.color or _auto_color(body.name), kurs_id=kurs.id)
    db.add(sc)
    await db.flush()
    db.add(KursTag(kurs_id=kurs.id, class_id=sc.id))  # Mitgliedschaft (many-to-many)
    for s in body.students:
        db.add(Student(card_id=s.card_id, name=s.name, class_id=sc.id, kurs_id=kurs.id,
                       niveau=s.niveau, foerder=s.foerder, massnahmen=_massnahmen(s), notizen=s.notizen,
                       klassenlehrer=s.klassenlehrer))
    await db.commit()
    return await _load_class(db, sc.id)


@router.get("", response_model=List[ClassOut])
async def list_classes(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(SchoolClass)
        .options(selectinload(SchoolClass.students))
        .where(SchoolClass.owner_id == user.id)
        .where(SchoolClass.deleted_at.is_(None))  # Papierkorb-Klassen ausblenden
        .order_by(SchoolClass.name)
    )
    return result.scalars().all()


@router.get("/trash", response_model=List[ClassOut])
async def list_trash(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Gelöschte Klassen im Papierkorb (noch wiederherstellbar). Muss vor der
    /{class_id}-Route stehen, sonst schluckt der int-Parser 'trash'."""
    result = await db.execute(
        select(SchoolClass)
        .options(selectinload(SchoolClass.students))
        .where(SchoolClass.owner_id == user.id, SchoolClass.deleted_at.is_not(None))
        .order_by(SchoolClass.deleted_at.desc())
    )
    return result.scalars().all()


class MassnahmenStudentOut(BaseModel):
    """Ein Kind mit dem, was für es vereinbart ist — für Ansichten, die die
    Abweichungen brauchen (z.B. der Kalender am Klassenarbeitstermin)."""
    student_id: int
    card_id: int
    name: str
    foerder: List[str] = []
    massnahmen: List[MassnahmeIn] = []


@router.get("/{class_id}/massnahmen", response_model=List[MassnahmenStudentOut])
async def list_massnahmen(
    class_id: int,
    arbeit: bool = False,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Fördermaßnahmen der Klasse, nur Kinder, für die etwas hinterlegt ist.
    arbeit=true filtert auf das, was in Klassenarbeiten gilt (Zeitzuschlag,
    abweichende Lernziele …) — genau das zeigt der Kalender am Termin.

    Besonders schützenswert (DSGVO Art. 9): nur der Besitzer der Klasse."""
    sc = await db.get(SchoolClass, class_id)
    if not sc or sc.owner_id != user.id:
        raise HTTPException(404, "Klasse nicht gefunden")
    rows = (await db.execute(
        select(Student).where(Student.class_id == class_id).order_by(Student.card_id)
    )).scalars().all()
    out = []
    for s in rows:
        ms = [m for m in (s.massnahmen or []) if not arbeit or m.get("arbeit")]
        if not ms:
            continue
        out.append(MassnahmenStudentOut(
            student_id=s.id, card_id=s.card_id, name=s.name,
            foerder=list(s.foerder or []), massnahmen=[MassnahmeIn(**m) for m in ms],
        ))
    return out


@router.get("/{class_id}", response_model=ClassOut)
async def get_class(class_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    sc = await _load_class(db, class_id)
    if not sc:
        raise HTTPException(404)
    if sc.owner_id != user.id:
        raise HTTPException(403)
    return sc


@router.put("/{class_id}", response_model=ClassOut)
async def update_class(class_id: int, body: ClassCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    sc = await db.get(SchoolClass, class_id)
    if not sc:
        raise HTTPException(404)
    if sc.owner_id != user.id:
        raise HTTPException(403, "Keine Berechtigung")
    sc.name = body.name
    sc.color = body.color or sc.color or _auto_color(body.name)
    if not sc.owner_id:
        sc.owner_id = user.id

    # WICHTIG: Schueler NIE loeschen+neu anlegen. Das Loeschen kaskadiert
    # (ON DELETE CASCADE) auf Noten (grade_entries), Karten-Fortschritt
    # (card_reviews) und mehr — ein Klassen-Speichern (z.B. nur die Farbe)
    # wuerde sonst live Daten vernichten. Stattdessen ueber die stabile card_id
    # zusammenfuehren: vorhandene aktualisieren, neue anlegen, entfernte loeschen.
    existing = (await db.execute(select(Student).where(Student.class_id == class_id))).scalars().all()
    by_card = {s.card_id: s for s in existing}
    seen = set()
    for s in body.students:
        seen.add(s.card_id)
        cur = by_card.get(s.card_id)
        if cur:  # vorhandenen Schueler in-place aktualisieren, ID bleibt erhalten
            cur.name = s.name
            cur.niveau = s.niveau
            cur.foerder = s.foerder
            cur.massnahmen = _massnahmen(s)
            cur.notizen = s.notizen
            cur.klassenlehrer = s.klassenlehrer
        else:
            db.add(Student(card_id=s.card_id, name=s.name, class_id=class_id, kurs_id=sc.kurs_id,
                           niveau=s.niveau, foerder=s.foerder, massnahmen=_massnahmen(s), notizen=s.notizen,
                           klassenlehrer=s.klassenlehrer))
    # Nur wirklich entfernte Karten loeschen (deren Daten sollen dann auch weg).
    for card_id, s in by_card.items():
        if card_id not in seen:
            await db.delete(s)

    await db.flush()
    await _sync_siblings(db, sc)
    await db.commit()
    return await _load_class(db, class_id)


async def _sync_siblings(db: AsyncSession, sc: SchoolClass):
    """Kurs-Konzept: SuS einmal pflegen. Anlegen und Bearbeiten von Schülern
    einer Fach-Klasse werden auf die Geschwister-Klassen desselben Kurses
    gespiegelt (Abgleich per Name). Bewusst KEIN automatisches Löschen in den
    Geschwistern — Entfernen kaskadiert (Noten/Karten) und bleibt pro Klasse
    eine bewusste Handlung. Attendance ist ohnehin schon kursweit geteilt."""
    from .kurse import sibling_class_ids
    sib_ids = await sibling_class_ids(db, sc.id)
    sib_ids.discard(sc.id)
    if not sib_ids:
        return
    geschwister = (await db.execute(select(SchoolClass).where(
        SchoolClass.id.in_(sib_ids), SchoolClass.deleted_at.is_(None)
    ))).scalars().all()
    if not geschwister:
        return
    meine = (await db.execute(select(Student).where(Student.class_id == sc.id))).scalars().all()
    for g in geschwister:
        vorhanden = (await db.execute(select(Student).where(Student.class_id == g.id))).scalars().all()
        by_name = {s.name.strip(): s for s in vorhanden}
        next_card = (max((s.card_id for s in vorhanden), default=0) + 1)
        for m in meine:
            twin = by_name.get(m.name.strip())
            if twin:  # Felder angleichen (Name-Identität bleibt)
                twin.niveau = m.niveau
                twin.foerder = m.foerder
                twin.massnahmen = m.massnahmen
                twin.notizen = m.notizen
                twin.klassenlehrer = m.klassenlehrer
            else:  # neuer Schüler -> in die Geschwister-Klasse übernehmen
                db.add(Student(card_id=next_card, name=m.name, class_id=g.id, kurs_id=sc.kurs_id,
                               niveau=m.niveau, foerder=m.foerder, massnahmen=m.massnahmen,
                               notizen=m.notizen, klassenlehrer=m.klassenlehrer))
                next_card += 1


class ColorIn(BaseModel):
    color: str = ""


@router.put("/{class_id}/color", response_model=ClassOut)
async def set_class_color(class_id: int, body: ColorIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Nur die Klassenfarbe setzen — leichtgewichtig (z.B. aus dem Stundenplan),
    ruehrt Schueler nicht an."""
    sc = await db.get(SchoolClass, class_id)
    if not sc:
        raise HTTPException(404)
    if sc.owner_id != user.id:
        raise HTTPException(403, "Keine Berechtigung")
    sc.color = body.color or _auto_color(sc.name)
    if not sc.owner_id:
        sc.owner_id = user.id
    await db.commit()
    return await _load_class(db, class_id)


@router.delete("/{class_id}", status_code=204)
async def delete_class(class_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Soft-Delete: in den Papierkorb, 30 Tage wiederherstellbar. Die Kaskade
    (Schüler → Noten/Karten/…) bleibt in dieser Zeit erhalten."""
    sc = await db.get(SchoolClass, class_id)
    if not sc:
        raise HTTPException(404)
    if sc.owner_id != user.id:
        raise HTTPException(403, "Keine Berechtigung")
    from datetime import datetime, timezone
    sc.deleted_at = datetime.now(timezone.utc)
    await db.commit()


@router.post("/{class_id}/restore", response_model=ClassOut)
async def restore_class(class_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    sc = await _load_class(db, class_id)
    if not sc or sc.owner_id != user.id:
        raise HTTPException(404)
    sc.deleted_at = None
    await db.commit()
    return sc


@router.delete("/{class_id}/purge", status_code=204)
async def purge_class(class_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Endgültig löschen (aus dem Papierkorb). Erst hier greift die Kaskade."""
    sc = await db.get(SchoolClass, class_id)
    if not sc or sc.owner_id != user.id:
        raise HTTPException(404)
    if sc.deleted_at is None:
        raise HTTPException(400, "Klasse ist nicht im Papierkorb")
    await db.delete(sc)
    await db.commit()


async def _load_class(db: AsyncSession, class_id: int) -> Optional[SchoolClass]:
    result = await db.execute(
        select(SchoolClass).options(selectinload(SchoolClass.students)).where(SchoolClass.id == class_id)
    )
    return result.scalar_one_or_none()


# ─── SuS-Foto (personenbezogen; NIE in Export/Marktplatz) ───
_PHOTO_MAX = 5 * 1024 * 1024  # 5 MB


async def _owned_student(db: AsyncSession, user: User, student_id: int) -> Student:
    st = await db.get(Student, student_id)
    if not st:
        raise HTTPException(404, "Schüler nicht gefunden")
    cls = await db.get(SchoolClass, st.class_id)
    if not cls or cls.owner_id != user.id:
        raise HTTPException(404, "Schüler nicht gefunden")
    return st


@router.post("/students/{student_id}/photo", response_model=StudentOut)
async def upload_student_photo(student_id: int, file: UploadFile = File(...),
                               user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rate_limit("student_photo", f"u{user.id}", 120, 60, "Zu viele Uploads. Bitte kurz warten.")
    st = await _owned_student(db, user, student_id)
    mime = (file.content_type or "").lower()
    if not mime.startswith("image/"):
        raise HTTPException(400, "Nur Bilddateien erlaubt")
    data = await file.read()
    if not data:
        raise HTTPException(400, "Datei ist leer")
    if len(data) > _PHOTO_MAX:
        raise HTTPException(413, "Bild zu groß (max. 5 MB)")
    st.photo = data
    st.photo_mime = mime[:120]
    await db.commit()
    await db.refresh(st)
    return st


@router.delete("/students/{student_id}/photo", response_model=StudentOut)
async def delete_student_photo(student_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    st = await _owned_student(db, user, student_id)
    st.photo = None
    st.photo_mime = ""
    await db.commit()
    await db.refresh(st)
    return st


@router.get("/students/{student_id}/photo")
async def get_student_photo(student_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await _owned_student(db, user, student_id)
    row = (await db.execute(select(Student.photo, Student.photo_mime).where(Student.id == student_id))).first()
    if not row or not row[0]:
        raise HTTPException(404, "Kein Foto")
    return Response(content=row[0], media_type=row[1] or "image/jpeg", headers={"Cache-Control": "private, max-age=3600"})
