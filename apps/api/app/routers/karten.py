"""Modul Karten — Karteikarten mit Spaced Repetition (SM-2).

Eigenstaendig (Regel 3). Zwei Zugaenge:
- Lehrkraft (normaler Login): Stapel und Karten verwalten, Tokens/QR erzeugen,
  Fortschritt sehen.
- Schueler (KEIN Login): Zugriff ueber einen einzigartigen Token (Bearer-
  Secret, wie die gedruckte CardVote-Karte). Der Token identifiziert die Person.

Der Fortschritt liegt am Server (CardReview) — nur so sieht die Lehrkraft ihn,
anders als bei Anki, wo er am Geraet bleibt.
"""
import io
import secrets
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import qrcode
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel, field_validator
from sqlalchemy import select, func as sa_func, and_, or_, delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from sqlalchemy.orm import selectinload
from ..models import Card, CardDeck, CardFolder, CardReview, SchoolClass, Student, User, Session, Scan, QuestionSetItem
from .auth import get_current_user, rate_limit
from .modules import is_active

router = APIRouter(prefix="/api/karten", tags=["karten"])
MODULE_KEY = "karten"


def _now():
    return datetime.now(timezone.utc)


def _token():
    return secrets.token_urlsafe(24)  # ~32 Zeichen, unratbar


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


async def require_module(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> User:
    if not await is_active(db, user.id, MODULE_KEY):
        raise HTTPException(403, "Modul Karten ist nicht aktiviert")
    return user


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
    """Stapel hängen am Kurs (Fach). kurs_id gesetzt = die Stapel dieses Kurses;
    sonst Fallback auf die Klasse ohne Kurs."""
    if kurs_id is not None:
        return CardDeck.kurs_id == kurs_id
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
        .options(selectinload(CardDeck.cards)).order_by(CardDeck.id)
    )
    return r.scalars().all()


