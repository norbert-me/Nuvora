"""E- und G-Blatt sind EINE Arbeit mit zwei Blaettern (partner_id).

Festgehalten: das zweite Blatt verbindet sich beidseitig und uebernimmt Name
und Kurs, passt nur zum anderen Niveau, und ein Umbenennen gilt beiden.
"""
import pytest
from fastapi import HTTPException

from app.models import SchoolClass, User, WorkAnalysis
from app.routers import klassenarbeit as KA


async def _grund(s):
    u = User(email="eg@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    c = SchoolClass(name="8a", owner_id=u.id); s.add(c); await s.commit()
    return u, c


@pytest.mark.asyncio
async def test_zweites_blatt_verbindet_sich(s):
    u, c = await _grund(s)
    e = await KA.create_work(KA.WorkIn(class_id=c.id, name="2. KA", niveau="E"), user=u, db=s)
    g = await KA.create_work(KA.WorkIn(class_id=c.id, name="egal", niveau="G", partner_id=e.id), user=u, db=s)
    assert g.partner_id == e.id and g.name == "2. KA"
    assert (await s.get(WorkAnalysis, e.id)).partner_id == g.id

    # Ein drittes Blatt passt nicht mehr, auch nicht mit gleichem Niveau.
    with pytest.raises(HTTPException):
        await KA.create_work(KA.WorkIn(class_id=c.id, niveau="G", partner_id=e.id), user=u, db=s)

    # Umbenennen gilt beiden Blaettern.
    await KA.update_work(e.id, KA.WorkPut(name="Bruchrechnung"), user=u, db=s)
    assert (await s.get(WorkAnalysis, g.id)).name == "Bruchrechnung"


@pytest.mark.asyncio
async def test_gleiches_niveau_wird_abgewiesen(s):
    u, c = await _grund(s)
    e = await KA.create_work(KA.WorkIn(class_id=c.id, name="KA", niveau="E"), user=u, db=s)
    with pytest.raises(HTTPException):
        await KA.create_work(KA.WorkIn(class_id=c.id, niveau="E", partner_id=e.id), user=u, db=s)
    ohne = await KA.create_work(KA.WorkIn(class_id=c.id, name="Alle"), user=u, db=s)
    with pytest.raises(HTTPException):
        await KA.create_work(KA.WorkIn(class_id=c.id, niveau="G", partner_id=ohne.id), user=u, db=s)


@pytest.mark.asyncio
async def test_bestehende_arbeit_teilen(s):
    """Eine Arbeit fuer alle wird nachtraeglich E + G; die Punkte der G-Kinder
    wandern mit ins G-Blatt."""
    from app.models import Student
    u, c = await _grund(s)
    e_kind = Student(card_id=1, name="Ella", class_id=c.id, niveau="E")
    g_kind = Student(card_id=2, name="Gus", class_id=c.id, niveau="G")
    s.add_all([e_kind, g_kind]); await s.commit()
    w = await KA.create_work(KA.WorkIn(class_id=c.id, name="Brueche"), user=u, db=s)
    await KA.update_work(w.id, KA.WorkPut(tasks=[{"id": "t1", "label": "1", "max": 4}],
                                          results={str(e_kind.id): {"t1": 3}, str(g_kind.id): {"t1": 2}},
                                          absent=[str(g_kind.id)]), user=u, db=s)
    e, g = await KA.split_work(w.id, user=u, db=s)
    assert (e.niveau, g.niveau) == ("E", "G") and e.partner_id == g.id and g.partner_id == e.id
    assert list(e.results) == [str(e_kind.id)] and list(g.results) == [str(g_kind.id)]
    assert g.absent == [str(g_kind.id)] and e.absent == []
    assert g.tasks == e.tasks and g.name == "Brueche"
    with pytest.raises(HTTPException):
        await KA.split_work(w.id, user=u, db=s)


def test_klassenstufe_aus_dem_namen():
    from app.routers.klassenarbeit import klassenstufe
    assert [klassenstufe(n) for n in ("7.5", "10a", "WP-INF 8", "6.1", "Blanko", "", None)] == [7, 10, 8, 6, None, None, None]


@pytest.mark.asyncio
async def test_vergleich_nimmt_nur_klassen_derselben_stufe(s):
    """Gemeldet: der Vergleich stellte 6.1 neben 7.5 — dieselbe Namensgleichheit, aber nicht dieselbe Arbeit."""
    from app import models as m
    from app.routers.klassenarbeit import vergleich
    u = m.User(email="v@s.de", password_hash="x", name="L", email_verified=True)
    s.add(u)
    await s.flush()
    ids = {}
    for n in ("6.1", "7.5", "7.4", "Blanko"):
        c = m.SchoolClass(owner_id=u.id, name=n)
        s.add(c)
        await s.flush()
        w = m.WorkAnalysis(owner_id=u.id, class_id=c.id, name="Rechnen mit Brüchen", results={})
        s.add(w)
        await s.flush()
        ids[n] = w.id
    await s.commit()
    erg = await vergleich(ids["7.5"], user=u, db=s)
    klassen = sorted(a["class_name"] for a in erg["arbeiten"])
    assert klassen == ["7.4", "7.5", "Blanko"], klassen        # 6.1 fehlt; „Blanko" hat keine lesbare Stufe und bleibt
