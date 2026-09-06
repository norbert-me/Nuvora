"""Etappe 4 des Umbaus auf Kurse: jede Zeile findet ihren Kurs.

Solange irgendwo `kurs_id` leer bleibt, muss der Lesepfad über die Klasse raten
— und `class_id` lässt sich nie entfernen. Dieser Test hält zwei Dinge fest:
was angeschlossen werden MUSS, und was bewusst leer bleibt.
"""
import pytest
import sqlalchemy as sa

from app.models import Base

# Tabellen, die beide Schluessel tragen und deshalb in die Startmigration
# gehoeren (main.py, "Bestandsnoten an den Kurs anschliessen").
ERWARTET = {
    "grade_sections", "grade_overrides", "grade_entries", "seating_plans",
    "orga_items", "card_decks", "card_folders", "work_analyses", "exam_dates",
    "calendar_entries", "segel_status", "timetable_slots", "pap_aufgaben",
    "attendance", "sessions", "zufall_draws", "quartal_dividers",
    "plan_weeks", "learning_ladders",
}

# Diese tragen `class_id` OHNE `kurs_id` — hier waere ein Anschluss kein
# Fortschritt, sondern eine Spalte, die niemand liest. Sie kommen in Etappe 4
# beim jeweiligen Modul dran.
# Nur noch eine: eine Notenspalte haengt an ihrem ABSCHNITT, und der kennt den
# Kurs. Ein zweiter Schluessel daneben waere eine zweite Wahrheit — genau die
# Sorte Redundanz, die dieser Umbau beseitigen soll.
OHNE_KURS = {"grade_categories"}


def _spalten(name):
    return {c.name for c in Base.metadata.tables[name].columns}


def test_startmigration_deckt_alle_tabellen_mit_beiden_schluesseln():
    import pathlib
    import re

    quelle = pathlib.Path(__file__).resolve().parent.parent / "app" / "main.py"
    text = quelle.read_text(encoding="utf-8")
    block = re.search(r'for tbl in \(([^)]*)\):', text, re.S)
    assert block, "Die Startmigration wurde umgebaut — dieser Test muss mitziehen."
    gelistet = set(re.findall(r'"([a-z_]+)"', block.group(1)))

    beide = {t.name for t in Base.metadata.sorted_tables
             if {"class_id", "kurs_id"} <= {c.name for c in t.columns}}
    # kurs_tags und students sind die Zuordnung selbst, nicht Inhalt.
    beide -= {"kurs_tags", "students"}

    fehlt = beide - gelistet
    assert not fehlt, (
        f"Diese Tabellen tragen class_id UND kurs_id, werden aber beim Start nicht "
        f"angeschlossen: {sorted(fehlt)}. Ohne sie bleibt `class_id` fuer immer noetig.")


def test_bekannte_luecken_bleiben_benannt():
    """Was noch keinen Kurs kennt, steht hier — mit Absicht, nicht aus Versehen."""
    ohne = {t.name for t in Base.metadata.sorted_tables
            if "class_id" in _spalten(t.name) and "kurs_id" not in _spalten(t.name)}
    assert ohne == OHNE_KURS, (
        f"Die Liste der Tabellen ohne kurs_id hat sich geaendert: {sorted(ohne)}. "
        f"Wer eine ergaenzt, entscheidet damit, dass sie beim Umbau spaeter drankommt "
        f"— das gehoert aufgeschrieben.")


@pytest.mark.asyncio
async def test_neue_zeilen_tragen_ihren_kurs(s):
    """Die Startmigration holt den BESTAND — neue Zeilen müssen selbst mitbringen,
    wozu sie gehören.

    Ohne diese Regel entstünden ab morgen wieder Zeilen ohne Kurs, und
    `class_id` ließe sich nie entfernen: der Lesepfad müsste für immer raten.
    Geprüft werden die Schreibwege, die es im Alltag wirklich gibt.
    """
    from datetime import datetime

    from app.models import Attendance, Kurs, KursTag, SchoolClass, Session as CvSession, Student, User
    from app.routers import anwesenheit as A
    from app.routers import sessions as S
    from app.routers import zufall as Z

    u = User(email="neu@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    kurs = Kurs(owner_id=u.id, name="M7")
    s.add(kurs)
    await s.flush()
    c = SchoolClass(name="7a", owner_id=u.id, kurs_id=kurs.id)
    s.add(c)
    await s.flush()
    kind = Student(class_id=c.id, name="Anna", card_id=1, kurs_id=kurs.id)
    s.add(kind)
    await s.flush()
    s.add(KursTag(kurs_id=kurs.id, class_id=c.id))
    await s.commit()

    # Anwesenheit
    await A.mark(c.id, A.MarkIn(student_id=kind.id, date=datetime(2026, 9, 7, 12), status="fehlt"),
                 user=u, db=s)
    eintrag = (await s.execute(sa.select(Attendance))).scalars().one()
    assert eintrag.kurs_id == kurs.id, "Fehlzeit ohne Kurs — wer fehlt, fehlt in einem Fach"

    # CardVote-Sitzung
    sitzung = await S.create_session(S.SessionCreate(name="Test", class_id=c.id), user=u, db=s)
    roh = await s.get(CvSession, sitzung.id)
    assert roh.kurs_id == kurs.id

    # Zufall
    await Z.record_draw(c.id, Z.DrawIn(student_id=kind.id), user=u, db=s)
    from app.models import ZufallDraw
    zug = (await s.execute(sa.select(ZufallDraw))).scalars().one()
    assert zug.kurs_id == kurs.id
