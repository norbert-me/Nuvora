"""Wahlaufgaben: in einer E/G-Arbeit darf ein Kind je Aufgabe die Fassung des
anderen Blatts schreiben (gleiche Position im Partnerblatt).

Die Fassungen unterscheiden sich in Teilaufgaben, Punkten und Themen. Geprüft
wird die Regel aus app/arbeitswertung.py: Basis ist die Fassung des eigenen
Blatts, was die andere darüber hinaus bringt, ist Bonus — höchstens eine
Notenstufe. Themen, Fehlerarten und Aufgabenstatistik sehen je Kind nur die
Fassung, die es geschrieben hat.
"""
import pytest

from app import arbeitswertung as aw
from app.models import SchoolClass, Student, User, WorkAnalysis
from app.routers import klassenarbeit as KA
from app.routers.klassenarbeit import _fehler_gezaehlt, _je_einheit, _pct_liste, _profile


class FakeWork:
    def __init__(self, tasks, results, wechsel=None, fehler=None, alt=None, niveau="G", scale=None):
        self.tasks = tasks
        self.results = results
        self.wechsel = wechsel
        self.fehler = fehler
        self.absent = []
        self.niveau = niveau
        self.scale = scale
        self._alt = alt or []


# G-Blatt: Aufgabe 1 (4 P., Thema 3), Aufgabe 2 (6 P., Thema 5).
G = [{"id": "t1", "max": 4, "topic_id": 3}, {"id": "t2", "max": 6, "topic_id": 5}]
# E-Blatt, als Kopie entstanden (gleiche ids!): Aufgabe 2 hat a) 4 + b) 4 = 8 P., Thema 7.
E = [{"id": "t1", "max": 4, "topic_id": 3},
     {"id": "t2", "topic_id": 7, "parts": [{"id": "e1", "max": 4}, {"id": "e2", "max": 4}]}]


def test_ohne_wechsel_rechnet_wie_bisher():
    w = FakeWork(G, {"1": {"t1": 2, "t2": 3}}, alt=E)
    r = aw.wertung(w, "1")
    assert r["basis"] == 10 and r["erreicht"] == 5
    assert r["pct"] == 50 and r["bonus_pct"] == 0


def test_punkte_der_anderen_fassung_zaehlen_nur_mit_wechsel():
    w = FakeWork(G, {"1": {"t1": 4, "t2": 6, "~e1": 4, "~e2": 4}}, alt=E)
    assert aw.wertung(w, "1")["erreicht"] == 10


def test_e_punkte_ueber_der_eigenen_hoechstzahl_sind_bonus_und_gedeckelt():
    w = FakeWork(G, {"1": {"t1": 2, "~e1": 4, "~e2": 2}}, wechsel={"1": ["t2"]}, alt=E)
    r = aw.wertung(w, "1")
    # Basis: t1 = 2, t2 = min(6, 6) = 6 -> 8 von 10 = 80 %.
    assert r["erreicht"] == 8 and r["base_pct"] == 80 and r["bonus_pct"] == 0
    w = FakeWork(G, {"1": {"t1": 2, "~e1": 4, "~e2": 4}}, wechsel={"1": ["t2"]}, alt=E)
    r = aw.wertung(w, "1")
    # 8 P. in t2: 6 in die Basis, 2 darüber -> 20 % Bonus, gedeckelt auf die
    # nächste Stufe (80 % -> 87 % = 7 Prozentpunkte).
    assert r["base_pct"] == 80 and r["bonus_pct"] == 7 and r["pct"] == 87


def test_e_kind_mit_der_kleineren_g_fassung_bekommt_keinen_bonus():
    w = FakeWork(E, {"1": {"t1": 4, "~t2": 6}}, wechsel={"1": ["t2"]}, alt=G, niveau="E")
    r = aw.wertung(w, "1")
    assert r["basis"] == 12 and r["erreicht"] == 10 and r["bonus_pct"] == 0


def test_ohne_partnerblatt_gilt_die_eigene_fassung():
    w = FakeWork(G, {"1": {"t2": 3, "~e1": 4}}, wechsel={"1": ["t2"]})
    assert not aw.gewechselt(w, "1", G[1])
    assert aw.wertung(w, "1")["erreicht"] == 3


def test_darstellung_hat_keine_andere_fassung_und_verschiebt_nichts():
    g = G + [{"id": "d", "max": 2, "form": True}]
    e = [{"id": "d", "max": 2, "form": True}] + E     # Darstellung vorn
    w = FakeWork(g, {}, alt=e)
    assert aw.andere_fassung(w, g[2]) is None
    assert aw.andere_fassung(w, g[1]) is e[2]


