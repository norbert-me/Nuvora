"""Anwesenheit ist immer pro Kurs (entschieden am 10.09.2026).

Vorher galt sie tagesweit: eine Abwesenheit in der 1. Stunde machte das Kind in
JEDEM Kurs des Tages abwesend — auch in dem, in dem es nachmittags sass. Jetzt
gehört jeder Eintrag dem Kurs seiner Stunde; aus früheren Stunden kommt nur noch
ein Vorschlag, den die Lehrkraft bestätigt.

Was trotzdem überall gilt: Zeilen ohne Kurs (Bestand) und Zeilen ohne Stunde
(„heute gar nicht da"). Und ein Fehltag zählt einmal, egal in wie vielen Kursen
er erfasst wurde.
"""
from datetime import datetime

import pytest
from sqlalchemy import select, func

from app.models import Attendance, Kurs, KursTag, SchoolClass, Student, User
from app.routers import anwesenheit as an


async def _klasse_in_zwei_kursen(s):
    u = User(email="a@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    a = Kurs(owner_id=u.id, name="Mathe"); b = Kurs(owner_id=u.id, name="WP")
    s.add_all([a, b]); await s.flush()
    c = SchoolClass(name="7a", owner_id=u.id); s.add(c); await s.flush()
    s.add_all([KursTag(kurs_id=a.id, class_id=c.id), KursTag(kurs_id=b.id, class_id=c.id)])
    st = Student(card_id=1, name="Max", class_id=c.id); s.add(st); await s.flush()
    await s.commit()
    return u, c, st, a, b


async def _zeilen(s) -> int:
    return (await s.execute(select(func.count()).select_from(Attendance))).scalar()


@pytest.mark.asyncio
async def test_eintrag_in_kurs_a_faerbt_kurs_b_nicht(s):
    """Der gemeldete Fehler: morgens in Mathe gefehlt, nachmittags im WP-Kurs
    anwesend — und trotzdem stand dort „fehlt"."""
    u, c, st, A, B = await _klasse_in_zwei_kursen(s)
    d = datetime(2026, 9, 8)
    await an.mark(c.id, an.MarkIn(student_id=st.id, date=d, status="fehlt", period=1, kurs_id=A.id), user=u, db=s)

    eigen = await an.get_day(c.id, date=d, period=1, kurs_id=A.id, user=u, db=s)
    assert eigen[str(st.id)]["status"] == "fehlt" and "vorschlag" not in eigen[str(st.id)]

    fremd = await an.get_day(c.id, date=d, period=1, kurs_id=B.id, user=u, db=s)
    assert str(st.id) not in fremd, "die Stunde von Kurs A gehört nicht in Kurs B"
    assert await an.get_tage(c.id, dates="2026-09-08", kurs_id=B.id, user=u, db=s) == {}


@pytest.mark.asyncio
async def test_vorschlag_aus_der_frueheren_stunde_schreibt_nichts(s):
    u, c, st, A, B = await _klasse_in_zwei_kursen(s)
    d = datetime(2026, 9, 8)
    await an.mark(c.id, an.MarkIn(student_id=st.id, date=d, status="fehlt", period=1, kurs_id=A.id), user=u, db=s)
    vorher = await _zeilen(s)

    m = await an.get_day(c.id, date=d, period=5, kurs_id=B.id, user=u, db=s)
    assert m[str(st.id)]["status"] == "fehlt"
    assert m[str(st.id)]["vorschlag"] is True and m[str(st.id)]["quelle"] == 1
    assert await _zeilen(s) == vorher, "ein Vorschlag ist kein Eintrag"
    # Und solange niemand bestätigt hat, zählt er auch nicht.
    assert await an.get_tage(c.id, dates="2026-09-08", kurs_id=B.id, user=u, db=s) == {}


@pytest.mark.asyncio
async def test_ein_fehltag_zaehlt_einmal_trotz_dreier_kurse(s):
    """Die wichtigste Regel dieser Änderung: die Zählung bleibt tagesweit.
    Sonst zählt ein Fehltag vier-, fünffach, weil jetzt je Kurs eine Zeile
    entsteht."""
    u, c, st, A, B = await _klasse_in_zwei_kursen(s)
    C = Kurs(owner_id=u.id, name="Sport"); s.add(C); await s.flush()
    s.add(KursTag(kurs_id=C.id, class_id=c.id)); await s.commit()
    d = datetime(2026, 9, 8)
    for kurs, p in ((A, 1), (B, 3), (C, 5)):
        await an.mark(c.id, an.MarkIn(student_id=st.id, date=d, status="fehlt", period=p, kurs_id=kurs.id), user=u, db=s)

    assert await _zeilen(s) == 3, "je Kurs eine Zeile — genau darum geht es"
    assert (await an.summary(c.id, user=u, db=s))[str(st.id)]["fehlt"] == 1
    assert len(await an.student_history(c.id, st.id, user=u, db=s)) == 1


@pytest.mark.asyncio
async def test_alteintrag_ohne_kurs_steht_in_jedem_kurs(s):
    """So liegt der Bestand von vor dem Umbau. Ihn auszublenden hieße, die
    Fehlzeiten wären über Nacht verschwunden."""
    u, c, st, A, B = await _klasse_in_zwei_kursen(s)
    d = datetime(2026, 9, 8)
    s.add(Attendance(owner_id=u.id, student_id=st.id, class_id=c.id, date=d,
                     status="fehlt", note="", period=1))
    await s.commit()

    for kurs in (A, B):
        m = await an.get_day(c.id, date=d, period=1, kurs_id=kurs.id, user=u, db=s)
        assert m[str(st.id)]["status"] == "fehlt" and "vorschlag" not in m[str(st.id)]
        assert (await an.get_tage(c.id, dates="2026-09-08", kurs_id=kurs.id, user=u, db=s))["2026-09-08"]


@pytest.mark.asyncio
async def test_ganzer_tag_gilt_in_jedem_kurs(s):
    """Ohne Stunde erfasst heißt „heute gar nicht da" — das ist die eine
    Abwesenheit, die alle Kurse angeht."""
    u, c, st, A, B = await _klasse_in_zwei_kursen(s)
    d = datetime(2026, 9, 8)
    await an.mark(c.id, an.MarkIn(student_id=st.id, date=d, status="fehlt", period=None, kurs_id=A.id), user=u, db=s)
    assert (await an.get_tage(c.id, dates="2026-09-08", kurs_id=B.id, user=u, db=s))["2026-09-08"]


@pytest.mark.asyncio
async def test_schreiben_fasst_die_zeile_des_fremden_kurses_nicht_an(s):
    u, c, st, A, B = await _klasse_in_zwei_kursen(s)
    d = datetime(2026, 9, 8)
    await an.mark(c.id, an.MarkIn(student_id=st.id, date=d, status="fehlt", period=1, kurs_id=A.id), user=u, db=s)
    # Dieselbe Stunde, anderer Kurs (Doppelstunde in zwei Kursen gibt es nicht,
    # aber der Server darf sich darauf nicht verlassen).
    await an.mark(c.id, an.MarkIn(student_id=st.id, date=d, status="da", period=1, kurs_id=B.id), user=u, db=s)
    assert await _zeilen(s) == 1, "die Zeile von Kurs A muss stehen bleiben"
    m = await an.get_day(c.id, date=d, period=1, kurs_id=A.id, user=u, db=s)
    assert m[str(st.id)]["status"] == "fehlt"


@pytest.mark.asyncio
async def test_fremder_kurs_wird_abgewiesen(s):
    u, c, st, A, B = await _klasse_in_zwei_kursen(s)
    fremd = User(email="x@y.de", password_hash="x", name="F"); s.add(fremd); await s.flush()
    k = Kurs(owner_id=fremd.id, name="Fremd"); s.add(k); await s.flush(); await s.commit()
    with pytest.raises(Exception):
        await an.mark(c.id, an.MarkIn(student_id=st.id, date=datetime(2026, 9, 8),
                                      status="fehlt", period=1, kurs_id=k.id), user=u, db=s)
