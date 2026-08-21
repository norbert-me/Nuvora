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
from sqlalchemy import (select, func as sa_func, and_, or_, exists as sa_exists,
                        false as sa_false, true as sa_true, delete as sql_delete)
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..besitz import eigene_klasse, eigenes
from ..kursmitglieder import class_kurs_ids, eigener_kurs, member_student_ids, student_kurs_ids
from ..nebenlauf import mit_wiederholung
from ..zeit import als_utc, jetzt, tagesbeginn
from ..themenprofil import KartenStand
from ..pdfdruck import neue_seite
from .. import rueckmeldung
from ..database import get_db
from ..schueler import roster_kurs, sortiert
from ..uploads import bildtyp
from sqlalchemy.orm import selectinload
from ..models import (Card, CardDeck, CardDeckKurs, CardFolder, CardReview, Kurs,
                      SchoolClass, Student, User, Session)
from .auth import get_current_user, rate_limit
from .modules import is_active, modul_pflicht

router = APIRouter(prefix="/api/karten", tags=["karten"])
# Der Zugangs-Druck haengt an keinem Modul: derselbe Code fuehrt zu den Karten
# ODER zu den Testergebnissen, gilt also solange EINES der beiden laeuft. Die
# Pruefung steht deshalb im Endpunkt und nicht als Router-Schranke.
kern_router = APIRouter(prefix="/api/karten", tags=["karten"])
MODULE_KEY = "karten"


# „Jetzt" und „mit Zeitzone" stehen im Kern (app/zeit.py); die alten Namen
# bleiben, damit die vielen Aufrufer unberuehrt sind.
_now = jetzt
_utc = als_utc


def _anlegen_falls_fehlt(db: AsyncSession, modell, werte: dict, schluessel: list[str]):
    """INSERT ... ON CONFLICT DO NOTHING — die Datenbank entscheidet, wer zuerst war.

    Die Alternative („erst lesen, dann anlegen") hat eine Luecke: zwei
    gleichzeitige Anfragen finden beide nichts und legen beide an. Auf dem
    Schueler-Weg passiert genau das (Doppeltipp, Wiederholung durch das Netz).
    Postgres und SQLite koennen beide ON CONFLICT — nur mit eigenem Konstrukt.
    """
    ins = pg_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
    return ins(modell).values(**werte).on_conflict_do_nothing(index_elements=schluessel)


def _token():
    return secrets.token_urlsafe(24)  # ~32 Zeichen, unratbar


# Stand hier und in kalender.py wortgleich; liegt jetzt im KERN (app/zeit.py).
_tagesbeginn = tagesbeginn


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


# Frueher stand die strenge Klassenpruefung hier und in noten.py doppelt;
# jetzt eine Quelle (app/besitz.py).
_owned_class = eigene_klasse


async def _owned_deck(db, user, deck_id) -> CardDeck:
    # Bewusst OHNE weich=True: die Papierkorb-Wege fassen genau den geloeschten
    # Stapel an.
    return await eigenes(db, CardDeck, deck_id, user, "Stapel nicht gefunden")


async def _kurs_roster(db, user, class_id, subset_kurs=None):
    """SuS DIESER Fach-Klasse. Karten sind pro Fach getrennt: jede Fach-Klasse
    hat eigene Stapel und eigenen Fortschritt (SuS werden im Kern geteilt, der
    Karten-Fortschritt aber je Fach gefuehrt).

    Mit subset_kurs: der Roster eines Teilkurses (Kurse aus Teilen von Klassen) —
    die einzeln hinzugefügten SuS, auch aus fremden Klassen (dedupliziert).

    Sortiert wird nach position — card_id ist die Nummer der gedruckten
    ArUco-Karte, keine Reihenfolge: nach ihr sortiert stünde die Liste hier
    anders als überall sonst, sobald die Lehrkraft umsortiert hat."""
    if subset_kurs is not None:
        # Derselbe Kurs-Roster wie in noten.py und klassenarbeit.py — er steht
        # seit dem Zusammenfuehren in app/schueler.py.
        return await roster_kurs(db, subset_kurs)
    # OHNE Kurs bewusst NUR diese eine Fach-Klasse, nicht die Geschwister:
    # Karten-Fortschritt wird je Fach gefuehrt (siehe oben). Sieht aus wie der
    # Klassen-Roster der anderen Module, meint aber etwas anderes.
    return await sortiert(db, Student.class_id == class_id)


# ─── Wer sieht welchen Stapel? ───
#
# Seit der Sammlung gibt es ZWEI Wege, und sie greifen nacheinander:
#
#   1. die ZUWEISUNG (card_deck_kurse) — der neue, einzige Weg fuer alles, was
#      in der Sammlung entsteht. Ein Stapel ohne Zuweisung ist fuer niemanden
#      ausgerollt, und genau das muss so bleiben: sonst liesse sich eine
#      Zuweisung nie wieder zuruecknehmen.
#   2. die HERKUNFT (class_id/kurs_id) — nur noch fuer Stapel, die ueberhaupt
#      KEINE Zuweisung haben. Die einmalige Uebernahme beim Start gibt jedem
#      Bestandsstapel eine; bis dahin (und in Tests, die ohne Start laufen)
#      bleibt der alte Weg gueltig, damit kein Kind seine Karten verliert.
#
# Deshalb steht der alte Zweig immer unter `_ohne_zuweisung()`: beide Wege
# gleichzeitig waeren ein Stapel, den man aus einem Kurs entfernt und der ueber
# seine Herkunftsklasse trotzdem weiter ausgeteilt wird.


