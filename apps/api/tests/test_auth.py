"""Anmeldung, Token und Passwort-Reset — die Stellen, an denen ein Fehler
Fremdzugriff bedeutet.

`auth.py` war die einzige sicherheitskritische Datei ohne Netz: Passwortprüfung,
Bestätigungspflicht, Einmal-Link zum Zurücksetzen, Abmeldung aller Sitzungen.
Diese Tests halten das Verhalten fest, nicht die Umsetzung — sie überleben
also auch einen Wechsel des Hash-Verfahrens.
"""
import time

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, User
from app.routers import auth as A


@pytest_asyncio.fixture
async def s():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk_on(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)() as sess:
        yield sess
    await engine.dispose()


class _Anfrage:
    """Reicht für die Endpunkte: sie lesen nur die Client-Adresse."""
    headers = {"X-Real-IP": "203.0.113.7"}
    client = None


async def _konto(s, bestaetigt=True, passwort="Geheim!2345"):
    u = User(email="lehrkraft@schule.de", password_hash=A._hash_pw(passwort),
             name="L", email_verified=bestaetigt)
    s.add(u)
    await s.commit()
    return u


# ─────────────────────────── Passwort ───────────────────────────

def test_passwort_hash_ist_gesalzen_und_prueft_richtig():
    a, b = A._hash_pw("Geheim!2345"), A._hash_pw("Geheim!2345")
    assert a != b, "gleiches Passwort muss unterschiedliche Hashes ergeben (Salt)"
    assert "Geheim" not in a, "das Passwort steht im Klartext im Hash"
    assert A._verify_pw("Geheim!2345", a)
    assert not A._verify_pw("geheim!2345", a), "Groß-/Kleinschreibung zählt"
    assert not A._verify_pw("", a)


def test_kaputter_hash_laesst_niemanden_durch():
    for kaputt in ("", "kein-dollar-zeichen", "a$b", "$$"):
        assert not A._verify_pw("Geheim!2345", kaputt)


# ─────────────────────────── Anmelden ───────────────────────────

@pytest.mark.asyncio
async def test_login_mit_falschem_passwort_scheitert(s):
    await _konto(s)
    with pytest.raises(HTTPException) as f:
        await A.login(A.LoginBody(email="lehrkraft@schule.de", password="falsch"), _Anfrage(), s)
    assert f.value.status_code == 401


@pytest.mark.asyncio
async def test_login_nennt_unbekanntes_konto_nicht_beim_namen(s):
    """Dieselbe Antwort wie bei falschem Passwort — sonst lassen sich vorhandene
    Adressen durchprobieren."""
    await _konto(s)
    with pytest.raises(HTTPException) as unbekannt:
        await A.login(A.LoginBody(email="niemand@schule.de", password="egal"), _Anfrage(), s)
    with pytest.raises(HTTPException) as falsch:
        await A.login(A.LoginBody(email="lehrkraft@schule.de", password="egal"), _Anfrage(), s)
    assert unbekannt.value.status_code == falsch.value.status_code == 401
    assert unbekannt.value.detail == falsch.value.detail


@pytest.mark.asyncio
async def test_ohne_bestaetigte_mail_kein_login(s):
    await _konto(s, bestaetigt=False)
    with pytest.raises(HTTPException) as f:
        await A.login(A.LoginBody(email="lehrkraft@schule.de", password="Geheim!2345"), _Anfrage(), s)
    assert f.value.status_code == 403


@pytest.mark.asyncio
async def test_login_liefert_ein_gueltiges_token(s):
    u = await _konto(s)
    antwort = await A.login(A.LoginBody(email="LEHRKRAFT@Schule.de", password="Geheim!2345"), _Anfrage(), s)
    assert antwort["user"]["email"] == "lehrkraft@schule.de", "Adresse wird klein geschrieben verglichen"
    geprueft = A._verify_token(antwort["token"])
    assert geprueft and geprueft[0] == u.id


# ─────────────────────────── Token ───────────────────────────

def test_verfaelschtes_token_wird_erkannt():
    echt = A._make_token(1, 0)
    assert A._verify_token(echt)
    assert not A._verify_token(echt[:-1] + ("a" if echt[-1] != "a" else "b")), "Signatur muss stimmen"
    assert not A._verify_token("1:0:0:" + "0" * 32), "gefälschte Signatur"
    assert not A._verify_token("unsinn")


def test_passwortwechsel_meldet_alte_sitzungen_ab():
    """token_version im Token muss zur Version am Konto passen — dadurch werden
    beim Zurücksetzen des Passworts alle offenen Sitzungen ungültig."""
    altes = A._verify_token(A._make_token(1, 0))
    assert altes == (1, 0, altes[2]) or altes[1] == 0
    neues = A._verify_token(A._make_token(1, 1))
    assert neues[1] == 1, "die Version steckt im Token und wird beim Prüfen verglichen"


# ─────────────────────── Passwort zurücksetzen ───────────────────────

@pytest.mark.asyncio
async def test_reset_link_funktioniert_genau_einmal(s):
    u = await _konto(s)
    token = A._make_reset_token(u)

    await A.reset_password(A.ResetPasswordBody(token=token, new_password="NeuesGeheim!9"), _Anfrage(), s)
    assert A._verify_pw("NeuesGeheim!9", u.password_hash)

    # Der Link hängt am alten Hash — nach dem Wechsel passt seine Signatur nicht mehr.
    with pytest.raises(HTTPException) as f:
        await A.reset_password(A.ResetPasswordBody(token=token, new_password="NochEins!7"), _Anfrage(), s)
    assert f.value.status_code == 400
    assert A._verify_pw("NeuesGeheim!9", u.password_hash), "das Passwort darf sich nicht erneut geändert haben"


@pytest.mark.asyncio
async def test_abgelaufener_reset_link_wird_abgelehnt(s, monkeypatch):
    u = await _konto(s)
    token = A._make_reset_token(u)
    # Eine Sekunde nach Ablauf der Stunde. Die echte Uhr vorher festhalten —
    # sonst ruft die Attrappe sich selbst auf.
    jetzt = time.time()
    monkeypatch.setattr(A.time, "time", lambda: jetzt + A.RESET_TTL + 1)
    with pytest.raises(HTTPException) as f:
        await A.reset_password(A.ResetPasswordBody(token=token, new_password="NeuesGeheim!9"), _Anfrage(), s)
    assert f.value.status_code == 400


@pytest.mark.asyncio
async def test_reset_meldet_offene_sitzungen_ab(s):
    u = await _konto(s)
    vorher = u.token_version or 0
    await A.reset_password(A.ResetPasswordBody(token=A._make_reset_token(u), new_password="NeuesGeheim!9"),
                           _Anfrage(), s)
    assert (u.token_version or 0) == vorher + 1, "sonst bliebe ein gestohlenes Token gültig"
