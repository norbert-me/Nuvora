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

from ..zeit import tagesbeginn
# RRULE ist ICS-Grammatik; die Uebersetzung liegt in app/caldav.py (ohne
# FastAPI, ohne Datenbank, testbar ohne Server). Eine zweite Fassung hier waere
# die, in der eine Pruefung fehlt.
from ..caldav import rrule_pruefen
from ..felder import ohne_leer, ohne_none
# `eigenes` ersetzt hier den Dreizeiler „holen, owner_id vergleichen, sonst 404",
# der in jedem Router noch einmal stand — die Regel steht jetzt in app/besitz.py.
from ..besitz import eigenes
from ..kursmitglieder import class_kurs_ids, eigener_kurs
from ..database import get_db
from ..importe import geprueft
from ..models import CalendarBreak, CalendarEntry, CardDeck, ExamDate, Kurs, SchoolClass, TimetableSlot, SlotCancellation, Topic, User, WorkAnalysis, Session as TestSession
from .auth import rate_limit
from .modules import is_active, modul_pflicht

router = APIRouter(prefix="/api/kalender", tags=["kalender"])
MODULE_KEY = "kalender"

# Formmarker in den ICS-UIDs. Apple/Google merken sich Art und Dauer eines
# Ereignisses pro UID; eine Korrektur an DTSTART/DTEND kommt bei gleicher UID
# nicht immer an. Wird an der Ausgabe der Ganztags-Events etwas berichtigt,
# zaehlt dieser Marker hoch — dann ersetzt der Client die alten Kopien einmalig.
FORM_MARKER = "d2"


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


# ─── Wiederholungen (Serien) ───
#
# Eine Serie ist EIN Eintrag plus Regel, nicht hundert Zeilen. Der Grund ist
# nicht Speicherplatz, sondern Bedienung: „jeden Montag AG" ist eine
# Entscheidung, und wer sie aendert, will sie an einer Stelle aendern — bei
# hundert Kopien bliebe die Haelfte stehen. Aufgezaehlt wird mit
# `_expand_rrule` weiter unten, derselben Funktion, die schon die fremden
# Kalender ausrollt; zwei Fassungen liefen nach der ersten Sonderregel
# auseinander.

def serien_tage(e, von: date, bis: date) -> list:
    """An welchen Tagen im Fenster [von, bis] faellt dieser Eintrag an?

    Ohne Regel ist das genau sein eigener Tag — so bleibt der Rest des Codes
    frei von Fallunterscheidungen.
    """
    tag = _tag(e.date)
    if not getattr(e, "rrule", ""):
        return [tag] if von <= tag <= bis else []
    return _expand_rrule(tag, e.rrule, set(e.exdate or []), von, bis)


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
    location: str = ""     # Ort/Raum — Apple und Outlook fuehren das Feld
    rrule: str = ""        # Wiederholung, leer = einmalig
    exdate: List[str] = []  # ausgenommene Tage der Serie ("YYYYMMDD")

    @model_validator(mode="after")
    def _times_ok(self):
        # Endzeit (falls beide gesetzt) muss nach der Startzeit liegen.
        if self.start_time and self.end_time and self.end_time <= self.start_time:
            raise ValueError("Die Endzeit muss nach der Startzeit liegen")
        # Die Regel auf das eindampfen, was wir wirklich aufzaehlen koennen —
        # eine gespeicherte Regel, die niemand rechnet, waere eine Serie, die
        # es nur in der Datenbank gibt.
        self.rrule = rrule_pruefen(self.rrule)
        self.exdate = [d for d in (self.exdate or []) if len(d) == 8 and d.isdigit()][:400]
        self.location = (self.location or "")[:200]
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
    # Bei einer Serie: der Tag DIESES Vorkommens ("YYYY-MM-DD"). Leer bei allem
    # Einmaligen. Die Oberflaeche braucht ihn, um beim Aendern oder Loeschen
    # fragen zu koennen, ob nur dieser Termin gemeint ist oder die ganze Serie.
    occ: str = ""
    model_config = {"from_attributes": True}

    @field_validator("verlaufsplan", "exdate", mode="before")
    @classmethod
    def _vp_none(cls, v):
        # NULL in der Datenbank heisst hier „nichts", nicht „kaputt": eine
        # Spalte, die es vor der Migration noch nicht gab, ist bei Bestandszeilen
        # leer und darf das Lesen nicht kippen.
        return v or []


