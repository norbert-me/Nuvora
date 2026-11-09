"""Slopsquatting-Schutz laeuft auch lokal: kein neuer Paketname ohne Freigabe,
Lock-Dateien lueckenlos (ohne Netz; die Registry-Pruefung macht die CI)."""
import importlib.util
from pathlib import Path

SKRIPT = Path(__file__).resolve().parents[3] / "scripts" / "pruefe_abhaengigkeiten.py"


def test_abhaengigkeiten_sind_freigegeben_und_gelockt(capsys):
    spec = importlib.util.spec_from_file_location("pruefe_abhaengigkeiten", SKRIPT)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    code = modul.main(netz=False)
    assert code == 0, capsys.readouterr().out
