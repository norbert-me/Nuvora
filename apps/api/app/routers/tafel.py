"""Modul Tafel — gespeicherte Tafeln.

Die Tafel selbst ist reines Frontend (Textfelder auf einer Flaeche). Was hier
liegt, ist nur ihr Gedaechtnis: eine Lehrkraft bereitet den Arbeitsauftrag am
Abend vor und will ihn am Rechner im Klassenraum wiederfinden — das kann der
localStorage nicht, und zwei Tafeln nebeneinander kann er auch nicht.

Zwei Entscheidungen:

  * **Die ganze Tafel ist EIN Datensatz** (`items` als JSON). Es gibt keine
    Abfrage, die ein einzelnes Textfeld sucht; gelesen und geschrieben wird
    immer alles. Eine Tabelle je Element waere Aufwand ohne Frage dahinter.
  * **Der Server prueft die FORM, nicht den Inhalt** — wie beim PAP-Editor:
    bekannte Felder, Groessengrenzen, Zahlen als Zahlen. Was fachlich sinnvoll
    ist, entscheidet die Tafel, nicht die Datenbank.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..besitz import eigenes
from ..database import get_db
from ..models import TafelBoard, User
from .modules import modul_pflicht

router = APIRouter(prefix="/api/tafel", tags=["tafel"])
MODULE_KEY = "tafel"

require_module = modul_pflicht(MODULE_KEY)

# Grenzen. Sie schuetzen die Datenbank, nicht die Didaktik: eine Tafel mit
# hundert Feldern liest am Beamer ohnehin niemand mehr.
MAX_ITEMS = 100
MAX_TEXT = 5000
MAX_TAFELN = 100


class TafelIn(BaseModel):
    name: str = ""
    items: List[dict] = []


class TafelPatch(BaseModel):
    name: Optional[str] = None
    items: Optional[List[dict]] = None


def _items(roh) -> list:
    """Die Elemente auf ihre Form bringen — unbekannte Schluessel fallen weg."""
    aus = []
    for it in (roh or [])[:MAX_ITEMS]:
        if not isinstance(it, dict):
            continue
        sauber = {"id": str(it.get("id") or "")[:40], "type": str(it.get("type") or "text")[:20]}
        for zahl in ("x", "y", "w", "h", "fontSize"):
            try:
                sauber[zahl] = float(it.get(zahl) or 0)
            except (TypeError, ValueError):
                sauber[zahl] = 0
        for text in ("text", "color", "bold", "align", "bis", "titel", "kurs_id", "_ref"):
            if text in it:
                wert = it[text]
                sauber[text] = wert[:MAX_TEXT] if isinstance(wert, str) else wert
        aus.append(sauber)
    return aus


def _out(b: TafelBoard) -> dict:
    return {"id": b.id, "name": b.name or "", "items": b.items or [],
            "updated_at": b.updated_at.isoformat() if b.updated_at else None}


@router.get("")
async def list_tafeln(user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Nur Namen und Stand — die Elemente kommen beim Oeffnen einer Tafel."""
    rows = (await db.execute(select(TafelBoard).where(TafelBoard.owner_id == user.id)
                             .order_by(TafelBoard.name, TafelBoard.id))).scalars().all()
    return [{"id": b.id, "name": b.name or "",
             "updated_at": b.updated_at.isoformat() if b.updated_at else None} for b in rows]


@router.get("/{tafel_id}")
async def get_tafel(tafel_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    return _out(await eigenes(db, TafelBoard, tafel_id, user, "Tafel nicht gefunden"))


@router.post("", status_code=201)
async def create_tafel(body: TafelIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    name = (body.name or "").strip()[:120]
    if not name:
        raise HTTPException(400, "Name fehlt")
    anzahl = len((await db.execute(select(TafelBoard.id).where(TafelBoard.owner_id == user.id))).all())
    if anzahl >= MAX_TAFELN:
        raise HTTPException(400, f"Mehr als {MAX_TAFELN} Tafeln gehen nicht")
    b = TafelBoard(owner_id=user.id, name=name, items=_items(body.items))
    db.add(b)
    await db.commit()
    await db.refresh(b)
    return _out(b)


@router.put("/{tafel_id}")
async def update_tafel(tafel_id: int, body: TafelPatch, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    b = await eigenes(db, TafelBoard, tafel_id, user, "Tafel nicht gefunden")
    if body.name is not None:
        neu = body.name.strip()[:120]
        if neu:
            b.name = neu
    if body.items is not None:
        b.items = _items(body.items)
    await db.commit()
    await db.refresh(b)
    return _out(b)


@router.delete("/{tafel_id}", status_code=204)
async def delete_tafel(tafel_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    b = await eigenes(db, TafelBoard, tafel_id, user, "Tafel nicht gefunden")
    await db.delete(b)
    await db.commit()
