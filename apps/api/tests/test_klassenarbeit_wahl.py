"""Wahlaufgaben: je Aufgabe darf ein Kind die G- oder die E-Fassung schreiben.

Die Fassungen unterscheiden sich in Teilaufgaben, Punkten und Themen. Geprüft
wird die Regel aus app/arbeitswertung.py: Basis ist die G-Punktzahl, was eine
E-Fassung darüber hinaus bringt, ist Bonus — höchstens eine Notenstufe. Und:
Themen, Fehlerarten und Aufgabenstatistik sehen je Kind nur die Fassung, die
es geschrieben hat.
"""
import pytest

from app import arbeitswertung as aw
from app.models import SchoolClass, Student, User, WorkAnalysis
from app.routers import klassenarbeit as KA
from app.routers.klassenarbeit import _fehler_gezaehlt, _je_einheit, _pct_liste, _profile


class FakeWork:
    def __init__(self, tasks, results, e_wahl=None, fehler=None, absent=None, scale=None):
        self.tasks = tasks
        self.results = results
        self.e_wahl = e_wahl
        self.fehler = fehler
        self.absent = absent or []
        self.scale = scale


# Aufgabe 1: nur G (4 P.). Aufgabe 2: G 6 P. (Thema 5) oder E mit a) 4 + b) 4 = 8 P. (Thema 7).
TASKS = [
    {"id": "t1", "max": 4, "topic_id": 3},
    {"id": "t2", "max": 6, "topic_id": 5,
     "e": {"id": "t2e", "topic_id": 7, "parts": [{"id": "e1", "max": 4}, {"id": "e2", "max": 4}]}},
]


def test_ohne_e_fassung_rechnet_wie_bisher():
    w = FakeWork([{"id": "t1", "max": 4}, {"id": "t2", "max": 6}], {"1": {"t1": 2, "t2": 3}})
    r = aw.wertung(w, "1")
    assert r["basis"] == 10 and r["erreicht"] == 5
    assert r["pct"] == 50 and r["bonus_pct"] == 0


def test_g_kind_wird_an_der_g_fassung_gemessen():
    w = FakeWork(TASKS, {"1": {"t1": 4, "t2": 6, "e1": 4, "e2": 4}})
    r = aw.wertung(w, "1")
    # Punkte in der E-Fassung zählen nicht, solange das Kind G geschrieben hat.
    assert r["erreicht"] == 10 and r["pct"] == 100


def test_e_punkte_ueber_der_g_hoechstzahl_sind_bonus_und_gedeckelt():
    w = FakeWork(TASKS, {"1": {"t1": 2, "e1": 4, "e2": 2}}, e_wahl={"1": ["t2"]})
    r = aw.wertung(w, "1")
    # Basis: t1 = 2, t2 = min(6, 6) = 6 -> 8 von 10 = 80 %.
    assert r["erreicht"] == 8 and r["base_pct"] == 80
    assert r["bonus_pct"] == 0
    w = FakeWork(TASKS, {"1": {"t1": 2, "e1": 4, "e2": 4}}, e_wahl={"1": ["t2"]})
    r = aw.wertung(w, "1")
    # 8 P. in t2: 6 in die Basis, 2 über -> 20 % Bonus, aber gedeckelt auf die
    # nächste Stufe (80 % -> 87 % = 7 Prozentpunkte).
    assert r["base_pct"] == 80 and r["bonus_pct"] == 7 and r["pct"] == 87


def test_e_fassung_mit_weniger_punkten_zaehlt_ohne_bonus():
    tasks = [{"id": "t1", "max": 6, "e": {"id": "t1e", "max": 4}}]
    w = FakeWork(tasks, {"1": {"t1e": 4}}, e_wahl={"1": ["t1"]})
    r = aw.wertung(w, "1")
    assert r["erreicht"] == 4 and r["basis"] == 6 and r["bonus_pct"] == 0


