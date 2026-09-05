"""Gemeinsamer Papierkorb (Kern).

Jedes Modul hatte seinen eigenen Papierkorb — Klassen unter /classes, Kurse
unter /kurse, Stapel und Karten im Modul Karten, Lernpfade und Lernleitern im
Lernpfad. Wer etwas suchte, musste wissen, wo es gelöscht wurde.

Der Papierkorb gehört deshalb in den Kern: eine Liste über alles, was der
Lehrkraft gehört und ein deleted_at trägt. Die Module behalten ihre eigenen
Endpunkte (Löschen bleibt dort, wo es passiert); Wiederherstellen und
endgültiges Löschen ruft dieselben Funktionen auf — eine Quelle der Wahrheit
für die Semantik (Kurs-Mitgliedschaften, Kaskaden, Eltern-Prüfungen).

Regel 3 bleibt gewahrt: der Kern liest hier nur Spalten der Modul-Tabellen, die
ohnehin in models.py stehen. Ein deaktiviertes Modul blendet seine Einträge
nicht aus — was gelöscht wurde, bleibt wiederherstellbar.
"""
from datetime import datetime, timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import (Card, CardDeck, Kurs, LearningLadder, LearningPath, Question,
                      QuestionSet, QuestionSetItem, PapAufgabe, SchoolClass, Student, Topic,
                      User)
from .auth import get_current_user
from . import classes as classes_router
from . import karten as karten_router
from . import kurse as kurse_router
from . import lernpfad as lernpfad_router
from . import pap as pap_router
from . import questions as questions_router
from . import topics as topics_router

router = APIRouter(prefix="/api/trash", tags=["trash"])

# Frist bis zum endgültigen Löschen (siehe Aufräumjob in main.py).
AUFBEWAHRUNG_TAGE = 30


class TrashItem(BaseModel):
    kind: str            # class | kurs | path | ladder | deck | card | question | topic
    id: int
    label: str
    context: str = ""    # Wo es lag (Klasse, Pfad, Stapel)
    art: str             # Anzeigename der Art
    modul: str           # kern | lernpfad | karten
    deleted_at: datetime
    purge_at: datetime


def _kurz(text: str, n: int = 60) -> str:
    t = " ".join((text or "").split())
    return t if len(t) <= n else t[: n - 1] + "…"


