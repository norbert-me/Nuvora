"""Modul Waage: Rechenkern, Blatt, Abgabe ueber den Zugang.

Der Server rechnet „geloest" selbst nach (app/waage.py) — ein Weg, der die
Waage aus dem Gleichgewicht bringt, zaehlt nicht, auch wenn er bei „x = …"
endet. Das ist der Kern dieser Tests.
"""
import pytest
from fastapi import HTTPException

from app import waage as W
from app.models import SchoolClass, Student, User, UserModule, WaageAufgabe
from app.routers import waage as R


def st(lx, le, rx, re, op=""):
    return {"l": {"x": lx, "e": le}, "r": {"x": rx, "e": re}, "op": op}


def test_rechenkern():
    s = st(3, 2, 0, 14)
    assert W.loesung(s) == 4
    assert W.gleichung_ok(s)
    assert W.gleichung_ok(st(2, 1, 0, 6)) is None      # x = 2,5
    assert W.gleichung_ok(st(1, 5, 0, 3)) is None      # x = −2
    assert W.gleichung_ok(st(0, 1, 0, 1)) is None      # kein x
    assert W.gleichung_ok(st(1, 61, 0, 70)) is None    # zu gross
    assert W.gleichung_ok(st(5, 3, 2, 12)) == {"l": {"x": 5, "e": 3}, "r": {"x": 2, "e": 12}}   # x = 3


def test_weg_wird_nachgerechnet():
    s = st(3, 2, 0, 14)
    ok = W.pruefe_weg(s, [st(3, 0, 0, 12, "| − 2"), st(1, 0, 0, 4, "| : 3")])
    assert ok["gueltig"] and ok["geloest"]
    falsch = W.pruefe_weg(s, [st(1, 0, 0, 5)])           # endet bei x = 5, Waage stimmt nicht
    assert not falsch["geloest"] and not falsch["gueltig"]
    halb = W.pruefe_weg(s, [st(3, 0, 0, 12)])
    assert halb["gueltig"] and not halb["geloest"]
    # Unsinn faellt heraus, statt die Abgabe abzulehnen
    kaputt = W.pruefe_weg(s, [{"l": {"x": -1, "e": 0}, "r": {"x": 0, "e": 0}}, "quatsch"])
    assert kaputt["schritte"] == [] and not kaputt["geloest"]


async def _welt(s, modul=True):
    u = User(email="waage@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    if modul:
        s.add(UserModule(user_id=u.id, module_key="waage"))
    c = SchoolClass(name="7a", owner_id=u.id)
    s.add(c)
    await s.flush()
    kinder = [Student(class_id=c.id, name=n, card_id=i + 1, karten_token=f"wtok{i}")
              for i, n in enumerate(["Anna", "Ben"])]
    for k in kinder:
        s.add(k)
    await s.commit()
    return u, c, kinder


@pytest.mark.asyncio
async def test_blatt_lehnt_gleichung_ab_die_nicht_auf_die_waage_passt(s):
    u, c, _ = await _welt(s)
    with pytest.raises(HTTPException) as e:
        await R.create_aufgabe(R.AufgabeIn(title="x", class_id=c.id, gleichungen=[st(2, 1, 0, 6)]), user=u, db=s)
    assert e.value.status_code == 400 and "Gleichung 1" in e.value.detail


@pytest.mark.asyncio
async def test_kind_loest_und_die_lehrkraft_sieht_wie_viele(s):
    u, c, kinder = await _welt(s)
    a = await R.create_aufgabe(R.AufgabeIn(title="Blatt", class_id=c.id,
                                           gleichungen=[st(3, 2, 0, 14), st(2, 0, 0, 10)]), user=u, db=s)
    offen = await R.schueler_aufgaben("wtok0", db=s)
    assert [x["id"] for x in offen] == [a.id]

    antwort = await R.schueler_speichern("wtok0", a.id, R.AbgabeIn(daten={
        "0": {"schritte": [st(3, 0, 0, 12), st(1, 0, 0, 4)]},
        "1": {"schritte": [st(1, 0, 0, 6)]},                # behauptet x = 6 — falsch
        "5": {"schritte": [st(1, 0, 0, 1)]},                # gibt es nicht
    }, abgegeben=True), db=s)
    assert antwort["geloest"] == 1
    assert set(antwort["daten"]) == {"0", "1"}

    zeilen = await R.list_abgaben(a.id, user=u, db=s)
    assert len(zeilen) == 2                                  # auch das Kind ohne Abgabe
    meins = [z for z in zeilen if z["student_id"] == kinder[0].id][0]
    assert meins["geloest"] == 1 and meins["gesamt"] == 2 and meins["abgegeben"]


@pytest.mark.asyncio
async def test_fremdes_blatt_ist_kein_weg_in_fremde_klassen(s):
    u, c, _ = await _welt(s)
    fremd = User(email="fremd-w@b.de", password_hash="x", name="F")
    s.add(fremd)
    await s.flush()
    fk = SchoolClass(name="9z", owner_id=fremd.id)
    s.add(fk)
    await s.flush()
    fa = WaageAufgabe(owner_id=fremd.id, title="fremd", class_id=fk.id, gleichungen=[st(1, 1, 0, 2)])
    s.add(fa)
    await s.commit()
    with pytest.raises(HTTPException) as e:
        await R.schueler_speichern("wtok0", fa.id, R.AbgabeIn(daten={}), db=s)
    assert e.value.status_code == 404


@pytest.mark.asyncio
async def test_ohne_modul_schweigt_der_zugang(s):
    await _welt(s, modul=False)
    with pytest.raises(HTTPException) as e:
        await R.schueler_aufgaben("wtok0", db=s)
    assert e.value.status_code == 401
