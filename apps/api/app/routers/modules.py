"""Nuvora-Kern: Modulregister.

Nuvora ist die Basis — sie besitzt Konten, Klassen und Schueler. Module wie
CardVote oder Lernpfad arbeiten auf diesen Daten, besitzen sie aber nicht, und
werden pro Lehrkraft zugeschaltet.

Die Liste der verfuegbaren Module steht hier im Code (REGISTRY), nicht in der
Datenbank: ein Modul existiert nur, wenn es auch Code dazu gibt. In der DB
steht ausschliesslich, wer was aktiviert hat.
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import User, UserModule
from .auth import get_current_user

router = APIRouter(prefix="/api/modules", tags=["modules"])


class ModuleDef(BaseModel):
    key: str
    name: str
    description: str
    # Pfad in der Shell, unter dem das Modul haengt.
    path: str
    # Module, die noch nicht im Rahmen laufen, sind sichtbar aber nicht waehlbar.
    available: bool = True
    # Laeuft das Modul ausserhalb der React-App (eigene Seite hinter dem Proxy)?
    # Dann muss die Shell es per echtem Seitenwechsel oeffnen, nicht per Route.
    external: bool = False
    # Reifegrad: "beta" = laeuft, aber in Entwicklung; "alpha" = frueh, Daten
    # koennen verloren gehen. Die Shell zeigt das als Badge.
    stage: str = "alpha"


REGISTRY: List[ModuleDef] = [
    ModuleDef(
        key="cardvote",
        name="CardVote",
        description=(
            "Abstimmen im Unterricht ohne Geraete: Lernende halten bedruckte "
            "Karten hoch, du scannst sie mit dem Handy. Mit Auswertung, Noten "
            "und Export."
        ),
        path="/cardvote",
        stage="beta",
    ),
    ModuleDef(
        key="lernpfad",
        name="Lernpfad",
        description=(
            "Aufgaben und Lernpfade verwalten — mit denselben Themen und "
            "Klassen wie der Rest von Nuvora. Die alte, eigenständige App "
            "bleibt vorerst unter /lernpfad-alt/ erreichbar, bis die Daten "
            "übernommen sind."
        ),
        path="/lernpfad",
    ),
    ModuleDef(
        key="noten",
        name="Noten",
        description=(
            "Leistungsbewertung: eigene Kategorien mit Gewichten, Noten und "
            "Beobachtungen je Person. Rechnet den gewichteten Schnitt der "
            "Noten — die Zeugnisnote bleibt deine Entscheidung."
        ),
        path="/noten",
        stage="beta",
    ),
    ModuleDef(
        key="code-detektiv",
        name="Code-Detektiv",
        description=(
            "Programmier-Rätsel für den Informatikunterricht: Code-Bausteine "
            "in die richtige Reihenfolge bringen, allein oder in der Klasse."
        ),
        path="/code-detektiv",
    ),
    ModuleDef(
        key="karten",
        name="Karten",
        description=(
            "Karteikarten mit Spaced Repetition. Die Lernenden üben ohne Konto "
            "per QR-Code; ihren Fortschritt siehst du im Modul."
        ),
        path="/karten",
        stage="beta",
    ),
    ModuleDef(
        key="kalender",
        name="Kalender",
        description=(
            "Unterrichtsplanung im Kalender: Tag-, Wochen- und Monatsansicht. "
            "Stunden eintragen und Themen aus der Taxonomie zuordnen."
        ),
        path="/kalender",
    ),
    ModuleDef(
        key="sitzplan",
        name="Sitzplan",
        description=(
            "Sitzordnung je Klasse: Schueler per Drag & Drop auf ein Raster "
            "setzen. Nur die Positionen werden gespeichert."
        ),
        path="/sitzplan",
        stage="beta",
    ),
    ModuleDef(
        key="zufall",
        name="Zufallsschüler",
        description=(
            "Zieht per Knopfdruck eine zufaellige Person aus einer Klasse — "
            "optional ohne Wiederholung, bis alle dran waren."
        ),
        path="/zufall",
        stage="beta",
    ),
    ModuleDef(
        key="methoden",
        name="Einstiege",
        description=(
            "Sammlung von Ideen fuer den Unterrichtseinstieg — Idee, Ablauf mit "
            "Material, Materialliste und ungefaehre Dauer. Wiederverwenden und an "
            "Kalender-Stunden zuordnen."
        ),
        path="/methoden",
    ),
]

_BY_KEY = {m.key: m for m in REGISTRY}


class ModuleOut(ModuleDef):
    active: bool


async def _active_keys(db: AsyncSession, user_id: int) -> set[str]:
    result = await db.execute(select(UserModule.module_key).where(UserModule.user_id == user_id))
    return set(result.scalars().all())


async def is_active(db: AsyncSession, user_id: int, key: str) -> bool:
    """Fuer Modul-Router: laeuft dieses Modul fuer diese Lehrkraft?"""
    result = await db.execute(
        select(UserModule.id).where(UserModule.user_id == user_id, UserModule.module_key == key)
    )
    return result.scalar_one_or_none() is not None


@router.get("", response_model=List[ModuleOut])
async def list_modules(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle Module mit Aktivierungsstand — die Shell baut daraus ihre Navigation."""
    active = await _active_keys(db, user.id)
    return [ModuleOut(**m.model_dump(), active=m.key in active) for m in REGISTRY]


@router.post("/{key}/activate", response_model=ModuleOut)
async def activate(
    key: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    mod = _BY_KEY.get(key)
    if not mod:
        raise HTTPException(404, "Modul unbekannt")
    if not mod.available:
        raise HTTPException(409, "Modul ist noch nicht verfuegbar")

    if not await is_active(db, user.id, key):
        db.add(UserModule(user_id=user.id, module_key=key))
        await db.commit()
    return ModuleOut(**mod.model_dump(), active=True)


@router.delete("/{key}/activate", response_model=ModuleOut)
async def deactivate(
    key: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Abschalten blendet das Modul nur aus — die Daten dahinter bleiben."""
    mod = _BY_KEY.get(key)
    if not mod:
        raise HTTPException(404, "Modul unbekannt")

    result = await db.execute(
        select(UserModule).where(UserModule.user_id == user.id, UserModule.module_key == key)
    )
    row = result.scalar_one_or_none()
    if row:
        await db.delete(row)
        await db.commit()
    return ModuleOut(**mod.model_dump(), active=False)
