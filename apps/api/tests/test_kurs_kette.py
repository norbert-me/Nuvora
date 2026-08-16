"""Jahresfolge der Kurse: „6.5 Mathe" und „7.5 Mathe" sind dieselbe Lerngruppe.

Verbunden wird nur die Reihenfolge — die Daten bleiben getrennt, weil eine
Zeugnisnote je Schuljahr gilt. Der Test hält zwei Dinge fest: das Schuljahr
lässt sich aus dem Namen lesen, und die Kette kann sich nicht im Kreis drehen
(sonst läuft jede Anzeige, die ihr folgt, endlos).
"""
import pytest
from fastapi import HTTPException

from app.models import User
from app.routers import kurse as K
from app.routers.kurse import KursIn, schuljahr_aus_name


async def _user(s):
    u = User(email="k@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    return u


@pytest.mark.parametrize("name,erwartet", [
    ("6.5 Mathematik (2025-2026)", "2025/26"),
    ("7.5 Mathe 2026/27", "2026/27"),
    ("Mathe 2025 - 2026", "2025/26"),
    ("7.5 LZ", ""),                     # ohne Jahr im Namen bleibt es leer
    ("Raum 2025", ""),                  # eine einzelne Zahl ist kein Schuljahr
])
def test_schuljahr_aus_dem_namen(name, erwartet):
    assert schuljahr_aus_name(name) == erwartet


@pytest.mark.asyncio
async def test_neuer_kurs_uebernimmt_das_jahr_aus_dem_namen(s):
    u = await _user(s)
    k = await K.create_kurs(KursIn(name="6.5 Mathematik (2025-2026)"), user=u, db=s)
    assert (await s.get(K.Kurs, k.id)).schuljahr == "2025/26"


@pytest.mark.asyncio
async def test_vorjahr_setzen_und_wieder_loesen(s):
    u = await _user(s)
    alt = await K.create_kurs(KursIn(name="6.5 Mathematik (2025-2026)"), user=u, db=s)
    neu = await K.create_kurs(KursIn(name="7.5 Mathematik (2026-2027)"), user=u, db=s)

    await K.rename_kurs(neu.id, KursIn(name="7.5 Mathematik", vorgaenger_id=alt.id), user=u, db=s)
    assert (await s.get(K.Kurs, neu.id)).vorgaenger_id == alt.id

    # 0 loest die Verbindung wieder — ohne den Kurs anzufassen.
    await K.rename_kurs(neu.id, KursIn(name="7.5 Mathematik", vorgaenger_id=0), user=u, db=s)
    assert (await s.get(K.Kurs, neu.id)).vorgaenger_id is None


@pytest.mark.asyncio
async def test_kein_kreis_in_der_jahresfolge(s):
    u = await _user(s)
    a = await K.create_kurs(KursIn(name="A"), user=u, db=s)
    b = await K.create_kurs(KursIn(name="B"), user=u, db=s)
    c = await K.create_kurs(KursIn(name="C"), user=u, db=s)
    await K.rename_kurs(b.id, KursIn(name="B", vorgaenger_id=a.id), user=u, db=s)
    await K.rename_kurs(c.id, KursIn(name="C", vorgaenger_id=b.id), user=u, db=s)

    # Direkt auf sich selbst …
    with pytest.raises(HTTPException) as e1:
        await K.rename_kurs(a.id, KursIn(name="A", vorgaenger_id=a.id), user=u, db=s)
    assert e1.value.status_code == 400

    # … und über Ecken (A -> C -> B -> A).
    with pytest.raises(HTTPException) as e2:
        await K.rename_kurs(a.id, KursIn(name="A", vorgaenger_id=c.id), user=u, db=s)
    assert e2.value.status_code == 400
    assert (await s.get(K.Kurs, a.id)).vorgaenger_id is None, "nach der Abweisung darf nichts gesetzt sein"


@pytest.mark.asyncio
async def test_fremder_kurs_taugt_nicht_als_vorjahr(s):
    u = await _user(s)
    fremd = User(email="f@b.de", password_hash="x", name="F")
    s.add(fremd)
    await s.flush()
    meiner = await K.create_kurs(KursIn(name="Meiner"), user=u, db=s)
    seiner = await K.create_kurs(KursIn(name="Seiner"), user=fremd, db=s)

    with pytest.raises(HTTPException) as e:
        await K.rename_kurs(meiner.id, KursIn(name="Meiner", vorgaenger_id=seiner.id), user=u, db=s)
    assert e.value.status_code == 404
