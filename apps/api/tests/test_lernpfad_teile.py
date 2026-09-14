"""Teilaufgaben an der Zuweisung: „Nr. 4" heißt für dieses Kind „Nr. 4 a, b".

Sie stehen im selben JSON wie die Zuweisung (`assignments`), weil sie zu ihr
gehören und nicht zur Aufgabe — dieselbe Aufgabe kann beim Nachbarn ganz
drankommen. Der Server prüft die Form nicht: `assignments` ist bewusst freies
JSON (siehe models.LearningLadder), und ein Feld mehr darf dort nicht
scheitern. Genau das hält dieser Test fest.
"""
import pytest

from app.models import LearningPath, User
from app.routers import lernpfad as lp


@pytest.mark.asyncio
async def test_teilaufgaben_ueberleben_den_roundtrip(s):
    u = User(email="t@x.de", password_hash="x", email_verified=True)
    s.add(u)
    await s.flush()
    pfad = LearningPath(name="Brüche", owner_id=u.id)
    s.add(pfad)
    await s.commit()

    zuweisung = [{"student_id": 7, "exercise_ids": [3, 9], "teile": {"3": "a, b"}}]
    neu = await lp.add_ladder(pfad.id, lp.LadderIn(assignments=zuweisung), user=u, db=s)
    assert neu.assignments[0]["teile"] == {"3": "a, b"}, "unveraendert gespeichert"

    # Und beim Aendern bleibt es erhalten.
    geaendert = await lp.update_ladder(
        neu.id, lp.LadderIn(assignments=[{"student_id": 7, "exercise_ids": [3, 9],
                                          "teile": {"3": "a", "9": "1-3"}}]), user=u, db=s)
    assert geaendert.assignments[0]["teile"] == {"3": "a", "9": "1-3"}
    assert geaendert.assignments[0]["exercise_ids"] == [3, 9], "die Zuweisung bleibt daneben"
