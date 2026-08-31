"""Kurse (Lerngruppen).

Ein Kurs bündelt Fach-Klassen derselben Lerngruppe (Mathe 7.5, Lernzeit 7.5).
Klassen im selben Kurs teilen sich Schülerliste + Anwesenheit (per Name);
Karten/Noten bleiben pro Fach-Klasse.

Mitgliedschaft ist many-to-many (Tabelle kurs_tags): eine Klasse kann in
mehreren Kursen sein. Alle Mitglieder eines Kurses teilen — es gibt keinen
Unterschied „Sharing vs. Tag" mehr.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete, update, func
from sqlalchemy.ext.asyncio import AsyncSession

from datetime import datetime, timezone

from ..besitz import eigenes
from ..kursmitglieder import (
    eigener_kurs as _owned_kurs,
    member_class_ids,
    member_student_ids,
    schuljahr_aus_name,
    sibling_class_ids,
)
from ..schueler import sortiert
from ..database import get_db
from ..models import Kurs, KursTag, KursStudent, SchoolClass, Student, User
from .auth import get_current_user
from .classes import MASSNAHMEN_VALUES

# Die Mitgliedschafts-Fragen („welche Klassen, welche SuS, welche Geschwister?")
# stehen im Blatt `kursmitglieder.py`, nicht mehr hier — dieser Router ist die
# HTTP-Seite davon und ruft sie wie jeder andere auch.

router = APIRouter(prefix="/api/kurse", tags=["kurse"])


class KursIn(BaseModel):
    name: str
    niveau_aktiv: Optional[bool] = None
    schuljahr: Optional[str] = None      # "2025/26" — Beschriftung, kein Zeitraum
    vorgaenger_id: Optional[int] = None  # dieselbe Lerngruppe im Vorjahr (0/None = keiner)
    # Fach und Jahrgang — das Gegenstueck zu `topics.fach`/`topics.jahrgang`.
    # Erst dadurch ist „die Themen dieses Kurses" eine Abfrage: der NAME ist
    # frei („Mathe 7.5", „M7b", „Mathe Gruppe rot"), und daraus einen
    # Zusammenhang zu raten waere genau der Fehler, den die Taxonomie vermeidet.
    fach: Optional[str] = None
    jahrgang: Optional[int] = None
    # Stammraum ("B204"). Der Kalender setzt ihn als Ort der Stunde ein.
    raum: Optional[str] = None


class NiveauIn(BaseModel):
    name: str            # Person (Anzeigename, kursweit eindeutig)
    niveau: str = ""     # "" | "E" | "G"


class ClassRef(BaseModel):
    id: int
    name: str


class KursOut(BaseModel):
    id: int
    name: str
    classes: List[ClassRef] = []
    niveau_aktiv: bool = False
    color: str = ""
    member_count: int = 0    # einzeln hinzugefügte SuS (Kurs aus Teilen von Klassen)
    schuljahr: str = ""
    fach: str = ""
    jahrgang: Optional[int] = None
    raum: str = ""
    vorgaenger_id: Optional[int] = None
    vorgaenger_name: str = ""       # damit die Liste nicht je Kurs nachfragen muss
    nachfolger_id: Optional[int] = None
    nachfolger_name: str = ""


async def _kette_ok(db, user, kurs_id: int, vorgaenger_id: int) -> None:
    """Ein Kurs darf nicht sein eigener Vorgaenger sein — auch nicht ueber Ecken.

    Ohne diese Pruefung laesst sich A→B→A bauen, und jede Anzeige, die der Kette
    folgt, dreht sich im Kreis (die Liste laedt dann bis zum Anschlag).
    """
    if vorgaenger_id == kurs_id:
        raise HTTPException(400, "Ein Kurs kann nicht sein eigenes Vorjahr sein")
    gesehen = {kurs_id}
    lauf = vorgaenger_id
    for _ in range(20):
        if lauf is None:
            return
        if lauf in gesehen:
            raise HTTPException(400, "Das ergäbe einen Kreis in der Jahresfolge")
        gesehen.add(lauf)
        k = await db.get(Kurs, lauf)
        if not k or k.owner_id != user.id:
            raise HTTPException(404, "Vorjahres-Kurs nicht gefunden")
        lauf = k.vorgaenger_id


async def _own_class(db, user, class_id) -> SchoolClass:
    # Besitz strikt wie in classes.py: eine Klasse ohne owner_id gehoert
    # niemandem und darf nicht in einen fremden Kurs wandern — ueber den Kurs
    # wuerden sonst Niveau und Massnahmen ihrer SuS geschrieben. Deshalb der
    # allgemeine `eigenes` und NICHT `besitz.klasse_oder_403`, das eine Klasse
    # ohne owner_id durchlaesst.
    return await eigenes(db, SchoolClass, class_id, user, "Klasse nicht gefunden")


async def _students_of_kurs(db, kurs_id, ordered: bool = False) -> list:
    """Alle SuS-Zeilen des Kurses; leere Liste, wenn keiner drin ist. Stand
    viermal fast wortgleich da (kurs_students, set_niveau, kurs_massnahmen,
    set_kurs_massnahmen) — Lesen und Schreiben MUESSEN dieselbe Menge treffen,
    sonst speichert eine Seite, was die andere nicht zeigt. Einziger
    Unterschied: `ordered` fuer die Anzeigereihenfolge der Leseseiten."""
    sids = list(await member_student_ids(db, kurs_id))
    if not sids:
        return []
    if ordered:
        return await sortiert(db, Student.id.in_(sids))
    return (await db.execute(select(Student).where(Student.id.in_(sids)))).scalars().all()


async def _rows_of_person(db, studs, name: str) -> list:
    """Alle Zeilen einer Person (gleicher Name) — die des Kurses und die aus den
    Geschwisterklassen, ohne Dubletten. War wortgleich in set_niveau und
    set_kurs_massnahmen: E/G wie Massnahmen haengen an der Person, nicht an der
    Fach-Klasse, und gehen deshalb auf jede ihrer Zeilen — eine Aufloesung
    statt zwei."""
    klassen = {s.class_id for s in studs if s.name.strip() == name}
    zwillinge = []
    if klassen:
        alle = set()
        for cid in klassen:
            alle |= await sibling_class_ids(db, cid)
        zwillinge = (await db.execute(select(Student).where(Student.class_id.in_(list(alle))))).scalars().all()
    return [s for s in {x.id: x for x in list(studs) + list(zwillinge)}.values()
            if s.name.strip() == name]


async def _classes_by_kurs(db, user, kurse):
    names = {c.id: c.name for c in (await db.execute(select(SchoolClass).where(
        SchoolClass.owner_id == user.id, SchoolClass.deleted_at.is_(None)))).scalars().all()}
    tags = (await db.execute(select(KursTag).where(KursTag.kurs_id.in_([k.id for k in kurse] or [-1])))).scalars().all()
    out = {}
    for tg in tags:
        if tg.class_id in names:
            out.setdefault(tg.kurs_id, []).append(ClassRef(id=tg.class_id, name=names[tg.class_id]))
    return out


@router.get("", response_model=List[KursOut])
async def list_kurse(archiviert: bool = False, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Aktive Kurse. `archiviert=true` liefert das Archiv (Schuljahresende).

    Archiv heisst: raus aus den Auswahllisten, Inhalte bleiben vollstaendig.
    Der Papierkorb kann das nicht — der loescht nach 30 Tagen.
    """
    zustand = Kurs.archived_at.is_not(None) if archiviert else Kurs.archived_at.is_(None)
    kurse = (await db.execute(select(Kurs).where(
        Kurs.owner_id == user.id, Kurs.deleted_at.is_(None), zustand).order_by(Kurs.name))).scalars().all()
    by = await _classes_by_kurs(db, user, kurse)
    mc = dict((await db.execute(
        select(KursStudent.kurs_id, func.count(KursStudent.id))
        .where(KursStudent.kurs_id.in_([k.id for k in kurse] or [-1])).group_by(KursStudent.kurs_id)
    )).all())
    # Namen der Nachbarn in der Jahresfolge mitgeben — auch die des Vorjahres,
    # das meist im ARCHIV liegt und in dieser Liste sonst gar nicht vorkaeme.
    alle = dict((await db.execute(
        select(Kurs.id, Kurs.name).where(Kurs.owner_id == user.id, Kurs.deleted_at.is_(None))
    )).all())
    nachfolger = {}   # vorgaenger_id -> (id, name) des Folgejahres
    for k2 in (await db.execute(select(Kurs.id, Kurs.name, Kurs.vorgaenger_id).where(
            Kurs.owner_id == user.id, Kurs.deleted_at.is_(None), Kurs.vorgaenger_id.is_not(None)))).all():
        nachfolger[k2[2]] = (k2[0], k2[1])
    return [KursOut(id=k.id, name=k.name, classes=by.get(k.id, []), niveau_aktiv=k.niveau_aktiv,
                    color=k.color, member_count=int(mc.get(k.id, 0)),
                    schuljahr=k.schuljahr, fach=k.fach or "", jahrgang=k.jahrgang,
                    raum=k.raum or "", vorgaenger_id=k.vorgaenger_id,
                    vorgaenger_name=alle.get(k.vorgaenger_id, "") if k.vorgaenger_id else "",
                    nachfolger_id=(nachfolger.get(k.id) or (None, ""))[0],
                    nachfolger_name=(nachfolger.get(k.id) or (None, ""))[1]) for k in kurse]


