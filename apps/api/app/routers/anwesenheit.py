"""Modul Anwesenheit — Anwesenheit/Fehlzeiten je Klasse und Datum.

Eigenstaendig (Regel 3): Schueler kommen aus dem Kern, hier liegt nur der
Status je (Schueler, Datum). status: da | fehlt | spaet | entsch.
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Attendance, CalendarBreak, SchoolClass, Student, User
from .auth import get_current_user, rate_limit
from .modules import is_active

router = APIRouter(prefix="/api/anwesenheit", tags=["anwesenheit"])
# Anwesenheit ist kein eigenes Modul mehr, sondern lebt im Modul „Orga &
# Anwesenheit". Deshalb gategt der Router über orga.
MODULE_KEY = "orga"
_STATUS = {"da", "fehlt", "spaet", "entsch"}


async def require_module(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> User:
    if not await is_active(db, user.id, MODULE_KEY):
        raise HTTPException(403, "Modul Anwesenheit ist nicht aktiviert")
    return user


async def _owned_class(db: AsyncSession, user: User, class_id: int) -> SchoolClass:
    sc = await db.get(SchoolClass, class_id)
    if not sc:
        raise HTTPException(404, "Klasse nicht gefunden")
    if sc.owner_id and sc.owner_id != user.id:
        raise HTTPException(403, "Keine Berechtigung")
    return sc


def _day_bounds(d: datetime):
    start = d.replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start.replace(hour=23, minute=59, second=59)


async def _kurs_maps(db, user, class_id):
    """Anwesenheit wird über den Kurs geteilt: gleichnamige SuS der Fach-Klassen
    desselben Kurses sind dieselbe Person. Kanonisch = kleinste student_id je
    Name im Kurs; darauf werden Anwesenheits-Zeilen gespeichert.

    Liefert:
      canon_ids  – alle kanonischen student_ids des Kurses
      to_canon   – student_id (dieser Klasse) -> kanonische id
      canon_back – kanonische id -> student_id dieser Klasse (Rückabbildung fürs UI)
    """
    from .kurse import sibling_class_ids
    sib_ids = await sibling_class_ids(db, class_id)  # Klassen, die einen Kurs teilen (inkl. self)
    kurs_studs = (await db.execute(select(Student).where(Student.class_id.in_(sib_ids)))).scalars().all()
    # Name -> kanonische (kleinste) id
    canon = {}
    for s in sorted(kurs_studs, key=lambda x: x.id):
        canon.setdefault(s.name.strip(), s.id)
    this = [s for s in kurs_studs if s.class_id == class_id]
    to_canon = {s.id: canon.get(s.name.strip(), s.id) for s in this}
    canon_back = {}
    for s in this:
        canon_back[canon.get(s.name.strip(), s.id)] = s.id
    return list(canon.values()), to_canon, canon_back


# Schwere eines Status, um bei mehreren Stunden am Tag den „Tages-Status" zu
# bestimmen (Fehlzeiten-Zaehlung, Tagesansicht ohne Stunde). fehlt > entsch >
# spaet: entschuldigt bleibt eine Abwesenheit, verspaetet ist die leichteste.
_RANK = {"fehlt": 3, "entsch": 2, "spaet": 1, "da": 0}


def _tages_status(rows):
    """Aus den Stunden-Eintraegen eines Tages den staerksten je Schueler."""
    best = {}
    for r in rows:
        cur = best.get(r.student_id)
        if cur is None or _RANK.get(r.status, 0) > _RANK.get(cur.status, 0):
            best[r.student_id] = r
    return best


@router.get("/{class_id}")
async def get_day(class_id: int, date: datetime, period: Optional[int] = None,
                  user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Status je Schueler an einem Tag. Ohne `period`: der staerkste Status des
    Tages je Schueler (fuer Tagesansicht/Zufall/Kalender). Mit `period`: die
    Eintraege genau dieser Stunde — fehlt einer, wird er automatisch aus der
    letzten frueheren erfassten Stunde des Tages **uebernommen** (persistiert),
    denn wer frueh fehlt, fehlt oft auch spaeter; die Lehrkraft prueft dann nur."""
    await _owned_class(db, user, class_id)
    lo, hi = _day_bounds(date)
    canon_ids, _to_canon, canon_back = await _kurs_maps(db, user, class_id)
    # Anwesenheit liegt auf den kanonischen SuS des Kurses (kursweit geteilt).
    rows = (await db.execute(select(Attendance).where(
        Attendance.owner_id == user.id, Attendance.student_id.in_(canon_ids or [-1]),
        Attendance.date >= lo, Attendance.date <= hi,
    ))).scalars().all()

    def out(r):
        return {"status": r.status, "note": r.note, "period": r.period}
    # Kanonische id -> student_id dieser Klasse fürs UI.
    back = lambda sid: canon_back.get(sid, sid)

    if not period:
        best = _tages_status(rows)
        return {str(back(sid)): out(r) for sid, r in best.items()}

    exact = {r.student_id: r for r in rows if r.period == period}
    neu = False
    fehlend = {r.student_id for r in rows if r.student_id not in exact}
    for sid in fehlend:
        vorher = [r for r in rows if r.student_id == sid and r.period is not None and r.period < period]
        if not vorher:
            continue
        quelle = max(vorher, key=lambda r: r.period)
        if quelle.status == "da":
            continue
        # class_id der kanonischen Zeile behalten (gehört evtl. einer Fach-Klasse
        # des Kurses); Anwesenheit ist ohnehin kursweit geteilt.
        kopie = Attendance(owner_id=user.id, class_id=quelle.class_id, student_id=sid, date=lo,
                           status=quelle.status, note=quelle.note, period=period)
        db.add(kopie)
        exact[sid] = kopie
        neu = True
    if neu:
        await db.commit()
    return {str(back(sid)): out(r) for sid, r in exact.items()}


