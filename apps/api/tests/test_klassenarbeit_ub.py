"""Einzelne Kinder in einer Arbeit als „unbewertet“ (UB) markieren: gespeichert, geliefert, Punkte bleiben."""
import pytest

from app.models import SchoolClass, Student, User
from app.routers import klassenarbeit as K


async def _welt(s):
    u = User(email="ub@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    c = SchoolClass(name="7a", owner_id=u.id); s.add(c); await s.flush()
    a = Student(card_id=1, name="Ann", class_id=c.id); b = Student(card_id=2, name="Bob", class_id=c.id)
    s.add_all([a, b]); await s.commit()
    return u, c, a, b


@pytest.mark.asyncio
async def test_ub_wird_gespeichert_und_geliefert(s):
    u, c, a, b = await _welt(s)
    w = await K.create_work(K.WorkIn(class_id=c.id, name="KA"), user=u, db=s)
    tasks = [{"id": "t1", "label": "", "topic_id": None, "max": 4}]
    res = {str(a.id): {"t1": 3}, str(b.id): {"t1": 1}}
    out = await K.update_work(w.id, K.WorkPut(tasks=tasks, results=res, unbewertet=[a.id, a.id, str(b.id)]), user=u, db=s)
    assert sorted(out.unbewertet) == sorted([str(a.id), str(b.id)])            # eindeutig, als Text
    assert out.results[str(a.id)] == {"t1": 3}                                  # die Punkte bleiben
    liste = await K.list_works(c.id, user=u, db=s)
    assert sorted(liste[0].unbewertet) == sorted([str(a.id), str(b.id)])


@pytest.mark.asyncio
async def test_ub_laesst_sich_wieder_leeren_und_fehlt_es_bleibt_es(s):
    u, c, a, b = await _welt(s)
    w = await K.create_work(K.WorkIn(class_id=c.id, name="KA"), user=u, db=s)
    await K.update_work(w.id, K.WorkPut(unbewertet=[a.id]), user=u, db=s)
    ohne_feld = await K.update_work(w.id, K.WorkPut(name="KA 2"), user=u, db=s)  # älterer Client schickt das Feld nicht
    assert ohne_feld.unbewertet == [str(a.id)]
    leer = await K.update_work(w.id, K.WorkPut(unbewertet=[]), user=u, db=s)
    assert leer.unbewertet == []
