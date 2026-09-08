"""Angaben zur PERSON von ueberall aendern (PATCH /api/classes/students/{id}).

Vorher lagen sie auseinander: E/G im Kurs, Foerderschwerpunkt in der Klasse,
Massnahmen wieder im Kurs — und wer im Notenbuch auf einen Namen klickte, sah
nichts davon und konnte nichts aendern.

Was hier bewacht wird:
  1. Geschrieben wird auf ALLE Zeilen der Person (Geschwisterklassen) — sonst
     waere ein Kind in Mathe „E" und in Deutsch ohne Niveau.
  2. Nur gesetzte Felder werden geschrieben: ein Dialog, der das Niveau
     aendert, darf die Foerderschwerpunkte nicht leeren.
  3. Unbekannte Werte werden abgewiesen (das Vokabular ist fest).
  4. Fremde Kinder bleiben unerreichbar.
"""
import pytest
from fastapi import HTTPException

from app.models import Kurs, KursTag, SchoolClass, Student, User
from app.routers import classes as CL


async def _welt(s):
    u = User(email="p@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    # Zwei Fach-Klassen desselben Kurses: dieselbe Person steht in beiden.
    m = SchoolClass(name="7a Mathe", owner_id=u.id)
    d = SchoolClass(name="7a Deutsch", owner_id=u.id)
    s.add_all([m, d])
    await s.flush()
    k = Kurs(owner_id=u.id, name="7a")
    s.add(k)
    await s.flush()
    s.add_all([KursTag(kurs_id=k.id, class_id=m.id), KursTag(kurs_id=k.id, class_id=d.id)])
    a1 = Student(card_id=1, name="Mia", class_id=m.id)
    a2 = Student(card_id=1, name="Mia", class_id=d.id)
    s.add_all([a1, a2])
    await s.commit()
    return u, a1, a2


@pytest.mark.asyncio
async def test_aendert_alle_zeilen_der_person(s):
    u, a1, a2 = await _welt(s)
    await CL.update_student(a1.id, CL.PersonIn(niveau="E", foerder=["LRS"]), user=u, db=s)
    await s.refresh(a2)
    assert a2.niveau == "E", "E/G haengt an der Person, nicht an der Fach-Klasse"
    assert a2.foerder == ["LRS"]


@pytest.mark.asyncio
async def test_nicht_gesetzte_felder_bleiben_stehen(s):
    u, a1, a2 = await _welt(s)
    await CL.update_student(a1.id, CL.PersonIn(foerder=["Dyskalkulie"], notizen="Sitzt vorne"), user=u, db=s)
    await CL.update_student(a1.id, CL.PersonIn(niveau="G"), user=u, db=s)
    await s.refresh(a1)
    assert a1.niveau == "G"
    assert a1.foerder == ["Dyskalkulie"], "das Niveau zu setzen darf den Foerderschwerpunkt nicht leeren"
    assert a1.notizen == "Sitzt vorne"


@pytest.mark.asyncio
async def test_unbekannte_werte_werden_abgewiesen(s):
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        CL.PersonIn(foerder=["Erfunden"])
    with pytest.raises(ValidationError):
        CL.PersonIn(niveau="X")


@pytest.mark.asyncio
async def test_fremdes_kind_bleibt_unerreichbar(s):
    u, a1, _ = await _welt(s)
    fremd = User(email="f@b.de", password_hash="x", name="F")
    s.add(fremd)
    await s.commit()
    with pytest.raises(HTTPException) as e:
        await CL.update_student(a1.id, CL.PersonIn(niveau="E"), user=fremd, db=s)
    assert e.value.status_code == 404
    with pytest.raises(HTTPException):
        await CL.get_student(a1.id, user=fremd, db=s)


# ─── Die Kursliste sagt nur, DASS etwas vereinbart ist ───
#
# „Bei wem muss ich etwas beachten?" ist die Frage an eine Kursliste; „was
# genau" gehoert in den Dialog des einzelnen Kindes (Art. 9). Deshalb traegt
# `KindOut` ein blosses Ja/Nein — und nur fuer DIESEN Kurs: ein Zeitzuschlag in
# Mathe ist keiner in Sport.

@pytest.mark.asyncio
async def test_kursliste_zeigt_nur_dass_ein_nachteilsausgleich_gilt(s):
    from app.routers import kurse as KU

    from sqlalchemy import select

    from app.models import Kurs

    u, kind, _ = await _welt(s)
    kurs = (await s.execute(select(Kurs).where(Kurs.owner_id == u.id))).scalars().first()
    liste = await KU.list_kinder(kurs.id, user=u, db=s)
    assert liste[0].nta is False

    await KU.set_kurs_massnahmen(kurs.id, KU.MassnahmenIn(
        name=kind.name, massnahmen=[{"art": "Zeitzuschlag", "detail": "20 %", "arbeit": True}],
    ), user=u, db=s)
    liste = await KU.list_kinder(kurs.id, user=u, db=s)
    assert liste[0].nta is True
    roh = liste[0].model_dump()
    assert "20 %" not in str(roh) and "Zeitzuschlag" not in str(roh), "der Inhalt bleibt im Einzeldialog"
