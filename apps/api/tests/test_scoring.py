"""Regressionstest der E/G-Wertung (app/scoring.py).

Die Regeln stehen doppelt — hier in Python, im Frontend in core/scoring.js.
Dieser Test hält die Python-Seite fest; wer sie ändert, muss die JS-Seite
mitziehen.
"""
from app.scoring import DEFAULT_SCALE, bewerte, gefehlt_von, naechste_stufe, status_of

# 4 Fragen der Anforderung (G) + 3 Zusatzfragen (E), alle richtig = "A".
QUESTIONS = (
    [{"id": i, "correct_answer": "A", "niveau": ""} for i in range(1, 5)]
    + [{"id": i, "correct_answer": "A", "niveau": "E"} for i in range(5, 8)]
)
# 3 von 4 G richtig, 2 von 3 E richtig.
ANTWORTEN = {1: "A", 2: "A", 3: "A", 4: "B", 5: "A", 6: "A", 7: "B"}


def test_g_kurs_zaehlt_nur_g_fragen():
    w = bewerte(QUESTIONS, ANTWORTEN, niveau="G", niveau_aktiv=True)
    assert w["max_score"] == 4      # die E-Fragen sind nicht Teil der 100 %
    assert w["base_pct"] == 75.0


def test_e_kurs_zaehlt_alle_fragen():
    w = bewerte(QUESTIONS, ANTWORTEN, niveau="E", niveau_aktiv=True)
    assert w["max_score"] == 7
    assert w["bonus_pct"] == 0.0    # kein Bonus, alles ist Anforderung


def test_bonus_erst_ab_zwei_richtigen_e_antworten():
    nur_eine = {**ANTWORTEN, 6: "B"}
    assert bewerte(QUESTIONS, nur_eine, niveau="G", niveau_aktiv=True)["bonus_pct"] == 0.0
    assert bewerte(QUESTIONS, ANTWORTEN, niveau="G", niveau_aktiv=True)["bonus_pct"] > 0


def test_bonus_hebt_hoechstens_eine_notenstufe():
    alle_e = {1: "A", 2: "A", 3: "A", 4: "B", 5: "A", 6: "A", 7: "A"}
    w = bewerte(QUESTIONS, alle_e, niveau="G", niveau_aktiv=True)
    # 75 % liegt in der Stufe ab 73; voller Bonus hebt genau auf 87 (nächste Stufe).
    assert w["pct"] == 87.0


def test_falsche_e_antworten_zehren_nur_den_bonus():
    w = bewerte(QUESTIONS, ANTWORTEN, niveau="G", niveau_aktiv=True)
    assert w["base_pct"] == 75.0    # Basis bleibt unangetastet
    assert w["e_wrong"] == 1
    assert w["bonus_pct"] < 12.0    # weniger als der volle Bonus


def test_minuspunkte_nie_unter_null():
    alles_falsch = {i: "B" for i in range(1, 8)}
    w = bewerte(QUESTIONS, alles_falsch, niveau="G", niveau_aktiv=True, minuspunkte=True)
    assert w["score"] == 0.0
    assert w["pct"] == 0.0


def test_ohne_flag_zaehlen_alle_fragen_regulaer():
    w = bewerte(QUESTIONS, ANTWORTEN, niveau="G", niveau_aktiv=False)
    assert w["max_score"] == 7
    assert w["bonus_pct"] == 0.0


def test_keine_abgabe_ist_null_punkte():
    w = bewerte(QUESTIONS, {}, niveau="G", niveau_aktiv=True)
    assert w["score"] == 0.0 and w["pct"] == 0.0


def test_status_ohne_abgabe_gilt_als_krank_und_ist_umschaltbar():
    assert status_of(3, False, {}) == "krank"
    assert status_of(3, False, {"anwesend": [3]}) == "anwesend"
    assert status_of(3, True, {}) == "anwesend"
    assert status_of(3, True, {"krank": [3]}) == "krank"


# --- „Bei dem Thema gefehlt" -------------------------------------------------
# Fragen zu einem verpassten Thema zaehlen nicht zur Basis, geben aber Bonus wie
# eine E-Frage — und Minuspunkte greifen dort nie.

def _fragen_mit_thema():
    return [
        {"id": 1, "correct_answer": "A", "niveau": "", "topic_id": 10},
        {"id": 2, "correct_answer": "A", "niveau": "", "topic_id": 10},
        {"id": 3, "correct_answer": "A", "niveau": "", "topic_id": 20},
        {"id": 4, "correct_answer": "A", "niveau": "", "topic_id": 20},
    ]


def test_verpasstes_thema_zaehlt_nicht_zur_basis():
    fragen = _fragen_mit_thema()
    antworten = {1: "A", 2: "A", 3: "B", 4: "B"}
    ohne = bewerte(fragen, antworten)
    assert ohne["max_score"] == 4 and ohne["base_pct"] == 50.0
    mit = bewerte(fragen, antworten, gefehlt_topics=[20])
    # Nur noch die zwei Fragen zu Thema 10 bilden die Basis — beide richtig.
    assert mit["max_score"] == 2
    assert mit["base_pct"] == 100.0
    assert mit["gefehlt_total"] == 2


def test_verpasstes_thema_gibt_bonus_und_deckelt_bei_einer_stufe():
    fragen = _fragen_mit_thema()
    # Basis (Thema 10) halb richtig, das verpasste Thema ganz richtig.
    antworten = {1: "A", 2: "B", 3: "A", 4: "A"}
    w = bewerte(fragen, antworten, gefehlt_topics=[20])
    assert w["base_pct"] == 50.0
    assert w["bonus_pct"] > 0
    # Hoechstens eine Notenstufe besser — nie darueber hinaus.
    assert w["bonus_pct"] <= naechste_stufe(w["base_pct"], DEFAULT_SCALE) + 0.05


def test_verpasstes_thema_kostet_keine_minuspunkte():
    fragen = _fragen_mit_thema()
    antworten = {1: "A", 2: "A", 3: "B", 4: "B"}   # im verpassten Thema alles falsch
    w = bewerte(fragen, antworten, minuspunkte=True, gefehlt_topics=[20])
    assert w["score"] == 2.0        # kein Abzug fuer die falschen Antworten dort
    assert w["base_pct"] == 100.0


def test_alle_fragen_verpasst_zaehlt_regulaer():
    # Ohne Basis haengt der Bonus an nichts — dann wird regulaer gewertet,
    # statt eine Wertung aus lauter Bonus zu bauen.
    fragen = _fragen_mit_thema()
    antworten = {1: "A", 2: "A", 3: "A", 4: "B"}
    w = bewerte(fragen, antworten, gefehlt_topics=[10, 20])
    assert w["max_score"] == 4
    assert w["base_pct"] == 75.0
    assert w["bonus_pct"] == 0.0


def test_gefehlt_von_liest_die_konfiguration():
    cfg = {"gefehlt": {"7": [10, "20"], "8": "unsinn"}}
    assert gefehlt_von(7, cfg) == [10, 20]
    assert gefehlt_von("7", cfg) == [10, 20]
    assert gefehlt_von(8, cfg) == []
    assert gefehlt_von(9, cfg) == []
    assert gefehlt_von(9, None) == []