@router.get("/classes/{class_id}/all-decks", response_model=List[DeckOut])
async def list_all_decks(class_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Alle Stapel der Klasse (kursübergreifend) — für die Kalender-Deck-Auswahl,
    damit auch Kurs-Stapel erscheinen (nicht nur die ohne Kurs)."""
    await _owned_class(db, user, class_id)
    from sqlalchemy.orm import selectinload
    r = await db.execute(
        select(CardDeck).where(CardDeck.owner_id == user.id, await _class_all_decks_where(db, class_id), CardDeck.deleted_at.is_(None))
        .options(selectinload(CardDeck.cards)).order_by(CardDeck.id)
    )
    return r.scalars().all()


@router.get("/classes/{class_id}/decks/trash", response_model=List[DeckOut])
async def list_deck_trash(class_id: int, kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Gelöschte Decks des Kurses (30 Tage wiederherstellbar)."""
    cls = await _owned_class(db, user, class_id)
    from sqlalchemy.orm import selectinload
    r = await db.execute(
        select(CardDeck).where(CardDeck.owner_id == user.id, await _kurs_decks_where(cls, kurs_id), CardDeck.deleted_at.is_not(None))
        .options(selectinload(CardDeck.cards)).order_by(CardDeck.deleted_at.desc())
    )
    return r.scalars().all()


@router.post("/classes/{class_id}/decks", response_model=DeckOut, status_code=201)
async def create_deck(class_id: int, body: DeckIn, kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("karten_deck", f"u{user.id}", 100, 60, "Zu viele Stapel. Bitte kurz warten.")
    cls = await _owned_class(db, user, class_id)
    deck = CardDeck(class_id=class_id, kurs_id=kurs_id, owner_id=user.id, name=body.name.strip(),
                    topic_id=body.topic_id, niveau=body.niveau if body.niveau in ("E", "G") else "",
                    folder_id=body.folder_id)
    db.add(deck)
    await db.commit()
    await db.refresh(deck, ["cards"])
    return deck


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

    @field_validator("front", "back")
    @classmethod
    def not_too_long(cls, v: str) -> str:
        if len(v) > 5000:
            raise ValueError("Text zu lang")
        return v


@router.post("/decks/{deck_id}/cards", response_model=CardOut, status_code=201)
async def add_card(deck_id: int, body: CardIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("karten_card", f"u{user.id}", 600, 60, "Zu viele Karten. Bitte kurz warten.")
    await _owned_deck(db, user, deck_id)
    last = (await db.execute(select(Card.position).where(Card.deck_id == deck_id).order_by(Card.position.desc()))).scalars().first()
    card = Card(deck_id=deck_id, front=body.front.strip(), back=body.back.strip(), position=(last if last is not None else -1) + 1)
    db.add(card)
    await db.commit()
    await db.refresh(card)
    return card


class ImportIn(BaseModel):
    # Karten aus CSV/TSV oder Anki-Text-Export. Client parst, schickt Paare.
    cards: List[CardIn]


@router.post("/decks/{deck_id}/import")
async def import_cards(deck_id: int, body: ImportIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Mehrere Karten auf einmal anhaengen (CSV/Anki-Import)."""
    rate_limit("karten_import", f"u{user.id}", 20, 60, "Zu viele Importe. Bitte kurz warten.")
    await _owned_deck(db, user, deck_id)
    paare = [(c.front.strip(), c.back.strip()) for c in body.cards if c.front.strip() or c.back.strip()]
    if not paare:
        return {"added": 0}
    if len(paare) > 2000:
        raise HTTPException(400, "Zu viele Karten auf einmal (max. 2000)")
    last = (await db.execute(select(Card.position).where(Card.deck_id == deck_id).order_by(Card.position.desc()))).scalars().first()
    pos = (last if last is not None else -1) + 1
    for front, back in paare:
        db.add(Card(deck_id=deck_id, front=front, back=back, position=pos))
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
    await db.commit()
    await db.refresh(card)
    return card


@router.delete("/cards/{card_id}", status_code=204)
async def delete_card(card_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
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
    mime = (file.content_type or "").lower()
    if not mime.startswith("image/"):
        raise HTTPException(400, "Nur Bilddateien erlaubt")
    data = await file.read()
    if not data:
        raise HTTPException(400, "Datei ist leer")
    if len(data) > _CARD_IMG_MAX:
        raise HTTPException(413, "Bild zu groß (max. 5 MB)")
    setattr(card, f"{side}_image", data)
    setattr(card, f"{side}_image_mime", mime[:120])
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
            Card.id == card_id, dw, _niveau_where(st),
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


# ─── Lehrkraft: Fortschritt ───

class StudentProgress(BaseModel):
    student_id: int
    name: str
    reviewed: int   # wie viele Karten schon einmal gelernt
    due: int        # wie viele heute faellig
    total: int      # Karten in ausgerollten Stapeln
    hist: dict      # Reifegrad-Verteilung (neu/lernen/kurz/mittel/lang)
    last_reviewed: Optional[datetime] = None  # wann zuletzt gelernt


@router.get("/classes/{class_id}/progress", response_model=List[StudentProgress])
async def progress(class_id: int, kurs_id: Optional[int] = None, subset_kurs: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    cls = await _owned_class(db, user, class_id)
    if subset_kurs is not None:
        from .kurse import _owned_kurs
        await _owned_kurs(db, user, subset_kurs)
    students = await _kurs_roster(db, user, class_id, subset_kurs)
    now = _now()
    # Nur ausgerollte Stapel zaehlen — Entwuerfe verzerren den Fortschritt nicht.
    deck_ids = (await db.execute(select(CardDeck.id).where(
        await _kurs_decks_where(cls, kurs_id),
        CardDeck.released_at.is_not(None), CardDeck.deleted_at.is_(None),
        CardDeck.released_at <= now,
    ))).scalars().all()
    card_ids = []
    if deck_ids:
        card_ids = (await db.execute(select(Card.id).where(Card.deck_id.in_(deck_ids)))).scalars().all()
    total = len(card_ids)
    out = []
    for st in students:
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
            if rev is not None and rev.last_reviewed and (last is None or rev.last_reviewed > last):
                last = rev.last_reviewed
            if rev is None or rev.due <= now:
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
    now = _now()
    decks = {d.id: d.name for d in (await db.execute(select(CardDeck).where(
        await _kurs_decks_where(cls, kurs_id), CardDeck.released_at.is_not(None), CardDeck.deleted_at.is_(None), CardDeck.released_at <= now,
    ))).scalars().all()}
    if not decks:
        return []
    cards = (await db.execute(select(Card).where(Card.deck_id.in_(decks.keys())).order_by(Card.deck_id, Card.position))).scalars().all()
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

async def _student_by_token(db: AsyncSession, token: str) -> Student:
    if not token:
        raise HTTPException(401, "Kein Token")
    r = await db.execute(select(Student).where(Student.karten_token == token))
    st = r.scalar_one_or_none()
    if not st:
        raise HTTPException(401, "Ungültiger Token")
    return st


class StudentCard(BaseModel):
    card_id: int
    front: str
    back: str


@router.get("/qr/{token}.png")
async def qr_png(token: str, base: str = "", db: AsyncSession = Depends(get_db)):
    """QR eines Lern-Links. Kein Login: der Token im Link ist ohnehin das
    Secret, die Lehrkraft haelt ihn bereits. base = origin des Rahmens."""
    st = await _student_by_token(db, token)  # 401 bei ungueltigem Token
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
    st = await _student_by_token(db, token)  # 401 bei ungueltigem Token
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
        return {"name": st.name, "cards": [], "total": 0, "due": 0, "learned": 0, "hist": _empty_hist()}
    cards = (await db.execute(select(Card).where(Card.deck_id.in_(decks)).order_by(Card.position))).scalars().all()
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
        is_due = rev is None or rev.due <= now
        if is_due:
            due_count += 1
        if all or is_due:
            faellig.append({"card_id": c.id, "front": c.front, "back": c.back,
                            "has_front_image": c.has_front_image, "has_back_image": c.has_back_image})
        if rev is not None and rev.due > now and (next_due is None or rev.due < next_due):
            next_due = rev.due
    # Auch geplante Stapel zaehlen: rollt einer frueher aus als die naechste
    # Karte faellig ist, zieht das "naechste Lernen" nach vorne.
    future_release = (await db.execute(select(sa_func.min(CardDeck.released_at)).where(
        dw, _niveau_where(st), CardDeck.deleted_at.is_(None), CardDeck.released_at > now,
    ))).scalar()
    if future_release is not None and (next_due is None or future_release < next_due):
        next_due = future_release
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
    # Gehoert die Karte zur Klasse des Schuelers?
    deck = await db.get(CardDeck, card.deck_id)
    if not deck or deck.class_id != st.class_id:
        raise HTTPException(403, "Karte gehört nicht zu dieser Klasse")

    rev = (await db.execute(select(CardReview).where(
        CardReview.student_id == st.id, CardReview.card_id == card.id
    ))).scalar_one_or_none()
    if rev is None:
        rev = CardReview(student_id=st.id, card_id=card.id)
        db.add(rev)

    # Alt-Zeilen koennen NULL in den SM-2-Feldern haben (vor Default/Migration
    # angelegt) — sonst kracht die Arithmetik mit 'NoneType + int'.
    rev.ease = 250 if rev.ease is None else rev.ease
    rev.interval_days = 0 if rev.interval_days is None else rev.interval_days
    rev.reps = 0 if rev.reps is None else rev.reps
    rev.lapses = 0 if rev.lapses is None else rev.lapses

    # SM-2 (vereinfacht): grade 0 zuruecksetzen, sonst Intervall/Ease anpassen.
    now = _now()
    if body.grade == 0:
        rev.reps = 0
        rev.interval_days = 0
        rev.lapses += 1
        rev.ease = max(130, rev.ease - 20)
        rev.due = now + timedelta(minutes=10)
    else:
        q = body.grade + 2  # 1..3 -> SM-2 q 3..5
        rev.ease = max(130, rev.ease + (q - 3) * 8 - (5 - q) * 2)
        rev.reps += 1
        if rev.reps == 1:
            rev.interval_days = 1
        elif rev.reps == 2:
            rev.interval_days = 3
        else:
            rev.interval_days = max(1, round(rev.interval_days * rev.ease / 100))
        rev.due = now + timedelta(days=rev.interval_days)
    rev.last_reviewed = now
    await db.commit()
    return {"ok": True, "interval_days": rev.interval_days}
