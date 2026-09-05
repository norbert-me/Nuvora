"""Modul PAP: die zwei Wege in den Editor.

Der unueberwachte Weg braucht keinen Server (der Editor speichert im Browser) —
geprueft wird deshalb der ueberwachte: Aufgabe, Abgabe ueber den ausgeteilten
Token, Sicht der Lehrkraft. Dazu die Form-Pruefung des Diagramms, denn sie ist
das Einzige, was der Server ueber ein Diagramm weiss.
"""
import pytest
from fastapi import HTTPException

from app.models import PapAufgabe, SchoolClass, Student, User, UserModule
from app.routers import pap as P


async def _welt(s, modul=True):
    u = User(email="pap@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    if modul:
        s.add(UserModule(user_id=u.id, module_key="pap"))
    c = SchoolClass(name="7a", owner_id=u.id)
    s.add(c)
    await s.flush()
    kinder = [Student(class_id=c.id, name=n, card_id=i + 1, karten_token=f"tok{i}")
              for i, n in enumerate(["Anna", "Ben"])]
    for k in kinder:
        s.add(k)
    await s.commit()
    return u, c, kinder


def test_diagramm_wird_auf_die_form_gebracht():
    d = P._diagramm({
        "knoten": [{"id": "a", "art": "start", "text": "Start", "x": "10", "y": 20},
                   {"id": "b", "art": "quatsch", "text": "?"},          # unbekannte Art
                   {"id": "a", "art": "ende"},                          # doppelte id
                   {"id": "c", "art": "ende", "text": "x" * 500}],
        "kanten": [{"von": "a", "nach": "c"}, {"von": "a", "nach": "weg"}],
    })
    assert [k["id"] for k in d["knoten"]] == ["a", "c"]
    assert len(d["knoten"][1]["text"]) == 200          # gekuerzt, nicht abgelehnt
    assert d["knoten"][0]["x"] == 10.0                 # "10" wird zur Zahl
    assert d["kanten"] == [{"von": "a", "nach": "c", "label": ""}]   # Kante ins Leere faellt raus


def test_zu_grosses_diagramm_wird_abgelehnt():
    with pytest.raises(HTTPException) as e:
        P._diagramm({"knoten": [{"id": f"n{i}", "art": "anweisung"} for i in range(P.MAX_KNOTEN + 1)]})
    assert e.value.status_code == 400


@pytest.mark.asyncio
async def test_kind_gibt_ab_und_die_lehrkraft_sieht_es(s):
    u, c, kinder = await _welt(s)
    a = await P.create_aufgabe(P.AufgabeIn(title="Ablauf", class_id=c.id), user=u, db=s)

    offen = await P.schueler_aufgaben("tok0", db=s)
    assert [x["id"] for x in offen] == [a.id]

    await P.schueler_speichern("tok0", a.id, P.AbgabeIn(
        daten={"knoten": [{"id": "n1", "art": "start", "text": "Start"}], "kanten": []},
        abgegeben=True), db=s)

    zeilen = await P.list_abgaben(a.id, user=u, db=s)
    # BEIDE Kinder stehen in der Liste — „wer hat noch nichts?" ist die Frage.
    assert len(zeilen) == 2
    meins = [z for z in zeilen if z["student_id"] == kinder[0].id][0]
    anderes = [z for z in zeilen if z["student_id"] == kinder[1].id][0]
    assert meins["abgegeben"] and not meins["leer"]
    assert anderes["leer"] and not anderes["abgegeben"]


@pytest.mark.asyncio
async def test_zweites_speichern_ueberschreibt_statt_zu_haeufen(s):
    u, c, kinder = await _welt(s)
    a = await P.create_aufgabe(P.AufgabeIn(title="Ablauf", class_id=c.id), user=u, db=s)
    for text in ("erst", "dann"):
        await P.schueler_speichern("tok0", a.id, P.AbgabeIn(
            daten={"knoten": [{"id": "n1", "art": "anweisung", "text": text}], "kanten": []}), db=s)
    zeilen = [z for z in await P.list_abgaben(a.id, user=u, db=s) if z["student_id"] == kinder[0].id]
    assert len(zeilen) == 1
    assert zeilen[0]["daten"]["knoten"][0]["text"] == "dann"


@pytest.mark.asyncio
async def test_fremde_aufgabe_ist_kein_weg_in_fremde_klassen(s):
    """Die Aufgaben-ID darf nicht reichen: sie muss zu DIESEM Kind gehoeren."""
    u, c, _ = await _welt(s)
    fremd = User(email="fremd@b.de", password_hash="x", name="F")
    s.add(fremd)
    await s.flush()
    fk = SchoolClass(name="9z", owner_id=fremd.id)
    s.add(fk)
    await s.flush()
    fa = PapAufgabe(owner_id=fremd.id, title="fremd", class_id=fk.id)
    s.add(fa)
    await s.commit()

    with pytest.raises(HTTPException) as e:
        await P.schueler_speichern("tok0", fa.id, P.AbgabeIn(daten=None), db=s)
    assert e.value.status_code == 404


@pytest.mark.asyncio
async def test_ohne_modul_schweigt_der_ausgeteilte_zugang(s):
    """Wie bei Karten: der QR-Code haengt im Ordner des Kindes und laesst sich
    nicht einsammeln — also prueft der Server bei jedem Aufruf."""
    u, c, _ = await _welt(s, modul=False)
    with pytest.raises(HTTPException) as e:
        await P.schueler_aufgaben("tok0", db=s)
    assert e.value.status_code == 401
