"""Aus einer Sicherung zurückholen — Endpunkte (Kern, gilt für jedes Konto, nur für eigene Daten).

Die Rechnung steht in `app/wiederherstellung.py`; hier nur Zugang, Grenzen und Antwortform. Gehört dem
Kern, nicht einem Modul: gezeigt werden nur die Module, die diese Lehrkraft nutzt (Regel 3), die
Wiederherstellung selbst kennt jedes — ohne dass ein Modul das andere braucht.
"""
import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from .. import wiederherstellung as wh
from ..database import get_db
from ..models import User
from .auth import get_current_user, rate_limit
from .modules import REGISTRY, is_active

router = APIRouter(prefix="/api/wiederherstellung", tags=["wiederherstellung"])


class Vergleich(BaseModel):
    sicherung: str
    modul: str


class Auswahl(BaseModel):
    t: str
    id: int
    aktion: str


class Einspielen(BaseModel):
    sicherung: str
    modul: str
    auswahl: list[Auswahl]


def _pfad(name: str) -> str:
    """Sicherung nur aus dem Sicherungsordner, nur über die feste Namensliste (wie beim Admin-Weg)."""
    voll = wh.sicherungs_pfad(name)
    if voll is None:
        raise HTTPException(404, "Sicherung nicht gefunden")
    return voll


async def _module_des_kontos(db, user) -> dict[str, str]:
    namen = {m.key: m.name for m in REGISTRY}
    raus = {"kern": "Klassen, Kurse, Kinder, Themen"}
    for key in wh.MODULE:
        if key == "kern":
            continue
        if await is_active(db, user.id, key):
            raus[key] = namen.get(key, key)
    return raus


@router.get("/sicherungen")
async def sicherungen(user: User = Depends(get_current_user)):
    """Nur Name und Zeit — mehr braucht niemand, um zu wählen. Die Dateien selbst bleiben bei der Administration."""
    return wh.sicherungen_liste()


@router.get("/module")
async def module(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return [{"key": k, "name": n} for k, n in (await _module_des_kontos(db, user)).items()]


@router.post("/vergleich")
async def vergleich(body: Vergleich, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rate_limit("wh_vergleich", f"u{user.id}", 12, 60, "Zu viele Vergleiche. Bitte kurz warten.")
    if body.modul not in await _module_des_kontos(db, user):
        raise HTTPException(403, "Dieses Modul ist nicht aktiv")
    pfad = _pfad(body.sicherung)
    # Das Lesen der Datei ist Rechenarbeit, kein Warten auf die Datenbank: aus dem Ereignis-Takt heraushalten.
    sich = await asyncio.to_thread(wh.lies_sicherung, pfad, user.id, body.modul)
    heute = {}
    for t, rows in sich["zeilen"].items():
        heute[t] = await wh.lade_heute(db, t, rows.keys())
    eigene = await wh.eigene_ids_heute(db, user.id)
    erg = wh.vergleiche(sich, heute, eigene)
    await wh.anreichern(db, erg, sich)
    return {"sicherung": body.sicherung, "modul": body.modul, **erg}


@router.post("/wiederherstellen")
async def wiederherstellen(body: Einspielen, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rate_limit("wh_einspielen", f"u{user.id}", 6, 60, "Zu viele Wiederherstellungen. Bitte kurz warten.")
    if body.modul not in await _module_des_kontos(db, user):
        raise HTTPException(403, "Dieses Modul ist nicht aktiv")
    if not body.auswahl:
        raise HTTPException(400, "Nichts ausgewählt")
    if len(body.auswahl) > 5000:
        raise HTTPException(400, "Zu viele Zeilen auf einmal (höchstens 5000)")
    pfad = _pfad(body.sicherung)
    try:
        return await wh.anwenden(db, pfad, user.id, body.modul, [a.model_dump() for a in body.auswahl])
    except ValueError as e:
        raise HTTPException(400, str(e))
