"""Regressionstest der Fehlerarten (app/routers/klassenarbeit.py).

Die Fehlerart ist eine Zusatzangabe je Zelle: sie sagt, WORAN eine Aufgabe
scheiterte, waehrend die Punkte nur sagen, WIE VIEL fehlt. Gezaehlt wird nicht
alles, was gespeichert ist — die drei Regeln stehen in `_fehler_gezaehlt` und
werden hier festgehalten, weil sie sonst still verrutschen:

  1. Volle Punkte -> die Angabe ist veraltet und zaehlt nicht mit.
  2. Abwesende Kinder zaehlen nicht (wie ueberall in dieser Auswertung).
  3. Eine Angabe an einer geloeschten Einheit ist eine Waise und zaehlt nicht.

Die JS-Seite (`analyse.fehlerStat` in pages/Klassenarbeit.jsx) rechnet
dasselbe; wer hier etwas aendert, muss sie mitziehen.
"""
from app.models import WorkAnalysis
from app.routers.klassenarbeit import FEHLER_VALUES, _fehler_gezaehlt


def arbeit(**kw):
    w = WorkAnalysis()
    w.tasks = kw.get("tasks", [
        {"id": "t1", "max": 4, "topic_id": 7},
        {"id": "t2", "max": 6, "topic_id": 9},
    ])
    w.results = kw.get("results", {})
    w.fehler = kw.get("fehler", {})
    w.absent = kw.get("absent", None)
    return w


def test_zaehlt_nur_wo_punkte_fehlen():
    w = arbeit(results={"1": {"t1": 4, "t2": 2}},
               fehler={"1": {"t1": "rechnen", "t2": "ansatz"}})
    gez = _fehler_gezaehlt(w)
    # t1 hat die volle Punktzahl — die Angabe bleibt gespeichert, zaehlt aber nicht.
    assert [(uid, art) for _, uid, art, _ in gez] == [("t2", "ansatz")]
    assert w.fehler["1"]["t1"] == "rechnen"       # nichts geloescht


def test_thema_kommt_aus_der_einheit():
    w = arbeit(results={"1": {"t2": 0}}, fehler={"1": {"t2": "leer"}})
    assert _fehler_gezaehlt(w)[0][3] == 9


def test_abwesende_zaehlen_nicht():
    w = arbeit(results={"1": {"t1": 0}}, fehler={"1": {"t1": "ansatz"}}, absent=["1"])
    assert _fehler_gezaehlt(w) == []
    # Der alte Marker in results wirkt genauso.
    w2 = arbeit(results={"1": "abwesend"}, fehler={"1": {"t1": "ansatz"}})
    assert _fehler_gezaehlt(w2) == []


def test_waise_an_geloeschter_einheit_zaehlt_nicht():
    w = arbeit(results={"1": {"t1": 0}}, fehler={"1": {"t1": "ansatz", "weg": "rechnen"}})
    assert [uid for _, uid, _, _ in _fehler_gezaehlt(w)] == ["t1"]


def test_nicht_erfasste_zelle_gilt_als_offen():
    # Kein Punktwert eingetragen: 0 erreicht, also zaehlt die Angabe mit —
    # sonst faellt genau der Fall heraus, fuer den "nicht bearbeitet" da ist.
    w = arbeit(results={"1": {}}, fehler={"1": {"t1": "leer"}})
    assert len(_fehler_gezaehlt(w)) == 1


def test_teilaufgabe_erbt_das_thema_der_aufgabe():
    w = arbeit(tasks=[{"id": "t1", "max": 4, "topic_id": 7,
                       "parts": [{"id": "p1", "max": 2}, {"id": "p2", "max": 2, "topic_id": 12}]}],
               results={"1": {"p1": 0, "p2": 1}},
               fehler={"1": {"p1": "ansatz", "p2": "rechnen"}})
    themen = {uid: tid for _, uid, _, tid in _fehler_gezaehlt(w)}
    assert themen == {"p1": 7, "p2": 12}


def test_katalog_ist_geschlossen():
    # Wortgleich mit FEHLER in pages/Klassenarbeit.jsx — eine unbekannte Art
    # wirft der Server beim Speichern weg, hier steht, welche es gibt.
    assert FEHLER_VALUES == {"ansatz", "rechnen", "fluechtig", "darstellung", "leer"}
