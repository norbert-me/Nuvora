"""Die Gesamtauswertung einer Klasse zeigt auch die Klassenarbeiten.

Nur mit Modul Auswertung (Regel 3), je Kind nach seiner Kartennummer, und eine
E/G-Arbeit als EINE Spalte. Noch nicht korrigierte Kinder bekommen keine 0.
"""
import pytest

from app.models import SchoolClass, Student, User, UserModule, WorkAnalysis
from app.routers.results import get_class_evaluation


async def _grund(s, mit_modul):
    u = User(email="ga@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    c = SchoolClass(name="8b", owner_id=u.id); s.add(c); await s.flush()
    ella = Student(card_id=1, name="Ella", class_id=c.id, niveau="E")
    gus = Student(card_id=2, name="Gus", class_id=c.id, niveau="G")
    leo = Student(card_id=3, name="Leo", class_id=c.id, niveau="G")
    s.add_all([ella, gus, leo])
    if mit_modul:
        s.add(UserModule(user_id=u.id, module_key="auswertung"))
    await s.flush()
    e = WorkAnalysis(owner_id=u.id, class_id=c.id, name="KA 1", niveau="E",
                     tasks=[{"id": "t1", "max": 10}], results={str(ella.id): {"t1": 8}})
    g = WorkAnalysis(owner_id=u.id, class_id=c.id, name="KA 1", niveau="G",
                     tasks=[{"id": "t1", "max": 8}],
                     results={str(gus.id): {"t1": 4}, str(leo.id): {}})
    s.add_all([e, g]); await s.flush()
    e.partner_id, g.partner_id = g.id, e.id
    await s.commit()
    return u, c


@pytest.mark.asyncio
async def test_arbeit_steht_als_eine_spalte_da(s):
    u, c = await _grund(s, mit_modul=True)
    aus = await get_class_evaluation(c.id, user=u, db=s)
    arbeiten = [x for x in aus["tests"] if x.get("art") == "arbeit"]
    assert len(arbeiten) == 1
    sp = arbeiten[0]
    assert sp["set_name"] == "KA 1 (E/G)"
    assert sp["student_scores"][1]["score"] == 8 and sp["student_scores"][1]["total"] == 10
    assert sp["student_scores"][2]["score"] == 4 and sp["student_scores"][2]["total"] == 8
    assert 3 not in sp["student_scores"]      # leer = noch nicht korrigiert


@pytest.mark.asyncio
async def test_ohne_modul_auswertung_keine_arbeit(s):
    u, c = await _grund(s, mit_modul=False)
    aus = await get_class_evaluation(c.id, user=u, db=s)
    assert not [x for x in aus["tests"] if x.get("art") == "arbeit"]
