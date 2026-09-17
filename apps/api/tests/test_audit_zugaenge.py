"""Zugaenge nach dem Sicherheitsdurchgang vom 17.09.2026.

Jeder Test haelt einen Befund fest, der vorher offen war:

  * Passwortwechsel/-reset nimmt CalDAV-Geraete-Passwoerter und die
    Kalender-Abo-Adresse mit.
  * Serverseitiges Abmelden; Hoechstdauer eines Tokens trotz Verlaengerung.
  * Die Konto-Bremse zaehlt nur Fehlversuche (Login und CalDAV).
  * CalDAV prueft bei unbekannter Adresse gegen den Blindwert.
  * Der Link zum Adresswechsel hat eine Frist.
  * Kontoloeschung: Bilddateien nur, wenn sie ausschliesslich diesem Konto
    gehoeren; Anhang und Protokoll eigener Fehlermeldungen gehen mit.
  * Start mit Platzhalter-Passwort bricht ab.
  * WebSocket: unausgewiesene Leitungen belegen keine Plaetze.
"""
import base64
import os
import time

import pytest
from fastapi import HTTPException

from app import websocket as ws
from app.models import BugReport, CaldavToken, Question, User
from app.routers import auth as A
from app.routers import caldav as C

PW = "Geheim!2345"


@pytest.fixture(autouse=True)
def _zuruecksetzen():
    A._buckets.clear()
    A._bekannte_adressen.clear()
    yield
    A._buckets.clear()
    A._bekannte_adressen.clear()


class _Anfrage:
    def __init__(self, ip="203.0.113.7", headers=None):
        self.headers = {"X-Real-IP": ip, **(headers or {})}
        self.client = None
        self.method = "PROPFIND"
        self.url = type("U", (), {"path": "/api/caldav/"})()


async def _konto(s, email="lehrkraft@schule.de"):
    u = User(email=email, password_hash=A._hash_pw(PW), name="L", email_verified=True,
             calendar_token=f"alte-abo-adresse-{email}")
    s.add(u)
    await s.commit()
    s.add(CaldavToken(owner_id=u.id, name="iPad", token_hash=A._hash_pw("geraet-4711")))
    await s.commit()
    return u


async def _geraete(s, u):
    from sqlalchemy import func, select
    return (await s.execute(select(func.count()).select_from(CaldavToken)
                            .where(CaldavToken.owner_id == u.id))).scalar()


# ── Passwortwechsel nimmt Nebenzugaenge mit ─────────────────────────────────

@pytest.mark.asyncio
async def test_passwort_aendern_widerruft_geraete_und_abo(s):
    u = await _konto(s)
    vorher = u.token_version or 0
    antwort = await A.change_password(
        A.ChangePasswordBody(old_password=PW, new_password="Neu!Passwort99"), user=u, db=s)
    assert await _geraete(s, u) == 0, "CalDAV-Geraete-Passwort gilt nach dem Wechsel weiter"
    assert u.calendar_token and u.calendar_token != "alte-abo-adresse-lehrkraft@schule.de"
    assert u.token_version == vorher + 1
    # Die eigene Sitzung bekommt einen frischen Token.
    assert A._verify_token(antwort["token"])[1] == u.token_version


@pytest.mark.asyncio
async def test_ohne_abo_bleibt_es_ohne(s):
    u = await _konto(s)
    u.calendar_token = None
    await s.commit()
    await A.change_password(
        A.ChangePasswordBody(old_password=PW, new_password="Neu!Passwort99"), user=u, db=s)
    assert u.calendar_token is None


@pytest.mark.asyncio
async def test_zuruecksetzen_widerruft_geraete_und_abo(s):
    u = await _konto(s)
    token = A._make_reset_token(u)
    await A.reset_password(A.ResetPasswordBody(token=token, new_password="Neu!Passwort99"),
                           _Anfrage(), s)
    assert await _geraete(s, u) == 0
    assert u.calendar_token != "alte-abo-adresse-lehrkraft@schule.de"


# ── Abmelden und Hoechstdauer ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_logout_macht_den_token_wertlos(s):
    u = await _konto(s)
    alt = A._make_token(u.id, u.token_version or 0)
    await A.logout(user=u, db=s)

    class _Req:
        headers = {"Authorization": f"Bearer {alt}"}

    with pytest.raises(HTTPException) as f:
        await A.get_current_user(_Req(), type("R", (), {"headers": {}})(), s)
    assert f.value.status_code == 401


