"""Ein freier Tag steht auf SEINEM Tag — nicht auf dem Vortag.

Mitternacht in Berlin ist 22:00 UTC am Vortag. `x.date()` auf dem gespeicherten
Zeitstempel machte daraus den Vortag: der Tag der Deutschen Einheit stand am
2. Oktober (im Feed fuers Handy, auf der Startseite, bei der Anwesenheit).
`_tag` rechnet jetzt ueber `schul_datum` (Europe/Berlin).
"""
from datetime import date, datetime, timezone

from app.routers.kalender import _freie_tage, _tag


class _Frei:
    def __init__(self, start, ende):
        self.start_date, self.end_date = start, ende


def test_mitternacht_ortszeit_bleibt_auf_ihrem_tag():
    # 03.10.2026 00:00 Europe/Berlin (Sommerzeit, +02:00) = 02.10.2026 22:00 UTC
    mitternacht = datetime(2026, 10, 2, 22, 0, tzinfo=timezone.utc)
    assert _tag(mitternacht) == date(2026, 10, 3)


def test_tagesmitte_und_utc_mitternacht_bleiben_wie_bisher():
    assert _tag(datetime(2026, 10, 3, 10, 0, tzinfo=timezone.utc)) == date(2026, 10, 3)
    assert _tag(datetime(2026, 10, 3, 0, 0, tzinfo=timezone.utc)) == date(2026, 10, 3)
    assert _tag(date(2026, 10, 3)) == date(2026, 10, 3)


def test_freie_tage_nehmen_den_tag_an_der_schule():
    mitternacht = datetime(2026, 10, 2, 22, 0, tzinfo=timezone.utc)
    assert _freie_tage([_Frei(mitternacht, mitternacht)]) == {date(2026, 10, 3)}
