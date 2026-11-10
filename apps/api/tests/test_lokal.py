"""Lokale Installation (eingebaute App): die API liefert die Oberflaeche selbst aus."""
import pytest
from fastapi import FastAPI

from app import lokal


class _Antwort:
    def __init__(self, status, kopf, body):
        self.status_code, self.headers, self.content = status, kopf, body
        self.text = body.decode("utf-8", "replace")

    def json(self):
        import json
        return json.loads(self.content)


class _Client:
    """Roher ASGI-Aufruf — httpx/TestClient sind hier nicht installiert."""
    def __init__(self, app):
        self.app = app

    def get(self, pfad):
        import asyncio

        async def lauf():
            teile, aus = [], {}
            async def empfang():
                return {"type": "http.request", "body": b"", "more_body": False}
            async def senden(m):
                if m["type"] == "http.response.start":
                    aus["status"] = m["status"]
                    aus["kopf"] = {k.decode(): v.decode() for k, v in m["headers"]}
                elif m["type"] == "http.response.body":
                    teile.append(m.get("body", b""))
            scope = {"type": "http", "method": "GET", "path": pfad, "raw_path": pfad.encode(), "query_string": b"",
                     "headers": [], "http_version": "1.1", "scheme": "http", "server": ("t", 80), "client": ("c", 1), "root_path": ""}
            await self.app(scope, empfang, senden)
            return _Antwort(aus["status"], aus["kopf"], b"".join(teile))
        return asyncio.run(lauf())


@pytest.fixture
def client(tmp_path, monkeypatch):
    web = tmp_path / "web"
    (web / "assets").mkdir(parents=True)
    (web / "index.html").write_text("<html>start</html>")
    (web / "sw.js").write_text("//sw")
    (web / "assets" / "a.js").write_text("//a")
    (tmp_path / "geheim.txt").write_text("nicht ausliefern")
    monkeypatch.setattr(lokal, "LOKAL", True)
    monkeypatch.setattr(lokal, "WEB_DIR", web)
    app = FastAPI()

    @app.get("/api/ping")
    async def ping():
        return {"ok": True}

    lokal.einhaengen(app)
    return _Client(app)


def test_start_und_seitenroute_liefern_die_oberflaeche(client):
    assert "start" in client.get("/").text
    assert "start" in client.get("/kurse").text          # Route der Oberflaeche


def test_api_hat_vorrang_und_unbekanntes_ist_404(client):
    assert client.get("/api/ping").json() == {"ok": True}
    assert client.get("/api/gibtsnicht").status_code == 404


def test_fehlende_datei_ist_404_nicht_die_startseite(client):
    assert client.get("/assets/fehlt.js").status_code == 404


def test_nicht_aus_dem_web_ordner_heraus(client):
    assert client.get("/%2E%2E/geheim.txt").status_code == 404
    assert client.get("/../geheim.txt").status_code == 404


def test_zwischenspeicher_regeln(client):
    assert client.get("/sw.js").headers["cache-control"] == "no-cache"
    assert "immutable" in client.get("/assets/a.js").headers["cache-control"]


def test_ohne_lokal_nichts_eingehaengt(tmp_path, monkeypatch):
    monkeypatch.setattr(lokal, "LOKAL", False)
    app = FastAPI()
    lokal.einhaengen(app)
    assert _Client(app).get("/").status_code == 404