@router.get("/entries", response_model=List[EntryOut])
async def list_entries(frm: Optional[datetime] = None, to: Optional[datetime] = None,
                       user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Eintraege, optional auf einen Zeitraum (frm..to) eingegrenzt."""
    q = select(CalendarEntry).where(CalendarEntry.owner_id == user.id)
    # Serien bleiben immer dabei: ihr Kopf liegt am ERSTEN Termin und damit fast
    # immer vor dem Fenster — filterte man ihn weg, waere eine seit September
    # laufende AG im Maerz aus dem Kalender verschwunden.
    serie = CalendarEntry.rrule != ""
    if frm is not None:
        q = q.where(or_(CalendarEntry.date >= frm, serie))
    if to is not None:
        q = q.where(CalendarEntry.date <= to)
    rows = (await db.execute(q.order_by(CalendarEntry.date))).scalars().all()
    # Klassenarbeitstermine an ihre Eintraege haengen (ein Aufruf statt N).
    exams = (await db.execute(select(ExamDate).where(
        ExamDate.owner_id == user.id, ExamDate.entry_id.is_not(None)))).scalars().all()
    by_entry = {e.entry_id: e for e in exams}

    # Serien aufzaehlen — aber NUR mit Fenster. Ohne frm/to gibt es keinen
    # Zeitraum, ueber den man sie ausrollen koennte; dann kommt die Serie als
    # ihr eigener Datensatz zurueck (genau das brauchen Export, Aufraeumen und
    # alles, was Eintraege loeschen will).
    fenster = (frm is not None and to is not None)
    von = _tag(frm) if frm is not None else None
    bis = _tag(to) if to is not None else None

    out = []
    for r in rows:
        def bau(tag=None):
            item = EntryOut.model_validate(r)
            if tag is not None:
                item.date = tagesbeginn(tag)
                item.occ = tag.strftime("%Y-%m-%d")
            ex = by_entry.get(r.id)
            if ex:
                item.exam_id = ex.id
                item.work_id = ex.work_id
            return item
        if fenster and r.rrule:
            out += [bau(tag) for tag in serien_tage(r, von, bis)]
        else:
            out.append(bau())
    # Nach TAG sortieren, nicht nach dem Zeitstempel: die Zeilen kommen teils
    # mit, teils ohne Zeitzone aus der Datenbank (die aufgezaehlten Vorkommen
    # tragen die des Tagesbeginns) — ein Vergleich der Zeitstempel bricht dann
    # mit „can't compare offset-naive and offset-aware datetimes".
    out.sort(key=lambda i: (_tag(i.date), i.start_time or ""))
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
    e = await eigenes(db, CalendarEntry, entry_id, user, "Eintrag nicht gefunden")
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


# Stand hier und in karten.py wortgleich, mit dem Vermerk „Regel 3". Die
# Rechnung liegt jetzt im KERN (app/zeit.py) — damit haengt weiterhin kein Modul
# am anderen, und es gibt nur noch einen Tagesbeginn.
_tagesbeginn = tagesbeginn


async def _release_matching_decks(db: AsyncSession, user: User, e: CalendarEntry) -> None:
    """Zusatz (Regel 3): plant der Kalender ein Thema, wird ein passender, noch
    nicht ausgerollter Karten-Stapel automatisch zum Termin freigeschaltet.
    Nur Entwuerfe (released_at NULL) — eine manuelle Freigabe bleibt unberuehrt.
    Laeuft nur, wenn das Karten-Modul aktiv ist (keine Auto-Verknuepfung bei
    abgeschaltetem Modul).
    """
    if not await is_active(db, user.id, "karten"):
        return

    async def _stunde_weist_zu(deck_id: int) -> None:
        """Die Stunde erzeugt die Kurs-Zuweisung des Stapels.

        Kartenstapel werden nicht mehr von Hand Kursen zugewiesen — sie kommen
        über die Stunde bei den Kindern an. Bewusst hier mit dem MODELL statt
        über eine Funktion aus karten.py: Module hängen nicht voneinander ab
        (Regel 3), Tabellen teilen sie sich. Additiv, nie entfernend.
        """
        from ..models import CardDeckKurs
        ziel = set(await class_kurs_ids(db, e.class_id)) if e.class_id else set()
        if e.kurs_id:
            ziel.add(e.kurs_id)
        for kid in ziel:
            da = (await db.execute(select(CardDeckKurs.id).where(
                CardDeckKurs.deck_id == deck_id, CardDeckKurs.kurs_id == kid))).scalars().first()
            if not da:
                db.add(CardDeckKurs(deck_id=deck_id, kurs_id=kid))

    # Explizit verknuepftes Deck: am Kalendertag freischalten, falls noch Entwurf.
    if e.karten_deck_id:
        deck = await db.get(CardDeck, e.karten_deck_id)
        if deck and deck.owner_id == user.id:
            if deck.released_at is None:
                deck.released_at = _tagesbeginn(e.date)
            await _stunde_weist_zu(deck.id)
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
        from sqlalchemy import and_ as _and, exists as _exists
        from ..models import CardDeckKurs
        kurse = list(await class_kurs_ids(db, e.class_id))
        if kurse:
            # Zugewiesene Stapel zaehlen mit: seit der Sammlung ist die Zuweisung
            # der Weg, und ein Stapel gehoert dann keiner Klasse mehr. Bewusst
            # ueber das MODELL statt ueber eine Funktion aus karten.py — Module
            # haengen nicht voneinander ab (Regel 3), Tabellen teilen sie sich.
            zugewiesen = _exists().where(_and(CardDeckKurs.deck_id == CardDeck.id,
                                              CardDeckKurs.kurs_id.in_(kurse)))
            q = q.where(or_(zugewiesen, CardDeck.kurs_id.in_(kurse), CardDeck.class_id == e.class_id))
        else:
            q = q.where(CardDeck.class_id == e.class_id)
    matched = (await db.execute(q.order_by(CardDeck.id))).scalars().all()
    for deck in matched:
        if deck.released_at is None:   # Entwürfe ab Beginn des Termintags freischalten
            deck.released_at = _tagesbeginn(e.date)
        await _stunde_weist_zu(deck.id)
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

    _leer_zahl = field_validator("weekday", "period", mode="before")(ohne_leer(None, ("",)))

    _leer_text = field_validator("title", mode="before")(ohne_none(""))

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

    # Hier zaehlt auch die 0 als „nichts angegeben" — deshalb ohne_leer mit
    # eigener Liste und nicht die Standardfassung.
    _leer_zahl = field_validator("periods", mode="before")(ohne_leer(None, ("", 0)))

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

    _leer_text = field_validator("label", mode="before")(ohne_none(""))


class ImportKalEntry(BaseModel):
    date: Optional[datetime] = None
    period: Optional[int] = None
    title: str = ""
    notes: str = ""
    class_: Optional[str] = Field(default=None, alias="class")
    topic: Optional[str] = None
    model_config = {"populate_by_name": True}

    _leer_text = field_validator("title", "notes", mode="before")(ohne_none(""))

    _leer_zahl = field_validator("period", mode="before")(ohne_leer(None, ("",)))


class KalenderImport(BaseModel):
    """Sicherungsdatei des Kalenders. Unbekannte Felder werden ignoriert."""
    type: str = ""
    version: int = 1
    timetable: ImportTimetable = ImportTimetable()
    breaks: List[ImportBreak] = []
    entries: List[ImportKalEntry] = []

    _leer_tt = field_validator("timetable", mode="before")(ohne_none({}))

    _leer_liste = field_validator("breaks", "entries", mode="before")(ohne_none([]))


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
    b = await eigenes(db, CalendarBreak, break_id, user, "Zeitraum nicht gefunden")
    await db.delete(b)
    await db.commit()


@router.delete("/entries/{entry_id}", status_code=204)
async def delete_entry(entry_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    e = await eigenes(db, CalendarEntry, entry_id, user, "Eintrag nicht gefunden")
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


class AusnahmeIn(BaseModel):
    """Ein einzelner Tag einer Serie."""
    date: datetime
    # true = der Tag wird als eigener Eintrag herausgeloest (zum Aendern),
    # false = er faellt ersatzlos aus (zum Loeschen).
    loesen: bool = False


@router.post("/entries/{entry_id}/ausnahme", response_model=Optional[EntryOut])
async def serien_ausnahme(entry_id: int, body: AusnahmeIn,
                          user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Einen einzelnen Termin aus einer Serie nehmen.

    Zwei Faelle, ein Weg: der Tag kommt in jedem Fall auf die EXDATE-Liste, die
    Serie selbst bleibt unangetastet. Beim **Loesen** entsteht zusaetzlich eine
    eigenstaendige Kopie an genau diesem Tag — die laesst sich danach aendern
    wie jeder andere Eintrag, ohne dass die uebrigen Wochen mitwandern. Ohne
    diesen zweiten Fall gaebe es nur „alles oder gar nicht", und wer eine
    einzelne Stunde verlegt, muesste die ganze Serie aufloesen.
    """
    e = await eigenes(db, CalendarEntry, entry_id, user, "Eintrag nicht gefunden")
    if not e.rrule:
        raise HTTPException(400, "Dieser Eintrag ist keine Serie")
    tag = _tag(body.date)
    marke = tag.strftime("%Y%m%d")
    if marke not in set(e.exdate or []):
        e.exdate = [*(e.exdate or []), marke]
    kopie = None
    if body.loesen:
        felder = {k: getattr(e, k) for k in (
            "class_id", "kurs_id", "topic_id", "method_id", "period", "title", "notes",
            "location", "start_time", "end_time", "verlaufsplan",
            "cardvote_set_id", "karten_deck_id", "lernpfad_ladder_id", "codedetektiv_puzzle")}
        # Ohne caldav_uid und ohne rrule: die Kopie ist ein eigener Termin, kein
        # zweiter Kopf derselben Serie — sonst legte der naechste Abgleich im
        # Handy zwei Serien uebereinander.
        kopie = CalendarEntry(owner_id=user.id, date=tagesbeginn(tag), **felder)
        db.add(kopie)
    await db.commit()
    if kopie is None:
        return None
    await db.refresh(kopie)
    return kopie


# ─── Klassenarbeiten: Termine planen + Übersicht (verbleibende Stundenplan-Stunden) ───

class ExamIn(BaseModel):
    date: datetime
    title: str = ""
    class_id: Optional[int] = None
    kurs_id: Optional[int] = None
    period: Optional[int] = None   # an eine Stunde binden; None = ganztägig
    # Freie Notiz zum Termin. Der Titel ist die Bezeichnung der Arbeit und
    # bleibt kurz; alles Weitere ("Zweitkorrektur bis Freitag") hatte bisher
    # keinen Ort und landete im Titel.
    notiz: str = ""
    # Worüber wird geschrieben? Themen aus dem KERN (Regel 3: der Kalender
    # besitzt keine Taxonomie, er zeigt auf sie). Eine Arbeit prüft meist
    # mehrere Unterthemen, deshalb eine Liste. Leer bleiben darf sie immer —
    # ein Termin ohne Themen ist ein vollständiger Termin.
    topic_ids: Optional[List[int]] = None


class ExamOut(ExamIn):
    id: int
    work_id: Optional[int] = None   # verknüpfte Auswertung im Modul „Klassenarbeit"
    model_config = {"from_attributes": True}


async def _check_topics(db: AsyncSession, user: User, ids) -> Optional[list]:
    """Themen auf die EIGENEN eingrenzen, Reihenfolge und Auswahl behalten.

    Fremde und gelöschte IDs fliegen still heraus, statt den ganzen Termin mit
    einem Fehler abzulehnen: die Liste ist eine Zusatzangabe, und ein Thema,
    das jemand zwischendurch gelöscht hat, darf das Verschieben eines Termins
    nicht blockieren. Es sind ohnehin nur Verweise — die Themen selbst liegen
    im Kern und werden hier nie verändert.
    """
    if not ids:
        return None
    from ..models import Topic
    eigene = {t for (t,) in (await db.execute(
        select(Topic.id).where(Topic.owner_id == user.id, Topic.deleted_at.is_(None)))).all()}
    gesehen = []
    for tid in list(ids)[:20]:
        if isinstance(tid, int) and tid in eigene and tid not in gesehen:
            gesehen.append(tid)
    return gesehen or None


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
    daten = body.model_dump()
    daten["topic_ids"] = await _check_topics(db, user, daten.get("topic_ids"))
    e = ExamDate(owner_id=user.id, **daten)
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
    e = await eigenes(db, ExamDate, exam_id, user, "Klassenarbeit nicht gefunden")
    await _check_class(db, user, body.class_id)
    await _check_kurs(db, user, body.kurs_id)
    daten = body.model_dump()
    daten["topic_ids"] = await _check_topics(db, user, daten.get("topic_ids"))
    for k, v in daten.items():
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
    e = await eigenes(db, ExamDate, exam_id, user, "Klassenarbeit nicht gefunden")
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


def _tag(x):
    """Auf reines Datum reduzieren (aus datetime oder date)."""
    return x.date() if hasattr(x, "date") else x


def _freie_tage(breaks) -> set:
    """Alle Tage in den freien Zeitraeumen (Ferien, bewegliche Feiertage)."""
    from datetime import timedelta as _td
    raus = set()
    for b in breaks:
        d, end = _tag(b.start_date), _tag(b.end_date)
        while d <= end:
            raus.add(d)
            d = d + _td(days=1)
    return raus


def _unterrichtsstunden(*, kurs_id, class_id, start: date, ende: date,
                        slots, planned, breaks_days: set, cancel_set: set) -> list:
    """Die Unterrichtsstunden eines Kurses zwischen `start` (mit) und `ende` (ohne).

    Genau die Rechnung, die der Kalender auch anzeigt, und sie steht nur hier:
    wiederkehrende Stundenplan-Stunden (freie Tage, Ausfaelle und ueberschriebene
    abgezogen) plus die konkret geplanten Eintraege. Ein konkreter Eintrag mit
    Stundennummer ERSETZT an dem Tag den wiederkehrenden Slot dieser Stunde —
    egal fuer welchen Kurs; sonst zaehlte der alte Slot dort weiter mit, wenn der
    Eintrag den Kurs geaendert hat.

    Zugehoerigkeit:
    - Kurs gesetzt: der SELBE Kurs zaehlt, dazu kurslose (nur fuer die Klasse
      geplante) Stunden derselben Klasse. Ein ANDERER Kurs derselben Klasse
      zaehlt nicht — sonst zaehlte Physik fuer die Mathe-Planung mit.
    - Nur Klasse: alles dieser Klasse.

    Liefert eine sortierte Liste von (Tag, Stunde). Gebraucht von der
    Klassenarbeits-Uebersicht („noch wie viele Stunden?") und vom
    Stoffverteilungsplan („wann ist welches Thema dran?") — zwei Fragen, eine
    Rechnung.
    """
    from datetime import timedelta as _td

    def passt(k_id, c_id):
        if kurs_id is not None:
            return k_id == kurs_id or (k_id is None and class_id is not None and c_id == class_id)
        return class_id is not None and c_id == class_id

    by_wd = {}
    for s2 in slots:
        if passt(s2.kurs_id, s2.class_id):
            by_wd.setdefault(s2.weekday, []).append(s2)
    ueberschrieben = {(_tag(e.date), e.period) for e in planned if start <= _tag(e.date) < ende}

    treffer = set()
    d = start
    while d < ende:
        if d not in breaks_days:
            for s2 in by_wd.get(d.weekday(), []):
                if not _slot_active_on(s2, d):
                    continue
                if (d, s2.period) not in cancel_set and (d, s2.period) not in ueberschrieben:
                    treffer.add((d, s2.period))
        d = d + _td(days=1)
    for e in planned:
        ed = _tag(e.date)
        if start <= ed < ende and ed not in breaks_days and passt(e.kurs_id, e.class_id):
            treffer.add((ed, e.period))
    return sorted(treffer)


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


async def stundenplan_vorkommen(db: AsyncSession, user: User, start: date, ende: date) -> list:
    """Welche Stundenplan-Stunden fallen im Zeitraum WIRKLICH an?

    Der Stundenplan ist eine Vorlage, kein Terminkalender. Was daraus an einem
    bestimmten Tag uebrig bleibt, entscheiden vier Regeln — und die stehen hier
    an EINER Stelle, weil zwei Ausgaben sie brauchen: der ICS-Feed und der
    CalDAV-Kalender. Als Kopie waeren sie nach der ersten Aenderung
    auseinandergelaufen, und dann zeigte das abonnierte Handy etwas anderes als
    das eingerichtete.

    Die Regeln:

    * Die Stunde muss an dem Tag gelten (`valid_from`/`valid_to` — der
      Stundenplan wird versioniert, das Halbjahr davor bleibt stehen).
    * Kein freier Zeitraum (Ferien, Feiertag).
    * Kein Ausfall an genau diesem Tag in genau dieser Stunde.
    * Kein Kalender-Eintrag an diesem Tag in dieser Stunde — dann ist die
      Vorlage bereits zu einem echten Termin geworden, und beide zusammen
      waeren derselbe Unterricht doppelt.

    Rueckgabe je Vorkommen: {"slot", "tag", "titel", "raum", "start", "ende"}
    mit Uhrzeiten als "HH:MM" (leer, wenn fuer die Stunde keine hinterlegt ist).
    `raum` ist der Stammraum des Kurses (kurse.raum) und wird als Ort (LOCATION)
    ausgegeben — im Handykalender ist „wo?" die zweite Frage nach „was?".
    """
    slots = (await db.execute(select(TimetableSlot).where(
        TimetableSlot.owner_id == user.id))).scalars().all()
    if not slots:
        return []

    belegt = set()
    for e in (await db.execute(select(CalendarEntry).where(
            CalendarEntry.owner_id == user.id, CalendarEntry.period.is_not(None)))).scalars().all():
        # Auch eine Serie belegt ihre Stunde an JEDEM ihrer Tage — sonst stuende
        # ab der zweiten Woche die Vorlage neben dem echten Termin.
        for tag in serien_tage(e, start, ende):
            belegt.add((tag, e.period))
    for c in (await db.execute(select(SlotCancellation).where(
            SlotCancellation.owner_id == user.id))).scalars().all():
        belegt.add((_tag(c.date), c.period))

    frei = [(_tag(b.start_date), _tag(b.end_date)) for b in (await db.execute(
        select(CalendarBreak).where(CalendarBreak.owner_id == user.id))).scalars().all()]

    kurse = {k.id: k for k in (await db.execute(select(Kurs).where(
        Kurs.owner_id == user.id, Kurs.deleted_at.is_(None)))).scalars().all()}
    klassen = {c.id: c for c in (await db.execute(select(SchoolClass).where(
        SchoolClass.owner_id == user.id))).scalars().all()}
    zeiten = user.timetable_times if isinstance(user.timetable_times, list) else []

    je_wochentag = {}
    for s in slots:
        je_wochentag.setdefault(s.weekday, []).append(s)

    out = []
    tag = start
    while tag < ende:
        if not any(von <= tag <= bis for von, bis in frei):
            for s in sorted(je_wochentag.get(tag.weekday(), []), key=lambda x: x.period):
                if (tag, s.period) in belegt or not _slot_active_on(s, tag):
                    continue
                kurs = kurse.get(s.kurs_id) or kurse.get(
                    getattr(klassen.get(s.class_id), "kurs_id", None))
                titel = (_kurs_label(kurs) or getattr(klassen.get(s.class_id), "name", "")
                         or s.title or "Unterricht")
                z = zeiten[s.period - 1] if 0 < s.period <= len(zeiten) else None
                out.append({
                    "slot": s, "tag": tag, "titel": titel,
                    "raum": getattr(kurs, "raum", "") or "",
                    "start": (z or {}).get("start", "") if isinstance(z, dict) else "",
                    "ende": (z or {}).get("end", "") if isinstance(z, dict) else "",
                })
        tag += timedelta(days=1)
    return out


@router.get("/klassenarbeiten/uebersicht")
async def exam_overview(user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Kommende Klassenarbeiten mit den bis dahin verbleibenden Stundenplan-
    Stunden des Kurses (freie Tage/Ferien und Stundenausfälle abgezogen)."""
    from datetime import timezone as _tz
    exams = (await db.execute(select(ExamDate).where(ExamDate.owner_id == user.id).order_by(ExamDate.date))).scalars().all()
    slots = (await db.execute(select(TimetableSlot).where(TimetableSlot.owner_id == user.id))).scalars().all()
    breaks = (await db.execute(select(CalendarBreak).where(CalendarBreak.owner_id == user.id))).scalars().all()
    cancels = (await db.execute(select(SlotCancellation).where(SlotCancellation.owner_id == user.id))).scalars().all()
    # Bereits GEPLANTE Stunden (konkrete Einträge mit Stundennummer) zählen mit —
    # auch zusätzliche/verschobene, die nicht im wiederkehrenden Raster stehen.
    planned = (await db.execute(select(CalendarEntry).where(CalendarEntry.owner_id == user.id, CalendarEntry.period.is_not(None)))).scalars().all()
    id2cls, _ = await _class_maps(db, user)
    kurse = {k.id: k for k in (await db.execute(select(Kurs).where(Kurs.owner_id == user.id))).scalars().all()}
    # Themen der Termine mit Namen versehen. Ein inzwischen geloeschtes Thema
    # faellt hier heraus, statt als Nummer ohne Namen anzukommen — die Termine
    # muessen davon nichts wissen.
    from ..models import Topic
    _themen = {t.id: t for t in (await db.execute(select(Topic).where(
        Topic.owner_id == user.id, Topic.deleted_at.is_(None)))).scalars().all()}

    def _thema_label(tid):
        t = _themen.get(tid)
        if not t:
            return None
        eltern = _themen.get(t.parent_id) if t.parent_id else None
        return f"{eltern.name} / {t.name}" if eltern else t.name

    breaks_days = _freie_tage(breaks)
    cancel_set = {(_tag(c.date), c.period) for c in cancels}
    today = datetime.now(_tz.utc).date()

    # Bei mehreren Klassenarbeiten desselben Kurses zählen die Stunden ZWISCHEN
    # den Terminen: Startpunkt ist die vorige Klassenarbeit der Gruppe (frühestens
    # heute — Vergangenes ist schon gelaufen), nicht immer heute.
    out = []
    prev = {}  # gruppen-key -> Datum der vorigen Klassenarbeit
    for ex in exams:  # nach Datum sortiert
        exd = _tag(ex.date)
        key = ex.kurs_id if ex.kurs_id is not None else ("c", ex.class_id)
        frm = prev.get(key)
        prev[key] = exd  # für die nächste Klassenarbeit dieser Gruppe
        if exd < today:
            continue  # vergangene: nicht anzeigen, aber als „vorige" gemerkt
        start = frm if (frm is not None and frm > today) else today
        # Stunden bis zum Tag VOR der Arbeit — dieselbe Rechnung wie im
        # Stoffverteilungsplan (siehe _unterrichtsstunden).
        occ = _unterrichtsstunden(kurs_id=ex.kurs_id, class_id=ex.class_id,
                                  start=start, ende=exd, slots=slots, planned=planned,
                                  breaks_days=breaks_days, cancel_set=cancel_set)
        stunden = len(occ)
        out.append({
            "id": ex.id, "date": ex.date.isoformat(), "title": ex.title,
            "kurs_id": ex.kurs_id, "class_id": ex.class_id, "work_id": ex.work_id, "period": ex.period,
            "kurs": getattr(kurse.get(ex.kurs_id), "name", None) if ex.kurs_id else None,
            # Das Fach steht am Kurs. Die Liste laesst sich danach sortieren:
            # wer Mathe und Deutsch unterrichtet, plant die Arbeiten fachweise,
            # nicht in der Reihenfolge, in der sie im Kalender stehen.
            "fach": getattr(kurse.get(ex.kurs_id), "fach", "") or "" if ex.kurs_id else "",
            "klasse": id2cls.get(ex.class_id) if ex.class_id else None,
            "stunden": stunden,
            "notiz": ex.notiz or "",
            "topic_ids": list(ex.topic_ids or []),
            "topics": [{"id": tid, "label": _thema_label(tid)}
                       for tid in (ex.topic_ids or []) if _thema_label(tid)],
        })
    return out


# ─── Stoffverteilungsplan ───
#
# „Ich kann Arbeiten planen und sehe die Stunden bis dahin — dasselbe brauche
# ich fuer Themen." Genau das: je Kurs eine Liste von Themen mit Soll-Stunden,
# und daraus rechnet der Server, WANN jedes Thema dran ist.
#
# Der Kern der Sache ist, was NICHT gespeichert wird: kein Datum je Thema. Ein
# eingetragenes Datum ist nach der ersten ausgefallenen Stunde falsch, und es
# von Hand nachzuziehen ist die Arbeit, die der Plan gerade abnehmen soll.
# Gespeichert wird die Reihenfolge und die Stundenzahl; das Datum ergibt sich
# aus dem Stundenplan (freie Tage und Ausfaelle abgezogen) — dieselbe Rechnung,
# die auch die Klassenarbeits-Uebersicht benutzt (_unterrichtsstunden).

class StoffplanZeile(BaseModel):
    topic_id: int
    stunden: int = 1
    term: str = ""       # "1" | "2" | "" (durchgehend)
    notiz: str = ""
    # Fester Zeitraum ("JJJJ-MM-TT" oder ""); leer heisst „rechne es aus".
    start_date: str = ""
    end_date: str = ""
    # Schliesst mit dieser Klassenarbeit ab (Termin-ID) — 0/None = keine.
    exam_id: Optional[int] = None
    niveau: str = ""     # "" | "G" | "E"


class StoffplanIn(BaseModel):
    kurs_id: int
    zeilen: List[StoffplanZeile]


def _datum(wert):
    """"JJJJ-MM-TT" -> date, alles andere -> None.

    Unlesbares gilt als „nicht gesetzt" statt als Fehler: das Feld ist eine
    Zusatzangabe, und ein 422 mitten im Umsortieren des Plans waere die
    schlechteste Antwort auf einen Tippfehler im Datum.
    """
    if not wert:
        return None
    try:
        return date.fromisoformat(str(wert)[:10])
    except ValueError:
        return None


def _halbjahr(user: User, term: str):
    """(Anfang, Ende) des gewaehlten Halbjahrs aus dem Profil — oder (None, None).

    Das Schuljahr haengt am Konto (siehe models.User): es ist fuer alle Klassen
    dieser Lehrkraft dasselbe. Fehlt es, rechnet der Plan trotzdem — nur eben ab
    heute und ohne Enddatum; die Oberflaeche sagt dann, dass die Angabe fehlt.
    """
    hj1, hj2, ende = user.hj1_start, user.hj2_start, user.jahr_ende
    if term == "2":
        return (hj2, ende)
    if term == "1":
        return (hj1, hj2 or ende)
    # Ohne Angabe: das laufende Halbjahr.
    heute = datetime.now(timezone.utc).date()
    if hj2 and heute >= hj2:
        return (hj2, ende)
    return (hj1, hj2 or ende)


@router.get("/stoffplan")
async def stoffplan(kurs_id: int, term: str = "", user: User = Depends(require_module),
                    db: AsyncSession = Depends(get_db)):
    """Der Plan eines Kurses samt errechneter Zeitraeume je Thema."""
    from ..models import KursTag, Stoffplan, Topic

    k = await eigener_kurs(db, user, kurs_id)
    zeilen = (await db.execute(select(Stoffplan).where(
        Stoffplan.owner_id == user.id, Stoffplan.kurs_id == kurs_id
    ).order_by(Stoffplan.position, Stoffplan.id))).scalars().all()

    themen = {t.id: t for t in (await db.execute(select(Topic).where(
        Topic.owner_id == user.id, Topic.deleted_at.is_(None)))).scalars().all()}

    def label(tid):
        t = themen.get(tid)
        if not t:
            return None
        p = themen.get(t.parent_id) if t.parent_id else None
        return f"{p.name} / {t.name}" if p else t.name

    # Die Klasse des Kurses: ohne sie zaehlen nur Stunden, an denen der Kurs
    # ausdruecklich steht — wer den Stundenplan nur ueber die Klasse gepflegt
    # hat, saehe sonst null Stunden.
    klassen = (await db.execute(select(KursTag.class_id).where(KursTag.kurs_id == kurs_id))).scalars().all()
    class_id = klassen[0] if len(klassen) == 1 else None

    von, bis = _halbjahr(user, term)
    heute = datetime.now(timezone.utc).date()
    start = von or heute
    ende = bis or (start + timedelta(weeks=20))

    slots = (await db.execute(select(TimetableSlot).where(TimetableSlot.owner_id == user.id))).scalars().all()
    breaks = (await db.execute(select(CalendarBreak).where(CalendarBreak.owner_id == user.id))).scalars().all()
    cancels = (await db.execute(select(SlotCancellation).where(SlotCancellation.owner_id == user.id))).scalars().all()
    planned = (await db.execute(select(CalendarEntry).where(
        CalendarEntry.owner_id == user.id, CalendarEntry.period.is_not(None)))).scalars().all()

    stunden_termine = _unterrichtsstunden(
        kurs_id=kurs_id, class_id=class_id, start=start, ende=ende,
        slots=slots, planned=planned,
        breaks_days=_freie_tage(breaks), cancel_set={(_tag(c.date), c.period) for c in cancels})

    # IST-Stunden: konkret geplante Eintraege, die auf das Thema zeigen. Nur
    # Eintraege, keine Stundenplan-Vorlagen — die Vorlage sagt „hier ist Mathe",
    # nicht „hier wurde dieses Thema unterrichtet".
    ist = {}
    for e in planned:
        ed = _tag(e.date)
        if not e.topic_id or not (start <= ed < ende):
            continue
        if e.kurs_id == kurs_id or (e.kurs_id is None and class_id is not None and e.class_id == class_id):
            ist[e.topic_id] = ist.get(e.topic_id, 0) + 1

    # Klassenarbeiten des Kurses im Zeitraum. Sie stehen NICHT nur daneben:
    # eine Planzeile kann auf eine zeigen („dieses Thema schliesst damit ab"),
    # und die Termine, auf die keine zeigt, sortiert die Oberflaeche nach Datum
    # zwischen die Zeilen. Sie sind schon eingetragen — der Plan soll sie
    # benutzen, nicht ein zweites Mal abfragen.
    exams = (await db.execute(select(ExamDate).where(
        ExamDate.owner_id == user.id, ExamDate.kurs_id == kurs_id).order_by(ExamDate.date))).scalars().all()
    arbeiten = [
        {"id": ex.id, "date": _tag(ex.date).isoformat(), "title": ex.title,
         "topics": [label(t) for t in (ex.topic_ids or []) if label(t)]}
        for ex in exams if start <= _tag(ex.date) < ende
    ]

    # Soll-Stunden der Reihe nach auf die Termine legen. Reicht der Zeitraum
    # nicht, bleibt `bis` leer — das ist der eigentliche Befund des Plans
    # („dafuer reicht das Halbjahr nicht"), keine Panne.
    i = 0
    out = []
    for z in zeilen:
        lab = label(z.topic_id)
        if not lab:
            continue                 # Thema im Papierkorb: Zeile still ueberspringen
        n = max(0, int(z.stunden or 0))
        eigene = stunden_termine[i:i + n]
        i += n
        # Fester Zeitraum gewinnt gegen den gerechneten. Beides steht in der
        # Antwort: die Oberflaeche zeigt das eingetragene Datum an und kann
        # trotzdem sagen, was die Rechnung ergaebe.
        gerechnet_von = eigene[0][0].isoformat() if eigene else None
        gerechnet_bis = eigene[-1][0].isoformat() if eigene else None
        out.append({
            "topic_id": z.topic_id, "label": lab, "stunden": n, "term": z.term or "",
            "notiz": z.notiz or "", "ist": ist.get(z.topic_id, 0),
            "niveau": z.niveau or "",
            "start_date": z.start_date.isoformat() if z.start_date else "",
            "end_date": z.end_date.isoformat() if z.end_date else "",
            "start": (z.start_date.isoformat() if z.start_date else gerechnet_von),
            "ende": (z.end_date.isoformat() if z.end_date else gerechnet_bis),
            "fest": bool(z.start_date or z.end_date),
            # Weniger Termine als Soll-Stunden: das Halbjahr ist zu kurz.
            "passt": len(eigene) == n,
            "exam_id": z.exam_id,
        })

    # Was noch fehlt: Themen desselben Fachs und Jahrgangs, die nicht im Plan
    # stehen. Fach/Jahrgang schlagen VOR, dieser Plan ist die Entscheidung.
    drin = {z.topic_id for z in zeilen}
    vorschlaege = []
    if k.fach or k.jahrgang:
        for t in themen.values():
            if t.id in drin or t.parent_id is None:
                continue          # geplant wird auf Ebene der Unterthemen
            wurzel = themen.get(t.parent_id)
            if not wurzel:
                continue
            if k.fach and (wurzel.fach or "") != k.fach:
                continue
            if k.jahrgang and wurzel.jahrgang != k.jahrgang:
                continue
            vorschlaege.append({"topic_id": t.id, "label": label(t.id)})
    vorschlaege.sort(key=lambda x: x["label"] or "")

    return {
        "kurs_id": kurs_id, "kurs": k.name, "fach": k.fach or "", "jahrgang": k.jahrgang,
        "von": start.isoformat(), "bis": ende.isoformat(),
        "halbjahr_gesetzt": bool(von),
        "stunden_gesamt": len(stunden_termine),
        "stunden_verplant": min(i, len(stunden_termine)),
        "zeilen": out, "arbeiten": arbeiten, "vorschlaege": vorschlaege,
    }


@router.put("/stoffplan", status_code=204)
async def set_stoffplan(body: StoffplanIn, user: User = Depends(require_module),
                        db: AsyncSession = Depends(get_db)):
    """Den ganzen Plan eines Kurses setzen — Reihenfolge ist die Listenreihenfolge.

    Ganz statt zeilenweise, weil Reihenfolge und Stundenzahl zusammen EINE
    Entscheidung sind: wer ein Thema verschiebt, verschiebt alle danach. Ein
    PUT je Zeile hiesse zwanzig Aufrufe fuer einen Zug.
    """
    from sqlalchemy import delete as sa_delete
    from ..models import Stoffplan, Topic

    await eigener_kurs(db, user, body.kurs_id)
    eigene = {t for (t,) in (await db.execute(select(Topic.id).where(
        Topic.owner_id == user.id, Topic.deleted_at.is_(None)))).all()}

    exam_ids = {e for (e,) in (await db.execute(select(ExamDate.id).where(
        ExamDate.owner_id == user.id, ExamDate.kurs_id == body.kurs_id))).all()}

    await db.execute(sa_delete(Stoffplan).where(
        Stoffplan.owner_id == user.id, Stoffplan.kurs_id == body.kurs_id))
    gesehen = set()
    for pos, z in enumerate(body.zeilen[:200]):
        # Fremde und doppelte Themen still ueberspringen: die Liste kommt aus
        # einer Oberflaeche, in der man zieht und ablegt — ein 422 mitten im
        # Umsortieren waere die schlechteste Antwort darauf.
        if z.topic_id not in eigene or z.topic_id in gesehen:
            continue
        gesehen.add(z.topic_id)
        db.add(Stoffplan(owner_id=user.id, kurs_id=body.kurs_id, topic_id=z.topic_id,
                         stunden=max(0, min(int(z.stunden or 0), 200)), position=pos,
                         term=(z.term or "")[:8], notiz=(z.notiz or "")[:500],
                         start_date=_datum(z.start_date), end_date=_datum(z.end_date),
                         # Nur Termine DIESES Kurses: eine Zeile, die auf die
                         # Arbeit einer fremden Lerngruppe zeigt, waere ein Plan,
                         # der beim Verschieben dort mitwandert.
                         exam_id=z.exam_id if z.exam_id in exam_ids else None,
                         niveau=z.niveau if z.niveau in ("G", "E") else ""))
    await db.commit()


# ─── Stundenplan (wiederkehrendes Wochenraster, Vorlage fuer Termine) ───

class SlotIn(BaseModel):
    weekday: int
    period: int
    class_id: Optional[int] = None
    kurs_id: Optional[int] = None   # gewaehlter Kurs (Fach) — Anzeige daraus
    title: str = ""
    topic_id: Optional[int] = None
    # Fuer welchen Zeitraum die Stunde gilt: "1", "2", "jahr" oder leer
    # (laufendes Halbjahr). Der Begriff statt zweier Datumsfelder — das
    # Schuljahr steht am Konto, und zwei Stellen mit Datumsangaben liefen
    # auseinander.
    term: str = ""


def _stundenplan_fenster(user: User, term: str):
    """(ab, bis) fuer den gewaehlten Zeitraum eines Stundenplans.

    Ein Stundenplan gilt fuer ein Halbjahr — das ist der Takt, in dem Schulen
    ihn neu machen. `term` ist "1", "2", "jahr" oder leer (= laufendes
    Halbjahr). Ohne Schuljahr im Profil bleibt es beim alten Verhalten: ab
    heute, ohne Ende — der Plan muss benutzbar sein, bevor jemand sein
    Schuljahr eingetragen hat.
    """
    heute = date.today()
    if term == "jahr":
        ab, bis = user.hj1_start, user.jahr_ende
    elif term == "1":
        # Das erste Halbjahr endet am Tag VOR dem zweiten.
        ab = user.hj1_start
        bis = (user.hj2_start - timedelta(days=1)) if user.hj2_start else user.jahr_ende
    elif term == "2":
        ab, bis = user.hj2_start, user.jahr_ende
    else:
        ab, bis = _halbjahr(user, "")
        if bis and user.hj2_start and bis == user.hj2_start:
            bis = bis - timedelta(days=1)
    return (ab or heute), bis


class SlotOut(SlotIn):
    id: int
    valid_from: Optional[date] = None  # None = seit jeher gültig
    valid_to: Optional[date] = None    # None = noch aktiv; sonst letzter gültiger Tag
    model_config = {"from_attributes": True}


class Timetable(BaseModel):
    periods: int
    slots: List[SlotOut]
    times: list = []
    # Das Schuljahr aus dem Profil (Halbjahre + Ende). Die Auswahl „1. HJ /
    # 2. HJ / Jahr" braucht es, und ist es nicht eingetragen, sagt die
    # Oberflaeche das, statt einen Zeitraum zu erfinden.
    schuljahr: dict = {}


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
    def _iso(d):
        return d.isoformat() if d else ""
    return {"periods": user.timetable_periods or 6, "slots": rows,
            "times": user.timetable_times or [],
            "schuljahr": {"hj1": _iso(user.hj1_start), "hj2": _iso(user.hj2_start),
                          "ende": _iso(user.jahr_ende)}}


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
    # Ab wann die Änderung gilt: der Anfang des gewählten Halbjahrs, sonst
    # heute. Rückwirkend ist das gewollt — wer im November den Plan des
    # laufenden Halbjahrs berichtigt, meint das ganze Halbjahr, nicht „ab
    # morgen". Der Plan des VORIGEN Halbjahrs bleibt davon unberührt.
    ab, bis = _stundenplan_fenster(user, body.term)
    felder = body.model_dump(exclude={"term"})
    # Die an `ab` gültige Version an (weekday, period).
    active = (await db.execute(select(TimetableSlot).where(
        TimetableSlot.owner_id == user.id,
        TimetableSlot.weekday == body.weekday,
        TimetableSlot.period == body.period,
        or_(TimetableSlot.valid_to.is_(None), TimetableSlot.valid_to >= ab),
        or_(TimetableSlot.valid_from.is_(None), TimetableSlot.valid_from <= ab),
    ).order_by(TimetableSlot.id.desc()))).scalars().first()
    same = active is not None and (
        active.class_id == body.class_id and active.kurs_id == body.kurs_id
        and (active.title or "") == (body.title or "") and active.topic_id == body.topic_id
        and _tag(active.valid_to) == bis
    )
    if active is None:
        # Neue Stunde: gilt im gewählten Zeitraum (davor war nichts).
        s = TimetableSlot(owner_id=user.id, valid_from=ab, valid_to=bis, **felder)
        db.add(s)
    elif same:
        s = active
    elif _tag(active.valid_from) == ab:
        # Beginnt am selben Tag → direkt ändern, keine zusätzliche Version.
        for k, v in felder.items():
            setattr(active, k, v)
        active.valid_to = bis
        s = active
    else:
        # Alte Version bis zum Vortag einfrieren (die Vergangenheit bleibt, wie
        # sie war), neue Version für den gewählten Zeitraum anlegen.
        active.valid_to = ab - timedelta(days=1)
        s = TimetableSlot(owner_id=user.id, valid_from=ab, valid_to=bis, **felder)
        db.add(s)
    await db.commit()
    await db.refresh(s)
    return s


@router.delete("/timetable/slot/{slot_id}", status_code=204)
async def delete_slot(slot_id: int, term: str = "", user: User = Depends(require_module),
                      db: AsyncSession = Depends(get_db)):
    s = await eigenes(db, TimetableSlot, slot_id, user, "Stunde nicht gefunden")
    ab, _bis = _stundenplan_fenster(user, term)
    vf = _tag(s.valid_from)
    if vf is not None and vf >= ab:
        # Fing erst im gewählten Zeitraum an → ganz entfernen.
        await db.delete(s)
    else:
        # Ab dort entfallen, davor behält der Plan die Stunde.
        s.valid_to = ab - timedelta(days=1)
    await db.commit()


# ─── Kalender abonnieren (ICS-Feed fuer Apple/Google, dauerhaft) ───
import hashlib as _hashlib
import secrets as _secrets
from fastapi import Request as _Request
from fastapi.responses import PlainTextResponse as _Plain, Response as _Response


@router.get("/subscribe")
async def subscribe_url(request: _Request, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Gibt die Abo-URL zurueck (erzeugt bei Bedarf ein Token). Der Kalender
    wird per URL abonniert — kein Login, kein Einzel-Download."""
    if not user.calendar_token:
        user.calendar_token = _secrets.token_urlsafe(24)
        await db.commit()
    base = str(request.base_url).rstrip("/")  # z.B. https://host
    path = f"/api/kalender/feed/{user.calendar_token}.ics"
    return {"url": base + path,
            "webcal": ("webcal://" + base.split("://", 1)[-1] + path) if "://" in base else base + path,
            # Der ehrliche Teil: wann der abonnierende Kalender zuletzt geholt
            # hat. Ein Abo wird geholt, nicht geschickt — steht die Aenderung
            # noch nicht im Handy, sieht man hier, ob es ueberhaupt schon da war.
            "geholt": user.calendar_fetched_at.isoformat() if user.calendar_fetched_at else None,
            "geaendert": user.calendar_changed_at.isoformat() if user.calendar_changed_at else None}


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


def _hash_zeilen(lines: list) -> str:
    """Fingerabdruck des Feed-Inhalts. Alles Zeitabhaengige (DTSTAMP,
    LAST-MODIFIED, SEQUENCE) bleibt aussen vor — sonst waere jeder Abruf eine
    „Aenderung" und die SEQUENCE liefe endlos hoch."""
    fest = [z for z in lines if not z.startswith(("DTSTAMP:", "LAST-MODIFIED:", "SEQUENCE:"))]
    return _hashlib.sha256("\n".join(fest).encode("utf-8")).hexdigest()[:40]


def _ics_escape(s: str) -> str:
    """Text fuer eine ICS-Zeile entschaerfen. Auch \\r muss weg: ICS trennt Zeilen
    mit CRLF — ein Wagenruecklauf aus einer Notiz haette den VEVENT mitten im Feld
    beendet und den Rest des Feeds fuer den abonnierten Kalender zerlegt."""
    return ((s or "").replace("\\", "\\\\").replace(";", r"\;").replace(",", r"\,")
            .replace("\r\n", r"\n").replace("\r", r"\n").replace("\n", r"\n"))


def _ics_falten(zeile: str) -> str:
    """Lange Zeile nach RFC 5545 umbrechen: hoechstens 75 Oktette je Zeile, die
    Fortsetzung beginnt mit einem Leerzeichen. Gezaehlt wird in Oktetten, nicht
    in Zeichen — ein Umlaut sind zwei Oktette, und ein Umbruch mitten in einem
    UTF-8-Zeichen macht die Zeile fuer den Client unlesbar.

    Warum ueberhaupt: eine ungefaltete Zeile ist ein Formfehler; strenge Leser
    verwerfen dann das ganze VEVENT statt nur den langen Titel."""
    roh = zeile.encode("utf-8")
    if len(roh) <= 75:
        return zeile
    teile, rest = [], roh
    grenze = 75
    while len(rest) > grenze:
        schnitt = grenze
        # Nicht mitten in ein Mehrbyte-Zeichen schneiden (Folgebytes sind 10xxxxxx).
        while schnitt > 1 and (rest[schnitt] & 0xC0) == 0x80:
            schnitt -= 1
        teile.append(rest[:schnitt].decode("utf-8"))
        rest = rest[schnitt:]
        grenze = 74  # Fortsetzungszeilen tragen ein fuehrendes Leerzeichen
    teile.append(rest.decode("utf-8"))
    return "\r\n ".join(teile)


def _kurs_label(kurs) -> str:
    """"Mathe · 7.5" — Fach zuerst, Kursname dahinter.

    Gegenstueck zu `kursLabel` in apps/web/src/core/kurslabel.js und muss mit
    ihm zusammen geaendert werden: zwei Fassungen hiessen, dass derselbe Termin
    im Handykalender anders heisst als im Browser. Steht das Fach schon im
    Namen ("Mathe 7.5"), waere "Mathe · Mathe 7.5" doppelt gemoppelt — viele
    Konten benennen ihre Kurse genau so.
    """
    if kurs is None:
        return ""
    fach = (getattr(kurs, "fach", "") or "").strip()
    name = (getattr(kurs, "name", "") or "").strip()
    if not fach:
        return name
    if not name:
        return fach
    if fach.lower() in name.lower():
        return name
    return f"{fach} · {name}"


# ─── Fremde Termine im eigenen Export ───
#
# Der Schluessel eines externen Ereignisses ist "uid|YYYY-MM-DD" und enthaelt
# alles, was ein fremder Kalender in eine UID schreibt — Leerzeichen, Doppel-
# punkte, Umlaute. Als Dateiname (CalDAV) und als UID (ICS) taugt er deshalb
# nicht: gehasht ist er kurz, stabil und harmlos. Stabil ist wichtig — eine
# wandernde UID legt im Handy bei jedem Abgleich eine Kopie an.
def ext_kurz(key: str) -> str:
    import hashlib
    return hashlib.md5((key or "").encode("utf-8")).hexdigest()[:20]


def ext_uid(key: str) -> str:
    return f"nuvora-ext-{ext_kurz(key)}@nuvora"


def ext_dateiname(key: str) -> str:
    return f"ext-{ext_kurz(key)}.ics"


def _d_iso(s: str):
    """'YYYY-MM-DD' -> date, sonst None."""
    from datetime import date as _date
    try:
        j, m, t = (s or "").split("-")
        return _date(int(j), int(m), int(t))
    except Exception:
        return None


@router.get("/feed/{token}.ics")
async def ics_feed(token: str, request: _Request = None, db: AsyncSession = Depends(get_db)):
    """ICS-Feed eines Kontos (Token statt Login). Kalender-Eintraege als
    Ganztags-Events, freie Zeitraeume (Ferien) als mehrtaegige Events.

    **Ganztags heisst: DTEND ist EXKLUSIV** (RFC 5545). Ein einzelner Tag ist
    `DTSTART;VALUE=DATE:20260303` + `DTEND;VALUE=DATE:20260304` — das `+1` ist
    kein Zuschlag, sondern der erste Tag NACH dem Termin. Genau hier entstehen
    beide Fehlerbilder aus dem Kalender des Nutzers: ein fehlendes `+1` macht
    aus dem Tag einen Termin der Laenge null (Apple zeigt ihn dann an einem
    beliebigen Tag oder gar nicht), ein doppeltes `+1` zieht ihn ueber mehrere
    Tage. Bei GETAKTETEN Terminen (mit Uhrzeit) gilt das nicht: dort ist DTEND
    der echte Endzeitpunkt am selben Tag, ein `+1 Tag` waere dort der Fehler.

    Die Zeilen unten sind nach dieser Regel nachgerechnet und stimmen. Das
    stehengebliebene Fehlerbild kommt aus dem Cache des Clients: Apple merkt
    sich Art und Dauer eines Ereignisses **pro UID** und uebernimmt eine
    Korrektur nicht, wenn UID und Titel gleich bleiben (fuer die Stundenplan-
    Stunden war das schon einmal so — siehe der `-t`-Marker weiter unten).
    Darum tragen Eintraege und freie Zeitraeume jetzt einen Formmarker in der
    UID und ein `SEQUENCE`/`LAST-MODIFIED`: damit ersetzt der Client die alten,
    falsch gezogenen Kopien einmalig durch die richtigen."""
    from datetime import date, timedelta
    u = (await db.execute(select(User).where(User.calendar_token == token))).scalar_one_or_none()
    if not u:
        raise HTTPException(404, "Kalender nicht gefunden")
    entries = (await db.execute(select(CalendarEntry).where(CalendarEntry.owner_id == u.id).order_by(CalendarEntry.date))).scalars().all()
    breaks = (await db.execute(select(CalendarBreak).where(CalendarBreak.owner_id == u.id))).scalars().all()
    classes = {c.id: c.name for c in (await db.execute(select(SchoolClass).where(SchoolClass.owner_id == u.id))).scalars().all()}
    # Die Kurse dazu: der Feed beschriftet einen Eintrag mit „Fach · Kursname",
    # nicht mit dem Klassennamen. Im Handykalender steht der Termin zwischen
    # Arztterminen und Elternabenden — „7a" sagt dort nichts, „Mathe · 7a"
    # schon. Fach und Kursname stehen am Kurs; die Klasse kennt beides nicht.
    kurse = {k.id: k for k in (await db.execute(select(Kurs).where(
        Kurs.owner_id == u.id, Kurs.deleted_at.is_(None)))).scalars().all()}
    # Welcher Kurs gehoert zu einer Klasse (fuer Eintraege ohne eigene kurs_id)?
    kurs_je_klasse = {}
    for c in (await db.execute(select(SchoolClass).where(SchoolClass.owner_id == u.id))).scalars().all():
        if c.kurs_id:
            kurs_je_klasse[c.id] = c.kurs_id

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
    # Die Bitte an den Client, oefter zu laden. Mehr geht nicht: ein ICS-Abo wird
    # GEHOLT, nicht geschickt — Nuvora kann Apple nichts zurufen.
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Nuvora//Kalender//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
             "X-WR-CALNAME:Nuvora", "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M"]
    seq = int(u.calendar_rev or 0)
    for e in entries:
        day = e.date.date() if hasattr(e.date, "date") else e.date
        # Der Titel im fremden Kalender ist IMMER „Fach · Kursname", wenn ein
        # Kurs am Eintrag haengt. Im Handy steht der Termin zwischen
        # Arztterminen; „Bruchrechnung Station 3" beantwortet dort nicht die
        # Frage, die man an einen Kalender stellt („was habe ich jetzt, mit
        # wem?"). Was die Lehrkraft geschrieben hat, geht deshalb nicht
        # verloren, sondern in die Beschreibung — zusammen mit den Notizen.
        title = _kurs_label(kurse.get(e.kurs_id or kurs_je_klasse.get(e.class_id))) \
            or e.title or classes.get(e.class_id) or "Termin"
        beschreibung = "\n".join(x for x in ((e.title if e.title != title else ""), e.notes or "") if x)
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
            # Getaktet: DTEND ist der echte Endzeitpunkt AM SELBEN TAG — hier
            # waere ein "+1 Tag" der Fehler, der den Termin ueber Nacht zoege.
            dtstart = f"DTSTART:{d8(day)}T{a}"
            dtend = f"DTEND:{d8(day)}T{b2}"
        else:
            # Ganztaegig: DTEND ist exklusiv, also der Folgetag. Ein einzelner
            # Tag braucht genau EIN "+1" — nicht keins und nicht zwei.
            dtstart = f"DTSTART;VALUE=DATE:{d8(day)}"
            dtend = f"DTEND;VALUE=DATE:{d8(day + timedelta(days=1))}"
        lines += [
            "BEGIN:VEVENT",
            f"UID:nuvora-entry-{e.id}-{FORM_MARKER}@nuvora",
            f"DTSTAMP:{now}",
            f"LAST-MODIFIED:{now}",
            f"SEQUENCE:{seq}",
            dtstart,
            dtend,
            f"SUMMARY:{_ics_escape(title)}",
        ]
        if e.rrule:
            lines.append(f"RRULE:{e.rrule}")
            if e.exdate:
                # EXDATE muss zur Form von DTSTART passen: bei einem
                # Ganztags-Termin als DATE, sonst als Zeitpunkt. Ein DATE neben
                # einem getakteten DTSTART ignoriert Apple stillschweigend —
                # der geloeschte Einzeltermin waere im Handy wieder da.
                if a and b2:
                    lines.append("EXDATE:" + ",".join(f"{d}T{a}" for d in e.exdate))
                else:
                    lines.append("EXDATE;VALUE=DATE:" + ",".join(e.exdate))
        if e.location:
            lines.append(f"LOCATION:{_ics_escape(e.location)}")
        if beschreibung:
            lines.append(f"DESCRIPTION:{_ics_escape(beschreibung)}")
        lines.append("END:VEVENT")
    for b in breaks:
        s = b.start_date.date() if hasattr(b.start_date, "date") else b.start_date
        en = b.end_date.date() if hasattr(b.end_date, "date") else b.end_date
        # Ein verdrehter Zeitraum (Ende vor Anfang, z.B. aus einer alten Datei)
        # ergaebe DTEND <= DTSTART — der Client zeigt so ein Ereignis gar nicht
        # oder an einem einzelnen Tag. Lieber auf den Anfangstag klemmen.
        if en < s:
            en = s
        lines += [
            "BEGIN:VEVENT",
            f"UID:nuvora-break-{b.id}-{FORM_MARKER}@nuvora",
            f"DTSTAMP:{now}",
            f"LAST-MODIFIED:{now}",
            f"SEQUENCE:{seq}",
            f"DTSTART;VALUE=DATE:{d8(s)}",
            # Letzter Ferientag + 1: DTEND ist exklusiv, sonst fehlte der
            # letzte Tag der Ferien im abonnierten Kalender.
            f"DTEND;VALUE=DATE:{d8(en + timedelta(days=1))}",
            f"SUMMARY:{_ics_escape(b.label or 'Unterrichtsfrei')}",
            "END:VEVENT",
        ]

    # Wiederkehrende Stundenplan-Stunden über ein rollierendes Fenster ausgeben,
    # damit der abonnierte Kalender den Stundenplan zeigt und nicht nur die
    # einzeln angelegten Termine. WELCHE Stunden an einem Tag übrig bleiben
    # (Ferien, Ausfall, schon vorhandener Eintrag), entscheidet
    # `stundenplan_vorkommen` — dieselbe Funktion, die auch der CalDAV-Kalender
    # benutzt. Als Kopie wären die Regeln nach der ersten Änderung
    # auseinandergelaufen, und das abonnierte Handy zeigte etwas anderes als das
    # eingerichtete.
    def hms(t):
        try:
            hh, mm = (t or "").split(":")[:2]
            return f"{int(hh):02d}{int(mm):02d}00"
        except Exception:
            return None

    heute = date.today()
    for v in await stundenplan_vorkommen(db, u, heute - timedelta(days=30), heute + timedelta(days=121)):
        day, s = v["tag"], v["slot"]
        a, b2 = hms(v["start"]), hms(v["ende"])
        # UID mit Zeit-Marker (-t): erzwingt bei Apple/Google, dass die frueher
        # faelschlich ganztaegigen Slot-Events durch die getakteten ERSETZT
        # werden — sonst behaelt Apple pro UID stur den Ganztags-Typ.
        uid = f"UID:nuvora-slot-{s.id}-{d8(day)}-t@nuvora"
        # Der Stammraum des Kurses als Ort — dieselbe Angabe, die auch im
        # CalDAV-Kalender steht.
        ort = [f"LOCATION:{_ics_escape(v['raum'])}"] if v.get("raum") else []
        if a and b2:
            # Getaktete Stunde: Anfang und Ende am selben Tag. KEIN "+1 Tag" —
            # DTEND ist hier ein Zeitpunkt, kein Folgetag; ein Zuschlag machte
            # aus jeder Stunde einen Tagestermin.
            lines += ["BEGIN:VEVENT", uid, f"DTSTAMP:{now}",
                      f"DTSTART:{d8(day)}T{a}", f"DTEND:{d8(day)}T{b2}",
                      f"SUMMARY:{_ics_escape(v['titel'])}"] + ort + ["END:VEVENT"]
        else:
            # Ohne hinterlegte Uhrzeit bleibt nur der Tag. Ganztaegig, also
            # DTEND exklusiv = Folgetag (genau ein "+1").
            lines += ["BEGIN:VEVENT", uid, f"DTSTAMP:{now}",
                      f"DTSTART;VALUE=DATE:{d8(day)}",
                      f"DTEND;VALUE=DATE:{d8(day + timedelta(days=1))}",
                      f"SUMMARY:{_ics_escape(v['titel'])}"] + ort + ["END:VEVENT"]

    # Die Termine der abonnierten fremden Kalender — nur wenn ausdruecklich
    # eingeschaltet (users.feed_external). Sie sind hier Beifang und bleiben
    # read-only: aendern laesst sich ein fremder Termin ueber Nuvora nicht,
    # loeschen heisst „in Nuvora ausblenden" (das kann nur CalDAV).
    if u.feed_external:
        for ev in await externe_ereignisse(u):
            if ev["hidden"]:
                continue
            tag = _d_iso(ev["date"])
            if not tag:
                continue
            a, b2 = _hm(ev.get("time")), _hm(ev.get("endtime"))
            zeilen = ["BEGIN:VEVENT", f"UID:{ext_uid(ev['key'])}", f"DTSTAMP:{now}",
                      f"SEQUENCE:{seq}"]
            if a and b2:
                zeilen += [f"DTSTART:{d8(tag)}T{a}", f"DTEND:{d8(tag)}T{b2}"]
            else:
                zeilen += [f"DTSTART;VALUE=DATE:{d8(tag)}",
                           f"DTEND;VALUE=DATE:{d8(tag + timedelta(days=1))}"]
            zeilen.append(f"SUMMARY:{_ics_escape(ev.get('title') or 'Termin')}")
            if ev.get("location"):
                zeilen.append(f"LOCATION:{_ics_escape(ev['location'])}")
            zeilen.append("END:VEVENT")
            lines += zeilen

    lines.append("END:VCALENDAR")

    # Hat sich inhaltlich etwas geaendert? Gemessen am Inhalt selbst, nicht an
    # einem Zaehler, den 15 Schreib-Endpunkte pflegen muessten — einer wird
    # immer vergessen, und dann bleibt die Aenderung im Handy unsichtbar.
    # DTSTAMP faellt aus der Rechnung: es traegt die aktuelle Uhrzeit und wuerde
    # jeden Abruf zu einer Aenderung machen.
    sig = _hash_zeilen(lines)
    if sig != (u.calendar_sig or ""):
        u.calendar_sig = sig
        u.calendar_rev = seq = int(u.calendar_rev or 0) + 1
        u.calendar_changed_at = datetime.now()
        # Die frisch gezaehlte Revision gehoert in DIESE Auslieferung, sonst
        # bekaeme der Client die neue Fassung mit der alten SEQUENCE.
        lines = [f"SEQUENCE:{seq}" if z.startswith("SEQUENCE:") else z for z in lines]
    u.calendar_fetched_at = datetime.now()
    await db.commit()

    # LAST-MODIFIED sagt „wann hat sich der Termin geaendert", nicht „wann wurde
    # der Feed geholt". Mit der Uhrzeit des Abrufs waere jeder Termin bei jedem
    # Abruf frisch geaendert — manche Clients bauen ihn dann jedes Mal neu.
    stand = (u.calendar_changed_at or datetime.now()).strftime("%Y%m%dT%H%M%SZ")
    lines = [f"LAST-MODIFIED:{stand}" if z.startswith("LAST-MODIFIED:") else z for z in lines]

    etag = f'W/"nuvora-{seq}"'
    if request is not None and request.headers.get("if-none-match") == etag:
        # Unveraendert: der Client behaelt seine Fassung. Spart bei einem Abo,
        # das alle 15 Minuten anklopft, den ganzen Feed.
        return _Response(status_code=304, headers={"ETag": etag, "Cache-Control": "no-cache, max-age=0"})

    # Gefaltet ausgeben (RFC 5545) und mit abschliessendem CRLF — beides
    # erwarten strenge Leser; ein langer Titel darf keine Zeile ueberlang machen.
    text = "\r\n".join(_ics_falten(z) for z in lines) + "\r\n"
    return _Plain(text, media_type="text/calendar; charset=utf-8",
                  headers={"ETag": etag, "Cache-Control": "no-cache, max-age=0"})


# ─── Externe Kalender (mehrere ICS-URLs read-only einblenden — „andere Richtung") ───
class ExtCalIn(BaseModel):
    url: str = ""
    color: Optional[str] = ""
    name: Optional[str] = ""


class ExtCalsIn(BaseModel):
    calendars: List[ExtCalIn] = []
    # Nicht Optional aus Bequemlichkeit: ein aelterer Client schickt das Feld
    # gar nicht mit, und dann darf der Schalter nicht stillschweigend ausgehen.
    mitschicken: Optional[bool] = None


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
    return {"calendars": _ext_calendars(user), "hidden": user.external_hidden or [],
            "mitschicken": bool(user.feed_external)}


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
    if body.mitschicken is not None:
        user.feed_external = bool(body.mitschicken)
    await db.commit()
    return {"calendars": out, "hidden": user.external_hidden or [],
            "mitschicken": bool(user.feed_external)}


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
    """Einen externen ICS-Feed holen. Der SSRF-Schutz (keine privaten IPs,
    DNS-Rebinding-Pin, keine Weiterleitungen) steht in app/netz.py — an EINER
    Stelle, weil ihn auch die Untis-Anbindung braucht und zwei Fassungen davon
    genau eine zu viel waeren."""
    from ..netz import hole
    return hole(url, timeout=6, max_bytes=2_000_000)


async def externe_ereignisse(user: User, refresh: bool = False) -> list:
    """ALLE Ereignisse aus den externen ICS-Feeds — auch die ausgeblendeten.

    Eine Quelle fuer drei Leser: die Kalenderansicht (`/external-events`), der
    ICS-Feed und der CalDAV-Kalender. Als Kopie waeren die Regeln (Fenster,
    Serien, mehrtaegige Termine, Schluessel) nach der ersten Aenderung
    auseinandergelaufen, und im Handy staende etwas anderes als im Browser.

    Ausgeblendetes faellt hier NICHT heraus, sondern traegt `hidden: True` —
    den Reiter „Ausgeblendet" gibt es nur, weil sich das Weggeblendete wieder
    finden lassen muss. Wer nur das Sichtbare will, filtert selbst.
    """
    import time
    cals = _ext_calendars(user)
    if not cals:
        _EXT_CACHE.pop(user.id, None)
        return []
    # Cache-Signatur: URLs + Farben. Die ausgeblendeten Schluessel stehen
    # bewusst NICHT drin — sie werden erst beim Lesen angeheftet, sonst wuerde
    # jedes Ausblenden alle Feeds neu holen.
    sig = "|".join(f"{c['url']}~{c.get('color','')}" for c in cals)
    hidden = set(user.external_hidden or [])

    def _mit_stand(rows):
        return [{**r, "hidden": r["key"] in hidden} for r in rows]

    hit = _EXT_CACHE.get(user.id)
    if not refresh and hit and hit[0] == sig and hit[1] > time.time():
        return _mit_stand(hit[2])
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
            # `cal` sagt, aus WELCHEM Feed das Ereignis kommt — sonst laesst sich
            # ein einzelner Kalender nicht ausblenden, und die Farbe taugt dafuer
            # nicht (zwei Kalender duerfen dieselbe haben, und einer darf gar
            # keine).
            info = {"title": title, "time": e.get("time"), "endtime": e.get("endtime"),
                    "cal": cal.get("url", ""),
                    "location": e.get("location", ""), "color": color, "uid": uid,
                    "description": e.get("description", ""), "start": d0.isoformat(), "end": last.isoformat()}

            def _emit(iso_date, ov=None):
                row = {**info, "date": iso_date, "key": f"{uid}|{iso_date}"}
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
    return _mit_stand(result)


@router.get("/external-events")
async def external_events(refresh: bool = False, user: User = Depends(require_module)):
    """Die SICHTBAREN Ereignisse der externen Kalender. Read-only, 10-Min-Cache;
    refresh=1 umgeht ihn. Ausgeblendetes (external_hidden, Schluessel
    uid|Datum) faellt hier heraus und steht im Reiter „Ausgeblendet"."""
    rows = await externe_ereignisse(user, refresh)
    return [{k: v for k, v in r.items() if k != "hidden"} for r in rows if not r["hidden"]]


@router.get("/external-hidden")
async def external_hidden(user: User = Depends(require_module)):
    """Was ausgeblendet ist — mit Titel und Datum, nicht nur als Schluessel.

    Der Reiter „Ausgeblendet" muss zeigen, WAS da weggeblendet wurde; eine
    Liste aus „a1b2c3|2026-09-14" beantwortet das nicht. Schluessel, zu denen
    es kein Ereignis mehr gibt (Termin im fremden Kalender geloescht, Feed
    abgemeldet), stehen als `verwaist` dabei — sonst blieben sie fuer immer
    unsichtbar in der Liste stehen und liessen sich nie zurueckholen.
    """
    rows = await externe_ereignisse(user)
    bekannt = {r["key"]: r for r in rows if r["hidden"]}
    out = [{k: v for k, v in r.items() if k != "hidden"} for r in bekannt.values()]
    for key in (user.external_hidden or []):
        if key not in bekannt:
            out.append({"key": key, "title": "", "date": key.split("|")[-1], "verwaist": True})
    out.sort(key=lambda x: (x.get("date") or "", x.get("time") or ""))
    return out


# ─── WebUntis: den Stundenplan der Schule uebernehmen ───
#
# Warum ueberhaupt: der Wochenstundenplan steht bereits in Untis. Ihn hier ein
# zweites Mal von Hand einzutragen ist die Arbeit, die dieses Modul abnehmen
# soll — und beim ersten Planwechsel im Halbjahr stehen zwei Fassungen da.
#
# Warum als Import und nicht als Abgleich: Untis kennt Nuvoras Kurse und
# Klassen nicht. Was von dort kommt, ist ein Vorschlag; zugeordnet und
# uebernommen wird, was die Lehrkraft bestaetigt (derselbe Gedanke wie bei
# jedem anderen Import: gefragt wird immer, nicht nur im Konfliktfall).
#
# Warum nie zurueck: der Schulstundenplan gehoert der Schulleitung.
class UntisKonto(BaseModel):
    server: str = ""
    schule: str = ""
    benutzer: str = ""
    ics_url: str = ""


class UntisAbrufIn(UntisKonto):
    # "api" = JSON-RPC mit Zugangsdaten, "ics" = persoenlicher Abo-Link.
    quelle: str = "api"
    # Das Passwort kommt bei JEDEM Abruf mit und wird nie gespeichert (siehe
    # den Kommentar an users.untis_server).
    passwort: str = ""
    # Ueber wie viele Wochen geschaut wird, um den wiederkehrenden Plan zu
    # erkennen. Vier ist der Kompromiss: genug, damit eine einzelne Vertretung
    # den regulaeren Unterricht nicht ueberstimmt, wenig genug, dass WebUntis
    # nicht wegen der Menge abweist.
    wochen: int = 4


@router.get("/untis")
async def untis_konto(user: User = Depends(require_module)):
    """Die gemerkten Angaben — ohne Passwort, weil keins gespeichert wird."""
    return {"server": user.untis_server or "", "schule": user.untis_schule or "",
            "benutzer": user.untis_benutzer or "", "ics_url": user.untis_ics_url or ""}


@router.put("/untis")
async def untis_konto_setzen(body: UntisKonto, user: User = Depends(require_module),
                             db: AsyncSession = Depends(get_db)):
    url = (body.ics_url or "").strip().replace("webcal://", "https://", 1)
    if url and not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(400, "ICS-Adresse muss mit http(s):// oder webcal:// beginnen")
    user.untis_server = (body.server or "").strip()[:200] or None
    user.untis_schule = (body.schule or "").strip()[:120] or None
    user.untis_benutzer = (body.benutzer or "").strip()[:120] or None
    user.untis_ics_url = url[:2000] or None
    await db.commit()
    return await untis_konto(user)


def _untis_zeiten(user: User) -> list:
    """Nuvoras eigenes Stundenraster als Anfangszeiten (["08:00", …]).

    Ohne es liesse sich eine Untis-Uhrzeit keiner Stundennummer zuordnen: viele
    Schulen zaehlen in Untis die Pausen als eigene Einheit mit, „3. Stunde" ist
    dort also nicht unsere dritte.
    """
    return [(z or {}).get("start", "") for z in (user.timetable_times or []) if isinstance(z, dict)]


@router.post("/untis/vorschau")
async def untis_vorschau(body: UntisAbrufIn, user: User = Depends(require_module),
                         db: AsyncSession = Depends(get_db)):
    """Untis abfragen und ZEIGEN, was ein Import ergaebe — ohne zu schreiben.

    Zwei Schritte statt einem, weil die Zuordnung dazwischen gehoert: Untis
    liefert „M 7a", Nuvora kennt einen Kurs mit einem eigenen Namen. Wer das
    ungefragt zusammenlegt, hat nach dem Import einen Plan, den niemand
    beschlossen hat.
    """
    from .. import untis as U

    # Der Abruf traegt ein fremdes Passwort und geht an einen fremden Server.
    # Ohne Bremse waere das ein bequemer Weg, WebUntis-Zugaenge durchzuprobieren
    # — mit unserer IP als Absender.
    rate_limit("untis", f"u{user.id}", 10, 300, "Zu viele Untis-Abrufe. Bitte kurz warten.")

    zeiten = _untis_zeiten(user)
    if not zeiten:
        raise HTTPException(400, "Erst die Uhrzeiten der Stunden eintragen — sonst "
                                 "laesst sich eine Untis-Uhrzeit keiner Stunde zuordnen")

    heute = date.today()
    wochen = max(1, min(int(body.wochen or 4), 12))
    von, bis = heute, heute + timedelta(weeks=wochen)

    def _abrufen():
        """Blockierender Teil — laeuft im Threadpool, damit der Server waehrend
        eines langsamen Untis-Servers weiter antwortet."""
        if (body.quelle or "api") == "ics":
            url = (body.ics_url or user.untis_ics_url or "").strip()
            if not url:
                raise U.UntisFehler("server", "Kein ICS-Link angegeben")
            return U.stunden_aus_ics(url, von, bis), []
        with U.UntisSitzung(body.server or user.untis_server or "",
                            body.schule or user.untis_schule or "",
                            body.benutzer or user.untis_benutzer or "",
                            body.passwort) as s:
            return s.stundenplan(von, bis), s.ferien()

    import asyncio
    try:
        stunden, ferien = await asyncio.get_event_loop().run_in_executor(None, _abrufen)
    except U.UntisFehler as e:
        # 200 mit Grund statt 4xx: „die Schule hat den Zugang nicht
        # freigeschaltet" ist kein Bedienfehler, und die Oberflaeche soll dazu
        # den Ausweichweg anbieten koennen, statt nur eine rote Zeile zu zeigen.
        return {"ok": False, "grund": e.grund, "meldung": e.text[:300],
                "ics_moeglich": bool(user.untis_ics_url or body.ics_url)}

    raster = U.zu_wochenraster(stunden, zeiten)
    # Was an einer (Wochentag, Stunde) schon bei uns steht — damit die
    # Oberflaeche sagen kann, was ein Import ueberschriebe.
    belegt = {}
    for s in (await db.execute(select(TimetableSlot).where(
            TimetableSlot.owner_id == user.id, TimetableSlot.valid_to.is_(None)))).scalars().all():
        belegt[f"{s.weekday},{s.period}"] = {"title": s.title or "", "kurs_id": s.kurs_id,
                                             "class_id": s.class_id}
    return {
        "ok": True, "quelle": body.quelle or "api",
        "von": von.isoformat(), "bis": bis.isoformat(),
        "stunden_gefunden": len(stunden),
        "raster": raster, "belegt": belegt,
        "ausfaelle": U.ausfaelle(stunden, zeiten),
        "ferien": ferien,
    }


class UntisSlotIn(BaseModel):
    weekday: int
    period: int
    title: str = ""
    kurs_id: Optional[int] = None
    class_id: Optional[int] = None


class UntisAusfallIn(BaseModel):
    datum: str
    stunde: int


class UntisFerienIn(BaseModel):
    von: str
    bis: str
    name: str = ""


class UntisUebernahmeIn(BaseModel):
    slots: List[UntisSlotIn] = []
    ausfaelle: List[UntisAusfallIn] = []
    ferien: List[UntisFerienIn] = []


@router.post("/untis/uebernehmen")
async def untis_uebernehmen(body: UntisUebernahmeIn, user: User = Depends(require_module),
                            db: AsyncSession = Depends(get_db)):
    """Die BESTAETIGTEN Vorschlaege schreiben. Nichts wird geraten.

    Geschrieben wird ueber dieselben Wege wie von Hand — `upsert_slot` haelt die
    Gueltigkeitsspannen der Stundenplan-Versionen zusammen (aendern heisst: alte
    Fassung bis gestern, neue ab heute). Ein eigener Schreibpfad haette diese
    Regel ein zweites Mal enthalten, und die zweite Fassung waere die falsche.
    """
    gesetzt = 0
    for s in body.slots[:200]:
        if not 0 <= s.weekday <= 6 or s.period < 1:
            continue
        await upsert_slot(SlotIn(weekday=s.weekday, period=s.period, title=(s.title or "")[:200],
                                 kurs_id=s.kurs_id, class_id=s.class_id, topic_id=None), user, db)
        gesetzt += 1

    entfallen = 0
    for a in body.ausfaelle[:500]:
        d = _datum(a.datum)
        if not d or a.stunde < 1:
            continue
        wann = tagesbeginn(d)
        da = (await db.execute(select(SlotCancellation).where(
            SlotCancellation.owner_id == user.id, SlotCancellation.date == wann,
            SlotCancellation.period == a.stunde))).scalar_one_or_none()
        if not da:
            db.add(SlotCancellation(owner_id=user.id, date=wann, period=a.stunde))
            entfallen += 1

    frei = 0
    vorhanden = {(b.start_date.date(), b.end_date.date()) for b in (await db.execute(
        select(CalendarBreak).where(CalendarBreak.owner_id == user.id))).scalars().all()}
    for f in body.ferien[:100]:
        von, bis = _datum(f.von), _datum(f.bis)
        if not von or not bis or bis < von:
            continue
        if (von, bis) in vorhanden:
            continue          # schon eingetragen — Ferien zweimal waeren zwei Balken
        db.add(CalendarBreak(owner_id=user.id, start_date=tagesbeginn(von),
                             end_date=tagesbeginn(bis), label=(f.name or "")[:120]))
        frei += 1

    await db.commit()
    return {"slots": gesetzt, "ausfaelle": entfallen, "ferien": frei}
