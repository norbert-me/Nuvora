"""Paritätstest: app/scoring.py gegen apps/web/src/core/scoring.js.

Die E/G-Regeln stehen doppelt (Server rechnet PDF/Excel/Notenbuch-Brücke, das
Frontend rechnet die Auswertungsseite live). Läuft eine Seite anders, bekommt
jemand im PDF eine andere Note als auf dem Bildschirm. Dieser Test füttert
BEIDE Seiten mit denselben Fällen und vergleicht Feld für Feld — die JS-Seite
wird dabei im Original über node geladen, nicht nachgebaut.

Ohne node wird übersprungen (der Test darf keine Umgebung erzwingen).
"""
import json
import os
import random
import shutil
import subprocess
import tempfile

import pytest

from app.scoring import bewerte, naechste_stufe, status_of

HIER = os.path.dirname(os.path.abspath(__file__))
TREIBER = os.path.join(HIER, "scoring_parity.mjs")
NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(NODE is None, reason="node nicht verfügbar")

# JS-Feldname -> Python-Feldname
FELDER = {
    "score": "score", "maxScore": "max_score", "basePct": "base_pct",
    "bonusPct": "bonus_pct", "pct": "pct", "eCorrect": "e_correct",
    "eWrong": "e_wrong", "eTotal": "e_total",
}


