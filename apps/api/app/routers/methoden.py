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


# Kleine Startsammlung typischer Einstiege — wird einmalig angelegt, wenn die
# Lehrkraft noch keine eigenen Eintraege hat. (title, idee, ablauf, material, dauer)
_SEED = [
    ("Blitzlicht", "Reihum ein kurzer Satz zum Thema oder zur Stimmung — schneller Stimmungs- und Vorwissenscheck.",
     "1. Impulsfrage stellen.\n2. Reihum je ein Satz, ohne Kommentare.\n3. Auffaelliges kurz aufgreifen.", "keins", 5),
    ("Impulsbild", "Ein Bild oder Zitat projizieren und offene Fragen sammeln — weckt Neugier und aktiviert Vorwissen.",
     "1. Bild zeigen, 1 Minute wirken lassen.\n2. Beobachtungen/Fragen sammeln.\n3. Zum Thema ueberleiten.", "Beamer, Bild/Zitat", 10),
    ("Provokante These", "Eine zugespitzte Aussage in den Raum stellen, Zustimmung/Ablehnung per Positionslinie.",
     "1. These an die Tafel.\n2. SuS positionieren sich im Raum.\n3. Einzelne begruenden.", "Tafel, ggf. Klebeband fuer Linie", 10),
]


class MethodIn(BaseModel):
    title: str = ""
    description: str = ""   # die Idee
    ablauf: str = ""
    material: str = ""
    dauer: Optional[int] = None
    # Altfelder, weiterhin akzeptiert, aber nicht mehr genutzt.
    kind: str = "einstieg"
    phase: str = ""


class MethodOut(MethodIn):
    id: int
    model_config = {"from_attributes": True}


@router.get("/list", response_model=List[MethodOut])
async def list_methods(user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Method).where(Method.owner_id == user.id).order_by(Method.title))).scalars().all()
    if not rows and not user.methoden_seeded:
        # Startsammlung genau EINMAL anlegen (Kennenlernen). Loescht die Lehrkraft
        # danach alles, bleibt es leer — das Flag verhindert erneutes Seeden.
        for title, idee, ablauf, material, dauer in _SEED:
            db.add(Method(owner_id=user.id, title=title, description=idee, ablauf=ablauf, material=material, dauer=dauer))
        user.methoden_seeded = True
        await db.commit()
        rows = (await db.execute(select(Method).where(Method.owner_id == user.id).order_by(Method.title))).scalars().all()
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


@router.get("/export")
async def export_einstiege(user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Method).where(Method.owner_id == user.id).order_by(Method.title))).scalars().all()
    return {
        "type": "nuvora_einstiege", "version": 1,
        "items": [{"title": m.title, "description": m.description, "ablauf": m.ablauf, "material": m.material, "dauer": m.dauer} for m in rows],
    }


@router.post("/import")
async def import_einstiege(body: dict, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    if body.get("type") != "nuvora_einstiege":
        raise HTTPException(400, "Falsches Dateiformat")
    items = body.get("items") or []
    if len(items) > 500:
        raise HTTPException(400, "Zu viele Einträge")
    n = 0
    for it in items:
        title = (it.get("title") or "").strip()
        if not title:
            continue
        d = it.get("dauer")
        db.add(Method(owner_id=user.id, title=title[:200], description=it.get("description") or "",
                      ablauf=it.get("ablauf") or "", material=it.get("material") or "",
                      dauer=int(d) if isinstance(d, (int, float)) else None))
        n += 1
    await db.commit()
    return {"imported": n}


@router.delete("/{method_id}", status_code=204)
async def delete_method(method_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    m = await db.get(Method, method_id)
    if not m or m.owner_id != user.id:
        raise HTTPException(404, "Eintrag nicht gefunden")
    await db.delete(m)
    await db.commit()
