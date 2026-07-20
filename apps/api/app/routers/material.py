"""Material-/Dateiablage der Lehrkraft.

Kern-Funktion (kein Modul-Gate): haengt an Themen (Kern) und optional an einen
Kalender-Eintrag (Stunde). Reine private Ablage — nichts wird geteilt, nichts
geht in den Marktplatz oder einen Export an Dritte. Inhalt liegt in der DB und
faellt mit dem Konto weg (owner_id CASCADE).
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Material, Topic, CalendarEntry, User
from .auth import get_current_user, rate_limit

router = APIRouter(prefix="/api/material", tags=["material"])

MAX_BYTES = 15 * 1024 * 1024  # 15 MB je Datei — reicht fuer Arbeitsblaetter/PDFs


class MaterialOut(BaseModel):
    id: int
    topic_id: Optional[int] = None
    entry_id: Optional[int] = None
    filename: str
    mime: str
    size: int
    model_config = {"from_attributes": True}


async def _check_topic(db: AsyncSession, user_id: int, topic_id: Optional[int]) -> Optional[int]:
    if topic_id is None:
        return None
    ok = (await db.execute(select(Topic.id).where(Topic.id == topic_id, Topic.owner_id == user_id))).scalar_one_or_none()
    if not ok:
        raise HTTPException(404, "Thema nicht gefunden")
    return topic_id


async def _check_entry(db: AsyncSession, user_id: int, entry_id: Optional[int]) -> Optional[int]:
    if entry_id is None:
        return None
    ok = (await db.execute(select(CalendarEntry.id).where(CalendarEntry.id == entry_id, CalendarEntry.owner_id == user_id))).scalar_one_or_none()
    if not ok:
        raise HTTPException(404, "Kalender-Eintrag nicht gefunden")
    return entry_id


@router.get("", response_model=List[MaterialOut])
async def list_material(topic_id: Optional[int] = None, entry_id: Optional[int] = None,
                        user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Material der Lehrkraft, gefiltert nach Thema und/oder Stunde."""
    q = select(Material).where(Material.owner_id == user.id)
    if topic_id is not None:
        q = q.where(Material.topic_id == topic_id)
    if entry_id is not None:
        q = q.where(Material.entry_id == entry_id)
    rows = (await db.execute(q.order_by(Material.created_at.desc()))).scalars().all()
    return rows


@router.post("", response_model=MaterialOut, status_code=201)
async def upload_material(file: UploadFile = File(...), topic_id: Optional[int] = Form(None),
                          entry_id: Optional[int] = Form(None),
                          user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rate_limit("material_up", f"u{user.id}", 60, 60, "Zu viele Uploads. Bitte kurz warten.")
    if topic_id is None and entry_id is None:
        raise HTTPException(400, "Material braucht ein Thema oder eine Stunde")
    topic_id = await _check_topic(db, user.id, topic_id)
    entry_id = await _check_entry(db, user.id, entry_id)
    data = await file.read()
    if not data:
        raise HTTPException(400, "Datei ist leer")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Datei zu groß (max. 15 MB)")
    m = Material(owner_id=user.id, topic_id=topic_id, entry_id=entry_id,
                 filename=(file.filename or "datei")[:255], mime=(file.content_type or "")[:120],
                 size=len(data), data=data)
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return m


@router.get("/{material_id}/download")
async def download_material(material_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    m = await db.get(Material, material_id)
    if not m or m.owner_id != user.id:
        raise HTTPException(404, "Material nicht gefunden")
    safe = m.filename.replace("\r", " ").replace("\n", " ").replace('"', "'")
    # Inline nur fuer sichere, nicht-skriptfaehige Typen (PDF, Rasterbilder).
    # Alles andere — besonders HTML/SVG — als Download, damit hochgeladener Code
    # nicht im eigenen Origin ausgefuehrt wird (SVG kann Skript tragen).
    inline_ok = {"application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"}
    disp = "inline" if (m.mime in inline_ok) else "attachment"
    return Response(content=m.data, media_type=m.mime or "application/octet-stream",
                    headers={"Content-Disposition": f'{disp}; filename="{safe}"',
                             "X-Content-Type-Options": "nosniff"})


@router.delete("/{material_id}", status_code=204)
async def delete_material(material_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    m = await db.get(Material, material_id)
    if not m or m.owner_id != user.id:
        raise HTTPException(404, "Material nicht gefunden")
    await db.delete(m)
    await db.commit()
