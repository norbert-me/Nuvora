"""Modul Karten — Karteikarten mit Spaced Repetition (SM-2).

Eigenstaendig (Regel 3). Zwei Zugaenge:
- Lehrkraft (normaler Login): Stapel und Karten verwalten, Tokens/QR erzeugen,
  Fortschritt sehen.
- Schueler (KEIN Login): Zugriff ueber einen einzigartigen Token (Bearer-
  Secret, wie die gedruckte CardVote-Karte). Der Token identifiziert die Person.

Der Fortschritt liegt am Server (CardReview) — nur so sieht die Lehrkraft ihn,
anders als bei Anki, wo er am Geraet bleibt.
"""
import asyncio
import io
import random
import secrets
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import qrcode
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel, field_validator
from sqlalchemy import select, func as sa_func, and_, or_, delete as sql_delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..uploads import bildtyp
from sqlalchemy.orm import selectinload
from ..models import Card, CardDeck, CardFolder, CardReview, SchoolClass, Student, User, Session, Scan, QuestionSetItem
from .auth import get_current_user, rate_limit
from .modules import is_active, modul_pflicht

router = APIRouter(prefix="/api/karten", tags=["karten"])
# Der Zugangs-Druck haengt an keinem Modul: derselbe Code fuehrt zu den Karten
# ODER zu den Testergebnissen, gilt also solange EINES der beiden laeuft. Die
# Pruefung steht deshalb im Endpunkt und nicht als Router-Schranke.
kern_router = APIRouter(prefix="/api/karten", tags=["karten"])
MODULE_KEY = "karten"


def _now():
    return datetime.now(timezone.utc)


def _utc(dt):
    """Zeitstempel vergleichbar machen.

    Postgres liefert TIMESTAMPTZ mit Zeitzone zurueck, SQLite (Tests, lokale
    Pruefinstanz) ohne — ein Vergleich mit datetime.now(timezone.utc) wirft dann
    "can't compare offset-naive and offset-aware datetimes", und zwar erst zur
    Laufzeit auf dem Geraet eines Kindes.
    """
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _anlegen_falls_fehlt(db: AsyncSession, modell, werte: dict, schluessel: list[str]):
    """INSERT ... ON CONFLICT DO NOTHING — die Datenbank entscheidet, wer zuerst war.

    Die Alternative („erst lesen, dann anlegen") hat eine Luecke: zwei
    gleichzeitige Anfragen finden beide nichts und legen beide an. Auf dem
    Schueler-Weg passiert genau das (Doppeltipp, Wiederholung durch das Netz).
    Postgres und SQLite koennen beide ON CONFLICT — nur mit eigenem Konstrukt.
    """
    ins = pg_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
    return ins(modell).values(**werte).on_conflict_do_nothing(index_elements=schluessel)


async def _mit_wiederholung(db: AsyncSession, arbeit, versuche: int = 6):
    """Schreibvorgang gegen gleichzeitige Schreiber absichern.

    Postgres serialisiert ueber die Zeilensperre (`SELECT ... FOR UPDATE`) —
    dort greift die Wiederholung praktisch nie. SQLite (Tests, lokale
    Pruefinstanz) kennt keine Zeilensperre und bricht den zweiten Schreiber
    stattdessen ab; dann wird zurueckgerollt, neu gelesen und neu gerechnet.

    Bewusst je Modul kopiert statt geteilt: Module haengen nicht voneinander ab.
    """
    for versuch in range(versuche):
        try:
            return await arbeit()
        except (IntegrityError, OperationalError):
            await db.rollback()
            if versuch == versuche - 1:
                raise HTTPException(503, "Gerade zu viel los. Bitte gleich noch einmal versuchen.")
            await asyncio.sleep(0.02 * (versuch + 1) + random.random() * 0.03)
    # Erreichbar nur bei versuche <= 0. Ohne diese Zeile käme dort ein stilles
    # None heraus, mit dem der Aufrufer weiterrechnet.
    raise HTTPException(503, "Gerade zu viel los. Bitte gleich noch einmal versuchen.")


def _token():
    return secrets.token_urlsafe(24)  # ~32 Zeichen, unratbar


def _tagesbeginn(dt: datetime) -> datetime:
    """Beginn des Kalendertags (UTC). Kalender-Eintraege sind auf die Tagesmitte
    verankert; wer daraus direkt ein released_at macht, schaltet den Stapel erst
    am Nachmittag frei — die Stunde am Vormittag sieht ihn nicht. Freigegeben
    wird darum AB TAGESBEGINN.

    Bewusst hier dupliziert (gleiche Funktion in kalender.py): kein Modul haengt
    am anderen (Regel 3)."""
    d = dt.date() if isinstance(dt, datetime) else dt
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)


# SM-2-Grenzen. Ohne Deckel waechst der Erleichterungsfaktor bei jedem „leicht"
# weiter und das Intervall vervielfacht sich jedes Mal: nach ein paar Dutzend
# Klicks (mit all=True kann ein Kind eine Karte beliebig oft ueben) liegt die
# Faelligkeit jenseits von Jahr 9999 — datetime laeuft ueber (500er Fehler) und
# die Karte kaeme nie wieder. Ein Jahr ist die Obergrenze fuer die Schule.
EASE_MIN, EASE_MAX = 130, 300
INTERVAL_MAX_DAYS = 365


# Reifegrad einer Karte fuer das Histogramm. Ohne Review-Datensatz oder mit
# reps==0 ist sie neu; sonst staffelt das Intervall (Tage) den Grad.
BUCKETS = ("neu", "lernen", "kurz", "mittel", "lang")


def _bucket(rev) -> str:
    if rev is None or (rev.reps or 0) == 0:
        return "neu"
    d = rev.interval_days or 0
    if d <= 6:
        return "lernen"
    if d <= 20:
        return "kurz"
    if d <= 59:
        return "mittel"
    return "lang"


def _empty_hist() -> dict:
    return {b: 0 for b in BUCKETS}


require_module = modul_pflicht(MODULE_KEY)


async def _owned_class(db, user, class_id) -> SchoolClass:
    r = await db.execute(select(SchoolClass).where(SchoolClass.id == class_id, SchoolClass.owner_id == user.id))
    cls = r.scalar_one_or_none()
    if not cls:
        raise HTTPException(404, "Klasse nicht gefunden")
    return cls


async def _owned_deck(db, user, deck_id) -> CardDeck:
    r = await db.execute(select(CardDeck).where(CardDeck.id == deck_id, CardDeck.owner_id == user.id))
    d = r.scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Stapel nicht gefunden")
    return d


async def _kurs_roster(db, user, class_id, subset_kurs=None):
    """SuS DIESER Fach-Klasse. Karten sind pro Fach getrennt: jede Fach-Klasse
    hat eigene Stapel und eigenen Fortschritt (SuS werden im Kern geteilt, der
    Karten-Fortschritt aber je Fach gefuehrt).

    Mit subset_kurs: der Roster eines Teilkurses (Kurse aus Teilen von Klassen) —
    die einzeln hinzugefügten SuS, auch aus fremden Klassen (dedupliziert)."""
    if subset_kurs is not None:
        from .kurse import member_student_ids
        sids = list(await member_student_ids(db, subset_kurs))
        if not sids:
            return []
        studs = (await db.execute(select(Student).where(Student.id.in_(sids)).order_by(Student.card_id, Student.id))).scalars().all()
        canon = {}
        for s in studs:
            canon.setdefault(s.name.strip(), s)
        return sorted(canon.values(), key=lambda s: (s.card_id, s.id))
    return (await db.execute(select(Student).where(Student.class_id == class_id).order_by(Student.card_id, Student.id))).scalars().all()


