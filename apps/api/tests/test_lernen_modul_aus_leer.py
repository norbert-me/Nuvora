"""Schuelerseite: ist PAP/Waage aus, aber der Zugang gilt, kommt eine leere Liste statt 401
(jede 401 stand als roter Fehler in der Konsole). Ein toter Zugang bleibt 401."""
import pytest
from fastapi import HTTPException

from app import models as m
from app.routers import pap as P
from app.routers import waage as W


@pytest.mark.asyncio
async def test_modul_aus_gibt_leere_liste_toter_zugang_401(s):
    u = m.User(email="la@s.de", password_hash="x", name="L", email_verified=True)
    s.add(u)
    await s.flush()
    s.add(m.UserModule(user_id=u.id, module_key="karten"))
    c = m.SchoolClass(owner_id=u.id, name="7a")
    s.add(c)
    await s.flush()
    s.add(m.Student(class_id=c.id, card_id=1, name="Anna", karten_token="tok-leer"))
    await s.commit()
    assert await P.schueler_aufgaben("tok-leer", db=s) == []
    assert await W.schueler_aufgaben("tok-leer", db=s) == []
    for f in (P.schueler_aufgaben, W.schueler_aufgaben):
        with pytest.raises(HTTPException) as e:
            await f("gibt-es-nicht", db=s)
        assert e.value.status_code == 401