def _zugewiesen(kurs_ids):
    """Stapel, die EINEM dieser Kurse zugewiesen sind."""
    ids = [k for k in (kurs_ids or []) if k is not None]
    if not ids:
        return sa_false()  # ohne Kurs kein Treffer
    return sa_exists().where(and_(CardDeckKurs.deck_id == CardDeck.id, CardDeckKurs.kurs_id.in_(ids)))


def _ohne_zuweisung():
    """Stapel, die (noch) keinem Kurs zugewiesen sind — nur fuer sie gilt die Herkunft."""
    return ~sa_exists().where(CardDeckKurs.deck_id == CardDeck.id)


async def _kurse_je_deck(db, deck_ids) -> dict:
    """{deck_id: [kurs_id, …]} — die Zuweisungen, wie die Oberflaeche sie zeigt."""
    ids = list(deck_ids or [])
    if not ids:
        return {}
    rows = (await db.execute(select(CardDeckKurs.deck_id, CardDeckKurs.kurs_id)
                             .where(CardDeckKurs.deck_id.in_(ids)))).all()
    out: dict = {}
    for did, kid in rows:
        out.setdefault(did, []).append(kid)
    return out


async def _kurs_decks_where(cls, kurs_id=None):
    """Stapel dieser Klasse/dieses Kurses (Lehrkraft-Sicht der alten Wege).

    kurs_id gesetzt = die dem Kurs ZUGEWIESENEN Stapel, dazu die Bestandsstapel
    ohne Zuweisung nach der alten Regel (Herkunfts-Kurs oder eigene Klasse ohne
    Kurs). Ohne kurs_id bleibt nur der Klassen-Fallback.

    Der Fallback war schon vorher wichtig: nicht jeder Weg, der einen Stapel
    anlegt, kennt einen Kurs — das "Karten-Deck" zu einem schwachen Thema und die
    Übernahme aus dem Marktplatz legen ohne kurs_id an.
    """
    if kurs_id is not None:
        alt = or_(CardDeck.kurs_id == kurs_id,
                  and_(CardDeck.class_id == cls.id, CardDeck.kurs_id.is_(None)))
        return or_(_zugewiesen([kurs_id]), and_(_ohne_zuweisung(), alt))
    return and_(_ohne_zuweisung(), CardDeck.class_id == cls.id, CardDeck.kurs_id.is_(None))


async def _class_all_decks_where(db, class_id):
    """Alle Stapel, die zur Klasse gehören: zugewiesen an einen ihrer Kurse ODER
    direkt (class_id) ODER über den Herkunfts-Kurs. Für Auswahl-Listen (z.B.
    Kalender-Deck-Verknüpfung), die nicht auf einen bestimmten Kurs eingeschränkt
    sind — hier wird bewusst breit angeboten, ausgeteilt wird nichts."""
    kurse = list(await class_kurs_ids(db, class_id))
    if kurse:
        return or_(_zugewiesen(kurse), CardDeck.kurs_id.in_(kurse), CardDeck.class_id == class_id)
    return CardDeck.class_id == class_id


async def _student_kurs_ids(db, st) -> list:
    """Die Kurse dieses Kindes: die seiner Klasse UND die Teilkurse, in denen es
    einzeln Mitglied ist (Kurse aus Teilen von Klassen)."""
    return list(set(await class_kurs_ids(db, st.class_id)) | await student_kurs_ids(db, st.id))


async def _student_deck_where(db, st):
    """Deck-Filter fuer einen Schueler (oeffentliches Lernen): alle Stapel, die
    einem seiner Kurse ZUGEWIESEN sind — plus die Bestandsstapel ohne Zuweisung
    nach der alten Regel (Herkunfts-Kurs oder eigene Klasse).

    Fremde Kurse bleiben aussen vor: gefragt wird nur nach den Kursen dieses
    Kindes, und der Herkunfts-Zweig haengt weiterhin an seiner eigenen class_id."""
    kurse = await _student_kurs_ids(db, st)
    alt = and_(CardDeck.class_id == st.class_id, CardDeck.kurs_id.is_(None))
    if kurse:
        alt = or_(CardDeck.kurs_id.in_(kurse), alt)
        return or_(_zugewiesen(kurse), and_(_ohne_zuweisung(), alt))
    return and_(_ohne_zuweisung(), alt)


def _niveau_where(st):
    """Niveau-Stapel automatisch verteilen: E-Schueler sehen E- und neutrale
    Stapel, G-Schueler G- und neutrale, ohne Niveau nur neutrale."""
    if st.niveau == "E":
        return CardDeck.niveau.in_(["", "E"])
    if st.niveau == "G":
        return CardDeck.niveau.in_(["", "G"])
    return CardDeck.niveau == ""


def _sichtbar_karte(schueler_niveau: str, karten_niveau: str, deck_niveau: str, niveau_aktiv: bool) -> bool:
    """Sieht dieses Kind diese Karte? Fuer schon geladene Zeilen.

    Zwei Ebenen, aber nur die untere haengt am Schalter: das Niveau des STAPELS
    gilt immer (ein reiner E-Stapel bleibt einer), das Niveau der einzelnen
    KARTE nur, wenn die Differenzierung am Stapel eingeschaltet ist. Sonst
    saehen Kinder Karten nicht, ohne dass jemand E/G ueberhaupt angeschaltet
    haette — das war der Stolperstein bei CardVote und ist hier derselbe.
    """
    if not _sichtbar(schueler_niveau, deck_niveau):
        return False
    return _sichtbar(schueler_niveau, karten_niveau) if niveau_aktiv else True