async def _kurs_decks_where(cls, kurs_id=None):
    """Stapel hängen am Kurs (Fach). kurs_id gesetzt = die Stapel dieses Kurses,
    PLUS die dieser Klasse ohne Kurszuordnung; sonst nur letztere.

    Der Zusatz ist wichtig: nicht jeder Weg, der einen Stapel anlegt, kennt
    einen Kurs — das "Karten-Deck" zu einem schwachen Thema auf der Startseite
    und die Übernahme aus dem Marktplatz legen ohne kurs_id an. Ohne diesen
    Fallback wäre so ein Stapel angelegt, aber in der Kursansicht unsichtbar.
    Die Trennung zwischen Geschwister-Klassen desselben Kurses bleibt: der
    Fallback ist an die eigene class_id gebunden.
    """
    if kurs_id is not None:
        return or_(CardDeck.kurs_id == kurs_id,
                   and_(CardDeck.class_id == cls.id, CardDeck.kurs_id.is_(None)))
    return and_(CardDeck.class_id == cls.id, CardDeck.kurs_id.is_(None))


async def _class_all_decks_where(db, class_id):
    """Alle Stapel, die zur Klasse gehören: direkt (class_id) ODER über einen Kurs,
    in dem die Klasse liegt. Für Auswahl-Listen (z.B. Kalender-Deck-Verknüpfung),
    die nicht auf einen bestimmten Kurs eingeschränkt sind."""
    from .kurse import class_kurs_ids
    kurse = list(await class_kurs_ids(db, class_id))
    if kurse:
        return or_(CardDeck.kurs_id.in_(kurse), CardDeck.class_id == class_id)
    return CardDeck.class_id == class_id


async def _student_deck_where(db, st):
    """Deck-Filter fuer einen Schueler (oeffentliches Lernen): alle Stapel der
    Kurse (Fächer), in denen seine Klasse liegt, PLUS die Teilkurse, in denen er
    einzeln Mitglied ist (Kurse aus Teilen von Klassen) — plus Klassen-Fallback."""
    from .kurse import class_kurs_ids, student_kurs_ids
    kurse = list(set(await class_kurs_ids(db, st.class_id)) | await student_kurs_ids(db, st.id))
    if kurse:
        return or_(CardDeck.kurs_id.in_(kurse), and_(CardDeck.class_id == st.class_id, CardDeck.kurs_id.is_(None)))
    return and_(CardDeck.class_id == st.class_id, CardDeck.kurs_id.is_(None))


def _niveau_where(st):
    """Niveau-Stapel automatisch verteilen: E-Schueler sehen E- und neutrale
    Stapel, G-Schueler G- und neutrale, ohne Niveau nur neutrale."""
    if st.niveau == "E":
        return CardDeck.niveau.in_(["", "E"])
    if st.niveau == "G":
        return CardDeck.niveau.in_(["", "G"])
    return CardDeck.niveau == ""


def _sichtbar(schueler_niveau: str, *niveaus: str) -> bool:
    """Dieselbe Regel wie die WHERE-Fassungen, nur fuer schon geladene Zeilen.

    Ein Kind sieht neutrale Karten/Stapel und die seines eigenen Niveaus. Wird
    in der Lehrkraft-Uebersicht gebraucht, wo eine einzige Abfrage fuer die
    ganze Klasse laeuft und je Kind gefiltert werden muss.
    """
    erlaubt = {"", schueler_niveau} if schueler_niveau in ("E", "G") else {""}
    return all((n or "") in erlaubt for n in niveaus)


def _karten_niveau_where(st):
    """Dasselbe eine Ebene tiefer: einzelne Karten koennen E oder G tragen.

    Warum beides: ein reiner E-Stapel ist die eine Arbeitsweise, ein gemeinsamer
    Stapel mit ein paar E-Karten die andere. Wer nur das Stapel-Niveau haette,
    muesste jeden gemischten Satz doppelt pflegen.

    Die Regel ist dieselbe wie oben und dieselbe wie bei CardVote: neutrale
    Karten sehen alle, Niveau-Karten nur das eigene Niveau. Ein Kind ohne
    hinterlegtes Niveau bekommt die neutralen — nie stillschweigend die eines
    fremden Niveaus.
    """
    if st.niveau == "E":
        return Card.niveau.in_(["", "E"])
    if st.niveau == "G":
        return Card.niveau.in_(["", "G"])
    return Card.niveau == ""


# ─── Lehrkraft: Stapel & Karten ───

class DeckIn(BaseModel):
    name: str = ""
    topic_id: Optional[int] = None
    niveau: str = ""  # "" = alle, "E"/"G" = nur dieses Niveau
    folder_id: Optional[int] = None  # Ordner (wie CardVote); NULL = Wurzel


class CardOut(BaseModel):
    id: int
    front: str
    back: str
    position: int
    niveau: str = ""      # "" = fuer alle, "E"/"G" = nur dieses Niveau
    has_front_image: bool = False
    has_back_image: bool = False
    model_config = {"from_attributes": True}


class DeckOut(BaseModel):
    id: int
    class_id: int
    kurs_id: Optional[int] = None   # Stapel hängen am Kurs — für Deep-Link aus dem Kalender
    name: str
    topic_id: Optional[int] = None
    niveau: str = ""
    folder_id: Optional[int] = None
    released_at: Optional[datetime] = None
    cards: List[CardOut] = []
    model_config = {"from_attributes": True}


def _deck_out(deck) -> "DeckOut":
    """DeckOut mit gefilterten Karten: gelöschte (deleted_at) bleiben draußen. Das
    Relationship trägt delete-orphan — hier NICHT anfassen, nur beim Ausgeben filtern."""
    return DeckOut(
        id=deck.id, class_id=deck.class_id, kurs_id=deck.kurs_id, name=deck.name,
        topic_id=deck.topic_id, niveau=deck.niveau, folder_id=deck.folder_id,
        released_at=deck.released_at,
        cards=[CardOut.model_validate(c) for c in deck.cards if c.deleted_at is None],
    )


# ─── Ordner (wie CardVote) zum Gruppieren der Stapel ───

class CardFolderIn(BaseModel):
    name: str = ""
    parent_id: Optional[int] = None


class CardFolderOut(BaseModel):
    id: int
    name: str
    parent_id: Optional[int] = None
    model_config = {"from_attributes": True}


async def _owned_card_folder(db, user, folder_id):
    f = await db.get(CardFolder, folder_id)
    if not f or f.owner_id != user.id:
        raise HTTPException(404, "Ordner nicht gefunden")
    return f


def _folder_scope(class_id, kurs_id):
    """Ordner hängen wie die Stapel am KURS (alle Fach-Klassen); ohne Kurs an der
    Klasse. So passen Ordner und Decks zusammen."""
    if kurs_id is not None:
        return [CardFolder.kurs_id == kurs_id]
    return [CardFolder.class_id == class_id, CardFolder.kurs_id.is_(None)]


