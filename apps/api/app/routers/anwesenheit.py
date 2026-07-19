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
MODULE_KEY = "anwesenheit"
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


@router.get("/{class_id}")
async def get_day(class_id: int, date: datetime, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Status je Schueler an einem Tag: { student_id: {status, note} }."""
    await _owned_class(db, user, class_id)
    lo, hi = _day_bounds(date)
    rows = (await db.execute(select(Attendance).where(
        Attendance.class_id == class_id, Attendance.owner_id == user.id,
        Attendance.date >= lo, Attendance.date <= hi,
    ))).scalars().all()
    return {str(r.student_id): {"status": r.status, "note": r.note, "period": r.period} for r in rows}


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
    lo, hi = _day_bounds(body.date)
    row = (await db.execute(select(Attendance).where(
        Attendance.student_id == body.student_id, Attendance.date >= lo, Attendance.date <= hi,
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
        db.add(Attendance(owner_id=user.id, class_id=class_id, student_id=body.student_id,
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
    rows = (await db.execute(select(Attendance).where(
        Attendance.class_id == class_id, Attendance.owner_id == user.id, Attendance.student_id == student_id,
    ).order_by(Attendance.date.desc()))).scalars().all()
    return [{"date": r.date.isoformat(), "status": r.status, "note": r.note, "period": r.period} for r in rows]


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
    rows = (await db.execute(select(Attendance).where(
        Attendance.class_id == class_id, Attendance.owner_id == user.id,
    ))).scalars().all()
    # An unterrichtsfreien Tagen (Ferien/Feiertage) zaehlen Fehlzeiten nicht.
    breaks = await _break_days(db, user)
    agg: dict = {}
    for r in rows:
        if _in_break(r.date, breaks):
            continue
        a = agg.setdefault(str(r.student_id), {"fehlt": 0, "spaet": 0, "entsch": 0})
        if r.status in a:
            a[r.status] += 1
    return agg
