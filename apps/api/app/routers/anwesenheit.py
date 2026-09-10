"""Modul Anwesenheit — Anwesenheit/Fehlzeiten je Klasse und Datum.

Eigenstaendig (Regel 3): Schueler kommen aus dem Kern, hier liegt nur der
Status je (Schueler, Datum). status: da | fehlt | spaet | entsch.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..besitz import klasse_oder_403
from ..kursmitglieder import eigener_kurs, kurs_der_klasse, member_student_ids, sibling_class_ids
from ..schueler import in_klasse, kanonisch, sortiert
from ..pdfdruck import als_anhang, neue_seite
from ..database import get_db
from ..models import Attendance, CalendarBreak, Student, TimetableSlot, User
from ..zeit import SCHUL_TZ, schul_datum
from .auth import rate_limit
from .modules import modul_pflicht

router = APIRouter(prefix="/api/anwesenheit", tags=["anwesenheit"])
# Anwesenheit ist kein eigenes Modul mehr, sondern lebt im Modul „Orga &
# Anwesenheit". Deshalb gategt der Router über orga.
MODULE_KEY = "orga"
_STATUS = {"da", "fehlt", "spaet", "entsch"}


require_module = modul_pflicht(MODULE_KEY)


# Frueher stand die Klassenpruefung in fuenf Routern wortgleich; jetzt eine
# Quelle (app/besitz.py). Der alte Name bleibt, damit die Aufrufer unberuehrt
# sind.
_owned_class = klasse_oder_403


# Ein Schultag ist ein Tag der SCHULE, kein UTC-Tag — die Rechnung dazu steht
# im Kern (`app/zeit.py`), damit sie nicht in jedem Router noch einmal entsteht.
# JEDE Tagesrechnung dieses Moduls laeuft darueber: Eintragen, Lesen, Zaehlen,
# Ferienabgleich, Druck. Blieb eine Stelle bei `d.date()` (also UTC), zaehlte
# sie den Vortag.
def _schul_tag(d: datetime) -> str:
    """Der Schultag als „YYYY-MM-DD"."""
    return schul_datum(d).strftime("%Y-%m-%d")


def _day_bounds(d: datetime):
    """Anfang und Ende des Schultags, in den dieser Zeitpunkt faellt."""
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    lokal = d.astimezone(SCHUL_TZ)
    start = lokal.replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start.replace(hour=23, minute=59, second=59)


async def _kurs_maps(db, user, class_id):
    """Anwesenheit wird über den Kurs geteilt: gleichnamige SuS der Fach-Klassen
    desselben Kurses sind dieselbe Person.

    Zwei Regeln, die vorher auseinanderliefen:

    **Kanonisch heisst ueberall dasselbe.** Hier stand „kleinste student_id je
    Name", im Rest des Hauses (`app/schueler.kanonisch`, benutzt von Notenbuch,
    Klassenarbeit und Karten) „die erste Zeile in der Sortierung nach position".
    Bei einem Kurs aus mehreren Fach-Klassen sind das verschiedene Zeilen — und
    dann passte kein einziger Schluessel: das Notenbuch fragte die Fehlzeiten zu
    Person A, bekam sie zu Person B und faerbte einfach nichts. Kein Fehler,
    keine Meldung, nur eine Tabelle ohne Rot.

    **Gelesen wird ueber ALLE Zeilen der Person, geschrieben auf die
    kanonische.** Bestandsdaten liegen auf der Zeile, die frueher kanonisch war;
    wer nur die neue liest, verliert sie aus dem Blick.

    Liefert:
      lese_ids   – alle student_ids des Kurses (fuer die Abfrage)
      to_canon   – IRGENDEINE dieser ids -> kanonische id der Person
      canon_back – kanonische id -> student_id dieser Klasse (fuer die Anzeige)
    """
    sib_ids = await sibling_class_ids(db, class_id)  # Klassen, die einen Kurs teilen (inkl. self)
    # ERST sortieren, dann deduplizieren — `kanonisch` nimmt je Name den ersten
    # Treffer der Reihenfolge, in der die Liste hereinkommt. Roh aus der
    # Datenbank waere das die id-Reihenfolge, und genau daran lag der alte
    # Unterschied zum Notenbuch (das ueber `roster_klasse` sortiert liest).
    kurs_studs = await sortiert(db, Student.class_id.in_(sib_ids))
    canon = {s.name.strip(): s.id for s in kanonisch(kurs_studs)}
    to_canon = {s.id: canon.get(s.name.strip(), s.id) for s in kurs_studs}
    canon_back = {}
    for s in kurs_studs:
        if s.class_id == class_id:
            canon_back[canon.get(s.name.strip(), s.id)] = s.id
    return [s.id for s in kurs_studs], to_canon, canon_back