def js(faelle):
    """Dieselben Fälle durch die echte scoring.js schicken."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump(faelle, fh)
        pfad = fh.name
    try:
        p = subprocess.run([NODE, TREIBER, pfad], capture_output=True, text=True, timeout=60)
    finally:
        os.unlink(pfad)
    assert p.returncode == 0, f"node-Treiber gescheitert:\n{p.stderr}"
    return json.loads(p.stdout)


def py(fall):
    return bewerte(
        fall["questions"], {int(k): v for k, v in fall["answers"].items()},
        niveau=fall.get("niveau", ""), niveau_aktiv=fall.get("niveau_aktiv", False),
        minuspunkte=fall.get("minuspunkte", False), weights=fall.get("weights") or {},
        scale=fall.get("scale"),
    )


def vergleiche(faelle):
    ergebnisse = js(faelle)
    abweichungen = []
    for fall, j in zip(faelle, ergebnisse):
        p = py(fall)
        for jk, pk in FELDER.items():
            if abs(float(j[jk]) - float(p[pk])) > 1e-9:
                abweichungen.append(f"{fall.get('name', '')} {pk}: py={p[pk]} js={j[jk]} · {fall}")
    assert not abweichungen, "scoring.py und scoring.js laufen auseinander:\n" + "\n".join(abweichungen[:10])


# ─── feste Fälle (die Grenzfälle, die weh tun) ───

Q_GE = ([{"id": i, "correct_answer": "A", "niveau": ""} for i in range(1, 5)]
        + [{"id": i, "correct_answer": "A", "niveau": "E"} for i in range(5, 8)])


def test_parität_feste_faelle():
    faelle = [
        {"name": "G-Kurs, 3/4 G + 2/3 E",
         "questions": Q_GE, "answers": {"1": "A", "2": "A", "3": "A", "4": "B", "5": "A", "6": "A", "7": "B"},
         "niveau": "G", "niveau_aktiv": True},
        {"name": "E-Kurs",
         "questions": Q_GE, "answers": {"1": "A", "2": "A", "3": "A", "4": "B", "5": "A", "6": "A", "7": "A"},
         "niveau": "E", "niveau_aktiv": True},
        {"name": "voller Bonus",
         "questions": Q_GE, "answers": {"1": "A", "2": "A", "3": "A", "4": "B", "5": "A", "6": "A", "7": "A"},
         "niveau": "G", "niveau_aktiv": True},
        {"name": "alles falsch mit Minuspunkten",
         "questions": Q_GE, "answers": {str(i): "B" for i in range(1, 8)},
         "niveau": "G", "niveau_aktiv": True, "minuspunkte": True},
        {"name": "keine Abgabe", "questions": Q_GE, "answers": {}, "niveau": "G", "niveau_aktiv": True},
        {"name": "gar keine Frage", "questions": [], "answers": {}},
        {"name": "nur E-Fragen, G-Kurs (Basis leer)",
         "questions": [{"id": i, "correct_answer": "A", "niveau": "E"} for i in range(1, 4)],
         "answers": {"1": "A", "2": "A", "3": "A"}, "niveau": "G", "niveau_aktiv": True},
        # Halbe Punktzahl auf .x5 — hier trennt sich kaufmännisches Runden (JS)
        # von Bankers Rounding (Pythons round): 5,3/8 = 66,25 %.
        {"name": "66,25 % (Rundung .x5)",
         "questions": [{"id": 1, "correct_answer": "A", "niveau": ""},
                       {"id": 2, "correct_answer": "A", "niveau": ""}],
         "answers": {"1": "A", "2": "B"}, "weights": {"1": 5.3, "2": 2.7}},
        # 0,125 Punkte: round(0.125, 2) wäre in Python 0,12 — JS rundet 0,13.
        {"name": "Punkte .xx5",
         "questions": [{"id": 1, "correct_answer": "A", "niveau": ""},
                       {"id": 2, "correct_answer": "A", "niveau": ""}],
         "answers": {"1": "A"}, "weights": {"1": 0.125, "2": 1}},
        # Gewicht fehlt / ist null: beide Seiten müssen dieselbe Voreinstellung nehmen.
        {"name": "Gewicht null",
         "questions": [{"id": 1, "correct_answer": "A", "niveau": ""},
                       {"id": 2, "correct_answer": "A", "niveau": ""}],
         "answers": {"1": "A", "2": "A"}, "weights": {"1": None}},
        {"name": "Gewicht Text (Tippfehler in der Konfiguration)",
         "questions": [{"id": 1, "correct_answer": "A", "niveau": ""},
                       {"id": 2, "correct_answer": "A", "niveau": ""}],
         "answers": {"1": "A", "2": "A"}, "weights": {"1": "zwei"}},
        {"name": "Gewicht 0",
         "questions": [{"id": 1, "correct_answer": "A", "niveau": ""},
                       {"id": 2, "correct_answer": "A", "niveau": ""}],
         "answers": {"1": "A", "2": "A"}, "weights": {"1": 0, "2": 0}},
        # Frage ohne Lösung zählt nirgends mit.
        {"name": "Frage ohne Lösung",
         "questions": [{"id": 1, "correct_answer": "", "niveau": ""},
                       {"id": 2, "correct_answer": "A", "niveau": ""}],
         "answers": {"1": "A", "2": "A"}},
        # Eigener Notenschlüssel (Bonus-Deckel hängt daran).
        {"name": "eigener Schlüssel",
         "questions": Q_GE, "answers": {"1": "A", "2": "A", "3": "A", "4": "A", "5": "A", "6": "A", "7": "A"},
         "niveau": "G", "niveau_aktiv": True, "scale": {"1": 90, "2": 80, "3": 65, "4": 50, "5": 25, "6": 0}},
    ]
    vergleiche(faelle)


def test_parität_zufallsfaelle():
    """Breit gestreut — dieselben 400 Fälle durch beide Fassungen."""
    r = random.Random(20260809)
    faelle = []
    for n in range(400):
        anzahl = r.randint(1, 8)
        questions = [{"id": i + 1,
                      "correct_answer": r.choice(["A", "B", "AB", ""]),
                      "niveau": r.choice(["", "", "E"])} for i in range(anzahl)]
        answers = {str(q["id"]): r.choice(["A", "B", "C"]) for q in questions if r.random() < 0.75}
        weights = {}
        if r.random() < 0.5:
            weights = {str(q["id"]): r.choice([0.5, 1, 2, 3, 5.3, 2.7, 0.125]) for q in questions}
        scale = None
        if r.random() < 0.25:
            scale = {"1": 90, "2": 78, "3": 61, "4": 44, "5": 22, "6": 0}
        faelle.append({"name": f"zufall{n}", "questions": questions, "answers": answers,
                       "niveau": r.choice(["", "E", "G"]), "niveau_aktiv": r.random() < 0.6,
                       "minuspunkte": r.random() < 0.5, "weights": weights, "scale": scale})
    vergleiche(faelle)


def test_parität_naechste_stufe():
    faelle = [{"fn": "naechsteStufe", "pct": p, "scale": s}
              for p in (0, 19.9, 20, 44.9, 45, 59, 72.5, 73, 86.999, 87, 99.5, 100, 100.5)
              for s in (None, {"1": 90, "2": 80, "3": 65, "4": 50, "5": 25, "6": 0})]
    ergebnisse = js(faelle)
    for fall, j in zip(faelle, ergebnisse):
        p = naechste_stufe(fall["pct"], fall["scale"])
        assert abs(j - p) < 1e-9, f"naechste_stufe({fall}): py={p} js={j}"


def test_parität_status():
    faelle = [{"fn": "statusOf", "card_id": c, "has_any_scan": h, "config": cfg}
              for c in (3, 7)
              for h in (True, False)
              for cfg in (None, {}, {"krank": [3]}, {"anwesend": [3]},
                          {"krank": ["3"], "anwesend": [3]}, {"krank": [7], "anwesend": [3]})]
    ergebnisse = js(faelle)
    for fall, j in zip(faelle, ergebnisse):
        p = status_of(fall["card_id"], fall["has_any_scan"], fall["config"])
        assert j == p, f"status_of({fall}): py={p} js={j}"
