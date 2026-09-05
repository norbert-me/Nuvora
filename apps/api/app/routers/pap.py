"""Modul PAP — Programmablaufplaene (DIN 66001).

Zwei Wege in denselben Editor, und das ist der ganze Sinn des Moduls:

* **Unueberwacht**: der Editor ist eine Seite. Wer den Link hat, zeichnet — ohne
  Konto, ohne Zuordnung, gespeichert nur im Browser des Kindes. Genau so
  arbeitet der Code-Detektiv, und genau das braucht der Unterricht am haeufigsten
  („zeichnet den Ablauf, wir schauen gleich drauf").
* **Ueberwacht**: die Lehrkraft legt eine Aufgabe an, das Kind oeffnet sie ueber
  seinen QR-Zugang, gibt ab — die Lehrkraft sieht die Abgaben. Kein Live-Bild
  und keine Sitzung: was zaehlt, ist der Stand am Ende, und eine Live-Uebertragung
  waere ein zweites Bauwerk (WebSocket, Beamer, Wiederverbinden) fuer eine Frage,
  die sich beim Herumgehen durch den Raum ohnehin beantwortet.

Das Diagramm ist an dieser Stelle **Datenablage, keine Struktur**: der Server
prueft die Form (Liste von Knoten und Kanten, Groessengrenze), aber er kennt
keine Semantik. Die Regeln des Flussdiagramms gehoeren in den Editor — und ins
Heft des Kindes.
"""
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..besitz import eigene_klasse, eigenes
from ..database import get_db
from ..kursmitglieder import member_student_ids
from ..models import Kurs, PapAbgabe, PapAufgabe, SchoolClass, Student, Topic, User
from ..schueler import sortiert
from .auth import get_current_user
from .karten import _student_by_token
from .modules import modul_pflicht

MODULE_KEY = "pap"
require_module = modul_pflicht(MODULE_KEY)

router = APIRouter(prefix="/api/pap", tags=["pap"])
# Der Weg des Kindes haengt am ausgeteilten Token, nicht an einer Anmeldung —
# deshalb ein eigener Router ohne die Modul-Abhaengigkeit im Pfad.
lern_router = APIRouter(prefix="/api/lernen", tags=["pap"])

# Wie gross ein Diagramm werden darf. Ein Ablaufplan mit mehr als 200 Symbolen
# ist keiner mehr, und ohne Grenze legt ein Browser-Fehler beliebig viel in die
# Datenbank.
MAX_KNOTEN = 200
MAX_KANTEN = 400
ARTEN = ("start", "ende", "anweisung", "verzweigung", "eingabe", "ausgabe", "unterprogramm")


def _diagramm(roh) -> dict:
    """Ein Diagramm auf die erlaubte Form bringen — oder ablehnen.

    Geprueft wird die FORM, nicht der Inhalt: unbekannte Symbolarten fliegen
    raus (sonst zeichnet der Editor spaeter etwas, das er nicht kennt), Texte
    werden gekuerzt, Koordinaten auf Zahlen gezwungen. Was fachlich falsch ist
    — eine Verzweigung ohne Nein-Zweig — bleibt erlaubt: es ist die Arbeit
    eines Kindes, kein Datenfehler.
    """
    if roh is None:
        return {"knoten": [], "kanten": []}
    if not isinstance(roh, dict):
        raise HTTPException(400, "Diagramm hat die falsche Form")
    knoten_roh = roh.get("knoten") or []
    kanten_roh = roh.get("kanten") or []
    if not isinstance(knoten_roh, list) or not isinstance(kanten_roh, list):
        raise HTTPException(400, "Diagramm hat die falsche Form")
    if len(knoten_roh) > MAX_KNOTEN or len(kanten_roh) > MAX_KANTEN:
        raise HTTPException(400, "Das Diagramm ist zu groß")

    def zahl(v):
        try:
            return round(float(v), 1)
        except (TypeError, ValueError):
            return 0.0

    knoten, ids = [], set()
    for k in knoten_roh:
        if not isinstance(k, dict):
            continue
        kid = str(k.get("id") or "")[:40]
        art = str(k.get("art") or "anweisung")
        if not kid or kid in ids or art not in ARTEN:
            continue
        ids.add(kid)
        knoten.append({"id": kid, "art": art, "text": str(k.get("text") or "")[:200],
                       "x": zahl(k.get("x")), "y": zahl(k.get("y"))})
    kanten = []
    for e in kanten_roh:
        if not isinstance(e, dict):
            continue
        von, nach = str(e.get("von") or "")[:40], str(e.get("nach") or "")[:40]
        # Eine Kante ins Leere waere im Editor eine Linie ohne Ende — sie
        # entsteht nur bei einem Fehler und wird hier still weggelassen.
        if von in ids and nach in ids:
            kanten.append({"von": von, "nach": nach, "label": str(e.get("label") or "")[:20]})
    return {"knoten": knoten, "kanten": kanten}


