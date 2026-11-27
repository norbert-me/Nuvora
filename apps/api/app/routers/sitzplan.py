"""Modul Sitzplan — ein Rasterlayout je Klasse auf dem Nuvora-Kern.

Eigenstaendig (Regel 3): speichert nur Positionen (Schueler bleiben im Kern).
`data` = { "cols": int, "cells": [studentId|null, ...] }.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..besitz import klasse_oder_403, kurs_oder_klasse
from ..database import get_db
from ..kursmitglieder import eigener_kurs
from ..models import SchoolClass, SeatingPlan, SegelStatus, Student, User
from .auth import rate_limit
from .modules import modul_pflicht

router = APIRouter(prefix="/api/sitzplan", tags=["sitzplan"])
# Sitzplan lebt jetzt als Tab im Modul „Orga" — daher über orga gegated.
MODULE_KEY = "orga"


require_module = modul_pflicht(MODULE_KEY)


# Frueher stand die Klassenpruefung in fuenf Routern wortgleich; jetzt eine
# Quelle (app/besitz.py). Der alte Name bleibt, damit die Aufrufer unberuehrt
# sind.
_owned_class = klasse_oder_403


class PlanIn(BaseModel):
    # Freie Flaeche: Sitze als {sid, x, y, rot}. (Alt: cols/cells-Raster.)
    seats: list = []
    # Bewegliche Tafel als {x, y, rot}. Optional.
    tafel: Optional[dict] = None


def _key_where(user, class_id, kurs_id):
    """Sitzplan haengt am Kurs (Fach); Fallback Klasse ohne Kurs.

    Die Schluesselregel steht seit dem Zusammenfuehren in
    `app/besitz.kurs_oder_klasse` — sie lag fuenfmal als eigenes `_key_where`
    herum und unterschied sich nur im Modell. Liste von WHERE-Bedingungen
    (unterschiedlich lang) — immer per * entpackt."""
    return kurs_oder_klasse(SeatingPlan, user, class_id, kurs_id)


async def _plan(db, user, class_id, kurs_id, plan_id):
    """Der gewaehlte Plan dieses Kurses (plan_id), sonst der erste. Ein plan_id, der nicht zu diesem Kurs gehoert,
    ist 404 — sonst schriebe man ueber eine fremde ID in einen anderen Plan."""
    q = select(SeatingPlan).where(*_key_where(user, class_id, kurs_id))
    if plan_id is not None:
        row = (await db.execute(q.where(SeatingPlan.id == plan_id))).scalar_one_or_none()
        if row is None:
            raise HTTPException(404, "Sitzplan nicht gefunden")
        return row
    return (await db.execute(q.order_by(SeatingPlan.id).limit(1))).scalar_one_or_none()


@router.get("/{class_id}")
async def get_plan(class_id: int, kurs_id: Optional[int] = None, plan_id: Optional[int] = None,
                   user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    row = await _plan(db, user, class_id, kurs_id, plan_id)
    return row.data if row and row.data else {"seats": []}


def _num(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


@router.put("/{class_id}")
async def put_plan(class_id: int, body: PlanIn, kurs_id: Optional[int] = None, plan_id: Optional[int] = None,
                   user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("sitzplan", f"u{user.id}", 300, 60, "Zu viele Änderungen. Bitte kurz warten.")
    await _owned_class(db, user, class_id)
    if kurs_id is not None:   # fremde Kurs-ID nicht in eigene Zeilen schreiben
        await eigener_kurs(db, user, kurs_id)
    seats = []
    for s in (body.seats or [])[:400]:
        if not isinstance(s, dict) or not isinstance(s.get("sid"), (int, float)):
            continue
        seats.append({
            "sid": int(s["sid"]),
            "x": round(_num(s.get("x")), 1),
            "y": round(_num(s.get("y")), 1),
            "rot": round(_num(s.get("rot")), 1),
        })
    data = {"seats": seats}
    if isinstance(body.tafel, dict):
        data["tafel"] = {"x": round(_num(body.tafel.get("x")), 1), "y": round(_num(body.tafel.get("y")), 1),
                         "rot": round(_num(body.tafel.get("rot")), 1)}
    row = await _plan(db, user, class_id, kurs_id, plan_id)
    if row:
        row.data = data
    else:
        db.add(SeatingPlan(owner_id=user.id, class_id=class_id, kurs_id=kurs_id, data=data))
    await db.commit()
    return data


# ─── Mehrere Plaene je Kurs (Klassenraum, Computerraum …) ───

class PlanNeu(BaseModel):
    name: str = ""
    kopie_von: Optional[int] = None   # Plaetze eines bestehenden Plans uebernehmen


class PlanName(BaseModel):
    name: str


@router.get("/{class_id}/plaene")
async def list_plaene(class_id: int, kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    rows = (await db.execute(select(SeatingPlan).where(*_key_where(user, class_id, kurs_id)).order_by(SeatingPlan.id))).scalars().all()
    return [{"id": r.id, "name": r.name or ""} for r in rows]


@router.post("/{class_id}/plaene", status_code=201)
async def neuer_plan(class_id: int, body: PlanNeu, kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("sitzplan", f"u{user.id}", 300, 60, "Zu viele Änderungen. Bitte kurz warten.")
    await _owned_class(db, user, class_id)
    if kurs_id is not None:
        await eigener_kurs(db, user, kurs_id)
    anzahl = len((await db.execute(select(SeatingPlan.id).where(*_key_where(user, class_id, kurs_id)))).all())
    if anzahl >= 10:
        raise HTTPException(409, "Höchstens 10 Sitzpläne je Kurs")
    data = {"seats": []}
    if body.kopie_von is not None:
        quelle = await _plan(db, user, class_id, kurs_id, body.kopie_von)
        data = dict(quelle.data or {"seats": []})
    row = SeatingPlan(owner_id=user.id, class_id=class_id, kurs_id=kurs_id, name=(body.name or "").strip()[:80], data=data)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return {"id": row.id, "name": row.name}


async def _eigener_plan(db, user, plan_id) -> SeatingPlan:
    row = await db.get(SeatingPlan, plan_id)
    if row is None or row.owner_id != user.id:
        raise HTTPException(404, "Sitzplan nicht gefunden")
    return row


@router.patch("/plaene/{plan_id}")
async def plan_umbenennen(plan_id: int, body: PlanName, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    row = await _eigener_plan(db, user, plan_id)
    row.name = (body.name or "").strip()[:80]
    await db.commit()
    return {"id": row.id, "name": row.name}


@router.delete("/plaene/{plan_id}", status_code=204)
async def plan_loeschen(plan_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    row = await _eigener_plan(db, user, plan_id)
    await db.delete(row)
    await db.commit()


# ─── SEGEL-Stufen (Helios-Konzept): Hafen → Küste → Meer → Welt ───
# Je Schueler eine Stufe, pro Kurs (Fallback Klasse). Wird am Sitzplatz angezeigt.
SEGEL_STAGES = {"hafen", "kueste", "meer", "welt", ""}


def _segel_where(user, class_id, kurs_id):
    """SEGEL-Stufe haengt am Kurs (Fach); Fallback Klasse ohne Kurs.

    Die Schluesselregel steht seit dem Zusammenfuehren in
    `app/besitz.kurs_oder_klasse` — sie lag fuenfmal als eigenes `_key_where`
    herum und unterschied sich nur im Modell. Liste von WHERE-Bedingungen
    (unterschiedlich lang) — immer per * entpackt."""
    return kurs_oder_klasse(SegelStatus, user, class_id, kurs_id)


class SegelIn(BaseModel):
    student_id: int
    stage: str = ""


@router.get("/{class_id}/segel")
async def get_segel(class_id: int, kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    rows = (await db.execute(select(SegelStatus).where(*_segel_where(user, class_id, kurs_id)))).scalars().all()
    return {str(r.student_id): r.stage for r in rows if r.stage}


@router.put("/{class_id}/segel")
async def set_segel(class_id: int, body: SegelIn, kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("segel", f"u{user.id}", 300, 60, "Zu viele Änderungen. Bitte kurz warten.")
    await _owned_class(db, user, class_id)
    if kurs_id is not None:   # fremde Kurs-ID nicht in eigene Zeilen schreiben
        await eigener_kurs(db, user, kurs_id)
    if body.stage not in SEGEL_STAGES:
        raise HTTPException(400, "Ungültige SEGEL-Stufe")
    # Schueler muss der Lehrkraft gehoeren (ueber die Klasse).
    st = await db.get(Student, body.student_id)
    if not st:
        raise HTTPException(404, "Schüler nicht gefunden")
    owner = (await db.execute(select(SchoolClass.owner_id).where(SchoolClass.id == st.class_id))).scalar_one_or_none()
    if owner and owner != user.id:
        raise HTTPException(403, "Keine Berechtigung")
    row = (await db.execute(select(SegelStatus).where(*_segel_where(user, class_id, kurs_id), SegelStatus.student_id == body.student_id))).scalar_one_or_none()
    if row:
        row.stage = body.stage
    elif body.stage:
        db.add(SegelStatus(owner_id=user.id, student_id=body.student_id, class_id=class_id, kurs_id=kurs_id, stage=body.stage))
    await db.commit()
    return {"ok": True}
