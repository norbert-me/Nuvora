"""Was weich geloescht wird, muss auch im Papierkorb stehen.

`persons` stand im Aufraeumjob (`PAPIERKORB_TABELLEN`, 30 Tage), aber in keiner
Liste von `trash.py`: eine geloeschte Person war spurlos weg, nicht
wiederherstellbar, und nach 30 Tagen endgueltig. Das faellt niemandem auf —
ausser einem Test, der beide Listen gegeneinander haelt.
"""
from app.main import PAPIERKORB_TABELLEN
from app.routers.trash import _AKTIONEN

# Tabelle → Art im Papierkorb. Wer eine Tabelle in den Aufraeumjob aufnimmt,
# traegt sie hier ein und baut die Art in `list_trash` + `_AKTIONEN`.
TABELLE_ZU_ART = {
    "cards": "card",
    "learning_ladders": "ladder",
    "exercises": "exercise",
    "school_classes": "class",
    "card_decks": "deck",
    "learning_paths": "path",
    "kurse": "kurs",
    "questions": "question",
    "topics": "topic",
    "pap_aufgaben": "pap",
    "persons": "person",
}


def test_jede_aufgeraeumte_tabelle_ist_im_papierkorb_sichtbar():
    fehlt = [t for t, _ in PAPIERKORB_TABELLEN if t not in TABELLE_ZU_ART]
    assert not fehlt, (
        f"Diese Tabellen werden nach 30 Tagen endgueltig geloescht, ohne dass "
        f"jemand sie je im Papierkorb sieht: {fehlt}"
    )
    ohne_aktion = [TABELLE_ZU_ART[t] for t, _ in PAPIERKORB_TABELLEN
                   if TABELLE_ZU_ART[t] not in _AKTIONEN]
    assert not ohne_aktion, (
        f"Diese Arten stehen im Papierkorb, lassen sich aber weder "
        f"wiederherstellen noch endgueltig loeschen: {ohne_aktion}"
    )


def test_keine_art_ohne_aufraeumjob():
    """Und die Gegenrichtung: was im Papierkorb liegt, muss auch wieder
    verschwinden — sonst waechst er ewig."""
    tabellen = {t for t, _ in PAPIERKORB_TABELLEN}
    ohne_job = sorted(art for tab, art in TABELLE_ZU_ART.items()
                      if art in _AKTIONEN and tab not in tabellen)
    assert not ohne_job, f"Arten im Papierkorb ohne Aufraeumjob: {ohne_job}"
