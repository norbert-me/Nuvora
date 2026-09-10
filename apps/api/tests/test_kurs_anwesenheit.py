"""Kurs-Konzept Phase 2: Anwesenheit wird über den Kurs geteilt.

Zwei Fach-Klassen (Mathe 7.5, Lernzeit 7.5) im selben Kurs teilen sich die SuS
(per Name) für die Anwesenheit. In Mathe markiert = in Lernzeit sichtbar, eine
kanonische Zeile. Karten/Noten bleiben pro Klasse (nicht hier geprüft).
"""
from datetime import datetime

import pytest
from sqlalchemy import select, func

from app.models import User, SchoolClass, Student, Kurs, Attendance
from app.routers import anwesenheit as an


async def _kurs_zwei_klassen(s):
    u = User(email="a@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    k = Kurs(owner_id=u.id, name="7.5"); s.add(k); await s.flush()
    A = SchoolClass(name="Mathe 7.5", owner_id=u.id, kurs_id=k.id); s.add(A)
    B = SchoolClass(name="Lernzeit 7.5", owner_id=u.id, kurs_id=k.id); s.add(B); await s.flush()
    a = Student(card_id=1, name="Max", class_id=A.id, kurs_id=k.id); s.add(a)
    b = Student(card_id=1, name="Max", class_id=B.id, kurs_id=k.id); s.add(b); await s.flush()
    await s.commit()
    return u, A, B, a, b


@pytest.mark.asyncio
async def test_anwesenheit_kursweit_geteilt(s):
    u, A, B, a, b = await _kurs_zwei_klassen(s)
    d = datetime(2026, 7, 20)
    await an.mark(A.id, an.MarkIn(student_id=a.id, date=d, status="fehlt", period=1), user=u, db=s)
    # In Lernzeit (B) sichtbar, unter B's eigener student_id.
    m = await an.get_day(B.id, date=d, period=1, user=u, db=s)
    assert m.get(str(b.id), {}).get("status") == "fehlt"
    # Nur EINE kanonische Zeile für beide.
    assert (await s.execute(select(func.count()).select_from(Attendance))).scalar() == 1
    # Fehlzeiten in B auf B's id.
    assert (await an.summary(B.id, user=u, db=s)).get(str(b.id), {}).get("fehlt") == 1


@pytest.mark.asyncio
async def test_da_ueber_geschwisterklasse_loescht(s):
    u, A, B, a, b = await _kurs_zwei_klassen(s)
    d = datetime(2026, 7, 20)
    await an.mark(A.id, an.MarkIn(student_id=a.id, date=d, status="fehlt", period=1), user=u, db=s)
    await an.mark(B.id, an.MarkIn(student_id=b.id, date=d, status="da", period=1), user=u, db=s)
    assert (await s.execute(select(func.count()).select_from(Attendance))).scalar() == 0


# ─── Das Notenbuch liest kanonisch ───
#
# Seine Zeilen sind die kanonischen SuS des Kurses (kleinste id je Name), die
# Anwesenheits-Ansicht dagegen fuehrt die Zeilen DIESER Klasse. Bildet `/tage`
# stur zurueck, passt in der zweiten Fach-Klasse kein einziger Schluessel — und
# die Faerbung im Notenbuch blieb aus, ohne Fehler und ohne Hinweis.

@pytest.mark.asyncio
async def test_tage_liefert_auf_wunsch_die_kanonischen_ids(s):
    u, A, B, a, b = await _kurs_zwei_klassen(s)
    d = datetime(2026, 7, 20)
    await an.mark(A.id, an.MarkIn(student_id=a.id, date=d, status="fehlt", period=1), user=u, db=s)

    # Wie bisher: Schluessel ist die Zeile DIESER Klasse.
    normal = await an.get_tage(B.id, dates="2026-07-20", user=u, db=s)
    assert normal["2026-07-20"] == {str(b.id): "fehlt"}

    # Fuer das Notenbuch: die kanonische Zeile (die aus der ersten Fach-Klasse).
    kanon = await an.get_tage(B.id, dates="2026-07-20", kanonisch=True, user=u, db=s)
    assert kanon["2026-07-20"] == {str(a.id): "fehlt"}
    assert a.id != b.id, "sonst pruefte der Test nichts"


@pytest.mark.asyncio
async def test_kanonisch_heisst_dasselbe_wie_im_notenbuch(s):
    """„Kanonisch" gab es zweimal — und die Farbe blieb aus.

    Die Anwesenheit rechnete „kleinste student_id je Name", der Rest des Hauses
    (`app/schueler.kanonisch`, benutzt vom Notenbuch) „die erste Zeile nach
    position". Sitzt dieselbe Person in zwei Fach-Klassen an verschiedenen
    Plaetzen, sind das VERSCHIEDENE Zeilen: das Notenbuch fragte die Fehlzeiten
    zu Person A, bekam sie zu Person B und faerbte deshalb gar nichts — ohne
    Fehler und ohne Hinweis.
    """
    from app.schueler import roster_klasse

    u, A, B, a, b = await _kurs_zwei_klassen(s)
    # Die Zeile der ZWEITEN Klasse steht vorn — damit weichen die beiden alten
    # Regeln auseinander (kleinste id: a, nach position: b).
    b.position = 1
    a.position = 5
    await s.commit()

    kanon_zeile = (await roster_klasse(s, A.id))[0]
    assert kanon_zeile.id == b.id, "Aufbau stimmt nicht — sonst prueft der Test nichts"

    d = datetime(2026, 7, 20)
    await an.mark(A.id, an.MarkIn(student_id=a.id, date=d, status="fehlt", period=1), user=u, db=s)
    kanon = await an.get_tage(A.id, dates="2026-07-20", kanonisch=True, user=u, db=s)
    assert kanon["2026-07-20"] == {str(kanon_zeile.id): "fehlt"}, \
        "die Schluessel muessen zu den Zeilen des Notenbuchs passen"


@pytest.mark.asyncio
async def test_bestand_auf_der_alten_zeile_bleibt_sichtbar(s):
    """Gelesen wird ueber ALLE Zeilen der Person.

    Was vor der Vereinheitlichung geschrieben wurde, liegt auf der Zeile, die
    damals kanonisch war. Wer nur die neue liest, verliert den Bestand aus dem
    Blick — die Fehlzeiten waeren ueber Nacht verschwunden.
    """
    u, A, B, a, b = await _kurs_zwei_klassen(s)
    d = datetime(2026, 7, 20)
    # Eintrag von Hand auf die NICHT-kanonische Zeile legen (so lag der Bestand).
    s.add(Attendance(owner_id=u.id, student_id=b.id, class_id=B.id, date=d, status="fehlt", note=""))
    await s.commit()

    tag = await an.get_day(A.id, date=d, user=u, db=s)
    assert tag.get(str(a.id), {}).get("status") == "fehlt"
    assert (await an.summary(A.id, user=u, db=s)).get(str(a.id), {}).get("fehlt") == 1
    assert len(await an.student_history(A.id, a.id, user=u, db=s)) == 1


# ─── Liegt die Klasse in ZWEI Kursen, ist „kanonisch" mehrdeutig ───
#
# `_kurs_maps` rechnet ueber die Geschwisterklassen: alle Klassen, die mit
# dieser einen Kurs teilen. Bei zwei Kursen ist das eine groessere Menge als
# der Kurs selbst — und `kanonisch` waehlt darin eine andere Zeile als das
# Notenbuch, das seine Zeilen aus dem KURS zieht (`schueler.roster_kurs`).
# Dann passte kein einziger Schluessel, und die Faerbung im Notenbuch blieb
# aus: kein Fehler, keine Meldung, nur eine Tabelle ohne Rot. Deshalb nennt
# der Aufrufer seinen Kurs.

async def _klasse_in_zwei_kursen(s):
    from app.models import KursTag
    u = User(email="c@d.de", password_hash="x", name="L"); s.add(u); await s.flush()
    mathe = Kurs(owner_id=u.id, name="Mathe"); wp = Kurs(owner_id=u.id, name="WP")
    s.add_all([mathe, wp]); await s.flush()
    # Die WP-Klasse zuerst: kleinere id, gleiche position — sie gewinnt die
    # Kanonisierung ueber die Geschwister und ist genau der falsche Schluessel.
    W = SchoolClass(name="WP 7", owner_id=u.id); s.add(W)
    M = SchoolClass(name="Mathe 7.5", owner_id=u.id); s.add(M); await s.flush()
    s.add_all([KursTag(kurs_id=wp.id, class_id=W.id),
               KursTag(kurs_id=mathe.id, class_id=M.id),
               KursTag(kurs_id=wp.id, class_id=M.id)])
    w = Student(card_id=1, name="Max", class_id=W.id, position=0); s.add(w)
    m = Student(card_id=1, name="Max", class_id=M.id, position=0); s.add(m)
    await s.flush(); await s.commit()
    return u, mathe, M, m, w


@pytest.mark.asyncio
async def test_tage_folgt_dem_kurs_des_aufrufers(s):
    """Die Schluessel muessen zu den ZEILEN DES NOTENBUCHS passen.

    Gefragt wird deshalb nicht `roster_kurs` (das waere die Rechnung, die auch
    der Fix benutzt — der Test prueefte sich selbst), sondern der Endpunkt, den
    die Seite wirklich aufruft: `/api/noten/classes/{id}/summary?kurs_id=…`.
    """
    from app.routers import noten
    u, mathe, M, m, w = await _klasse_in_zwei_kursen(s)
    d = datetime(2026, 9, 8, 10, 0)
    await an.mark(M.id, an.MarkIn(student_id=m.id, date=d, status="fehlt", period=1), user=u, db=s)

    zeilen = {str(r.student_id) for r in await noten.summary(M.id, term="1", kurs_id=mathe.id, user=u, db=s)}

    # Ohne Kurs rechnet die Anwesenheit ueber die Geschwisterklassen — und die
    # sind hier groesser als der Kurs. Kein Schluessel passt, die Tabelle bleibt
    # ohne Rot.
    ohne = await an.get_tage(M.id, dates="2026-09-08", kanonisch=True, user=u, db=s)
    assert set(ohne["2026-09-08"]) == {str(w.id)}, "sonst prueft der Test nichts"
    assert not (set(ohne["2026-09-08"]) & zeilen), "sonst prueft der Test nichts"

    # Mit Kurs: genau die Zeile, die das Notenbuch zeigt.
    mit = await an.get_tage(M.id, dates="2026-09-08", kanonisch=True, kurs_id=mathe.id, user=u, db=s)
    assert set(mit["2026-09-08"]) <= zeilen
    assert mit["2026-09-08"] == {str(m.id): "fehlt"}
