"""Kurse zusammenfuehren: alles am Quellkurs wandert ins Ziel, Doppeltes wird nicht verdoppelt,
die Quelle kommt in den Papierkorb, fremde Kurse sind tabu."""
import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models import GradeSection, Kurs, KursTag, SchoolClass, User
from app.routers import kurse as K


@pytest.fixture(autouse=True)
def _passwort(monkeypatch):
    monkeypatch.setattr(K, "_passwort_bestaetigt", lambda user, pw: (_ for _ in ()).throw(HTTPException(400, "Passwort falsch")) if pw != "ok" else None)


async def _grund(s):
    u = User(email="k@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    c1 = SchoolClass(name="7.5", owner_id=u.id); c2 = SchoolClass(name="7.5b", owner_id=u.id)
    s.add_all([c1, c2]); await s.flush()
    ziel = Kurs(name="7.5 Mathematik", owner_id=u.id); quelle = Kurs(name="M 7.5", owner_id=u.id)
    s.add_all([ziel, quelle]); await s.flush()
    s.add_all([KursTag(kurs_id=ziel.id, class_id=c1.id), KursTag(kurs_id=quelle.id, class_id=c1.id), KursTag(kurs_id=quelle.id, class_id=c2.id)])
    s.add_all([GradeSection(name="Muendlich", weight=50, position=0, term="1", class_id=c1.id, kurs_id=ziel.id, owner_id=u.id),
               GradeSection(name="Muendlich", weight=50, position=0, term="1", class_id=c1.id, kurs_id=quelle.id, owner_id=u.id)])
    await s.commit()
    return u, ziel, quelle, c1, c2


@pytest.mark.asyncio
async def test_vorschau_und_zusammenfuehren(s):
    u, ziel, quelle, c1, c2 = await _grund(s)
    v = await K.zusammenfuehren_vorschau(ziel.id, str(quelle.id), user=u, db=s)
    assert v[0]["zeilen"]["grade_sections"] == 1 and v[0]["zeilen"]["kurs_tags"] == 2
    with pytest.raises(HTTPException) as f:
        await K.zusammenfuehren(ziel.id, K.ZusammenIn(quellen=[quelle.id], password="falsch"), user=u, db=s)
    assert f.value.status_code == 400
    res = await K.zusammenfuehren(ziel.id, K.ZusammenIn(quellen=[quelle.id], password="ok"), user=u, db=s)
    assert res["verschoben"]["grade_sections"] == 1
    # beide Bereiche stehen nebeneinander im Ziel (nichts zusammengelegt)
    secs = (await s.execute(select(GradeSection).where(GradeSection.kurs_id == ziel.id))).scalars().all()
    assert len(secs) == 2
    # Klasse c1 war schon im Ziel -> nicht doppelt; c2 kam dazu
    tags = (await s.execute(select(KursTag.class_id).where(KursTag.kurs_id == ziel.id))).scalars().all()
    assert sorted(tags) == sorted([c1.id, c2.id])
    await s.refresh(quelle)
    assert quelle.deleted_at is not None


@pytest.mark.asyncio
async def test_fremde_und_sich_selbst_abgelehnt(s):
    u, ziel, quelle, c1, c2 = await _grund(s)
    fremd = User(email="x@y.de", password_hash="x", name="F"); s.add(fremd); await s.flush()
    fk = Kurs(name="Fremd", owner_id=fremd.id); s.add(fk); await s.commit()
    with pytest.raises(HTTPException):
        await K.zusammenfuehren(ziel.id, K.ZusammenIn(quellen=[fk.id], password="ok"), user=u, db=s)
    with pytest.raises(HTTPException) as f:
        await K.zusammenfuehren(ziel.id, K.ZusammenIn(quellen=[ziel.id], password="ok"), user=u, db=s)
    assert f.value.status_code == 400
