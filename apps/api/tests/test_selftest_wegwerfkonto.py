"""Wegwerf-Konto je Testlauf (POST/DELETE /api/selftest/konto).

Die Tuer ist allein das SELFTEST_TOKEN, und geloescht wird nur, was genau dem
Muster `selftest-<16 hex>@selftest.invalid` folgt — nie ein echtes Konto, nie
die Administration.
"""
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import select
from starlette.requests import Request

from app.models import User, UserModule
from app.routers import auth
from app.routers import selftest as st
from app.routers.auth import _verify_pw
from app.routers.modules import REGISTRY

TOKEN = "t" * 48


def _req(token=None, ip="10.9.8.7"):
    kopfe = [(b"x-real-ip", ip.encode())]
    if token is not None:
        kopfe.append((b"x-selftest-token", token.encode()))
    return Request({"type": "http", "method": "POST", "path": "/", "headers": kopfe,
                    "query_string": b"", "client": (ip, 1)})


@pytest_asyncio.fixture(autouse=True)
async def _erstes_konto(db):
    """Konto 1 ist immer die Administration — in jeder echten Installation
    gibt es es, bevor ein Testlauf ein Konto anlegt."""
    db.add(User(id=1, email="admin@schule.de", password_hash="x", email_verified=True))
    await db.commit()


@pytest.fixture(autouse=True)
def _umgebung(monkeypatch):
    monkeypatch.setenv("SELFTEST_TOKEN", TOKEN)
    auth._buckets.clear()
    yield
    auth._buckets.clear()


@pytest.mark.asyncio
@pytest.mark.parametrize("token", [None, "", "falsch", TOKEN + "x"])
async def test_ohne_oder_mit_falschem_token_abgewiesen(db, token):
    with pytest.raises(HTTPException) as e:
        await st.wegwerf_konto_anlegen(_req(token), None, db)
    assert e.value.status_code in (401, 403)
    with pytest.raises(HTTPException) as e:
        await st.wegwerf_konto_loeschen("selftest-0123456789abcdef@selftest.invalid", _req(token), db)
    assert e.value.status_code in (401, 403)
    assert len((await db.execute(select(User))).scalars().all()) == 1


@pytest.mark.asyncio
async def test_ohne_token_auf_dem_server_immer_zu(db, monkeypatch):
    monkeypatch.delenv("SELFTEST_TOKEN", raising=False)
    for token in (None, ""):
        with pytest.raises(HTTPException) as e:
            await st.wegwerf_konto_anlegen(_req(token), None, db)
        assert e.value.status_code == 403


@pytest.mark.asyncio
async def test_konto_ist_bestaetigt_kein_admin_alle_module(db):
    out = await st.wegwerf_konto_anlegen(_req(TOKEN), None, db)
    assert st.ist_wegwerf_adresse(out.email)
    u = (await db.execute(select(User).where(User.email == out.email))).scalar_one()
    assert u.email_verified is True
    assert u.is_admin is False
    assert u.changelog_seen
    assert "kern" in (u.tours_done or [])
    assert _verify_pw(out.passwort, u.password_hash)
    keys = set((await db.execute(select(UserModule.module_key).where(
        UserModule.user_id == u.id))).scalars().all())
    assert keys == {m.key for m in REGISTRY if m.available}