class AufgabeIn(BaseModel):
    title: str = ""
    beschreibung: str = ""
    class_id: Optional[int] = None
    kurs_id: Optional[int] = None
    topic_id: Optional[int] = None
    vorlage: Optional[dict] = None


class AufgabeOut(BaseModel):
    id: int
    title: str
    beschreibung: str
    class_id: Optional[int]
    kurs_id: Optional[int]
    topic_id: Optional[int]
    vorlage: Optional[dict]
    abgaben: int = 0
    model_config = {"from_attributes": True}


async def _pruefe_ziel(db: AsyncSession, user: User, body: AufgabeIn):
    """Klasse, Kurs und Thema muessen der Lehrkraft gehoeren."""
    if body.class_id:
        await eigene_klasse(db, user, body.class_id)
    if body.kurs_id:
        await eigenes(db, Kurs, body.kurs_id, user, "Kurs nicht gefunden")
    if body.topic_id:
        await eigenes(db, Topic, body.topic_id, user, "Thema nicht gefunden")


async def _aufgabe(db: AsyncSession, aufgabe_id: int, user: User) -> PapAufgabe:
    a = await db.get(PapAufgabe, aufgabe_id)
    if not a or a.owner_id != user.id or a.deleted_at is not None:
        raise HTTPException(404, "Aufgabe nicht gefunden")
    return a


@router.get("/aufgaben", response_model=List[AufgabeOut])
async def list_aufgaben(user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(PapAufgabe).where(
        PapAufgabe.owner_id == user.id, PapAufgabe.deleted_at.is_(None)
    ).order_by(PapAufgabe.id.desc()))).scalars().all()
    zahl = {}
    if rows:
        abg = (await db.execute(select(PapAbgabe.aufgabe_id).where(
            PapAbgabe.aufgabe_id.in_([a.id for a in rows])))).scalars().all()
        for aid in abg:
            zahl[aid] = zahl.get(aid, 0) + 1
    return [AufgabeOut(**{**a.__dict__, "abgaben": zahl.get(a.id, 0)}) for a in rows]


