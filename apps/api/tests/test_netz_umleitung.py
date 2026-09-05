"""Weiterleitungen: mitgehen, aber jedes Ziel neu pruefen.

Sie ganz zu verbieten war der erste Anlauf — iCloud, Google und WebUntis
antworten auf ihre Kalender-Adressen aber regelmaessig mit 302, und der Abruf
starb mit "HTTP Error 302: Found". Ihnen blind zu folgen waere das Loch, das der
SSRF-Schutz stopfen soll.
"""
import urllib.error

import pytest

from app import netz


class _Kopf(dict):
    def get(self, k, d=None):
        return dict.get(self, k, d)


def _umleitung(nach, code=302):
    return urllib.error.HTTPError("http://alt", code, "Found", _Kopf({"Location": nach}), None)


def test_folgt_bis_zum_ziel(monkeypatch):
    gesehen = []

    def fake(url, **kw):
        gesehen.append(url)
        if url == "https://a.example/kal":
            raise _umleitung("https://b.example/echt.ics")
        return "BEGIN:VCALENDAR"

    monkeypatch.setattr(netz, "hole", fake)
    assert netz.hole_mit_umleitung("https://a.example/kal") == "BEGIN:VCALENDAR"
    assert gesehen == ["https://a.example/kal", "https://b.example/echt.ics"]


def test_ziel_der_umleitung_wird_wieder_geprueft(monkeypatch):
    """Der Schutz greift beim ZWEITEN Aufruf — genau darum geht die Umleitung
    durch `hole()` und nicht durch urllibs eigenen Handler."""
    def fake(url, **kw):
        if url.startswith("https://harmlos"):
            raise _umleitung("http://169.254.169.254/latest/meta-data/")
        raise netz.NetzFehler("Ziel-IP nicht erlaubt")

    monkeypatch.setattr(netz, "hole", fake)
    with pytest.raises(netz.NetzFehler):
        netz.hole_mit_umleitung("https://harmlos.example/kal")


def test_schleife_endet(monkeypatch):
    monkeypatch.setattr(netz, "hole", lambda url, **kw: (_ for _ in ()).throw(_umleitung(url)))
    with pytest.raises(netz.NetzFehler):
        netz.hole_mit_umleitung("https://ring.example/kal")


def test_andere_fehler_bleiben_fehler(monkeypatch):
    def fake(url, **kw):
        raise urllib.error.HTTPError(url, 404, "Not Found", _Kopf(), None)

    monkeypatch.setattr(netz, "hole", fake)
    with pytest.raises(urllib.error.HTTPError):
        netz.hole_mit_umleitung("https://a.example/weg.ics")