@pytest.mark.asyncio
async def test_verlaengerung_traegt_den_anmeldezeitpunkt_mit(s, monkeypatch):
    u = await _konto(s)
    jetzt = time.time()
    beginn = int(jetzt) - 60 * 86400
    # Ein Token, 20 Tage alt, aus einer Anmeldung vor 60 Tagen: wird verlaengert.
    monkeypatch.setattr(A.time, "time", lambda: jetzt - 20 * 86400)
    alt = A._make_token(u.id, u.token_version or 0, beginn)
    monkeypatch.setattr(A.time, "time", lambda: jetzt)

    antwort = type("R", (), {"headers": {}})()
    req = type("Q", (), {"headers": {"Authorization": f"Bearer {alt}"}})()
    await A.get_current_user(req, antwort, s)
    neu = antwort.headers["X-Refresh-Token"]
    assert A._token_teile(neu)[3] == beginn, "die Verlaengerung setzt die Hoechstdauer zurueck"

    # 31 Tage spaeter ist die Anmeldung 91 Tage her: Schluss, trotz frischem Token.
    monkeypatch.setattr(A.time, "time", lambda: jetzt + 31 * 86400)
    req = type("Q", (), {"headers": {"Authorization": f"Bearer {neu}"}})()
    with pytest.raises(HTTPException) as f:
        await A.get_current_user(req, type("R", (), {"headers": {}})(), s)
    assert f.value.status_code == 401


def test_alte_tokenform_bleibt_lesbar():
    payload = "1:0:1700000000"
    sig = A.hmac.new(A.SECRET.encode(), payload.encode(), "sha256").hexdigest()[:32]
    assert A._token_teile(f"{payload}:{sig}") == (1, 0, 1700000000, 1700000000)
    assert A._verify_token(f"{payload}:{sig}") == (1, 0, 1700000000)


# ── Konto-Bremse zaehlt nur Fehlversuche ────────────────────────────────────

@pytest.mark.asyncio
async def test_erfolgreiche_anmeldungen_fuellen_die_konto_bremse_nicht(s):
    await _konto(s)
    for i in range(25):
        A._buckets.pop("login:" + f"198.51.100.{i}", None)
        await A.login(A.LoginBody(email="lehrkraft@schule.de", password=PW),
                      _Anfrage(ip=f"198.51.100.{i}"), s)


@pytest.mark.asyncio
async def test_fremde_fehlversuche_sperren_die_bekannte_adresse_nicht_aus(s):
    await _konto(s)
    # Die Lehrkraft meldet sich einmal von zu Hause an.
    await A.login(A.LoginBody(email="lehrkraft@schule.de", password=PW), _Anfrage(ip="192.0.2.1"), s)
    # Ein Fremder probiert von vielen Adressen.
    for i in range(20):
        with pytest.raises(HTTPException):
            await A.login(A.LoginBody(email="lehrkraft@schule.de", password="falsch"),
                          _Anfrage(ip=f"198.51.100.{i}"), s)
    # Fremde Adresse: gesperrt (auch mit richtigem Passwort — sonst waere die
    # Bremse beim Raten wirkungslos).
    with pytest.raises(HTTPException) as f:
        await A.login(A.LoginBody(email="lehrkraft@schule.de", password=PW), _Anfrage(ip="198.51.100.99"), s)
    assert f.value.status_code == 429
    # Die bekannte Adresse kommt weiter hinein.
    antwort = await A.login(A.LoginBody(email="lehrkraft@schule.de", password=PW), _Anfrage(ip="192.0.2.1"), s)
    assert antwort["token"]


def _basic(name, pw):
    return {"authorization": "Basic " + base64.b64encode(f"{name}:{pw}".encode()).decode()}


@pytest.mark.asyncio
async def test_caldav_zaehlt_nur_fehlversuche(s):
    u = await _konto(s)
    for _ in range(40):  # mehr als die Grenze von 30 — alles richtige Anmeldungen
        A._buckets.pop("caldav_ip:203.0.113.7", None)
        assert (await C._anmelden(_Anfrage(headers=_basic(u.email, "geraet-4711")), s)).id == u.id
    for _ in range(30):
        with pytest.raises(C._Unangemeldet):
            await C._anmelden(_Anfrage(headers=_basic(u.email, "falsch")), s)
    with pytest.raises(HTTPException) as f:
        await C._anmelden(_Anfrage(headers=_basic(u.email, "geraet-4711")), s)
    assert f.value.status_code == 429


@pytest.mark.asyncio
async def test_caldav_prueft_unbekannte_adresse_gegen_den_blindwert(s, monkeypatch):
    await _konto(s)
    gerufen = []
    echt = C._verify_pw
    monkeypatch.setattr(C, "_verify_pw", lambda pw, h: gerufen.append(h) or echt(pw, h))
    with pytest.raises(C._Unangemeldet):
        await C._anmelden(_Anfrage(headers=_basic("niemand@schule.de", "x")), s)
    assert gerufen == [A._DUMMY_PW_HASH]


# ── Link zum Adresswechsel ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_adresswechsel_link_hat_eine_frist(s, monkeypatch):
    u = await _konto(s)
    u.pending_email = "neu@schule.de"
    await s.commit()
    token = A._make_email_change_token(u)
    echt = time.time
    monkeypatch.setattr(A.time, "time", lambda: echt() + A.EMAIL_CHANGE_TTL + 60)
    with pytest.raises(HTTPException) as f:
        await A.confirm_email_change(A.ConfirmEmailChangeBody(token=token), _Anfrage(), s)
    assert f.value.status_code == 400
    assert u.email == "lehrkraft@schule.de"
    monkeypatch.setattr(A.time, "time", echt)
    await A.confirm_email_change(A.ConfirmEmailChangeBody(token=token), _Anfrage(), s)
    assert u.email == "neu@schule.de"


