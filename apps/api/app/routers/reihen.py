"""Modul Reihen — Unterrichtsreihen als Vorlage, die man Jahr für Jahr wieder einsetzt.

Eine Reihe ist eine Folge von Stunden: Titel, Thema, Ablauf (Verlaufsplan),
Notizen, Verweise auf Quiz, Karten-Stapel, Lernleiter und Einstieg, dazu Dateien
(PDFs, Arbeitsblätter) und Notizen fürs nächste Mal. Sie gehört der Lehrkraft,
nicht einem Kurs oder einem Schuljahr.

Eigenständig (Regel 3): die Reihe funktioniert ohne Kalender. Zwei Wege führen
zum Kalender, beide sind Zusatz und nur mit aktivem Kalender-Modul möglich:

* **aus dem Kalender speichern** — die gehaltenen Stunden eines Kurses werden
  zur Reihe (Reihenfolge, Inhalte, angehängte Dateien);
* **in einen Kurs spielen** — die Stunden werden der Reihe nach auf die
  tatsächlichen Unterrichtsstunden des Kurses gelegt (Stundenplan, Ferien und
  Ausfälle sind schon abgezogen) und als Kalender-Einträge angelegt.

Das Raster der Unterrichtsstunden kommt aus dem Kern (`app/stundenraster.py`):
ein Router darf den anderen nicht importieren. Verweise auf Quiz, Stapel,
Lernleiter und Einstieg haben keinen Fremdschlüssel — die Vorlage zeigt nur hin.
"""
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..besitz import eigenes, gehoert_optional
from ..database import get_db
from ..models import (CalendarBreak, CalendarEntry, CardDeck, Kurs, KursTag, LearningLadder, Material,
                      Method, QuestionSet, Reihe, ReiheStunde, SlotCancellation, TimetableSlot, Topic, User)
from ..stundenraster import freie_tage, tag as _tag, unterrichtsstunden
from ..zeit import tagesbeginn
from .auth import rate_limit
from .modules import is_active, modul_pflicht

router = APIRouter(prefix="/api/reihen", tags=["reihen"])
MODULE_KEY = "reihen"
require_module = modul_pflicht(MODULE_KEY)

MAX_STUNDEN = 120          # eine Reihe ist ein Halbjahr, nicht ein Archiv
MAX_VORSCHAU_TAGE = 420    # so weit voraus wird nach freien Unterrichtsstunden gesucht


class PhaseItem(BaseModel):
    phase: str = Field("", max_length=200)
    dauer: str = Field("", max_length=40)
    text: str = Field("", max_length=4000)


class StundeIn(BaseModel):
    titel: str = Field("", max_length=200)
    dauer: int = Field(1, ge=1, le=4)
    topic_id: Optional[int] = None
    topic_ids: Optional[List[int]] = None
    notizen: str = Field("", max_length=20000)
    naechstes_mal: str = Field("", max_length=20000)
    verlaufsplan: List[PhaseItem] = []
    cardvote_set_id: Optional[int] = None
    karten_deck_ids: Optional[List[int]] = None
    lernpfad_ladder_id: Optional[int] = None
    method_id: Optional[int] = None


class StundeOut(StundeIn):
    id: int
    reihe_id: int
    position: int = 0
    dateien: int = 0          # Zahl der angehängten Dateien
    model_config = {"from_attributes": True}


class ReiheIn(BaseModel):
    name: str = Field("", max_length=200)
    fach: str = Field("", max_length=60)
    jahrgang: str = Field("", max_length=20)
    beschreibung: str = Field("", max_length=20000)
    naechstes_mal: str = Field("", max_length=20000)
    topic_id: Optional[int] = None


class ReiheOut(ReiheIn):
    id: int
    quelle: str = ""
    stunden_anzahl: int = 0
    unterrichtsstunden: int = 0     # Summe der Dauer
    updated_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


class ReiheDetail(ReiheOut):
    stunden: List[StundeOut] = []


# ─── Hilfen ───

async def _eigene_reihe(db: AsyncSession, user: User, reihe_id: int) -> Reihe:
    return await eigenes(db, Reihe, reihe_id, user, "Reihe nicht gefunden", weich=True)


