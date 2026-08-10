"""Sicherungen: enthalten sie wirklich alles, hält die Aufbewahrung, und lässt
sich das Ergebnis zurückspielen?

Die Aufgabe dieses Tests ist nicht, dass „der Knopf antwortet". Eine Sicherung,
die nie zurückgespielt wurde, ist keine — deshalb spielt der Kern dieses Tests
eine echte Sicherung in eine **Wegwerf-Datenbank** zurück und vergleicht die
Zeilen, statt sich auf Statuscodes zu verlassen.

Geprüft wird über die echten Routen (derselbe winzige ASGI-Aufruf wie in
`test_keine_lecks.py`, bewusst ohne neue Testabhängigkeit):

  * Sicherung erstellen und ihr Inhalt: Schülerdaten **und** Uploads **und**
    `config/site.json` müssen drin sein.
  * Ein normales Lehrkraft-Konto kommt an keinen einzigen Endpunkt (403).
  * Herunterladen nur für die Administration, und nur unter einem Namen, der
    dem festen Muster entspricht (kein `..`).
  * Aufbewahrung: mehr als `KEEP` Sicherungen räumt der Job selbst ab, die
    jüngste bleibt.
  * Prüfsumme: stimmt sie, und fällt eine manipulierte Datei auf?
  * Der Ablageordner liegt nicht im ausgelieferten Upload-Ordner.

Lauf:  cd apps/api && pytest tests/test_backup.py
"""
import asyncio
import json
import os
import zipfile

import pytest
import pytest_asyncio
from fastapi import Depends
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import get_db
from app.main import _global_hits, app
from app.models import Base, User
from app.routers import backup
from app.routers.auth import _buckets, get_current_user

NOTIZ = "ZZBACKUP-NOTIZ-4711"
DETAIL = "ZZBACKUP-MASSNAHME-4711"
UPLOAD_INHALT = b"ZZBACKUP-BILD-4711-bytes"


# ── Winziger ASGI-Aufruf (wie test_keine_lecks.py) ───────────────────────────
class Antwort:
    def __init__(self, status, body, headers):
        self.status, self.body, self.headers = status, body, headers

    def json(self):
        return json.loads(self.body or b"null")


async def _ruf(method, pfad, body=None, query=""):
    payload = json.dumps(body).encode() if body is not None else b""
    scope = {
        "type": "http", "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1", "method": method, "scheme": "http",
        "path": pfad, "raw_path": pfad.encode(), "query_string": query.encode(),
        "root_path": "", "client": ("127.0.0.1", 12345), "server": ("testserver", 80),
        "headers": [(b"host", b"testserver"), (b"content-type", b"application/json"),
                    (b"content-length", str(len(payload)).encode())],
    }
    gesendet = {"status": 500, "body": b"", "headers": {}}
    geschickt = False
    fertig = asyncio.Event()

    async def receive():
        nonlocal geschickt
        if not geschickt:
            geschickt = True
            return {"type": "http.request", "body": payload, "more_body": False}
        await fertig.wait()
        return {"type": "http.disconnect"}

    async def send(message):
        if message["type"] == "http.response.body" and not message.get("more_body", False):
            fertig.set()
        if message["type"] == "http.response.start":
            gesendet["status"] = message["status"]
            gesendet["headers"] = {k.decode("latin-1").lower(): v.decode("latin-1")
                                   for k, v in message.get("headers", [])}
        elif message["type"] == "http.response.body":
            gesendet["body"] += message.get("body", b"")

    await app(scope, receive, send)
    return Antwort(gesendet["status"], gesendet["body"], gesendet["headers"])


