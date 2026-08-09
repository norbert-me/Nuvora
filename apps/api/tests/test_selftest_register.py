"""Der Selbsttest muss jedes Modul kennen — sonst prueft er es nicht.

Ein Modul entsteht an drei Stellen: REGISTRY (Modulregister), MODUL_PREFIX
(Router-Gegenprobe im Server) und PROBEN (Schreib-Roundtrip im Deploy-Skript).
Wer nur die erste pflegt, bekommt ein Modul, von dem nach dem Deploy niemand
weiss, ob es laeuft. Dieser Test haelt die drei zusammen — ohne laufenden
Server, damit er im normalen Testlauf mitkommt.
"""
import ast
import pathlib

from app.routers.modules import REGISTRY
from app.routers.selftest import MODUL_PREFIX

SKRIPT = pathlib.Path(__file__).resolve().parents[3] / "scripts" / "selftest.py"


def _proben_schluessel() -> set:
    """PROBEN aus scripts/selftest.py lesen, ohne es zu importieren."""
    baum = ast.parse(SKRIPT.read_text())
    for knoten in baum.body:
        if isinstance(knoten, ast.Assign) and any(
            getattr(z, "id", "") == "PROBEN" for z in knoten.targets
        ):
            return {k.value for k in knoten.value.keys}
    raise AssertionError("PROBEN nicht in scripts/selftest.py gefunden")


def test_jedes_modul_hat_einen_router_eintrag():
    fehlend = [m.key for m in REGISTRY if m.key not in MODUL_PREFIX]
    assert not fehlend, f"ohne Eintrag in MODUL_PREFIX (selftest.py): {fehlend}"


def test_jedes_modul_hat_eine_probe():
    proben = _proben_schluessel()
    fehlend = [m.key for m in REGISTRY if m.key not in proben]
    assert not fehlend, f"ohne Probe in scripts/selftest.py: {fehlend}"


def test_keine_probe_ohne_modul():
    schluessel = {m.key for m in REGISTRY}
    verwaist = [k for k in _proben_schluessel() if k not in schluessel]
    assert not verwaist, f"Probe fuer ein Modul, das es nicht mehr gibt: {verwaist}"