async def _eigene_stunde(db: AsyncSession, user: User, sid: int) -> ReiheStunde:
    st = await eigenes(db, ReiheStunde, sid, user, "Stunde nicht gefunden")
    r = await db.get(Reihe, st.reihe_id)
    if r is None or r.deleted_at is not None:
        raise HTTPException(404, "Stunde nicht gefunden")
    return st


async def _themen(db: AsyncSession, user: User, ids) -> Optional[list]:
    """Weitere Themen auf die eigenen eingrenzen; Fremdes fällt still heraus."""
    if not ids:
        return None
    eigene = {i for (i,) in (await db.execute(select(Topic.id).where(
        Topic.owner_id == user.id, Topic.deleted_at.is_(None), Topic.id.in_(list(ids))))).all()}
    out = []
    for i in ids:
        if i in eigene and i not in out:
            out.append(i)
    return out or None


async def _verweise_pruefen(db: AsyncSession, user: User, daten: dict) -> dict:
    """Quiz, Stapel, Lernleiter, Einstieg: nur was dem Konto gehört bleibt stehen
    (und existiert noch). Fremdes wird verworfen statt abgelehnt — ein Verweis ist
    Zusatz, und eine gelöschte Lernleiter soll das Speichern der Stunde nicht
    blockieren."""
    daten["topic_id"] = await gehoert_optional(db, Topic, daten.get("topic_id"), user.id, pflicht=False)
    daten["topic_ids"] = await _themen(db, user, daten.get("topic_ids"))
    if daten.get("method_id") is not None:
        m = await db.get(Method, daten["method_id"])
        daten["method_id"] = m.id if m and m.owner_id == user.id else None
    if daten.get("lernpfad_ladder_id") is not None:
        l = await db.get(LearningLadder, daten["lernpfad_ladder_id"])
        daten["lernpfad_ladder_id"] = l.id if l and getattr(l, "owner_id", user.id) == user.id else None
    if daten.get("cardvote_set_id") is not None:
        q = await db.get(QuestionSet, daten["cardvote_set_id"])
        ok = False
        if q is not None:
            besitzer = q.owner_id
            if besitzer is None and q.folder_id is not None:
                from ..models import Folder
                f = await db.get(Folder, q.folder_id)
                besitzer = f.owner_id if f else None
            ok = besitzer == user.id
        daten["cardvote_set_id"] = daten["cardvote_set_id"] if ok else None
    ids = daten.get("karten_deck_ids") or []
    if ids:
        eigene = {i for (i,) in (await db.execute(select(CardDeck.id).where(
            CardDeck.owner_id == user.id, CardDeck.deleted_at.is_(None), CardDeck.id.in_(ids)))).all()}
        daten["karten_deck_ids"] = [i for i in ids if i in eigene] or None
    else:
        daten["karten_deck_ids"] = None
    return daten


async def _dateizahl(db: AsyncSession, user: User, stunden_ids: list) -> dict:
    if not stunden_ids:
        return {}
    rows = (await db.execute(select(Material.reihe_stunde_id, func.count()).where(
        Material.owner_id == user.id, Material.reihe_stunde_id.in_(stunden_ids)
    ).group_by(Material.reihe_stunde_id))).all()
    return {sid: n for sid, n in rows}


def _stunde_out(st: ReiheStunde, dateien: int = 0) -> StundeOut:
    return StundeOut(
        id=st.id, reihe_id=st.reihe_id, position=st.position or 0, titel=st.titel or "", dauer=st.dauer or 1,
        topic_id=st.topic_id, topic_ids=st.topic_ids or None, notizen=st.notizen or "",
        naechstes_mal=st.naechstes_mal or "", verlaufsplan=[PhaseItem(**p) for p in (st.verlaufsplan or [])
                                                            if isinstance(p, dict)],
        cardvote_set_id=st.cardvote_set_id, karten_deck_ids=st.karten_deck_ids or None,
        lernpfad_ladder_id=st.lernpfad_ladder_id, method_id=st.method_id, dateien=dateien)


