"""Ein Schultag ist ein Tag der SCHULE, kein UTC-Tag.

Der Browser schickt den gewaehlten Tag als Zeitpunkt: „2026-09-09" wird zu
Mitternacht Ortszeit und damit zu 2026-09-08T22:00Z. Wer danach in UTC
gruppiert, legt jede Anwesenheit auf den VORTAG — im Notenbuch stand die
Markierung an der Spalte vom 08.09., obwohl das Kind am 09.09. gefehlt hatte.

Lauf:  cd apps/api && pip install -r requirements-dev.txt && pytest
"""
from datetime import datetime, timezone

import pytest

from app.models import User, SchoolClass, Student
from app.routers import anwesenheit as an


async def _seed(s):
    u = User(email="a@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    c = SchoolClass(name="7a", owner_id=u.id); s.add(c); await s.flush()
    st = Student(card_id=1, name="Max", class_id=c.id); s.add(st); await s.flush()
    await s.commit()
    return u, c, st


# Mitternacht des 09.09.2026 in Berlin (Sommerzeit) — genau das, was der
# Browser aus einem `<input type="date">` macht.
ORTS_MITTERNACHT = datetime(2026, 9, 8, 22, 0, tzinfo=timezone.utc)


@pytest.mark.asyncio
async def test_markierung_liegt_am_schultag(s):
    u, c, st = await _seed(s)
    await an.mark(c.id, an.MarkIn(student_id=st.id, date=ORTS_MITTERNACHT, status="fehlt"), user=u, db=s)
    out = await an.get_tage(c.id, dates="2026-09-08,2026-09-09", user=u, db=s)
    assert "2026-09-08" not in out
    assert out["2026-09-09"][str(st.id)] == "fehlt"


@pytest.mark.asyncio
async def test_tagesansicht_findet_denselben_eintrag(s):
    """Schreiben und Lesen muessen denselben Tag meinen — sonst legt der
    naechste Klick eine zweite Zeile an, statt die erste zu aendern."""
    u, c, st = await _seed(s)
    await an.mark(c.id, an.MarkIn(student_id=st.id, date=ORTS_MITTERNACHT, status="fehlt"), user=u, db=s)
    tag = await an.get_day(c.id, date=ORTS_MITTERNACHT, user=u, db=s)
    assert tag[str(st.id)]["status"] == "fehlt"
    # Und derselbe Schultag, aus einer anderen Uhrzeit heraus gefragt.
    mittag = datetime(2026, 9, 9, 10, 0, tzinfo=timezone.utc)
    assert (await an.get_day(c.id, date=mittag, user=u, db=s))[str(st.id)]["status"] == "fehlt"
