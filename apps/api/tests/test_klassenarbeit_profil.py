"""Themen einer Klassenarbeit hängen an der Wertungseinheit, nicht an der Aufgabe.

Der Anlass: „Aufgabe 1: Wiederholung" prüft in a) Kopfrechnen, in b) Umwandeln
von Bruch/Dezimal/Prozent, in c) Runden und in d) die schriftlichen Verfahren.
Hängt das Thema nur oben an der Aufgabe, landet all das in einem Topf — die
Auswertung meldet dann „Wiederholung schwach" statt „Runden schwach", und die
Wiederholung (Karten/Lernpfad) zielt ins Leere.

Geprüft wird `_profile`, weil daran mehr hängt als die Anzeige: Wiederholung,
Notenübernahme und die Frühwarnung rechnen alle damit.
"""
from app.routers.klassenarbeit import _je_einheit, _profile, _units, _units_mit_thema


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


# ─── Kennzahlen je Aufgabe: woran eine misslungene Aufgabe auffaellt ───
#
# Die Trefferquote allein kann eine SCHWERE Aufgabe nicht von einer
# MISSVERSTAENDLICHEN unterscheiden — beide liegen niedrig. Dafuer sind die
# anderen Werte da, und deshalb werden sie hier nachgerechnet.


def test_kennzahlen_einer_normalen_aufgabe():
    # Vier Kinder, zwei gleichwertige Aufgaben zu je 4 Punkten: 4, 3, 1, 0.
    w = FakeWork(
        [{"id": "a1", "label": "1", "topic_id": 1, "max": 4},
         {"id": "a2", "label": "2", "topic_id": 1, "max": 4}],
        {"1": {"a1": 4, "a2": 4}, "2": {"a1": 3, "a2": 3},
         "3": {"a1": 1, "a2": 1}, "4": {"a1": 0, "a2": 0}},
    )
    e = _je_einheit(w)[0]
    assert e["n"] == 4
    assert e["pct"] == 50          # 8 von 16 Punkten
    assert e["null"] == 25         # ein Kind mit 0 Punkten
    assert e["voll"] == 25         # ein Kind mit voller Punktzahl
    assert e["trenn"] == 1.0       # laeuft exakt mit der Gesamtleistung


def test_aufgabe_ohne_streuung_hat_keine_trennschaerfe():
    # Jeder bekommt denselben Punkt: die Aufgabe sagt ueber Unterschiede nichts.
    # Wichtig, dass hier None steht und nicht 0 — „keine Aussage" ist etwas
    # anderes als „trennt nicht".
    w = FakeWork(
        [{"id": "a1", "max": 4}, {"id": "a2", "max": 4}],
        {"1": {"a1": 4, "a2": 1}, "2": {"a1": 3, "a2": 1},
         "3": {"a1": 1, "a2": 1}, "4": {"a1": 0, "a2": 1}},
    )
    assert _je_einheit(w)[1]["trenn"] is None


def test_negativ_trennende_aufgabe_wird_erkannt():
    # Genau der Fall, den die Lehrkraft sucht: wer den Rest der Arbeit gut
    # loest, scheitert HIER — ein Zeichen fuer Formulierung oder Erwartungshorizont.
    w = FakeWork(
        [{"id": "a1", "max": 4}, {"id": "a2", "max": 4}],
        {"1": {"a1": 4, "a2": 0}, "2": {"a1": 3, "a2": 1},
         "3": {"a1": 1, "a2": 3}, "4": {"a1": 0, "a2": 4}},
    )
    assert _je_einheit(w)[1]["trenn"] == -1.0


def test_darstellung_ist_gekennzeichnet_und_bleibt_in_der_wertung():
    # `form` markiert die Darstellungsleistung. Sie faellt aus dem VERGLEICH
    # heraus (Oberflaeche), bleibt aber eine Wertungseinheit — die Punkte
    # zaehlen zur Note.
    w = FakeWork([{"id": "d", "label": "Darstellung", "max": 3, "form": True}],
                 {"1": {"d": 3}, "2": {"d": 2}})
    e = _je_einheit(w)[0]
    assert e["form"] is True
    assert e["pct"] == 83          # 5 von 6 Punkten