async def _reihe_out(db: AsyncSession, r: Reihe, stunden=None) -> ReiheOut:
    if stunden is None:
        stunden = (await db.execute(select(ReiheStunde).where(ReiheStunde.reihe_id == r.id))).scalars().all()
    return ReiheOut(id=r.id, name=r.name, fach=r.fach, jahrgang=r.jahrgang, beschreibung=r.beschreibung,
                    naechstes_mal=r.naechstes_mal, topic_id=r.topic_id, quelle=r.quelle or "",
                    stunden_anzahl=len(stunden), unterrichtsstunden=sum((s.dauer or 1) for s in stunden),
                    updated_at=r.updated_at)


async def _naechste_position(db: AsyncSession, reihe_id: int) -> int:
    hoechste = (await db.execute(select(func.max(ReiheStunde.position)).where(
        ReiheStunde.reihe_id == reihe_id))).scalar()
    return (hoechste if hoechste is not None else -1) + 1


async def _datei_verlinken(db: AsyncSession, user_id: int, m: Material, **bindung) -> Material:
    """Eine Datei ein zweites Mal ablegen, ohne die Bytes zu verdoppeln: die neue
    Zeile zeigt auf die Zeile, die sie wirklich trägt (`quelle_id`, wie beim
    Hochladen derselben Datei)."""
    neu = Material(owner_id=user_id, filename=m.filename, mime=m.mime, size=m.size, sha256=m.sha256,
                   rolle="", quelle_id=m.quelle_id or m.id, data=None, **bindung)
    db.add(neu)
    return neu


# ─── Reihen ───

