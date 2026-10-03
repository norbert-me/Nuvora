"""Modul Waage — Aequivalenzumformungen am Modell der Balkenwaage.

Zwei Wege, dieselbe Bauform wie beim PAP-Editor:

* **Frei**: die Waage ist eine Seite (`/waage-frei`), ohne Konto und ohne
  Zuordnung, gespeichert nur im Browser. Hier gibt es nichts am Server.
* **Aufgaben**: die Lehrkraft legt ein Blatt mit Gleichungen an, das Kind
  oeffnet es ueber seinen QR-Zugang, loest an der Waage und gibt ab; die
  Lehrkraft sieht je Kind, wie viele Gleichungen geloest sind, und jeden Weg.

Anders als beim PAP kennt der Server hier die Semantik — sie ist klein und
eindeutig: ob ein Weg die Waage im Gleichgewicht haelt und bei „x = …"
endet, rechnet `app/waage.py` nach. Ein Browser, der „geloest" behauptet,
bekommt dafuer nichts.
"""
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import waage as w
from ..besitz import eigene_klasse, eigenes
from ..database import get_db
from ..kursmitglieder import member_student_ids
from ..models import Kurs, Student, Topic, User, WaageAbgabe, WaageAufgabe
from ..schueler import sortiert
from .karten import _student_by_token
from .modules import modul_pflicht

MODULE_KEY = "waage"
require_module = modul_pflicht(MODULE_KEY)

router = APIRouter(prefix="/api/waage", tags=["waage"])
lern_router = APIRouter(prefix="/api/lernen", tags=["waage"])


def _gleichungen(roh) -> list:
    """Die Gleichungen eines Blatts — jede muss auf die Waage passen. Eine,
    die es nicht tut, wird abgelehnt statt still entfernt: die Lehrkraft hat
    sie getippt und soll wissen, welche."""
    if roh is None:
        return []
    if not isinstance(roh, list) or len(roh) > w.MAX_GLEICHUNGEN:
        raise HTTPException(400, f"Höchstens {w.MAX_GLEICHUNGEN} Gleichungen je Blatt")
    out = []
    for i, g in enumerate(roh):
        s = w.gleichung_ok(g)
        if not s:
            raise HTTPException(400, f"Gleichung {i + 1} passt nicht auf die Waage "
                                     "(nur natürliche Zahlen bis 60, Lösung eine positive ganze Zahl)")
        out.append(s)
    return out


class AufgabeIn(BaseModel):
    title: str = ""
    beschreibung: str = ""
    class_id: Optional[int] = None
    kurs_id: Optional[int] = None
    topic_id: Optional[int] = None
    gleichungen: Optional[list] = None


class AufgabeOut(BaseModel):
    id: int
    title: str
    beschreibung: str
    class_id: Optional[int]
    kurs_id: Optional[int]
    topic_id: Optional[int]
    gleichungen: Optional[list]
    abgaben: int = 0
    model_config = {"from_attributes": True}


async def _pruefe_ziel(db: AsyncSession, user: User, body: AufgabeIn):
    if body.class_id:
        await eigene_klasse(db, user, body.class_id)
    if body.kurs_id:
        await eigenes(db, Kurs, body.kurs_id, user, "Kurs nicht gefunden")
    if body.topic_id:
        await eigenes(db, Topic, body.topic_id, user, "Thema nicht gefunden")


async def _aufgabe(db: AsyncSession, aufgabe_id: int, user: User) -> WaageAufgabe:
    a = await db.get(WaageAufgabe, aufgabe_id)
    if not a or a.owner_id != user.id or a.deleted_at is not None:
        raise HTTPException(404, "Aufgabe nicht gefunden")
    return a


