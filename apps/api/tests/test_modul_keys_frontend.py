"""Modul-Schluessel im Frontend muessen es im REGISTRY wirklich geben.

Ein Tippfehler in `aktiv("noten")` wirft keinen Fehler — die Abfrage liefert
einfach immer false, das Feature verschwindet aus der Oberflaeche und niemand
merkt es. Genau so waren vier Verknuepfungen monatelang tot:

  - Karten-Meisterung als Notenspalte      ("noten" statt "auswertung")
  - CardVote-Ergebnis als Notenspalte      ("noten")
  - Note im Elternkontakt                  ("noten")
  - Code-Detektiv-Import ins Notenbuch     ("codedetektiv" statt "code-detektiv")

Dieser Test vergleicht drei Listen, die zusammengehoeren: REGISTRY (Backend),
MODUL_KEYS (core/modules.js) und jeden Schluessel, mit dem eine Seite
tatsaechlich fragt.
"""
import pathlib
import re

from app.routers.modules import REGISTRY

WEB = pathlib.Path(__file__).resolve().parents[3] / "apps" / "web" / "src"
REGISTRY_KEYS = {m.key for m in REGISTRY}


def _modul_keys_js() -> set:
    """MODUL_KEYS aus core/modules.js lesen."""
    quelle = (WEB / "core" / "modules.js").read_text()
    block = re.search(r"export const MODUL_KEYS = \[(.*?)\];", quelle, re.S)
    assert block, "MODUL_KEYS nicht in core/modules.js gefunden"
    return set(re.findall(r'"([a-z-]+)"', block.group(1)))


def _abgefragte_keys() -> dict:
    """Jeder Aufruf aktiv("…") in den Seiten, mit Fundort."""
    treffer = {}
    for datei in list(WEB.rglob("*.jsx")) + list(WEB.rglob("*.js")):
        for key in re.findall(r'\baktiv\("([a-z-]+)"\)', datei.read_text()):
            treffer.setdefault(key, []).append(datei.name)
    return treffer


def test_modul_keys_js_deckt_sich_mit_registry():
    js = _modul_keys_js()
    assert js == REGISTRY_KEYS, (
        f"MODUL_KEYS (core/modules.js) und REGISTRY laufen auseinander — "
        f"nur im Frontend: {sorted(js - REGISTRY_KEYS)}, nur im Backend: {sorted(REGISTRY_KEYS - js)}"
    )


def test_jede_abfrage_nennt_ein_echtes_modul():
    unbekannt = {k: v for k, v in _abgefragte_keys().items() if k not in REGISTRY_KEYS}
    assert not unbekannt, (
        "aktiv() fragt nach Modulen, die es nicht gibt (die Abfrage ist damit immer false): "
        + ", ".join(f"{k} in {', '.join(sorted(set(v)))}" for k, v in unbekannt.items())
    )
