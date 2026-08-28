"""Modul Kalender: Wiederholungen (Serien).

Eine Serie ist EIN Eintrag plus Regel, nicht hundert Zeilen — der Wochenrhythmus
ist eine Entscheidung, und wer sie aendert, will sie an einer Stelle aendern.
Was hier bewacht wird, sind genau die drei Stellen, an denen das schiefgeht:
die Regel darf nur enthalten, was jemand aufzaehlt; der Serienkopf darf beim
Blaettern nicht aus dem Fenster fallen; und ein einzelner Termin muss sich
herausnehmen lassen, ohne die uebrigen Wochen mitzureissen.
"""
from datetime import datetime, timedelta

import pytest

from app.models import User
from app.routers import kalender as KAL


def test_regel_wird_auf_das_eingedampft_was_wir_rechnen():
    # Was niemand aufzaehlt, wird nicht gespeichert: eine Serie, die es nur in
    # der Datenbank gibt, fehlte im Kalender, ohne dass jemand saehe warum.
    assert KAL.rrule_pruefen("FREQ=WEEKLY;BYDAY=MO;BYSETPOS=2") == "FREQ=WEEKLY;BYDAY=MO"
    assert KAL.rrule_pruefen("FREQ=STUENDLICH") == ""


@pytest.mark.asyncio
async def test_serie_wird_im_fenster_aufgezaehlt(s):
    u = User(email="serie@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    start = datetime(2026, 9, 7, 12)          # ein Montag
    await KAL.create_entry(KAL.EntryIn(date=start, title="AG", rrule="FREQ=WEEKLY"), user=u, db=s)

    # Fenster ab der dritten Woche: der Serienkopf liegt DAVOR. Filterte man ihn
    # weg, waere eine seit September laufende AG im Maerz aus dem Kalender
    # verschwunden.
    aus = await KAL.list_entries(frm=start + timedelta(days=14), to=start + timedelta(days=28),
                                 user=u, db=s)
    tage = [e.occ for e in aus]
    assert tage == ["2026-09-21", "2026-09-28", "2026-10-05"]

    # Ohne Fenster kommt die Serie als ihr eigener Datensatz — genau das
    # brauchen Export und Aufraeumen, die den Eintrag loeschen wollen.
    roh = await KAL.list_entries(frm=None, to=None, user=u, db=s)
    assert len(roh) == 1 and roh[0].occ == ""


@pytest.mark.asyncio
async def test_einzelner_termin_faellt_aus_oder_wird_geloest(s):
    u = User(email="serie2@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    start = datetime(2026, 9, 7, 12)
    e = await KAL.create_entry(KAL.EntryIn(date=start, title="AG", rrule="FREQ=WEEKLY"), user=u, db=s)

    # (a) ersatzlos: der Tag steht auf EXDATE, die Serie laeuft weiter.
    await KAL.serien_ausnahme(e.id, KAL.AusnahmeIn(date=datetime(2026, 9, 14, 12)), user=u, db=s)
    tage = [x.occ for x in await KAL.list_entries(frm=start, to=start + timedelta(days=21), user=u, db=s)]
    assert "2026-09-14" not in tage and "2026-09-21" in tage

    # (b) herausgeloest: derselbe Tag faellt aus der Serie, kommt aber als
    # eigener Eintrag zurueck — sonst gaebe es nur „alles oder gar nichts",
    # und wer eine Stunde verlegt, muesste die ganze Serie aufloesen.
    kopie = await KAL.serien_ausnahme(e.id, KAL.AusnahmeIn(date=datetime(2026, 9, 21, 12), loesen=True),
                                      user=u, db=s)
    assert kopie.id != e.id and kopie.rrule == "" and kopie.title == "AG"
    aus = await KAL.list_entries(frm=start, to=start + timedelta(days=21), user=u, db=s)
    assert len([x for x in aus if x.occ == "2026-09-21"]) == 0
    assert len([x for x in aus if x.id == kopie.id]) == 1