# ── Aufbau ───────────────────────────────────────────────────────────────────
@pytest_asyncio.fixture
async def welt(tmp_path, monkeypatch):
    """Eine kleine Installation samt eigenem Sicherungs-, Upload- und
    Konfigurationsordner — nichts davon zeigt auf echte Verzeichnisse."""
    sicherungen = tmp_path / "sicherungen"
    uploads = tmp_path / "uploads"
    config = tmp_path / "config"
    uploads.mkdir()
    config.mkdir()
    (uploads / "frage-4711.png").write_bytes(UPLOAD_INHALT)
    (config / "site.json").write_text(json.dumps({"betreiber": "ZZBACKUP Schule"}), encoding="utf-8")

    monkeypatch.setattr(backup, "BACKUP_DIR", str(sicherungen))
    monkeypatch.setattr(backup, "BACKUP_DIR_EXTERN", "")
    monkeypatch.setattr(backup, "UPLOAD_DIR", str(uploads))
    monkeypatch.setattr(backup, "CONFIG_DIR", str(config))
    monkeypatch.setattr(backup, "KEEP", 3)

    _buckets.clear()
    _global_hits.clear()

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'nuvora.db'}")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk_on(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Sitzung = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with Sitzung() as s:
        # Nutzer 1 ist die Administration (siehe _require_admin in main.py),
        # Nutzer 2 die ganz normale Lehrkraft, die hier nichts zu suchen hat.
        s.add(User(email="admin@test.de", password_hash="x", name="Admin", email_verified=True))
        s.add(User(email="lehrkraft@test.de", password_hash="x", name="Lehrkraft", email_verified=True))
        await s.commit()

    async def _db():
        async with Sitzung() as s:
            yield s

    zustand = {"user_id": 1}

    async def _user(db: AsyncSession = Depends(get_db)):
        return await db.get(User, zustand["user_id"])

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    try:
        r = await _ruf("POST", "/api/classes", {
            "name": "ZZ-Backup 7a",
            "students": [{
                "card_id": 1, "name": "Anna Sicher", "niveau": "G",
                "foerder": ["Dyskalkulie"],
                "massnahmen": [{"art": "Zeitzuschlag", "detail": DETAIL, "arbeit": True}],
                "notizen": NOTIZ,
            }],
        })
        assert r.status == 201, r.body[:300]
        yield {"tmp": tmp_path, "sicherungen": sicherungen, "uploads": uploads,
               "config": config, "engine": engine, "Sitzung": Sitzung,
               "zustand": zustand, "class_id": r.json()["id"]}
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


async def _sichern() -> dict:
    r = await _ruf("POST", "/api/admin/backup")
    assert r.status == 201, f"Sicherung fehlgeschlagen: {r.status} {r.body[:500]}"
    return r.json()


# ── Inhalt ───────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_sicherung_enthaelt_datenbank_uploads_und_konfiguration(welt):
    """Der Kern der Sache: eine Sicherung, die nur die Datenbank umfasst, wäre
    eine Lüge — die Frage-Bilder liegen im Dateisystem, das Impressum in
    config/site.json."""
    eintrag = await _sichern()
    pfad = welt["sicherungen"] / eintrag["name"]
    assert pfad.is_file()

    with zipfile.ZipFile(pfad) as zf:
        namen = set(zf.namelist())
        assert "manifest.json" in namen and "datenbank.ndjson" in namen
        assert "uploads/frage-4711.png" in namen, f"Upload fehlt: {sorted(namen)}"
        assert "config/site.json" in namen, "config/site.json fehlt"
        assert zf.read("uploads/frage-4711.png") == UPLOAD_INHALT

        daten = zf.read("datenbank.ndjson").decode("utf-8")
        assert "Anna Sicher" in daten, "Die Schülerdaten fehlen in der Sicherung"
        assert NOTIZ in daten and DETAIL in daten, (
            "Die besonders schützenswerten Felder (foerder/massnahmen/notizen) sind NICHT "
            "in der Sicherung — dann wäre sie beim Zurückspielen unvollständig."
        )
        manifest = json.loads(zf.read("manifest.json"))

    assert manifest["tabellen"]["students"] == 1
    assert manifest["tabellen"]["school_classes"] == 1
    assert manifest["uploads_anzahl"] == 1
    assert manifest["config"] is True
    assert manifest["enthaelt_secrets"] is False


@pytest.mark.asyncio
async def test_keine_secrets_in_der_sicherung(welt, monkeypatch):
    """Ein Schlüssel neben den Daten macht jede Verschlüsselung sinnlos — und
    die .env hat auch unverschlüsselt nichts in einer Sicherung zu suchen."""
    monkeypatch.setenv("TOKEN_SECRET", "ZZBACKUP-GEHEIM-4711")
    eintrag = await _sichern()
    with zipfile.ZipFile(welt["sicherungen"] / eintrag["name"]) as zf:
        alles = b"".join(zf.read(n) for n in zf.namelist())
        assert b"ZZBACKUP-GEHEIM-4711" not in alles
        assert not any(n.endswith(".env") or n == ".env" for n in zf.namelist())


