"""Anwesenheit pro Stunde: Vorschlag aus der vorherigen Stunde + Tages-Dedup.

Wer in der 1. Stunde fehlt, fehlt oft auch später. Beim Öffnen einer späteren
Stunde SCHLÄGT der Server den Status der letzten erfassten Stunde vor — er
schreibt ihn aber nicht mehr still in die Datenbank (bis 10.09.2026 tat er das,
und damit stand in der Statistik eine Abwesenheit, die niemand bestätigt hatte).
Bestätigt wird in der Oberfläche. Mehrere Stunden am selben Tag bleiben EINE
Abwesenheit (Fehlzeiten-Zählung, Verlauf).
"""
from datetime import datetime

import pytest
from sqlalchemy import select, func

from app.models import User, SchoolClass, Student, Attendance
from app.routers import anwesenheit as an


async def _seed(s):
    u = User(email="a@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    c = SchoolClass(name="7a", owner_id=u.id); s.add(c); await s.flush()
    st = Student(card_id=1, name="Max", class_id=c.id); s.add(st); await s.flush()
    await s.commit()
    return u, c, st


async def _zeilen(s) -> int:
    return (await s.execute(select(func.count()).select_from(Attendance))).scalar()


@pytest.mark.asyncio
async def test_vorschlag_statt_kopie(s):
    u, c, st = await _seed(s)
    d = datetime(2026, 7, 20)
    await an.mark(c.id, an.MarkIn(student_id=st.id, date=d, status="fehlt", period=1), user=u, db=s)
    # Stunde 3 öffnen -> vorgeschlagen, nicht gespeichert.
    m = await an.get_day(c.id, date=d, period=3, user=u, db=s)
    assert m[str(st.id)]["status"] == "fehlt"
    assert m[str(st.id)]["vorschlag"] is True
    assert m[str(st.id)]["quelle"] == 1, "die Stunde, aus der der Vorschlag kommt"
    assert await _zeilen(s) == 1, "ein Vorschlag darf nichts schreiben"
    # Fehlzeiten: 1 Tag, nicht 2.
    assert (await an.summary(c.id, user=u, db=s))[str(st.id)]["fehlt"] == 1
    assert len(await an.student_history(c.id, st.id, user=u, db=s)) == 1
    # Tagesansicht (ohne Stunde) zeigt den stärksten Status — und keinen Vorschlag.
    tag = await an.get_day(c.id, date=d, user=u, db=s)
    assert tag[str(st.id)]["status"] == "fehlt" and "vorschlag" not in tag[str(st.id)]


@pytest.mark.asyncio
async def test_erfasste_stunde_ist_kein_vorschlag(s):
    """Was die Lehrkraft bestätigt hat, steht als echter Eintrag da."""
    u, c, st = await _seed(s)
    d = datetime(2026, 7, 20)
    await an.mark(c.id, an.MarkIn(student_id=st.id, date=d, status="fehlt", period=1), user=u, db=s)
    await an.mark(c.id, an.MarkIn(student_id=st.id, date=d, status="fehlt", period=3), user=u, db=s)
    m = await an.get_day(c.id, date=d, period=3, user=u, db=s)
    assert m[str(st.id)]["status"] == "fehlt" and "vorschlag" not in m[str(st.id)]
    assert await _zeilen(s) == 2
    # Und trotzdem nur EIN Fehltag.
    assert (await an.summary(c.id, user=u, db=s))[str(st.id)]["fehlt"] == 1


@pytest.mark.asyncio
async def test_da_loescht_nur_diese_stunde(s):
    u, c, st = await _seed(s)
    d = datetime(2026, 7, 20)
    await an.mark(c.id, an.MarkIn(student_id=st.id, date=d, status="fehlt", period=1), user=u, db=s)
    await an.mark(c.id, an.MarkIn(student_id=st.id, date=d, status="fehlt", period=3), user=u, db=s)
    await an.mark(c.id, an.MarkIn(student_id=st.id, date=d, status="da", period=3), user=u, db=s)
    # Nur P3 weg, P1 bleibt.
    assert await _zeilen(s) == 1


@pytest.mark.asyncio
async def test_verspaetung_wird_vorgeschlagen(s):
    """„Spät" gilt weiter, bis jemand die Stunde auf „da" stellt."""
    u, c, st = await _seed(s)
    d = datetime(2026, 7, 21)
    await an.mark(c.id, an.MarkIn(student_id=st.id, date=d, status="spaet", period=1), user=u, db=s)
    m = await an.get_day(c.id, date=d, period=2, user=u, db=s)
    assert m[str(st.id)]["status"] == "spaet" and m[str(st.id)]["vorschlag"] is True


@pytest.mark.asyncio
async def test_tageseintrag_wird_vorgeschlagen(s):
    """Ohne gewählte Stunde eingetragen (period = NULL) — das ist der Fall, in
    dem morgens jemand zu spät kam und es am TAG erfasst wurde. Auch daraus
    entsteht ein Vorschlag, sonst bliebe er in jeder Folgestunde unsichtbar."""
    u, c, st = await _seed(s)
    d = datetime(2026, 7, 22)
    await an.mark(c.id, an.MarkIn(student_id=st.id, date=d, status="spaet", period=None), user=u, db=s)
    m = await an.get_day(c.id, date=d, period=4, user=u, db=s)
    assert m[str(st.id)]["status"] == "spaet" and m[str(st.id)]["vorschlag"] is True
    assert m[str(st.id)]["quelle"] is None, "kein Stundeneintrag — der ganze Tag"
    assert await _zeilen(s) == 1


@pytest.mark.asyncio
async def test_vorgeschlagen_wird_der_staerkste(s):
    """Erste Stunde gefehlt, zweite nur zu spät — für die dritte gilt „fehlt".
    Der letzte Eintrag allein wäre die schwächere Auskunft."""
    u, c, st = await _seed(s)
    d = datetime(2026, 7, 23)
    await an.mark(c.id, an.MarkIn(student_id=st.id, date=d, status="fehlt", period=1), user=u, db=s)
    await an.mark(c.id, an.MarkIn(student_id=st.id, date=d, status="spaet", period=2), user=u, db=s)
    m = await an.get_day(c.id, date=d, period=3, user=u, db=s)
    assert m[str(st.id)]["status"] == "fehlt" and m[str(st.id)]["quelle"] == 1
