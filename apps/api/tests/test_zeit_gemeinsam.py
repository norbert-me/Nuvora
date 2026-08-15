"""Der Tagesbeginn ist einer — und zwar der im Kern.

`_tagesbeginn` stand in `karten.py` und `kalender.py` wortgleich, ausdruecklich
doppelt „wegen Regel 3". Sie liegt jetzt im Kern (`app/zeit.py`); Regel 3 bleibt
gewahrt, weil weiterhin kein Modul das andere importiert. Dieser Test haelt
beides fest: dieselbe Funktion, und die Freigabe ab 00:00 UTC — daran haengt,
ob die Stunde am Vormittag den Stapel sieht.
"""
from datetime import date, datetime, timezone

import pytest

from app.zeit import als_utc, jetzt, tagesbeginn


def test_tagesbeginn_ist_mitternacht_utc():
    mittags = datetime(2026, 3, 5, 12, 0, tzinfo=timezone.utc)
    assert tagesbeginn(mittags) == datetime(2026, 3, 5, 0, 0, tzinfo=timezone.utc)
    assert tagesbeginn(date(2026, 3, 5)) == datetime(2026, 3, 5, 0, 0, tzinfo=timezone.utc)


def test_als_utc_macht_naive_zeitstempel_vergleichbar():
    naiv = datetime(2026, 3, 5, 12, 0)
    assert als_utc(naiv).tzinfo is timezone.utc
    assert als_utc(None) is None
    schon = datetime(2026, 3, 5, 12, 0, tzinfo=timezone.utc)
    assert als_utc(schon) is schon
    # Der eigentliche Zweck: der Vergleich darf nicht mehr werfen.
    assert als_utc(naiv) < jetzt() or als_utc(naiv) > jetzt()


def test_beide_module_rechnen_mit_derselben_funktion():
    from app.routers import karten, kalender, codedetektiv
    assert karten._tagesbeginn is tagesbeginn
    assert kalender._tagesbeginn is tagesbeginn
    assert karten._now is jetzt and codedetektiv._now is jetzt
    assert karten._utc is als_utc


def test_tagesbeginn_weist_unbrauchbares_ab():
    with pytest.raises(TypeError):
        tagesbeginn("2026-03-05")
