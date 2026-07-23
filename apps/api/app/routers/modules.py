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
from sqlalchemy import select, func
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
    # Gruppe für die Modulübersicht: "unterricht" | "organisation" | "werkzeug".
    group: str = "werkzeug"


REGISTRY: List[ModuleDef] = [
    ModuleDef(
        key="cardvote",
        group="unterricht",
        name="CardVote",
        description=(
            "Abstimmen im Unterricht ohne Geräte: Lernende halten bedruckte "
            "Karten hoch, du scannst sie mit dem Handy. Live-Ergebnisse, "
            "Spiel-Modus, Auswertung mit Notenschlüssel, Übernahme als "
            "Notenspalte, Export und Marktplatz."
        ),
        path="/cardvote",
        stage="stable",
    ),
    ModuleDef(
        key="lernpfad",
        group="unterricht",
        name="Lernpfad",
        description=(
            "Aufgaben und Lernpfade (aus mehreren Lernleitern) verwalten — auf "
            "denselben Themen, Klassen und Kursen wie der Rest von Nuvora. Der "
            "Generator verteilt Aufgaben differenziert je Schüler; Lernleitern "
            "lassen sich über den Marktplatz teilen."
        ),
        path="/lernpfad",
        stage="stable",
    ),
    ModuleDef(
        key="noten",
        group="werkzeug",
        name="Noten",
        description=(
            "Notenbuch: eigene Spalten mit Gewichten, Noten und Beobachtungen je "
            "Person. Rechnet den gewichteten Schnitt und zeigt einen Trend je "
            "Schüler — die Zeugnisnote bleibt deine Entscheidung, Beobachtungen "
            "zählen nie mit. CardVote-, Karten- und Code-Detektiv-Ergebnisse als "
            "Spalte übernehmbar."
        ),
        path="/noten",
        stage="stable",
    ),
    ModuleDef(
        key="code-detektiv",
        group="werkzeug",
        name="Code-Detektiv",
        description=(
            "Programmier-Rätsel für den Informatikunterricht: Code-Bausteine per "
            "Drag & Drop in die richtige Reihenfolge bringen — allein oder in "
            "einer Klassen-Session (Beitritt per Code, ohne Login). Themen-getaggt."
        ),
        path="/code-detektiv",
        stage="stable",
    ),
    ModuleDef(
        key="karten",
        group="unterricht",
        name="Karteikarten",
        description=(
            "Karteikarten mit Spaced Repetition. Die Lernenden üben ohne Konto "
            "per QR-Code; ihren Reifegrad siehst du im Modul. Optional an ein "
            "Thema gebunden (der Kalender schaltet den Stapel am Tag frei); die "
            "Meisterung als Notenspalte übernehmbar."
        ),
        path="/karten",
        stage="stable",
    ),
    ModuleDef(
        key="kalender",
        group="organisation",
        name="Kalender",
        description=(
            "Unterrichtsplanung: Tag-, Wochen-, Monatsansicht und ein "
            "wiederkehrender Stundenplan. An einen Eintrag lässt sich ein Quiz, "
            "ein Karten-Deck oder eine Lernleiter planen; freie Tage blenden "
            "Stunden aus. Kalender-Sync in beide Richtungen (eigener ICS-Feed zum "
            "Abonnieren + externer Kalender read-only)."
        ),
        path="/kalender",
        stage="stable",
    ),
    ModuleDef(
        key="orga",
        group="organisation",
        name="Orga",
        description=(
            "Werkzeuge zur Klassenführung in Reitern: Sammel-Checklisten (z.B. "
            "„Unterschrift der Klassenarbeit gesehen“), Anwesenheit/Fehlzeiten "
            "(mit PDF-Report), Material-Ausleihe (verleihen, Rückgabe im Blick) "
            "und Sitzplan (Tische frei platzieren, optional SEGEL-Stufen je "
            "Schüler)."
        ),
        path="/orga",
        stage="stable",
    ),
    ModuleDef(
        key="zufall",
        group="werkzeug",
        name="Zufallsschüler",
        description=(
            "Zieht per Knopfdruck eine zufällige Person aus einer Klasse — fair "
            "gewichtet nach der Zeit seit dem letzten Ziehen, nicht zweimal am "
            "Stück."
        ),
        path="/zufall",
        stage="stable",
    ),
    ModuleDef(
        key="klassenarbeit",
        group="werkzeug",
        name="Klassenarbeit",
        description=(
            "Klassenarbeit auswerten: je Aufgabe ein Thema, je Schüler richtig/"
            "falsch. Daraus ein Fehlerprofil pro Person nach Thema — und auf "
            "Knopfdruck gezielte Wiederholung (Karten des schwachen Themas wieder "
            "fällig)."
        ),
        path="/klassenarbeit",
        stage="stable",
    ),
    ModuleDef(
        key="methoden",
        group="unterricht",
        name="Einstiege",
        description=(
            "Sammlung von Ideen für den Unterrichtseinstieg — Idee, Ablauf, "
            "Material und ungefähre Dauer. Wiederverwendbar, an Kalender-Stunden "
            "zuweisbar und themen-getaggt: zu einem schwachen Thema vorschlagbar."
        ),
        path="/methoden",
        stage="stable",
    ),
]

_BY_KEY = {m.key: m for m in REGISTRY}


class ModuleOut(ModuleDef):
    active: bool
    # Wie viele Lehrkräfte dieses Modul aktiviert haben — Orientierung beim
    # Einstieg („was nutzen andere?"). Global, nicht personenbezogen.
    popularity: int = 0


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
    # Globale Aktivierungszahl je Modul (für „Beliebt"-Hinweis beim Einstieg).
    counts = dict((await db.execute(
        select(UserModule.module_key, func.count()).group_by(UserModule.module_key)
    )).all())
    return [ModuleOut(**m.model_dump(), active=m.key in active, popularity=counts.get(m.key, 0)) for m in REGISTRY]


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
