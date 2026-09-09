"""Paritätstest: app/routers/scan_image.py gegen apps/web/src/cardvote/aruco.js.

Die Kartenerkennung läuft seit dem Umbau im Browser (opencv.js); der Server
bleibt der Rückfall, wenn das WebAssembly nicht startet — altes Gerät, zu wenig
Speicher. Damit steht die Rechnung von Drehwinkel zu Antwort DOPPELT, und läuft
eine Seite anders, bekommt dieselbe hochgehaltene Karte je nach Gerät eine
andere Antwort. Dieselbe Lage wie bei scoring.py / scoring.js, deshalb derselbe
Test: BEIDE Seiten bekommen dieselben Fälle, die JS-Seite wird dabei im Original
über node geladen, nicht nachgebaut.

Zusätzlich prüft dieser Test die Kanten bei 45/135/225/315° direkt — dort
viertelt answer_from_angle den Kreis, und genau dort ist eine Abweichung
zwischen den beiden Fassungen am teuersten.

Ohne node wird übersprungen (der Test darf keine Umgebung erzwingen).

Lauf:  cd apps/api && pytest tests/test_aruco_parity.py
"""
import json
import math
import os
import random
import shutil
import subprocess
import tempfile

import pytest

from app.routers.scan_image import angle_from_corners, answer_from_angle, zuversicht

import numpy as np

HIER = os.path.dirname(os.path.abspath(__file__))
TREIBER = os.path.join(HIER, "aruco_parity.mjs")
NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(NODE is None, reason="node nicht verfügbar")

# Die Kanten, an denen der Kreis geviertelt wird — plus je ein Wert davor und
# dahinter. Vier Antworten auf 360 Grad heissen vier Grenzen; sie lassen sich
# nicht wegkonstruieren, nur an beiden Stellen gleich ziehen.
KANTEN = [45.0, 135.0, 225.0, 315.0, -45.0, -135.0]
GRADE = (
    [0.0, 90.0, 180.0, 270.0, 360.0, -360.0, 720.0]
    + KANTEN
    + [k + d for k in KANTEN for d in (-1.0, -0.001, 0.001, 1.0)]
    + [1.0, 5.0, 10.0, 30.0, 44.0, 46.0, 100.0, 179.5, -0.5, -179.9]
)


def js(faelle):
    """Dieselben Fälle durch die echte aruco.js schicken."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump(faelle, fh)
        pfad = fh.name
    try:
        p = subprocess.run([NODE, TREIBER, pfad], capture_output=True, text=True, timeout=60)
    finally:
        os.unlink(pfad)
    assert p.returncode == 0, f"node-Treiber gescheitert:\n{p.stderr}"
    return json.loads(p.stdout)


def test_antwort_und_zuversicht_sind_auf_beiden_seiten_gleich():
    zufall = random.Random(20260908)
    grade = list(GRADE) + [zufall.uniform(-720, 720) for _ in range(500)]
    ergebnisse = js([{"fn": "antwort", "grad": g} for g in grade])

    abweichungen = []
    for grad, drueben in zip(grade, ergebnisse):
        hier = {"antwort": answer_from_angle(grad), "zuversicht": zuversicht(grad)}
        if hier != drueben:
            abweichungen.append(f"{grad:.6f}°: Server {hier} ≠ Browser {drueben}")
    assert not abweichungen, "\n".join(abweichungen[:20])


def test_die_kanten_liegen_bei_beiden_an_derselben_stelle():
    """Ausdrücklich, nicht nur als Teil des Rauschens: hier springt die Antwort."""
    ergebnisse = js([{"fn": "antwort", "grad": g} for g in KANTEN])
    for grad, drueben in zip(KANTEN, ergebnisse):
        assert drueben["antwort"] == answer_from_angle(grad), f"Kante {grad}°"
        assert drueben["zuversicht"] == 0.0 == zuversicht(grad), (
            f"an der Kante ist die Karte maximal mehrdeutig — {grad}°"
        )


def _ecken(drehung_grad: float, groesse: float = 100.0, mx: float = 500.0, my: float = 300.0):
    """Vier Ecken eines um θ gedrehten Markers (TL, TR, BR, BL, Bildkoordinaten)."""
    r = math.radians(drehung_grad)
    h = groesse / 2
    return [
        [mx + x * math.cos(r) - y * math.sin(r), my + x * math.sin(r) + y * math.cos(r)]
        for x, y in ((-h, -h), (h, -h), (h, h), (-h, h))
    ]


def test_der_winkel_aus_den_ecken_ist_auf_beiden_seiten_gleich():
    zufall = random.Random(4711)
    lagen = [
        _ecken(zufall.uniform(-180, 180), zufall.uniform(12, 400),
               zufall.uniform(0, 1280), zufall.uniform(0, 720))
        for _ in range(200)
    ] + [_ecken(g) for g in (0, 45, 90, 135, 180, -45, -90, -135)]

    ergebnisse = js([{"fn": "winkel", "ecken": e} for e in lagen])
    for ecken, drueben in zip(lagen, ergebnisse):
        hier = angle_from_corners(np.array(ecken, dtype=float))
        # Gleitkomma: dieselbe Rechnung in zwei Sprachen darf sich in der
        # letzten Stelle unterscheiden — die ABGELEITETEN Werte (Antwort,
        # Zuversicht) müssen dagegen exakt gleich sein, und das prüft der Test
        # oben.
        assert hier == pytest.approx(drueben, abs=1e-9), f"{ecken}"
        assert answer_from_angle(hier) == answer_from_angle(drueben)