async def _kurs_kanon(db, user, kurs_id, lese_ids):
    """Kanonische Zeile je Person — aus Sicht DIESES Kurses.

    `_kurs_maps` rechnet ueber die Geschwisterklassen der Klasse. Das ist die
    richtige Sicht, solange die Klasse in genau einem Kurs liegt. Liegt sie in
    zweien (dieselben Kinder in „WP7" und „Mathe"), ist die Menge groesser als
    der Kurs, und `kanonisch` waehlt darin eine andere Zeile als das Notenbuch,
    das seine Zeilen aus dem KURS zieht (`schueler.roster_kurs`). Dann passte
    kein einziger Schluessel, und die Faerbung blieb aus — ohne Fehler und ohne
    Hinweis, genau das Fehlerbild, das schon zweimal woanders gesucht wurde.

    Deshalb sagt der Aufrufer, welchen Kurs er meint. Gelesen wird weiter ueber
    alle Zeilen (die Anwesenheit liegt auf der Zeile, die beim Eintragen
    kanonisch war), abgebildet wird auf die Zeile, die der Kurs fuehrt.

    Liefert: (id -> kanonische id im Kurs, alle zu lesenden ids)
    """
    await eigener_kurs(db, user, kurs_id)
    kurs_ids = await member_student_ids(db, kurs_id)
    kurs_studs = await sortiert(db, Student.id.in_(list(kurs_ids) or [-1]))
    canon = {s.name.strip(): s.id for s in kanonisch(kurs_studs)}
    alle = set(lese_ids) | set(kurs_ids)
    rows = await sortiert(db, Student.id.in_(list(alle) or [-1]))
    return {s.id: canon[s.name.strip()] for s in rows if s.name.strip() in canon}, list(alle)


# Schwere eines Status, um bei mehreren Stunden am Tag den „Tages-Status" zu
# bestimmen (Fehlzeiten-Zaehlung, Tagesansicht ohne Stunde). fehlt > entsch >
# spaet: entschuldigt bleibt eine Abwesenheit, verspaetet ist die leichteste.
_RANK = {"fehlt": 3, "entsch": 2, "spaet": 1, "da": 0}


def _sichtbar(r, kurs_id) -> bool:
    """Gehoert dieser Eintrag in die Sicht DIESES Kurses?

    **Anwesenheit ist immer pro Kurs** (entschieden am 10.09.2026). Vorher galt
    sie tagesweit: wer in der ersten Stunde fehlte, war bis zum Abend in JEDEM
    Kurs abwesend — auch in dem, in dem er nachmittags sass.

    Zwei Zeilen zaehlen trotzdem ueberall mit, und das ist Absicht:

      * `kurs_id IS NULL` — der Bestand von vor dem Umbau. Ihn auszublenden
        hiesse, die Fehlzeiten waeren ueber Nacht verschwunden.
      * `period IS NULL` — ohne Stunde erfasst heisst „ganzer Tag", egal welcher
        Kurs beim Eintragen offen war. Genau so traegt die Lehrkraft „heute gar
        nicht da" ein.
    """
    if kurs_id is None or r.kurs_id is None or r.period is None:
        return True
    return r.kurs_id == kurs_id


