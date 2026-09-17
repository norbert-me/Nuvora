"""Eine fremde Registrierung darf das Konto der echten Besitzerin nicht kapern.

Angriff: jemand registriert lehrerin@schule.de mit SEINEM Passwort. Die echte
Lehrerin registriert sich danach selbst und klickt den Link in ihrer Mail —
frueher bestaetigte sie damit das Konto des anderen, samt dessen Passwort.

Lauf:  cd apps/api && pip install -r requirements-dev.txt && pytest
"""
import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models import User
from app.routers import auth as A


class _Req:
    client = type("C", (), {"host": "127.0.0.9"})()
    headers = {}


@pytest.mark.asyncio
async def test_zweite_registrierung_gilt_und_alte_links_verfallen(s, monkeypatch):
    mails = []

    async def _merke(u):
        mails.append(A._make_verify_token(u))
    monkeypatch.setattr(A, "_send_verify_mail", _merke)
    A._buckets.clear()

    body = lambda pw, name: A.RegisterBody(email="lehrerin@schule.de", password=pw, name=name)
    await A.register(body("Angreifer-Passwort-1", "X"), _Req(), db=s)
    link_angreifer = mails[-1]
    await A.register(body("Echtes-Passwort-2", "Lehrerin"), _Req(), db=s)
    link_echt = mails[-1]

    u = (await s.execute(select(User).where(User.email == "lehrerin@schule.de"))).scalar_one()
    assert A._verify_pw("Echtes-Passwort-2", u.password_hash)
    assert not A._verify_pw("Angreifer-Passwort-1", u.password_hash)
    assert u.name == "Lehrerin"

    with pytest.raises(HTTPException):
        await A.verify_email(A.VerifyEmailBody(token=link_angreifer), _Req(), db=s)
    await A.verify_email(A.VerifyEmailBody(token=link_echt), _Req(), db=s)
    await s.refresh(u)
    assert u.email_verified
