"""Zeitstempel: „jetzt", „mit Zeitzone" und „Beginn des Tages" — an einer Stelle.

Ein Blatt wie `besitz.py`: importiert nichts aus der Anwendung.

`_tagesbeginn` stand bewusst doppelt in `karten.py` und `kalender.py`, mit dem
Vermerk „kein Modul haengt am anderen (Regel 3)". Der Grund war richtig, die
Folgerung eine Nummer zu gross: verboten ist, dass ein **Modul** am anderen
haengt — am **Kern** haengen alle ohnehin. Also steht die Rechnung jetzt hier,
im Kern, und keins der beiden Module importiert das andere.
"""
from __future__ import annotations

from datetime import date, datetime, timezone


def jetzt() -> datetime:
    """Jetzt, mit Zeitzone. Stand als `_now` in karten.py und codedetektiv.py."""
    return datetime.now(timezone.utc)


def als_utc(dt):
    """Zeitstempel vergleichbar machen.

    Postgres liefert TIMESTAMPTZ mit Zeitzone zurueck, SQLite (Tests, lokale
    Pruefinstanz) ohne — ein Vergleich mit `jetzt()` wirft dann „can't compare
    offset-naive and offset-aware datetimes", und zwar erst zur Laufzeit auf dem
    Geraet eines Kindes.
    """
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def tagesbeginn(dt) -> datetime:
    """Beginn des Kalendertags (UTC).

    Kalender-Eintraege sind auf die Tagesmitte verankert; wer daraus direkt ein
    `released_at` macht, schaltet den Stapel erst am Nachmittag frei — die
    Stunde am Vormittag sieht ihn nicht. Freigegeben wird darum AB TAGESBEGINN.
    """
    d = dt.date() if isinstance(dt, datetime) else dt
    if not isinstance(d, date):
        raise TypeError("tagesbeginn erwartet ein Datum oder einen Zeitstempel")
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)