@router.post("/{kurs_id}/archive", response_model=KursOut)
async def archive_kurs(kurs_id: int, mit_klassen: bool = True, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Kurs ins Archiv (oder zurueck). Standardmaessig ziehen seine Fach-Klassen
    mit: am Schuljahresende ist der ganze Kurs vorbei, und eine Klasse allein in
    den Listen zu lassen waere genau die halbe Arbeit, die man vergisst."""
    k = await _owned_kurs(db, user, kurs_id)
    jetzt = None if k.archived_at else datetime.now(timezone.utc)
    k.archived_at = jetzt
    if mit_klassen:
        klassen = (await db.execute(select(SchoolClass).where(
            SchoolClass.owner_id == user.id, SchoolClass.kurs_id == kurs_id,
            SchoolClass.deleted_at.is_(None)))).scalars().all()
        for c in klassen:
            c.archived_at = jetzt
    await db.commit()
    await db.refresh(k)
    return KursOut(id=k.id, name=k.name, classes=[], niveau_aktiv=k.niveau_aktiv, color=k.color)


@router.get("/trash", response_model=List[KursOut])
async def list_kurs_trash(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    kurse = (await db.execute(select(Kurs).where(
        Kurs.owner_id == user.id, Kurs.deleted_at.is_not(None)).order_by(Kurs.deleted_at.desc()))).scalars().all()
    return [KursOut(id=k.id, name=k.name, classes=[], niveau_aktiv=k.niveau_aktiv, color=k.color) for k in kurse]


@router.post("", response_model=KursOut, status_code=201)
async def create_kurs(body: KursIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Name darf nicht leer sein")
    # Neu angelegte Kurse bekommen das Schuljahr aus ihrem Namen, falls es
    # dort steht — dieselbe Regel wie beim Backfill der Bestandskurse.
    k = Kurs(owner_id=user.id, name=name[:100], schuljahr=schuljahr_aus_name(name))
    db.add(k)
    await db.commit()
    await db.refresh(k)
    return KursOut(id=k.id, name=k.name, classes=[], niveau_aktiv=k.niveau_aktiv, color=k.color)


@router.put("/{kurs_id}", response_model=KursOut)
async def rename_kurs(kurs_id: int, body: KursIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    k = await _owned_kurs(db, user, kurs_id)
    name = (body.name or "").strip()
    if name:
        k.name = name[:100]
    if body.niveau_aktiv is not None:
        k.niveau_aktiv = bool(body.niveau_aktiv)
    if body.schuljahr is not None:
        k.schuljahr = (body.schuljahr or "").strip()[:9]
    if body.vorgaenger_id is not None:
        neu_id = body.vorgaenger_id or None
        if neu_id:
            await _kette_ok(db, user, k.id, neu_id)
        k.vorgaenger_id = neu_id
    if body.fach is not None:
        k.fach = (body.fach or "").strip()[:60]
    if body.jahrgang is not None:
        # 0 heisst „keine Angabe" — die Oberflaeche schickt bei geleertem Feld
        # keine Null, sondern nichts; beides muss hier dasselbe bedeuten.
        k.jahrgang = body.jahrgang or None
    if body.raum is not None:
        k.raum = (body.raum or "").strip()[:60]
    await db.commit()
    return KursOut(id=k.id, name=k.name, classes=[], niveau_aktiv=k.niveau_aktiv, color=k.color,
                   schuljahr=k.schuljahr, fach=k.fach or "", jahrgang=k.jahrgang,
                   raum=k.raum or "", vorgaenger_id=k.vorgaenger_id)


class ColorIn(BaseModel):
    color: str = ""


@router.put("/{kurs_id}/color", response_model=KursOut)
async def set_kurs_color(kurs_id: int, body: ColorIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Kursfarbe (Stundenplan/Kalender). Alle Fach-Klassen des Kurses teilen sie."""
    k = await _owned_kurs(db, user, kurs_id)
    c = (body.color or "").strip()[:9]
    k.color = c if (c.startswith("#") and len(c) in (4, 7, 9)) else ""
    await db.commit()
    return KursOut(id=k.id, name=k.name, classes=[], niveau_aktiv=k.niveau_aktiv, color=k.color)


@router.post("/{kurs_id}/classes/{class_id}", status_code=204)
async def add_member(kurs_id: int, class_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Klasse dem Kurs hinzufügen. Eine Klasse darf in mehreren Kursen sein."""
    await _owned_kurs(db, user, kurs_id)
    await _own_class(db, user, class_id)
    exists = (await db.execute(select(KursTag).where(KursTag.kurs_id == kurs_id, KursTag.class_id == class_id))).scalar_one_or_none()
    if not exists:
        db.add(KursTag(kurs_id=kurs_id, class_id=class_id))
        await db.commit()


@router.delete("/{kurs_id}/classes/{class_id}", status_code=204)
async def remove_member(kurs_id: int, class_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Klasse aus diesem Kurs entfernen (bleibt in ihren anderen Kursen)."""
    await _owned_kurs(db, user, kurs_id)
    await db.execute(delete(KursTag).where(KursTag.kurs_id == kurs_id, KursTag.class_id == class_id))
    # Auch die alte 1:1-Spalte loesen. Jede neue Klasse traegt sie auf ihren
    # eigenen Kurs; ohne das blieb die Klasse trotz Entfernen Mitglied und
    # teilte weiter SuS, Anwesenheit und Massnahmen.
    await db.execute(update(SchoolClass).where(
        SchoolClass.id == class_id, SchoolClass.kurs_id == kurs_id).values(kurs_id=None))
    await db.execute(update(Student).where(
        Student.class_id == class_id, Student.kurs_id == kurs_id).values(kurs_id=None))
    await db.commit()


# ─── Einzelne SuS im Kurs (Kurse aus Teilen von Klassen) ───

async def _own_student(db, user, student_id) -> Student:
    s = await db.get(Student, student_id)
    if s:
        c = await db.get(SchoolClass, s.class_id)
        if c and (not c.owner_id or c.owner_id == user.id):
            return s
    raise HTTPException(404, "Schüler nicht gefunden")


@router.get("/{kurs_id}/members")
async def list_student_members(kurs_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Einzeln hinzugefügte SuS des Kurses (mit Herkunftsklasse).

    Hier ausnahmsweise nach Namen: das ist kein Roster, sondern die Verwaltung
    der Mitglieder — eine Wolke aus mehreren Klassen, in der man eine Person
    sucht. position gilt je Klasse und würde quer über Klassen nichts ordnen."""
    await _owned_kurs(db, user, kurs_id)
    sids = (await db.execute(select(KursStudent.student_id).where(KursStudent.kurs_id == kurs_id))).scalars().all()
    if not sids:
        return []
    rows = (await db.execute(
        select(Student.id, Student.name, Student.class_id, SchoolClass.name)
        .join(SchoolClass, Student.class_id == SchoolClass.id)
        .where(Student.id.in_(list(sids))).order_by(Student.name)
    )).all()
    return [{"student_id": sid, "name": n, "class_id": cid, "class_name": cn} for (sid, n, cid, cn) in rows]


@router.post("/{kurs_id}/members/{student_id}", status_code=204)
async def add_student_member(kurs_id: int, student_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Einzelnen Schüler dem Kurs hinzufügen (Teilmenge einer Klasse)."""
    await _owned_kurs(db, user, kurs_id)
    await _own_student(db, user, student_id)
    exists = (await db.execute(select(KursStudent).where(KursStudent.kurs_id == kurs_id, KursStudent.student_id == student_id))).scalar_one_or_none()
    if not exists:
        db.add(KursStudent(kurs_id=kurs_id, student_id=student_id))
        await db.commit()


@router.delete("/{kurs_id}/members/{student_id}", status_code=204)
async def remove_student_member(kurs_id: int, student_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Einzelnen Schüler aus dem Kurs entfernen."""
    await _owned_kurs(db, user, kurs_id)
    await db.execute(delete(KursStudent).where(KursStudent.kurs_id == kurs_id, KursStudent.student_id == student_id))
    await db.commit()


# ─── E-/G-Niveau (pro Kurs gepflegt, betrifft die Person) ───

@router.get("/{kurs_id}/students")
async def kurs_students(kurs_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """SuS des Kurses (per Name dedupliziert) mit ihrem E/G-Niveau. E/G ist eine
    Eigenschaft der Person, nicht der Fach-Klasse — darum hier gepflegt."""
    await _owned_kurs(db, user, kurs_id)
    out = {}
    for s in await _students_of_kurs(db, kurs_id, ordered=True):
        n = s.name.strip()
        if not n:
            continue
        if n not in out:
            out[n] = {"name": n, "niveau": s.niveau or ""}
        elif not out[n]["niveau"] and s.niveau:
            out[n]["niveau"] = s.niveau
    return list(out.values())


@router.put("/{kurs_id}/niveau", status_code=204)
async def set_niveau(kurs_id: int, body: NiveauIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """E/G einer Person im Kurs setzen — wirkt auf ALLE ihre Fach-Klassen-Zeilen
    (gleicher Name), damit z.B. Karten je Niveau überall greifen."""
    await _owned_kurs(db, user, kurs_id)
    niveau = body.niveau if body.niveau in ("E", "G") else ""
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Name fehlt")
    # Dieselbe Menge wie beim Lesen (kurs_students): SuS der Mitgliedsklassen
    # UND einzeln hinzugefuegte. Ueber member_class_ids allein blieb ein Kurs
    # aus Teilen von Klassen ohne Treffer — gespeichert wurde dann nichts.
    studs = await _students_of_kurs(db, kurs_id)
    if not studs:
        return
    # Auf alle Fach-Klassen-Zeilen der Person schreiben (gleicher Name) — E/G
    # ist eine Eigenschaft der Person, nicht der einzelnen Fach-Klasse.
    for s in await _rows_of_person(db, studs, name):
        s.niveau = niveau
    await db.commit()


# ─── Fördermaßnahmen (pro Kurs gepflegt) ───
# Ein Nachteilsausgleich wirkt fachbezogen: mehr Zeit in Mathe heißt nicht
# dasselbe wie in Sport. Er hängt deshalb am Kurs, nicht an der Klasse — die
# Klasse sind die Schüler. Gespeichert wird er weiterhin an der Person
# (students.massnahmen), jeder Eintrag trägt seine kurs_id.


class MassnahmenIn(BaseModel):
    name: str
    massnahmen: List[dict] = []


@router.get("/{kurs_id}/massnahmen")
async def kurs_massnahmen(kurs_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """SuS des Kurses (per Name dedupliziert) mit ihren Maßnahmen FÜR DIESEN
    Kurs. Altbestand ohne kurs_id gilt weiter überall und wird mitgezeigt."""
    await _owned_kurs(db, user, kurs_id)
    out = {}
    for s in await _students_of_kurs(db, kurs_id, ordered=True):
        n = s.name.strip()
        if not n:
            continue
        eigene = [m for m in (s.massnahmen or []) if m.get("kurs_id") in (None, kurs_id)]
        if n not in out:
            out[n] = {"name": n, "massnahmen": eigene}
        elif eigene and not out[n]["massnahmen"]:
            out[n]["massnahmen"] = eigene
    return list(out.values())


@router.put("/{kurs_id}/massnahmen", status_code=204)
async def set_kurs_massnahmen(kurs_id: int, body: MassnahmenIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Maßnahmen einer Person IN DIESEM Kurs setzen. Einträge anderer Kurse
    bleiben unberührt; geschrieben wird auf alle Fach-Klassen-Zeilen der Person
    (gleicher Name), damit jede Ansicht dieselben Daten sieht."""
    await _owned_kurs(db, user, kurs_id)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Name fehlt")
    if len(body.massnahmen) > 20:
        raise HTTPException(400, "Zu viele Fördermaßnahmen (max. 20)")
    neu = []
    for m in body.massnahmen:
        art = (m.get("art") or "").strip()
        if art not in MASSNAHMEN_VALUES:
            raise HTTPException(400, f"Unbekannte Fördermaßnahme: {art}")
        detail = (m.get("detail") or "").strip()
        if len(detail) > 300:
            raise HTTPException(400, "Beschreibung zu lang (max. 300 Zeichen)")
        neu.append({"art": art, "detail": detail, "arbeit": bool(m.get("arbeit")), "kurs_id": kurs_id})

    # Dieselbe Menge wie beim Lesen: SuS der Mitgliedsklassen UND einzeln
    # hinzugefügte. Über member_class_ids allein blieb ein Kurs aus Teilen von
    # Klassen ohne Treffer — gespeichert wurde dann nichts.
    studs = await _students_of_kurs(db, kurs_id)
    if not studs:
        return
    # Auf alle Fach-Klassen-Zeilen der Person schreiben (gleicher Name), damit
    # jede Ansicht dieselben Daten sieht — auch die des Kalenders, der über die
    # Geschwisterklassen der Termin-Klasse sucht.
    for s in await _rows_of_person(db, studs, name):
        fremd = [m for m in (s.massnahmen or []) if m.get("kurs_id") not in (None, kurs_id)]
        s.massnahmen = (fremd + neu) or None
    await db.commit()


# ─── Kurs löschen / Papierkorb ───

@router.delete("/{kurs_id}", status_code=204)
async def delete_kurs(kurs_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """In den Papierkorb (30 Tage). Die Mitgliedschaften werden entfernt (die
    Klassen bleiben, ggf. in ihren anderen Kursen); Restore stellt sie wieder her."""
    k = await _owned_kurs(db, user, kurs_id)
    # Auch Mitglieder im Papierkorb merken: sonst waere ihre Mitgliedschaft
    # verloren, sobald die Klasse spaeter wiederhergestellt wird.
    members = list(await member_class_ids(db, [kurs_id], mit_geloeschten=True))
    k.deleted_members = members
    await db.execute(delete(KursTag).where(KursTag.kurs_id == kurs_id))
    await db.execute(update(SchoolClass).where(SchoolClass.kurs_id == kurs_id).values(kurs_id=None))
    k.deleted_at = datetime.now(timezone.utc)
    await db.commit()


@router.post("/{kurs_id}/restore", response_model=KursOut)
async def restore_kurs(kurs_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    k = await _owned_kurs(db, user, kurs_id)
    for cid in (k.deleted_members or []):
        c = await db.get(SchoolClass, cid)
        # Auch Klassen im Papierkorb bekommen ihre Mitgliedschaft zurueck —
        # sie zaehlt erst wieder, wenn die Klasse selbst zurueckgeholt wird.
        if c and c.owner_id == user.id:
            exists = (await db.execute(select(KursTag).where(KursTag.kurs_id == kurs_id, KursTag.class_id == cid))).scalar_one_or_none()
            if not exists:
                db.add(KursTag(kurs_id=kurs_id, class_id=cid))
    k.deleted_at = None
    k.deleted_members = None
    await db.commit()
    by = await _classes_by_kurs(db, user, [k])
    return KursOut(id=k.id, name=k.name, classes=by.get(k.id, []), niveau_aktiv=k.niveau_aktiv, color=k.color)


@router.delete("/{kurs_id}/purge", status_code=204)
async def purge_kurs(kurs_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    k = await _owned_kurs(db, user, kurs_id)
    if k.deleted_at is None:
        raise HTTPException(400, "Kurs ist nicht im Papierkorb")
    await db.delete(k)
    await db.commit()