def _tages_status(rows, zu_person=None):
    """Aus den Stunden-Eintraegen eines Tages den staerksten je PERSON.

    `zu_person` bildet die Zeile auf die kanonische ab — sonst zaehlten zwei
    Zeilen desselben Kindes (aus zwei Fach-Klassen) als zwei Kinder.
    """
    wer = zu_person or (lambda sid: sid)
    best = {}
    for r in rows:
        sid = wer(r.student_id)
        cur = best.get(sid)
        if cur is None or _RANK.get(r.status, 0) > _RANK.get(cur.status, 0):
            best[sid] = r
    return best


@router.get("/{class_id}")
async def get_day(class_id: int, date: datetime, period: Optional[int] = None,
                  kurs_id: Optional[int] = None,
                  user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Status je Schueler an einem Tag — in der Sicht EINES Kurses.

    Ohne `period`: der staerkste Status des Tages je Schueler (Tagesansicht,
    Zufall, Kalender). Mit `period`: die Eintraege genau dieser Stunde; `kurs_id`
    sagt, welcher Kurs gemeint ist (siehe `_sichtbar`).

    Fehlt ein Eintrag, kommt ein **Vorschlag** aus einer frueheren Stunde
    desselben Tages — egal aus welchem Kurs, denn wer morgens fehlt, fehlt
    nachmittags meistens auch. Er traegt `vorschlag: true` und die Stunde, aus
    der er stammt (`quelle`, None = tagesweiter Eintrag), und wird **nicht**
    gespeichert: vorher legte dieser Zweig stillschweigend Kopien in die
    Datenbank, und damit stand in der Statistik eine Abwesenheit, die niemand
    bestaetigt hatte. Bestaetigt wird jetzt in der Oberflaeche (Speichern-Knopf).
    """
    await _owned_class(db, user, class_id)
    if kurs_id is not None:
        await eigener_kurs(db, user, kurs_id)
    lo, hi = _day_bounds(date)
    lese_ids, to_canon, canon_back = await _kurs_maps(db, user, class_id)
    # Gelesen wird ueber ALLE Zeilen des Kurses und danach auf die Person
    # abgebildet: Bestandsdaten liegen auf der Zeile, die frueher kanonisch war.
    rows = (await db.execute(select(Attendance).where(
        Attendance.owner_id == user.id, Attendance.student_id.in_(lese_ids or [-1]),
        Attendance.date >= lo, Attendance.date <= hi,
    ))).scalars().all()
    person = lambda sid: to_canon.get(sid, sid)

    def out(r):
        return {"status": r.status, "note": r.note, "period": r.period}
    # Kanonische id -> student_id dieser Klasse fürs UI.
    back = lambda sid: canon_back.get(sid, sid)

    # Was gehoert in die Sicht dieses Kurses? (Der Vorschlag unten sieht
    # bewusst auf ALLE Zeilen — er fragt nach dem Vormittag, nicht nach dem Kurs.)
    sicht = [r for r in rows if _sichtbar(r, kurs_id)]

    if not period:
        best = _tages_status(sicht, person)
        return {str(back(sid)): out(r) for sid, r in best.items()}

    exact = {person(r.student_id): r for r in sicht if r.period == period}
    aus = {str(back(sid)): out(r) for sid, r in exact.items()}
    for sid in {person(r.student_id) for r in rows} - set(exact):
        vorher = [r for r in rows if person(r.student_id) == sid and r.period is not None and r.period < period]
        if not vorher:
            # Keine fruehere STUNDE — dann zaehlt der Eintrag des ganzen TAGES
            # (period = NULL). Ohne ihn bliebe eine Verspaetung, die ohne
            # gewaehlte Stunde erfasst wurde, in jeder Folgestunde unsichtbar.
            vorher = [r for r in rows if person(r.student_id) == sid and r.period is None]
        if not vorher:
            continue
        # Der staerkste, bei Gleichstand der spaeteste: wer in der ersten Stunde
        # fehlte und in der zweiten nur zu spaet kam, hat immer noch gefehlt.
        quelle = max(vorher, key=lambda r: (_RANK.get(r.status, 0), r.period or 0))
        if quelle.status == "da":
            continue
        aus[str(back(sid))] = {"status": quelle.status, "note": quelle.note, "period": period,
                               "vorschlag": True, "quelle": quelle.period}
    return aus


async def _kurs_stunden(db, user, kurs_id, tage):
    """Welche Stundenplan-Stunden hat DIESER Kurs an diesen Tagen?

    Damit beantwortet das Notenbuch die richtige Frage. Eine Notenspalte gehoert
    EINER Stunde, und wer dort da war, darf nicht rot sein (entschieden am
    10.09.2026). Der Kurs am Eintrag (`_sichtbar`) beantwortet dasselbe von der
    anderen Seite; beides zusammen, weil der Bestand noch keinen Kurs traegt und
    ein gepflegter Stundenplan nicht vorausgesetzt werden darf.

    Gefragt wird der Stundenplan, nicht ein neues Feld: die Stunden tragen ihren
    Kurs bereits (`timetable_slots.kurs_id`), und die Eintraege tragen ihre
    Stunde (`attendance.period`). Rueckgabe: {"YYYY-MM-DD": {Stundennummern}}.
    Ein Tag OHNE Stunde dieses Kurses steht nicht darin — dort gilt weiter der
    ganze Tag (siehe Aufrufer): ohne gepflegten Stundenplan waere sonst nie
    etwas markiert, und das waere schlechter als heute.
    """
    slots = (await db.execute(select(TimetableSlot).where(
        TimetableSlot.owner_id == user.id, TimetableSlot.kurs_id == kurs_id,
    ))).scalars().all()
    if not slots:
        return {}
    aus = {}
    for d in tage:
        tag = d.date()
        passend = {s.period for s in slots if s.weekday == tag.weekday() and _slot_gilt_am(s, tag)}
        if passend:
            aus[tag.strftime("%Y-%m-%d")] = passend
    return aus


def _slot_gilt_am(s, d):
    """Gilt die (versionierte) Stunde an dem Tag? Dieselbe Regel wie im
    Kalender — hier nachgebaut statt importiert, weil kein Modul am anderen
    haengen darf (Regel 3); es sind drei Zeilen, kein Bauwerk."""
    vf = s.valid_from.date() if isinstance(s.valid_from, datetime) else s.valid_from
    vt = s.valid_to.date() if isinstance(s.valid_to, datetime) else s.valid_to
    return not ((vf is not None and d < vf) or (vt is not None and d > vt))


@router.get("/{class_id}/tage")
async def get_tage(class_id: int, dates: str = "", kanonisch: bool = False,
                   kurs_id: Optional[int] = None,
                   user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Tages-Status je Schueler fuer MEHRERE Tage auf einmal.

    Fuer das Notenbuch: jede Spalte traegt ein Datum, und wer an dem Tag
    gefehlt hat oder zu spaet kam, wird in der Tabelle markiert. Ein Aufruf je
    Spalte waere ein Dutzend Aufrufe fuer eine Ansicht — und der Proxy laesst
    30 je Sekunde durch.

    `dates`: "YYYY-MM-DD,YYYY-MM-DD,..." (hoechstens 40 — mehr Spalten zeigt
    keine Tabelle auf einmal, und die Grenze haelt die Abfrage klein).
    """
    await _owned_class(db, user, class_id)
    tage = []
    for teil in (dates or "").split(","):
        teil = teil.strip()[:10]
        if not teil:
            continue
        try:
            # MIT Zeitzone: die Spalte ist `timestamptz`, und Postgres (asyncpg)
            # vergleicht eine naive Zeitangabe nicht damit — der Aufruf endete
            # in einem 500, das lokal auf SQLite nie auftrat. Die uebrigen Wege
            # schicken ohnehin ISO-Zeitpunkte mit „Z".
            # In der Zeitzone der Schule, nicht in UTC: die Spalte traegt
            # einen Kalendertag, keinen Zeitpunkt.
            tage.append(datetime.strptime(teil, "%Y-%m-%d").replace(tzinfo=SCHUL_TZ))
        except ValueError:
            continue    # Unlesbares faellt still heraus: eine Spalte ohne Datum ist kein Fehler
        if len(tage) >= 40:
            break
    if not tage:
        return {}
    lese_ids, to_canon, canon_back = await _kurs_maps(db, user, class_id)
    # Der Aufrufer nennt seinen Kurs (das Notenbuch tut es): dann sind DESSEN
    # Zeilen gemeint, nicht die der Geschwisterklassen.
    kurs_map = None
    if kurs_id is not None:
        kurs_map, lese_ids = await _kurs_kanon(db, user, kurs_id, lese_ids)
    lo = min(tage).replace(hour=0, minute=0, second=0, microsecond=0)
    hi = max(tage).replace(hour=23, minute=59, second=59, microsecond=0)
    rows = (await db.execute(select(Attendance).where(
        Attendance.owner_id == user.id, Attendance.student_id.in_(lese_ids or [-1]),
        Attendance.date >= lo, Attendance.date <= hi,
    ))).scalars().all()
    gewuenscht = {d.strftime("%Y-%m-%d") for d in tage}
    # Mit Kurs: nur die Eintraege SEINER Stunden zaehlen (siehe _kurs_stunden).
    # Ein Eintrag ohne Stunde (`period` NULL) meint den ganzen Tag und zaehlt
    # immer mit — so traegt die Lehrkraft „heute gar nicht da" ein.
    kurs_stunden = await _kurs_stunden(db, user, kurs_id, tage) if kurs_id is not None else {}
    je_tag = {}
    for r in rows:
        tag = _schul_tag(r.date)
        if tag not in gewuenscht:
            continue
        if not _sichtbar(r, kurs_id):
            continue    # Eintrag eines FREMDEN Kurses — nicht die Stunde dieser Spalte
        erlaubt = kurs_stunden.get(tag)
        if erlaubt is not None and r.period is not None and r.period not in erlaubt:
            continue
        je_tag.setdefault(tag, []).append(r)
    def ziel(sid):
        """Unter welcher id steht die Person beim Aufrufer?"""
        if not kanonisch:
            return canon_back.get(sid, sid)
        return kurs_map.get(sid, sid) if kurs_map is not None else sid

    out = {}
    for tag, tagrows in je_tag.items():
        best = _tages_status(tagrows, lambda sid: to_canon.get(sid, sid))
        # „da" ist die Normallage und braucht keine Zeile in der Antwort.
        # `kanonisch`: die Schluessel bleiben die KANONISCHEN ids.
        #
        # Das Notenbuch listet seine Zeilen kanonisch (kleinste id je Name im
        # Kurs, `roster_kurs`), die Anwesenheits-Ansicht dagegen mit den Zeilen
        # DIESER Klasse. Zurueckgebildet passte die Antwort deshalb genau dann
        # nicht zum Notenbuch, wenn die kanonische Zeile in einer anderen
        # Fach-Klasse liegt — und dann blieb die Faerbung dort einfach aus,
        # ohne Fehler und ohne Hinweis. Zwei Leser, zwei Sichten auf dieselbe
        # Person: der Aufrufer sagt, welche er braucht.
        eintraege = {str(ziel(sid)): r.status
                     for sid, r in best.items() if r.status != "da"}
        if eintraege:
            out[tag] = eintraege
    return out


class MarkIn(BaseModel):
    student_id: int
    date: datetime
    status: str
    note: str = ""
    period: Optional[int] = None
    # Der Kurs der gewaehlten Stunde. Die Oberflaeche kennt ihn (die Stundenwahl
    # haengt am Stundenplan-Slot, und der traegt seinen Kurs) — ohne ihn bliebe
    # „Anwesenheit ist immer pro Kurs" eine Absicht ohne Schluessel. Fehlt er,
    # bleibt es beim alten Weg (`kurs_der_klasse`, mehrdeutig = None).
    kurs_id: Optional[int] = None


@router.put("/{class_id}")
async def mark(class_id: int, body: MarkIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("anwesenheit", f"u{user.id}", 600, 60, "Zu viele Änderungen. Bitte kurz warten.")
    await _owned_class(db, user, class_id)
    if body.status not in _STATUS:
        raise HTTPException(400, "Unbekannter Status")
    await in_klasse(db, body.student_id, class_id)
    if body.kurs_id is not None:
        await eigener_kurs(db, user, body.kurs_id)
    # Auf die kanonische Person des Kurses schreiben -> kursweit geteilt.
    _canon_ids, to_canon, _back = await _kurs_maps(db, user, class_id)
    canon_id = to_canon.get(body.student_id, body.student_id)
    lo, hi = _day_bounds(body.date)
    # Genau die Stunde treffen (period NULL = ganzer Tag), damit Stunden getrennt bleiben.
    kandidaten = (await db.execute(select(Attendance).where(
        Attendance.student_id == canon_id, Attendance.date >= lo, Attendance.date <= hi,
        Attendance.period == body.period,
    ))).scalars().all()
    # Geaendert wird nur, was in DIESER Sicht auch steht: die Zeile des eigenen
    # Kurses, sonst die tagesweite/bestehende ohne Kurs. Eine Zeile eines
    # FREMDEN Kurses bleibt unberuehrt — sie gehoert einer anderen Stunde, und
    # sie hier zu ueberschreiben waere genau der Fehler, der abgestellt wird.
    row = next((r for r in kandidaten if body.kurs_id is not None and r.kurs_id == body.kurs_id), None) \
        or next((r for r in kandidaten if _sichtbar(r, body.kurs_id)), None)
    # "da" ist der Normalfall: kein Eintrag noetig -> vorhandenen loeschen.
    if body.status == "da" and not body.note.strip():
        if row:
            await db.delete(row)
        await db.commit()
        return {"ok": True}
    if row:
        row.status = body.status
        row.note = body.note.strip()[:500]
        row.period = body.period
    else:
        canon = await db.get(Student, canon_id)
        # Jede neue Zeile traegt ihren Kurs (Umbau vom 06.09.2026). Die
        # Startmigration holt nur den Bestand — ohne das hier entstuenden ab
        # morgen wieder Zeilen ohne Kurs.
        # Ohne Angabe der Kurs, in dem gearbeitet wird — gefragt wird die Klasse
        # aus der ADRESSE, nicht die der kanonischen Zeile: die kann einer
        # Geschwisterklasse gehoeren, die in einem ganz anderen Kurs liegt, und
        # dann traegt der Eintrag den Kurs, in dem ihn niemand eingetragen hat.
        kurs_id_neu = body.kurs_id or (canon.kurs_id if canon and canon.kurs_id
                                       else await kurs_der_klasse(db, class_id))
        db.add(Attendance(owner_id=user.id, class_id=(canon.class_id if canon else class_id),
                          kurs_id=kurs_id_neu, student_id=canon_id,
                          date=lo, status=body.status, note=body.note.strip()[:500], period=body.period))
    await db.commit()
    return {"ok": True}


async def _break_days(db: AsyncSession, user: User) -> list:
    """Ferien-/Feiertags-Zeitraeume der Lehrkraft als (lo, hi)-Paare."""
    rows = (await db.execute(select(CalendarBreak).where(CalendarBreak.owner_id == user.id))).scalars().all()
    return [(b.start_date, b.end_date) for b in rows]


def _in_break(d, ranges) -> bool:
    # Beide Seiten als SCHULTAG: der Eintrag liegt auf lokaler Mitternacht (in
    # UTC also am Vortag), der Ferienzeitraum auf UTC-Mitternacht. Roh
    # verglichen lag der erste Ferientag immer eine Tagesgrenze daneben.
    day = schul_datum(d)
    for lo, hi in ranges:
        if schul_datum(lo) <= day <= schul_datum(hi):
            return True
    return False


@router.get("/{class_id}/student/{student_id}")
async def student_history(class_id: int, student_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Alle nicht-'da'-Einträge eines Schülers, neueste zuerst — zum Nachtragen
    (z.B. Entschuldigung nachreichen)."""
    await _owned_class(db, user, class_id)
    _c, to_canon, _b = await _kurs_maps(db, user, class_id)
    canon_id = to_canon.get(student_id, student_id)
    # Alle Zeilen DIESER Person, nicht nur die kanonische: aeltere Eintraege
    # liegen auf der Zeile, die frueher als kanonisch galt.
    ihre = [sid for sid, k in to_canon.items() if k == canon_id] or [canon_id]
    rows = (await db.execute(select(Attendance).where(
        Attendance.owner_id == user.id, Attendance.student_id.in_(ihre),
    ).order_by(Attendance.date.desc()))).scalars().all()
    # Pro Tag nur ein Eintrag (staerkster Status) — mehrere Stunden am selben Tag
    # sind eine Abwesenheit, keine drei.
    proTag = {}
    for r in rows:
        key = schul_datum(r.date)
        cur = proTag.get(key)
        if cur is None or _RANK.get(r.status, 0) > _RANK.get(cur["status"], 0):
            proTag[key] = {"date": r.date.isoformat(), "status": r.status, "note": r.note, "period": r.period}
    return sorted(proTag.values(), key=lambda x: x["date"], reverse=True)


_LABEL = {"fehlt": "Fehlt", "spaet": "Verspätet", "entsch": "Entschuldigt"}


async def _students_of(db, class_id):
    # id als letzter Schluessel: bei gleicher Position/Kartennummer waere die
    # Reihenfolge sonst der Datenbank ueberlassen — und die PDF-Liste saehe bei
    # jedem Druck anders aus.
    return await sortiert(db, Student.class_id == class_id)


def _pdf_response(build, filename: str):
    # Das Ausliefern steht in app/pdfdruck.py — es stand hier und noch fuenfmal
    # woanders wortgleich. Hier bleibt nur „Puffer aufmachen und zeichnen lassen".
    import io
    buf = io.BytesIO()
    build(buf)
    return als_anhang(buf, filename)


@router.get("/{class_id}/report.pdf")
async def class_report(class_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Fehlzeiten-Übersicht der ganzen Klasse als PDF (Zeugnis/Elterngespräch)."""
    sc = await _owned_class(db, user, class_id)
    agg = await summary(class_id, user=user, db=db)
    students = await _students_of(db, class_id)

    def build(buf):
        from reportlab.lib.units import mm
        # A4-Leinwand aus app/pdfdruck.py — dieselben Zeilen standen an acht Stellen.
        c, w, h = neue_seite(buf)
        y = h - 25 * mm
        c.setFont("Helvetica-Bold", 16)
        c.drawString(20 * mm, y, f"Fehlzeiten – {sc.name}")
        c.setFont("Helvetica", 9)
        c.drawString(20 * mm, y - 6 * mm, f"Erstellt am {datetime.now().strftime('%d.%m.%Y')} · Nuvora")
        y -= 16 * mm
        c.setFont("Helvetica-Bold", 10)
        c.drawString(20 * mm, y, "Name")
        c.drawString(120 * mm, y, "Fehlt")
        c.drawString(142 * mm, y, "Versp.")
        c.drawString(168 * mm, y, "Entsch.")
        y -= 2 * mm
        c.line(20 * mm, y, 190 * mm, y)
        y -= 6 * mm
        c.setFont("Helvetica", 10)
        for s in students:
            a = agg.get(str(s.id), {"fehlt": 0, "spaet": 0, "entsch": 0})
            if y < 20 * mm:
                c.showPage(); y = h - 25 * mm; c.setFont("Helvetica", 10)
            c.drawString(20 * mm, y, s.name[:55])
            c.drawString(120 * mm, y, str(a["fehlt"]))
            c.drawString(142 * mm, y, str(a["spaet"]))
            c.drawString(168 * mm, y, str(a["entsch"]))
            y -= 6 * mm
        c.showPage()
        c.save()

    return _pdf_response(build, f"Fehlzeiten_{sc.name}.pdf")


@router.get("/{class_id}/student/{student_id}/report.pdf")
async def student_report(class_id: int, student_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Fehlzeiten eines Schülers als PDF: Zähler + chronologische Liste."""
    sc = await _owned_class(db, user, class_id)
    st = await in_klasse(db, student_id, class_id)
    rows = await student_history(class_id, student_id, user=user, db=db)
    breaks = await _break_days(db, user)
    zaehler = {"fehlt": 0, "spaet": 0, "entsch": 0}
    for r in rows:
        if r["status"] in zaehler and not _in_break(datetime.fromisoformat(r["date"]), breaks):
            zaehler[r["status"]] += 1

    def build(buf):
        from reportlab.lib.units import mm
        # A4-Leinwand aus app/pdfdruck.py — dieselben Zeilen standen an acht Stellen.
        c, w, h = neue_seite(buf)
        y = h - 25 * mm
        c.setFont("Helvetica-Bold", 16)
        c.drawString(20 * mm, y, f"Fehlzeiten – {st.name}")
        c.setFont("Helvetica", 9)
        c.drawString(20 * mm, y - 6 * mm, f"Klasse {sc.name} · Erstellt am {datetime.now().strftime('%d.%m.%Y')} · Nuvora")
        y -= 16 * mm
        c.setFont("Helvetica", 11)
        c.drawString(20 * mm, y, f"Fehlt: {zaehler['fehlt']}    Verspätet: {zaehler['spaet']}    Entschuldigt: {zaehler['entsch']}")
        y -= 12 * mm
        c.setFont("Helvetica-Bold", 10)
        c.drawString(20 * mm, y, "Datum"); c.drawString(55 * mm, y, "Status"); c.drawString(95 * mm, y, "Notiz")
        y -= 2 * mm; c.line(20 * mm, y, 190 * mm, y); y -= 6 * mm
        c.setFont("Helvetica", 10)
        for r in rows:
            if y < 20 * mm:
                c.showPage(); y = h - 25 * mm; c.setFont("Helvetica", 10)
            # Der Schultag, nicht der UTC-Tag: sonst steht im PDF der 08.09.,
            # waehrend die Lehrkraft den Eintrag am 09.09. gesetzt hat.
            d = schul_datum(datetime.fromisoformat(r["date"])).strftime("%d.%m.%Y")
            c.drawString(20 * mm, y, d)
            c.drawString(55 * mm, y, _LABEL.get(r["status"], r["status"]))
            c.drawString(95 * mm, y, (r.get("note") or "")[:45])
            y -= 6 * mm
        if not rows:
            c.drawString(20 * mm, y, "Keine Fehlzeiten erfasst.")
        c.showPage(); c.save()

    return _pdf_response(build, f"Fehlzeiten_{sc.name}_{st.name}.pdf")


@router.get("/{class_id}/summary")
async def summary(class_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Zusammenfassung je Schueler: Zaehler fehlt/spaet/entsch (ueber alles)."""
    await _owned_class(db, user, class_id)
    lese_ids, to_canon, canon_back = await _kurs_maps(db, user, class_id)
    rows = (await db.execute(select(Attendance).where(
        Attendance.owner_id == user.id, Attendance.student_id.in_(lese_ids or [-1]),
    ))).scalars().all()
    # An unterrichtsfreien Tagen (Ferien/Feiertage) zaehlen Fehlzeiten nicht.
    breaks = await _break_days(db, user)
    # Pro (Schueler, Tag) den staerksten Status bestimmen — mehrere Stunden am
    # selben Tag sind EINE Abwesenheit, sonst zaehlt ein Fehltag drei-/vierfach.
    proTag: dict = {}
    for r in rows:
        if _in_break(r.date, breaks):
            continue
        key = (to_canon.get(r.student_id, r.student_id), schul_datum(r.date))
        if key not in proTag or _RANK.get(r.status, 0) > _RANK.get(proTag[key], 0):
            proTag[key] = r.status
    agg: dict = {}
    for (sid, _day), status in proTag.items():
        # kanonische id -> student_id dieser Klasse fürs UI.
        a = agg.setdefault(str(canon_back.get(sid, sid)), {"fehlt": 0, "spaet": 0, "entsch": 0})
        if status in a:
            a[status] += 1
    return agg
