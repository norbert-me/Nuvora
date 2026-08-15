"""Modul Kalender — Unterrichtsplanung.

Eigenstaendig (Regel 3): eigene Eintraege, aber Klassen und Themen kommen aus
dem Kern. Ein Eintrag kann optional an eine Klasse und ein Thema haengen; das
Thema ist ON DELETE SET NULL, damit das Loeschen eines Themas keinen Eintrag
mitreisst.
"""
import re
from datetime import datetime, date, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator, field_validator
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..importe import geprueft
from ..models import CalendarBreak, CalendarEntry, CardDeck, ExamDate, Kurs, SchoolClass, TimetableSlot, SlotCancellation, Topic, User, WorkAnalysis, Session as TestSession
from .auth import rate_limit
from .modules import is_active, modul_pflicht

router = APIRouter(prefix="/api/kalender", tags=["kalender"])
MODULE_KEY = "kalender"


require_module = modul_pflicht(MODULE_KEY)


async def _check_class(db: AsyncSession, user: User, class_id: Optional[int]) -> None:
    if class_id is None:
        return
    r = await db.execute(select(SchoolClass.id).where(SchoolClass.id == class_id, SchoolClass.owner_id == user.id))
    if not r.scalar_one_or_none():
        raise HTTPException(404, "Klasse nicht gefunden")


async def _check_topic(db: AsyncSession, user: User, topic_id: Optional[int]) -> None:
    if topic_id is None:
        return
    r = await db.execute(select(Topic.id).where(Topic.id == topic_id, Topic.owner_id == user.id))
    if not r.scalar_one_or_none():
        raise HTTPException(404, "Thema nicht gefunden")


async def _check_kurs(db: AsyncSession, user: User, kurs_id: Optional[int]) -> None:
    if kurs_id is None:
        return
    r = await db.execute(select(Kurs.id).where(Kurs.id == kurs_id, Kurs.owner_id == user.id))
    if not r.scalar_one_or_none():
        raise HTTPException(404, "Kurs nicht gefunden")


class PhaseItem(BaseModel):
    phase: str = ""
    dauer: str = ""
    text: str = ""


class EntryIn(BaseModel):
    date: datetime
    title: str = ""
    notes: str = ""
    verlaufsplan: List[PhaseItem] = []
    class_id: Optional[int] = None
    kurs_id: Optional[int] = None   # gewaehlter Kurs (Fach) — Anzeige beim Bearbeiten
    topic_id: Optional[int] = None
    method_id: Optional[int] = None
    period: Optional[int] = None
    start_time: str = ""   # optionale freie Uhrzeit "HH:MM"
    end_time: str = ""

    @model_validator(mode="after")
    def _times_ok(self):
        # Endzeit (falls beide gesetzt) muss nach der Startzeit liegen.
        if self.start_time and self.end_time and self.end_time <= self.start_time:
            raise ValueError("Die Endzeit muss nach der Startzeit liegen")
        return self
    cardvote_set_id: Optional[int] = None
    karten_deck_id: Optional[int] = None
    lernpfad_ladder_id: Optional[int] = None
    codedetektiv_puzzle: Optional[str] = None


class EntryOut(EntryIn):
    id: int
    # Gehoert der Eintrag zu einem Klassenarbeitstermin? Dann kann die Ansicht
    # die Nachteilsausgleiche und (bei aktivem Modul) die Auswertung anbieten,
    # ohne die Klassenarbeitsliste nachzuladen.
    exam_id: Optional[int] = None
    work_id: Optional[int] = None
    model_config = {"from_attributes": True}

    @field_validator("verlaufsplan", mode="before")
    @classmethod
    def _vp_none(cls, v):
        return v or []


