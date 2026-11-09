"""Modul Reihen: Vorlage, Reihenfolge, Kopie, Papierkorb — und der Weg zum Kalender
(Stunden einer Reihe der Reihe nach auf die tatsaechlichen Unterrichtsstunden)."""
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models import (CalendarEntry, Kurs, KursTag, Material, Reihe, ReiheStunde, SchoolClass,
                        TimetableSlot, User, UserModule)
from app.routers import reihen as R


async def _konto(s, mail="r@b.de", module=("reihen", "kalender")):
    u = User(email=mail, password_hash="x", name="L")
    s.add(u)
    await s.flush()
    for m in module:
        s.add(UserModule(user_id=u.id, module_key=m))
    await s.commit()
    return u


async def _reihe(s, u, **kw):
    return await R.anlegen(R.ReiheIn(name="Brueche", fach="Mathematik", **kw), user=u, db=s)


async def _stunde(s, u, reihe_id, titel, dauer=1, **kw):
    return await R.stunde_anlegen(reihe_id, R.StundeIn(titel=titel, dauer=dauer, **kw), user=u, db=s)


@pytest.mark.asyncio
async def test_ohne_modul_dicht(s):
    u = await _konto(s, module=())
    with pytest.raises(HTTPException) as f:
        await R.require_module(user=u, db=s)
    assert f.value.status_code == 403


@pytest.mark.asyncio
async def test_reihe_stunden_reihenfolge_und_notizen(s):
    u = await _konto(s)
    r = await _reihe(s, u, naechstes_mal="Quiz statt Hausaufgabe")
    a = await _stunde(s, u, r.id, "Kuerzen", notizen="AB 3", naechstes_mal="Zeit sparen",
                      verlaufsplan=[R.PhaseItem(phase="Einstieg", dauer="5", text="Blitzlicht")])
    b = await _stunde(s, u, r.id, "Erweitern", dauer=2)
    await R.reihenfolge(r.id, R.ReihenfolgeIn(ids=[b.id, a.id]), user=u, db=s)
    d = await R.lesen(r.id, user=u, db=s)
    assert [x.titel for x in d.stunden] == ["Erweitern", "Kuerzen"]
    assert d.naechstes_mal == "Quiz statt Hausaufgabe"
    assert d.stunden_anzahl == 2 and d.unterrichtsstunden == 3
    kuerzen = d.stunden[1]
    assert kuerzen.naechstes_mal == "Zeit sparen" and kuerzen.verlaufsplan[0].text == "Blitzlicht"


@pytest.mark.asyncio
async def test_fremde_reihe_ist_nicht_da(s):
    u = await _konto(s)
    fremd = await _konto(s, "x@b.de")
    r = await _reihe(s, u)
    for aufruf in (R.lesen(r.id, user=fremd, db=s),
                   R.stunde_anlegen(r.id, R.StundeIn(titel="x"), user=fremd, db=s),
                   R.loeschen(r.id, user=fremd, db=s)):
        with pytest.raises(HTTPException) as f:
            await aufruf
        assert f.value.status_code == 404


@pytest.mark.asyncio
async def test_loeschen_ist_weich_und_kommt_zurueck(s):
    u = await _konto(s)
    r = await _reihe(s, u)
    await R.loeschen(r.id, user=u, db=s)
    assert (await R.liste(user=u, db=s)) == []
    with pytest.raises(HTTPException):
        await R.lesen(r.id, user=u, db=s)
    await R.restore_reihe(r.id, u, s)
    assert [x.id for x in await R.liste(user=u, db=s)] == [r.id]


@pytest.mark.asyncio
async def test_kopie_haelt_stunden_und_verlinkt_dateien(s):
    u = await _konto(s)
    r = await _reihe(s, u)
    a = await _stunde(s, u, r.id, "Kuerzen")
    m = Material(owner_id=u.id, reihe_stunde_id=a.id, filename="ab.pdf", mime="application/pdf",
                 size=3, sha256="abc", data=b"PDF")
    s.add(m)
    await s.commit()
    k = await R.kopieren(r.id, user=u, db=s)
    assert k.id != r.id and [x.titel for x in k.stunden] == ["Kuerzen"]
    assert k.stunden[0].dateien == 1
    kopie = (await s.execute(select(Material).where(Material.reihe_stunde_id == k.stunden[0].id))).scalars().one()
    assert kopie.quelle_id == m.id and kopie.data is None      # Bytes nur einmal


@pytest.mark.asyncio
async def test_fremde_verweise_fliegen_heraus(s):
    u = await _konto(s)
    r = await _reihe(s, u)
    st = await _stunde(s, u, r.id, "x", method_id=99999, lernpfad_ladder_id=99999, cardvote_set_id=99999,
                       karten_deck_ids=[99999], topic_id=99999)
    assert st.method_id is None and st.lernpfad_ladder_id is None and st.cardvote_set_id is None
    assert st.karten_deck_ids is None and st.topic_id is None


def _plaetze(*paare):
    return [(date(2026, 11, t), p) for t, p in paare]


def test_verteilen_einzel_und_doppelstunde():
    e1 = SimpleNamespace(id=1, dauer=1)
    dop = SimpleNamespace(id=2, dauer=2)
    plaetze = _plaetze((2, 1), (3, 4), (3, 5), (9, 1))
    ergebnis = {st.id: slots for st, slots in R._verteilen([e1, dop], plaetze)}
    assert ergebnis[1] == [(date(2026, 11, 2), 1)]
    # Die Doppelstunde braucht zwei aufeinanderfolgende Stunden am selben Tag.
    assert ergebnis[2] == [(date(2026, 11, 3), 4), (date(2026, 11, 3), 5)]


