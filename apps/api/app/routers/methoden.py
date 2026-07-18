"""Modul Methoden — Sammlung von Unterrichtseinstiegen und -methoden.

Eigenstaendig (Regel 3): eigene Eintraege, keine Abhaengigkeit. Der Kalender
kann optional eine Methode an eine Stunde haengen (CalendarEntry.method_id,
ON DELETE SET NULL) — das ist Zusatz, keine Voraussetzung.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Method, User
from .auth import get_current_user, rate_limit
from .modules import is_active

router = APIRouter(prefix="/api/methoden", tags=["methoden"])
MODULE_KEY = "methoden"


async def require_module(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> User:
    if not await is_active(db, user.id, MODULE_KEY):
        raise HTTPException(403, "Modul Methoden ist nicht aktiviert")
    return user


# Kleine Startsammlung typischer Einstiege/Methoden — wird einmalig angelegt,
# wenn die Lehrkraft noch keine eigenen Eintraege hat.
_SEED = [
    ("einstieg", "Blitzlicht", "Reihum ein kurzer Satz zum Thema/zur Stimmung — schneller Stimmungs- und Vorwissenscheck.", "Einstieg"),
    ("einstieg", "Impulsbild", "Ein Bild/Zitat projizieren und offene Fragen sammeln — weckt Neugier und aktiviert Vorwissen.", "Einstieg"),
    ("einstieg", "Provokante These", "Eine zugespitzte Aussage in den Raum stellen, Zustimmung/Ablehnung per Positionslinie.", "Einstieg"),
    ("methode", "Think-Pair-Share", "Erst allein denken, dann zu zweit austauschen, dann im Plenum teilen.", "Erarbeitung"),
    ("methode", "Placemat", "Gruppentisch: erst jede/r in sein Feld, dann gemeinsame Mitte — sichert Einzelbeitraege.", "Erarbeitung"),
    ("methode", "Gruppenpuzzle", "Expertengruppen erarbeiten Teilthemen, Stammgruppen tragen zusammen.", "Erarbeitung"),
    ("methode", "Museumsrundgang", "Ergebnisse aushaengen, Gruppen wandern und geben Feedback per Klebepunkt.", "Sicherung"),
    ("methode", "Exit Ticket", "Kurze schriftliche Rueckmeldung am Stundenende (Was mitgenommen? Was offen?).", "Sicherung"),
]


class MethodIn(BaseModel):
    kind: str = "einstieg"
    title: str = ""
    description: str = ""
    phase: str = ""


class MethodOut(MethodIn):
    id: int
    model_config = {"from_attributes": True}


@router.get("/list", response_model=List[MethodOut])
async def list_methods(user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Method).where(Method.owner_id == user.id).order_by(Method.kind, Method.title))).scalars().all()
    if not rows:
        # Einmalig die Startsammlung anlegen.
        for kind, title, desc, phase in _SEED:
            db.add(Method(owner_id=user.id, kind=kind, title=title, description=desc, phase=phase))
        await db.commit()
        rows = (await db.execute(select(Method).where(Method.owner_id == user.id).order_by(Method.kind, Method.title))).scalars().all()
    return rows


@router.post("/", response_model=MethodOut, status_code=201)
async def create_method(body: MethodIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("methoden", f"u{user.id}", 200, 60, "Zu viele Eintraege. Bitte kurz warten.")
    m = Method(owner_id=user.id, **body.model_dump())
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return m


@router.put("/{method_id}", response_model=MethodOut)
async def update_method(method_id: int, body: MethodIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    m = await db.get(Method, method_id)
    if not m or m.owner_id != user.id:
        raise HTTPException(404, "Eintrag nicht gefunden")
    for k, v in body.model_dump().items():
        setattr(m, k, v)
    await db.commit()
    await db.refresh(m)
    return m


@router.delete("/{method_id}", status_code=204)
async def delete_method(method_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    m = await db.get(Method, method_id)
    if not m or m.owner_id != user.id:
        raise HTTPException(404, "Eintrag nicht gefunden")
    await db.delete(m)
    await db.commit()