@router.get("/classes/{class_id}/card-folders", response_model=List[CardFolderOut])
async def list_card_folders(class_id: int, kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    rows = (await db.execute(select(CardFolder).where(CardFolder.owner_id == user.id, *_folder_scope(class_id, kurs_id)).order_by(CardFolder.name))).scalars().all()
    return rows


@router.post("/classes/{class_id}/card-folders", response_model=CardFolderOut, status_code=201)
async def create_card_folder(class_id: int, body: CardFolderIn, kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    f = CardFolder(owner_id=user.id, class_id=class_id, kurs_id=kurs_id, name=body.name.strip(), parent_id=body.parent_id)
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return f


@router.put("/card-folders/{folder_id}", response_model=CardFolderOut)
async def update_card_folder(folder_id: int, body: CardFolderIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    f = await _owned_card_folder(db, user, folder_id)
    f.name = body.name.strip()
    f.parent_id = body.parent_id
    await db.commit()
    await db.refresh(f)
    return f


@router.delete("/card-folders/{folder_id}", status_code=204)
async def delete_card_folder(folder_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Ordner löschen: DB kaskadiert Unterordner (parent_id CASCADE); die Stapel
    darin wandern in die Wurzel (deck.folder_id SET NULL). Stapel bleiben also."""
    await _owned_card_folder(db, user, folder_id)
    await db.execute(sql_delete(CardFolder).where(CardFolder.id == folder_id))
    await db.commit()


@router.get("/classes/{class_id}/decks", response_model=List[DeckOut])
async def list_decks(class_id: int, kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    cls = await _owned_class(db, user, class_id)
    from sqlalchemy.orm import selectinload
    r = await db.execute(
        select(CardDeck).where(CardDeck.owner_id == user.id, await _kurs_decks_where(cls, kurs_id), CardDeck.deleted_at.is_(None))
        .options(selectinload(CardDeck.cards)).order_by(CardDeck.position, CardDeck.id)
    )
    return [_deck_out(d) for d in r.scalars().all()]


@router.get("/classes/{class_id}/all-decks", response_model=List[DeckOut])
async def list_all_decks(class_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Alle Stapel der Klasse (kursübergreifend) — für die Kalender-Deck-Auswahl,
    damit auch Kurs-Stapel erscheinen (nicht nur die ohne Kurs)."""
    await _owned_class(db, user, class_id)
    from sqlalchemy.orm import selectinload
    r = await db.execute(
        select(CardDeck).where(CardDeck.owner_id == user.id, await _class_all_decks_where(db, class_id), CardDeck.deleted_at.is_(None))
        .options(selectinload(CardDeck.cards)).order_by(CardDeck.position, CardDeck.id)
    )
    return [_deck_out(d) for d in r.scalars().all()]


@router.get("/classes/{class_id}/decks/trash", response_model=List[DeckOut])
async def list_deck_trash(class_id: int, kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Gelöschte Decks des Kurses (30 Tage wiederherstellbar)."""
    cls = await _owned_class(db, user, class_id)
    from sqlalchemy.orm import selectinload
    r = await db.execute(
        select(CardDeck).where(CardDeck.owner_id == user.id, await _kurs_decks_where(cls, kurs_id), CardDeck.deleted_at.is_not(None))
        .options(selectinload(CardDeck.cards)).order_by(CardDeck.deleted_at.desc())
    )
    return [_deck_out(d) for d in r.scalars().all()]


async def _schedule_deck_from_calendar(db: AsyncSession, user: User, deck: CardDeck) -> None:
    """Gegenstück zu _release_matching_decks (kalender.py): plant/verknüpft ein
    neu angelegtes oder frisch mit Thema versehenes Deck mit einem bereits
    vorhandenen Kalender-Eintrag desselben Themas. Ohne das blieb ein Deck, das
    NACH dem Eintrag angelegt wird, unausgerollt (der Eintrag hat es nie gesehen).
    Nur Entwürfe (released_at NULL), nur bei aktivem Kalender-Modul (Regel 3)."""
    if deck.topic_id is None or deck.released_at is not None:
        return
    if not await is_active(db, user.id, "kalender"):
        return
    from ..models import CalendarEntry
    from .kurse import class_kurs_ids
    entries = (await db.execute(
        select(CalendarEntry).where(CalendarEntry.owner_id == user.id, CalendarEntry.topic_id == deck.topic_id)
        .order_by(CalendarEntry.date)
    )).scalars().all()
    for e in entries:
        if e.class_id is None:
            continue
        kurse = await class_kurs_ids(db, e.class_id)
        if e.class_id == deck.class_id or (deck.kurs_id is not None and deck.kurs_id in kurse):
            deck.released_at = _tagesbeginn(e.date)  # ab Beginn des Termintags (frühester Eintrag)
            if not e.karten_deck_id:
                e.karten_deck_id = deck.id       # Eintrag auf dieses Deck verlinken
            await db.commit()
            return


@router.post("/classes/{class_id}/decks", response_model=DeckOut, status_code=201)
async def create_deck(class_id: int, body: DeckIn, kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("karten_deck", f"u{user.id}", 100, 60, "Zu viele Stapel. Bitte kurz warten.")
    await _owned_class(db, user, class_id)  # nur die Zugriffsprüfung, wirft bei fremder Klasse
    last = (await db.execute(select(CardDeck.position).where(CardDeck.class_id == class_id).order_by(CardDeck.position.desc()))).scalars().first()
    deck = CardDeck(class_id=class_id, kurs_id=kurs_id, owner_id=user.id, name=body.name.strip(),
                    topic_id=body.topic_id, niveau=body.niveau if body.niveau in ("E", "G") else "",
                    folder_id=body.folder_id, position=(last if last is not None else -1) + 1)
    db.add(deck)
    await db.commit()
    await db.refresh(deck, ["cards"])
    await _schedule_deck_from_calendar(db, user, deck)
    return deck


class DeckReorderIn(BaseModel):
    ids: List[int]


@router.put("/classes/{class_id}/decks/reorder", status_code=204)
async def reorder_decks(class_id: int, body: DeckReorderIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Reihenfolge der Stapel der Klasse anhand der ID-Liste setzen (nur eigene)."""
    await _owned_class(db, user, class_id)
    rows = (await db.execute(select(CardDeck).where(CardDeck.class_id == class_id, CardDeck.owner_id == user.id))).scalars().all()
    by_id = {d.id: d for d in rows}
    pos = 0
    for did in body.ids:
        d = by_id.get(did)
        if d is not None:
            d.position = pos
            pos += 1
    await db.commit()


@router.put("/decks/{deck_id}", response_model=DeckOut)
async def update_deck(deck_id: int, body: DeckIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Name und/oder Thema des Stapels aendern."""
    deck = await _owned_deck(db, user, deck_id)
    deck.name = body.name.strip()
    deck.topic_id = body.topic_id
    deck.niveau = body.niveau if body.niveau in ("E", "G") else ""
    deck.folder_id = body.folder_id
    await db.commit()
    await db.refresh(deck, ["cards"])
    await _schedule_deck_from_calendar(db, user, deck)
    return deck


@router.delete("/decks/{deck_id}", status_code=204)
async def delete_deck(deck_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Soft-Delete: in den Papierkorb (30 Tage). Karten-Fortschritt bleibt."""
    deck = await _owned_deck(db, user, deck_id)
    deck.deleted_at = _now()
    await db.commit()


@router.post("/decks/{deck_id}/restore", response_model=DeckOut)
async def restore_deck(deck_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    deck = await _owned_deck(db, user, deck_id)
    deck.deleted_at = None
    await db.commit()
    await db.refresh(deck, ["cards"])
    return deck


@router.delete("/decks/{deck_id}/purge", status_code=204)
async def purge_deck(deck_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Endgültig löschen (aus dem Papierkorb). Erst hier greift die Kaskade."""
    deck = await _owned_deck(db, user, deck_id)
    if deck.deleted_at is None:
        raise HTTPException(400, "Deck ist nicht im Papierkorb")
    await db.delete(deck)
    await db.commit()


class ReleaseIn(BaseModel):
    # now=True: sofort ausrollen. released_at gesetzt: geplant. Beides leer:
    # zurueckziehen (wieder Entwurf, fuer SuS unsichtbar).
    now: bool = False
    released_at: Optional[datetime] = None


@router.post("/decks/{deck_id}/release", response_model=DeckOut)
async def release_deck(deck_id: int, body: ReleaseIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    deck = await _owned_deck(db, user, deck_id)
    if body.now:
        deck.released_at = _now()
    elif body.released_at is not None:
        at = body.released_at
        if at.tzinfo is None:
            at = at.replace(tzinfo=timezone.utc)
        deck.released_at = at
    else:
        deck.released_at = None  # zurueckziehen
    await db.commit()
    await db.refresh(deck, ["cards"])
    return deck


class CardIn(BaseModel):
    front: str
    back: str
    niveau: str = ""

    @field_validator("front", "back")
    @classmethod
    def not_too_long(cls, v: str) -> str:
        if len(v) > 5000:
            raise ValueError("Text zu lang")
        return v

    @field_validator("niveau")
    @classmethod
    def niveau_ok(cls, v: str) -> str:
        # Stillschweigend auf "" zurueckfallen statt 422: ein unbekannter Wert
        # soll eine Karte nicht unsichtbar machen, sondern sie allen zeigen.
        return v if v in ("E", "G") else ""


@router.post("/decks/{deck_id}/cards", response_model=CardOut, status_code=201)
async def add_card(deck_id: int, body: CardIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("karten_card", f"u{user.id}", 600, 60, "Zu viele Karten. Bitte kurz warten.")
    await _owned_deck(db, user, deck_id)
    last = (await db.execute(select(Card.position).where(Card.deck_id == deck_id).order_by(Card.position.desc()))).scalars().first()
    card = Card(deck_id=deck_id, front=body.front.strip(), back=body.back.strip(),
                niveau=body.niveau, position=(last if last is not None else -1) + 1)
    db.add(card)
    await db.commit()
    await db.refresh(card)
    return card


class CardReorderIn(BaseModel):
    ids: List[int]


@router.put("/decks/{deck_id}/cards/reorder", status_code=204)
async def reorder_cards(deck_id: int, body: CardReorderIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Setzt die Reihenfolge der Karten im Stapel anhand der ID-Liste."""
    await _owned_deck(db, user, deck_id)
    rows = (await db.execute(select(Card).where(Card.deck_id == deck_id))).scalars().all()
    by_id = {c.id: c for c in rows}
    pos = 0
    for cid in body.ids:
        c = by_id.get(cid)
        if c is not None:
            c.position = pos
            pos += 1
    await db.commit()


class ImportIn(BaseModel):
    # Karten aus CSV/TSV oder Anki-Text-Export. Client parst, schickt Paare.
    cards: List[CardIn]


@router.post("/decks/{deck_id}/import")
async def import_cards(deck_id: int, body: ImportIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Mehrere Karten auf einmal anhaengen (CSV/Anki-Import)."""
    rate_limit("karten_import", f"u{user.id}", 20, 60, "Zu viele Importe. Bitte kurz warten.")
    await _owned_deck(db, user, deck_id)
    paare = [(c.front.strip(), c.back.strip(), c.niveau) for c in body.cards if c.front.strip() or c.back.strip()]
    if not paare:
        return {"added": 0}
    if len(paare) > 2000:
        raise HTTPException(400, "Zu viele Karten auf einmal (max. 2000)")
    last = (await db.execute(select(Card.position).where(Card.deck_id == deck_id).order_by(Card.position.desc()))).scalars().first()
    pos = (last if last is not None else -1) + 1
    for front, back, niveau in paare:
        db.add(Card(deck_id=deck_id, front=front, back=back, niveau=niveau, position=pos))
        pos += 1
    await db.commit()
    return {"added": len(paare)}


@router.put("/cards/{card_id}", response_model=CardOut)
async def update_card(card_id: int, body: CardIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    card = await db.get(Card, card_id)
    if not card:
        raise HTTPException(404, "Karte nicht gefunden")
    await _owned_deck(db, user, card.deck_id)
    card.front = body.front.strip()
    card.back = body.back.strip()
    card.niveau = body.niveau
    await db.commit()
    await db.refresh(card)
    return card


@router.delete("/cards/{card_id}", status_code=204)
async def delete_card(card_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Soft-Delete: die Karte wandert in den Papierkorb des Stapels."""
    card = await db.get(Card, card_id)
    if not card:
        raise HTTPException(404, "Karte nicht gefunden")
    await _owned_deck(db, user, card.deck_id)
    card.deleted_at = _now()
    await db.commit()


@router.get("/decks/{deck_id}/cards/trash", response_model=List[CardOut])
async def list_card_trash(deck_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Gelöschte Karten des Stapels (wiederherstellbar)."""
    await _owned_deck(db, user, deck_id)
    rows = (await db.execute(select(Card).where(Card.deck_id == deck_id, Card.deleted_at.is_not(None)).order_by(Card.deleted_at.desc()))).scalars().all()
    return rows


@router.post("/cards/{card_id}/restore", response_model=CardOut)
async def restore_card(card_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    card = await db.get(Card, card_id)
    if not card:
        raise HTTPException(404, "Karte nicht gefunden")
    await _owned_deck(db, user, card.deck_id)
    card.deleted_at = None
    await db.commit()
    await db.refresh(card)
    return card


@router.delete("/cards/{card_id}/purge", status_code=204)
async def purge_card(card_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Endgültig löschen (aus dem Papierkorb)."""
    card = await db.get(Card, card_id)
    if not card:
        raise HTTPException(404, "Karte nicht gefunden")
    await _owned_deck(db, user, card.deck_id)
    await db.delete(card)
    await db.commit()


# ─── Karten-Bilder (je Seite oben-zentral). Blob deferred; Ausspielung eigener Endpoint. ───
_CARD_IMG_MAX = 5 * 1024 * 1024  # 5 MB je Bild


def _side_cols(side: str):
    if side == "front":
        return Card.front_image, Card.front_image_mime
    if side == "back":
        return Card.back_image, Card.back_image_mime
    raise HTTPException(400, "Seite muss front oder back sein")


async def _serve_card_image(db: AsyncSession, card_id: int, side: str) -> Response:
    blob_col, mime_col = _side_cols(side)
    row = (await db.execute(select(blob_col, mime_col).where(Card.id == card_id))).first()
    if not row or not row[0]:
        raise HTTPException(404, "Kein Bild")
    # Privat, aber cachebar im Browser (unveraenderlich pro Karte/Seite bis Neu-Upload).
    return Response(content=row[0], media_type=row[1] or "image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


@router.post("/cards/{card_id}/image/{side}", response_model=CardOut)
async def upload_card_image(card_id: int, side: str, file: UploadFile = File(...),
                            user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("karten_img", f"u{user.id}", 120, 60, "Zu viele Uploads. Bitte kurz warten.")
    _side_cols(side)  # validiert die Seite
    card = await db.get(Card, card_id)
    if not card:
        raise HTTPException(404, "Karte nicht gefunden")
    await _owned_deck(db, user, card.deck_id)
    data = await file.read()
    if not data:
        raise HTTPException(400, "Datei ist leer")
    if len(data) > _CARD_IMG_MAX:
        raise HTTPException(413, "Bild zu groß (max. 5 MB)")
    # Typ am Inhalt bestimmen, nicht am Client glauben: die Kartenbilder liefert
    # /lernen/<token> OHNE Anmeldung aus (karten.py: _serve_card_image).
    setattr(card, f"{side}_image", data)
    setattr(card, f"{side}_image_mime", bildtyp(data))
    await db.commit()
    await db.refresh(card)
    return card


@router.delete("/cards/{card_id}/image/{side}", response_model=CardOut)
async def delete_card_image(card_id: int, side: str, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    _side_cols(side)
    card = await db.get(Card, card_id)
    if not card:
        raise HTTPException(404, "Karte nicht gefunden")
    await _owned_deck(db, user, card.deck_id)
    setattr(card, f"{side}_image", None)
    setattr(card, f"{side}_image_mime", "")
    await db.commit()
    await db.refresh(card)
    return card


@router.get("/cards/{card_id}/image/{side}")
async def get_card_image(card_id: int, side: str, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Bild einer eigenen Karte (Lehrkraft, mit Login)."""
    card = await db.get(Card, card_id)
    if not card:
        raise HTTPException(404, "Karte nicht gefunden")
    await _owned_deck(db, user, card.deck_id)
    return await _serve_card_image(db, card_id, side)


@router.get("/lernen/{token}/image/{card_id}/{side}")
async def student_card_image(token: str, card_id: int, side: str, db: AsyncSession = Depends(get_db)):
    """Bild einer Karte für die/den Lernende(n) — Token statt Login. Nur Karten
    aus ausgerollten Stapeln, die dieser Token sehen darf."""
    st = await _student_by_token(db, token)
    now = _now()
    dw = await _student_deck_where(db, st)
    ok = (await db.execute(
        select(Card.id).join(CardDeck, Card.deck_id == CardDeck.id).where(
            Card.id == card_id, dw, _niveau_where(st), _karten_niveau_where(st), Card.deleted_at.is_(None),
            CardDeck.released_at.is_not(None), CardDeck.deleted_at.is_(None), CardDeck.released_at <= now,
        )
    )).scalar_one_or_none()
    if not ok:
        raise HTTPException(404, "Karte nicht gefunden")
    return await _serve_card_image(db, card_id, side)


# ─── Tokens & QR ───

class StudentTokenOut(BaseModel):
    student_id: int
    name: str
    card_id: int
    token: str


@router.post("/classes/{class_id}/tokens", response_model=List[StudentTokenOut])
async def ensure_tokens(class_id: int, subset_kurs: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Erzeugt fehlende Schueler-Tokens fuer den Kurs (idempotent, je Person einer)."""
    await _owned_class(db, user, class_id)
    if subset_kurs is not None:
        from .kurse import _owned_kurs
        await _owned_kurs(db, user, subset_kurs)
    students = await _kurs_roster(db, user, class_id, subset_kurs)
    out = []
    changed = False
    for st in students:
        if not st.karten_token:
            st.karten_token = _token()
            changed = True
        out.append(StudentTokenOut(student_id=st.id, name=st.name, card_id=st.card_id, token=st.karten_token))
    if changed:
        await db.commit()
    return out


@kern_router.get("/classes/{class_id}/zugaenge.pdf")
async def zugaenge_pdf(class_id: int, base: str = "", subset_kurs: Optional[int] = None,
                       user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Zettel zum Ausschneiden: je Kind Name, QR-Code und der Link als Text.

    Am Kern-Router und nicht am Kartenmodul: der Zugang fuehrt zu den Karten
    ODER zu den Testergebnissen — er gilt, solange EINES der beiden Module
    laeuft. Ohne beide gibt es hier nichts (409 mit Grund statt eines leeren
    Blattes, das man erst ausdruckt und dann versteht).

    Der Link steht zusaetzlich im Klartext darunter: wer den QR nicht scannen
    kann (kein Handy, kaputte Kamera), tippt ihn ab.
    """
    from io import BytesIO
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas as pdf_canvas
    from .modules import is_active

    karten_an = await is_active(db, user.id, "karten")
    cardvote_an = await is_active(db, user.id, "cardvote")
    if not (karten_an or cardvote_an):
        raise HTTPException(409, "Weder Karteikarten noch CardVote sind aktiv — es gibt nichts, wohin ein Code führen könnte.")

    cls = await _owned_class(db, user, class_id)
    students = await _kurs_roster(db, user, class_id, subset_kurs)
    # Fehlende Tokens hier erzeugen: wer drucken will, hat sonst leere Zettel.
    changed = False
    for st in students:
        if not st.karten_token:
            st.karten_token = _token()
            changed = True
    if changed:
        await db.commit()

    basis = (base or "").rstrip("/")
    if basis and not (basis.startswith("http://") or basis.startswith("https://")):
        basis = ""

    puffer = BytesIO()
    c = pdf_canvas.Canvas(puffer, pagesize=A4)
    breite, hoehe = A4
    spalten, zeilen = 2, 4                      # acht Zettel je Seite
    feld_b, feld_h = breite / spalten, (hoehe - 20 * mm) / zeilen

    for i, st in enumerate(students):
        platz = i % (spalten * zeilen)
        if i and platz == 0:
            c.showPage()
        sp, ze = platz % spalten, platz // spalten
        x0 = sp * feld_b
        y0 = hoehe - 15 * mm - (ze + 1) * feld_h

        # Schnittkante andeuten — der Zettel wird ausgeschnitten und verteilt.
        c.setStrokeColorRGB(0.85, 0.85, 0.85)
        c.rect(x0 + 5 * mm, y0 + 4 * mm, feld_b - 10 * mm, feld_h - 8 * mm)

        c.setFillColorRGB(0, 0, 0)
        c.setFont("Helvetica-Bold", 13)
        c.drawString(x0 + 12 * mm, y0 + feld_h - 14 * mm, st.name or "")
        c.setFont("Helvetica", 9)
        c.drawString(x0 + 12 * mm, y0 + feld_h - 20 * mm, f"{cls.name} · Nr. {st.card_id}")

        url = f"{basis}/lernen/{st.karten_token}"
        bild = qrcode.make(url)
        roh = io.BytesIO()
        bild.save(roh, format="PNG")
        roh.seek(0)
        seite = min(feld_b - 24 * mm, feld_h - 34 * mm)
        c.drawImage(ImageReader(roh), x0 + 12 * mm, y0 + 12 * mm, width=seite, height=seite)

        # Link klein darunter, umbrochen — er ist lang und muss abtippbar sein.
        c.setFont("Helvetica", 6.5)
        rest = url
        zeile_y = y0 + 9 * mm
        while rest:
            stueck, rest = rest[:58], rest[58:]
            c.drawString(x0 + 12 * mm, zeile_y, stueck)
            zeile_y -= 3 * mm

    c.showPage()
    c.save()
    name = f"Zugaenge_{(cls.name or 'Klasse').replace(' ', '_')}.pdf"
    return Response(content=puffer.getvalue(), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ─── Lehrkraft: Fortschritt ───

class StudentProgress(BaseModel):
    student_id: int
    name: str
    reviewed: int   # wie viele Karten schon einmal gelernt
    due: int        # wie viele heute faellig
    total: int      # Karten in ausgerollten Stapeln
    hist: dict      # Reifegrad-Verteilung (neu/lernen/kurz/mittel/lang)
    last_reviewed: Optional[datetime] = None  # wann zuletzt gelernt


@router.post("/classes/{class_id}/tokens/rotate", response_model=List[StudentTokenOut])
async def rotate_tokens(class_id: int, student_id: Optional[int] = None, subset_kurs: Optional[int] = None,
                        user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Zugangs-Links neu vergeben — fuer die ganze Klasse oder eine Person.

    Der Link enthaelt den Token; wer ihn weitergibt (Klassenchat, Screenshot),
    gibt dauerhaft Einblick in Lernstand und Testergebnisse dieses Kindes. Ohne
    Rotation gaebe es keinen Weg zurueck. Alte Links werden damit sofort
    ungueltig, QR-Codes muessen neu ausgegeben werden.
    """
    rate_limit("karten_tokens", f"u{user.id}", 30, 60, "Zu viele Änderungen. Bitte kurz warten.")
    await _owned_class(db, user, class_id)
    students = await _kurs_roster(db, user, class_id, subset_kurs)
    if student_id is not None:
        students = [s for s in students if s.id == student_id]
        if not students:
            raise HTTPException(404, "Schüler nicht in dieser Klasse")
    out = []
    for st in students:
        st.karten_token = _token()
        out.append(StudentTokenOut(student_id=st.id, name=st.name, card_id=st.card_id, token=st.karten_token))
    await db.commit()
    return out


@router.get("/classes/{class_id}/progress", response_model=List[StudentProgress])
async def progress(class_id: int, kurs_id: Optional[int] = None, subset_kurs: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    cls = await _owned_class(db, user, class_id)
    if subset_kurs is not None:
        from .kurse import _owned_kurs
        await _owned_kurs(db, user, subset_kurs)
    if kurs_id is not None:
        from .kurse import _owned_kurs
        await _owned_kurs(db, user, kurs_id)   # kurs_id kommt aus der URL: erst pruefen, wem er gehoert
    students = await _kurs_roster(db, user, class_id, subset_kurs)
    now = _now()
    # Nur ausgerollte Stapel zaehlen — Entwuerfe verzerren den Fortschritt nicht.
    deck_ids = (await db.execute(select(CardDeck.id).where(
        CardDeck.owner_id == user.id,
        await _kurs_decks_where(cls, kurs_id),
        CardDeck.released_at.is_not(None), CardDeck.deleted_at.is_(None),
        CardDeck.released_at <= now,
    ))).scalars().all()
    karten = []   # (card_id, Karten-Niveau, Stapel-Niveau)
    if deck_ids:
        # Geloeschte Karten zaehlen nicht mit: sonst sinkt „total" nie wieder, und
        # weil eine geloeschte Karte nie gelernt wird, blieb sie fuer immer
        # „faellig" — die Lehrkraft sah dauerhaft offene Karten, die es nicht gibt.
        #
        # Die Niveaus kommen mit, weil „total" NICHT mehr fuer alle gleich ist:
        # ein G-Kind hat die E-Karten nie zu sehen bekommen, und eine Uebersicht,
        # die sie ihm trotzdem als offen anrechnet, meldet dauerhaft Rueckstand,
        # den es gar nicht aufholen kann. Das galt schon fuer Niveau-STAPEL und
        # wurde hier bisher nicht beachtet.
        karten = (await db.execute(
            select(Card.id, Card.niveau, CardDeck.niveau)
            .join(CardDeck, Card.deck_id == CardDeck.id)
            .where(Card.deck_id.in_(deck_ids), Card.deleted_at.is_(None))
        )).all()
    out = []
    for st in students:
        card_ids = [cid for cid, kn, dn in karten if _sichtbar(st.niveau or "", kn, dn)]
        total = len(card_ids)
        reviews = {r.card_id: r for r in (await db.execute(select(CardReview).where(CardReview.student_id == st.id))).scalars().all()}
        hist = _empty_hist()
        due = 0
        reviewed = 0
        last = None
        for cid in card_ids:
            rev = reviews.get(cid)
            hist[_bucket(rev)] += 1
            if rev is not None and (rev.reps or 0) > 0:
                reviewed += 1
            if rev is not None and rev.last_reviewed and (last is None or _utc(rev.last_reviewed) > last):
                last = _utc(rev.last_reviewed)
            if rev is None or _utc(rev.due) <= now:
                due += 1
        out.append(StudentProgress(
            student_id=st.id, name=st.name,
            reviewed=reviewed, due=due, total=total, hist=hist, last_reviewed=last,
        ))
    return out


class CardStat(BaseModel):
    card_id: int
    front: str
    deck: str
    bucket: str            # neu/lernen/kurz/mittel/lang
    reps: int
    lapses: int
    interval_days: int
    due: Optional[datetime]
    last_reviewed: Optional[datetime]


@router.get("/classes/{class_id}/students/{student_id}/cards", response_model=List[CardStat])
async def student_cards(class_id: int, student_id: int, kurs_id: Optional[int] = None, subset_kurs: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Detailstatistik je Karte fuer einen Schueler — nur ausgerollte Stapel."""
    cls = await _owned_class(db, user, class_id)
    st = await db.get(Student, student_id)
    if not st:
        raise HTTPException(404, "Schüler nicht gefunden")
    if subset_kurs is not None:
        from .kurse import member_student_ids, _owned_kurs
        await _owned_kurs(db, user, subset_kurs)
        if student_id not in await member_student_ids(db, subset_kurs):
            raise HTTPException(404, "Schüler nicht in diesem Teilkurs")
    elif st.class_id != class_id:
        raise HTTPException(404, "Schüler nicht in dieser Klasse")
    if kurs_id is not None:
        from .kurse import _owned_kurs
        await _owned_kurs(db, user, kurs_id)   # sonst liest ein fremder Kurs Stapelnamen + Kartentexte aus
    now = _now()
    _dl = (await db.execute(select(CardDeck).where(
        CardDeck.owner_id == user.id,
        await _kurs_decks_where(cls, kurs_id), CardDeck.released_at.is_not(None), CardDeck.deleted_at.is_(None), CardDeck.released_at <= now,
    ))).scalars().all()
    decks = {d.id: d.name for d in _dl}
    deck_niveaus = {d.id: d.niveau or "" for d in _dl}
    if not decks:
        return []
    # Genau die Karten, die dieses Kind auch bekommt (Stapel- UND Kartenniveau) —
    # sonst steht in der Detailsicht eine Karte, die es nie gesehen hat.
    cards = [c for c in (await db.execute(select(Card).where(
        Card.deck_id.in_(decks.keys()), Card.deleted_at.is_(None),
    ).order_by(Card.deck_id, Card.position))).scalars().all()
        if _sichtbar(st.niveau or "", c.niveau, deck_niveaus.get(c.deck_id, ""))]
    reviews = {r.card_id: r for r in (await db.execute(select(CardReview).where(CardReview.student_id == student_id))).scalars().all()}
    out = []
    for c in cards:
        rev = reviews.get(c.id)
        out.append(CardStat(
            card_id=c.id, front=c.front, deck=decks.get(c.deck_id, ""),
            bucket=_bucket(rev),
            reps=rev.reps if rev else 0,
            lapses=rev.lapses if rev else 0,
            interval_days=rev.interval_days if rev else 0,
            due=rev.due if rev else None,
            last_reviewed=rev.last_reviewed if rev else None,
        ))
    return out


# ─── Schueler: Token-Zugang (KEIN Login) ───

async def _student_by_token(db: AsyncSession, token: str, modul="karten") -> Student:
    """Kind zu einem ausgeteilten Token — mit allen Gruenden, warum ein Zugang
    NICHT mehr gilt.

    Ein QR-Code ist ausgedruckt und im Umlauf; er laesst sich nicht einsammeln.
    Also muss der Server bei jedem Aufruf pruefen, ob er noch etwas herausgeben
    darf. Drei Faelle beenden den Zugang:

      * Token unbekannt (auch: rotiert — dann ist der alte Ausdruck tot),
      * Klasse im Papierkorb oder archiviert (Schuljahr vorbei),
      * das Modul ist abgeschaltet.

    Der letzte Fall ist der wichtigste und fehlte: wer Karteikarten abschaltet,
    erwartet, dass ueber die verteilten Links nichts mehr zu sehen ist. Ohne
    diese Pruefung lieferten sie weiter Kartentexte und Lernstand aus.
    """
    from .modules import is_active

    if not token:
        raise HTTPException(401, "Kein Token")
    r = await db.execute(select(Student).where(Student.karten_token == token))
    st = r.scalar_one_or_none()
    if not st:
        raise HTTPException(401, "Ungültiger Token")
    cls = await db.get(SchoolClass, st.class_id)
    if cls is not None and (cls.deleted_at is not None or cls.archived_at is not None):
        raise HTTPException(401, "Zugang nicht mehr gültig")
    # `modul` ist ein Schluessel oder mehrere: dann reicht EINES davon. Der
    # QR-Code selbst gilt naemlich, solange ueberhaupt etwas dahinter steht —
    # Karten ODER Testergebnisse.
    schluessel = (modul,) if isinstance(modul, str) else tuple(modul or ())
    if cls is not None and cls.owner_id and schluessel:
        erlaubt = [k for k in schluessel if await is_active(db, cls.owner_id, k)]
        if not erlaubt:
            # Bewusst dieselbe Meldung wie bei einem toten Token: nach aussen
            # soll nicht erkennbar sein, welche Module eine Lehrkraft nutzt.
            raise HTTPException(401, "Zugang nicht mehr gültig")
    return st


class StudentCard(BaseModel):
    card_id: int
    front: str
    back: str


@router.get("/qr/{token}.png")
async def qr_png(token: str, base: str = "", db: AsyncSession = Depends(get_db)):
    """QR eines Lern-Links. Kein Login: der Token im Link ist ohnehin das
    Secret, die Lehrkraft haelt ihn bereits. base = origin des Rahmens."""
    # Der Code gilt, solange EINES der beiden Module laeuft: mit Karten fuehrt er
    # zum Ueben, ohne sie zu den Testergebnissen. Erst wenn beide aus sind, ist
    # er tot — und dann verschwindet er auch aus der Klassenansicht.
    st = await _student_by_token(db, token, modul=("karten", "cardvote"))
    # Nur die eigene Origin zulassen, kein offener QR-Generator.
    base = base.rstrip("/")
    if base and not (base.startswith("http://") or base.startswith("https://")):
        base = ""
    url = f"{base}/lernen/{st.karten_token}"
    img = qrcode.make(url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


@router.get("/lernen/{token}/results")
async def student_results(token: str, db: AsyncSession = Depends(get_db)):
    """Oeffentlich (Token statt Login): die CardVote-Testergebnisse dieses
    Schuelers — je Session sein Punktestand. Nur Sessions, an denen er
    teilgenommen hat (mindestens ein Scan). Newest first."""
    # Testergebnisse gehoeren CardVote — sie bleiben also erreichbar, wenn nur
    # das Kartenmodul abgeschaltet ist, und verschwinden mit CardVote.
    st = await _student_by_token(db, token, modul="cardvote")
    sessions = (await db.execute(
        select(Session).where(Session.class_id == st.class_id).order_by(Session.created_at.desc())
    )).scalars().all()
    out = []
    for sess in sessions:
        if not sess.question_set_id:
            continue
        items = (await db.execute(
            select(QuestionSetItem).options(selectinload(QuestionSetItem.question))
            .where(QuestionSetItem.question_set_id == sess.question_set_id)
        )).scalars().all()
        qmap = sess.question_map or {}
        # Alle Scans der Session: nur die TATSAECHLICH gestellten Fragen zaehlen
        # (eine Live-Session laeuft oft nur ueber einen Teil des Fragesets).
        alle = (await db.execute(select(Scan).where(Scan.session_id == sess.id))).scalars().all()
        gestellt = {s.question_id for s in alle}
        if not gestellt:
            continue
        eigene = {s.question_id: s.answer for s in alle if s.student_id == st.card_id}
        if not eigene:
            continue  # nicht teilgenommen
        score = 0
        total = 0
        for it in items:
            q = it.question
            correct = qmap.get(str(q.id), q.correct_answer)
            if not correct or q.id not in gestellt:
                continue
            total += 1
            ans = eigene.get(q.id)
            if ans is not None and ans in correct:
                score += 1
        out.append({
            "name": sess.name or "Test",
            "date": sess.created_at.isoformat() if sess.created_at else None,
            "score": score, "total": total,
            "pct": round(score / total * 100) if total else 0,
        })
    return out


@router.get("/lernen/{token}")
async def student_session(token: str, all: bool = False, db: AsyncSession = Depends(get_db)):
    """Faellige Karten fuer diesen Schueler. Token statt Login.
    all=True: alle Karten (freiwilliges Weiteruben, auch nicht faellige)."""
    st = await _student_by_token(db, token)
    now = _now()
    dw = await _student_deck_where(db, st)
    # Nur ausgerollte Stapel: Entwuerfe (released_at NULL) und geplante in der
    # Zukunft bleiben fuer SuS unsichtbar.
    decks = (await db.execute(select(CardDeck.id).where(
        dw, _niveau_where(st),
        CardDeck.released_at.is_not(None), CardDeck.deleted_at.is_(None),
        CardDeck.released_at <= now,
    ))).scalars().all()
    if not decks:
        # Auch hier gehoert next_due dazu: wer NUR geplante Stapel hat (typisch am
        # Tag vor der Stunde), bekam eine leere Seite ohne jeden Hinweis, wann es
        # weitergeht — das Feld fehlte in dieser Abzweigung schlicht.
        naechste = (await db.execute(select(sa_func.min(CardDeck.released_at)).where(
            dw, _niveau_where(st), CardDeck.deleted_at.is_(None), CardDeck.released_at > now,
        ))).scalar()
        return {"name": st.name, "cards": [], "total": 0, "due": 0, "learned": 0,
                "hist": _empty_hist(), "next_due": naechste.isoformat() if naechste else None}
    # Auch auf Kartenebene filtern: der Stapel darf gemischt sein, das Kind
    # bekommt daraus nur die neutralen und die eigenen Niveau-Karten. Ohne
    # diesen Filter zaehlten "total"/"faellig" Karten mit, die es nie zu sehen
    # bekommt — die Anzeige stuende dauerhaft auf offenen Karten.
    cards = (await db.execute(select(Card).where(
        Card.deck_id.in_(decks), Card.deleted_at.is_(None), _karten_niveau_where(st),
    ).order_by(Card.position))).scalars().all()
    reviews = {r.card_id: r for r in (await db.execute(select(CardReview).where(CardReview.student_id == st.id))).scalars().all()}
    faellig = []
    hist = _empty_hist()
    learned = 0
    due_count = 0
    next_due = None  # frueheste kuenftige Faelligkeit → wann wieder lernen
    for c in cards:
        rev = reviews.get(c.id)
        hist[_bucket(rev)] += 1
        if rev is not None and (rev.reps or 0) > 0:
            learned += 1
        is_due = rev is None or _utc(rev.due) <= now
        if is_due:
            due_count += 1
        if all or is_due:
            faellig.append({"card_id": c.id, "front": c.front, "back": c.back,
                            "has_front_image": c.has_front_image, "has_back_image": c.has_back_image})
        if rev is not None and _utc(rev.due) > now and (next_due is None or _utc(rev.due) < next_due):
            next_due = _utc(rev.due)
    # Auch geplante Stapel zaehlen: rollt einer frueher aus als die naechste
    # Karte faellig ist, zieht das "naechste Lernen" nach vorne.
    future_release = (await db.execute(select(sa_func.min(CardDeck.released_at)).where(
        dw, _niveau_where(st), CardDeck.deleted_at.is_(None), CardDeck.released_at > now,
    ))).scalar()
    if future_release is not None and (next_due is None or _utc(future_release) < next_due):
        next_due = _utc(future_release)
    return {"name": st.name, "cards": faellig, "total": len(cards),
            "due": due_count, "learned": learned, "hist": hist,
            "next_due": next_due.isoformat() if next_due else None}


class ReviewIn(BaseModel):
    card_id: int
    # 0 = nochmal (falsch), 1 = schwer, 2 = gut, 3 = leicht
    grade: int

    @field_validator("grade")
    @classmethod
    def grade_ok(cls, v: int) -> int:
        if v not in (0, 1, 2, 3):
            raise ValueError("grade muss 0–3 sein")
        return v


@router.post("/lernen/{token}/review")
async def submit_review(token: str, body: ReviewIn, db: AsyncSession = Depends(get_db)):
    """SM-2-Schritt fuer eine Karte."""
    # Oeffentlich per Token: leichtes Limit gegen Hammering (Schreiben ist je
    # Karte gebunden, aber ein geleaktes Token soll nichts fluten koennen).
    rate_limit("karten_review", token, 600, 60, "Zu viele Anfragen. Bitte kurz warten.")
    st = await _student_by_token(db, token)
    card = await db.get(Card, body.card_id)
    if not card:
        raise HTTPException(404, "Karte nicht gefunden")
    deck = await db.get(CardDeck, card.deck_id)
    if not deck:
        raise HTTPException(404, "Karte nicht gefunden")
    # Darf dieses Kind die Karte sehen? GENAU derselbe Massstab wie beim Austeilen
    # (student_session): Stapel des Kurses ODER der eigenen Klasse, passendes
    # Niveau. Frueher wurde nur deck.class_id == st.class_id geprueft — ein Stapel
    # am KURS (also an der Geschwister-Fachklasse) wurde dem Kind angezeigt, jede
    # Antwort darauf aber mit 403 abgewiesen.
    now = _now()
    dw = await _student_deck_where(db, st)
    sichtbar = (await db.execute(select(CardDeck.id).where(
        CardDeck.id == deck.id, dw, _niveau_where(st)))).scalar_one_or_none()
    if not sichtbar:
        raise HTTPException(403, "Karte gehört nicht zu dieser Klasse")
    # Raeumt die Lehrkraft auf, waehrend ein Kind lernt (Karte/Stapel geloescht,
    # Freigabe zurueckgezogen), wird der Zug still verworfen: kein Fehler auf dem
    # Kindergeraet und kein Fortschritt auf etwas, das es nicht mehr gibt.
    if (card.deleted_at is not None or deck.deleted_at is not None
            or deck.released_at is None or _utc(deck.released_at) > now):
        return {"ok": True, "ignoriert": True}

    # Zwei Zuege desselben Kindes auf dieselbe Karte koennen gleichzeitig
    # ankommen (Doppeltipp, Wiederholung durch das Netz). Frueher fanden beide
    # keine Zeile, legten beide eine an — und die zweite lief in
    # uq_review_student_card: ein 500er auf dem Kindergeraet. Darum erst die
    # Zeile von der Datenbank sichern lassen, dann gesperrt weiterrechnen.
    async def rechnen():
        await db.execute(_anlegen_falls_fehlt(db, CardReview, {
            "student_id": st.id, "card_id": card.id,
            "ease": 250, "interval_days": 0, "reps": 0, "lapses": 0, "due": now,
        }, ["student_id", "card_id"]))
        await db.commit()
        rev = (await db.execute(select(CardReview).where(
            CardReview.student_id == st.id, CardReview.card_id == card.id
        ).with_for_update())).scalar_one()

        # Alt-Zeilen koennen NULL in den SM-2-Feldern haben (vor Default/Migration
        # angelegt) — sonst kracht die Arithmetik mit 'NoneType + int'.
        rev.ease = 250 if rev.ease is None else rev.ease
        rev.interval_days = 0 if rev.interval_days is None else rev.interval_days
        rev.reps = 0 if rev.reps is None else rev.reps
        rev.lapses = 0 if rev.lapses is None else rev.lapses

        # SM-2 (vereinfacht): grade 0 zuruecksetzen, sonst Intervall/Ease anpassen.
        # Ease und Intervall sind nach OBEN gedeckelt (EASE_MAX/INTERVAL_MAX_DAYS).
        if body.grade == 0:
            rev.reps = 0
            rev.interval_days = 0
            rev.lapses += 1
            rev.ease = max(EASE_MIN, rev.ease - 20)
            rev.due = now + timedelta(minutes=10)
        else:
            q = body.grade + 2  # 1..3 -> SM-2 q 3..5
            rev.ease = min(EASE_MAX, max(EASE_MIN, rev.ease + (q - 3) * 8 - (5 - q) * 2))
            rev.reps += 1
            if rev.reps == 1:
                rev.interval_days = 1
            elif rev.reps == 2:
                rev.interval_days = 3
            else:
                rev.interval_days = min(INTERVAL_MAX_DAYS, max(1, round(rev.interval_days * rev.ease / 100)))
            rev.due = now + timedelta(days=rev.interval_days)
        rev.last_reviewed = now
        await db.commit()
        return {"ok": True, "interval_days": rev.interval_days}

    return await _mit_wiederholung(db, rechnen)
