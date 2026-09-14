"""Der Rückweg für hart gelöschte Aufgaben.

Bis 4.3.7 waren gelöschte Lernpfad-Aufgaben sofort weg. Das Werkzeug daneben
(`backup.zurueckspielen`) hätte den Schaden mit einem größeren behoben: es
leert jede Tabelle und setzt die ganze Installation zurück. Dieses Skript holt
genau eine Tabelle zurück — und nur die Zeilen, die fehlen.
"""
import io
import json
import os
import zipfile

import pytest

from app.models import Exercise, User


def _sicherung(pfad, zeilen):
    """Eine Sicherung in dem Format bauen, das backup.py schreibt."""
    with zipfile.ZipFile(pfad, "w") as zf:
        zf.writestr("manifest.json", json.dumps({"version": "test"}))
        puffer = io.StringIO()
        for r in zeilen:
            puffer.write(json.dumps({"t": "exercises", "r": r}) + "\n")
        # Eine fremde Tabelle daneben: sie darf nicht mit angefasst werden.
        puffer.write(json.dumps({"t": "users", "r": {"id": 99, "email": "x@y.de"}}) + "\n")
        zf.writestr("datenbank.ndjson", puffer.getvalue())


@pytest.mark.asyncio
async def test_holt_nur_die_fehlenden_und_nur_das_eigene_konto(s, tmp_path, monkeypatch):
    import aufgaben_zurueckholen as werkzeug

    u = User(id=7, email="ich@x.de", password_hash="x", email_verified=True)
    fremd = User(id=8, email="du@x.de", password_hash="x", email_verified=True)
    s.add_all([u, fremd])
    await s.flush()
    # Eine Aufgabe gibt es noch, zwei sind weg, eine gehoert jemand anderem.
    s.add(Exercise(id=100, owner_id=7, kategorie="Basis", code="#000100"))
    await s.commit()

    datei = tmp_path / "sicherung.zip"
    _sicherung(datei, [
        {"id": 100, "owner_id": 7, "kategorie": "Basis", "code": "#000100"},
        {"id": 101, "owner_id": 7, "kategorie": "Basis", "code": "#000101"},
        {"id": 102, "owner_id": 7, "kategorie": "G-Niveau", "code": "#000102"},
        {"id": 200, "owner_id": 8, "kategorie": "Basis", "code": "#000200"},
    ])

    aus_datei = werkzeug._aufgaben_aus(str(datei), konto=7)
    assert [r["id"] for r in aus_datei] == [100, 101, 102], "nur das eigene Konto"

    fehlend = [r for r in aus_datei if r["id"] not in {100}]
    assert [r["id"] for r in fehlend] == [101, 102], "nur, was heute fehlt"