@pytest.mark.asyncio
async def test_loeschen_tilgt_das_konto(db):
    out = await st.wegwerf_konto_anlegen(_req(TOKEN), None, db)
    r = await st.wegwerf_konto_loeschen(out.email.upper(), _req(TOKEN), db)
    assert r["ok"]
    assert (await db.execute(select(User).where(User.email == out.email))).scalar_one_or_none() is None
    assert (await db.execute(select(UserModule))).scalars().all() == []
    with pytest.raises(HTTPException) as e:
        await st.wegwerf_konto_loeschen(out.email, _req(TOKEN), db)
    assert e.value.status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("email", [
    "lehrerin@schule.de",
    "selftest-0123456789abcdef@selftest.invalid.de",
    "selftest-0123456789abcdef@example.invalid",
    "selftest-%@selftest.invalid",
    "xselftest-0123456789abcdef@selftest.invalid",
    "selftest-0123456789ABCDEG@selftest.invalid",
])
async def test_fremde_muster_werden_abgewiesen(db, email):
    db.add(User(email=email.lower(), password_hash="x", email_verified=True))
    await db.commit()
    with pytest.raises(HTTPException) as e:
        await st.wegwerf_konto_loeschen(email, _req(TOKEN), db)
    assert e.value.status_code == 400
    assert len((await db.execute(select(User))).scalars().all()) == 2


@pytest.mark.asyncio
async def test_admin_mit_passendem_muster_bleibt(db):
    email = "selftest-0123456789abcdef@selftest.invalid"
    db.add(User(email=email, password_hash="x", email_verified=True, is_admin=True))
    await db.commit()
    with pytest.raises(HTTPException) as e:
        await st.wegwerf_konto_loeschen(email, _req(TOKEN), db)
    assert e.value.status_code == 400


@pytest.mark.asyncio
async def test_verwaiste_konten_werden_beim_anlegen_abgeraeumt(db):
    alt = datetime.now(timezone.utc) - timedelta(days=2)
    frisch = datetime.now(timezone.utc) - timedelta(hours=1)
    db.add_all([
        User(email="selftest-aaaaaaaaaaaaaaaa@selftest.invalid", password_hash="x", created_at=alt),
        User(email="selftest-bbbbbbbbbbbbbbbb@selftest.invalid", password_hash="x", created_at=frisch),
        # Passt nur auf das LIKE, nicht auf das Muster — bleibt.
        User(email="selftest-zz@selftest.invalid", password_hash="x", created_at=alt),
        User(email="echt@schule.de", password_hash="x", created_at=alt),
    ])
    await db.commit()
    out = await st.wegwerf_konto_anlegen(_req(TOKEN), None, db)
    assert out.verwaiste_geloescht == 1
    rest = set((await db.execute(select(User.email))).scalars().all())
    assert "selftest-aaaaaaaaaaaaaaaa@selftest.invalid" not in rest
    assert {"selftest-bbbbbbbbbbbbbbbb@selftest.invalid", "selftest-zz@selftest.invalid",
            "echt@schule.de", "admin@schule.de", out.email} <= rest


@pytest.mark.asyncio
async def test_anlegen_ist_gebremst(db):
    for _ in range(10):
        await st.wegwerf_konto_anlegen(_req(TOKEN), None, db)
    with pytest.raises(HTTPException) as e:
        await st.wegwerf_konto_anlegen(_req(TOKEN), None, db)
    assert e.value.status_code == 429


@pytest.mark.asyncio
async def test_mitgeschickte_touren_gelten_als_gesehen(db):
    body = st.WegwerfKontoIn(touren=["neueTour", "kern", "<script>", "x" * 41])
    out = await st.wegwerf_konto_anlegen(_req(TOKEN), body, db)
    u = (await db.execute(select(User).where(User.email == out.email))).scalar_one()
    assert "neueTour" in u.tours_done
    assert set(st.WEGWERF_TOUREN) <= set(u.tours_done)
    assert "<script>" not in u.tours_done and "x" * 41 not in u.tours_done
    assert len(u.tours_done) == len(set(u.tours_done))


def test_skript_liest_alle_touren_aus_dem_frontend():
    """Die Grundausstattung im Server darf hinter GuidedTour.jsx zurueckbleiben —
    das Skript schickt die Liste mit. Aber es muss sie auch finden."""
    import pathlib
    import sys
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / "scripts"))
    import wegwerfkonto
    ids = wegwerfkonto.tour_ids()
    assert "kern" in ids and "kalender" in ids and len(ids) > 5