# ── Zugriff ──────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_normales_konto_kommt_an_keinen_endpunkt(welt):
    """Sicherungen enthalten die Daten ALLER Konten. Eine Lehrkraft, die ihre
    eigene Sicherung zieht, hätte damit auch die aller anderen."""
    eintrag = await _sichern()
    welt["zustand"]["user_id"] = 2  # jetzt die normale Lehrkraft
    wege = [
        ("GET", "/api/admin/backup"),
        ("POST", "/api/admin/backup"),
        ("GET", f"/api/admin/backup/{eintrag['name']}"),
        ("POST", f"/api/admin/backup/{eintrag['name']}/pruefen"),
        ("DELETE", f"/api/admin/backup/{eintrag['name']}"),
        ("PUT", "/api/admin/backup/einstellungen"),
    ]
    offen = []
    for methode, pfad in wege:
        r = await _ruf(methode, pfad, {} if methode in ("POST", "PUT") else None)
        if r.status not in (401, 403):
            offen.append(f"{methode} {pfad} -> {r.status}")
    assert not offen, f"Ohne Administrationsrechte erreichbar: {offen}"
    # Und die Datei liegt trotzdem noch da (kein DELETE ist durchgekommen).
    assert (welt["sicherungen"] / eintrag["name"]).is_file()


@pytest.mark.asyncio
async def test_download_liefert_das_archiv_nur_der_administration(welt):
    eintrag = await _sichern()
    r = await _ruf("GET", f"/api/admin/backup/{eintrag['name']}")
    assert r.status == 200
    assert r.headers.get("content-type", "").startswith("application/zip")
    assert "no-store" in r.headers.get("cache-control", "")
    assert r.body[:2] == b"PK", "Der Download ist kein ZIP"
    assert len(r.body) == eintrag["bytes"]


@pytest.mark.asyncio
async def test_dateiname_ist_nicht_ratbar_und_nicht_manipulierbar(welt):
    """Der Name kommt aus einem festen Muster. Alles andere — Pfadwechsel,
    andere Endungen — muss abgelehnt werden, bevor irgendetwas geöffnet wird."""
    await _sichern()
    for boese in ("..%2F..%2Fetc%2Fpasswd", "nuvora-2026.zip", "beliebig.zip",
                  "nuvora-20260101-000000.zip.sha256"):
        r = await _ruf("GET", f"/api/admin/backup/{boese}")
        assert r.status in (400, 404), f"{boese} -> {r.status}"


@pytest.mark.asyncio
async def test_sicherungsordner_liegt_nicht_im_ausgelieferten_upload_ordner():
    """`/api/uploads` ist ein StaticFiles-Mount — ohne Anmeldung lesbar. Läge
    der Sicherungsordner darunter, wäre jede Sicherung ein offener Download."""
    assert not backup._liegt_in(backup.BACKUP_DIR, backup.UPLOAD_DIR)
    # Und die Sperre greift wirklich, nicht nur der Vorgabewert:
    assert backup._liegt_in("/app/uploads/backups", "/app/uploads")
    assert not backup._liegt_in("/app/uploads-woanders", "/app/uploads")


