"""Themen einer Klassenarbeit hängen an der Wertungseinheit, nicht an der Aufgabe.

Der Anlass: „Aufgabe 1: Wiederholung" prüft in a) Kopfrechnen, in b) Umwandeln
von Bruch/Dezimal/Prozent, in c) Runden und in d) die schriftlichen Verfahren.
Hängt das Thema nur oben an der Aufgabe, landet all das in einem Topf — die
Auswertung meldet dann „Wiederholung schwach" statt „Runden schwach", und die
Wiederholung (Karten/Lernpfad) zielt ins Leere.

Geprüft wird `_profile`, weil daran mehr hängt als die Anzeige: Wiederholung,
Notenübernahme und die Frühwarnung rechnen alle damit.
"""
from app.routers.klassenarbeit import _profile, _units, _units_mit_thema


class FakeWork:
    """Nur die Felder, die _profile liest — keine Datenbank nötig."""
    def __init__(self, tasks, results, absent=None):
        self.tasks = tasks
        self.results = results
        self.absent = absent or []


def test_teilaufgabe_erbt_das_thema_der_aufgabe():
    task = {"id": "t1", "topic_id": 5, "max": 2,
            "parts": [{"id": "a", "max": 1}, {"id": "b", "max": 3}]}
    assert _units_mit_thema(task) == [("a", 1.0, 5), ("b", 3.0, 5)]
    # Die alte Fassung ohne Thema bleibt nutzbar (Punkte-Clamping).
    assert _units(task) == [("a", 1.0), ("b", 3.0)]


def test_eigenes_thema_der_teilaufgabe_schlaegt_das_der_aufgabe():
    task = {"id": "t1", "topic_id": 5, "max": 2,
            "parts": [{"id": "a", "max": 1, "topic_id": 9}, {"id": "b", "max": 1}]}
    assert _units_mit_thema(task) == [("a", 1.0, 9), ("b", 1.0, 5)]


def test_aufgabe_ohne_teile_bleibt_eine_einheit():
    assert _units_mit_thema({"id": "t1", "topic_id": 5, "max": 4}) == [("t1", 4.0, 5)]


def test_vier_themen_in_einer_aufgabe_werden_getrennt_gerechnet():
    # Die Aufgabe aus dem Anlass: 4 + 6 + 3 + 8 = 21 Punkte, vier Themen.
    task = {"id": "t1", "label": "Wiederholung", "topic_id": None, "max": 21, "parts": [
        {"id": "a", "label": "a", "max": 4, "topic_id": 1},   # Kopfrechnen
        {"id": "b", "label": "b", "max": 6, "topic_id": 2},   # Umwandeln
        {"id": "c", "label": "c", "max": 3, "topic_id": 3},   # Runden
        {"id": "d", "label": "d", "max": 8, "topic_id": 4},   # schriftlich
    ]}
    # Ein Kind: Kopfrechnen voll, Runden komplett daneben.
    work = FakeWork([task], {"7": {"a": 4, "b": 5, "c": 0, "d": 6}})
    prof, topic_tasks = _profile(work)

    assert prof["7"][1] == [4.0, 4.0]     # Kopfrechnen 100 %
    assert prof["7"][2] == [5.0, 6.0]
    assert prof["7"][3] == [0.0, 3.0]     # Runden 0 % — das ist der Befund
    assert prof["7"][4] == [6.0, 8.0]
    # Jedes Thema kennt die Aufgabe, aus der es stammt (fuer die Anzeige).
    assert topic_tasks == {1: ["t1"], 2: ["t1"], 3: ["t1"], 4: ["t1"]}


def test_ohne_thema_zaehlt_die_einheit_nirgends_mit():
    task = {"id": "t1", "topic_id": None, "max": 5,
            "parts": [{"id": "a", "max": 2, "topic_id": 1}, {"id": "b", "max": 3}]}
    prof, _ = _profile(FakeWork([task], {"7": {"a": 2, "b": 0}}))
    # Nur die Einheit mit Thema steht im Profil — die andere ist nicht
    # zuzuordnen und darf kein Thema kuenstlich verschlechtern.
    assert prof["7"] == {1: [2.0, 2.0]}


def test_abwesende_bleiben_draussen():
    task = {"id": "t1", "topic_id": 1, "max": 2}
    work = FakeWork([task], {"7": {"t1": 2}, "8": "abwesend", "9": {"t1": 0}}, absent=["9"])
    prof, _ = _profile(work)
    assert set(prof) == {"7"}
