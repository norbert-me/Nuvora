"""Regressionstest der E/G-Wertung (app/scoring.py).

Die Regeln stehen doppelt — hier in Python, im Frontend in core/scoring.js.
Dieser Test hält die Python-Seite fest; wer sie ändert, muss die JS-Seite
mitziehen.
"""
from app.scoring import bewerte, status_of

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