def test_partner_anhaengen_findet_das_blatt_in_der_liste():
    class W:
        def __init__(self, id, partner_id, tasks):
            self.id, self.partner_id, self.tasks = id, partner_id, tasks
    g, e, allein = W(1, 2, G), W(2, 1, E), W(3, None, G)
    aw.partner_anhaengen([g, e, allein])
    assert g._alt == E and e._alt == G and allein._alt == []


def test_themen_folgen_der_geschriebenen_fassung():
    w = FakeWork(G, {"1": {"t1": 4, "t2": 3}, "2": {"t1": 4, "~e1": 1, "~e2": 1}},
                 wechsel={"2": ["t2"]}, alt=E)
    prof, topic_tasks = _profile(w)
    assert prof["1"] == {3: [4.0, 4.0], 5: [3.0, 6.0]}
    assert prof["2"] == {3: [4.0, 4.0], 7: [2.0, 8.0]}
    assert set(topic_tasks) == {3, 5, 7}


def test_fehlerart_an_der_nicht_geschriebenen_fassung_zaehlt_nicht():
    w = FakeWork(G, {"1": {"t1": 4, "t2": 3, "~e1": 0}},
                 fehler={"1": {"t2": "rechnen", "~e1": "ansatz"}}, alt=E)
    assert [(sid, uid) for sid, uid, _, _ in _fehler_gezaehlt(w)] == [("1", "t2")]


def test_aufgabenstatistik_fuehrt_je_fassung_nur_ihre_kinder():
    w = FakeWork(G, {"1": {"t1": 4, "t2": 6}, "2": {"t1": 2, "~e1": 4, "~e2": 0}},
                 wechsel={"2": ["t2"]}, alt=E)
    zeilen = {z["unit_id"]: z for z in _je_einheit(w)}
    assert zeilen["t2"]["n"] == 1 and zeilen["t2"]["punkte"] == [6.0]
    assert zeilen["~e1"]["n"] == 1 and zeilen["~e1"]["stufe"] == "E"
    assert zeilen["t1"]["n"] == 2


def test_vergleich_rechnet_mit_bonus():
    w = FakeWork(G, {"1": {"t1": 2, "~e1": 4, "~e2": 4}}, wechsel={"1": ["t2"]}, alt=E)
    assert _pct_liste(w) == [87.0]


# ── Speichern: Wechsel und Punkte kommen durch, Geister nicht ──

@pytest.mark.asyncio
async def test_speichern_haelt_wechsel_und_punkte(s):
    u = User(email="wahl@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    c = SchoolClass(name="9a", owner_id=u.id); s.add(c); await s.flush()
    kind = Student(card_id=1, name="Gus", class_id=c.id, niveau="G"); s.add(kind); await s.commit()
    g = await KA.create_work(KA.WorkIn(class_id=c.id, name="KA", niveau="G"), user=u, db=s)
    e = await KA.create_work(KA.WorkIn(class_id=c.id, niveau="E", partner_id=g.id), user=u, db=s)
    await KA.update_work(e.id, KA.WorkPut(tasks=E), user=u, db=s)
    out = await KA.update_work(g.id, KA.WorkPut(
        tasks=G + [{"id": "t3", "max": 2}],
        # ~e1 über dem Maximum wird gekappt, wie jede andere Einheit.
        results={str(kind.id): {"t1": 2, "~e1": 9, "~e2": 4}},
        # t3 hat im E-Blatt kein Gegenstück, 999 ist kein eigenes Kind: beides fällt heraus.
        wechsel={str(kind.id): ["t2", "t3"], "999": ["t2"]},
        fehler={str(kind.id): {"~e2": "rechnen"}},
    ), user=u, db=s)
    assert out.results[str(kind.id)]["~e1"] == 4.0
    assert out.wechsel == {str(kind.id): ["t2"]}
    assert out.fehler == {str(kind.id): {"~e2": "rechnen"}}
    gespeichert = await s.get(WorkAnalysis, g.id)
    await aw.partner_laden(s, gespeichert)
    # Basis 4 + 6 + 2 = 12; erreicht 2 + 8 = 10 -> Basis 8/12, Bonus 2/12 gedeckelt.
    r = aw.wertung(gespeichert, kind.id)
    assert r["erreicht"] == 10 and r["basis"] == 12 and r["bonus_pct"] > 0