@pytest.mark.asyncio
async def test_alter_adresswechsel_link_ohne_zeit_gilt_nicht(s):
    u = await _konto(s)
    u.pending_email = "neu@schule.de"
    await s.commit()
    sig = A.hmac.new(A.SECRET.encode(), f"emailchange:{u.id}:{u.pending_email}".encode(),
                     "sha256").hexdigest()[:32]
    alt = base64.urlsafe_b64encode(f"{u.id}:{sig}".encode()).decode().rstrip("=")
    with pytest.raises(HTTPException):
        await A.confirm_email_change(A.ConfirmEmailChangeBody(token=alt), _Anfrage(), s)


# ── Kontoloeschung ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_geteilte_bilder_bleiben_liegen(s):
    a = await _konto(s)
    b = await _konto(s, email="b@schule.de")
    namen = {k: f"{k}-4711.png" for k in ("allein", "antwort", "besitzlos")}
    for n in namen.values():
        with open(os.path.join(A.UPLOAD_DIR, n), "wb") as f:
            f.write(b"x")
    url = {k: f"/api/uploads/{n}" for k, n in namen.items()}
    s.add(Question(text="A1", owner_id=a.id, image_url=url["allein"]))
    s.add(Question(text="A2", owner_id=a.id, image_url=url["antwort"]))
    s.add(Question(text="A3", owner_id=a.id, choice_images={"A": url["besitzlos"]}))
    # Fremde Nutzung: als Antwortbild eines anderen Kontos und in einer
    # besitzlosen Bestandsfrage.
    s.add(Question(text="B1", owner_id=b.id, choice_images={"B": url["antwort"]}))
    s.add(Question(text="Alt", owner_id=None, image_url=url["besitzlos"]))
    await s.commit()

    await A._purge_user_content(s, a.id)

    da = {k: os.path.exists(os.path.join(A.UPLOAD_DIR, n)) for k, n in namen.items()}
    assert da == {"allein": False, "antwort": True, "besitzlos": True}, da


@pytest.mark.asyncio
async def test_eigene_fehlermeldungen_verlieren_anhang_und_protokoll(s):
    u = await _konto(s)
    s.add(BugReport(user_id=u.id, email=u.email, message="Knopf weg", log="GET /api/classes/{id}",
                    anhang=b"PNG", anhang_name="bild.png", anhang_typ="image/png"))
    await s.commit()
    await A._purge_user_content(s, u.id)
    await s.commit()
    from sqlalchemy import select
    from sqlalchemy.orm import undefer
    r = (await s.execute(select(BugReport).options(undefer(BugReport.anhang))
                         .execution_options(populate_existing=True))).scalar_one()
    assert (r.email, r.log, r.anhang, r.anhang_name) == ("", "", None, "")
    assert r.message == "Knopf weg", "der Meldungstext bleibt fuer die Bearbeitung"


# ── Start mit Platzhalter ───────────────────────────────────────────────────

def test_platzhalter_passwort_bricht_den_start_ab():
    from app.main import admin_passwort_pruefen
    for schlecht in ("bitte-aendern", "BITTE-AENDERN", "kurz!1"):
        with pytest.raises(SystemExit):
            admin_passwort_pruefen(schlecht)
    admin_passwort_pruefen("")  # leer: kein Konto anlegen, erlaubt
    admin_passwort_pruefen("ein-langes-eigenes-Passwort")


# ── WebSocket ───────────────────────────────────────────────────────────────

class _Ws:
    def __init__(self):
        self.zu = None

    async def accept(self):
        pass

    async def close(self, code=1000):
        self.zu = code


@pytest.mark.asyncio
async def test_unausgewiesene_leitungen_belegen_keine_plaetze():
    sid = 98765
    leitungen = []
    try:
        # Die Flut: nur MAX_WARTEND_JE_SITZUNG kommen ueberhaupt herein.
        for _ in range(ws.MAX_WARTEND_JE_SITZUNG + 5):
            w = _Ws()
            if await ws.connect(sid, w):
                leitungen.append(w)
            else:
                assert w.zu == 1013
        assert len(leitungen) == ws.MAX_WARTEND_JE_SITZUNG
        # Sie gehen wieder (Frist abgelaufen) — der Host kommt trotzdem hinein.
        for w in leitungen:
            ws.disconnect(sid, w)
        leitungen.clear()
        host = _Ws()
        assert await ws.connect(sid, host)
        assert ws.freigeben(host, sid)
        leitungen.append(host)
        # Die Obergrenze zaehlt nur Ausgewiesene.
        for _ in range(ws.MAX_CONNECTIONS_PER_SESSION - 1):
            w = _Ws()
            assert await ws.connect(sid, w)
            assert ws.freigeben(w, sid)
            leitungen.append(w)
        zuviel = _Ws()
        assert await ws.connect(sid, zuviel)
        leitungen.append(zuviel)
        assert not ws.freigeben(zuviel, sid)
    finally:
        for w in leitungen:
            ws.disconnect(sid, w)
    assert sid not in ws.connections and not ws._wartend