@router.get("", response_model=List[TrashItem])
async def list_trash(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Alles Gelöschte der Lehrkraft, neueste zuerst."""
    items: List[TrashItem] = []

    def add(kind: str, oid: int, label: str, art: str, modul: str, deleted_at: datetime, context: str = ""):
        items.append(TrashItem(
            kind=kind, id=oid, label=label or "(ohne Namen)", context=context, art=art, modul=modul,
            deleted_at=deleted_at, purge_at=deleted_at + timedelta(days=AUFBEWAHRUNG_TAGE),
        ))

    # ── Kern ──
    kurse = (await db.execute(select(Kurs).where(
        Kurs.owner_id == user.id, Kurs.deleted_at.is_not(None)))).scalars().all()
    for k in kurse:
        add("kurs", k.id, k.name, "Kurs", "kern", k.deleted_at)

    klassen = (await db.execute(select(SchoolClass).where(
        SchoolClass.owner_id == user.id, SchoolClass.deleted_at.is_not(None)))).scalars().all()
    anzahl: dict = {}
    if klassen:
        rows = (await db.execute(select(Student.class_id).where(
            Student.class_id.in_([c.id for c in klassen])))).scalars().all()
        for cid in rows:
            anzahl[cid] = anzahl.get(cid, 0) + 1
    for c in klassen:
        n = anzahl.get(c.id, 0)
        add("class", c.id, c.name, "Klasse", "kern", c.deleted_at, f"{n} Schüler" if n else "")

    # ── Lernpfad ──
    pfade = (await db.execute(select(LearningPath).where(
        LearningPath.owner_id == user.id, LearningPath.deleted_at.is_not(None)))).scalars().all()
    for p in pfade:
        add("path", p.id, p.name, "Lernpfad", "lernpfad", p.deleted_at)

    leitern = (await db.execute(
        select(LearningLadder, LearningPath.name, Topic.name)
        .join(LearningPath, LearningLadder.path_id == LearningPath.id)
        .outerjoin(Topic, LearningLadder.topic_id == Topic.id)
        .where(LearningPath.owner_id == user.id, LearningLadder.deleted_at.is_not(None))
    )).all()
    for ll, pfad_name, thema in leitern:
        add("ladder", ll.id, thema or f"Stufe {ll.position + 1}", "Lernleiter", "lernpfad", ll.deleted_at, pfad_name or "")

    # ── PAP ──
    pap = (await db.execute(select(PapAufgabe).where(
        PapAufgabe.owner_id == user.id, PapAufgabe.deleted_at.is_not(None)))).scalars().all()
    for a in pap:
        add("pap", a.id, a.title, "PAP-Aufgabe", "pap", a.deleted_at)

    # ── Karten ──
    decks = (await db.execute(
        select(CardDeck, SchoolClass.name)
        .outerjoin(SchoolClass, CardDeck.class_id == SchoolClass.id)
        .where(CardDeck.owner_id == user.id, CardDeck.deleted_at.is_not(None))
    )).all()
    for d, cls_name in decks:
        add("deck", d.id, d.name, "Kartenstapel", "karten", d.deleted_at, cls_name or "")

    karten = (await db.execute(
        select(Card.id, Card.front, Card.deleted_at, CardDeck.name)
        .join(CardDeck, Card.deck_id == CardDeck.id)
        .where(CardDeck.owner_id == user.id, Card.deleted_at.is_not(None))
    )).all()
    for cid, front, gel, deck_name in karten:
        add("card", cid, _kurz(front), "Karte", "karten", gel, deck_name or "")

    # ── CardVote-Fragen ──
    #
    # Der Kontext ist hier wichtiger als bei allem anderen: „Berechne: 3 · 2/7"
    # sagt nicht, aus welchem Quiz die Frage stammt.
    fragen = (await db.execute(
        select(Question, QuestionSet.name)
        .outerjoin(QuestionSetItem, QuestionSetItem.question_id == Question.id)
        .outerjoin(QuestionSet, QuestionSet.id == QuestionSetItem.question_set_id)
        .where(Question.owner_id == user.id, Question.deleted_at.is_not(None))
    )).all()
    gesehen = set()
    for q, set_name in fragen:
        if q.id in gesehen:
            continue          # dieselbe Frage kann in mehreren Quizzen stecken
        gesehen.add(q.id)
        add("question", q.id, _kurz(q.text), "Frage", "cardvote", q.deleted_at, set_name or "")

    # ── Themen (Kern) ──
    #
    # Nur das oberste geloeschte Thema eines Astes: beim Loeschen wandern die
    # Unterthemen mit, und eine Liste aus zehn Zeilen fuer einen Klick waere
    # kein Papierkorb, sondern ein Protokoll.
    themen = (await db.execute(select(Topic).where(
        Topic.owner_id == user.id, Topic.deleted_at.is_not(None)))).scalars().all()
    geloescht_ids = {t.id for t in themen}
    namen = {t.id: t.name for t in (await db.execute(
        select(Topic).where(Topic.owner_id == user.id))).scalars().all()}
    for t in themen:
        if t.parent_id in geloescht_ids:
            continue
        add("topic", t.id, t.name, "Thema", "kern", t.deleted_at,
            namen.get(t.parent_id, "") if t.parent_id else "")

    items.sort(key=lambda i: i.deleted_at, reverse=True)
    return items


# kind → (restore, purge). Beide Funktionen kommen aus den Modul-Routern, damit
# die Semantik (Mitgliedschaften, Kaskaden, Eltern-Prüfung) nur einmal existiert.
_AKTIONEN = {
    "class": (classes_router.restore_class, classes_router.purge_class),
    "kurs": (kurse_router.restore_kurs, kurse_router.purge_kurs),
    "path": (lernpfad_router.restore_path, lernpfad_router.purge_path),
    "ladder": (lernpfad_router.restore_ladder, lernpfad_router.purge_ladder),
    "deck": (karten_router.restore_deck, karten_router.purge_deck),
    "card": (karten_router.restore_card, karten_router.purge_card),
    "question": (questions_router.restore_question, questions_router.purge_question),
    "topic": (topics_router.restore_topic, topics_router.purge_topic),
    "pap": (pap_router.restore_aufgabe, pap_router.purge_aufgabe),
}


def _aktion(kind: str, idx: int):
    if kind not in _AKTIONEN:
        raise HTTPException(404, "Unbekannte Art")
    return _AKTIONEN[kind][idx]


async def _im_papierkorb(kind: str, obj_id: int, user: User, db: AsyncSession) -> None:
    """Der Papierkorb fasst nur an, was auch wirklich darin liegt — und der
    Lehrkraft gehört. Nicht jede Modul-Funktion prüft das deleted_at selbst
    (purge_card tat es nicht): über diesen Router liess sich sonst eine
    LEBENDE Karte endgültig löschen. Und doppeltes Wiederherstellen soll
    ehrlich scheitern statt still nichts zu tun."""
    if kind not in _AKTIONEN:
        raise HTTPException(404, "Unbekannte Art")
    items = await list_trash(user, db)
    if not any(i.kind == kind and i.id == obj_id for i in items):
        raise HTTPException(404, "Liegt nicht im Papierkorb")


@router.post("/{kind}/{obj_id}/restore", status_code=204)
async def restore_item(kind: str, obj_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Zurückholen. Die Modul-Funktion prüft Besitz und Sonderfälle."""
    await _im_papierkorb(kind, obj_id, user, db)
    await _aktion(kind, 0)(obj_id, user, db)


@router.delete("/{kind}/{obj_id}", status_code=204)
async def purge_item(kind: str, obj_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Endgültig löschen. Erst hier greifen die Kaskaden."""
    await _im_papierkorb(kind, obj_id, user, db)
    await _aktion(kind, 1)(obj_id, user, db)


# Reihenfolge beim Leeren: Kinder vor ihren Eltern, damit die Kaskade des
# Elternteils nicht ins Leere greift. Was hier nicht genannt ist, hängt
# hinten dran — und genau das ist der Punkt: „leeren" war die eine Stelle, die
# eine neue Art vergaß. Fragen und Themen standen in `_AKTIONEN` und in der
# Liste, aber nicht in dieser Reihenfolge; sie blieben nach dem Leeren liegen,
# und die Antwort war trotzdem 204.
_LEER_ZUERST = ["card", "ladder", "deck", "path", "class", "kurs"]
LEER_REIHENFOLGE = _LEER_ZUERST + [k for k in _AKTIONEN if k not in _LEER_ZUERST]


@router.delete("", status_code=204)
async def empty_trash(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Papierkorb leeren — alles endgültig löschen (siehe LEER_REIHENFOLGE)."""
    reihenfolge = LEER_REIHENFOLGE
    items = await list_trash(user, db)
    nach_art = {k: [i.id for i in items if i.kind == k] for k in reihenfolge}
    for kind in reihenfolge:
        purge = _AKTIONEN[kind][1]
        for oid in nach_art[kind]:
            try:
                await purge(oid, user, db)
            except HTTPException:
                # Schon mit dem Elternteil weg — kein Grund zum Abbruch.
                await db.rollback()