def _sichtbar(schueler_niveau: str, *niveaus: str) -> bool:
    """Dieselbe Regel wie die WHERE-Fassungen, nur fuer schon geladene Zeilen.

    Ein Kind sieht neutrale Karten/Stapel und die seines eigenen Niveaus. Wird
    in der Lehrkraft-Uebersicht gebraucht, wo eine einzige Abfrage fuer die
    ganze Klasse laeuft und je Kind gefiltert werden muss.
    """
    erlaubt = {"", schueler_niveau} if schueler_niveau in ("E", "G") else {""}
    return all((n or "") in erlaubt for n in niveaus)


def _karten_niveau_where(st, deck_ids_aktiv=None):
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
        regel = Card.niveau.in_(["", "E"])
    elif st.niveau == "G":
        regel = Card.niveau.in_(["", "G"])
    else:
        regel = Card.niveau == ""
    # Der Filter gilt nur, wo die Differenzierung am Stapel eingeschaltet ist.
    # `deck_ids_aktiv` ist fuer Abfragen OHNE Join auf CardDeck (dort steht die
    # Deck-Liste schon fest); mit Join reicht die Spalte selbst.
    if deck_ids_aktiv is None:
        return or_(CardDeck.niveau_aktiv.is_(False), regel)
    ids = list(deck_ids_aktiv)
    if not ids:
        return sa_true()
    return or_(Card.deck_id.notin_(ids), regel)


# ─── Lehrkraft: Stapel & Karten ───

class DeckIn(BaseModel):
    name: str = ""
    topic_id: Optional[int] = None
    niveau: str = ""  # "" = alle, "E"/"G" = nur dieses Niveau
    # E/G je Karte ueberhaupt benutzen? Aus = alle sehen alle Karten (wie ein
    # CardVote-Quiz ohne Niveau). Voreinstellung aus.
    niveau_aktiv: bool = False
    folder_id: Optional[int] = None  # Ordner (wie CardVote); NULL = Wurzel
    # Nur beim Anlegen in der Sammlung: Kurse, fuer die der Stapel gelten soll.
    # None = keine Angabe (nichts zuweisen), [] = ausdruecklich niemandem.
    kurs_ids: Optional[List[int]] = None


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
    class_id: Optional[int] = None  # nur noch Herkunft; Stapel der Sammlung haben keine
    kurs_id: Optional[int] = None   # Herkunfts-Kurs (Bestand) — für Deep-Link aus dem Kalender
    kurs_ids: List[int] = []        # die Kurse, denen der Stapel zugewiesen ist
    name: str
    topic_id: Optional[int] = None
    niveau: str = ""
    niveau_aktiv: bool = False
    folder_id: Optional[int] = None
    released_at: Optional[datetime] = None
    cards: List[CardOut] = []
    model_config = {"from_attributes": True}


def _deck_out(deck, kurs_ids=()) -> "DeckOut":
    """DeckOut mit gefilterten Karten: gelöschte (deleted_at) bleiben draußen. Das
    Relationship trägt delete-orphan — hier NICHT anfassen, nur beim Ausgeben filtern."""
    return DeckOut(
        id=deck.id, class_id=deck.class_id, kurs_id=deck.kurs_id,
        kurs_ids=sorted(kurs_ids or []), name=deck.name,
        topic_id=deck.topic_id, niveau=deck.niveau, niveau_aktiv=bool(deck.niveau_aktiv),
        folder_id=deck.folder_id,
        released_at=deck.released_at,
        cards=[CardOut.model_validate(c) for c in deck.cards if c.deleted_at is None],
    )


async def _decks_out(db, decks) -> List["DeckOut"]:
    """Mehrere Stapel ausgeben — die Zuweisungen in EINER Abfrage dazu."""
    zu = await _kurse_je_deck(db, [d.id for d in decks])
    return [_deck_out(d, zu.get(d.id, [])) for d in decks]


async def _deck_einzeln(db, deck) -> "DeckOut":
    return _deck_out(deck, (await _kurse_je_deck(db, [deck.id])).get(deck.id, []))


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
    return await eigenes(db, CardFolder, folder_id, user, "Ordner nicht gefunden")


def _folder_scope(class_id, kurs_id):
    """Ordner hängen wie die Stapel am KURS (alle Fach-Klassen); ohne Kurs an der
    Klasse. So passen Ordner und Decks zusammen."""
    if kurs_id is not None:
        return [CardFolder.kurs_id == kurs_id]
    return [CardFolder.class_id == class_id, CardFolder.kurs_id.is_(None)]


