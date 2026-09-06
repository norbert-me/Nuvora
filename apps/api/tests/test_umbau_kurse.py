"""Etappe 4 des Umbaus auf Kurse: jede Zeile findet ihren Kurs.

Solange irgendwo `kurs_id` leer bleibt, muss der Lesepfad über die Klasse raten
— und `class_id` lässt sich nie entfernen. Dieser Test hält zwei Dinge fest:
was angeschlossen werden MUSS, und was bewusst leer bleibt.
"""
from app.models import Base

# Tabellen, die beide Schluessel tragen und deshalb in die Startmigration
# gehoeren (main.py, "Bestandsnoten an den Kurs anschliessen").
ERWARTET = {
    "grade_sections", "grade_overrides", "grade_entries", "seating_plans",
    "orga_items", "card_decks", "card_folders", "work_analyses", "exam_dates",
    "calendar_entries", "segel_status", "timetable_slots", "pap_aufgaben",
}

# Diese tragen `class_id` OHNE `kurs_id` — hier waere ein Anschluss kein
# Fortschritt, sondern eine Spalte, die niemand liest. Sie kommen in Etappe 4
# beim jeweiligen Modul dran.
OHNE_KURS = {"learning_ladders", "plan_weeks", "sessions", "attendance",
             "grade_categories", "zufall_draws", "quartal_dividers"}


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