@router.post("/aufgaben", response_model=AufgabeOut, status_code=201)
async def create_aufgabe(body: AufgabeIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _pruefe_ziel(db, user, body)
    a = PapAufgabe(owner_id=user.id, title=(body.title or "").strip()[:200],
                   beschreibung=(body.beschreibung or "")[:4000],
                   class_id=body.class_id, kurs_id=body.kurs_id, topic_id=body.topic_id,
                   vorlage=_diagramm(body.vorlage) if body.vorlage else None)
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
    a.vorlage = _diagramm(body.vorlage) if body.vorlage else None
    await db.commit()
    await db.refresh(a)
    return AufgabeOut(**a.__dict__)


@router.delete("/aufgaben/{aufgabe_id}")
async def delete_aufgabe(aufgabe_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Weich loeschen — der Papierkorb liegt im Kern (CLAUDE.md)."""
    a = await _aufgabe(db, aufgabe_id, user)
    a.deleted_at = datetime.now(timezone.utc)
    await db.commit()
    return {"ok": True}


@router.get("/aufgaben/{aufgabe_id}/abgaben")
async def list_abgaben(aufgabe_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Die Abgaben zu einer Aufgabe — je Kind eine, auch wenn es nichts gibt.

    Auch die LEEREN Zeilen: „wer hat noch nichts?" ist die eigentliche Frage der
    Lehrkraft, und eine Liste, die nur die Fertigen zeigt, beantwortet sie
    nicht.
    """
    a = await _aufgabe(db, aufgabe_id, user)
    # Sortiert wie ueberall: (position, card_id, id) — die Reihenfolge der
    # Klasse, nicht die der Datenbank.
    if a.kurs_id:
        ids = await member_student_ids(db, a.kurs_id)
        kinder = await sortiert(db, Student.id.in_(list(ids))) if ids else []
    elif a.class_id:
        kinder = await sortiert(db, Student.class_id == a.class_id)
    else:
        kinder = []
    stand = {x.student_id: x for x in (await db.execute(
        select(PapAbgabe).where(PapAbgabe.aufgabe_id == a.id))).scalars().all()}
    out = []
    for s in kinder:
        ab = stand.get(s.id)
        out.append({
            "student_id": s.id, "name": s.name, "card_id": s.card_id,
            "abgegeben": bool(ab and ab.abgegeben),
            "leer": not (ab and (ab.daten or {}).get("knoten")),
            "daten": (ab.daten if ab else None),
            "updated_at": ab.updated_at.isoformat() if ab and ab.updated_at else "",
        })
    return out


# ─── Der Weg des Kindes: ohne Login, ueber den ausgeteilten Token ───

@lern_router.get("/{token}/pap")
async def schueler_aufgaben(token: str, db: AsyncSession = Depends(get_db)):
    """Die PAP-Aufgaben dieses Kindes samt eigenem Stand."""
    st = await _student_by_token(db, token, modul=(MODULE_KEY,))
    kurs_ids = await _kurse_des_kindes(db, st)
    q = select(PapAufgabe).where(PapAufgabe.deleted_at.is_(None))
    if kurs_ids:
        q = q.where((PapAufgabe.class_id == st.class_id) | (PapAufgabe.kurs_id.in_(kurs_ids)))
    else:
        q = q.where(PapAufgabe.class_id == st.class_id)
    aufgaben = (await db.execute(q.order_by(PapAufgabe.id.desc()))).scalars().all()
    stand = {x.aufgabe_id: x for x in (await db.execute(
        select(PapAbgabe).where(PapAbgabe.student_id == st.id))).scalars().all()}
    return [{
        "id": a.id, "title": a.title, "beschreibung": a.beschreibung,
        "vorlage": a.vorlage,
        "daten": (stand[a.id].daten if a.id in stand else None),
        "abgegeben": bool(a.id in stand and stand[a.id].abgegeben),
    } for a in aufgaben]


async def _kurse_des_kindes(db: AsyncSession, st: Student) -> list:
    from ..kursmitglieder import student_kurs_ids
    try:
        return list(await student_kurs_ids(db, st.id))
    except Exception:
        return []


class AbgabeIn(BaseModel):
    daten: Optional[dict] = None
    abgegeben: bool = False


@lern_router.put("/{token}/pap/{aufgabe_id}")
async def schueler_speichern(token: str, aufgabe_id: int, body: AbgabeIn,
                             db: AsyncSession = Depends(get_db)):
    """Zwischenstand oder Abgabe speichern — eine Zeile je Kind und Aufgabe.

    Gemergt statt geloescht und neu angelegt (CLAUDE.md): an der Zeile haengt
    der Zeitstempel, den die Lehrkraft liest.
    """
    st = await _student_by_token(db, token, modul=(MODULE_KEY,))
    a = await db.get(PapAufgabe, aufgabe_id)
    if not a or a.deleted_at is not None:
        raise HTTPException(404, "Aufgabe nicht gefunden")
    # Die Aufgabe muss zu diesem Kind gehoeren — sonst waere die Aufgaben-ID ein
    # Weg, in fremde Klassen zu schreiben.
    kurs_ids = await _kurse_des_kindes(db, st)
    if not (a.class_id == st.class_id or (a.kurs_id and a.kurs_id in kurs_ids)):
        raise HTTPException(404, "Aufgabe nicht gefunden")
    ab = (await db.execute(select(PapAbgabe).where(
        PapAbgabe.aufgabe_id == a.id, PapAbgabe.student_id == st.id))).scalar_one_or_none()
    if not ab:
        ab = PapAbgabe(aufgabe_id=a.id, student_id=st.id)
        db.add(ab)
    ab.daten = _diagramm(body.daten)
    ab.abgegeben = bool(body.abgegeben)
    await db.commit()
    return {"ok": True, "abgegeben": ab.abgegeben}


# ─── Papierkorb (der liegt im Kern; hier stehen nur die zwei Handgriffe) ───

async def restore_aufgabe(aufgabe_id: int, user: User, db: AsyncSession):
    """Zurueckholen. Die Abgaben haengen daran und waren nie weg — deshalb
    reicht das Datum."""
    a = await db.get(PapAufgabe, aufgabe_id)
    if not a or a.owner_id != user.id:
        raise HTTPException(404, "Aufgabe nicht gefunden")
    a.deleted_at = None
    await db.commit()


async def purge_aufgabe(aufgabe_id: int, user: User, db: AsyncSession):
    """Endgueltig. Die Abgaben gehen ueber die Kaskade mit — sie gehoeren zur
    Aufgabe und haetten ohne sie keinen Sinn."""
    a = await db.get(PapAufgabe, aufgabe_id)
    if not a or a.owner_id != user.id:
        raise HTTPException(404, "Aufgabe nicht gefunden")
    await db.delete(a)
    await db.commit()