@router.get("", response_model=List[ReiheOut])
async def liste(user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    reihen = (await db.execute(select(Reihe).where(
        Reihe.owner_id == user.id, Reihe.deleted_at.is_(None)).order_by(Reihe.fach, Reihe.jahrgang, Reihe.name))).scalars().all()
    if not reihen:
        return []
    alle = (await db.execute(select(ReiheStunde).where(
        ReiheStunde.reihe_id.in_([r.id for r in reihen])))).scalars().all()
    je = {}
    for s in alle:
        je.setdefault(s.reihe_id, []).append(s)
    return [await _reihe_out(db, r, je.get(r.id, [])) for r in reihen]


@router.post("", response_model=ReiheDetail, status_code=201)
async def anlegen(body: ReiheIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("reihen_neu", f"u{user.id}", 60, 3600, "Zu viele neue Reihen.")
    topic = await gehoert_optional(db, Topic, body.topic_id, user.id, pflicht=False)
    r = Reihe(owner_id=user.id, name=(body.name or "").strip() or "Neue Reihe", fach=body.fach.strip(),
              jahrgang=body.jahrgang.strip(), beschreibung=body.beschreibung, naechstes_mal=body.naechstes_mal,
              topic_id=topic)
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return await _detail(db, user, r)


async def _detail(db: AsyncSession, user: User, r: Reihe) -> ReiheDetail:
    stunden = (await db.execute(select(ReiheStunde).where(ReiheStunde.reihe_id == r.id).order_by(
        ReiheStunde.position, ReiheStunde.id))).scalars().all()
    zahl = await _dateizahl(db, user, [s.id for s in stunden])
    basis = await _reihe_out(db, r, stunden)
    return ReiheDetail(**basis.model_dump(), stunden=[_stunde_out(s, zahl.get(s.id, 0)) for s in stunden])


@router.get("/{reihe_id}", response_model=ReiheDetail)
async def lesen(reihe_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    return await _detail(db, user, await _eigene_reihe(db, user, reihe_id))


@router.put("/{reihe_id}", response_model=ReiheDetail)
async def aendern(reihe_id: int, body: ReiheIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    r = await _eigene_reihe(db, user, reihe_id)
    name = (body.name or "").strip()
    if name:
        r.name = name[:200]
    r.fach = body.fach.strip()
    r.jahrgang = body.jahrgang.strip()
    r.beschreibung = body.beschreibung
    r.naechstes_mal = body.naechstes_mal
    r.topic_id = await gehoert_optional(db, Topic, body.topic_id, user.id, pflicht=False)
    await db.commit()
    await db.refresh(r)
    return await _detail(db, user, r)


@router.delete("/{reihe_id}", status_code=204)
async def loeschen(reihe_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Weich: die Reihe liegt danach im Papierkorb (30 Tage)."""
    r = await _eigene_reihe(db, user, reihe_id)
    r.deleted_at = datetime.now(timezone.utc)
    await db.commit()


async def restore_reihe(reihe_id: int, user: User, db: AsyncSession):
    r = await db.get(Reihe, reihe_id)
    if not r or r.owner_id != user.id:
        raise HTTPException(404, "Reihe nicht gefunden")
    r.deleted_at = None
    await db.commit()


async def purge_reihe(reihe_id: int, user: User, db: AsyncSession):
    r = await db.get(Reihe, reihe_id)
    if not r or r.owner_id != user.id:
        raise HTTPException(404, "Reihe nicht gefunden")
    await db.delete(r)
    await db.commit()


@router.post("/{reihe_id}/kopie", response_model=ReiheDetail, status_code=201)
async def kopieren(reihe_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Die Reihe samt Stunden und Dateien duplizieren (z. B. als Ausgangspunkt für
    eine andere Klassenstufe). Dateien werden verlinkt, nicht dupliziert."""
    rate_limit("reihen_neu", f"u{user.id}", 60, 3600, "Zu viele neue Reihen.")
    quelle = await _eigene_reihe(db, user, reihe_id)
    neu = Reihe(owner_id=user.id, name=f"{quelle.name} (Kopie)"[:200], fach=quelle.fach, jahrgang=quelle.jahrgang,
                beschreibung=quelle.beschreibung, naechstes_mal=quelle.naechstes_mal, topic_id=quelle.topic_id,
                quelle=quelle.quelle)
    db.add(neu)
    await db.flush()
    stunden = (await db.execute(select(ReiheStunde).where(ReiheStunde.reihe_id == quelle.id).order_by(
        ReiheStunde.position, ReiheStunde.id))).scalars().all()
    for s in stunden:
        k = ReiheStunde(reihe_id=neu.id, owner_id=user.id, position=s.position, titel=s.titel, dauer=s.dauer,
                        topic_id=s.topic_id, topic_ids=s.topic_ids, notizen=s.notizen, naechstes_mal=s.naechstes_mal,
                        verlaufsplan=s.verlaufsplan, cardvote_set_id=s.cardvote_set_id,
                        karten_deck_ids=s.karten_deck_ids, lernpfad_ladder_id=s.lernpfad_ladder_id,
                        method_id=s.method_id)
        db.add(k)
        await db.flush()
        for m in (await db.execute(select(Material).where(
                Material.owner_id == user.id, Material.reihe_stunde_id == s.id))).scalars().all():
            await _datei_verlinken(db, user.id, m, reihe_stunde_id=k.id)
    await db.commit()
    await db.refresh(neu)
    return await _detail(db, user, neu)


# ─── Stunden ───

@router.post("/{reihe_id}/stunden", response_model=StundeOut, status_code=201)
async def stunde_anlegen(reihe_id: int, body: StundeIn, user: User = Depends(require_module),
                         db: AsyncSession = Depends(get_db)):
    r = await _eigene_reihe(db, user, reihe_id)
    n = (await db.execute(select(func.count()).select_from(ReiheStunde).where(
        ReiheStunde.reihe_id == r.id))).scalar_one()
    if n >= MAX_STUNDEN:
        raise HTTPException(409, f"Eine Reihe hat höchstens {MAX_STUNDEN} Stunden")
    daten = await _verweise_pruefen(db, user, body.model_dump())
    daten["verlaufsplan"] = [p for p in daten.get("verlaufsplan") or []]
    st = ReiheStunde(reihe_id=r.id, owner_id=user.id, position=await _naechste_position(db, r.id), **daten)
    db.add(st)
    await db.commit()
    await db.refresh(st)
    return _stunde_out(st)


@router.put("/stunden/{stunde_id}", response_model=StundeOut)
async def stunde_aendern(stunde_id: int, body: StundeIn, user: User = Depends(require_module),
                         db: AsyncSession = Depends(get_db)):
    st = await _eigene_stunde(db, user, stunde_id)
    daten = await _verweise_pruefen(db, user, body.model_dump())
    for k, v in daten.items():
        setattr(st, k, v)
    await db.commit()
    await db.refresh(st)
    return _stunde_out(st, (await _dateizahl(db, user, [st.id])).get(st.id, 0))


@router.delete("/stunden/{stunde_id}", status_code=204)
async def stunde_loeschen(stunde_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    st = await _eigene_stunde(db, user, stunde_id)
    await db.delete(st)
    await db.commit()


class ReihenfolgeIn(BaseModel):
    ids: List[int]


@router.put("/{reihe_id}/reihenfolge", status_code=204)
async def reihenfolge(reihe_id: int, body: ReihenfolgeIn, user: User = Depends(require_module),
                      db: AsyncSession = Depends(get_db)):
    """Die ganze sichtbare Liste kommt an (nicht „X vor Y"): so bleibt die Folge
    auch dann stimmig, wenn zwei Geräte zugleich sortiert haben."""
    r = await _eigene_reihe(db, user, reihe_id)
    stunden = {s.id: s for s in (await db.execute(select(ReiheStunde).where(
        ReiheStunde.reihe_id == r.id))).scalars().all()}
    gesehen = []
    for i in body.ids:
        if i in stunden and i not in gesehen:
            gesehen.append(i)
    rest = sorted((s for i, s in stunden.items() if i not in gesehen), key=lambda s: (s.position, s.id))
    for pos, i in enumerate(gesehen):
        stunden[i].position = pos
    for pos, s in enumerate(rest, start=len(gesehen)):
        s.position = pos
    await db.commit()


# ─── Zum Kalender (Zusatz, nur mit aktivem Kalender-Modul) ───

class AusKalenderIn(BaseModel):
    name: str = Field("", max_length=200)
    kurs_id: Optional[int] = None
    von: Optional[date] = None
    bis: Optional[date] = None
    eintrag_ids: Optional[List[int]] = None   # Auswahl; leer = alle im Zeitraum


async def _kalender_pflicht(db: AsyncSession, user: User):
    if not await is_active(db, user.id, "kalender"):
        raise HTTPException(409, "Dafür muss das Modul Kalender eingeschaltet sein")


async def _eigener_kurs(db: AsyncSession, user: User, kurs_id: int) -> Kurs:
    return await eigenes(db, Kurs, kurs_id, user, "Kurs nicht gefunden", weich=True)


async def _klasse_des_kurses(db: AsyncSession, kurs_id: int) -> Optional[int]:
    klassen = (await db.execute(select(KursTag.class_id).where(KursTag.kurs_id == kurs_id))).scalars().all()
    return klassen[0] if len(klassen) == 1 else None


async def _kandidaten(db: AsyncSession, user: User, kurs: Kurs, von=None, bis=None, ids=None, alle=False) -> list:
    """Die Kalender-Eintraege eines Kurses, die als Stunde einer Reihe taugen. Ohne Auswahl nur die
    mit Inhalt (ohne Inhalt ist ein Eintrag nur ein Platz im Plan); in der AUSWAHL stehen alle
    Eintraege des Kurses — was dazugehoert, entscheidet die Lehrkraft mit dem Haken."""
    if ids is not None:
        # Ausdruecklich gewaehlte Eintraege: der Besitz genuegt, der Kurs muss nicht passen.
        q = select(CalendarEntry).where(CalendarEntry.owner_id == user.id)
    else:
        # Eintraege des Kurses — auch solche, die nur an der Klasse des Kurses haengen.
        klassen = (await db.execute(select(KursTag.class_id).where(KursTag.kurs_id == kurs.id))).scalars().all()
        passt = CalendarEntry.kurs_id == kurs.id
        if klassen:
            passt = passt | ((CalendarEntry.kurs_id.is_(None)) & CalendarEntry.class_id.in_(klassen))
        q = select(CalendarEntry).where(CalendarEntry.owner_id == user.id, passt, CalendarEntry.period.is_not(None))
    if von:
        q = q.where(CalendarEntry.date >= datetime.combine(von, datetime.min.time()))
    if bis:
        q = q.where(CalendarEntry.date < datetime.combine(bis + timedelta(days=1), datetime.min.time()))
    if ids is not None:
        q = q.where(CalendarEntry.id.in_(ids))
    eintraege = (await db.execute(q.order_by(CalendarEntry.date, CalendarEntry.period))).scalars().all()
    if ids is not None or alle:
        return list(eintraege)
    return [e for e in eintraege if (e.title or e.topic_id or e.notes or e.verlaufsplan)]


@router.get("/kalender-stunden")
async def kalender_stunden(kurs_id: int, von: Optional[date] = None, bis: Optional[date] = None,
                           user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Zur Auswahl: welche vorhandenen Stunden eines Kurses lassen sich in eine Reihe uebernehmen?"""
    await _kalender_pflicht(db, user)
    kurs = await _eigener_kurs(db, user, kurs_id)
    return [{"id": e.id, "date": _tag(e.date).isoformat(),
             "period": e.period, "title": e.title or ""}
            for e in (await _kandidaten(db, user, kurs, von, bis, alle=True))[:MAX_STUNDEN * 2]]


async def _stunden_anhaengen(db: AsyncSession, user: User, r: Reihe, eintraege: list, start: int) -> int:
    """Eintraege als Stunden an die Reihe haengen: Reihenfolge des Kalenders, mit Thema, Ablauf,
    Notizen, Verweisen und den angehaengten Dateien. Zwei Eintraege desselben Tages mit demselben
    Titel sind EINE Doppelstunde."""
    letzte = None      # (Tag, Titel, ReiheStunde)
    n = start
    for e in eintraege:
        tag = _tag(e.date)
        titel = e.title or ""
        if letzte and letzte[0] == tag and letzte[1] == titel and letzte[2].dauer < 4:
            letzte[2].dauer += 1
            continue
        if n >= MAX_STUNDEN:
            break
        decks = [i for i in [e.karten_deck_id, *(e.karten_deck_ids or [])] if i]
        st = ReiheStunde(reihe_id=r.id, owner_id=user.id, position=n, titel=titel, dauer=1,
                         topic_id=e.topic_id, topic_ids=e.topic_ids, notizen=e.notes or "",
                         verlaufsplan=e.verlaufsplan, cardvote_set_id=e.cardvote_set_id,
                         karten_deck_ids=decks or None, lernpfad_ladder_id=e.lernpfad_ladder_id,
                         method_id=e.method_id)
        db.add(st)
        await db.flush()
        for m in (await db.execute(select(Material).where(
                Material.owner_id == user.id, Material.entry_id == e.id))).scalars().all():
            await _datei_verlinken(db, user.id, m, reihe_stunde_id=st.id)
        letzte = (tag, titel, st)
        n += 1
    return n - start


@router.post("/aus-kalender", response_model=ReiheDetail, status_code=201)
async def aus_kalender(body: AusKalenderIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Die gehaltenen Stunden eines Kurses als neue Reihe speichern (alle im Zeitraum oder die
    ausgewaehlten `eintrag_ids`)."""
    await _kalender_pflicht(db, user)
    rate_limit("reihen_neu", f"u{user.id}", 60, 3600, "Zu viele neue Reihen.")
    kurs = await _eigener_kurs(db, user, body.kurs_id) if body.kurs_id else None
    if kurs is None and not body.eintrag_ids:
        raise HTTPException(400, "Kurs oder Auswahl fehlt")
    eintraege = await _kandidaten(db, user, kurs, body.von, body.bis, body.eintrag_ids)
    if not eintraege:
        raise HTTPException(404, "In diesem Zeitraum gibt es keine geplanten Stunden mit Inhalt")
    eintraege = eintraege[:MAX_STUNDEN * 2]
    if kurs is None and eintraege[0].kurs_id:
        kurs = await db.get(Kurs, eintraege[0].kurs_id)
        if kurs is not None and kurs.owner_id != user.id:
            kurs = None
    r = Reihe(owner_id=user.id, name=(body.name or "").strip() or (f"Reihe aus {kurs.name}"[:200] if kurs else "Neue Reihe"),
              fach=(kurs.fach if kurs else "") or "", jahrgang=(kurs.jahrgang if kurs else "") or "",
              quelle=(kurs.name if kurs else "")[:200])
    db.add(r)
    await db.flush()
    await _stunden_anhaengen(db, user, r, eintraege, 0)
    await db.commit()
    await db.refresh(r)
    return await _detail(db, user, r)


@router.post("/{reihe_id}/aus-kalender", response_model=ReiheDetail)
async def aus_kalender_anhaengen(reihe_id: int, body: AusKalenderIn, user: User = Depends(require_module),
                                 db: AsyncSession = Depends(get_db)):
    """Vorhandene Stunden eines Kurses an eine bestehende Reihe haengen."""
    await _kalender_pflicht(db, user)
    rate_limit("reihen_neu", f"u{user.id}", 120, 3600, "Zu viele Änderungen an Reihen.")
    r = await _eigene_reihe(db, user, reihe_id)
    kurs = await _eigener_kurs(db, user, body.kurs_id) if body.kurs_id else None
    if kurs is None and not body.eintrag_ids:
        raise HTTPException(400, "Kurs oder Auswahl fehlt")
    eintraege = await _kandidaten(db, user, kurs, body.von, body.bis, body.eintrag_ids)
    if not eintraege:
        raise HTTPException(404, "In diesem Zeitraum gibt es keine geplanten Stunden mit Inhalt")
    await _stunden_anhaengen(db, user, r, eintraege[:MAX_STUNDEN * 2], await _naechste_position(db, r.id))
    await db.commit()
    await db.refresh(r)
    return await _detail(db, user, r)


class AusspielenIn(BaseModel):
    kurs_id: int
    ab: date
    stunden: Optional[List[int]] = None     # Auswahl; leer = alle


async def _plaetze(db: AsyncSession, user: User, kurs: Kurs, ab: date, benoetigt: int) -> list:
    """Die nächsten freien Unterrichtsstunden des Kurses ab `ab` als (Tag, Stunde).

    Stundenplan, Ferien und Ausfälle sind abgezogen (`app/stundenraster.py`);
    Stunden, in denen der Kurs schon einen Eintrag hat, bleiben unberührt."""
    klasse = await _klasse_des_kurses(db, kurs.id)
    slots = (await db.execute(select(TimetableSlot).where(TimetableSlot.owner_id == user.id))).scalars().all()
    breaks = (await db.execute(select(CalendarBreak).where(CalendarBreak.owner_id == user.id))).scalars().all()
    cancels = (await db.execute(select(SlotCancellation).where(SlotCancellation.owner_id == user.id))).scalars().all()
    ende = ab + timedelta(days=MAX_VORSCHAU_TAGE)
    eintraege = (await db.execute(select(CalendarEntry).where(
        CalendarEntry.owner_id == user.id, CalendarEntry.period.is_not(None)))).scalars().all()
    # Was im Kalender schon an diesem Kurs hängt, zählt nicht als frei.
    def zum_kurs(e):
        return e.kurs_id == kurs.id or (e.kurs_id is None and klasse is not None and e.class_id == klasse)
    belegt = {(_tag(e.date), e.period) for e in eintraege if zum_kurs(e)}
    alle = unterrichtsstunden(kurs_id=kurs.id, class_id=klasse, start=ab, ende=ende, slots=slots,
                              planned=[e for e in eintraege if zum_kurs(e)],
                              breaks_days=freie_tage(breaks),
                              cancel_set={(_tag(c.date), c.period) for c in cancels})
    return [p for p in alle if p not in belegt], klasse


def _verteilen(stunden: list, plaetze: list) -> list:
    """Stunde für Stunde auf die Plätze legen. Eine Doppelstunde braucht
    aufeinanderfolgende Stunden am selben Tag; fehlen sie, rückt sie zum nächsten
    passenden Platz vor (die einzelnen Plätze davor bleiben frei).
    Rückgabe: [(Stunde, [(Tag, Stunde-Nr), …] | None)]"""
    out = []
    i = 0
    for st in stunden:
        d = max(1, st.dauer or 1)
        gefunden = None
        j = i
        while j + d <= len(plaetze):
            fenster = plaetze[j:j + d]
            tag0 = fenster[0][0]
            if d == 1 or (all(p[0] == tag0 for p in fenster)
                          and all(fenster[k + 1][1] == fenster[k][1] + 1 for k in range(d - 1))):
                gefunden = fenster
                break
            j += 1
        if gefunden is None:
            out.append((st, None))
            continue
        out.append((st, gefunden))
        i = j + d
    return out


async def _auswahl(db: AsyncSession, user: User, reihe: Reihe, ids: Optional[List[int]]) -> list:
    stunden = (await db.execute(select(ReiheStunde).where(ReiheStunde.reihe_id == reihe.id).order_by(
        ReiheStunde.position, ReiheStunde.id))).scalars().all()
    if ids:
        wahl = set(ids)
        stunden = [s for s in stunden if s.id in wahl]
    return stunden


@router.get("/{reihe_id}/vorschau")
async def vorschau(reihe_id: int, kurs_id: int, ab: date, stunden: Optional[str] = None, user: User = Depends(require_module),
                   db: AsyncSession = Depends(get_db)):
    """Auf welche Termine fielen die Stunden, wenn die Reihe ab `ab` in den Kurs
    gespielt würde? Schreibt nichts."""
    await _kalender_pflicht(db, user)
    reihe = await _eigene_reihe(db, user, reihe_id)
    kurs = await _eigener_kurs(db, user, kurs_id)
    ids = [int(x) for x in (stunden or "").split(",") if x.strip().isdigit()] or None
    wahl = await _auswahl(db, user, reihe, ids)
    plaetze, _ = await _plaetze(db, user, kurs, ab, sum(s.dauer or 1 for s in wahl))
    return [{"stunde_id": st.id, "titel": st.titel, "dauer": st.dauer or 1,
             "termine": [{"date": t.isoformat(), "period": p} for t, p in (slots or [])],
             "platziert": slots is not None} for st, slots in _verteilen(wahl, plaetze)]


@router.post("/{reihe_id}/ausspielen")
async def ausspielen(reihe_id: int, body: AusspielenIn, user: User = Depends(require_module),
                     db: AsyncSession = Depends(get_db)):
    """Die Stunden der Reihe als Kalender-Einträge im Kurs anlegen — der Reihe
    nach auf die nächsten freien Unterrichtsstunden ab `ab`. Mitgenommen werden
    Titel, Thema, Notizen, Ablauf, Verweise und Dateien."""
    await _kalender_pflicht(db, user)
    rate_limit("reihen_spielen", f"u{user.id}", 20, 3600, "Zu viele Reihen auf einmal angelegt.")
    reihe = await _eigene_reihe(db, user, reihe_id)
    kurs = await _eigener_kurs(db, user, body.kurs_id)
    stunden = await _auswahl(db, user, reihe, body.stunden)
    if not stunden:
        raise HTTPException(404, "Keine Stunden zum Anlegen")
    plaetze, klasse = await _plaetze(db, user, kurs, body.ab, sum(s.dauer or 1 for s in stunden))
    angelegt = 0
    nicht_platziert = []
    for st, slots in _verteilen(stunden, plaetze):
        if slots is None:
            nicht_platziert.append(st.id)
            continue
        # Verweise auf Module nur, wenn das Modul läuft (Regel 3) — der Kalender
        # lehnt sie sonst ab, und die Reihe soll nicht an einem abgeschalteten
        # Modul scheitern.
        verweise = {}
        if st.cardvote_set_id and await is_active(db, user.id, "cardvote"):
            verweise["cardvote_set_id"] = st.cardvote_set_id
        decks = st.karten_deck_ids or []
        if decks and await is_active(db, user.id, "karten"):
            verweise["karten_deck_id"] = decks[0]
            verweise["karten_deck_ids"] = decks[1:] or None
        if st.lernpfad_ladder_id and await is_active(db, user.id, "lernpfad"):
            verweise["lernpfad_ladder_id"] = st.lernpfad_ladder_id
        if st.method_id and await is_active(db, user.id, "unterrichtsplanung"):
            verweise["method_id"] = st.method_id
        dateien = (await db.execute(select(Material).where(
            Material.owner_id == user.id, Material.reihe_stunde_id == st.id))).scalars().all()
        for k, (tag, nr) in enumerate(slots):
            titel = st.titel + (f" ({k + 1}/{len(slots)})" if len(slots) > 1 and st.titel else "")
            e = CalendarEntry(owner_id=user.id, date=tagesbeginn(tag), title=titel, notes=st.notizen or "",
                              class_id=klasse, kurs_id=kurs.id, topic_id=st.topic_id, topic_ids=st.topic_ids,
                              period=nr, verlaufsplan=st.verlaufsplan, **verweise)
            db.add(e)
            await db.flush()
            for m in dateien:
                await _datei_verlinken(db, user.id, m, entry_id=e.id)
            angelegt += 1
    await db.commit()
    return {"angelegt": angelegt, "nicht_platziert": nicht_platziert}
