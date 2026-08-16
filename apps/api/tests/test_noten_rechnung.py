"""Rechenregeln des Notenbuchs — der Bereich, in dem ein Fehler jemandem eine
falsche Note gibt. Festgehalten werden:

* Gewichtung ueber die Abschnitte (auch wenn die Summe nicht 100 % ergibt),
* Abschnitt ohne Spalten / Spalte ohne Eintraege,
* innerhalb eines Abschnitts zaehlen die SPALTEN gleich (nicht die Eintraege),
* Beobachtungen zaehlen nie mit,
* Override je Abschnitt, je Halbjahr und je Kurs,
* Median gegen Mittel,
* Prozent -> Note an den Grenzen des Notenschluessels,
* die Bruecken (leeres Ergebnis, doppelte Uebernahme, fremde SuS).

Lauf:  cd apps/api && pytest tests/test_noten_rechnung.py
"""
import pytest
from sqlalchemy import select

from app.models import (
    User, SchoolClass, Student, GradeSection, GradeCategory, GradeEntry,
    GradeOverride, Session as QuizSession,
)
from app.routers import noten as N


async def _grund(s):
    u = User(email="a@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    cls = SchoolClass(name="7a", owner_id=u.id); s.add(cls); await s.flush()
    max_ = Student(card_id=1, name="Max", class_id=cls.id); s.add(max_)
    await s.commit()
    return u, cls, max_


async def _sec(s, u, cls, name, weight, term="1", kurs_id=None):
    sec = GradeSection(name=name, weight=weight, position=0, term=term,
                       class_id=cls.id, kurs_id=kurs_id, owner_id=u.id)
    s.add(sec); await s.flush()
    return sec


async def _cat(s, u, cls, sec, name="Sp"):
    c = GradeCategory(name=name, section_id=sec.id, class_id=cls.id, owner_id=u.id, position=0)
    s.add(c); await s.flush()
    return c


async def _note(s, cat, st, wert, kind="grade"):
    e = GradeEntry(category_id=cat.id, student_id=st.id, kind=kind,
                   value=wert if kind == "grade" else None)
    s.add(e); await s.flush()
    return e


async def _row(s, u, cls, term="1", agg="mean", kurs_id=None):
    _, out = await N._summarize(s, u, cls.id, term, agg=agg, kurs_id=kurs_id)
    return out[0]


# ─── Gewichtung ───

@pytest.mark.asyncio
async def test_gewichtung_normiert_auch_wenn_die_summe_nicht_hundert_ist(s):
    """Gewichte sind Fachkonferenz-Recht — das Werkzeug gibt keine vor. Ergeben
    sie nicht 100 %, wird auf die vorhandenen Gewichte normiert (50/30 = 5:3),
    nicht durch 100 geteilt."""
    u, cls, max_ = await _grund(s)
    a = await _sec(s, u, cls, "Arbeiten", 50)
    b = await _sec(s, u, cls, "Sonstige", 30)
    await _note(s, await _cat(s, u, cls, a), max_, 2.0)
    await _note(s, await _cat(s, u, cls, b), max_, 4.0)
    await s.commit()
    r = await _row(s, u, cls)
    assert r.weighted == round((2.0 * 50 + 4.0 * 30) / 80, 2) == 2.75
    assert r.unweighted_fallback is False


@pytest.mark.asyncio
async def test_abschnitt_ohne_noten_faellt_aus_der_gewichtung(s):
    """Ein Abschnitt ohne einzige Note darf den Schnitt nicht als 0 oder 6
    verzerren — er zaehlt (noch) nicht mit."""
    u, cls, max_ = await _grund(s)
    a = await _sec(s, u, cls, "Arbeiten", 50)
    b = await _sec(s, u, cls, "Sonstige", 50)
    await _cat(s, u, cls, b)                       # Spalte ohne Eintrag
    await _note(s, await _cat(s, u, cls, a), max_, 3.0)
    await s.commit()
    r = await _row(s, u, cls)
    assert r.weighted == 3.0
    assert "" .join(sorted(r.per_section)) != "", "der Abschnitt mit Note ist da"
    assert len(r.per_section) == 1


@pytest.mark.asyncio
async def test_abschnitt_ohne_spalten_und_ohne_gewichte(s):
    """Ohne jedes Gewicht wird ungewichtet gemittelt (und das ausgewiesen);
    ein Abschnitt ohne Spalten stoert dabei nicht."""
    u, cls, max_ = await _grund(s)
    a = await _sec(s, u, cls, "A", 0)
    await _sec(s, u, cls, "Leer", 0)               # Abschnitt ohne Spalten
    await _note(s, await _cat(s, u, cls, a), max_, 2.0)
    b = await _sec(s, u, cls, "B", 0)
    await _note(s, await _cat(s, u, cls, b), max_, 4.0)
    await s.commit()
    r = await _row(s, u, cls)
    assert r.weighted == 3.0 and r.unweighted_fallback is True


@pytest.mark.asyncio
async def test_keine_noten_ergibt_keinen_schnitt(s):
    u, cls, max_ = await _grund(s)
    a = await _sec(s, u, cls, "A", 50)
    await _cat(s, u, cls, a)
    await s.commit()
    r = await _row(s, u, cls)
    assert r.weighted is None and r.per_section == {} and r.per_category == {}


# ─── Innerhalb eines Abschnitts zaehlen die SPALTEN gleich ───

@pytest.mark.asyncio
async def test_abschnitt_mittelt_ueber_spalten_nicht_ueber_eintraege(s):
    """Doppelte Eintraege in EINER Zelle (Altbestand, JSON-Import) duerfen die
    Spalte nicht doppelt gewichten — sonst zieht eine Zelle den Abschnitt."""
    u, cls, max_ = await _grund(s)
    a = await _sec(s, u, cls, "A", 100)
    c1 = await _cat(s, u, cls, a, "Test 1")
    c2 = await _cat(s, u, cls, a, "Test 2")
    await _note(s, c1, max_, 1.0)
    await _note(s, c1, max_, 1.0)   # zweiter Eintrag in derselben Zelle
    await _note(s, c2, max_, 4.0)
    await s.commit()
    r = await _row(s, u, cls)
    assert r.per_section[str(a.id)] == 2.5, "zwei Spalten: (1 + 4) / 2"


@pytest.mark.asyncio
async def test_beobachtung_zaehlt_nie_mit(s):
    """'Anstrengungsbereitschaft' ist kein Messwert."""
    u, cls, max_ = await _grund(s)
    a = await _sec(s, u, cls, "A", 100)
    c = await _cat(s, u, cls, a)
    await _note(s, c, max_, 2.0)
    await _note(s, c, max_, None, kind="observation")
    await s.commit()
    r = await _row(s, u, cls)
    assert r.per_category[str(c.id)] == 2.0 and r.weighted == 2.0
    assert r.observations == 1
    # und die API laesst eine Beobachtung mit Notenwert gar nicht erst zu
    with pytest.raises(Exception):
        await N._check_entry(s, u, N.EntryIn(category_id=c.id, student_id=max_.id,
                                             kind="observation", value=2.0))


# ─── Median gegen Mittel ───

@pytest.mark.asyncio
async def test_median_gegen_mittel(s):
    u, cls, max_ = await _grund(s)
    a = await _sec(s, u, cls, "A", 100)
    for wert in (1.0, 2.0, 6.0):
        await _note(s, await _cat(s, u, cls, a, f"S{wert}"), max_, wert)
    await s.commit()
    assert (await _row(s, u, cls, agg="mean")).per_section[str(a.id)] == 3.0
    assert (await _row(s, u, cls, agg="median")).per_section[str(a.id)] == 2.0
    # gerade Anzahl: Mittel der beiden mittleren Werte
    await _note(s, await _cat(s, u, cls, a, "S4"), max_, 4.0)
    await s.commit()
    assert (await _row(s, u, cls, agg="median")).per_section[str(a.id)] == 3.0


# ─── Overrides ───

@pytest.mark.asyncio
async def test_override_je_abschnitt_schlaegt_den_schnitt(s):
    u, cls, max_ = await _grund(s)
    a = await _sec(s, u, cls, "A", 50)
    b = await _sec(s, u, cls, "B", 50)
    await _note(s, await _cat(s, u, cls, a), max_, 4.0)
    await _note(s, await _cat(s, u, cls, b), max_, 4.0)
    s.add(GradeOverride(owner_id=u.id, class_id=cls.id, student_id=max_.id,
                        section_id=a.id, term="1", value=2.0))
    await s.commit()
    r = await _row(s, u, cls)
    assert r.per_section[str(a.id)] == 4.0, "der gerechnete Schnitt bleibt sichtbar"
    assert r.section_effective[str(a.id)] == 2.0
    assert r.weighted == 3.0, "die gesetzte Bereichsnote geht in den Schnitt"


@pytest.mark.asyncio
async def test_endnote_override_haengt_am_halbjahr_und_am_kurs(s):
    u, cls, max_ = await _grund(s)
    a1 = await _sec(s, u, cls, "A", 100, term="1")
    a2 = await _sec(s, u, cls, "A", 100, term="2")
    await _note(s, await _cat(s, u, cls, a1), max_, 3.0)
    await _note(s, await _cat(s, u, cls, a2), max_, 3.0)
    s.add(GradeOverride(owner_id=u.id, class_id=cls.id, kurs_id=None, student_id=max_.id,
                        section_id=None, term="1", value=2.0))
    await s.commit()
    assert (await _row(s, u, cls, term="1")).total_override == 2.0
    assert (await _row(s, u, cls, term="2")).total_override is None, "gilt nur im 1. Halbjahr"
    # Ein Kurs (Fach) hat eigene Abschnitte/Endnoten — die Endnote der Klasse
    # ohne Kurs gilt dort nicht.
    from app.models import Kurs
    kurs = Kurs(owner_id=u.id, name="Mathe"); s.add(kurs); await s.flush()
    cls.kurs_id = kurs.id
    k = await _sec(s, u, cls, "A", 100, term="1", kurs_id=kurs.id)
    await _note(s, await _cat(s, u, cls, k), max_, 3.0)
    await s.commit()
    assert (await _row(s, u, cls, term="1", kurs_id=kurs.id)).total_override is None


@pytest.mark.asyncio
async def test_jahresnote_mittelt_die_halbjahre(s):
    u, cls, max_ = await _grund(s)
    a1 = await _sec(s, u, cls, "A", 100, term="1")
    a2 = await _sec(s, u, cls, "A", 100, term="2")
    await _note(s, await _cat(s, u, cls, a1), max_, 2.0)
    await _note(s, await _cat(s, u, cls, a2), max_, 3.0)
    await s.commit()
    out = await N.year_summary(cls.id, user=u, db=s)
    row = out.rows[0]
    assert row.term_ends == {"1": 2.0, "2": 3.0}
    assert row.year == 2.5 and row.year_override is None


# ─── Prozent -> Note (Bruecke Code-Detektiv; Spiegel von core/grades.js) ───

def test_note_aus_prozent_rundet_kaufmaennisch():
    """83,5 % ergibt rechnerisch 2,25 — kaufmaennisch 2,3 (wie im Frontend).
    Pythons round() haette hier 2,2 gemacht: dieselbe Leistung, andere Note."""
    assert N._grade_from_pct(83.5, N._DEFAULT_SCALE) == 2.3


def test_note_aus_prozent_bleibt_im_bereich_eins_bis_sechs():
    for pct in (0, 19, 20, 45, 58.5, 73, 87, 99.9, 100):
        wert = N._grade_from_pct(pct, N._DEFAULT_SCALE)
        assert 1.0 <= wert <= 6.0, f"{pct} % ergab {wert}"
    assert N._grade_from_pct(100, N._DEFAULT_SCALE) == 1.0
    assert N._grade_from_pct(0, N._DEFAULT_SCALE) == 6.0
    # kaputter Schluessel -> Voreinstellung statt Absturz
    assert N._grade_from_pct(100, {"1": "x"}) == 1.0


# ─── Bruecken ───

@pytest.mark.asyncio
async def test_import_grades_ohne_treffer_legt_keine_leere_spalte_an(s):
    u, cls, max_ = await _grund(s)
    sec = await _sec(s, u, cls, "Tests", 50)
    await s.commit()
    body = N.ImportGradesBody(class_id=cls.id, section_id=sec.id, column_name="Leer",
                              grades=[N.GradeCell(student_id=99999, value=2.0)])
    with pytest.raises(Exception):
        await N.import_grades(body, user=u, db=s)
    assert (await s.execute(select(GradeCategory))).scalars().first() is None


@pytest.mark.asyncio
async def test_import_session_ohne_treffer_legt_keine_leere_spalte_an(s):
    u, cls, max_ = await _grund(s)
    sec = await _sec(s, u, cls, "Tests", 50)
    sess = QuizSession(owner_id=u.id, name="Test 1", class_id=cls.id)
    s.add(sess); await s.commit()
    body = N.ImportBody(session_id=sess.id, section_id=sec.id, column_name="T1",
                        grades=[N.ImportGrade(card_id=99, value=2.0)])   # keine Karte der Klasse
    with pytest.raises(Exception):
        await N.import_session(body, user=u, db=s)
    assert (await s.execute(select(GradeCategory))).scalars().first() is None


@pytest.mark.asyncio
async def test_dieselbe_session_nicht_zweimal_uebernehmen(s):
    """Zweimal uebernommen stuende derselbe Test als zwei Spalten im Abschnitt
    und zaehlte doppelt. Die zweite Uebernahme wird abgelehnt."""
    u, cls, max_ = await _grund(s)
    sec = await _sec(s, u, cls, "Tests", 50)
    sess = QuizSession(owner_id=u.id, name="Test 1", class_id=cls.id)
    s.add(sess); await s.commit()
    body = N.ImportBody(session_id=sess.id, section_id=sec.id, column_name="T1",
                        grades=[N.ImportGrade(card_id=1, value=2.0)])
    assert (await N.import_session(body, user=u, db=s))["imported"] == 1
    with pytest.raises(Exception):
        await N.import_session(body, user=u, db=s)
    assert len((await s.execute(select(GradeCategory))).scalars().all()) == 1
    assert len((await s.execute(select(GradeEntry))).scalars().all()) == 1