class MarkIn(BaseModel):
    student_id: int
    date: datetime
    status: str
    note: str = ""
    period: Optional[int] = None


@router.put("/{class_id}")
async def mark(class_id: int, body: MarkIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("anwesenheit", f"u{user.id}", 600, 60, "Zu viele Änderungen. Bitte kurz warten.")
    await _owned_class(db, user, class_id)
    if body.status not in _STATUS:
        raise HTTPException(400, "Unbekannter Status")
    st = await db.get(Student, body.student_id)
    if not st or st.class_id != class_id:
        raise HTTPException(404, "Schüler nicht in dieser Klasse")
    # Auf die kanonische Person des Kurses schreiben -> kursweit geteilt.
    _canon_ids, to_canon, _back = await _kurs_maps(db, user, class_id)
    canon_id = to_canon.get(body.student_id, body.student_id)
    lo, hi = _day_bounds(body.date)
    # Genau die Stunde treffen (period NULL = ganzer Tag), damit Stunden getrennt bleiben.
    row = (await db.execute(select(Attendance).where(
        Attendance.student_id == canon_id, Attendance.date >= lo, Attendance.date <= hi,
        Attendance.period == body.period,
    ))).scalar_one_or_none()
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
        db.add(Attendance(owner_id=user.id, class_id=(canon.class_id if canon else class_id), student_id=canon_id,
                          date=lo, status=body.status, note=body.note.strip()[:500], period=body.period))
    await db.commit()
    return {"ok": True}


async def _break_days(db: AsyncSession, user: User) -> list:
    """Ferien-/Feiertags-Zeitraeume der Lehrkraft als (lo, hi)-Paare."""
    rows = (await db.execute(select(CalendarBreak).where(CalendarBreak.owner_id == user.id))).scalars().all()
    return [(b.start_date, b.end_date) for b in rows]


def _in_break(d, ranges) -> bool:
    day = d.date() if hasattr(d, "date") else d
    for lo, hi in ranges:
        if lo.date() <= day <= hi.date():
            return True
    return False


@router.get("/{class_id}/student/{student_id}")
async def student_history(class_id: int, student_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Alle nicht-'da'-Einträge eines Schülers, neueste zuerst — zum Nachtragen
    (z.B. Entschuldigung nachreichen)."""
    await _owned_class(db, user, class_id)
    _c, to_canon, _b = await _kurs_maps(db, user, class_id)
    canon_id = to_canon.get(student_id, student_id)
    rows = (await db.execute(select(Attendance).where(
        Attendance.owner_id == user.id, Attendance.student_id == canon_id,
    ).order_by(Attendance.date.desc()))).scalars().all()
    # Pro Tag nur ein Eintrag (staerkster Status) — mehrere Stunden am selben Tag
    # sind eine Abwesenheit, keine drei.
    proTag = {}
    for r in rows:
        key = r.date.date()
        cur = proTag.get(key)
        if cur is None or _RANK.get(r.status, 0) > _RANK.get(cur["status"], 0):
            proTag[key] = {"date": r.date.isoformat(), "status": r.status, "note": r.note, "period": r.period}
    return sorted(proTag.values(), key=lambda x: x["date"], reverse=True)


_LABEL = {"fehlt": "Fehlt", "spaet": "Verspätet", "entsch": "Entschuldigt"}


async def _students_of(db, class_id):
    return (await db.execute(select(Student).where(Student.class_id == class_id).order_by(Student.card_id))).scalars().all()


def _pdf_response(build, filename: str):
    import io
    from fastapi.responses import StreamingResponse
    buf = io.BytesIO()
    build(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/{class_id}/report.pdf")
async def class_report(class_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Fehlzeiten-Übersicht der ganzen Klasse als PDF (Zeugnis/Elterngespräch)."""
    sc = await _owned_class(db, user, class_id)
    agg = await summary(class_id, user=user, db=db)
    students = await _students_of(db, class_id)

    def build(buf):
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.units import mm
        from reportlab.pdfgen import canvas
        c = canvas.Canvas(buf, pagesize=A4)
        w, h = A4
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
    st = await db.get(Student, student_id)
    if not st or st.class_id != class_id:
        raise HTTPException(404, "Schüler nicht in dieser Klasse")
    rows = await student_history(class_id, student_id, user=user, db=db)
    breaks = await _break_days(db, user)
    zaehler = {"fehlt": 0, "spaet": 0, "entsch": 0}
    for r in rows:
        if r["status"] in zaehler and not _in_break(datetime.fromisoformat(r["date"]), breaks):
            zaehler[r["status"]] += 1

    def build(buf):
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.units import mm
        from reportlab.pdfgen import canvas
        c = canvas.Canvas(buf, pagesize=A4)
        w, h = A4
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
            d = datetime.fromisoformat(r["date"]).strftime("%d.%m.%Y")
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
    canon_ids, _to, canon_back = await _kurs_maps(db, user, class_id)
    rows = (await db.execute(select(Attendance).where(
        Attendance.owner_id == user.id, Attendance.student_id.in_(canon_ids or [-1]),
    ))).scalars().all()
    # An unterrichtsfreien Tagen (Ferien/Feiertage) zaehlen Fehlzeiten nicht.
    breaks = await _break_days(db, user)
    # Pro (Schueler, Tag) den staerksten Status bestimmen — mehrere Stunden am
    # selben Tag sind EINE Abwesenheit, sonst zaehlt ein Fehltag drei-/vierfach.
    proTag: dict = {}
    for r in rows:
        if _in_break(r.date, breaks):
            continue
        key = (r.student_id, r.date.date())
        if key not in proTag or _RANK.get(r.status, 0) > _RANK.get(proTag[key], 0):
            proTag[key] = r.status
    agg: dict = {}
    for (sid, _day), status in proTag.items():
        # kanonische id -> student_id dieser Klasse fürs UI.
        a = agg.setdefault(str(canon_back.get(sid, sid)), {"fehlt": 0, "spaet": 0, "entsch": 0})
        if status in a:
            a[status] += 1
    return agg
