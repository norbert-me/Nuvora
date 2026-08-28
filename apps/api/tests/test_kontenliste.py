"""Die Kontenliste der Administration gibt nur her, was sie braucht.

Der Anzeigename stand frueher in der Liste und las sich wie eine Rolle
("Admin" vs. "–"), war aber ein frei gesetztes Feld der Lehrkraft. Er ist
raus — und muss es bleiben. Die Rolle haengt an der ID (Konto 1 ist die
Administration, siehe `_require_admin` in main.py), nicht am Namen.
"""
import pytest
import pytest_asyncio
from fastapi import HTTPException

from app.models import User
from app.routers import auth as A


@pytest_asyncio.fixture
async def konten(s):
    admin = User(id=1, email="admin@example.org", password_hash="x", name="Admin", email_verified=True)
    lehrkraft = User(id=2, email="lehrkraft@example.org", password_hash="x", name="", email_verified=True)
    neu = User(id=3, email="neu@example.org", password_hash="x", name="Neu", email_verified=False)
    s.add_all([admin, lehrkraft, neu])
    await s.commit()
    return admin, lehrkraft, neu


@pytest.mark.asyncio
async def test_liste_ohne_namen(s, konten):
    admin, _, _ = konten
    zeilen = await A.admin_list_users(user=admin, db=s)
    assert zeilen, "die Liste darf nicht leer sein"
    for z in zeilen:
        assert "name" not in z, f"Anzeigename gehoert nicht in die Kontenliste: {z}"


@pytest.mark.asyncio
async def test_administration_ist_erkennbar(s, konten):
    admin, _, _ = konten
    zeilen = {z["id"]: z for z in await A.admin_list_users(user=admin, db=s)}
    assert zeilen[1]["admin"] is True
    assert zeilen[2]["admin"] is False
    assert zeilen[3]["admin"] is False


@pytest.mark.asyncio
async def test_bestaetigung_sichtbar(s, konten):
    """Ein unbestaetigtes Konto kann sich nie anmelden — das stuetzt die
    Entscheidung, ob es geloescht werden kann."""
    admin, _, _ = konten
    zeilen = {z["id"]: z for z in await A.admin_list_users(user=admin, db=s)}
    assert zeilen[2]["email_verified"] is True
    assert zeilen[3]["email_verified"] is False


@pytest.mark.asyncio
async def test_nur_die_administration_darf_lesen(s, konten):
    _, lehrkraft, _ = konten
    with pytest.raises(HTTPException) as e:
        await A.admin_list_users(user=lehrkraft, db=s)
    assert e.value.status_code == 403


@pytest.mark.asyncio
async def test_zweite_administration_ernennen(s):
    """Vorher hing die Rolle allein an der ID: es gab genau eine
    Administration, und bei Krankheit oder Wechsel kam niemand mehr an sie."""
    from app.rollen import ist_admin
    from app.routers.auth import AdminRolleIn, admin_list_users, admin_set_role

    chef = User(email="chef@b.de", password_hash="x", name="A")
    kollege = User(email="kollege@b.de", password_hash="x", name="B")
    s.add_all([chef, kollege])
    await s.commit()
    assert chef.id == 1 and not ist_admin(kollege)

    await admin_set_role(kollege.id, AdminRolleIn(admin=True), user=chef, db=s)
    assert ist_admin(kollege)
    # Und die Ernannte darf selbst verwalten.
    zeilen = await admin_list_users(user=kollege, db=s)
    assert {z["id"]: z["admin"] for z in zeilen} == {chef.id: True, kollege.id: True}
    # Konto 1 bleibt aussen vor — sonst koennte sich eine Installation
    # vollstaendig aussperren.
    with pytest.raises(Exception):
        await admin_set_role(1, AdminRolleIn(admin=False), user=kollege, db=s)

    await admin_set_role(kollege.id, AdminRolleIn(admin=False), user=chef, db=s)
    assert not ist_admin(kollege)
