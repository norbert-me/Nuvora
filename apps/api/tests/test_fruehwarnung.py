"""Die Frühwarn-Regel wird hier nachgerechnet, nicht geglaubt.

Jeder Fall setzt Zahlen, die von Hand nachvollziehbar sind — sonst ist eine
Meldung an die Lehrkraft nur eine Behauptung. Besonders wichtig sind die Fälle,
die NICHT melden: eine Frühwarnung, die bei jedem schwachen Tag anschlägt, wird
nach zwei Wochen ignoriert.
"""
from datetime import datetime, timedelta

from app.fruehwarnung import EMPFINDLICH, STANDARD, Antwort, Test, analysiere, erstvorkommen

START = datetime(2026, 1, 12, 8, 0)


def baue(anzahl_tests, quoten, topic_id=1, fragen=4, datum0=START, abstand_tage=14, abwesend=()):
    """`quoten`: {card_id: Anteil richtig je Test} — konstant über alle Tests."""
    tests = []
    for i in range(anzahl_tests):
        t = Test(session_id=i + 1, name=f"Test {i + 1}", datum=datum0 + timedelta(days=abstand_tage * i))
        for cid, anteil in quoten.items():
            if cid in abwesend:
                t.abwesend.add(cid)
                continue
            richtige = round(anteil * fragen)
            for f in range(fragen):
                t.antworten.append(Antwort(card_id=cid, topic_id=topic_id, richtig=f < richtige))
        tests.append(t)
    return tests


def finde(res, cid):
    return next(s for s in res["schueler"] if s["card_id"] == cid)


def test_dauerhaft_unter_der_klasse_wird_gemeldet():
    # Kind 1 bei 25 %, die anderen bei 75/100 % → Abstand rund -42 Pp, in jedem Test.
    tests = baue(6, {1: 0.25, 2: 0.75, 3: 1.0})
    res = analysiere(tests, {1: "Kind A", 2: "Kind B", 3: "Kind C"})
    a = finde(res, 1)
    assert a["status"] == "melden"
    assert a["abstand_median"] < -20
    assert "von 5 Tests" in a["begruendung"]
    # Die Guten bleiben unauffaellig — sonst waere die Liste wertlos.
    assert finde(res, 2)["status"] == "unauffaellig"
    assert finde(res, 3)["status"] == "unauffaellig"


def test_ein_schlechter_tag_meldet_nicht():
    tests = baue(6, {1: 0.75, 2: 0.75, 3: 0.75})
    # Ein einzelner Einbruch: im letzten Test alles falsch.
    tests[-1].antworten = [a for a in tests[-1].antworten if a.card_id != 1] + [
        Antwort(card_id=1, topic_id=1, richtig=False) for _ in range(4)
    ]
    res = analysiere(tests, {1: "Kind A", 2: "Kind B", 3: "Kind C"})
    assert finde(res, 1)["status"] == "unauffaellig"


def test_schwerer_test_druckt_niemanden_in_die_meldung():
    # Alle bei 25 %: der Test war schwer, kein Kind haengt hinterher.
    tests = baue(6, {1: 0.25, 2: 0.25, 3: 0.25})
    res = analysiere(tests, {1: "A", 2: "B", 3: "C"})
    assert all(s["status"] == "unauffaellig" for s in res["schueler"])


def test_zu_wenig_daten_ist_keine_entwarnung():
    tests = baue(2, {1: 0.0, 2: 1.0}, fragen=4)   # 8 Antworten < 12
    res = analysiere(tests, {1: "A", 2: "B"})
    a = finde(res, 1)
    assert a["status"] == "zu_wenig_daten"
    assert "zu wenig" in a["begruendung"]


def test_empfindliche_stufe_meldet_frueher():
    # 50/70/80 % → Klassenmittel 66,7 %, Abstand des Kindes -16,7 Pp: das liegt
    # zwischen den beiden Stufen (Standard -20, empfindlich -15).
    tests = baue(6, {1: 0.5, 2: 0.7, 3: 0.8}, fragen=10)
    assert finde(analysiere(tests, {1: "A", 2: "B", 3: "C"}, STANDARD), 1)["status"] == "unauffaellig"
    assert finde(analysiere(tests, {1: "A", 2: "B", 3: "C"}, EMPFINDLICH), 1)["status"] == "melden"


def test_erstvorkommen_trennt_altbestand_von_frischem_stoff():
    # Thema 1 ab Januar, Thema 2 erst im letzten Test.
    tests = baue(4, {1: 0.5, 2: 0.5}, topic_id=1)
    spaet = Test(session_id=99, name="Neu", datum=START + timedelta(days=200))
    spaet.antworten = [Antwort(card_id=1, topic_id=2, richtig=True)]
    tests.append(spaet)
    erst = erstvorkommen(tests)
    assert erst[1] == START
    assert erst[2] == START + timedelta(days=200)


def test_schwach_im_altbestand_wird_benannt():
    # Thema 1 ist alt (ab Tag 0, gefragt bis Tag 70), Kind faellt dort ab.
    tests = baue(6, {1: 0.2, 2: 0.9, 3: 0.9}, topic_id=1, fragen=5)
    res = analysiere(tests, {1: "A", 2: "B", 3: "C"})
    arten = [e["art"] for e in finde(res, 1)["etiketten"]]
    assert "altbestand" in arten, finde(res, 1)["etiketten"]


def test_nur_ein_thema_wird_als_solches_benannt():
    tests = baue(6, {1: 0.2, 2: 0.9, 3: 0.9}, topic_id=7, fragen=5)
    res = analysiere(tests, {1: "A", 2: "B", 3: "C"})
    themen = finde(res, 1)["themen"]
    assert len(themen) == 1 and themen[0]["topic_id"] == 7
    assert themen[0]["abstand"] < -20


def test_haeufiges_fehlen_ist_ein_eigener_hinweis():
    tests = baue(6, {1: 0.2, 2: 0.9, 3: 0.9}, fragen=5)
    for t in tests[:3]:                      # in der Haelfte der Tests nichts abgegeben
        t.antworten = [a for a in t.antworten if a.card_id != 1]
    res = analysiere(tests, {1: "A", 2: "B", 3: "C"})
    arten = [e["art"] for e in finde(res, 1)["etiketten"]]
    assert "beteiligung" in arten


def test_kurve_hat_einen_punkt_je_test():
    tests = baue(6, {1: 0.5, 2: 0.5})
    res = analysiere(tests, {1: "A", 2: "B"})
    assert len(finde(res, 1)["kurve"]) == 6
    assert all(p["abstand"] is not None for p in finde(res, 1)["kurve"])


def test_fenster_begrenzt_auf_die_letzten_sechs():
    tests = baue(12, {1: 0.5, 2: 0.5})
    res = analysiere(tests, {1: "A", 2: "B"})
    assert len(res["tests"]) == 6
    assert res["tests"][0]["session_id"] == 7