def test_wahl_fuer_aufgabe_ohne_e_fassung_ist_wirkungslos():
    w = FakeWork(TASKS, {"1": {"t1": 4}}, e_wahl={"1": ["t1"]})
    assert aw.fassung(w, "1", TASKS[0]) == "G"


def test_themen_folgen_der_geschriebenen_fassung():
    w = FakeWork(TASKS, {"1": {"t1": 4, "t2": 3}, "2": {"t1": 4, "e1": 1, "e2": 1}}, e_wahl={"2": ["t2"]})
    prof, topic_tasks = _profile(w)
    assert prof["1"] == {3: [4.0, 4.0], 5: [3.0, 6.0]}
    # Kind 2 hat die E-Fassung geschrieben: Thema 7, nicht Thema 5.
    assert prof["2"] == {3: [4.0, 4.0], 7: [2.0, 8.0]}
    assert set(topic_tasks) == {3, 5, 7}


def test_fehlerart_an_der_nicht_geschriebenen_fassung_zaehlt_nicht():
    w = FakeWork(TASKS, {"1": {"t1": 4, "t2": 3, "e1": 0}},
                 fehler={"1": {"t2": "rechnen", "e1": "ansatz"}})
    assert [(sid, uid) for sid, uid, _, _ in _fehler_gezaehlt(w)] == [("1", "t2")]


def test_aufgabenstatistik_fuehrt_je_fassung_nur_ihre_kinder():
    w = FakeWork(TASKS, {"1": {"t1": 4, "t2": 6}, "2": {"t1": 2, "e1": 4, "e2": 0}}, e_wahl={"2": ["t2"]})
    zeilen = {z["unit_id"]: z for z in _je_einheit(w)}
    assert zeilen["t2"]["n"] == 1 and zeilen["t2"]["punkte"] == [6.0]
    assert zeilen["e1"]["n"] == 1 and zeilen["e1"]["stufe"] == "E"
    assert zeilen["t1"]["n"] == 2


def test_vergleich_rechnet_mit_bonus():
    w = FakeWork(TASKS, {"1": {"t1": 2, "e1": 4, "e2": 4}}, e_wahl={"1": ["t2"]})
    assert _pct_liste(w) == [87.0]


# ── Speichern: die E-Fassung und die Wahl kommen durch, Geister nicht ──


@pytest.mark.asyncio
async def test_speichern_haelt_fassung_und_wahl(s):
    u = User(email="wahl@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    c = SchoolClass(name="9a", owner_id=u.id); s.add(c); await s.flush()
    kind = Student(card_id=1, name="Ella", class_id=c.id); s.add(kind); await s.commit()
    w = await KA.create_work(KA.WorkIn(class_id=c.id, name="KA"), user=u, db=s)
    out = await KA.update_work(w.id, KA.WorkPut(
        tasks=[{"id": "t1", "max": 4},
               {"id": "t2", "max": 6, "e": {"id": "t2e", "parts": [{"id": "e1", "max": 4}, {"id": "e2", "max": 4}]}}],
        # e1 über dem Maximum wird gekappt, wie jede andere Einheit.
        results={str(kind.id): {"t1": 2, "e1": 9, "e2": 4}},
        # t1 hat keine E-Fassung, 999 ist kein eigenes Kind: beides fällt heraus.
        e_wahl={str(kind.id): ["t1", "t2"], "999": ["t2"]},
        fehler={str(kind.id): {"e2": "rechnen"}},
    ), user=u, db=s)
    assert out.tasks[1]["e"]["parts"][0] == {"id": "e1", "label": "", "max": 4.0, "topic_id": None}
    assert out.results[str(kind.id)]["e1"] == 4.0
    assert out.e_wahl == {str(kind.id): ["t2"]}
    assert out.fehler == {str(kind.id): {"e2": "rechnen"}}
    gespeichert = await s.get(WorkAnalysis, w.id)
    assert aw.wertung(gespeichert, kind.id)["pct"] == 87
