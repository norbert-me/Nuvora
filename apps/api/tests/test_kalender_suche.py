"""Modul Kalender: Suche ueber den GANZEN Kalender.

Wer „Noteneingabe" sucht, weiss gerade nicht, in welcher Woche das steht — die
Ansicht kann die Frage also nicht beantworten, sie laedt ein Fenster. Was hier
bewacht wird: dass wirklich alle Quellen mit Datum durchsucht werden, dass eine
Serie auf ihr NAECHSTES Vorkommen zeigt (nicht auf den Serienkopf im
September), dass Kommendes vorn steht und dass die Suche an der
Mandantengrenze haltmacht.
"""
from datetime import date, datetime, timedelta

import pytest

from app.models import CalendarBreak, ExamDate, Kurs, User
from app.routers import kalender as KAL


async def _konto(s, mail="such@b.de"):
    u = User(email=mail, password_hash="x", name="L")
    s.add(u)
    await s.flush()
    return u


@pytest.mark.asyncio
async def test_findet_titel_notiz_und_ort(s):
    u = await _konto(s)
    heute = datetime.combine(date.today(), datetime.min.time())
    await KAL.create_entry(KAL.EntryIn(date=heute + timedelta(days=3), title="Noteneingabe"), user=u, db=s)
    await KAL.create_entry(KAL.EntryIn(date=heute + timedelta(days=4), title="Konferenz", notes="Noteneingabe vorbereiten"), user=u, db=s)
    await KAL.create_entry(KAL.EntryIn(date=heute + timedelta(days=5), title="Elternabend", location="Raum 12"), user=u, db=s)

    assert len(await KAL.suche(q="noteneingabe", user=u, db=s)) == 2, "Titel UND Notiz zaehlen"
    assert [x.title for x in await KAL.suche(q="raum 12", user=u, db=s)] == ["Elternabend"]
    # Ein Buchstabe trifft alles und sagt nichts.
    assert await KAL.suche(q="n", user=u, db=s) == []


@pytest.mark.asyncio
async def test_serie_zeigt_auf_das_naechste_vorkommen(s):
    u = await _konto(s, "serie-suche@b.de")
    # Serienkopf liegt ein Jahr zurueck — die Suche darf nicht dorthin springen.
    start = datetime.combine(date.today() - timedelta(days=364), datetime.min.time())
    await KAL.create_entry(KAL.EntryIn(date=start, title="Schulchor", rrule="FREQ=WEEKLY"), user=u, db=s)
    tr = await KAL.suche(q="schulchor", user=u, db=s)
    assert len(tr) == 1 and tr[0].serie is True
    assert date.fromisoformat(tr[0].date) >= date.today()


@pytest.mark.asyncio
async def test_klassenarbeit_freier_zeitraum_und_kursname(s):
    u = await _konto(s, "quellen@b.de")
    kurs = Kurs(owner_id=u.id, name="WP8", fach="Mathe")
    s.add(kurs)
    await s.flush()
    heute = datetime.combine(date.today(), datetime.min.time())
    s.add(ExamDate(owner_id=u.id, kurs_id=kurs.id, date=heute + timedelta(days=10), title="Arbeit Nr. 1"))
    s.add(CalendarBreak(owner_id=u.id, start_date=heute + timedelta(days=30), end_date=heute + timedelta(days=44), label="Herbstferien"))
    await KAL.create_entry(KAL.EntryIn(date=heute + timedelta(days=2), title="Uebung", kurs_id=kurs.id), user=u, db=s)
    await s.commit()

    assert [x.art for x in await KAL.suche(q="arbeit nr", user=u, db=s)] == ["exam"]
    assert [x.art for x in await KAL.suche(q="herbstferien", user=u, db=s)] == ["break"]
    # Der Kursname zaehlt mit: „WP8" ist fuer viele die naheliegende Suche.
    arten = {x.art for x in await KAL.suche(q="wp8", user=u, db=s)}
    assert arten == {"entry", "exam"}


@pytest.mark.asyncio
async def test_kommendes_steht_vorn(s):
    u = await _konto(s, "reihenfolge@b.de")
    heute = datetime.combine(date.today(), datetime.min.time())
    await KAL.create_entry(KAL.EntryIn(date=heute - timedelta(days=20), title="Probe alt"), user=u, db=s)
    await KAL.create_entry(KAL.EntryIn(date=heute + timedelta(days=2), title="Probe bald"), user=u, db=s)
    await KAL.create_entry(KAL.EntryIn(date=heute + timedelta(days=40), title="Probe spaet"), user=u, db=s)
    assert [x.title for x in await KAL.suche(q="probe", user=u, db=s)] == ["Probe bald", "Probe spaet", "Probe alt"]


@pytest.mark.asyncio
async def test_fremde_eintraege_bleiben_draussen(s):
    u = await _konto(s, "eigen@b.de")
    fremd = await _konto(s, "fremd@b.de")
    heute = datetime.combine(date.today(), datetime.min.time())
    await KAL.create_entry(KAL.EntryIn(date=heute + timedelta(days=1), title="Geheimsache"), user=fremd, db=s)
    assert await KAL.suche(q="geheimsache", user=u, db=s) == []
