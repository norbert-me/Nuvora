"""Der Selbsttest muss jedes Modul kennen — sonst prueft er es nicht.

Ein Modul entsteht an fuenf Stellen: REGISTRY (Modulregister), MODUL_PREFIX
(Router-Gegenprobe im Server), PROBEN (Schreib-Roundtrip) sowie im Systemtest
endpunkte() und tore() (allein lauffaehig / fuer alle anderen gesperrt).
Wer nur die erste pflegt, bekommt ein Modul, von dem nach dem Deploy niemand
weiss, ob es laeuft. Dieser Test haelt sie zusammen — ohne laufenden
Server, damit er im normalen Testlauf mitkommt.

Die Oberflaeche braucht keinen Eintrag: scripts/systemtest-browser.mjs zaehlt
die Module zur Laufzeit aus /api/modules durch, ein neues ist dort automatisch
dabei.
"""
import ast
import pathlib

from app.routers.modules import REGISTRY
from app.routers.selftest import MODUL_PREFIX

SKRIPT = pathlib.Path(__file__).resolve().parents[3] / "scripts" / "selftest.py"
SYSTEM = pathlib.Path(__file__).resolve().parents[3] / "scripts" / "systemtest.py"


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


def _system_schluessel(name: str) -> set:
    """Schluessel aus einem dict-Literal in scripts/systemtest.py lesen.

    `endpunkte(u)` und `tore(u)` bauen ihr dict aus u — darum wird der Quelltext
    gelesen und nicht importiert (das braeuchte einen laufenden Server).
    """
    baum = ast.parse(SYSTEM.read_text())
    for knoten in ast.walk(baum):
        if isinstance(knoten, ast.FunctionDef) and knoten.name == name:
            for d in ast.walk(knoten):
                if isinstance(d, ast.Dict):
                    return {k.value for k in d.keys if isinstance(k, ast.Constant)}
        if isinstance(knoten, ast.Assign) and any(getattr(z, "id", "") == name for z in knoten.targets):
            if isinstance(knoten.value, ast.Dict):
                return {k.value for k in knoten.value.keys if isinstance(k, ast.Constant)}
    raise AssertionError(f"{name} nicht in scripts/systemtest.py gefunden")


def test_jedes_modul_wird_allein_geprueft():
    """Ohne Eintrag in endpunkte() laeuft das Modul im Systemtest nie allein —
    niemand merkt, wenn es ein anderes Modul voraussetzt."""
    fehlend = [m.key for m in REGISTRY if m.key not in _system_schluessel("endpunkte")]
    assert not fehlend, f"ohne Eintrag in endpunkte() (scripts/systemtest.py): {fehlend}"


def test_jedes_modul_wird_auch_als_fremdes_geprueft():
    """Ohne Eintrag in tore() wird nie geprueft, ob dieses Modul abweist,
    solange es abgeschaltet ist — genau so blieb CardVote jahrelang offen."""
    fehlend = [m.key for m in REGISTRY if m.key not in _system_schluessel("tore")]
    assert not fehlend, f"ohne Eintrag in tore() (scripts/systemtest.py): {fehlend}"


def test_jedes_modul_legt_inhalt_an():
    """Ohne Eintrag in INHALT wird nur geschaut, ob Endpunkte antworten — nicht,
    ob wirklich etwas gespeichert und wiedergefunden wird."""
    fehlend = [m.key for m in REGISTRY if m.key not in _system_schluessel("INHALT")]
    assert not fehlend, f"ohne Eintrag in INHALT (scripts/systemtest.py): {fehlend}"
