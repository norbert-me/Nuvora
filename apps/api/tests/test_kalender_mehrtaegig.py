"""Modul Kalender: mehrtaegige Termine (Schulfahrt, Projektwoche).

Ein mehrtaegiger Termin ist EIN Eintrag mit einem Enddatum — nicht fuenf
Kopien. Daraus folgen die Regeln, die dieser Test festhaelt:

  1. Das Enddatum ist INKLUSIV und muss NACH dem Anfang liegen; sonst ist es
     keins (ein Termin „null Tage lang" waere die Falle des exklusiven DTEND).
  2. Mehrtaegig heisst ganztaegig: Uhrzeiten fallen weg — „9:00" gilt fuer
     einen Tag, nicht fuer fuenf.
  3. Eine Serie schliesst sich aus: „jeden Montag von Montag bis Freitag" hat
     keine Bedeutung, die jemand aufzaehlen kann.
  4. Der Termin faellt nicht aus dem Fenster, wenn er VOR ihm beginnt — sonst
     waere die Klassenfahrt ab dem zweiten Tag unsichtbar.
"""
from datetime import datetime, timedelta

import pytest

from app.models import User
from app.routers import kalender as KAL


async def _konto(s, mail="mehr@b.de"):
    u = User(email=mail, password_hash="x", name="L")
    s.add(u)
    await s.flush()
    return u


@pytest.mark.asyncio
async def test_enddatum_wird_uebernommen_und_geprueft(s):
    u = await _konto(s)
    start = datetime(2026, 8, 27, 12)
    e = await KAL.create_entry(KAL.EntryIn(date=start, end_date=start + timedelta(days=4), title="Klassenfahrt"), user=u, db=s)
    assert e.end_date.date() == (start + timedelta(days=4)).date()
    # Ende vor oder am Anfang ist keins.
    e2 = await KAL.create_entry(KAL.EntryIn(date=start, end_date=start, title="Eintaegig"), user=u, db=s)
    assert e2.end_date is None


@pytest.mark.asyncio
async def test_mehrtaegig_ist_ganztaegig_und_ohne_serie(s):
    u = await _konto(s, "ganztags@b.de")
    start = datetime(2026, 8, 27, 12)
    e = await KAL.create_entry(KAL.EntryIn(
        date=start, end_date=start + timedelta(days=2), title="Projektwoche",
        start_time="09:00", end_time="10:00", rrule="FREQ=WEEKLY"), user=u, db=s)
    assert e.start_time == "" and e.end_time == ""
    assert e.rrule == "" and e.exdate == []


@pytest.mark.asyncio
async def test_termin_bleibt_im_fenster_sichtbar(s):
    u = await _konto(s, "fenster@b.de")
    start = datetime(2026, 8, 27, 12)
    e = await KAL.create_entry(KAL.EntryIn(date=start, end_date=start + timedelta(days=4), title="Klassenfahrt"), user=u, db=s)
    # Fenster erst ab dem dritten Tag: der Eintrag beginnt DAVOR.
    aus = await KAL.list_entries(frm=start + timedelta(days=2), to=start + timedelta(days=6), user=u, db=s)
    assert [x.id for x in aus] == [e.id]
    assert aus[0].end_date is not None