@router.get("/aufgaben", response_model=List[AufgabeOut])
async def list_aufgaben(user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(WaageAufgabe).where(
        WaageAufgabe.owner_id == user.id, WaageAufgabe.deleted_at.is_(None)
    ).order_by(WaageAufgabe.id.desc()))).scalars().all()
    zahl = {}
    if rows:
        for aid in (await db.execute(select(WaageAbgabe.aufgabe_id).where(
                WaageAbgabe.aufgabe_id.in_([a.id for a in rows])))).scalars().all():
            zahl[aid] = zahl.get(aid, 0) + 1
    return [AufgabeOut(**{**a.__dict__, "abgaben": zahl.get(a.id, 0)}) for a in rows]


@router.post("/aufgaben", response_model=AufgabeOut, status_code=201)
async def create_aufgabe(body: AufgabeIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _pruefe_ziel(db, user, body)
    a = WaageAufgabe(owner_id=user.id, title=(body.title or "").strip()[:200],
                     beschreibung=(body.beschreibung or "")[:4000],
                     class_id=body.class_id, kurs_id=body.kurs_id, topic_id=body.topic_id,
                     gleichungen=_gleichungen(body.gleichungen))
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return AufgabeOut(**a.__dict__)


@router.put("/aufgaben/{aufgabe_id}", response_model=AufgabeOut)
async def update_aufgabe(aufgabe_id: int, body: AufgabeIn,
                         user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    a = await _aufgabe(db, aufgabe_id, user)
    await _pruefe_ziel(db, user, body)
    a.title = (body.title or "").strip()[:200]
    a.beschreibung = (body.beschreibung or "")[:4000]
    a.class_id, a.kurs_id, a.topic_id = body.class_id, body.kurs_id, body.topic_id
    a.gleichungen = _gleichungen(body.gleichungen)
    await db.commit()
    await db.refresh(a)
    return AufgabeOut(**a.__dict__)


@router.delete("/aufgaben/{aufgabe_id}")
async def delete_aufgabe(aufgabe_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Weich loeschen — der Papierkorb liegt im Kern."""
    a = await _aufgabe(db, aufgabe_id, user)
    a.deleted_at = datetime.now(timezone.utc)
    await db.commit()
    return {"ok": True}


@router.get("/aufgaben/{aufgabe_id}/abgaben")
async def list_abgaben(aufgabe_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Je Kind eine Zeile — auch die leeren: „wer hat noch nichts?" ist die Frage."""
    a = await _aufgabe(db, aufgabe_id, user)
    if a.kurs_id:
        ids = await member_student_ids(db, a.kurs_id)
        kinder = await sortiert(db, Student.id.in_(list(ids))) if ids else []
    elif a.class_id:
        kinder = await sortiert(db, Student.class_id == a.class_id)
    else:
        kinder = []
    stand = {x.student_id: x for x in (await db.execute(
        select(WaageAbgabe).where(WaageAbgabe.aufgabe_id == a.id))).scalars().all()}
    out = []
    for s in kinder:
        ab = stand.get(s.id)
        out.append({
            "student_id": s.id, "name": s.name, "card_id": s.card_id,
            "abgegeben": bool(ab and ab.abgegeben),
            "geloest": ab.geloest if ab else 0,
            "gesamt": len(a.gleichungen or []),
            "leer": not (ab and ab.daten),
            "daten": ab.daten if ab else None,
            "updated_at": ab.updated_at.isoformat() if ab and ab.updated_at else "",
        })
    return out


# ─── Der Weg des Kindes: ohne Login, ueber den ausgeteilten Token ───

async def _kurse_des_kindes(db: AsyncSession, st: Student) -> list:
    from ..kursmitglieder import student_kurs_ids
    try:
        return list(await student_kurs_ids(db, st.id))
    except Exception:
        return []


@lern_router.get("/{token}/waage")
async def schueler_aufgaben(token: str, db: AsyncSession = Depends(get_db)):
    st = await _student_by_token(db, token, modul=(MODULE_KEY,))
    kurs_ids = await _kurse_des_kindes(db, st)
    q = select(WaageAufgabe).where(WaageAufgabe.deleted_at.is_(None))
    if kurs_ids:
        q = q.where((WaageAufgabe.class_id == st.class_id) | (WaageAufgabe.kurs_id.in_(kurs_ids)))
    else:
        q = q.where(WaageAufgabe.class_id == st.class_id)
    aufgaben = (await db.execute(q.order_by(WaageAufgabe.id.desc()))).scalars().all()
    stand = {x.aufgabe_id: x for x in (await db.execute(
        select(WaageAbgabe).where(WaageAbgabe.student_id == st.id))).scalars().all()}
    return [{
        "id": a.id, "title": a.title, "beschreibung": a.beschreibung,
        "gleichungen": a.gleichungen or [],
        "daten": stand[a.id].daten if a.id in stand else None,
        "abgegeben": bool(a.id in stand and stand[a.id].abgegeben),
    } for a in aufgaben if a.gleichungen]


class AbgabeIn(BaseModel):
    daten: Optional[dict] = None
    abgegeben: bool = False


def _daten(a: WaageAufgabe, roh) -> tuple[dict, int]:
    """Die Wege eines Kindes bereinigen und nachrechnen. Schluessel ist die
    Nummer der Gleichung im Blatt; was zu keiner gehoert, faellt heraus."""
    gl = a.gleichungen or []
    out, geloest = {}, 0
    if isinstance(roh, dict):
        for k, v in roh.items():
            try:
                i = int(k)
            except (TypeError, ValueError):
                continue
            if not (0 <= i < len(gl)) or not isinstance(v, dict):
                continue
            p = w.pruefe_weg(gl[i], v.get("schritte"))
            out[str(i)] = {"schritte": p["schritte"], "geloest": p["geloest"]}
            geloest += 1 if p["geloest"] else 0
    return out, geloest


@lern_router.put("/{token}/waage/{aufgabe_id}")
async def schueler_speichern(token: str, aufgabe_id: int, body: AbgabeIn, db: AsyncSession = Depends(get_db)):
    st = await _student_by_token(db, token, modul=(MODULE_KEY,))
    a = await db.get(WaageAufgabe, aufgabe_id)
    if not a or a.deleted_at is not None:
        raise HTTPException(404, "Aufgabe nicht gefunden")
    # Die Aufgabe muss zu diesem Kind gehoeren — sonst waere ihre ID ein Weg
    # in fremde Klassen.
    kurs_ids = await _kurse_des_kindes(db, st)
    if not (a.class_id == st.class_id or (a.kurs_id and a.kurs_id in kurs_ids)):
        raise HTTPException(404, "Aufgabe nicht gefunden")
    ab = (await db.execute(select(WaageAbgabe).where(
        WaageAbgabe.aufgabe_id == a.id, WaageAbgabe.student_id == st.id))).scalar_one_or_none()
    if not ab:
        ab = WaageAbgabe(aufgabe_id=a.id, student_id=st.id)
        db.add(ab)
    ab.daten, ab.geloest = _daten(a, body.daten)
    ab.abgegeben = bool(body.abgegeben)
    await db.commit()
    return {"ok": True, "abgegeben": ab.abgegeben, "geloest": ab.geloest, "daten": ab.daten}


# ─── Papierkorb (im Kern; hier nur die zwei Handgriffe) ───

async def restore_aufgabe(aufgabe_id: int, user: User, db: AsyncSession):
    a = await db.get(WaageAufgabe, aufgabe_id)
    if not a or a.owner_id != user.id:
        raise HTTPException(404, "Aufgabe nicht gefunden")
    a.deleted_at = None
    await db.commit()


async def purge_aufgabe(aufgabe_id: int, user: User, db: AsyncSession):
    a = await db.get(WaageAufgabe, aufgabe_id)
    if not a or a.owner_id != user.id:
        raise HTTPException(404, "Aufgabe nicht gefunden")
    await db.delete(a)
    await db.commit()