def test_verteilen_ohne_platz_bleibt_unplatziert():
    dop = SimpleNamespace(id=1, dauer=2)
    assert R._verteilen([dop], _plaetze((2, 1), (3, 1))) == [(dop, None)]


async def _kurs_mit_plan(s, u):
    k = Kurs(owner_id=u.id, name="7.5 Mathe", fach="Mathematik")
    c = SchoolClass(name="7.5", owner_id=u.id)
    s.add_all([k, c])
    await s.flush()
    s.add(KursTag(kurs_id=k.id, class_id=c.id))
    for per in (1, 2):
        s.add(TimetableSlot(owner_id=u.id, weekday=0, period=per, title="M", class_id=c.id, kurs_id=k.id))
    await s.commit()
    return k, c


def _naechster_montag():
    h = date.today()
    return h + timedelta(days=(7 - h.weekday()) % 7 or 7)


@pytest.mark.asyncio
async def test_ausspielen_legt_eintraege_auf_die_unterrichtsstunden(s):
    u = await _konto(s)
    k, c = await _kurs_mit_plan(s, u)
    r = await _reihe(s, u)
    await _stunde(s, u, r.id, "Kuerzen", notizen="AB 3")
    await _stunde(s, u, r.id, "Erweitern", dauer=2)
    ab = _naechster_montag()
    vor = await R.vorschau(r.id, k.id, ab, user=u, db=s)
    assert [v["platziert"] for v in vor] == [True, True]
    erg = await R.ausspielen(r.id, R.AusspielenIn(kurs_id=k.id, ab=ab), user=u, db=s)
    assert erg["angelegt"] == 3 and erg["nicht_platziert"] == []
    eintraege = (await s.execute(select(CalendarEntry).where(CalendarEntry.owner_id == u.id).order_by(
        CalendarEntry.date, CalendarEntry.period))).scalars().all()
    # Erste Stunde: Montag 1. Stunde; die Doppelstunde braucht zwei Stunden am selben Tag —
    # die 2. Stunde allein reicht nicht, also rueckt sie auf den naechsten Montag (1. + 2.).
    assert [(e.date.date(), e.period, e.title) for e in eintraege][0][1:] == (1, "Kuerzen")
    assert [e.period for e in eintraege] == [1, 1, 2]
    assert eintraege[1].title == "Erweitern (1/2)" and eintraege[2].title == "Erweitern (2/2)"
    assert eintraege[0].notes == "AB 3" and all(e.kurs_id == k.id for e in eintraege)
    # Ein zweites Mal: die belegten Stunden zaehlen nicht als frei.
    erg2 = await R.ausspielen(r.id, R.AusspielenIn(kurs_id=k.id, ab=ab, stunden=[
        (await R.lesen(r.id, user=u, db=s)).stunden[0].id]), user=u, db=s)
    spaeter = (await s.execute(select(CalendarEntry).where(CalendarEntry.title == "Kuerzen"))).scalars().all()
    assert erg2["angelegt"] == 1 and len({(e.date, e.period) for e in spaeter}) == 2


@pytest.mark.asyncio
async def test_ohne_kalender_kein_weg_dorthin(s):
    u = await _konto(s, module=("reihen",))
    r = await _reihe(s, u)
    with pytest.raises(HTTPException) as f:
        await R.ausspielen(r.id, R.AusspielenIn(kurs_id=1, ab=date.today()), user=u, db=s)
    assert f.value.status_code == 409


@pytest.mark.asyncio
async def test_aus_kalender_speichert_gehaltene_stunden_als_reihe(s):
    u = await _konto(s)
    k, c = await _kurs_mit_plan(s, u)
    montag = _naechster_montag()
    from app.zeit import tagesbeginn
    e1 = CalendarEntry(owner_id=u.id, date=tagesbeginn(montag), title="Kuerzen", notes="AB 3",
                       class_id=c.id, kurs_id=k.id, period=1)
    e2 = CalendarEntry(owner_id=u.id, date=tagesbeginn(montag), title="Erweitern", class_id=c.id, kurs_id=k.id, period=2)
    e3 = CalendarEntry(owner_id=u.id, date=tagesbeginn(montag), title="Erweitern", class_id=c.id, kurs_id=k.id, period=3)
    s.add_all([e1, e2, e3])
    await s.flush()
    s.add(Material(owner_id=u.id, entry_id=e1.id, filename="ab.pdf", mime="application/pdf", size=3, sha256="x", data=b"PDF"))
    await s.commit()
    d = await R.aus_kalender(R.AusKalenderIn(name="Brueche", kurs_id=k.id), user=u, db=s)
    assert [(x.titel, x.dauer) for x in d.stunden] == [("Kuerzen", 1), ("Erweitern", 2)]   # zwei Eintraege = Doppelstunde
    assert d.fach == "Mathematik" and d.quelle == "7.5 Mathe"
    assert d.stunden[0].dateien == 1 and d.stunden[0].notizen == "AB 3"


@pytest.mark.asyncio
async def test_qr_nur_fuer_links():
    from fastapi import HTTPException as H
    from app.routers import qr as Q
    u = SimpleNamespace(id=1)
    antwort = await Q.qr_bild("https://nuvora.example/waage-frei", user=u)
    assert antwort.media_type == "image/png" and antwort.body[:4] == b"\x89PNG"
    for schlecht in ("", "javascript:alert(1)", "irgendein text", "https://x/" + "a" * 1100):
        with pytest.raises(H) as f:
            await Q.qr_bild(schlecht, user=u)
        assert f.value.status_code == 400