@router.get("/card-folders", response_model=List[CardFolderOut])
async def list_collection_folders(user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Alle Ordner der Sammlung — sie gehoeren der Lehrkraft, nicht einer Klasse.
    Bestandsordner (mit class_id) stehen mit drin: sonst waeren ihre Stapel in der
    Sammlung sichtbar, ihr Ordner aber nicht."""
    rows = (await db.execute(select(CardFolder).where(CardFolder.owner_id == user.id)
                             .order_by(CardFolder.name))).scalars().all()
    return rows


@router.post("/card-folders", response_model=CardFolderOut, status_code=201)
async def create_collection_folder(body: CardFolderIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Ordner in der Sammlung anlegen — ohne Klasse."""
    f = CardFolder(owner_id=user.id, class_id=None, kurs_id=None, name=body.name.strip(), parent_id=body.parent_id)
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return f


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


async def _aktive_decks(db, user, bereich):
    """Nicht geloeschte Stapel eines Bereichs, fertig fuer die Ausgabe.

    Stand zweimal wortgleich in /decks und /all-decks; der einzige Unterschied
    war die Bereichsbedingung (Kurs bzw. ganze Klasse) — die kommt jetzt herein.
    """
    r = await db.execute(
        select(CardDeck).where(CardDeck.owner_id == user.id, bereich, CardDeck.deleted_at.is_(None))
        .options(selectinload(CardDeck.cards)).order_by(CardDeck.position, CardDeck.id)
    )
    return await _decks_out(db, r.scalars().all())


@router.get("/classes/{class_id}/decks", response_model=List[DeckOut])
async def list_decks(class_id: int, kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    cls = await _owned_class(db, user, class_id)
    return await _aktive_decks(db, user, await _kurs_decks_where(cls, kurs_id))


@router.get("/classes/{class_id}/all-decks", response_model=List[DeckOut])
async def list_all_decks(class_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Alle Stapel der Klasse (kursübergreifend) — für die Kalender-Deck-Auswahl,
    damit auch Kurs-Stapel erscheinen (nicht nur die ohne Kurs)."""
    await _owned_class(db, user, class_id)
    return await _aktive_decks(db, user, await _class_all_decks_where(db, class_id))


@router.get("/classes/{class_id}/decks/trash", response_model=List[DeckOut])
async def list_deck_trash(class_id: int, kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Gelöschte Decks des Kurses (30 Tage wiederherstellbar)."""
    cls = await _owned_class(db, user, class_id)
    from sqlalchemy.orm import selectinload
    r = await db.execute(
        select(CardDeck).where(CardDeck.owner_id == user.id, await _kurs_decks_where(cls, kurs_id), CardDeck.deleted_at.is_not(None))
        .options(selectinload(CardDeck.cards)).order_by(CardDeck.deleted_at.desc())
    )
    return await _decks_out(db, r.scalars().all())


async def zuweisung_aus_stunde(db: AsyncSession, deck_id: int, kurs_ids) -> int:
    """Die Stunde erzeugt die Zuweisung.

    Seit der Entscheidung „Karteikarten werden nicht mehr von Hand Kursen
    zugewiesen, sondern über die Stunde" ist DAS der Weg, auf dem ein Stapel bei
    Kindern ankommt: wer ihn in eine Stunde plant, weist ihn damit dem Kurs
    dieser Stunde zu. Die Tabelle dahinter (card_deck_kurse) und die ganze
    Sichtbarkeitsauflösung bleiben unverändert — nur die Hand fällt weg.

    Additiv: eine bestehende Zuweisung wird nie entfernt (der Stapel kann in
    mehreren Stunden liegen), doppelt angelegt wird nichts.
    """
    neu = 0
    for kid in {k for k in (kurs_ids or []) if k}:
        da = (await db.execute(select(CardDeckKurs.id).where(
            CardDeckKurs.deck_id == deck_id, CardDeckKurs.kurs_id == kid))).scalars().first()
        if not da:
            db.add(CardDeckKurs(deck_id=deck_id, kurs_id=kid))
            neu += 1
    return neu


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
    entries = (await db.execute(
        select(CalendarEntry).where(CalendarEntry.owner_id == user.id, CalendarEntry.topic_id == deck.topic_id)
        .order_by(CalendarEntry.date)
    )).scalars().all()
    zugewiesen = set((await _kurse_je_deck(db, [deck.id])).get(deck.id, []))
    for e in entries:
        if e.class_id is None:
            continue
        kurse = await class_kurs_ids(db, e.class_id)
        if (e.class_id == deck.class_id or (deck.kurs_id is not None and deck.kurs_id in kurse)
                or (zugewiesen & set(kurse))):
            deck.released_at = _tagesbeginn(e.date)  # ab Beginn des Termintags (frühester Eintrag)
            if not e.karten_deck_id:
                e.karten_deck_id = deck.id       # Eintrag auf dieses Deck verlinken
            # … und die Stunde weist den Stapel ihrem Kurs zu — ohne das wäre er
            # ausgerollt, aber bei niemandem.
            await zuweisung_aus_stunde(db, deck.id, kurse | ({e.kurs_id} if e.kurs_id else set()))
            await db.commit()
            return


@router.post("/classes/{class_id}/decks", response_model=DeckOut, status_code=201)
async def create_deck(class_id: int, body: DeckIn, kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Stapel an einer Klasse anlegen — der alte Weg.

    Bleibt fuer alles, was von aussen mit einer Klasse kommt (Marktplatz,
    schwaches Thema, Kalender). Er legt KEINE Kurs-Zuweisung an: die Herkunft
    reicht, solange niemand den Stapel zugewiesen hat (siehe `_ohne_zuweisung`).
    Die Sammlung legt ueber `POST /decks` an."""
    rate_limit("karten_deck", f"u{user.id}", 100, 60, "Zu viele Stapel. Bitte kurz warten.")
    await _owned_class(db, user, class_id)  # nur die Zugriffsprüfung, wirft bei fremder Klasse
    last = (await db.execute(select(CardDeck.position).where(CardDeck.class_id == class_id).order_by(CardDeck.position.desc()))).scalars().first()
    deck = CardDeck(class_id=class_id, kurs_id=kurs_id, owner_id=user.id, name=body.name.strip(),
                    topic_id=body.topic_id, niveau=body.niveau if body.niveau in ("E", "G") else "",
                    niveau_aktiv=bool(body.niveau_aktiv), folder_id=body.folder_id, position=(last if last is not None else -1) + 1)
    db.add(deck)
    await db.commit()
    await db.refresh(deck, ["cards"])
    await _schedule_deck_from_calendar(db, user, deck)
    return await _deck_einzeln(db, deck)


# ─── Die Sammlung: alle Stapel der Lehrkraft, Zuweisung an Kurse ───

async def uebernahme_deck_kurse(db: AsyncSession) -> int:
    """Bestand einmalig in die neue Zuweisung heben — ohne Datenverlust.

    Jeder vorhandene Stapel bekommt eine Zuweisung: bevorzugt aus seinem
    Herkunfts-Kurs (`kurs_id`), ersatzweise aus dem Kurs seiner Herkunftsklasse.
    `class_id` bleibt stehen und wird NICHT geleert — sie ist die Spur, aus der
    diese Rechnung stammt.

    Einmalig heisst einmalig: die Marke sitzt am Konto
    (`users.karten_kurse_initialized`), wie beim Anschluss ans Modulregister.
    Ohne sie zauberte jeder Neustart eine von Hand entfernte Zuweisung wieder
    herbei — und ein Stapel, den die Lehrkraft aus einem Kurs genommen hat,
    waere am naechsten Morgen wieder ausgerollt.

    Stapel im Papierkorb zaehlen mit: sonst stuenden sie nach dem
    Wiederherstellen ohne Zuweisung da.
    """

    konten = (await db.execute(select(User).where(
        User.karten_kurse_initialized.is_(False)))).scalars().all()
    if not konten:
        return 0
    angelegt = 0
    for u in konten:
        decks = (await db.execute(select(CardDeck).where(CardDeck.owner_id == u.id))).scalars().all()
        for d in decks:
            schon = (await db.execute(select(CardDeckKurs.id).where(
                CardDeckKurs.deck_id == d.id))).scalars().first()
            if schon:
                continue
            ziel = []
            if d.kurs_id:
                # Nur, wenn es den Kurs noch gibt: eine Zeile auf einen toten
                # Kurs waere eine Zuweisung, die niemandem etwas austeilt.
                lebt = (await db.execute(select(Kurs.id).where(
                    Kurs.id == d.kurs_id, Kurs.deleted_at.is_(None)))).scalars().first()
                if lebt:
                    ziel = [d.kurs_id]
            if not ziel and d.class_id:
                ziel = sorted(await class_kurs_ids(db, d.class_id))
            for k in ziel:
                db.add(CardDeckKurs(deck_id=d.id, kurs_id=k))
                angelegt += 1
        u.karten_kurse_initialized = True
    await db.commit()
    return angelegt



async def _owned_kurs_ids(db, user, kurs_ids) -> list:
    """Kurs-IDs pruefen: jede muss dem Konto gehoeren. Sonst waere die Zuweisung
    der Weg, einen Stapel in einen fremden Kurs zu haengen."""
    ids = sorted({int(k) for k in (kurs_ids or [])})
    if not ids:
        return []
    gefunden = set((await db.execute(select(Kurs.id).where(
        Kurs.id.in_(ids), Kurs.owner_id == user.id))).scalars().all())
    fehlt = [k for k in ids if k not in gefunden]
    if fehlt:
        raise HTTPException(404, "Kurs nicht gefunden")
    return ids


async def _setze_deck_kurse(db, deck_id: int, kurs_ids) -> list:
    """Zuweisungen auf genau diese Liste bringen — als Abgleich, nicht als
    Loeschen-und-neu-Anlegen. Es haengt nichts an der Zeile, aber die Regel gilt
    hier wie ueberall: was bleiben soll, wird nicht erst weggeworfen."""
    ziel = set(kurs_ids or [])
    jetzt = set((await db.execute(select(CardDeckKurs.kurs_id).where(CardDeckKurs.deck_id == deck_id))).scalars().all())
    for weg in jetzt - ziel:
        await db.execute(sql_delete(CardDeckKurs).where(
            CardDeckKurs.deck_id == deck_id, CardDeckKurs.kurs_id == weg))
    for neu in ziel - jetzt:
        db.add(CardDeckKurs(deck_id=deck_id, kurs_id=neu))
    return sorted(ziel)


@router.get("/decks", response_model=List[DeckOut])
async def list_collection(kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Die ganze Sammlung (alle Stapel der Lehrkraft, in ihren Ordnern).

    `kurs_id` filtert auf „nur Stapel dieses Kurses" — die Klasse ist dafuer
    keine Voraussetzung mehr, sondern eine Ansichtssache."""
    from sqlalchemy.orm import selectinload
    where = [CardDeck.owner_id == user.id, CardDeck.deleted_at.is_(None)]
    if kurs_id is not None:
        await _owned_kurs_ids(db, user, [kurs_id])
        where.append(or_(_zugewiesen([kurs_id]),
                         and_(_ohne_zuweisung(), CardDeck.kurs_id == kurs_id)))
    r = await db.execute(select(CardDeck).where(*where)
                         .options(selectinload(CardDeck.cards)).order_by(CardDeck.position, CardDeck.id))
    return await _decks_out(db, r.scalars().all())


@router.post("/decks", response_model=DeckOut, status_code=201)
async def create_collection_deck(body: DeckIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Stapel in der Sammlung anlegen — ohne Klasse. Zuweisung optional; ohne sie
    ist der Stapel angelegt, aber fuer niemanden ausgerollt."""
    rate_limit("karten_deck", f"u{user.id}", 100, 60, "Zu viele Stapel. Bitte kurz warten.")
    kurse = await _owned_kurs_ids(db, user, body.kurs_ids)
    last = (await db.execute(select(CardDeck.position).where(CardDeck.owner_id == user.id)
                             .order_by(CardDeck.position.desc()))).scalars().first()
    deck = CardDeck(class_id=None, kurs_id=None, owner_id=user.id, name=body.name.strip(),
                    topic_id=body.topic_id, niveau=body.niveau if body.niveau in ("E", "G") else "",
                    niveau_aktiv=bool(body.niveau_aktiv), folder_id=body.folder_id, position=(last if last is not None else -1) + 1)
    db.add(deck)
    await db.flush()
    await _setze_deck_kurse(db, deck.id, kurse)
    await db.commit()
    await db.refresh(deck, ["cards"])
    await _schedule_deck_from_calendar(db, user, deck)
    return await _deck_einzeln(db, deck)


class DeckKurseIn(BaseModel):
    kurs_ids: List[int] = []


@router.get("/decks/{deck_id}/kurse")
async def get_deck_kurse(deck_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_deck(db, user, deck_id)
    return {"kurs_ids": sorted((await _kurse_je_deck(db, [deck_id])).get(deck_id, []))}


@router.put("/decks/{deck_id}/kurse")
async def set_deck_kurse(deck_id: int, body: DeckKurseIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Zuweisung setzen (ersetzt die bisherige). Leere Liste = niemandem mehr —
    der Stapel bleibt in der Sammlung, wird aber nicht mehr ausgeteilt."""
    await _owned_deck(db, user, deck_id)
    kurse = await _owned_kurs_ids(db, user, body.kurs_ids)
    gesetzt = await _setze_deck_kurse(db, deck_id, kurse)
    await db.commit()
    return {"kurs_ids": gesetzt}


class DeckReorderIn(BaseModel):
    ids: List[int]


async def _reihenfolge_setzen(db, ids, *bedingungen):
    """Position der Stapel aus der ID-Liste setzen; Unbekanntes wird uebergangen.

    Stand zweimal wortgleich (Sammlung und Klasse); der einzige Unterschied war
    die Auswahl der Stapel — die kommt jetzt als Bedingung herein.
    """
    rows = (await db.execute(select(CardDeck).where(*bedingungen))).scalars().all()
    by_id = {d.id: d for d in rows}
    pos = 0
    for did in ids:
        d = by_id.get(did)
        if d is not None:
            d.position = pos
            pos += 1
    await db.commit()


@router.put("/decks/reorder", status_code=204)
async def reorder_collection(body: DeckReorderIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Reihenfolge in der Sammlung setzen (nur eigene Stapel)."""
    await _reihenfolge_setzen(db, body.ids, CardDeck.owner_id == user.id)


@router.put("/classes/{class_id}/decks/reorder", status_code=204)
async def reorder_decks(class_id: int, body: DeckReorderIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Reihenfolge der Stapel der Klasse anhand der ID-Liste setzen (nur eigene)."""
    await _owned_class(db, user, class_id)
    await _reihenfolge_setzen(db, body.ids, CardDeck.class_id == class_id, CardDeck.owner_id == user.id)


@router.put("/decks/{deck_id}", response_model=DeckOut)
async def update_deck(deck_id: int, body: DeckIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Name und/oder Thema des Stapels aendern."""
    deck = await _owned_deck(db, user, deck_id)
    deck.name = body.name.strip()
    deck.topic_id = body.topic_id
    deck.niveau = body.niveau if body.niveau in ("E", "G") else ""
    deck.niveau_aktiv = bool(body.niveau_aktiv)
    deck.folder_id = body.folder_id
    await db.commit()
    await db.refresh(deck, ["cards"])
    await _schedule_deck_from_calendar(db, user, deck)
    return await _deck_einzeln(db, deck)


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
    return await _deck_einzeln(db, deck)


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
    return await _deck_einzeln(db, deck)


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


def _niveau_vorgabe(deck) -> str:
    """Karteikarten sind G, solange nicht anders gesagt — ABER nur, wo die
    Differenzierung AM STAPEL eingeschaltet ist (`card_decks.niveau_aktiv`,
    dasselbe Gegenstueck wie `question_sets.niveau_aktiv` bei CardVote).

    Sie hing zuerst am Kurs. Das war die falsche Ebene: derselbe Kurs hat
    Stapel, bei denen E/G eine Rolle spielt, und solche, bei denen es keine
    spielt — und ein Kurs-Schalter hat dann ueber beide entschieden.

    Ohne eingeschaltete Differenzierung bleibt eine neue Karte neutral; mit ist
    sie Grundstoff und wird per Umschalter zu E. Gilt nur beim ANLEGEN —
    Bestandskarten bleiben, was sie sind, sonst verschwaenden sie ueber Nacht
    aus der Sicht der E-Kinder."""
    return "G" if deck.niveau_aktiv else ""


@router.post("/decks/{deck_id}/cards", response_model=CardOut, status_code=201)
async def add_card(deck_id: int, body: CardIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("karten_card", f"u{user.id}", 600, 60, "Zu viele Karten. Bitte kurz warten.")
    deck = await _owned_deck(db, user, deck_id)
    last = (await db.execute(select(Card.position).where(Card.deck_id == deck_id).order_by(Card.position.desc()))).scalars().first()
    card = Card(deck_id=deck_id, front=body.front.strip(), back=body.back.strip(),
                niveau=body.niveau or _niveau_vorgabe(deck),
                position=(last if last is not None else -1) + 1)
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
    deck = await _owned_deck(db, user, deck_id)
    # Dieselbe Vorgabe wie beim einzelnen Anlegen: bei aktivem Niveau ist eine
    # importierte Karte ohne Angabe Grundstoff, nicht „fuer alle".
    vorgabe = _niveau_vorgabe(deck)
    paare = [(c.front.strip(), c.back.strip(), c.niveau or vorgabe) for c in body.cards if c.front.strip() or c.back.strip()]
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
        await eigener_kurs(db, user, subset_kurs)
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
    from reportlab.lib.units import mm
    from reportlab.lib.utils import ImageReader

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
    # A4-Leinwand aus app/pdfdruck.py — dieselben Zeilen standen an acht Stellen.
    c, breite, hoehe = neue_seite(puffer)
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
        await eigener_kurs(db, user, subset_kurs)
    if kurs_id is not None:
        await eigener_kurs(db, user, kurs_id)   # kurs_id kommt aus der URL: erst pruefen, wem er gehoert
    students = await _kurs_roster(db, user, class_id, subset_kurs)
    now = _now()
    # Nur ausgerollte Stapel zaehlen — Entwuerfe verzerren den Fortschritt nicht.
    deck_ids = (await db.execute(select(CardDeck.id).where(
        CardDeck.owner_id == user.id,
        await _kurs_decks_where(cls, kurs_id),
        CardDeck.released_at.is_not(None), CardDeck.deleted_at.is_(None),
        CardDeck.released_at <= now,
    ))).scalars().all()
    karten = []   # (card_id, Karten-Niveau, Stapel-Niveau, Differenzierung an?)
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
            select(Card.id, Card.niveau, CardDeck.niveau, CardDeck.niveau_aktiv)
            .join(CardDeck, Card.deck_id == CardDeck.id)
            .where(Card.deck_id.in_(deck_ids), Card.deleted_at.is_(None))
        )).all()
    out = []
    for st in students:
        card_ids = [cid for cid, kn, dn, na in karten if _sichtbar_karte(st.niveau or "", kn, dn, na)]
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


async def themen_lernstand(db: AsyncSession, user: User, class_id: int, students,
                           jetzt: Optional[datetime] = None) -> dict:
    """Kartenstand je Kind und Thema — die Kartenquelle des Themenstands.

    Kein Endpunkt, sondern eine Auskunft für `themenprofil` (Kern). Die
    Modul-Schranke bleibt beim Aufrufer: der prüft `is_active("karten")` und
    fragt sonst gar nicht erst (Regel 3, je Quelle einzeln).

    Gezählt wird nur, was das Kind auch bekommen hat:

    - nur ausgerollte, nicht gelöschte Stapel MIT Thema (ein Entwurf ist für
      niemanden fällig, ein Stapel ohne Thema gehört in keine Themenzeile),
    - E/G auf beiden Ebenen (`_sichtbar_karte`) — ein G-Kind darf sich keinen
      Rückstand an E-Karten anrechnen lassen, die es nie zu sehen bekommt,
    - `Treffer = reps`, `Versuche = reps + lapses`. NICHT nach `reps > 0`
      filtern: SM-2 setzt `reps` beim Fehler auf 0 zurück, `reps=0, lapses=3`
      ist also die schwächste Karte im Stapel und genau die, um die es geht.

    Fällig ist eine Karte, die noch nie dran war oder deren `due` erreicht ist —
    dieselbe Regel wie in der Fortschrittsübersicht.
    """

    now = jetzt or _now()
    aus = {s.id: {} for s in students}
    if not students:
        return aus

    karten = (await db.execute(
        select(Card.id, Card.niveau, CardDeck.niveau, CardDeck.niveau_aktiv, CardDeck.topic_id)
        .join(CardDeck, Card.deck_id == CardDeck.id)
        .where(CardDeck.owner_id == user.id,
               await _class_all_decks_where(db, class_id),
               CardDeck.topic_id.is_not(None),
               CardDeck.deleted_at.is_(None),
               CardDeck.released_at.is_not(None), CardDeck.released_at <= now,
               Card.deleted_at.is_(None))
    )).all()
    if not karten:
        return aus

    reviews: dict[int, dict] = {s.id: {} for s in students}
    for r in (await db.execute(select(CardReview).where(
            CardReview.student_id.in_([s.id for s in students])))).scalars().all():
        if r.student_id in reviews:
            reviews[r.student_id][r.card_id] = r

    for st in students:
        je_thema = aus[st.id]
        eigene = reviews[st.id]
        for cid, karten_niveau, deck_niveau, niveau_aktiv, topic_id in karten:
            if not _sichtbar_karte(st.niveau or "", karten_niveau, deck_niveau, niveau_aktiv):
                continue
            stand = je_thema.setdefault(topic_id, KartenStand())
            rev = eigene.get(cid)
            if rev is None:
                stand.faellig += 1
                continue
            treffer, patzer = rev.reps or 0, rev.lapses or 0
            if treffer or patzer:
                stand.karten += 1
                stand.treffer += treffer
                stand.versuche += treffer + patzer
            if _utc(rev.due) <= now:
                stand.faellig += 1
    return aus


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
        await eigener_kurs(db, user, subset_kurs)
        if student_id not in await member_student_ids(db, subset_kurs):
            raise HTTPException(404, "Schüler nicht in diesem Teilkurs")
    elif st.class_id != class_id:
        raise HTTPException(404, "Schüler nicht in dieser Klasse")
    if kurs_id is not None:
        await eigener_kurs(db, user, kurs_id)   # sonst liest ein fremder Kurs Stapelnamen + Kartentexte aus
    now = _now()
    _dl = (await db.execute(select(CardDeck).where(
        CardDeck.owner_id == user.id,
        await _kurs_decks_where(cls, kurs_id), CardDeck.released_at.is_not(None), CardDeck.deleted_at.is_(None), CardDeck.released_at <= now,
    ))).scalars().all()
    decks = {d.id: d.name for d in _dl}
    deck_niveaus = {d.id: d.niveau or "" for d in _dl}
    deck_aktiv = {d.id: bool(d.niveau_aktiv) for d in _dl}
    if not decks:
        return []
    # Genau die Karten, die dieses Kind auch bekommt (Stapel- UND Kartenniveau) —
    # sonst steht in der Detailsicht eine Karte, die es nie gesehen hat.
    cards = [c for c in (await db.execute(select(Card).where(
        Card.deck_id.in_(decks.keys()), Card.deleted_at.is_(None),
    ).order_by(Card.deck_id, Card.position))).scalars().all()
        if _sichtbar_karte(st.niveau or "", c.niveau, deck_niveaus.get(c.deck_id, ""),
                           deck_aktiv.get(c.deck_id, False))]
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

    # EINE Meldung fuer jeden Grund. Vorher gab es drei („Kein Token",
    # „Ungültiger Token", „Zugang nicht mehr gültig") — daran liess sich von
    # aussen ablesen, ob ein Token ueberhaupt existiert und nur das Modul aus
    # ist. Das ist genau die Auskunft, die niemand bekommen soll.
    tot = HTTPException(401, "Zugang nicht mehr gültig")

    if not token:
        raise tot
    r = await db.execute(select(Student).where(Student.karten_token == token))
    st = r.scalar_one_or_none()
    if not st:
        raise tot
    cls = await db.get(SchoolClass, st.class_id)
    # Keine Klasse = kein Zugang. Frueher hingen beide Pruefungen an
    # `cls is not None`; bei einer verwaisten class_id (harte Loeschung) fielen
    # damit Papierkorb-, Archiv- UND Modulpruefung aus, und der Zettel lieferte
    # weiter Karten aus. Fehlt der Traeger, gilt der Zugang nicht.
    if cls is None or cls.deleted_at is not None or cls.archived_at is not None:
        raise tot
    # `modul` ist ein Schluessel oder mehrere: dann reicht EINES davon. Der
    # QR-Code selbst gilt naemlich, solange ueberhaupt etwas dahinter steht —
    # Karten ODER Testergebnisse.
    schluessel = (modul,) if isinstance(modul, str) else tuple(modul or ())
    if cls.owner_id and schluessel:
        erlaubt = [k for k in schluessel if await is_active(db, cls.owner_id, k)]
        if not erlaubt:
            raise tot
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
    Schuelers — je Session sein Punktestand UND seine Rueckmeldung (was sass,
    was fehlt). Nur Sessions, an denen er teilgenommen hat. Newest first.

    Gerechnet wird in app/rueckmeldung.py, also mit derselben Funktion wie die
    Auswertung der Lehrkraft. Vorher zaehlte diese Stelle roh richtig/gesamt und
    kannte weder E/G noch Gewichte noch Minuspunkte — das Kind sah also eine
    andere Zahl als seine Lehrkraft, und beide hielten ihre fuer die richtige.
    """
    # Testergebnisse gehoeren CardVote — sie bleiben also erreichbar, wenn nur
    # das Kartenmodul abgeschaltet ist, und verschwinden mit CardVote.
    st = await _student_by_token(db, token, modul="cardvote")
    sessions = (await db.execute(
        select(Session).where(Session.class_id == st.class_id).order_by(Session.created_at.desc())
    )).scalars().all()
    out = []
    for sess in sessions:
        zeilen = await rueckmeldung.quiz(db, sess, nur_card_id=st.card_id)
        if not zeilen:
            continue                      # nicht teilgenommen oder nichts erfasst
        r = zeilen[0]
        out.append({
            "name": sess.name or "Test",
            "date": sess.created_at.isoformat() if sess.created_at else None,
            "score": r["punkte"], "total": r["max"], "pct": r["pct"],
            # Was das Kind aus der Zahl machen soll — ohne das ist eine Prozent-
            # angabe nur eine Zahl. Kein Vergleich mit der Klasse.
            "sass": r["sass"], "offen": r["offen"],
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
    zeilen = (await db.execute(select(CardDeck.id, CardDeck.niveau_aktiv).where(
        dw, _niveau_where(st),
        CardDeck.released_at.is_not(None), CardDeck.deleted_at.is_(None),
        CardDeck.released_at <= now,
    ))).all()
    decks = [i for i, _ in zeilen]
    # Nur diese Stapel unterscheiden ueberhaupt nach Niveau (siehe _karten_niveau_where).
    aktiv = [i for i, na in zeilen if na]
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
        Card.deck_id.in_(decks), Card.deleted_at.is_(None), _karten_niveau_where(st, aktiv),
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

    return await mit_wiederholung(db, rechnen)