# ── Prüfsumme und Integrität ─────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_pruefsumme_stimmt_und_faellt_bei_manipulation_auf(welt):
    import hashlib

    eintrag = await _sichern()
    pfad = welt["sicherungen"] / eintrag["name"]
    echt = hashlib.sha256(pfad.read_bytes()).hexdigest()
    assert eintrag["sha256"] == echt, "Die gemeldete Prüfsumme ist nicht die der Datei"

    r = await _ruf("POST", f"/api/admin/backup/{eintrag['name']}/pruefen")
    assert r.status == 200 and r.json()["ok"] is True, r.json()
    assert r.json()["zeilen"] > 0 and r.json()["uploads_anzahl"] == 1

    # Ein Byte im Archiv kippen — die Prüfung muss das melden.
    roh = bytearray(pfad.read_bytes())
    roh[len(roh) // 2] ^= 0xFF
    pfad.write_bytes(bytes(roh))
    r = await _ruf("POST", f"/api/admin/backup/{eintrag['name']}/pruefen")
    assert r.status == 200
    assert r.json()["ok"] is False and r.json()["fehler"], (
        "Eine beschädigte Sicherung gilt als in Ordnung — dann ist die Prüfung wertlos"
    )


# ── Aufbewahrung ─────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_aufbewahrung_loescht_die_aeltesten(welt):
    """KEEP steht im Test auf 3. Die vierte Sicherung schiebt die erste raus —
    sonst läuft die Platte des Schulservers irgendwann voll."""
    namen = []
    for i in range(5):
        e = await _sichern()
        namen.append(e["name"])
        # Zeitstempel im Namen hat Sekundenauflösung; ohne Abstand gäbe es
        # denselben Namen zweimal und der Test prüfte nichts.
        _vordatieren(welt["sicherungen"], e["name"], i)

    uebrig = sorted(n for n in os.listdir(welt["sicherungen"]) if n.endswith(".zip"))
    assert len(uebrig) == 3, f"Aufbewahrung greift nicht: {uebrig}"
    assert namen[-1] in uebrig, "Die jüngste Sicherung wurde weggeräumt"
    assert namen[0] not in uebrig, "Die älteste Sicherung liegt noch da"
    # Zu jeder Sicherung gehört genau eine Prüfsummendatei, keine Waisen.
    summen = {n for n in os.listdir(welt["sicherungen"]) if n.endswith(".sha256")}
    assert summen == {n + ".sha256" for n in uebrig}


def _vordatieren(ordner, name, i):
    """Ältere Sicherungen künstlich altern lassen — die Reihenfolge hängt an
    der Änderungszeit, und fünf Läufe in derselben Sekunde hätten keine."""
    import time
    ts = time.time() - (100 - i) * 3600
    for p in (ordner / name, ordner / (name + ".sha256")):
        if p.exists():
            os.utime(p, (ts, ts))


@pytest.mark.asyncio
async def test_loeschen_entfernt_archiv_und_pruefsumme(welt):
    eintrag = await _sichern()
    r = await _ruf("DELETE", f"/api/admin/backup/{eintrag['name']}")
    assert r.status == 204
    assert not (welt["sicherungen"] / eintrag["name"]).exists()
    assert not (welt["sicherungen"] / (eintrag["name"] + ".sha256")).exists()


# ── Ziel und Zeitplan ────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_ziel_und_zeitplan_lassen_sich_waehlen(welt):
    r = await _ruf("GET", "/api/admin/backup")
    assert r.status == 200
    stand = r.json()
    assert stand["ziel"] == "lokal"
    assert {z["key"] for z in stand["ziele"]} == {"lokal", "extern"}
    assert stand["verschluesselt"] is False
    assert stand["anleitung"], "Ohne Anleitung zum Zurückspielen ist die Seite unvollständig"

    r = await _ruf("PUT", "/api/admin/backup/einstellungen", {"plan": "taeglich"})
    assert r.status == 200 and r.json()["plan"] == "taeglich"

    # Ein Ziel ohne konfigurierten Ordner darf sich nicht wählen lassen —
    # sonst zeigt die Oberfläche ein Ziel an, in das nie etwas geschrieben wird.
    r = await _ruf("PUT", "/api/admin/backup/einstellungen", {"ziel": "extern"})
    assert r.status == 400
    r = await _ruf("PUT", "/api/admin/backup/einstellungen", {"plan": "manchmal"})
    assert r.status == 400


@pytest.mark.asyncio
async def test_faelligkeit_des_zeitplans():
    from datetime import datetime, timedelta, timezone
    jetzt = datetime.now(timezone.utc)
    assert await backup._faellig("aus", "") is False
    assert await backup._faellig("taeglich", "") is True
    assert await backup._faellig("taeglich", (jetzt - timedelta(hours=2)).isoformat()) is False
    assert await backup._faellig("taeglich", (jetzt - timedelta(hours=25)).isoformat()) is True
    assert await backup._faellig("woechentlich", (jetzt - timedelta(days=3)).isoformat()) is False
    assert await backup._faellig("woechentlich", (jetzt - timedelta(days=8)).isoformat()) is True


@pytest.mark.asyncio
async def test_status_meldet_die_letzte_sicherung(welt):
    eintrag = await _sichern()
    stand = (await _ruf("GET", "/api/admin/backup")).json()
    assert stand["letzte"]["ok"] is True
    assert stand["letzte"]["name"] == eintrag["name"]
    assert stand["sicherungen"][0]["name"] == eintrag["name"]
    assert stand["belegt_bytes"] == eintrag["bytes"]


# ── Der eigentliche Beweis: zurückspielen ────────────────────────────────────
@pytest.mark.asyncio
async def test_zurueckspielen_in_eine_wegwerf_datenbank(welt):
    """Eine Sicherung, die nie zurückgespielt wurde, ist keine.

    Deshalb wird hier nicht das Archiv begutachtet, sondern eine leere
    Datenbank daraus aufgebaut — und danach Zeile für Zeile verglichen,
    inklusive der Art.-9-Felder, die JSON-Spalten und die Zeitstempel sind.
    """
    from app import models as m

    eintrag = await _sichern()
    archiv = str(welt["sicherungen"] / eintrag["name"])
    zurueck_uploads = welt["tmp"] / "wieder-uploads"

    bericht = await backup.zurueckspielen(
        archiv,
        f"sqlite+aiosqlite:///{welt['tmp'] / 'wegwerf.db'}",
        str(zurueck_uploads),
    )
    assert bericht["tabellen"]["students"] == 1
    assert bericht["tabellen"]["users"] == 2
    assert bericht["dateien"] == 1
    assert (zurueck_uploads / "frage-4711.png").read_bytes() == UPLOAD_INHALT

    probe = create_async_engine(f"sqlite+aiosqlite:///{welt['tmp'] / 'wegwerf.db'}")
    try:
        async with async_sessionmaker(probe, class_=AsyncSession)() as s:
            schueler = (await s.execute(select(m.Student))).scalars().all()
            assert len(schueler) == 1
            a = schueler[0]
            assert a.name == "Anna Sicher"
            assert a.foerder == ["Dyskalkulie"], f"JSON-Spalte kaputt: {a.foerder!r}"
            assert a.massnahmen[0]["detail"] == DETAIL
            assert a.notizen == NOTIZ
            klassen = (await s.execute(select(m.SchoolClass))).scalars().all()
            assert [k.name for k in klassen] == ["ZZ-Backup 7a"]
            assert klassen[0].created_at is not None, "Zeitstempel ging beim Zurückspielen verloren"
            nutzer = (await s.execute(select(m.User))).scalars().all()
            assert {u.email for u in nutzer} == {"admin@test.de", "lehrkraft@test.de"}
    finally:
        await probe.dispose()


@pytest.mark.asyncio
async def test_zurueckspielen_ueberschreibt_vorhandene_zeilen(welt):
    """Zweimal dieselbe Sicherung einspielen darf nicht an Schlüsselkonflikten
    scheitern — sonst ist der zweite Versuch im Ernstfall der, der scheitert."""
    eintrag = await _sichern()
    archiv = str(welt["sicherungen"] / eintrag["name"])
    url = f"sqlite+aiosqlite:///{welt['tmp'] / 'zweimal.db'}"
    erst = await backup.zurueckspielen(archiv, url)
    zweit = await backup.zurueckspielen(archiv, url)
    assert erst["zeilen"] == zweit["zeilen"] > 0


@pytest.mark.asyncio
async def test_anleitung_nennt_die_wegwerf_datenbank_zuerst():
    """Die Reihenfolge ist der Punkt: erst in eine Wegwerf-Datenbank, dann in
    die echte. Eine Anleitung, die gleich auf die Produktivdatenbank zeigt, ist
    gefährlicher als keine."""
    schritte = backup.anleitung()
    probe = next(i for i, s in enumerate(schritte) if "probe.db" in s)
    echt = next(i for i, s in enumerate(schritte) if "DATABASE_URL" in s)
    assert probe < echt
    assert any(".env" in s for s in schritte), (
        "Die Anleitung muss sagen, dass die .env NICHT in der Sicherung steckt"
    )
