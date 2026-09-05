"""Die ladbaren Apps: welche Datei gehoert zu welcher Plattform.

Die Zuordnung ist die ganze Logik — ein macOS-Build fuer Apple Silicon und
einer fuer Intel unterscheiden sich nur im Dateinamen. Faellt sie falsch aus,
laedt jemand die Datei, die auf seinem Rechner nicht startet.
"""
import json

import pytest

import app.main as M


ANTWORT = json.dumps([
    {"draft": True, "tag_name": "v9.9.9", "assets": [{"name": "Nuvora-9.9.9.dmg", "browser_download_url": "u", "size": 1}]},
    {"prerelease": True, "tag_name": "v4.2.0-beta", "assets": []},
    {"tag_name": "v4.1.8", "html_url": "https://example.com/rel", "assets": [
        {"name": "Nuvora-4.1.8-arm64.dmg", "browser_download_url": "https://x/arm.dmg", "size": 104857600},
        {"name": "Nuvora-4.1.8.dmg", "browser_download_url": "https://x/intel.dmg", "size": 110000000},
        {"name": "nuvora-sbom.cyclonedx.json", "browser_download_url": "https://x/sbom", "size": 5},
    ]},
])


def test_zuordnung_der_dateien(monkeypatch):
    monkeypatch.setattr("app.netz.hole", lambda *a, **k: ANTWORT)
    d = M._fetch_apps()
    assert d["version"] == "4.1.8"
    assert d["dateien"]["mac_arm"]["url"] == "https://x/arm.dmg"
    assert d["dateien"]["mac_intel"]["url"] == "https://x/intel.dmg"
    # Entwuerfe und Vorabfassungen zaehlen nicht, und der SBOM ist keine App.
    assert set(d["dateien"]) == {"mac_arm", "mac_intel"}


@pytest.mark.asyncio
async def test_plattformen_ohne_datei_bleiben_sichtbar(monkeypatch):
    """Windows, Android und iPhone haben (noch) keine Datei — und stehen
    trotzdem in der Liste: die Seite soll auch „noch nicht" beantworten."""
    monkeypatch.setattr("app.netz.hole", lambda *a, **k: ANTWORT)
    M._apps_cache["daten"] = None
    M._apps_cache["ts"] = 0.0
    out = await M.apps(user=object())
    keys = [p["key"] for p in out["plattformen"]]
    assert keys == ["mac_arm", "mac_intel", "windows", "linux", "android", "ios"]
    ohne = [p["key"] for p in out["plattformen"] if not p["datei"]]
    assert ohne == ["windows", "linux", "android", "ios"]
