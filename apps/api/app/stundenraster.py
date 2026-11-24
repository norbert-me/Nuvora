"""Das Raster der Unterrichtsstunden — EINE Quelle fuer Kalender und Reihen.

Welche Stunden ein Kurs in einem Zeitraum wirklich hat (Stundenplan mit
Ausfaellen, Ferien, ueberschriebenen Stunden), stand im Kalender-Router; das
Modul Reihen braucht dieselbe Rechnung, und ein Router darf den anderen nicht
importieren (Regel 3). Deshalb liegt sie hier im Kern: reine Funktionen, die
fertig geladene Zeilen bekommen.
"""
from datetime import date, datetime

from .models import TimetableSlot
from .zeit import schul_datum


def tag(x):
    """Auf den Kalendertag reduzieren — den Tag AN DER SCHULE, nicht den in UTC.

    Ein Zeitpunkt um Mitternacht Ortszeit liegt in UTC auf 22:00 des Vortags;
    `x.date()` machte daraus den Vortag. So stand der Tag der Deutschen Einheit
    am 2. Oktober — im Feed fuers Handy, auf der Startseite und bei der
    Anwesenheit. `schul_datum` (app/zeit.py) ist die eine Umrechnung dafuer.
    """
    if isinstance(x, datetime):
        return schul_datum(x)
    return x.date() if hasattr(x, "date") else x


def freie_tage(breaks) -> set:
    """Alle Tage in den freien Zeitraeumen (Ferien, bewegliche Feiertage)."""
    from datetime import timedelta as _td
    raus = set()
    for b in breaks:
        d, end = tag(b.start_date), tag(b.end_date)
        while d <= end:
            raus.add(d)
            d = d + _td(days=1)
    return raus


def unterrichtsstunden(*, kurs_id, class_id, start: date, ende: date,
                        slots, planned, breaks_days: set, cancel_set: set) -> list:
    """Die Unterrichtsstunden eines Kurses zwischen `start` (mit) und `ende` (ohne).

    Genau die Rechnung, die der Kalender auch anzeigt, und sie steht nur hier:
    wiederkehrende Stundenplan-Stunden (freie Tage, Ausfaelle und ueberschriebene
    abgezogen) plus die konkret geplanten Eintraege. Ein konkreter Eintrag mit
    Stundennummer ERSETZT an dem Tag den wiederkehrenden Slot dieser Stunde —
    egal fuer welchen Kurs; sonst zaehlte der alte Slot dort weiter mit, wenn der
    Eintrag den Kurs geaendert hat.

    Zugehoerigkeit:
    - Kurs gesetzt: der SELBE Kurs zaehlt, dazu kurslose (nur fuer die Klasse
      geplante) Stunden derselben Klasse. Ein ANDERER Kurs derselben Klasse
      zaehlt nicht — sonst zaehlte Physik fuer die Mathe-Planung mit.
    - Nur Klasse: alles dieser Klasse.

    Liefert eine sortierte Liste von (Tag, Stunde). Gebraucht von der
    Klassenarbeits-Uebersicht („noch wie viele Stunden?") und vom
    Stoffverteilungsplan („wann ist welches Thema dran?") — zwei Fragen, eine
    Rechnung.
    """
    from datetime import timedelta as _td

    def passt(k_id, c_id):
        if kurs_id is not None:
            return k_id == kurs_id or (k_id is None and class_id is not None and c_id == class_id)
        return class_id is not None and c_id == class_id

    by_wd = {}
    for s2 in slots:
        if passt(s2.kurs_id, s2.class_id):
            by_wd.setdefault(s2.weekday, []).append(s2)
    ueberschrieben = {(tag(e.date), e.period) for e in planned if start <= tag(e.date) < ende}

    treffer = set()
    d = start
    while d < ende:
        if d not in breaks_days:
            for s2 in by_wd.get(d.weekday(), []):
                if not slot_active_on(s2, d):
                    continue
                if (d, s2.period) not in cancel_set and (d, s2.period) not in ueberschrieben:
                    treffer.add((d, s2.period))
        d = d + _td(days=1)
    for e in planned:
        ed = tag(e.date)
        if start <= ed < ende and ed not in breaks_days and passt(e.kurs_id, e.class_id):
            treffer.add((ed, e.period))
    return sorted(treffer)


def slot_active_on(s: TimetableSlot, d: date) -> bool:
    """Gilt die (versionierte) Stundenplan-Stunde am Tag d? valid_from/valid_to
    grenzen sie ein; NULL heißt offen (seit jeher bzw. noch aktiv)."""
    vf = s.valid_from.date() if isinstance(s.valid_from, datetime) else s.valid_from
    vt = s.valid_to.date() if isinstance(s.valid_to, datetime) else s.valid_to
    if vf is not None and d < vf:
        return False
    if vt is not None and d > vt:
        return False
    return True
