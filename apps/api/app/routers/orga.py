"""Modul Orga — Sammel-/Orga-Checklisten je Klasse.

Eigenständig (Regel 3): Schüler kommen aus dem Kern, hier liegen nur die
Orga-Punkte und wer sie erledigt hat. Beispiel: „Unterschrift der Klassenarbeit
gesehen" — je Schüler abhaken.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..besitz import eigenes, klasse_oder_403, kurs_oder_klasse
from ..database import get_db
from ..schueler import in_klasse
from ..models import OrgaItem, User
from .auth import rate_limit
from .modules import modul_pflicht

router = APIRouter(prefix="/api/orga", tags=["orga"])
MODULE_KEY = "orga"


require_module = modul_pflicht(MODULE_KEY)


# Frueher stand die Klassenpruefung in fuenf Routern wortgleich; jetzt eine
# Quelle (app/besitz.py). Der alte Name bleibt, damit die Aufrufer unberuehrt
# sind.
_owned_class = klasse_oder_403


async def _owned_item(db, user, item_id) -> OrgaItem:
    # War der uebliche Dreizeiler „holen, owner_id vergleichen, sonst 404" —
    # der stand in jedem Router noch einmal und heisst jetzt `besitz.eigenes`.
    return await eigenes(db, OrgaItem, item_id, user, "Punkt nicht gefunden")


class ItemIn(BaseModel):
    name: str


class ItemOut(BaseModel):
    id: int
    name: str
    position: int
    done: list = []
    model_config = {"from_attributes": True}


class ToggleIn(BaseModel):
    student_id: int


def _key_where(user, class_id, kurs_id):
    """Checkliste haengt am Kurs (Fach); Fallback Klasse ohne Kurs.

    Die Schluesselregel steht seit dem Zusammenfuehren in
    `app/besitz.kurs_oder_klasse` — sie lag fuenfmal als eigenes `_key_where`
    herum und unterschied sich nur im Modell. Liste von WHERE-Bedingungen
    (unterschiedlich lang) — immer per * entpackt."""
    return kurs_oder_klasse(OrgaItem, user, class_id, kurs_id)


@router.get("/{class_id}", response_model=List[ItemOut])
async def list_items(class_id: int, kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    rows = (await db.execute(select(OrgaItem).where(*_key_where(user, class_id, kurs_id)).order_by(OrgaItem.position, OrgaItem.id))).scalars().all()
    return rows


@router.post("/{class_id}", response_model=ItemOut, status_code=201)
async def create_item(class_id: int, body: ItemIn, kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("orga", f"u{user.id}", 200, 60, "Zu viele Punkte. Bitte kurz warten.")
    await _owned_class(db, user, class_id)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Name darf nicht leer sein")
    pos = len((await db.execute(select(OrgaItem).where(*_key_where(user, class_id, kurs_id)))).scalars().all())
    it = OrgaItem(owner_id=user.id, class_id=class_id, kurs_id=kurs_id, name=name[:160], position=pos, done=[])
    db.add(it)
    await db.commit()
    await db.refresh(it)
    return it


@router.put("/item/{item_id}", response_model=ItemOut)
async def rename_item(item_id: int, body: ItemIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    it = await _owned_item(db, user, item_id)
    name = (body.name or "").strip()
    if name:
        it.name = name[:160]
    await db.commit()
    await db.refresh(it)
    return it


@router.delete("/item/{item_id}", status_code=204)
async def delete_item(item_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    it = await _owned_item(db, user, item_id)
    await db.delete(it)
    await db.commit()


@router.put("/item/{item_id}/toggle", response_model=ItemOut)
async def toggle(item_id: int, body: ToggleIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    it = await _owned_item(db, user, item_id)
    # Nur Schüler der Klasse zulassen.
    await in_klasse(db, body.student_id, it.class_id)
    done = list(it.done or [])
    if body.student_id in done:
        done.remove(body.student_id)
    else:
        done.append(body.student_id)
    it.done = done
    await db.commit()
    await db.refresh(it)
    return it
