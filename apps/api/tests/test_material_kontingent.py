"""Ablage je Konto: ohne Angabe keine Grenze, mit MATERIAL_QUOTA_MB eine."""
from app.routers.material import _quota_bytes


def test_ohne_angabe_keine_grenze(monkeypatch):
    monkeypatch.delenv("MATERIAL_QUOTA_MB", raising=False)
    assert _quota_bytes() == 0
    monkeypatch.setenv("MATERIAL_QUOTA_MB", "")
    assert _quota_bytes() == 0


def test_mit_angabe_gilt_sie(monkeypatch):
    monkeypatch.setenv("MATERIAL_QUOTA_MB", "200")
    assert _quota_bytes() == 200 * 1024 * 1024


def test_unsinn_heisst_keine_grenze(monkeypatch):
    monkeypatch.setenv("MATERIAL_QUOTA_MB", "viel")
    assert _quota_bytes() == 0
    monkeypatch.setenv("MATERIAL_QUOTA_MB", "-5")
    assert _quota_bytes() == 0