@router.get("/entries", response_model=List[EntryOut])
async def list_entries(frm: Optional[datetime] = None, to: Optional[datetime] = None,
                       user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Eintraege, optional auf einen Zeitraum (frm..to) eingegrenzt."""
    q = select(CalendarEntry).where(CalendarEntry.owner_id == user.id)
    if frm is not None:
        q = q.where(CalendarEntry.date >= frm)
    if to is not None:
        q = q.where(CalendarEntry.date <= to)
    rows = (await db.execute(q.order_by(CalendarEntry.date))).scalars().all()
    # Klassenarbeitstermine an ihre Eintraege haengen (ein Aufruf statt N).
    exams = (await db.execute(select(ExamDate).where(
        ExamDate.owner_id == user.id, ExamDate.entry_id.is_not(None)))).scalars().all()
    by_entry = {e.entry_id: e for e in exams}
    out = []
    for r in rows:
        item = EntryOut.model_validate(r)
        ex = by_entry.get(r.id)
        if ex:
            item.exam_id = ex.id
            item.work_id = ex.work_id
        out.append(item)
    return out


async def _check_verknuepfungen(db: AsyncSession, user: User, body) -> None:
    """Geplantes Quiz/Deck/Lernleiter/Einstieg: gehoert es dem Nutzer, und laeuft
    das Modul ueberhaupt?

    Die Oberflaeche blendet den Selektor aus, wenn ein Modul fehlt — der Server
    nahm die Verknuepfung aber trotzdem an, samt FREMDER IDs: `**model_dump()`
    schrieb alles ungeprueft in den Eintrag. Regel 3 gilt auch dann, wenn
    niemand hinsieht; und eine fremde ID ist eine Mandantengrenze, keine
    Nachlaessigkeit.
    """
    from ..models import CardDeck, LearningLadder, Method, QuestionSet
    from .modules import is_active

    # (Feld, Modul, Modell, Eigentuemer-Spalte)
    felder = (
        ("cardvote_set_id", "cardvote", QuestionSet, "owner_id"),
        ("karten_deck_id", "karten", CardDeck, "owner_id"),
        ("lernpfad_ladder_id", "lernpfad", LearningLadder, None),
        ("method_id", "unterrichtsplanung", Method, "owner_id"),
    )
    for feld, modul, modell, eigner in felder:
        wert = getattr(body, feld, None)
        if wert is None:
            continue
        if not await is_active(db, user.id, modul):
            raise HTTPException(403, f"Modul {modul} ist nicht aktiv")
        obj = await db.get(modell, wert)
        # Die Lernleiter haengt am Pfad, nicht direkt am Konto — dort prueft der
        # Lernpfad-Router; hier reicht, dass es sie gibt.
        if not obj or (eigner and getattr(obj, eigner, None) != user.id):
            raise HTTPException(404, "Verknüpfter Eintrag nicht gefunden")


@router.post("/entries", response_model=EntryOut, status_code=201)
async def create_entry(body: EntryIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("kalender_entry", f"u{user.id}", 300, 60, "Zu viele Eintraege. Bitte kurz warten.")
    await _check_class(db, user, body.class_id)
    await _check_kurs(db, user, body.kurs_id)
    await _check_topic(db, user, body.topic_id)
    await _check_verknuepfungen(db, user, body)
    e = CalendarEntry(owner_id=user.id, **body.model_dump())
    db.add(e)
    await db.commit()
    await db.refresh(e)
    await _release_matching_decks(db, user, e)
    return e


@router.put("/entries/{entry_id}", response_model=EntryOut)
async def update_entry(entry_id: int, body: EntryIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    e = await db.get(CalendarEntry, entry_id)
    if not e or e.owner_id != user.id:
        raise HTTPException(404, "Eintrag nicht gefunden")
    await _check_class(db, user, body.class_id)
    await _check_kurs(db, user, body.kurs_id)
    await _check_topic(db, user, body.topic_id)
    await _check_verknuepfungen(db, user, body)
    for k, v in body.model_dump().items():
        setattr(e, k, v)
    await db.commit()
    await db.refresh(e)
    await _release_matching_decks(db, user, e)
    return e


def _tagesbeginn(dt) -> datetime:
    """Beginn des Kalendertags (UTC). Eintraege sind auf die Tagesmitte verankert;
    wer daraus direkt ein released_at macht, schaltet den Stapel erst am Nachmittag
    frei — die Stunde am Vormittag sieht ihn nicht. Freigegeben wird AB TAGESBEGINN.
    (Gleiche Funktion in karten.py — kein Modul haengt am anderen, Regel 3.)"""
    d = dt.date() if isinstance(dt, datetime) else dt
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)


async def _release_matching_decks(db: AsyncSession, user: User, e: CalendarEntry) -> None:
    """Zusatz (Regel 3): plant der Kalender ein Thema, wird ein passender, noch
    nicht ausgerollter Karten-Stapel automatisch zum Termin freigeschaltet.
    Nur Entwuerfe (released_at NULL) — eine manuelle Freigabe bleibt unberuehrt.
    Laeuft nur, wenn das Karten-Modul aktiv ist (keine Auto-Verknuepfung bei
    abgeschaltetem Modul).
    """
    if not await is_active(db, user.id, "karten"):
        return
    # Explizit verknuepftes Deck: am Kalendertag freischalten, falls noch Entwurf.
    if e.karten_deck_id:
        deck = await db.get(CardDeck, e.karten_deck_id)
        if deck and deck.owner_id == user.id and deck.released_at is None:
            deck.released_at = _tagesbeginn(e.date)
            await db.commit()
    if not e.topic_id:
        return
    # Alle passenden Stapel zum Thema (auch bereits ausgerollte — die sollen sich
    # ja trotzdem am Eintrag zeigen). Stapel hängen am KURS: Deck der Klasse ODER
    # eines Kurses, in dem die Klasse liegt.
    q = select(CardDeck).where(
        CardDeck.owner_id == user.id,
        CardDeck.topic_id == e.topic_id,
        CardDeck.deleted_at.is_(None),
    )
    if e.class_id:
        from .kurse import class_kurs_ids
        kurse = list(await class_kurs_ids(db, e.class_id))
        if kurse:
            q = q.where(or_(CardDeck.kurs_id.in_(kurse), CardDeck.class_id == e.class_id))
        else:
            q = q.where(CardDeck.class_id == e.class_id)
    matched = (await db.execute(q.order_by(CardDeck.id))).scalars().all()
    for deck in matched:
        if deck.released_at is None:   # Entwürfe ab Beginn des Termintags freischalten
            deck.released_at = _tagesbeginn(e.date)
    # Automatisch mit dem Eintrag verknüpfen, wenn dort noch kein Stapel hängt.
    if matched and not e.karten_deck_id:
        e.karten_deck_id = matched[0].id
    await db.commit()


async def _class_maps(db, user):
    rows = (await db.execute(select(SchoolClass).where((SchoolClass.owner_id == user.id) | (SchoolClass.owner_id.is_(None))))).scalars().all()
    id2name = {c.id: c.name for c in rows}
    # Zuordnung ueber den Namen NUR auf eigene Klassen: der Import haengte Eintraege
    # sonst an kontenlose Alt-Klassen, die mehreren Konten gemeinsam sind.
    name2id = {c.name: c.id for c in rows if c.owner_id == user.id}
    return id2name, name2id


async def _topic_maps(db, user):
    rows = (await db.execute(select(Topic).where(Topic.owner_id == user.id))).scalars().all()
    by_id = {t.id: t for t in rows}
    def path(tid):
        t = by_id.get(tid)
        if not t:
            return ""
        p = by_id.get(t.parent_id) if t.parent_id else None
        return f"{p.name} / {t.name}" if p else t.name
    path2id = {path(t.id): t.id for t in rows}
    return path, path2id


@router.get("/export")
async def export_kalender(user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    id2name, _ = await _class_maps(db, user)
    tpath, _ = await _topic_maps(db, user)
    slots = (await db.execute(select(TimetableSlot).where(TimetableSlot.owner_id == user.id))).scalars().all()
    entries = (await db.execute(select(CalendarEntry).where(CalendarEntry.owner_id == user.id).order_by(CalendarEntry.date))).scalars().all()
    breaks = (await db.execute(select(CalendarBreak).where(CalendarBreak.owner_id == user.id).order_by(CalendarBreak.start_date))).scalars().all()
    return {
        "type": "nuvora_kalender", "version": 1,
        "timetable": {
            "periods": user.timetable_periods or 6,
            "times": user.timetable_times or [],
            "slots": [{"weekday": s.weekday, "period": s.period, "class": id2name.get(s.class_id), "title": s.title} for s in slots],
        },
        "breaks": [{"start_date": b.start_date.isoformat(), "end_date": b.end_date.isoformat(), "label": b.label} for b in breaks],
        "entries": [{"date": e.date.isoformat(), "period": e.period, "title": e.title, "notes": e.notes,
                     "class": id2name.get(e.class_id), "topic": tpath(e.topic_id) if e.topic_id else ""} for e in entries],
    }


class ImportSlot(BaseModel):
    """Stundenplan-Stunde aus der Datei — dieselben Grenzen wie upsert_slot."""
    weekday: int = 0
    period: int = 1
    class_: Optional[str] = Field(default=None, alias="class")
    title: str = ""
    model_config = {"populate_by_name": True}

    @field_validator("weekday", "period", mode="before")
    @classmethod
    def _leer_zahl(cls, v):
        return None if v == "" else v

    @field_validator("title", mode="before")
    @classmethod
    def _leer_text(cls, v):
        return "" if v is None else v

    @field_validator("weekday")
    @classmethod
    def weekday_ok(cls, v: int) -> int:
        if not 0 <= v <= 6:
            raise ValueError("Wochentag muss zwischen 0 (Montag) und 6 (Sonntag) liegen")
        return v

    @field_validator("period")
    @classmethod
    def period_ok(cls, v: int) -> int:
        if v < 1:
            raise ValueError("Stunde muss mindestens 1 sein")
        return v


class ImportTimetable(BaseModel):
    periods: Optional[int] = None
    times: Optional[list] = None
    slots: Optional[List[ImportSlot]] = None

    @field_validator("periods", mode="before")
    @classmethod
    def _leer_zahl(cls, v):
        return None if v in ("", 0) else v

    @field_validator("periods")
    @classmethod
    def periods_ok(cls, v):
        # Gleiche Regel wie set_periods.
        if v is not None and not 1 <= v <= 16:
            raise ValueError("Stundenzahl muss zwischen 1 und 16 liegen")
        return v


class ImportBreak(BaseModel):
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    label: str = ""

    @field_validator("label", mode="before")
    @classmethod
    def _leer_text(cls, v):
        return "" if v is None else v


class ImportKalEntry(BaseModel):
    date: Optional[datetime] = None
    period: Optional[int] = None
    title: str = ""
    notes: str = ""
    class_: Optional[str] = Field(default=None, alias="class")
    topic: Optional[str] = None
    model_config = {"populate_by_name": True}

    @field_validator("title", "notes", mode="before")
    @classmethod
    def _leer_text(cls, v):
        return "" if v is None else v

    @field_validator("period", mode="before")
    @classmethod
    def _leer_zahl(cls, v):
        return None if v == "" else v


class KalenderImport(BaseModel):
    """Sicherungsdatei des Kalenders. Unbekannte Felder werden ignoriert."""
    type: str = ""
    version: int = 1
    timetable: ImportTimetable = ImportTimetable()
    breaks: List[ImportBreak] = []
    entries: List[ImportKalEntry] = []

    @field_validator("timetable", mode="before")
    @classmethod
    def _leer_tt(cls, v):
        return {} if v is None else v

    @field_validator("breaks", "entries", mode="before")
    @classmethod
    def _leer_liste(cls, v):
        return [] if v is None else v


@router.post("/import")
async def import_kalender(body: dict, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Sicherung zurueckspielen. Geprueft wie beim Bearbeiten im Stundenplan
    (Wochentag 0–6, Stunde ≥ 1, Stundenzahl 1–16); ein falsches Feld gibt 400
    samt Feldnamen statt eines 500 aus int()/TypeError.

    `body: dict` in der Signatur ist Absicht — siehe app/importe.py."""
    rate_limit("kalender_import", f"u{user.id}", 30, 60, "Zu viele Importe in kurzer Zeit. Bitte kurz warten.")
    if not isinstance(body, dict) or body.get("type") != "nuvora_kalender":
        raise HTTPException(400, "Falsches Dateiformat")
    daten = geprueft(KalenderImport, body, "Kalenderdatei")
    _, name2id = await _class_maps(db, user)
    _, path2id = await _topic_maps(db, user)
    tt = daten.timetable
    if tt.periods:
        user.timetable_periods = tt.periods
    if tt.times is not None:
        user.timetable_times = tt.times
    # Stundenplan-Slots ersetzen (Wochentag+Stunde eindeutig).
    if tt.slots is not None:
        for s in (await db.execute(select(TimetableSlot).where(TimetableSlot.owner_id == user.id))).scalars().all():
            await db.delete(s)
        for s in tt.slots:
            db.add(TimetableSlot(owner_id=user.id, weekday=s.weekday, period=s.period,
                                 class_id=name2id.get(s.class_), title=s.title))
    for b in daten.breaks:
        # Ein Zeitraum ohne Anfang oder Ende wird uebergangen (wie bisher) —
        # eine unvollstaendige Zeile aus einer alten Datei soll den Lauf nicht abbrechen.
        if b.start_date is None or b.end_date is None:
            continue
        db.add(CalendarBreak(owner_id=user.id, start_date=b.start_date,
                             end_date=b.end_date, label=b.label[:120]))
    n = 0
    for e in daten.entries:
        if e.date is None:
            continue
        db.add(CalendarEntry(owner_id=user.id, date=e.date, period=e.period, title=e.title[:200],
                             notes=e.notes, class_id=name2id.get(e.class_), topic_id=path2id.get(e.topic)))
        n += 1
    await db.commit()
    return {"imported": n}


@router.get("/quiz-session")
async def quiz_session(set_id: int, class_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Neueste CardVote-Session, die dieses Quiz für diese Klasse gelaufen ist —
    für den Sprung „Ergebnis als Note" aus einem Kalender-Eintrag.

    Regel 3: die Antwort kommt aus CardVote-Daten. Ohne aktives CardVote gibt es
    hier nichts herauszugeben — eine leere Antwort statt einer session_id (und
    kein 403: der Kalender laeuft ohne CardVote vollstaendig weiter, der Sprung
    entfaellt dann einfach)."""
    if not await is_active(db, user.id, "cardvote"):
        return {"session_id": None}
    q = select(TestSession).where(
        TestSession.owner_id == user.id,
        TestSession.question_set_id == set_id,
        TestSession.class_id == class_id,
    ).order_by(TestSession.created_at.desc())
    s = (await db.execute(q)).scalars().first()
    return {"session_id": s.id if s else None}


class BreakIn(BaseModel):
    start_date: datetime
    end_date: datetime
    label: str = ""


class BreakOut(BreakIn):
    id: int
    model_config = {"from_attributes": True}


@router.get("/breaks", response_model=List[BreakOut])
async def list_breaks(user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    q = select(CalendarBreak).where(CalendarBreak.owner_id == user.id).order_by(CalendarBreak.start_date)
    return (await db.execute(q)).scalars().all()


@router.post("/breaks", response_model=BreakOut, status_code=201)
async def create_break(body: BreakIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("kalender_break", f"u{user.id}", 100, 60, "Zu viele Eintraege. Bitte kurz warten.")
    if body.end_date < body.start_date:
        raise HTTPException(400, "Ende liegt vor dem Anfang")
    b = CalendarBreak(owner_id=user.id, start_date=body.start_date, end_date=body.end_date, label=body.label or "")
    db.add(b)
    await db.commit()
    await db.refresh(b)
    return b


@router.delete("/breaks/{break_id}", status_code=204)
async def delete_break(break_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    b = await db.get(CalendarBreak, break_id)
    if not b or b.owner_id != user.id:
        raise HTTPException(404, "Zeitraum nicht gefunden")
    await db.delete(b)
    await db.commit()


@router.delete("/entries/{entry_id}", status_code=204)
async def delete_entry(entry_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    e = await db.get(CalendarEntry, entry_id)
    if not e or e.owner_id != user.id:
        raise HTTPException(404, "Eintrag nicht gefunden")
    # Haengt eine Klassenarbeit an diesem Eintrag, geht sie mit: sonst bleibt der
    # Termin in der Klassenarbeits-Uebersicht (und zaehlt Stunden), obwohl er im
    # Kalender geloescht wurde. Eine bereits befuellte Auswertung bleibt (Live-Daten).
    ex = (await db.execute(select(ExamDate).where(
        ExamDate.owner_id == user.id, ExamDate.entry_id == entry_id))).scalars().first()
    if ex is not None:
        if ex.work_id:
            w = await db.get(WorkAnalysis, ex.work_id)
            if w and w.owner_id == user.id and not (w.tasks or w.results):
                await db.delete(w)
        await db.delete(ex)
    await db.delete(e)
    await db.commit()


# ─── Klassenarbeiten: Termine planen + Übersicht (verbleibende Stundenplan-Stunden) ───

class ExamIn(BaseModel):
    date: datetime
    title: str = ""
    class_id: Optional[int] = None
    kurs_id: Optional[int] = None
    period: Optional[int] = None   # an eine Stunde binden; None = ganztägig


class ExamOut(ExamIn):
    id: int
    work_id: Optional[int] = None   # verknüpfte Auswertung im Modul „Klassenarbeit"
    model_config = {"from_attributes": True}


@router.get("/klassenarbeiten", response_model=List[ExamOut])
async def list_exams(user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(ExamDate).where(ExamDate.owner_id == user.id).order_by(ExamDate.date))).scalars().all()
    return rows


def _exam_title(title: str) -> str:
    t = (title or "").strip()
    return f"Klassenarbeit: {t}" if t else "Klassenarbeit"


def _work_name(title: str) -> str:
    return (title or "").strip()[:200] or "Klassenarbeit"


async def _ensure_work(db: AsyncSession, user: User, e: ExamDate) -> None:
    """Bei aktivem Modul „Klassenarbeit auswerten" zum Termin eine Auswertung halten.
    Vorhandene: Namen mitziehen; solange sie noch LEER ist (Auto-Datensatz, keine
    Aufgaben/Ergebnisse), auch Klasse/Kurs nachziehen — sonst bliebe sie im alten
    Kurs, wenn der Termin umgetragen wird. Befüllte Auswertungen bleiben unangetastet
    (Regel: Live-Daten). Zeigt work_id ins Leere (Auswertung gelöscht), wird die
    Verknüpfung gelöst und ggf. neu angelegt."""
    if e.work_id:
        w = await db.get(WorkAnalysis, e.work_id)
        if w and w.owner_id == user.id:
            w.name = _work_name(e.title)
            if not (w.tasks or w.results):
                if e.class_id is not None:
                    w.class_id = e.class_id
                w.kurs_id = e.kurs_id
            return
        e.work_id = None  # verwaiste Verknüpfung lösen, unten neu anlegen
    if e.class_id is None:
        return
    if not await is_active(db, user.id, "auswertung"):
        return
    w = WorkAnalysis(owner_id=user.id, class_id=e.class_id, kurs_id=e.kurs_id,
                     name=_work_name(e.title), tasks=[], results={})
    db.add(w)
    await db.flush()
    e.work_id = w.id


@router.post("/klassenarbeiten", response_model=ExamOut, status_code=201)
async def create_exam(body: ExamIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _check_class(db, user, body.class_id)
    await _check_kurs(db, user, body.kurs_id)
    e = ExamDate(owner_id=user.id, **body.model_dump())
    db.add(e)
    await db.flush()
    # Kalendereintrag zum Termin: an eine Stunde (period) gebunden oder ganztägig.
    entry = CalendarEntry(owner_id=user.id, date=e.date, title=_exam_title(e.title),
                          class_id=e.class_id, kurs_id=e.kurs_id, period=e.period)
    db.add(entry)
    await db.flush()
    e.entry_id = entry.id
    await _ensure_work(db, user, e)
    await _korrektur_todo(db, user, e)
    await db.commit()
    await db.refresh(e)
    return e


async def _korrektur_todo(db, user, e: ExamDate, verschieben: bool = False) -> None:
    """Zum Arbeitstermin ein To-do „korrigieren" eine Woche danach.

    Bruecke zum Notizbrett (Regel 3: nur mit aktivem Modul, nie Voraussetzung).
    Der Termin steht im Kalender, die Korrektur aber nirgends — und genau die
    Zettel, die Nuvora ersetzen soll, sind meistens solche Erinnerungen.
    Angelegt wird genau EINES je Termin: der Text traegt die Termin-ID, ein
    zweiter Aufruf findet ihn wieder.
    """
    from datetime import timedelta
    from .modules import is_active
    from ..models import Todo

    if not await is_active(db, user.id, "notizbrett") or not e.date:
        return
    marke = f"#ka{e.id}"
    schon = (await db.execute(select(Todo).where(
        Todo.owner_id == user.id, Todo.text.like(f"%{marke}%")))).scalars().first()
    if schon:
        if verschieben and not schon.done:
            schon.due_date = (e.date + timedelta(days=7)).date()
        return
    titel = (e.title or "").strip() or "Klassenarbeit"
    db.add(Todo(owner_id=user.id, text=f"{titel} korrigieren {marke}",
                due_date=(e.date + timedelta(days=7)).date()))


@router.put("/klassenarbeiten/{exam_id}", response_model=ExamOut)
async def update_exam(exam_id: int, body: ExamIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    e = await db.get(ExamDate, exam_id)
    if not e or e.owner_id != user.id:
        raise HTTPException(404, "Klassenarbeit nicht gefunden")
    await _check_class(db, user, body.class_id)
    await _check_kurs(db, user, body.kurs_id)
    for k, v in body.model_dump().items():
        setattr(e, k, v)
    # Verknüpften Kalendereintrag mitziehen (Datum/Titel/Klasse/Kurs). Fehlt er
    # (Altbestand vor der Auto-Erzeugung), wird er hier nachgeholt.
    entry = await db.get(CalendarEntry, e.entry_id) if e.entry_id else None
    if entry and entry.owner_id == user.id:
        entry.date = e.date; entry.title = _exam_title(e.title)
        entry.class_id = e.class_id; entry.kurs_id = e.kurs_id; entry.period = e.period
    else:
        entry = CalendarEntry(owner_id=user.id, date=e.date, title=_exam_title(e.title),
                              class_id=e.class_id, kurs_id=e.kurs_id, period=e.period)
        db.add(entry)
        await db.flush()
        e.entry_id = entry.id
    # Auswertung anlegen (falls Modul inzwischen aktiv) bzw. Namen mitziehen.
    await _ensure_work(db, user, e)
    # Verschobener Termin verschiebt die Korrektur mit — ein Zettel mit altem
    # Datum ist schlimmer als keiner. Fehlt er (Modul war aus), entsteht er hier.
    await _korrektur_todo(db, user, e, verschieben=True)
    await db.commit()
    await db.refresh(e)
    return e


@router.delete("/klassenarbeiten/{exam_id}", status_code=204)
async def delete_exam(exam_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    e = await db.get(ExamDate, exam_id)
    if not e or e.owner_id != user.id:
        raise HTTPException(404, "Klassenarbeit nicht gefunden")
    # Auch den automatisch erzeugten Kalendereintrag entfernen.
    if e.entry_id:
        entry = await db.get(CalendarEntry, e.entry_id)
        if entry and entry.owner_id == user.id:
            await db.delete(entry)
    # Verknüpfte Auswertung nur löschen, wenn sie noch leer ist (nie befüllte
    # Ergebnisse mitreißen — Regel: Live-Daten schützen).
    if e.work_id:
        w = await db.get(WorkAnalysis, e.work_id)
        if w and w.owner_id == user.id and not (w.tasks or w.results):
            await db.delete(w)
    # Das automatisch angelegte Korrektur-To-do geht mit — aber nur, solange es
    # offen ist. Ein abgehaktes ist Verlauf und wird nicht nachtraeglich getilgt.
    from ..models import Todo
    for t in (await db.execute(select(Todo).where(
            Todo.owner_id == user.id, Todo.done.is_(False),
            Todo.text.like(f"%#ka{e.id}%")))).scalars().all():
        await db.delete(t)
    await db.delete(e)
    await db.commit()


def _slot_active_on(s: TimetableSlot, d: date) -> bool:
    """Gilt die (versionierte) Stundenplan-Stunde am Tag d? valid_from/valid_to
    grenzen sie ein; NULL heißt offen (seit jeher bzw. noch aktiv)."""
    vf = s.valid_from.date() if isinstance(s.valid_from, datetime) else s.valid_from
    vt = s.valid_to.date() if isinstance(s.valid_to, datetime) else s.valid_to
    if vf is not None and d < vf:
        return False
    if vt is not None and d > vt:
        return False
    return True


@router.get("/klassenarbeiten/uebersicht")
async def exam_overview(user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Kommende Klassenarbeiten mit den bis dahin verbleibenden Stundenplan-
    Stunden des Kurses (freie Tage/Ferien und Stundenausfälle abgezogen)."""
    from datetime import timedelta, timezone as _tz
    exams = (await db.execute(select(ExamDate).where(ExamDate.owner_id == user.id).order_by(ExamDate.date))).scalars().all()
    slots = (await db.execute(select(TimetableSlot).where(TimetableSlot.owner_id == user.id))).scalars().all()
    breaks = (await db.execute(select(CalendarBreak).where(CalendarBreak.owner_id == user.id))).scalars().all()
    cancels = (await db.execute(select(SlotCancellation).where(SlotCancellation.owner_id == user.id))).scalars().all()
    # Bereits GEPLANTE Stunden (konkrete Einträge mit Stundennummer) zählen mit —
    # auch zusätzliche/verschobene, die nicht im wiederkehrenden Raster stehen.
    planned = (await db.execute(select(CalendarEntry).where(CalendarEntry.owner_id == user.id, CalendarEntry.period.is_not(None)))).scalars().all()
    id2cls, _ = await _class_maps(db, user)
    kurse = {k.id: k.name for k in (await db.execute(select(Kurs).where(Kurs.owner_id == user.id))).scalars().all()}

    def _d(x):  # auf reines Datum reduzieren
        return x.date() if hasattr(x, "date") else x
    breaks_days = set()
    for b in breaks:
        d = _d(b.start_date); end = _d(b.end_date)
        while d <= end:
            breaks_days.add(d); d = d + timedelta(days=1)
    cancel_set = {(_d(c.date), c.period) for c in cancels}
    today = datetime.now(_tz.utc).date()

    # Bei mehreren Klassenarbeiten desselben Kurses zählen die Stunden ZWISCHEN
    # den Terminen: Startpunkt ist die vorige Klassenarbeit der Gruppe (frühestens
    # heute — Vergangenes ist schon gelaufen), nicht immer heute.
    out = []
    prev = {}  # gruppen-key -> Datum der vorigen Klassenarbeit
    for ex in exams:  # nach Datum sortiert
        exd = _d(ex.date)
        key = ex.kurs_id if ex.kurs_id is not None else ("c", ex.class_id)
        frm = prev.get(key)
        prev[key] = exd  # für die nächste Klassenarbeit dieser Gruppe
        if exd < today:
            continue  # vergangene: nicht anzeigen, aber als „vorige" gemerkt
        start = frm if (frm is not None and frm > today) else today
        # Gehört ein Slot/Eintrag zu diesem Termin?
        # - Kurs-Termin: nur der SELBE Kurs zählt; kurslose (nur Klasse geplante)
        #   Stunden derselben Klasse zählen zusätzlich. Ein ANDERER Kurs derselben
        #   Klasse zählt NICHT (sonst zählte Physik für die Mathe-Arbeit mit).
        # - Klassen-Termin ohne Kurs: alles dieser Klasse.
        def _match(kurs_id, class_id):
            if ex.kurs_id is not None:
                return kurs_id == ex.kurs_id or (
                    kurs_id is None and ex.class_id is not None and class_id == ex.class_id
                )
            return ex.class_id is not None and class_id == ex.class_id
        by_wd = {}
        for s in slots:
            if _match(s.kurs_id, s.class_id):
                by_wd.setdefault(s.weekday, []).append(s)  # ganze Slots (für Gültigkeit)
        # Ein konkreter Eintrag mit Stundennummer ERSETZT an dem Tag den
        # wiederkehrenden Slot dieser Stunde (so zeigt es auch der Kalender: genau
        # eine Zeile je Stunde). Darum je (Tag, Stunde) merken, welche vom Kalender
        # überschrieben sind — egal für welchen Kurs — damit der alte Slot dort
        # nicht mehr mitzählt, wenn der Eintrag den Kurs geändert hat.
        overridden = set()
        for e in planned:
            ed = _d(e.date)
            if start <= ed < exd:
                overridden.add((ed, e.period))
        # Stunden bis zum Tag VOR der KA, genau wie der Kalender sie zeigt:
        # wiederkehrende Slots (frei/Ausfall/überschrieben abgezogen) plus die
        # konkret geplanten Einträge des Kurses.
        occ = set()
        d = start
        while d < exd:
            if d not in breaks_days:
                for s in by_wd.get(d.weekday(), []):
                    if not _slot_active_on(s, d):
                        continue
                    p = s.period
                    if (d, p) not in cancel_set and (d, p) not in overridden:
                        occ.add((d, p))
            d = d + timedelta(days=1)
        for e in planned:
            ed = _d(e.date)
            if start <= ed < exd and ed not in breaks_days and _match(e.kurs_id, e.class_id):
                occ.add((ed, e.period))
        stunden = len(occ)
        out.append({
            "id": ex.id, "date": ex.date.isoformat(), "title": ex.title,
            "kurs_id": ex.kurs_id, "class_id": ex.class_id, "work_id": ex.work_id, "period": ex.period,
            "kurs": kurse.get(ex.kurs_id) if ex.kurs_id else None,
            "klasse": id2cls.get(ex.class_id) if ex.class_id else None,
            "stunden": stunden,
        })
    return out


# ─── Stundenplan (wiederkehrendes Wochenraster, Vorlage fuer Termine) ───

class SlotIn(BaseModel):
    weekday: int
    period: int
    class_id: Optional[int] = None
    kurs_id: Optional[int] = None   # gewaehlter Kurs (Fach) — Anzeige daraus
    title: str = ""
    topic_id: Optional[int] = None


class SlotOut(SlotIn):
    id: int
    valid_from: Optional[date] = None  # None = seit jeher gültig
    valid_to: Optional[date] = None    # None = noch aktiv; sonst letzter gültiger Tag
    model_config = {"from_attributes": True}


class Timetable(BaseModel):
    periods: int
    slots: List[SlotOut]
    times: list = []


class PeriodsIn(BaseModel):
    periods: int


class TimesIn(BaseModel):
    times: list  # [{start, end}] je Stunde


@router.get("/timetable", response_model=Timetable)
async def get_timetable(user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(TimetableSlot).where(TimetableSlot.owner_id == user.id)
        .order_by(TimetableSlot.weekday, TimetableSlot.period)
    )).scalars().all()
    return {"periods": user.timetable_periods or 6, "slots": rows, "times": user.timetable_times or []}


class SlotCancelIn(BaseModel):
    date: datetime
    period: int


@router.get("/slot-cancellations")
async def list_slot_cancellations(user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Ausgefallene Stundenplan-Stunden (Datum + Stunde)."""
    rows = (await db.execute(select(SlotCancellation).where(SlotCancellation.owner_id == user.id))).scalars().all()
    return [{"date": c.date.isoformat(), "period": c.period} for c in rows]


@router.post("/slot-cancellations", status_code=201)
async def add_slot_cancellation(body: SlotCancelIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Eine Stundenplan-Stunde an einem Tag entfallen lassen (idempotent)."""
    ex = (await db.execute(select(SlotCancellation).where(
        SlotCancellation.owner_id == user.id, SlotCancellation.date == body.date, SlotCancellation.period == body.period))).scalar_one_or_none()
    if not ex:
        db.add(SlotCancellation(owner_id=user.id, date=body.date, period=body.period))
        await db.commit()
    return {"ok": True}


@router.delete("/slot-cancellations", status_code=204)
async def del_slot_cancellation(body: SlotCancelIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Ausfall wieder aufheben — die Stunde erscheint wieder."""
    for c in (await db.execute(select(SlotCancellation).where(
            SlotCancellation.owner_id == user.id, SlotCancellation.date == body.date, SlotCancellation.period == body.period))).scalars().all():
        await db.delete(c)
    await db.commit()


@router.put("/timetable/times", response_model=Timetable)
async def set_times(body: TimesIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Uhrzeiten je Stunde setzen: Liste [{start,end}]."""
    user.timetable_times = body.times
    await db.commit()
    return await get_timetable(user, db)


@router.put("/timetable/periods", response_model=Timetable)
async def set_periods(body: PeriodsIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    if not 1 <= body.periods <= 16:
        raise HTTPException(400, "Stundenzahl muss zwischen 1 und 16 liegen")
    user.timetable_periods = body.periods
    await db.commit()
    return await get_timetable(user, db)


@router.put("/timetable/slot", response_model=SlotOut)
async def upsert_slot(body: SlotIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Setzt die Stunde an (weekday, period) — legt an oder aktualisiert."""
    if not 0 <= body.weekday <= 6 or body.period < 1:
        raise HTTPException(400, "Ungueltige Stunde")
    await _check_class(db, user, body.class_id)
    await _check_kurs(db, user, body.kurs_id)
    await _check_topic(db, user, body.topic_id)
    today = date.today()
    # Die AKTUELL gültige Version an (weekday, period) — nur die hat valid_to NULL.
    active = (await db.execute(select(TimetableSlot).where(
        TimetableSlot.owner_id == user.id,
        TimetableSlot.weekday == body.weekday,
        TimetableSlot.period == body.period,
        TimetableSlot.valid_to.is_(None),
    ).order_by(TimetableSlot.id.desc()))).scalars().first()
    same = active is not None and (
        active.class_id == body.class_id and active.kurs_id == body.kurs_id
        and (active.title or "") == (body.title or "") and active.topic_id == body.topic_id
    )
    if active is None:
        # Neue Stunde: gilt ab HEUTE (nicht rückwirkend — die Vergangenheit war leer).
        s = TimetableSlot(owner_id=user.id, valid_from=today, valid_to=None, **body.model_dump())
        db.add(s)
    elif same:
        s = active
    elif (active.valid_from.date() if isinstance(active.valid_from, datetime) else active.valid_from) == today:
        # Heute schon begonnen → direkt ändern, keine zusätzliche Version.
        for k, v in body.model_dump().items():
            setattr(active, k, v)
        s = active
    else:
        # Änderung wirkt ab HEUTE: alte Version bis GESTERN einfrieren (Vergangenheit
        # bleibt unverändert), neue Version ab heute anlegen.
        active.valid_to = today - timedelta(days=1)
        s = TimetableSlot(owner_id=user.id, valid_from=today, valid_to=None, **body.model_dump())
        db.add(s)
    await db.commit()
    await db.refresh(s)
    return s


@router.delete("/timetable/slot/{slot_id}", status_code=204)
async def delete_slot(slot_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    s = await db.get(TimetableSlot, slot_id)
    if not s or s.owner_id != user.id:
        raise HTTPException(404, "Stunde nicht gefunden")
    today = date.today()
    vf = s.valid_from.date() if isinstance(s.valid_from, datetime) else s.valid_from
    if vf is not None and vf >= today:
        # War nie in der Vergangenheit aktiv → ganz entfernen.
        await db.delete(s)
    else:
        # Ab HEUTE entfallen, Vergangenheit behält die Stunde.
        s.valid_to = today - timedelta(days=1)
    await db.commit()


# ─── Kalender abonnieren (ICS-Feed fuer Apple/Google, dauerhaft) ───
import secrets as _secrets
from fastapi import Request as _Request
from fastapi.responses import PlainTextResponse as _Plain


@router.get("/subscribe")
async def subscribe_url(request: _Request, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Gibt die Abo-URL zurueck (erzeugt bei Bedarf ein Token). Der Kalender
    wird per URL abonniert — kein Login, kein Einzel-Download."""
    if not user.calendar_token:
        user.calendar_token = _secrets.token_urlsafe(24)
        await db.commit()
    base = str(request.base_url).rstrip("/")  # z.B. https://host
    path = f"/api/kalender/feed/{user.calendar_token}.ics"
    return {"url": base + path, "webcal": ("webcal://" + base.split("://", 1)[-1] + path) if "://" in base else base + path}


@router.delete("/subscribe", status_code=204)
async def revoke_subscribe(user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Abo-Token zuruecksetzen — alte Abo-URLs werden ungueltig."""
    user.calendar_token = None
    await db.commit()


@router.post("/subscribe/resync")
async def resync_subscribe(request: _Request, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Force-Resync: ein FRISCHES Token erzeugen. Die alte Abo-URL wird sofort
    ungueltig (404), sodass der abonnierende Kalender die Verbindung als neu
    behandelt und alles einmal komplett neu laedt — statt an Apples zaehem
    Cache-Takt zu haengen. Gibt die neue URL zum erneuten Abonnieren zurueck."""
    user.calendar_token = _secrets.token_urlsafe(24)
    await db.commit()
    base = str(request.base_url).rstrip("/")
    path = f"/api/kalender/feed/{user.calendar_token}.ics"
    return {"url": base + path, "webcal": ("webcal://" + base.split("://", 1)[-1] + path) if "://" in base else base + path}


def _ics_escape(s: str) -> str:
    """Text fuer eine ICS-Zeile entschaerfen. Auch \\r muss weg: ICS trennt Zeilen
    mit CRLF — ein Wagenruecklauf aus einer Notiz haette den VEVENT mitten im Feld
    beendet und den Rest des Feeds fuer den abonnierten Kalender zerlegt."""
    return ((s or "").replace("\\", "\\\\").replace(";", r"\;").replace(",", r"\,")
            .replace("\r\n", r"\n").replace("\r", r"\n").replace("\n", r"\n"))


@router.get("/feed/{token}.ics")
async def ics_feed(token: str, db: AsyncSession = Depends(get_db)):
    """ICS-Feed eines Kontos (Token statt Login). Kalender-Eintraege als
    Ganztags-Events, freie Zeitraeume (Ferien) als mehrtaegige Events."""
    from datetime import date, timedelta
    u = (await db.execute(select(User).where(User.calendar_token == token))).scalar_one_or_none()
    if not u:
        raise HTTPException(404, "Kalender nicht gefunden")
    entries = (await db.execute(select(CalendarEntry).where(CalendarEntry.owner_id == u.id).order_by(CalendarEntry.date))).scalars().all()
    breaks = (await db.execute(select(CalendarBreak).where(CalendarBreak.owner_id == u.id))).scalars().all()
    classes = {c.id: c.name for c in (await db.execute(select(SchoolClass).where(SchoolClass.owner_id == u.id))).scalars().all()}

    def d8(d):
        return d.strftime("%Y%m%d")

    ttimes = u.timetable_times or []

    def _hm(s):
        """"HH:MM" -> "HHMM00" (lokale/floating Zeit) oder None."""
        p = (s or "").split(":")
        if len(p) == 2 and p[0].isdigit() and p[1].isdigit():
            return f"{int(p[0]):02d}{int(p[1]):02d}00"
        return None

    now = datetime.now().strftime("%Y%m%dT%H%M%SZ")
    # REFRESH-INTERVAL / X-PUBLISHED-TTL bitten den Client (Apple/Google), das Abo
    # häufiger neu zu laden — sonst hängt eine Änderung an Apples Standard-Takt.
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Nuvora//Kalender//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
             "X-WR-CALNAME:Nuvora", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"]
    for e in entries:
        day = e.date.date() if hasattr(e.date, "date") else e.date
        title = e.title or (classes.get(e.class_id) or "Termin")
        # Hat der Eintrag eine Stunde und gibt es dafür Uhrzeiten im Stundenplan,
        # als getakteten Termin ausgeben (sonst als Ganztags-Termin).
        # Freie Uhrzeit am Eintrag hat Vorrang; sonst die Uhrzeit der Stunde.
        if getattr(e, "start_time", "") and getattr(e, "end_time", ""):
            a = _hm(e.start_time)
            b2 = _hm(e.end_time)
        else:
            tm = ttimes[e.period - 1] if (e.period and isinstance(ttimes, list) and 0 < e.period <= len(ttimes)) else None
            a = _hm(tm.get("start")) if isinstance(tm, dict) else None
            b2 = _hm(tm.get("end")) if isinstance(tm, dict) else None
        if a and b2:
            dtstart = f"DTSTART:{d8(day)}T{a}"
            dtend = f"DTEND:{d8(day)}T{b2}"
        else:
            dtstart = f"DTSTART;VALUE=DATE:{d8(day)}"
            dtend = f"DTEND;VALUE=DATE:{d8(day + timedelta(days=1))}"
        lines += [
            "BEGIN:VEVENT",
            f"UID:nuvora-entry-{e.id}@nuvora",
            f"DTSTAMP:{now}",
            dtstart,
            dtend,
            f"SUMMARY:{_ics_escape(title)}",
        ]
        if e.notes:
            lines.append(f"DESCRIPTION:{_ics_escape(e.notes)}")
        lines.append("END:VEVENT")
    for b in breaks:
        s = b.start_date.date() if hasattr(b.start_date, "date") else b.start_date
        en = b.end_date.date() if hasattr(b.end_date, "date") else b.end_date
        lines += [
            "BEGIN:VEVENT",
            f"UID:nuvora-break-{b.id}@nuvora",
            f"DTSTAMP:{now}",
            f"DTSTART;VALUE=DATE:{d8(s)}",
            f"DTEND;VALUE=DATE:{d8(en + timedelta(days=1))}",
            f"SUMMARY:{_ics_escape(b.label or 'Unterrichtsfrei')}",
            "END:VEVENT",
        ]

    # Wiederkehrende Stundenplan-Stunden ("ungeplante" reguläre Stunden) über ein
    # rollierendes Fenster ausgeben, damit der abonnierte Kalender den Stundenplan
    # zeigt, nicht nur Ad-hoc-Einträge. Ferien werden übersprungen; Stunden, für die
    # es an dem Tag schon einen Eintrag gibt (gleiche Stunde), werden ausgelassen —
    # genau wie die In-App-Logik die Vorlage hinter einem Eintrag ausblendet.
    slots = (await db.execute(select(TimetableSlot).where(TimetableSlot.owner_id == u.id))).scalars().all()
    if slots:
        times = u.timetable_times or []
        belegt = set()
        for e in entries:
            if e.period is not None:
                d = e.date.date() if hasattr(e.date, "date") else e.date
                belegt.add((d, e.period))
        # Ausgefallene Stunden (Datum + Stunde) genauso ausblenden wie belegte.
        for c in (await db.execute(select(SlotCancellation).where(SlotCancellation.owner_id == u.id))).scalars().all():
            cd = c.date.date() if hasattr(c.date, "date") else c.date
            belegt.add((cd, c.period))
        frei = []
        for b in breaks:
            bs = b.start_date.date() if hasattr(b.start_date, "date") else b.start_date
            be = b.end_date.date() if hasattr(b.end_date, "date") else b.end_date
            frei.append((bs, be))

        def hms(t):
            try:
                hh, mm = (t or "").split(":")[:2]
                return f"{int(hh):02d}{int(mm):02d}00"
            except Exception:
                return None

        by_wd = {}
        for s in slots:
            by_wd.setdefault(s.weekday, []).append(s)
        today = date.today()
        start = today - timedelta(days=30)
        for i in range(151):  # heute -30 .. +120 Tage
            day = start + timedelta(days=i)
            if any(bs <= day <= be for bs, be in frei):
                continue
            for s in by_wd.get(day.weekday(), []):
                if (day, s.period) in belegt:
                    continue
                if not _slot_active_on(s, day):
                    continue
                title = classes.get(s.class_id) or s.title or "Unterricht"
                tr = times[s.period - 1] if 0 <= s.period - 1 < len(times) else None
                # Uhrzeiten liegen als {"start","end"} vor (wie im Rest der App) —
                # nicht "from"/"to". Mit den falschen Keys war die Zeit immer None,
                # darum landeten die Stunden im Abo als ganztägige Ereignisse.
                a = hms(tr.get("start")) if isinstance(tr, dict) else None
                b2 = hms(tr.get("end")) if isinstance(tr, dict) else None
                # UID mit Zeit-Marker (-t): erzwingt bei Apple/Google, dass die
                # frueher faelschlich ganztaegigen Slot-Events durch die getakteten
                # ERSETZT werden — sonst behaelt Apple pro UID stur den Ganztags-Typ.
                uid = f"UID:nuvora-slot-{s.id}-{d8(day)}-t@nuvora"
                if a and b2:
                    lines += ["BEGIN:VEVENT", uid, f"DTSTAMP:{now}",
                              f"DTSTART:{d8(day)}T{a}", f"DTEND:{d8(day)}T{b2}",
                              f"SUMMARY:{_ics_escape(title)}", "END:VEVENT"]
                else:
                    lines += ["BEGIN:VEVENT", uid, f"DTSTAMP:{now}",
                              f"DTSTART;VALUE=DATE:{d8(day)}", f"DTEND;VALUE=DATE:{d8(day + timedelta(days=1))}",
                              f"SUMMARY:{_ics_escape(title)}", "END:VEVENT"]

    lines.append("END:VCALENDAR")
    return _Plain("\r\n".join(lines), media_type="text/calendar; charset=utf-8",
                  headers={"Cache-Control": "no-cache, max-age=0"})


# ─── Externe Kalender (mehrere ICS-URLs read-only einblenden — „andere Richtung") ───
class ExtCalIn(BaseModel):
    url: str = ""
    color: Optional[str] = ""
    name: Optional[str] = ""


class ExtCalsIn(BaseModel):
    calendars: List[ExtCalIn] = []


class ExtHideIn(BaseModel):
    key: str  # "uid|YYYY-MM-DD"


def _ext_calendars(user: User) -> list:
    """Die externen Kalender des Nutzers, immer als Liste. Altbestand
    (external_ics_url/_color) wird als erster Eintrag mitgeführt, bis er einmal
    über die neue Liste überschrieben wird."""
    cals = user.external_calendars
    if isinstance(cals, list) and cals:
        return [c for c in cals if isinstance(c, dict) and c.get("url")]
    if user.external_ics_url:
        return [{"url": user.external_ics_url, "color": user.external_ics_color or "", "name": ""}]
    return []


@router.get("/external")
async def get_external(user: User = Depends(require_module)):
    return {"calendars": _ext_calendars(user), "hidden": user.external_hidden or []}


@router.put("/external")
async def set_external(body: ExtCalsIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    out = []
    for c in body.calendars:
        url = (c.url or "").strip()
        if not url:
            continue
        if not (url.startswith("http://") or url.startswith("https://") or url.startswith("webcal://")):
            raise HTTPException(400, "URL muss mit http(s):// oder webcal:// beginnen")
        url = url.replace("webcal://", "https://", 1)
        col = (c.color or "").strip()
        col = col if re.fullmatch(r"#[0-9a-fA-F]{3,8}", col) else ""
        out.append({"url": url, "color": col, "name": (c.name or "").strip()[:60]})
    user.external_calendars = out
    # Altfelder mitziehen (erster Kalender), damit nichts Altes wiederauflebt.
    user.external_ics_url = out[0]["url"] if out else None
    user.external_ics_color = out[0]["color"] if out else ""
    await db.commit()
    return {"calendars": out, "hidden": user.external_hidden or []}


@router.post("/external/hide", status_code=204)
async def hide_external_event(body: ExtHideIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Ein einzelnes externes Ereignis ausblenden (Schlüssel uid|Datum)."""
    hid = list(user.external_hidden or [])
    if body.key and body.key not in hid:
        hid.append(body.key)
        user.external_hidden = hid[:2000]
        await db.commit()


@router.post("/external/unhide", status_code=204)
async def unhide_external_event(body: ExtHideIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    hid = [k for k in (user.external_hidden or []) if k != body.key]
    user.external_hidden = hid
    await db.commit()


_RRULE_WD = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}


def _expand_rrule(d0, rule, exdate, win_start, win_end):
    """Wiederkehr-Termine (RRULE) im Fenster [win_start, win_end] aufzählen. Deckt
    die gängigen Fälle ab: DAILY/WEEKLY/MONTHLY/YEARLY mit INTERVAL/COUNT/UNTIL/
    BYDAY. exdate = Menge/Liste ausgenommener Tage als 'YYYYMMDD'."""
    from datetime import date as _date, timedelta as _td
    parts = {}
    for kv in (rule or "").split(";"):
        if "=" in kv:
            k, v = kv.split("=", 1); parts[k.upper()] = v
    freq = (parts.get("FREQ") or "").upper()
    try:
        interval = max(1, int(parts.get("INTERVAL", "1")))
    except ValueError:
        interval = 1
    count = int(parts["COUNT"]) if parts.get("COUNT", "").isdigit() else None
    u = parts.get("UNTIL", "")[:8]
    until = _date(int(u[0:4]), int(u[4:6]), int(u[6:8])) if len(u) == 8 and u.isdigit() else None
    ex = set(exdate or [])
    days = []
    emitted = 0

    def add(occ):
        nonlocal emitted
        if occ.strftime("%Y%m%d") in ex:
            return True
        emitted += 1
        if occ >= d0 and win_start <= occ <= win_end:
            days.append(occ)
        return count is None or emitted < count

    if freq == "DAILY":
        occ = d0
        while occ <= win_end and (until is None or occ <= until):
            if not add(occ):
                break
            occ += _td(days=interval)
    elif freq == "WEEKLY":
        wanted = sorted({_RRULE_WD[x] for x in parts.get("BYDAY", "").split(",") if x in _RRULE_WD}) or [d0.weekday()]
        week = d0 - _td(days=d0.weekday())
        guard = 0
        stop = False
        while week <= win_end and (until is None or week <= until) and not stop and guard < 8000:
            for wd in wanted:
                occ = week + _td(days=wd)
                if occ < d0 or (until and occ > until):
                    continue
                if occ > win_end:
                    stop = True; break
                if not add(occ):
                    stop = True; break
            week += _td(weeks=interval); guard += 1
    elif freq in ("MONTHLY", "YEARLY"):
        y, m = d0.year, d0.month
        guard = 0
        while guard < 8000:
            try:
                occ = _date(y, m, d0.day)
            except ValueError:
                occ = None
            if occ is not None:
                if occ > win_end or (until and occ > until):
                    break
                if not add(occ):
                    break
            if freq == "MONTHLY":
                m += interval
                while m > 12:
                    m -= 12; y += 1
            else:
                y += interval
            guard += 1
    else:
        days = [d0] if win_start <= d0 <= win_end else []
    return days


def _parse_ics(text: str):
    """Sehr einfacher ICS-Parser: VEVENTs mit DTSTART/DTEND/SUMMARY."""
    # re ist bereits oben im Modul importiert.
    # Gefaltete Zeilen (Fortsetzung mit Leerzeichen/Tab) zusammenführen.
    text = re.sub(r"\r?\n[ \t]", "", text)
    events = []
    cur = None
    for line in text.split("\n"):
        line = line.rstrip("\r")
        if line == "BEGIN:VEVENT":
            cur = {}
        elif line == "END:VEVENT":
            # Abgesagte/gelöschte Termine überspringen — Apple/Google exportieren
            # gelöschte Einträge oft als STATUS:CANCELLED statt sie zu entfernen.
            if cur and cur.get("start") and cur.get("status") != "CANCELLED":
                events.append(cur)
            cur = None
        elif cur is not None and ":" in line:
            key, val = line.split(":", 1)
            k = key.split(";", 1)[0].upper()
            raw = val.strip()
            if k == "DTSTART":
                cur["start"] = raw[:8]  # YYYYMMDD (Datum-Teil)
                if "T" in raw and len(raw) >= 13:   # YYYYMMDDTHHMMSS -> Uhrzeit
                    cur["time"] = raw[9:11] + ":" + raw[11:13]
            elif k == "DTEND":
                cur["end"] = raw[:8]
                if "T" in raw and len(raw) >= 13:   # Endzeit HH:MM (für getaktete Events)
                    cur["endtime"] = raw[9:11] + ":" + raw[11:13]
            elif k == "SUMMARY":
                cur["title"] = raw.replace("\\,", ",").replace(r"\;", ";").replace("\\n", " ")
            elif k == "LOCATION":
                cur["location"] = raw.replace("\\,", ",").replace(r"\;", ";").replace("\\n", " ")[:200]
            elif k == "DESCRIPTION":
                cur["description"] = raw.replace("\\,", ",").replace(r"\;", ";").replace("\\n", "\n").replace("\\N", "\n")[:1000]
            elif k == "STATUS":
                cur["status"] = raw.upper()
            elif k == "UID":
                cur["uid"] = raw[:200]
            elif k == "RRULE":
                cur["rrule"] = raw  # Wiederholregel (FREQ/INTERVAL/UNTIL/COUNT/BYDAY)
            elif k == "EXDATE":
                # Ausgenommene Termine (gelöschte Einzeltage einer Serie).
                cur.setdefault("exdate", []).extend(p.strip()[:8] for p in raw.split(",") if p.strip()[:8].isdigit())
    return events


# Kleiner Prozess-Cache für externe Feeds: pro Nutzer ein Eintrag
# (url, verfaellt_ts, ergebnis). Ein fremder Kalender ändert sich selten, jeder
# Seitenaufruf holte ihn bisher neu — bei großen Feeds spürbar. Key enthält die
# URL, damit ein Wechsel den alten Eintrag nicht wiederverwendet.
_EXT_CACHE: dict[int, tuple[str, float, list]] = {}
_EXT_TTL = 600  # 10 Minuten


def _fetch_ics(url: str) -> str:
    """Einen externen ICS-Feed holen — mit SSRF-Schutz (keine privaten IPs),
    DNS-Rebinding-Pin und ohne Redirects. Gibt den Text zurück (max 2 MB)."""
    import urllib.request, urllib.parse, socket, ipaddress
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return ""
    host = parsed.hostname
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    infos = socket.getaddrinfo(host, port)
    for res in infos:
        ip = ipaddress.ip_address(res[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise ValueError("Ziel-IP nicht erlaubt")
    _real_gai = socket.getaddrinfo
    def _pinned_gai(h, p, *a, **k):
        if h == host and p == port:
            return infos
        return _real_gai(h, p, *a, **k)
    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None
    opener = urllib.request.build_opener(_NoRedirect)
    req = urllib.request.Request(url, headers={"User-Agent": "Nuvora"})
    socket.getaddrinfo = _pinned_gai
    try:
        with opener.open(req, timeout=6) as r:
            return r.read(2_000_000).decode("utf-8", "replace")
    finally:
        socket.getaddrinfo = _real_gai


@router.get("/external-events")
async def external_events(refresh: bool = False, user: User = Depends(require_module)):
    """Holt ALLE externen ICS-Feeds und liefert Events als {date, title, color,
    key, …}. Read-only. 10-Min-Cache; refresh=1 umgeht ihn. Ausgeblendete
    Ereignisse (external_hidden, Schlüssel uid|Datum) werden weggelassen."""
    import time
    cals = _ext_calendars(user)
    hidden = set(user.external_hidden or [])
    # Cache-Signatur: URLs + Farben + ausgeblendete Schlüssel.
    sig = "|".join(f"{c['url']}~{c.get('color','')}" for c in cals) + "##" + ",".join(sorted(hidden))
    if not cals:
        _EXT_CACHE.pop(user.id, None)
        return []
    hit = _EXT_CACHE.get(user.id)
    if not refresh and hit and hit[0] == sig and hit[1] > time.time():
        return hit[2]
    import asyncio, hashlib
    from datetime import date, timedelta
    def _d(v):
        return date(int(v[0:4]), int(v[4:6]), int(v[6:8])) if v and len(v) >= 8 and v[:8].isdigit() else None
    today = date.today()
    win_start = today - timedelta(days=60)
    win_end = today + timedelta(days=180)

    async def _load(url):
        try:
            return await asyncio.get_event_loop().run_in_executor(None, _fetch_ics, url)
        except Exception:
            return ""
    texts = await asyncio.gather(*[_load(c["url"]) for c in cals])

    out = []
    for cal, text in zip(cals, texts):
        color = cal.get("color") or ""
        for e in _parse_ics(text):
            d0 = _d(e.get("start"))
            if not d0:
                continue
            title = e.get("title", "")[:200]
            d1 = _d(e.get("end"))
            # Stabiler Ereignis-Schlüssel zum Ausblenden: UID, sonst Titel+Start-Hash.
            uid = e.get("uid") or "h" + hashlib.md5(f"{title}|{e.get('start')}".encode()).hexdigest()[:16]
            multi = bool(d1 and d1 > d0)
            last = (d1 - timedelta(days=1)) if multi else d0
            info = {"title": title, "time": e.get("time"), "endtime": e.get("endtime"),
                    "location": e.get("location", ""), "color": color, "uid": uid,
                    "description": e.get("description", ""), "start": d0.isoformat(), "end": last.isoformat()}

            def _emit(iso_date, ov=None):
                key = f"{uid}|{iso_date}"
                if key in hidden:
                    return
                row = {**info, "date": iso_date, "key": key}
                if ov:
                    row.update(ov)
                out.append(row)

            if e.get("rrule"):
                for occ in _expand_rrule(d0, e["rrule"], e.get("exdate"), win_start, win_end):
                    iso = occ.isoformat()
                    _emit(iso, {"start": iso, "end": iso})
            elif multi:
                cur = d0
                n = 0
                while cur < d1 and n < 60:
                    _emit(cur.isoformat())
                    cur += timedelta(days=1); n += 1
            else:
                _emit(d0.isoformat())
    out.sort(key=lambda x: (x["date"], x.get("time") or ""))
    result = out[:20000]
    _EXT_CACHE[user.id] = (sig, time.time() + _EXT_TTL, result)
    return result
