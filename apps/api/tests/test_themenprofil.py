"""Der Themenstand wird nachgerechnet, nicht geglaubt.

Er beantwortet zwei Fragen, die eine einzelne Arbeit nicht beantwortet: „Wie gut
sitzt dieses Unterthema?" und „Wird es besser?" — und beide dürfen nicht aus zu
wenigen Punkten behauptet werden.
"""
from datetime import datetime, timedelta

from app.themenprofil import MINDEST_PUNKTE, Erhebung, Messung, profil

START = datetime(2026, 2, 1)


def erhebung(nr, tage, *messungen, art="arbeit"):
    return Erhebung(id=nr, name=f"E{nr}", datum=START + timedelta(days=tage), art=art,
                    messungen=[Messung(t, e, m) for t, e, m in messungen])


def finde(res, topic_id):
    return next(x for x in res if x["topic_id"] == topic_id)


def test_punkte_werden_nach_gewicht_zusammengefasst():
    # 3/10 und 8/10 → 11 von 20 Punkten = 55 %, NICHT der Mittelwert der
    # Prozentwerte (der waere 55 % nur zufaellig gleich; bei ungleichen
    # Maximalpunkten laufen beide auseinander).
    res = profil([erhebung(1, 0, (1, 3, 10)), erhebung(2, 30, (1, 8, 10))])
    t = finde(res, 1)
    assert t["punkte"] == 11.0 and t["max"] == 20.0
    assert t["pct"] == 55.0


def test_grosse_aufgabe_wiegt_schwerer_als_kleine():
    # 1/1 (perfekt) und 2/9 (schwach) → 3 von 10 = 30 %. Der Mittelwert der
    # Quoten waere 61 % und wuerde das Koennen deutlich zu gut darstellen.
    res = profil([erhebung(1, 0, (1, 1, 1)), erhebung(2, 30, (1, 2, 9))])
    assert finde(res, 1)["pct"] == 30.0


def test_zu_wenige_punkte_ergeben_keine_zahl():
    res = profil([erhebung(1, 0, (7, 1, 3))])
    t = finde(res, 7)
    assert t["genug"] is False
    assert t["pct"] is None          # kein Prozentwert, der nach Wissen aussieht
    assert t["max"] < MINDEST_PUNKTE


def test_trend_erkennt_verbesserung():
    # 30 %, 55 %, 80 % — erste Haelfte gegen zweite.
    res = profil([erhebung(1, 0, (1, 3, 10)), erhebung(2, 20, (1, 5.5, 10)),
                  erhebung(3, 40, (1, 8, 10))])
    t = finde(res, 1)
    assert t["trend"]["richtung"] == "auf"
    assert t["trend"]["delta"] > 10


def test_trend_erkennt_verschlechterung():
    res = profil([erhebung(1, 0, (1, 9, 10)), erhebung(2, 20, (1, 6, 10)),
                  erhebung(3, 40, (1, 3, 10))])
    assert finde(res, 1)["trend"]["richtung"] == "ab"


def test_kleine_schwankung_ist_kein_trend():
    # 60 %, 65 %, 62 % — das ist Rauschen zwischen zwei Arbeiten, kein Verlauf.
    res = profil([erhebung(1, 0, (1, 6, 10)), erhebung(2, 20, (1, 6.5, 10)),
                  erhebung(3, 40, (1, 6.2, 10))])
    assert finde(res, 1)["trend"]["richtung"] == "gleich"


def test_zwei_messpunkte_ergeben_noch_keinen_trend():
    # Bewusst: aus zwei Arbeiten eine Richtung abzulesen waere geraten.
    res = profil([erhebung(1, 0, (1, 3, 10)), erhebung(2, 30, (1, 9, 10))])
    assert finde(res, 1)["trend"] is None


def test_quiz_und_arbeit_zaehlen_zusammen():
    res = profil([erhebung(1, 0, (1, 3, 10)),
                  erhebung(2, 10, (1, 2, 4), art="quiz")])
    t = finde(res, 1)
    assert t["erhebungen"] == 2
    assert {p["art"] for p in t["verlauf"]} == {"arbeit", "quiz"}
    assert t["pct"] == 35.7          # 5 von 14 Punkten


def test_schwaechstes_thema_steht_oben_duennes_am_ende():
    res = profil([erhebung(1, 0, (1, 9, 10), (2, 2, 10), (3, 1, 2))])
    assert [x["topic_id"] for x in res] == [2, 1, 3]   # 20 %, 90 %, dann „zu dünn"
